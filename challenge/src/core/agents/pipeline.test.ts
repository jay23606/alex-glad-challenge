// Тесты pipeline: runNewsPipeline прокидывает blog.id в PostWriter.write.
// Регрессия: потеря blogId в writer.write молча уводит блог с пресетом
// (lookatfacts, style_preset='antonov') на default-стиль — пресет не применяется.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BlogDb, DEFAULT_BLOG_SLUG } from '../db.js';
import { LlmClient } from '../client.js';
import type { ChatMessage } from '../types.js';
import { ANTONOV_SYSTEM_PROMPT } from '../stylePreset.js';
import { runNewsPipeline } from './pipeline.js';

// Windows: WAL-дескрипторы могут пережить close() до GC — EPERM на rmSync
// не является провалом теста (паттерн db.test.ts / postWriter.test.ts).
function safeRm(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EBUSY') throw e;
  }
}

// Fake LLM без сети (паттерн postWriter.test.ts): конфиг-заглушка + перехват chat.
// Ответ различаем по user-блоку: writer просит пост, factchecker — JSON-verdict.
function fakeClient(captured: ChatMessage[][]): LlmClient {
  const client = new LlmClient({ baseUrl: 'http://127.0.0.1:1', apiKey: 'test', defaultModel: 'test' });
  client.chat = async (messages: ChatMessage[]) => {
    captured.push(messages);
    const text = messages.map((m) => m.content).join('\n');
    if (text.includes('=== НОВОСТЬ ДЛЯ ПОСТА ===')) {
      return 'Челси: Готовый пост.\n\n@lookatfacts';
    }
    if (text.includes('"verdict"')) {
      return '{"verdict":"ok","issues":[],"recommendation":"ок"}';
    }
    // Шаг 1 фактчекера — рассуждения.
    return 'Проверил имена, счёт, даты — расхождений нет.';
  };
  return client;
}

// Сетевой RSS-слой (fetchAllFeedsDetailed) в pipeline не инжектится, но есть
// существующий seam: blogs.sources. Мёртвый loopback-URL падает мгновенно
// (ECONNREFUSED, без внешней сети), ошибка собирается в rssErrors — и pipeline
// работает на предзаполненной новости из БД.
const OFFLINE_SOURCES = '["http://127.0.0.1:1/rss.xml"]';

// Свежая новость: unusedNewsSince фильтрует по published_at за последние 24 часа.
const NEWS_ROW = {
  url: 'https://example.com/chelsea-2-0',
  title: 'Челси выиграл 2:0',
  summary: 'Матч завершился победой хозяев.',
  published_at: new Date().toISOString(),
  source: 'test',
};

function writerSystemPrompt(captured: ChatMessage[][]): string {
  const writerCall = captured.find((messages) =>
    messages.some((m) => m.content.includes('=== НОВОСТЬ ДЛЯ ПОСТА ===')),
  );
  assert.ok(writerCall, 'вызов PostWriter не найден среди LLM-вызовов');
  const system = writerCall.find((m) => m.role === 'system');
  assert.ok(system, 'у вызова PostWriter нет system-сообщения');
  return system.content;
}

test('pipeline: блог с пресетом antonov — writer получает ANTONOV system-промпт (blogId не потерян)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pipeline-antonov-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const stored = db.getBlogBySlug(DEFAULT_BLOG_SLUG)!;
    assert.equal(stored.style_preset, 'antonov');
    db.insertNews(NEWS_ROW, stored.id);

    const captured: ChatMessage[][] = [];
    const result = await runNewsPipeline(db, fakeClient(captured), {
      blog: { ...stored, sources: OFFLINE_SOURCES },
    });

    // RSS-фид недоступен (ожидалось), пост написан по новости из БД.
    assert.ok(result.rssErrors.length > 0, 'мёртвый фид должен дать rssErrors');
    assert.ok(result.post, 'пост должен быть написан');

    const system = writerSystemPrompt(captured);
    assert.ok(system.includes(ANTONOV_SYSTEM_PROMPT), 'пресет Антонова должен быть в system-промпте');
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('pipeline: default-блог — ANTONOV-маркера в writer-промпте нет', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pipeline-default-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const stored = db.getBlogBySlug('artemia-artel')!;
    assert.equal(stored.style_preset, 'default');
    db.insertNews(NEWS_ROW, stored.id);

    const captured: ChatMessage[][] = [];
    const result = await runNewsPipeline(db, fakeClient(captured), {
      blog: { ...stored, sources: OFFLINE_SOURCES },
    });

    assert.ok(result.post, 'пост должен быть написан');

    const system = writerSystemPrompt(captured);
    assert.match(system, /Ты — автор Telegram-канала/);
    assert.ok(!system.includes(ANTONOV_SYSTEM_PROMPT), 'пресет Антонова не должен применяться');
  } finally {
    db.close();
    safeRm(dir);
  }
});

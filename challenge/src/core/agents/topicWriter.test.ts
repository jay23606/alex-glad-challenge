// Тесты TopicPostWriter: генерация без RSS, per-blog промпты, варианты подачи.
// Сеть вырезана fake-LLM (паттерн postWriter.test.ts); БД — tmp sqlite.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BlogDb } from '../db.js';
import { LlmClient } from '../client.js';
import type { ChatMessage } from '../types.js';
import { TopicPostWriter } from './topicWriter.js';

function safeRm(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EBUSY') throw e;
  }
}

interface Captured {
  messages: ChatMessage[];
  temperature?: number;
}

function fakeClient(captured: Captured[], reply: (i: number) => string = (i) => `Вариант ${i}`): LlmClient {
  const client = new LlmClient({
    baseUrl: 'http://127.0.0.1:1',
    apiKey: 'test',
    defaultModel: 'test',
  });
  client.chat = async (messages: ChatMessage[], params?: { temperature?: number }) => {
    captured.push({ messages, temperature: params?.temperature });
    return reply(captured.length - 1);
  };
  return client;
}

test('topicWriter: 3 варианта — разные углы, канал блога и context prompt', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'topic-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const initial = db.getBlogBySlug('nevsky-hram')!;
    db.updateBlog(initial.id, {
      system_prompt: 'Ты — голос храмовой общины, пиши тепло.',
      context_prompt: 'Настоятель — отец N. Не выдумывай цитаты.',
    });
    const blog = db.getBlogBySlug('nevsky-hram')!;

    const captured: Captured[] = [];
    const writer = new TopicPostWriter(fakeClient(captured, (i) => `Текст ${i}.`));
    const variants = await writer.writeMany(db, blog, {
      topic: 'Рождественская служба',
      comment: 'Начало в 9:00',
      count: 3,
    });

    assert.equal(variants.length, 3);
    assert.deepEqual(variants.map((v) => v.variant), [0, 1, 2]);
    assert.equal(new Set(variants.map((v) => v.angle)).size, 3, 'углы различаются');
    assert.ok(variants.every((v) => v.content.startsWith('Невский храм на Доваторцев: ')));

    const first = captured[0].messages[0].content;
    assert.match(first, /голос храмовой общины/);
    assert.match(first, /КОНТЕКСТ БЛОГА/);
    assert.match(first, /Не выдумывай цитаты/);
    assert.match(first, /Угол: тёплый человеческий/);
    assert.match(captured[1].messages[0].content, /Угол: короткий факт/);
    assert.match(captured[2].messages[0].content, /Угол: размышление/);
    assert.ok(!first.includes('@lookatfacts'), 'чужой подписи нет');
    assert.ok(!first.includes('Челси'), 'футбольного дефолта нет');
    // Температура растёт между вариантами — подача действительно разная.
    assert.ok((captured[1].temperature ?? 0) > (captured[0].temperature ?? 0));
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('topicWriter: последние посты попадают в anti-repeat блок, count зажат 1..3', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'topic-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const blog = db.getBlogBySlug('artemia-artel')!;
    db.insertPost('Старый пост про настольные игры', null, null, blog.id);

    const captured: Captured[] = [];
    const writer = new TopicPostWriter(fakeClient(captured));
    const variants = await writer.writeMany(db, blog, { topic: 'Игротека', count: 9 });

    assert.equal(variants.length, 3, 'максимум 3 варианта');
    assert.match(captured[0].messages[1].content, /ПОСЛЕДНИЕ ПОСТЫ/);
    assert.match(captured[0].messages[1].content, /Старый пост про настольные игры/);
    assert.ok(!captured[0].messages[0].content.includes('@lookatfacts'));
  } finally {
    db.close();
    safeRm(dir);
  }
});

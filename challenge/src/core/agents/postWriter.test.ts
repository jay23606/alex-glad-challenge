import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BlogDb, DEFAULT_BLOG_SLUG, type NewsRow } from '../db.js';
import { LlmClient } from '../client.js';
import type { ChatMessage } from '../types.js';
import { PostWriter } from './postWriter.js';

function safeRm(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EBUSY') throw e;
  }
}

// Fake LLM без сети: конфиг-заглушка + перехват chat.
function fakeClient(captured: ChatMessage[][]): LlmClient {
  const client = new LlmClient({ baseUrl: 'http://127.0.0.1:1', apiKey: 'test', defaultModel: 'test' });
  client.chat = async (messages: ChatMessage[]) => {
    captured.push(messages);
    return 'Готовый пост.';
  };
  return client;
}

const NEWS: NewsRow = {
  id: 1,
  url: 'https://example.com/1',
  title: 'Челси выиграл 2:0',
  summary: 'Матч завершился победой хозяев.',
  published_at: '2026-01-01T00:00:00Z',
  source: 'test',
  used: 0,
  created_at: '2026-01-01T00:00:00Z',
  blog_id: null,
};

test('postWriter: preset antonov — system-пресет поверх профиля, без few-shot', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pw-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const blog = db.getBlogBySlug(DEFAULT_BLOG_SLUG)!;
    assert.equal(blog.style_preset, 'antonov');
    db.addStyleSample('образец стиля', blog.id);

    const captured: ChatMessage[][] = [];
    const writer = new PostWriter(fakeClient(captured));
    await writer.write(db, NEWS, { blogId: blog.id });

    assert.equal(captured.length, 1);
    const messages = captured[0];
    // Без few-shot пар: только system + user.
    assert.deepEqual(messages.map((m) => m.role), ['system', 'user']);
    const system = messages[0].content;
    assert.match(system, /Перепиши текст пользователя/);
    // Профиль продолжает давать канал/подпись/табу.
    assert.match(system, /КАНАЛ И ПРОФИЛЬ/);
    assert.match(system, /@lookatfacts/);
    assert.match(system, /без мата, без политики/);
    // Образцы не подмешиваются.
    assert.ok(!messages.some((m) => m.content.includes('образец стиля')));
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('postWriter: preset default — старое поведение (профиль + few-shot)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pw-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const blog = db.getBlogBySlug('artemia-artel')!;
    assert.equal(blog.style_preset, 'default');
    db.addStyleSample('образец стиля', blog.id);

    const captured: ChatMessage[][] = [];
    const writer = new PostWriter(fakeClient(captured));
    await writer.write(db, NEWS, { blogId: blog.id });

    const messages = captured[0];
    assert.match(messages[0].content, /Ты — автор Telegram-канала/);
    assert.match(messages[0].content, /ЖЁСТКИЕ ПРАВИЛА СТИЛЯ/);
    // Few-shot: образец попал в user-блок и в пару user/assistant.
    assert.ok(messages.some((m) => m.content.includes('образец стиля')));
    assert.ok(messages.length > 2);
  } finally {
    db.close();
    safeRm(dir);
  }
});

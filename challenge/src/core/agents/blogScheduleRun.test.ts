// Тесты прогона расписания: генерация по теме, auto_publish, идемпотентность
// слота и ретрай публикации без дублей черновиков. Сеть/TG вырезаны.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BlogDb } from '../db.js';
import { BlogScheduleStore, MAX_ATTEMPTS } from '../blogSchedule.js';
import { LlmClient } from '../client.js';
import type { AutomationRuleRow } from '../automation.js';
import type { BlogRow } from '../db.js';
import type { PublishResult } from './telegram.js';
import { createBlogScheduleRunner } from './blogScheduleRun.js';

function safeRm(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EBUSY') throw e;
  }
}

function fakeClient(reply: (i: number) => string = (i) => `Вариант ${i}`): LlmClient {
  const client = new LlmClient({
    baseUrl: 'http://127.0.0.1:1',
    apiKey: 'test',
    defaultModel: 'test',
  });
  let i = 0;
  client.chat = async () => reply(i++);
  return client;
}

function rule(autoPublish: boolean): AutomationRuleRow {
  return {
    blog_id: 1,
    enabled: 1,
    interval_minutes: 360,
    auto_publish: autoPublish ? 1 : 0,
    last_run_at: null,
    next_run_at: null,
    created_at: '',
    updated_at: '',
  };
}

function setup(): {
  dir: string;
  db: BlogDb;
  store: BlogScheduleStore;
  blog: BlogRow;
  now: Date;
} {
  const dir = mkdtempSync(path.join(tmpdir(), 'sched-run-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  const store = new BlogScheduleStore(path.join(dir, 'schedule.sqlite'));
  const blog = db.getBlogBySlug('nevsky-hram')!;
  store.replaceForBlog(blog.id, [
    { dayOfWeek: 6, timeLocal: '10:00', topic: 'Субботняя заметка', variants: 2 },
  ]);
  return { dir, db, store, blog, now: new Date('2026-10-24T07:02:00Z') };
}

test('scheduleRun: создаёт варианты по теме без автопубликации, слот не повторяется', async () => {
  const { dir, db, store, blog, now } = setup();
  const calls: Array<{ content: string; blogId: number; postId: number }> = [];
  try {
    const runner = createBlogScheduleRunner({
      blogDb: db,
      store,
      client: fakeClient((i) => `Текст варианта ${i}`),
      getRule: () => null,
      publish: async (content, b, postId): Promise<PublishResult> => {
        calls.push({ content, blogId: b.id, postId });
        return { ok: true, messageId: 1 };
      },
      now: () => now,
    });

    const first = await runner.runDue();
    assert.equal(first.length, 1);
    assert.equal(first[0].status, 'success');
    assert.notEqual(first[0].postId, null);

    const posts = db.recentPosts(10, blog.id);
    assert.equal(posts.length, 2);
    assert.equal(posts[0].topic, 'Субботняя заметка');
    assert.deepEqual(posts.map((p) => p.variant).sort(), [0, 1]);
    assert.equal(calls.length, 0, 'auto_publish=0 — не публикуем');

    assert.deepEqual(await runner.runDue(), [], 'слот уже выполнен');
    assert.equal(db.recentPosts(10, blog.id).length, 2, 'дублей нет');
    assert.equal(store.listRuns(5)[0].status, 'success');
  } finally {
    store.close();
    db.close();
    safeRm(dir);
  }
});

test('scheduleRun: auto_publish=1 публикует первый вариант в канал блога', async () => {
  const { dir, db, store, blog, now } = setup();
  const calls: Array<{ content: string; blogId: number; postId: number }> = [];
  try {
    store.replaceForBlog(blog.id, [
      { dayOfWeek: 6, timeLocal: '10:00', topic: 'Праздник', variants: 1 },
    ]);
    const runner = createBlogScheduleRunner({
      blogDb: db,
      store,
      client: fakeClient((i) => `Текст ${i}`),
      getRule: (id) => (id === blog.id ? rule(true) : null),
      publish: async (content, b, postId): Promise<PublishResult> => {
        calls.push({ content, blogId: b.id, postId });
        return { ok: true, messageId: 77 };
      },
      now: () => now,
    });

    const [outcome] = await runner.runDue();
    assert.equal(outcome.status, 'success');
    assert.match(outcome.message, /опубликован/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].blogId, blog.id);
    assert.equal(calls[0].postId, outcome.postId);
    assert.match(calls[0].content, /^Невский храм/);
  } finally {
    store.close();
    db.close();
    safeRm(dir);
  }
});

test('scheduleRun: сбой публикации ретраится тем же постом, без дубля черновика', async () => {
  const { dir, db, store, blog, now } = setup();
  let publishCalls = 0;
  try {
    store.replaceForBlog(blog.id, [
      { dayOfWeek: 6, timeLocal: '10:00', topic: 'Праздник', variants: 1 },
    ]);
    const runner = createBlogScheduleRunner({
      blogDb: db,
      store,
      client: fakeClient(),
      getRule: () => rule(true),
      publish: async (): Promise<PublishResult> => {
        publishCalls++;
        return publishCalls === 1 ? { ok: false, error: 'tg down' } : { ok: true, messageId: 5 };
      },
      now: () => now,
    });

    const [failed] = await runner.runDue();
    assert.equal(failed.status, 'error');
    assert.match(failed.message, /tg down/);
    const postId = failed.postId;
    assert.notEqual(postId, null);
    assert.equal(db.recentPosts(10, blog.id).length, 1);

    const [retried] = await runner.runDue();
    assert.equal(retried.status, 'success');
    assert.equal(retried.postId, postId);
    assert.equal(db.recentPosts(10, blog.id).length, 1, 'новый черновик не создан');
    assert.equal(publishCalls, 2);
    assert.equal(store.listRuns(5)[0].attempts, 2);
  } finally {
    store.close();
    db.close();
    safeRm(dir);
  }
});

test('scheduleRun: сбой генерации ретраится ровно MAX_ATTEMPTS раз', async () => {
  const { dir, db, store, blog, now } = setup();
  try {
    const client = fakeClient();
    client.chat = async () => {
      throw new Error('LLM unavailable');
    };
    const runner = createBlogScheduleRunner({
      blogDb: db,
      store,
      client,
      getRule: () => null,
      now: () => now,
    });

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const [outcome] = await runner.runDue();
      assert.equal(outcome.status, 'error', `attempt ${attempt}`);
      assert.equal(outcome.postId, null);
    }
    assert.deepEqual(await runner.runDue(), [], 'лимит попыток исчерпан');
    assert.equal(db.recentPosts(10, blog.id).length, 0);
    assert.equal(store.listRuns(5)[0].attempts, MAX_ATTEMPTS);
  } finally {
    store.close();
    db.close();
    safeRm(dir);
  }
});

test('scheduleRun: неизвестный блог фиксируется как error, остальные слоты не рвутся', async () => {
  const { dir, db, store, now } = setup();
  try {
    store.replaceForBlog(999, [{ dayOfWeek: 6, timeLocal: '10:00', variants: 1 }]);
    const runner = createBlogScheduleRunner({
      blogDb: db,
      store,
      client: fakeClient(),
      getRule: () => null,
      now: () => now,
    });
    const outcomes = await runner.runDue();
    assert.equal(outcomes.length, 2, 'реальный блог обработан, чужой слот — ошибка');
    const missing = outcomes.find((o) => o.blogId === 999);
    assert.equal(missing?.status, 'error');
    assert.match(missing?.message ?? '', /не найден/);
  } finally {
    store.close();
    db.close();
    safeRm(dir);
  }
});

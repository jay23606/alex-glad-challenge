// Тесты общей фабрики блог-автоматизации (#78): pipeline + профиль голоса +
// публикация по auto_publish — общий код web- и TG-адаптеров. Сеть вырезана
// существующими seams: мёртвый loopback-RSS (паттерн pipeline.test.ts),
// fake-LLM (паттерн postWriter.test.ts), publish инжектится.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { LlmClient } from '../client.js';
import type { ChatMessage } from '../types.js';
import { BlogDb, DEFAULT_BLOG_SLUG } from '../db.js';
import type { BlogRow } from '../db.js';
import { BlogAutomation } from '../automation.js';
import type { AutomationRuleRow } from '../automation.js';
import { ProfileManager } from '../profile.js';
import { createAutomationRunner } from './automationRun.js';
import type { AutomationPublish } from './automationRun.js';

// Windows: WAL-дескрипторы могут пережить close() до GC — EPERM на rmSync
// не является провалом теста (паттерн db.test.ts / pipeline.test.ts).
function safeRm(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EBUSY') throw e;
  }
}

// Fake LLM без сети (паттерн pipeline.test.ts): конфиг-заглушка + перехват chat.
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
    return 'Проверил имена, счёт, даты — расхождений нет.';
  };
  return client;
}

// Сетевой RSS-слой не инжектится, но есть seam: blogs.sources. Мёртвый
// loopback-URL падает мгновенно (без внешней сети), пост пишется по новости из БД.
const OFFLINE_SOURCES = '["http://127.0.0.1:1/rss.xml"]';

const NEWS_ROW = {
  url: 'https://example.com/chelsea-2-0',
  title: 'Челси выиграл 2:0',
  summary: 'Матч завершился победой хозяев.',
  published_at: new Date().toISOString(),
  source: 'test',
};

interface PublishCall {
  content: string;
  chatId?: string;
}

function fakePublish(calls: PublishCall[], result: { ok: boolean; error?: string }): AutomationPublish {
  return async (content, blog) => {
    calls.push({ content, chatId: blog.tg_chat_id ?? undefined });
    return result.ok ? { ok: true, messageId: 1 } : { ok: false, error: result.error };
  };
}

function ruleOf(blogId: number, autoPublish: 0 | 1): AutomationRuleRow {
  return {
    blog_id: blogId,
    enabled: 1,
    interval_minutes: 360,
    auto_publish: autoPublish,
    last_run_at: null,
    next_run_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function defaultBlog(db: BlogDb): BlogRow {
  const stored = db.getBlogBySlug(DEFAULT_BLOG_SLUG);
  assert.ok(stored, 'дефолтный блог должен создаваться BlogDb');
  return stored;
}

test('runBlog: пост создаётся, без auto_publish публикация не вызывается', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'automation-run-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const blog = defaultBlog(db);
    // profile: null — иначе seed-блог тянет .data/profiles/default.json хоста.
    db.updateBlog(blog.id, { sources: OFFLINE_SOURCES, tg_chat_id: '-100123', profile: null });
    db.insertNews(NEWS_ROW, blog.id);

    const captured: ChatMessage[][] = [];
    const publishCalls: PublishCall[] = [];
    const runner = createAutomationRunner({
      blogDb: db,
      client: fakeClient(captured),
      getRule: () => ruleOf(blog.id, 0),
      publish: fakePublish(publishCalls, { ok: true }),
    });

    const outcome = await runner.runBlog(blog.id);
    assert.equal(outcome.message, 'Пост создан (без автопубликации)');
    assert.equal(typeof outcome.postId, 'number');
    assert.ok((outcome.postId ?? 0) > 0, 'postId — id новости из БД');
    assert.deepEqual(publishCalls, [], 'без auto_publish publish не зовётся');
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('runBlog: auto_publish=1 — публикация с контентом поста и chat_id блога', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'automation-run-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const blog = defaultBlog(db);
    db.updateBlog(blog.id, { sources: OFFLINE_SOURCES, tg_chat_id: '-100777', profile: null });
    db.insertNews(NEWS_ROW, blog.id);

    const captured: ChatMessage[][] = [];
    const publishCalls: PublishCall[] = [];
    const runner = createAutomationRunner({
      blogDb: db,
      client: fakeClient(captured),
      getRule: () => ruleOf(blog.id, 1),
      publish: fakePublish(publishCalls, { ok: true }),
    });

    const outcome = await runner.runBlog(blog.id);
    assert.equal(outcome.message, 'Пост создан и опубликован в TG');
    assert.equal(publishCalls.length, 1);
    assert.ok(publishCalls[0]?.content.includes('@lookatfacts'), 'публикуется контент поста');
    assert.equal(publishCalls[0]?.chatId, '-100777', 'chat_id берётся из blogs.tg_chat_id');
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('runBlog: ошибка публикации пробрасывается — BlogAutomation запишет failed run', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'automation-run-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const blog = defaultBlog(db);
    db.updateBlog(blog.id, { sources: OFFLINE_SOURCES, profile: null });
    db.insertNews(NEWS_ROW, blog.id);

    const publishCalls: PublishCall[] = [];
    const runner = createAutomationRunner({
      blogDb: db,
      client: fakeClient([]),
      getRule: () => ruleOf(blog.id, 1),
      publish: fakePublish(publishCalls, { ok: false, error: 'чат не найден' }),
    });

    await assert.rejects(runner.runBlog(blog.id), /Публикация не удалась: чат не найден/);
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('runBlog: блога нет — бросает «не найден»', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'automation-run-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const runner = createAutomationRunner({
      blogDb: db,
      client: fakeClient([]),
      getRule: () => null,
    });
    await assert.rejects(runner.runBlog(4242), /Блог 4242 не найден/);
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('runBlog: новостей нет — postId null и честное сообщение', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'automation-run-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const blog = defaultBlog(db);
    db.updateBlog(blog.id, { sources: OFFLINE_SOURCES, profile: null });

    const runner = createAutomationRunner({
      blogDb: db,
      client: fakeClient([]),
      getRule: () => ruleOf(blog.id, 1),
      publish: fakePublish([], { ok: true }),
    });

    const outcome = await runner.runBlog(blog.id);
    assert.deepEqual(outcome, { postId: null, message: 'Свежих новостей нет — пост не создан' });
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('runBlog: профиль голоса из profileDir попадает в writer-промпт (паритет web/TG)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'automation-run-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const profilesDir = path.join(dir, 'profiles');
    const seed = new ProfileManager(profilesDir);
    seed.create('artemia', { канал: 'Артемия Артель', тематика: 'настольные игры' });

    const blog = defaultBlog(db);
    db.updateBlog(blog.id, { sources: OFFLINE_SOURCES, profile: 'artemia' });
    db.insertNews(NEWS_ROW, blog.id);

    const captured: ChatMessage[][] = [];
    const runner = createAutomationRunner({
      blogDb: db,
      client: fakeClient(captured),
      profileDir: profilesDir,
      getRule: () => null,
    });

    const outcome = await runner.runBlog(blog.id);
    assert.equal(outcome.message, 'Пост создан (без автопубликации)');

    // Пресет antonov заменяет system-промпт, профиль продолжает давать канал/
    // подпись/табу: применён профиль блога, а не дефолтный футбольный.
    const writerCall = captured.find((messages) =>
      messages.some((m) => m.content.includes('=== НОВОСТЬ ДЛЯ ПОСТА ===')),
    );
    assert.ok(writerCall, 'вызов PostWriter не найден');
    const system = writerCall.find((m) => m.role === 'system');
    assert.ok(system, 'у вызова PostWriter нет system-сообщения');
    assert.match(system.content, /Артемия Артель/, 'канал из профиля блога применён');
    assert.doesNotMatch(system.content, /Иди на факты глянь/, 'дефолтного канала нет');
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('runBlog параллельно: два блога — каждый пост со своим профилем (без смешивания)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'automation-run-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const profilesDir = path.join(dir, 'profiles');
    const seed = new ProfileManager(profilesDir);
    seed.create('alpha', { канал: 'Канал Альфа', тематика: 'альфа-тема' });
    seed.create('beta', { канал: 'Канал Бета', тематика: 'бета-тема' });

    const alpha = defaultBlog(db); // lookatfacts, style_preset antonov
    db.updateBlog(alpha.id, { sources: OFFLINE_SOURCES, profile: 'alpha' });
    db.insertNews({ ...NEWS_ROW, url: 'https://example.com/alpha', title: 'АЛЬФА-НОВОСТЬ' }, alpha.id);

    const beta = db.getBlogBySlug('artemia-artel'); // style_preset default
    assert.ok(beta, 'seed-блог artemia-artel должен существовать');
    db.updateBlog(beta.id, { sources: OFFLINE_SOURCES, profile: 'beta' });
    db.insertNews({ ...NEWS_ROW, url: 'https://example.com/beta', title: 'БЕТА-НОВОСТЬ' }, beta.id);

    const captured: ChatMessage[][] = [];
    const runner = createAutomationRunner({
      blogDb: db,
      client: fakeClient(captured),
      profileDir: profilesDir,
      getRule: () => null,
    });

    const [a, b] = await Promise.all([runner.runBlog(alpha.id), runner.runBlog(beta.id)]);
    assert.equal(a.message, 'Пост создан (без автопубликации)');
    assert.equal(b.message, 'Пост создан (без автопубликации)');

    // Регрессия: кэш одного ProfileManager мутировал load() — writer читал
    // profile.active после await'ов и брал чужой голос.
    const systemFor = (title: string): string => {
      const call = captured.find((messages) =>
        messages.some(
          (m) =>
            m.role === 'user' &&
            m.content.includes('=== НОВОСТЬ ДЛЯ ПОСТА ===') &&
            m.content.includes(title),
        ),
      );
      assert.ok(call, `вызов writer для «${title}» не найден`);
      const system = call.find((m) => m.role === 'system');
      assert.ok(system, 'нет system-сообщения у writer');
      return system.content;
    };

    const alphaSystem = systemFor('АЛЬФА-НОВОСТЬ');
    const betaSystem = systemFor('БЕТА-НОВОСТЬ');
    assert.match(alphaSystem, /Канал Альфа/, 'пост альфы — голос альфы');
    assert.doesNotMatch(alphaSystem, /Канал Бета/, 'в пост альфы протёк голос беты');
    assert.match(betaSystem, /Канал Бета/, 'пост беты — голос беты');
    assert.doesNotMatch(betaSystem, /Канал Альфа/, 'в пост беты протёк голос альфы');
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('runBlog: клиент-фабрика резолвится на прогон, не при создании', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'automation-run-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const blog = defaultBlog(db);
    // profile: null — иначе seed-блог тянет .data/profiles/default.json хоста.
    db.updateBlog(blog.id, { sources: OFFLINE_SOURCES, profile: null });

    let clientCalls = 0;
    const runner = createAutomationRunner({
      blogDb: db,
      client: () => {
        clientCalls += 1;
        return fakeClient([]);
      },
      getRule: () => null,
    });
    assert.equal(clientCalls, 0, 'при создании фабрики клиент не создаётся');

    const outcome = await runner.runBlog(blog.id);
    assert.equal(outcome.message, 'Свежих новостей нет — пост не создан');
    assert.equal(clientCalls, 1, 'клиент резолвится один раз на прогон');
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('проводка адаптера: BlogAutomation поверх runner — runNow пишет success-запуск', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'automation-run-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const blog = defaultBlog(db);
    // profile: null — иначе seed-блог тянет .data/profiles/default.json хоста.
    db.updateBlog(blog.id, { sources: OFFLINE_SOURCES, tg_chat_id: '-100123', profile: null });
    db.insertNews(NEWS_ROW, blog.id);

    const publishCalls: PublishCall[] = [];
    // Связка как в bot.ts / automation-service.ts: automation создаётся поверх
    // runner'а, getRule связывается лениво через замыкание.
    let automation: BlogAutomation;
    const runner = createAutomationRunner({
      blogDb: db,
      client: fakeClient([]),
      publish: fakePublish(publishCalls, { ok: true }),
      getRule: (id) => automation.getRule(id),
    });
    automation = new BlogAutomation(path.join(dir, 'automation.sqlite'), {
      runBlog: (id) => runner.runBlog(id),
      blogExists: (id) => db.getBlog(id) !== null,
    });

    automation.upsertRule(blog.id, { enabled: true, autoPublish: true, intervalMinutes: 5 });
    const result = await automation.runNow(blog.id);

    assert.equal(result.status, 'success');
    assert.equal(result.message, 'Пост создан и опубликован в TG');
    assert.equal(typeof result.postId, 'number');
    assert.equal(publishCalls.length, 1);
    assert.ok(automation.getRule(blog.id)?.last_run_at, 'правило получило last_run_at');
  } finally {
    db.close();
    safeRm(dir);
  }
});

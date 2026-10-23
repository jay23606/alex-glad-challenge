// Тесты owner-команд /блоги и /авто (BotAutomationCommands): фейки без sqlite
// и сети, send — коллектор. Проверяем ответы пользователю и переходы правила
// (on/off → upsertRule, run → runNow), а не SQL/сеть (то — в тестах ядра).

import test from 'node:test';
import assert from 'node:assert/strict';

import { BotAutomationCommands, redactRunError } from './botAutomation.js';
import type { AutomationCommandsSource } from './botAutomation.js';
import type { AutomationRuleRow, AutomationRunResult, AutomationRunRow } from '../automation.js';
import type { BlogDb, BlogRow } from '../db.js';

const CHAT = '-1001736860345';

function blog(id: number, slug: string, name: string): BlogRow {
  return {
    id,
    slug,
    name,
    profile: null,
    tg_chat_id: null,
    sources: null,
    style_preset: 'default',
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function ruleOf(blogId: number, enabled: 0 | 1): AutomationRuleRow {
  return {
    blog_id: blogId,
    enabled,
    interval_minutes: 360,
    auto_publish: 0,
    last_run_at: null,
    next_run_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

interface Harness {
  commands: BotAutomationCommands;
  sent: Array<{ chatId: string; text: string; replyTo?: number }>;
  upserts: Array<{ blogId: number; enabled: boolean }>;
  runNowCalls: number[];
}

function makeHarness(
  opts: {
    blogs?: BlogRow[];
    rules?: Map<number, AutomationRuleRow>;
    runs?: AutomationRunRow[];
    runNowThrow?: Error;
  } = {},
): Harness {
  const blogs = opts.blogs ?? [
    blog(1, 'idinafakty', 'Иди на факты глянь'),
    blog(2, 'artemia', 'Артемия Артель'),
  ];
  const rules = opts.rules ?? new Map<number, AutomationRuleRow>();
  const runs = opts.runs ?? [];
  const sent: Harness['sent'] = [];
  const upserts: Harness['upserts'] = [];
  const runNowCalls: Harness['runNowCalls'] = [];
  const automation = {
    getRule: (blogId: number) => rules.get(blogId) ?? null,
    listRuns: () => runs,
    upsertRule: (blogId: number, input: { enabled?: boolean }) => {
      upserts.push({ blogId, enabled: input.enabled ?? false });
      rules.set(blogId, ruleOf(blogId, input.enabled ? 1 : 0));
      return true;
    },
    runNow: async (blogId: number): Promise<AutomationRunResult> => {
      runNowCalls.push(blogId);
      if (opts.runNowThrow) throw opts.runNowThrow;
      return { blogId, status: 'success', message: 'Пост создан (без автопубликации)', postId: 42 };
    },
  } satisfies AutomationCommandsSource;
  const commands = new BotAutomationCommands({
    automation,
    blogs: { listBlogs: () => blogs } satisfies Pick<BlogDb, 'listBlogs'>,
    send: async (chatId, text, replyTo) => {
      sent.push({ chatId, text, replyTo });
    },
  });
  return { commands, sent, upserts, runNowCalls };
}

test('cmdBlogs: пустой список — честное «Блогов пока нет»', async () => {
  const h = makeHarness({ blogs: [] });
  await h.commands.cmdBlogs(CHAT);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0]?.chatId, CHAT);
  assert.equal(h.sent[0]?.text, 'Блогов пока нет.');
});

test('cmdBlogs: список блогов со статусом правил и replyTo', async () => {
  const rules = new Map([[1, ruleOf(1, 1)]]);
  const h = makeHarness({ rules });
  await h.commands.cmdBlogs(CHAT, 77);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0]?.replyTo, 77);
  const text = h.sent[0]?.text ?? '';
  assert.match(text, /idinafakty \(#1\) — «Иди на факты глянь»: авто ВКЛ/);
  assert.match(text, /artemia \(#2\) — «Артемия Артель»: автоматизация выкл \(правила нет\)/);
});

test('cmdAuto: on/off обновляет правило (по slug и по id)', async () => {
  const h = makeHarness();
  await h.commands.cmdAuto('idinafakty on', CHAT);
  assert.deepEqual(h.upserts, [{ blogId: 1, enabled: true }]);
  assert.match(h.sent[0]?.text ?? '', /«Иди на факты глянь»: автоматизация включена/);
  await h.commands.cmdAuto('1 off', CHAT);
  assert.deepEqual(h.upserts.at(-1), { blogId: 1, enabled: false });
  assert.match(h.sent[1]?.text ?? '', /автоматизация выключена/);
});

test('cmdAuto: status показывает правило и последний запуск', async () => {
  const rules = new Map([
    [2, { ...ruleOf(2, 1), auto_publish: 1, last_run_at: '2026-10-20T10:00:00.000Z' }],
  ]);
  const runs: AutomationRunRow[] = [
    {
      id: 1,
      blog_id: 2,
      status: 'success',
      post_id: 7,
      message: 'Пост создан и опубликован в TG',
      started_at: '2026-10-20T10:00:00.000Z',
      finished_at: '2026-10-20T10:01:00.000Z',
    },
  ];
  const h = makeHarness({ rules, runs });
  await h.commands.cmdAuto('artemia status', CHAT);
  assert.equal(h.upserts.length, 0);
  const text = h.sent[0]?.text ?? '';
  assert.match(text, /«Артемия Артель» \(artemia, #2\): авто ВКЛ/);
  assert.match(text, /автопубликация вкл/);
  assert.match(text, /Последний запуск: ✅ 2026-10-20 10:00 UTC — Пост создан и опубликован в TG/);
});

test('cmdAuto: run вызывает runNow и отвечает результатом', async () => {
  const h = makeHarness();
  await h.commands.cmdAuto('artemia run', CHAT);
  assert.deepEqual(h.runNowCalls, [2]);
  assert.deepEqual(h.upserts, []);
  assert.match(h.sent[0]?.text ?? '', /Запускаю конвейер «Артемия Артель»…/);
  assert.match(h.sent[1]?.text ?? '', /✅ «Артемия Артель»: Пост создан \(без автопубликации\)/);
});

test('cmdAuto: неизвестный блог — отказ со ссылкой на /блоги', async () => {
  const h = makeHarness();
  await h.commands.cmdAuto('nosuch on', CHAT);
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0]?.text ?? '', /Блог «nosuch» не найден/);
  assert.match(h.sent[0]?.text ?? '', /\/блоги/);
  assert.deepEqual(h.upserts, []);
  assert.deepEqual(h.runNowCalls, []);
});

test('cmdAuto: run — ошибка runNow отвечает урезанным текстом (без URL/токенов)', async () => {
  const h = makeHarness({
    runNowThrow: new Error(
      'LLM fetch https://api.deepseek.com/v1/chat упал (Bearer tok12345), ключ sk-live-abcdef1234567890 отклонён',
    ),
  });
  await h.commands.cmdAuto('artemia run', CHAT);
  assert.deepEqual(h.runNowCalls, [2]);
  assert.equal(h.sent.length, 2);
  const text = h.sent[1]?.text ?? '';
  assert.match(text, /⚠️ «Артемия Артель»: запуск упал — /);
  assert.match(text, /<url>/);
  assert.match(text, /Bearer \*\*\*/);
  assert.match(text, /sk-\*\*\*/);
  assert.doesNotMatch(text, /https?:\/\//);
  assert.doesNotMatch(text, /tok12345/);
  assert.doesNotMatch(text, /abcdef1234567890/);
});

test('redactRunError: URL, Bearer и sk- токены маскируются, длина капится 200', () => {
  assert.equal(redactRunError('фетч https://api.example.com/v1?key=abc упал'), 'фетч <url> упал');
  assert.equal(redactRunError('401: Bearer eyJhbGciOiJIUzI1NiJ9'), '401: Bearer ***');
  assert.equal(redactRunError('ключ sk-abcdef1234567890 невалиден'), 'ключ sk-*** невалиден');
  assert.equal(redactRunError('Bearer***без пробела не токен'), 'Bearer***без пробела не токен');
  const capped = redactRunError('x'.repeat(500));
  assert.equal(capped.length, 201); // 200 символов + многоточие
  assert.match(capped, /…$/);
});

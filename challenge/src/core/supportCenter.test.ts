import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ARTEL_FAQ, searchFaq, buildSupportContext, SupportCenterDb } from './supportCenter.js';
import { renderAssistantContext, buildAssistantMessages } from './assistant.js';

test('support: searchFaq находит по ключевым словам', () => {
  const results = searchFaq('как включить автоматическую публикацию блога');
  assert.ok(results.length > 0);
  assert.match(results[0].question.toLowerCase(), /автоматическ/);
  assert.ok(results[0].score > 0);
});

test('support: searchFaq пусто при нерелевантном запросе', () => {
  assert.deepEqual(searchFaq('xyzq'), []);
});

test('support: buildSupportContext включает FAQ в системный промпт', () => {
  const msgs = buildSupportContext('как связать блог с телеграм каналом');
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /telegram/i);
  assert.equal(msgs[1].role, 'user');
});

test('support: тикеты сохраняются, пустой subject отклоняется', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'support-'));
  try {
    const db = new SupportCenterDb(path.join(dir, 's.sqlite'));
    const id = db.createTicket('Не работает', 'детали', 'me@example.com');
    assert.ok(id > 0);
    assert.equal(db.listTickets().length, 1);
    assert.equal(db.listTickets()[0].status, 'open');
    assert.ok(db.closeTicket(id));
    assert.throws(() => db.createTicket('  ', 'b'), RangeError);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('assistant: контекст содержит проекты и автоматизацию', () => {
  const ctx = renderAssistantContext({
    projects: [{ name: 'Продукт', openTasks: 3 }],
    dueTasks: 2,
    unreadNotifications: 1,
    automation: [{ blogName: 'Факты', enabled: true, intervalMinutes: 60, autoPublish: true }],
    xp: 240,
    level: 3,
  });
  assert.match(ctx, /Продукт/);
  assert.match(ctx, /открытых задач: 3/);
  assert.match(ctx, /Факты: включено, каждые 60 мин/);
  assert.match(ctx, /автопубликация да/);
});

test('assistant: buildAssistantMessages формирует system+user', () => {
  const msgs = buildAssistantMessages(
    { projects: [], dueTasks: 0, unreadNotifications: 0, automation: [], xp: 0, level: 1 },
    'сколько у меня проектов?',
  );
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[1].content, 'сколько у меня проектов?');
  assert.match(msgs[0].content, /проектов нет/);
});

test('assistant: ARTEL_FAQ не пуст и относится к продукту', () => {
  assert.ok(ARTEL_FAQ.length >= 4);
  for (const e of ARTEL_FAQ) assert.ok(e.question && e.answer);
});

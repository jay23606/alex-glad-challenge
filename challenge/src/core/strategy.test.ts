// Тесты стратегий контекста: FullHistory, SlidingWindow, StickyFacts, Branching.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Branching, FullHistory, SlidingWindow, StickyFacts } from './strategy.js';
import type { ChatMessage } from './types.js';

// Хелпер: 15+ мест вызова, единая форма сообщения (lockstep).
function m(role: ChatMessage['role'], content: string): ChatMessage {
  return { role, content };
}

test('FullHistory: хранит всё, context() — копия', () => {
  const s = new FullHistory();
  s.addMessage(m('user', '1'));
  s.addMessage(m('assistant', '2'));
  assert.equal(s.context().length, 2);
  s.context().push(m('user', '3'));
  assert.equal(s.context().length, 2);
  assert.equal(s.stats().messagesDropped, 0);
  s.clear();
  assert.deepEqual(s.context(), []);
});

test('SlidingWindow: окно держит последние N, старое — в dropped', () => {
  const s = new SlidingWindow(3);
  for (const c of ['a', 'b', 'c', 'd', 'e']) s.addMessage(m('user', c));
  assert.deepEqual(s.context().map((x) => x.content), ['c', 'd', 'e']);
  const st = s.stats();
  assert.deepEqual(st, { totalMessages: 5, activeMessages: 3, messagesDropped: 2 });
  s.clear();
  assert.deepEqual(s.context(), []);
  assert.deepEqual(s.stats(), { totalMessages: 0, activeMessages: 0, messagesDropped: 0 });
});

test('StickyFacts: system-блок фактов идёт первым и переживёт усечение окна', () => {
  const s = new StickyFacts(2);
  s.addMessage(m('user', 'цель: собрать дашборд'));
  for (const c of ['f1', 'f2', 'f3', 'f4']) s.addMessage(m('user', c));
  const ctx = s.context();
  assert.equal(ctx[0].role, 'system');
  assert.ok(ctx[0].content.includes('- цель: собрать дашборд'));
  // окно 2 — первые филлеры выпали, факт остался
  assert.deepEqual(ctx.slice(1).map((x) => x.content), ['f3', 'f4']);
  assert.equal(ctx.length, 3);
});

test('StickyFacts: ключи регистронезависимы, повтор — последнее значение', () => {
  const s = new StickyFacts(5);
  s.addMessage(m('user', 'ЦЕЛЬ: старая'));
  s.addMessage(m('user', 'цель: новая'));
  const ctx = s.context();
  const sys = ctx[0].content;
  assert.ok(sys.includes('цель: новая'));
  assert.ok(!sys.includes('старая'));
});

test('StickyFacts: без фактов system-блока нет; clear стирает факты', () => {
  const s = new StickyFacts(3);
  s.addMessage(m('user', 'просто болтовня без ключей'));
  assert.equal(s.context()[0].role, 'user');
  s.addMessage(m('user', 'бюджет: 10'));
  s.clear();
  assert.deepEqual(s.context(), []);
  s.addMessage(m('user', 'опять болтовня'));
  assert.equal(s.context()[0].role, 'user');
});

test('StickyFacts: неизвестные ключи и строки без двоеточия игнорируются', () => {
  const s = new StickyFacts(5);
  s.addMessage(m('user', 'ключ: значение\nцвет: красный\nбез двоеточия вообще'));
  assert.equal(s.context()[0].role, 'user');
});

test('Branching: чекпоинт снимает снапшот, ветки независимы', () => {
  const s = new Branching();
  s.addMessage(m('user', 'm1'));
  const branchId = s.checkpoint('experiment');
  assert.equal(branchId, 1);
  s.switchTo(1);
  assert.deepEqual(s.context().map((x) => x.content), ['m1']);
  s.addMessage(m('user', 'b2'));
  assert.deepEqual(s.context().map((x) => x.content), ['m1', 'b2']);
  s.switchTo(0);
  assert.deepEqual(s.context().map((x) => x.content), ['m1']);
  assert.equal(s.stats().totalMessages, 2);
});

test('Branching: switchTo вне диапазона бросает; clear сбрасывает на main', () => {
  const s = new Branching();
  assert.throws(() => s.switchTo(7), /Нет ветки с id=7/);
  s.addMessage(m('user', 'x'));
  s.clear();
  assert.deepEqual(s.context(), []);
  assert.equal(s.activeBranchId, 0);
});

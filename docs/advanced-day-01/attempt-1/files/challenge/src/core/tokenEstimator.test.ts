import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenEstimator } from './tokenEstimator.js';
import { msg } from './types.js';
import type { ChatMessage } from './types.js';

test('estimateText: ASCII — ceil(байты/4)', () => {
  assert.deepEqual(TokenEstimator.estimateText(''), { bytes: 0, tokens: 0 });
  assert.deepEqual(TokenEstimator.estimateText('h'), { bytes: 1, tokens: 1 });
  assert.deepEqual(TokenEstimator.estimateText('hell'), { bytes: 4, tokens: 1 });
  assert.deepEqual(TokenEstimator.estimateText('hello'), { bytes: 5, tokens: 2 });
});

test('estimateText: кириллица (2 байта/символ) и эмодзи (4 байта)', () => {
  // 'привет' = 6 × 2 = 12 байт → 3 токена.
  assert.deepEqual(TokenEstimator.estimateText('привет'), { bytes: 12, tokens: 3 });
  // '👍' = 4 байта → 1 токен; '👍👍' = 8 → 2.
  assert.deepEqual(TokenEstimator.estimateText('👍'), { bytes: 4, tokens: 1 });
  assert.deepEqual(TokenEstimator.estimateText('👍👍'), { bytes: 8, tokens: 2 });
  // Смешанный: 1 + 4 + 2 = 7 байт → 2 токена.
  assert.deepEqual(TokenEstimator.estimateText('a👍б'), { bytes: 7, tokens: 2 });
});

test('estimate: разбивка по сообщениям и суммарный total', () => {
  const messages: ChatMessage[] = [
    msg.system('ты ревьюер'), // 19 байт (кириллица) → 5
    msg.user('hello world'), // 11 байт → 3
    msg.assistant('ok'), // 2 байта → 1
  ];
  const r = TokenEstimator.estimate(messages);
  assert.equal(r.messages.length, 3);
  assert.deepEqual(
    r.messages.map((m) => [m.index, m.role, m.bytes, m.tokens]),
    [
      [0, 'system', 19, 5],
      [1, 'user', 11, 3],
      [2, 'assistant', 2, 1],
    ],
  );
  assert.equal(r.total, 9);
});

test('estimate: бюджет задан — remaining = budget − total, fits по границе', () => {
  const messages: ChatMessage[] = [msg.user('hello'), msg.assistant('ok')]; // 2 + 1 = 3
  const withBudget = TokenEstimator.estimate(messages, 10);
  assert.deepEqual(withBudget, {
    total: 3,
    budget: 10,
    remaining: 7,
    fits: true,
    messages: [
      { index: 0, role: 'user', bytes: 5, tokens: 2 },
      { index: 1, role: 'assistant', bytes: 2, tokens: 1 },
    ],
  });
  // total == budget → fits true, remaining 0.
  const eq = TokenEstimator.estimate(messages, 3);
  assert.equal(eq.fits, true);
  assert.equal(eq.remaining, 0);
  // total > budget → fits false, remaining отрицательный.
  const over = TokenEstimator.estimate(messages, 2);
  assert.equal(over.fits, false);
  assert.equal(over.remaining, -1);
});

test('estimate: бюджет не задан — budget/remaining null, fits true', () => {
  const r = TokenEstimator.estimate([msg.user('hello world')]);
  assert.equal(r.budget, null);
  assert.equal(r.remaining, null);
  assert.equal(r.fits, true);
});

test('estimate: пустой диалог — total 0, пустая разбивка', () => {
  const r = TokenEstimator.estimate([], 100);
  assert.equal(r.total, 0);
  assert.deepEqual(r.messages, []);
  assert.equal(r.remaining, 100);
  assert.equal(r.fits, true);
});

test('estimate: инвариант tokens == ceil(bytes/4) на смешанном контенте', () => {
  const mixed = ['ok', 'привет, мир!', '👍🏻 a', '🇷🇺 flag', 'x'.repeat(33)];
  const messages = mixed.map((c) => msg.user(c));
  const r = TokenEstimator.estimate(messages);
  for (const m of r.messages) {
    assert.equal(m.tokens, Math.ceil(m.bytes / TokenEstimator.BYTES_PER_TOKEN));
    assert.equal(m.bytes, Buffer.byteLength(mixed[m.index], 'utf8'));
  }
});

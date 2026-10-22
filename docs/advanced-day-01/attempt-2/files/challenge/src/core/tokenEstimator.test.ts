import test from 'node:test';
import assert from 'node:assert/strict';

import { TokenEstimator } from './tokenEstimator.js';
import type { ChatMessage } from './types.js';

test('estimateText: ASCII, округление вверх до целого токена', () => {
  const estimator = new TokenEstimator();
  assert.deepEqual(estimator.estimateText('hello'), { bytes: 5, tokens: 2 });
});

test('estimateText: пустая строка — 0 байт и 0 токенов', () => {
  const estimator = new TokenEstimator();
  assert.deepEqual(estimator.estimateText(''), { bytes: 0, tokens: 0 });
});

test('estimateText: UTF-8 multibyte считает байты, не JS-символы', () => {
  const estimator = new TokenEstimator();
  assert.deepEqual(estimator.estimateText('привет'), { bytes: 12, tokens: 3 });
  assert.deepEqual(estimator.estimateText('🙂'), { bytes: 4, tokens: 1 });
});

test('estimateText: bytesPerToken из опций меняет делитель', () => {
  assert.deepEqual(new TokenEstimator({ bytesPerToken: 2 }).estimateText('hello'), {
    bytes: 5,
    tokens: 3,
  });
  assert.deepEqual(new TokenEstimator({ bytesPerToken: 5 }).estimateText('hello'), {
    bytes: 5,
    tokens: 1,
  });
});

test('constructor: неположительный/нечисловой bytesPerToken → RangeError', () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => new TokenEstimator({ bytesPerToken: bad }), RangeError);
  }
});

test('estimate: разбивка по сообщениям и total как сумма оценок', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'rules' },
    { role: 'user', content: 'привет' },
  ];
  const estimate = new TokenEstimator().estimate(messages, 5);

  assert.equal(estimate.total, 5);
  assert.deepEqual(estimate.messages, [
    { index: 0, role: 'system', bytes: 5, tokens: 2 },
    { index: 1, role: 'user', bytes: 12, tokens: 3 },
  ]);
  assert.equal(estimate.budget, 5);
  assert.equal(estimate.remaining, 0);
  assert.equal(estimate.fits, true);
});

test('estimate: бюджета нет → null-поля и fits=true', () => {
  const estimate = new TokenEstimator().estimate([{ role: 'assistant', content: 'ok' }]);

  assert.equal(estimate.total, 1);
  assert.equal(estimate.budget, null);
  assert.equal(estimate.remaining, null);
  assert.equal(estimate.fits, true);
});

test('estimate: бюджет меньше total → остаток отрицательный, fits=false', () => {
  const estimate = new TokenEstimator().estimate([{ role: 'user', content: 'hello' }], 1);

  assert.equal(estimate.total, 2);
  assert.equal(estimate.remaining, -1);
  assert.equal(estimate.fits, false);
});

test('estimate: пустой список сообщений и нулевой бюджет', () => {
  const estimate = new TokenEstimator().estimate([], 0);

  assert.deepEqual(estimate, {
    total: 0,
    messages: [],
    budget: 0,
    remaining: 0,
    fits: true,
  });
});

test('estimate: каждое сообщение округляется отдельно (total = сумма breakdown)', () => {
  const estimate = new TokenEstimator().estimate([
    { role: 'user', content: 'a' },
    { role: 'user', content: 'b' },
  ]);

  assert.equal(estimate.total, 2);
  assert.deepEqual(
    estimate.messages.map((message) => message.tokens),
    [1, 1],
  );
});

test('estimate: отрицательный/дробный бюджет → RangeError', () => {
  const estimator = new TokenEstimator();
  for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => estimator.estimate([], bad), RangeError);
  }
});

// Тесты детерминированного экстрактора цитат (day 24). Без сети, без LLM.

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractQuotes } from './quotes.js';
import type { ScoredChunk } from './types.js';

function sc(text: string, chunkId: string, section = 'Раздел', source = 'docs/a.md'): ScoredChunk {
  return {
    score: 0.9,
    chunk: {
      text,
      metadata: { chunkId, source, section, title: 'a.md' },
    },
  };
}

test('extractQuotes: пустой ranked -> пустой массив', () => {
  assert.deepEqual(extractQuotes([], 'вопрос'), []);
});

test('extractQuotes: выбирает предложение с максимумом попаданий терминов', () => {
  const text =
    'Погода в Лондоне хорошая. Челси играет в Лондоне на стадионе Стамфорд Бридж.';
  const [q] = extractQuotes([sc(text, 'c1')], 'Где играет Челси?');
  // Термины: «играет», «челси» — оба во втором предложении.
  assert.equal(q.snippet, 'Челси играет в Лондоне на стадионе Стамфорд Бридж.');
});

test('extractQuotes: ноль попаданий -> первое предложение', () => {
  const text = 'Первое предложение про погоду. Второе предложение про поезд.';
  const [q] = extractQuotes([sc(text, 'c1')], 'Что это?');
  assert.equal(q.snippet, 'Первое предложение про погоду.');
});

test('extractQuotes: snippet урезается до maxLen с многоточием', () => {
  const text = 'Длинное предложение без границ которое нужно обрезать по лимиту символов.';
  const [q] = extractQuotes([sc(text, 'c1')], 'что это', { maxLen: 20 });
  assert.equal(q.snippet.length, 20);
  assert.ok(q.snippet.endsWith('…'));
  assert.ok(text.startsWith(q.snippet.slice(0, -1)));
});

test('extractQuotes: метаданные чанка пробрасываются в цитату', () => {
  const [q] = extractQuotes([sc('Текст утверждение про тесты.', 'x::7', 'Раздел > Под', 'docs/b.txt')], 'текст');
  assert.equal(q.chunkId, 'x::7');
  assert.equal(q.source, 'docs/b.txt');
  assert.equal(q.section, 'Раздел > Под');
});

test('extractQuotes: по одной цитате на каждый чанк, порядок сохранён', () => {
  const ranked = [sc('Первый текст про Челси.', 'c1'), sc('Второй текст про Арсенал.', 'c2')];
  const quotes = extractQuotes(ranked, 'Челси и Арсенал');
  assert.equal(quotes.length, 2);
  assert.deepEqual(quotes.map((q) => q.chunkId), ['c1', 'c2']);
});

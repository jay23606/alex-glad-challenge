// Тесты sanitizer'а tainted-контента (границы RSS/forum/TG → БД/промпт).

import test from 'node:test';
import assert from 'node:assert/strict';

import { clean } from './sanitize.js';

test('clean: вырезает control-символы, сохраняя \\t и переносы', () => {
  assert.equal(clean('a\x00b\x08c\td\ne\x0bf\x1fg'), 'abc\td\nefg');
});

test('clean: обрезает по краям', () => {
  assert.equal(clean('  привет \n'), 'привет');
});

test('clean: режет длину по maxLen', () => {
  assert.equal(clean('длинная строка', 7), 'длинная');
});

test('clean: без maxLen длина не ограничивается', () => {
  const long = 'x'.repeat(500);
  assert.equal(clean(long).length, 500);
});

test('clean: идемпотентен (повторный вызов не меняет результат)', () => {
  const once = clean('\x01текст\x02 <script>', 20);
  assert.equal(clean(once, 20), once);
});

test('clean: пустая и пробельная строки', () => {
  assert.equal(clean(''), '');
  assert.equal(clean('   \n\t  '), '');
});

// Тесты чанкера (day 21): fixed-нарезка, structure-нарезка, код, chunkDoc.

import test from 'node:test';
import assert from 'node:assert/strict';

import { chunkFixed, chunkStructured, chunkDoc } from './chunker.js';
import type { LoadedDoc } from './loader.js';

function doc(source: string, text: string): LoadedDoc {
  return { source, text };
}

// --- chunkFixed ---

test('chunkFixed: пустой текст -> без чанков', () => {
  assert.deepEqual(chunkFixed(doc('a.md', '')), []);
});

test('chunkFixed: текст из одних пробелов -> без чанков (trim-фильтр)', () => {
  assert.deepEqual(chunkFixed(doc('a.md', '   \n  ')), []);
});

test('chunkFixed: короткий текст -> один чанк с метаданными файла', () => {
  const chunks = chunkFixed(doc('docs/guide.md', 'Короткий текст.'));
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, 'Короткий текст.');
  assert.equal(chunks[0].metadata.chunkId, 'docs/guide.md::0');
  assert.equal(chunks[0].metadata.title, 'guide.md');
  assert.equal(chunks[0].metadata.section, 'guide.md');
});

test('chunkFixed: жёсткий сплит без границ — перекрытие сохраняет стык', () => {
  const text = 'a'.repeat(250);
  const chunks = chunkFixed(doc('a.txt', text), { size: 100, overlap: 50 });
  assert.equal(chunks.length, 4);
  for (const c of chunks) assert.ok(c.text.length <= 100);
  // перекрытие: начало следующего = хвост предыдущего
  assert.equal(chunks[1].text.slice(0, 50), chunks[0].text.slice(50));
  assert.equal(chunks[2].text.slice(0, 50), chunks[1].text.slice(50));
  assert.deepEqual(chunks.map((c) => c.metadata.chunkId), [
    'a.txt::0',
    'a.txt::1',
    'a.txt::2',
    'a.txt::3',
  ]);
});

test('chunkFixed: overlap >= size зажимается до size-1 (гарантия продвижения)', () => {
  const chunks = chunkFixed(doc('a.txt', 'b'.repeat(25)), { size: 10, overlap: 500 });
  assert.ok(chunks.length >= 3);
});

// --- chunkStructured ---

test('chunkStructured: markdown-заголовки дают секции и путь разделов', () => {
  const md = '# Верхушка\nТекст верхушки.\n## Подраздел\nТекст подраздела.\n';
  const chunks = chunkStructured(doc('book.md', md));
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].metadata.title, 'Верхушка');
  assert.equal(chunks[0].metadata.section, 'Верхушка');
  assert.equal(chunks[1].metadata.section, 'Верхушка > Подраздел');
  assert.equal(chunks[1].text, 'Текст подраздела.');
  assert.deepEqual(chunks.map((c) => c.metadata.chunkId), ['book.md::0', 'book.md::1']);
});

test('chunkStructured: исходник кода — один чанк на файл', () => {
  const src = 'export const a = 1;\nexport const b = 2;\n';
  const chunks = chunkStructured(doc('src/mod.ts', src));
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, src.trim());
  assert.equal(chunks[0].metadata.chunkId, 'src/mod.ts::0');
});

test('chunkStructured: длинная секция режется рекурсивно, заголовок переносится', () => {
  const body = Array.from(
    { length: 60 },
    (_, i) => `Предложение номер ${i} для проверки нарезки текста. `,
  ).join('');
  const md = `# Длинная\n${body}\n`;
  const chunks = chunkStructured(doc('long.md', md));
  assert.ok(chunks.length >= 2, 'ожидается >=2 под-чанков');
  for (const c of chunks) {
    assert.equal(c.metadata.section, 'Длинная');
    assert.ok(c.text.length > 0);
    assert.ok(c.text.includes('Длинная\n'), 'заголовок переносится в под-чанк');
  }
});

test('chunkStructured: плоский маркер «Глава N» распознаётся', () => {
  const md = 'Глава 1. Начало\nТекст главы.\n';
  const chunks = chunkStructured(doc('p.md', md));
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].metadata.title, 'Глава 1: Начало');
  assert.equal(chunks[0].metadata.section, 'Глава 1: Начало');
});

test('chunkStructured: бесструктурный текст — fallback без пустых чанков (warn в stderr)', () => {
  // подавляем ожидаемый warn, чтобы не шуметь в тестовом выводе
  const original = console.warn;
  let warned = 0;
  console.warn = () => {
    warned++;
  };
  try {
    const chunks = chunkStructured(doc('plain.txt', 'Просто текст без заголовков. Ещё предложение. '));
    assert.ok(chunks.length >= 1);
    assert.ok(chunks.every((c) => c.text.length > 0));
    assert.equal(warned, 1);
  } finally {
    console.warn = original;
  }
});

// --- chunkDoc ---

test('chunkDoc: диспетчеризация fixed/structure', () => {
  const md = '# Заголовок\nТекст.\n';
  const fixed = chunkDoc(doc('d.md', md), 'fixed');
  assert.equal(fixed[0].metadata.section, 'd.md');
  const structured = chunkDoc(doc('d.md', md), 'structure');
  assert.equal(structured[0].metadata.section, 'Заголовок');
});

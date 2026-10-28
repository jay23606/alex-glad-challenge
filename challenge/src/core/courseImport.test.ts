import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  slugFromFilename,
  kindFromSlug,
  parseTranscript,
  buildSections,
  loadLessonMeta,
  buildLessonInput,
  importCourseDir,
} from './courseImport.js';
import { CourseDb } from './courseDb.js';

test('slugFromFilename: «N неделя …» → week-N, «вступление» → intro', () => {
  assert.equal(slugFromFilename('1 неделя 6 поток v2 (1).transcript.json'), 'week-1');
  assert.equal(slugFromFilename('5 неделя 6 поток v1 (1).transcript.json'), 'week-5');
  assert.equal(slugFromFilename('8 поток вступление v1.transcript.json'), 'intro');
  assert.equal(slugFromFilename('random.txt'), null);
});

test('kindFromSlug разводит intro и week-N', () => {
  assert.deepEqual(kindFromSlug('intro'), { kind: 'intro', weekNo: null });
  assert.deepEqual(kindFromSlug('week-3'), { kind: 'week', weekNo: 3 });
});

test('parseTranscript фильтрует пустые utterances и бросает при отсутствии', () => {
  const file = parseTranscript(
    JSON.stringify({
      duration: 1000,
      utterances: [
        { start: 0, end: 100, text: 'Привет' },
        { start: 100, end: 200, text: '   ' },
        { start: 200, end: 300, text: 'Мир' },
      ],
    }),
  );
  assert.equal(file.durationMs, 1000);
  assert.equal(file.utterances.length, 2);

  assert.throws(() => parseTranscript(JSON.stringify({ duration: 1, utterances: [] })));
  assert.throws(() => parseTranscript(JSON.stringify({ duration: 1 })));
});

test('buildSections группирует по ~3 минутам с оверлапом', () => {
  // 10 реплик по 30 сек, каждая ≈80 символов → первая секция обрывается на ~3 минутах.
  const utterances = Array.from({ length: 10 }, (_, i) => ({
    start: i * 30_000,
    end: (i + 1) * 30_000,
    text: `Реплика ${i} под длинным достаточно текстом, чтобы хвост не слипался в мини-секцию`,
  }));
  const sections = buildSections(utterances);
  assert.ok(sections.length >= 2, `ожидалось ≥2 секций, получено ${sections.length}`);
  assert.equal(sections[0].idx, 0);
  assert.equal(sections[0].startMs, 0);
  // Оверлап: последняя реплика первой секции — первая второй.
  const firstEnd = sections[0].endMs;
  assert.equal(sections[1].startMs, firstEnd - 30_000);
  // Хвост не отбрасывается: все реплики покрыты.
  const joined = sections.map((s) => s.text).join(' ');
  for (const u of utterances) assert.ok(joined.includes(u.text), u.text);
});

test('loadLessonMeta читает JSON и возвращает null при отсутствии', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'course-meta-'));
  try {
    assert.equal(loadLessonMeta(dir, 'week-1'), null);
    writeFileSync(
      path.join(dir, 'week-1.json'),
      JSON.stringify({
        slug: 'week-1',
        title: 'Тема',
        summary: 'С',
        why: 'З',
        pain: 'Б',
        excerpts: [{ quote: 'Q', explanation: 'E' }],
      }),
    );
    const meta = loadLessonMeta(dir, 'week-1');
    assert.ok(meta);
    assert.equal(meta.title, 'Тема');
    assert.equal(meta.excerpts.length, 1);
    // Невалидные записи отфильтровываются.
    writeFileSync(
      path.join(dir, 'week-1.json'),
      JSON.stringify({ title: 'Тема', excerpts: [{ quote: 1 }, { quote: 'Q', explanation: 'E' }] }),
    );
    assert.equal(loadLessonMeta(dir, 'week-1')?.excerpts.length, 1);
    // Без title — null.
    writeFileSync(path.join(dir, 'week-1.json'), JSON.stringify({ summary: 'x' }));
    assert.equal(loadLessonMeta(dir, 'week-1'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('importCourseDir импортирует *.transcript.json + метаданные и печатает итог', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'course-import-'));
  const metaDir = mkdtempSync(path.join(tmpdir(), 'course-meta-'));
  const dbDir = mkdtempSync(path.join(tmpdir(), 'course-db-'));
  const db = new CourseDb(path.join(dbDir, 'course.sqlite'));
  try {
    const transcript = {
      duration: 60_000,
      utterances: [
        { start: 0, end: 30_000, text: 'Раз' },
        { start: 30_000, end: 60_000, text: 'Два' },
      ],
    };
    writeFileSync(path.join(dir, '1 неделя тест.transcript.json'), JSON.stringify(transcript));
    writeFileSync(path.join(dir, '8 поток вступление v1.transcript.json'), JSON.stringify(transcript));
    writeFileSync(path.join(dir, 'video.mp4'), 'не транскрипция');
    writeFileSync(
      path.join(metaDir, 'week-1.json'),
      JSON.stringify({
        title: 'Неделя 1: тест',
        summary: 'С',
        why: 'З',
        pain: 'Б',
        excerpts: [{ quote: 'Q', explanation: 'E' }],
      }),
    );

    const results = importCourseDir(db, dir, metaDir);
    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((r) => r.slug).sort(),
      ['intro', 'week-1'],
    );
    const week = results.find((r) => r.slug === 'week-1');
    assert.ok(week);
    assert.equal(week.title, 'Неделя 1: тест');
    assert.equal(week.excerpts, 1);
    assert.equal(week.curated, true);

    const intro = results.find((r) => r.slug === 'intro');
    assert.ok(intro);
    // Без метаданных — дефолтное название, полная транскрипция импортируется.
    assert.equal(intro.title, 'Вступление');
    assert.equal(intro.curated, false);

    const lesson = db.getLesson('week-1');
    assert.ok(lesson);
    assert.equal(db.getSections(lesson.id).length, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(metaDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  }
});

test('buildLessonInput бросает для файла без распознаваемого slug', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'course-import-'));
  try {
    const file = path.join(dir, 'unknown.transcript.json');
    writeFileSync(file, JSON.stringify({ duration: 1, utterances: [{ start: 0, end: 1, text: 'x' }] }));
    assert.throws(() => buildLessonInput(file, null), /slug/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadLessonMeta: битый json не глотается молча — diagnostics + деградация (issue #140)', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'course-meta-corrupt-'));
  try {
    writeFileSync(path.join(dir, 'week-9.json'), '{ это не валидный json');
    const errors: string[] = [];
    t.mock.method(console, 'error', (line: string) => errors.push(String(line)));

    assert.equal(loadLessonMeta(dir, 'week-9'), null);
    assert.equal(errors.length, 1, 'битые метаданные должны предупредить, а не молчать');
    assert.match(errors[0]!, /courseImport.*week-9\.json/);

    // Отсутствие файла — штатный случай: без warning.
    assert.equal(loadLessonMeta(dir, 'week-77'), null);
    assert.equal(errors.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildSections не рвёт короткий хвост в отдельную секцию', () => {
  const utterances = [
    { start: 0, end: 170_000, text: 'Длинная первая часть, которая занимает почти все три минуты и чья-то мысль' },
    { start: 170_000, end: 175_000, text: 'короткий хвост' },
  ];
  const sections = buildSections(utterances);
  assert.equal(sections.length, 1);
  assert.ok(sections[0].text.includes('короткий хвост'));
  assert.equal(sections[0].endMs, 175_000);
});

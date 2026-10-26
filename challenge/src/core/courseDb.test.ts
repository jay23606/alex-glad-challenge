import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CourseDb } from './courseDb.js';
import type { LessonInput } from './courseDb.js';

function makeInput(overrides: Partial<LessonInput> = {}): LessonInput {
  return {
    slug: 'week-1',
    title: 'Неделя 1',
    kind: 'week',
    weekNo: 1,
    durationMs: 3_600_000,
    summary: 'Резюме',
    why: 'Зачем',
    pain: 'Боль',
    sourceFile: '1.transcript.json',
    sections: [
      { idx: 0, startMs: 0, endMs: 1000, text: 'Первая секция' },
      { idx: 1, startMs: 1000, endMs: 2000, text: 'Вторая секция' },
    ],
    excerpts: [
      { idx: 0, quote: 'Цитата', explanation: 'Пояснение' },
    ],
    ...overrides,
  };
}

test('upsertLesson создаёт урок с секциями и выдержками', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'course-db-'));
  const db = new CourseDb(path.join(dir, 'course.sqlite'));
  try {
    const id = db.upsertLesson(makeInput());
    assert.ok(id > 0);

    const lesson = db.getLesson('week-1');
    assert.ok(lesson);
    assert.equal(lesson.title, 'Неделя 1');
    assert.equal(lesson.weekNo, 1);
    assert.equal(lesson.kind, 'week');

    const sections = db.getSections(lesson.id);
    assert.equal(sections.length, 2);
    assert.equal(sections[0].text, 'Первая секция');
    assert.equal(sections[1].startMs, 1000);

    const excerpts = db.getExcerpts(lesson.id);
    assert.equal(excerpts.length, 1);
    assert.equal(excerpts[0].quote, 'Цитата');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upsertLesson заменяет секции и выдержки при повторном импорте', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'course-db-'));
  const db = new CourseDb(path.join(dir, 'course.sqlite'));
  try {
    db.upsertLesson(makeInput());
    db.upsertLesson(
      makeInput({
        title: 'Неделя 1 (v2)',
        sections: [{ idx: 0, startMs: 0, endMs: 500, text: 'Одна секция' }],
        excerpts: [],
      }),
    );
    const lesson = db.getLesson('week-1');
    assert.ok(lesson);
    assert.equal(lesson.title, 'Неделя 1 (v2)');
    assert.equal(db.getSections(lesson.id).length, 1);
    assert.equal(db.getExcerpts(lesson.id).length, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listLessons сортирует по week_no, intro первым (week_no NULL → 0)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'course-db-'));
  const db = new CourseDb(path.join(dir, 'course.sqlite'));
  try {
    db.upsertLesson(makeInput({ slug: 'week-2', title: 'Неделя 2', weekNo: 2 }));
    db.upsertLesson(
      makeInput({ slug: 'intro', title: 'Вступление', kind: 'intro', weekNo: null }),
    );
    db.upsertLesson(makeInput());
    const list = db.listLessons();
    assert.deepEqual(
      list.map((l) => l.slug),
      ['intro', 'week-1', 'week-2'],
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getLesson возвращает null для неизвестного slug', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'course-db-'));
  const db = new CourseDb(path.join(dir, 'course.sqlite'));
  try {
    assert.equal(db.getLesson('nope'), null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

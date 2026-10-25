// Тесты расписания: чистый расчёт слотов (таймзоны, окно, через полночь),
// валидация, persist и идемпотентные claim/finish с ретраями.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  BlogScheduleStore,
  MAX_ATTEMPTS,
  dueScheduleSlots,
  isValidTimeZone,
  localClock,
  type BlogScheduleRow,
  type ScheduleSlot,
} from './blogSchedule.js';

function safeRm(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EBUSY') throw e;
  }
}

function row(partial: Partial<BlogScheduleRow>): BlogScheduleRow {
  return {
    id: 1,
    blog_id: 1,
    day_of_week: 6,
    time_local: '10:00',
    timezone: 'Europe/Moscow',
    topic: '',
    variants: 1,
    enabled: 1,
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

function slotOf(s: BlogScheduleRow, localDate = '2026-10-24'): ScheduleSlot {
  return {
    schedule: s,
    blogId: s.blog_id,
    slotKey: `${s.blog_id}:${s.id}:${localDate}:${s.time_local}`,
    localDate,
  };
}

test('blogSchedule: localClock считает дату/день/минуты в таймзоне', () => {
  const now = new Date('2026-10-24T07:00:00Z'); // Sat 10:00 MSK
  assert.deepEqual(localClock(now, 'Europe/Moscow'), {
    date: '2026-10-24',
    weekday: 6,
    minutes: 600,
  });
  assert.equal(localClock(now, 'UTC').minutes, 420);
  assert.equal(isValidTimeZone('Europe/Moscow'), true);
  assert.equal(isValidTimeZone('Mars/Olympus'), false);
});

test('blogSchedule: due — точное время, окно 180 минут, не раньше слота', () => {
  const s = row({});
  assert.equal(dueScheduleSlots([s], new Date('2026-10-24T06:59:00Z')).length, 0, 'за минуту до');
  assert.equal(dueScheduleSlots([s], new Date('2026-10-24T07:00:00Z')).length, 1, 'ровно в слот');
  assert.equal(dueScheduleSlots([s], new Date('2026-10-24T09:59:00Z')).length, 1, '179 минут');
  assert.equal(dueScheduleSlots([s], new Date('2026-10-24T10:00:00Z')).length, 0, '180 минут = поздно');
  assert.equal(dueScheduleSlots([s], new Date('2026-10-25T07:00:00Z')).length, 0, 'не тот день');
  assert.equal(dueScheduleSlots([{ ...s, enabled: 0 }], new Date('2026-10-24T07:00:00Z')).length, 0);
  assert.equal(
    dueScheduleSlots([{ ...s, timezone: 'Mars/Olympus' }], new Date('2026-10-24T07:00:00Z')).length,
    0,
  );
});

test('blogSchedule: окно пересекает полночь — воскресный слот ловится в понедельник', () => {
  const s = row({ day_of_week: 0, time_local: '23:30' });
  const slots = dueScheduleSlots([s], new Date('2026-10-25T22:00:00Z')); // Mon 01:00 MSK
  assert.equal(slots.length, 1);
  assert.equal(slots[0].localDate, '2026-10-25');
});

test('blogSchedule: store валидирует вход и атомарно заменяет расписание', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'schedule-'));
  const store = new BlogScheduleStore(path.join(dir, 'schedule.sqlite'));
  try {
    assert.throws(
      () => store.replaceForBlog(1, [{ dayOfWeek: 7, timeLocal: '10:00' }]),
      /dayOfWeek/,
    );
    assert.throws(
      () => store.replaceForBlog(1, [{ dayOfWeek: 6, timeLocal: '9:00' }]),
      /timeLocal/,
    );
    assert.throws(
      () => store.replaceForBlog(1, [{ dayOfWeek: 6, timeLocal: '10:00', timezone: 'Mars/X' }]),
      /timezone/,
    );
    assert.throws(
      () => store.replaceForBlog(1, [{ dayOfWeek: 6, timeLocal: '10:00', variants: 4 }]),
      /variants/,
    );
    assert.throws(
      () =>
        store.replaceForBlog(1, [
          { dayOfWeek: 6, timeLocal: '10:00' },
          { dayOfWeek: 6, timeLocal: '10:00' },
        ]),
      /duplicate/,
    );

    const rows = store.replaceForBlog(1, [
      { dayOfWeek: 0, timeLocal: '10:00', topic: 'Вс' },
      { dayOfWeek: 6, timeLocal: '10:00', topic: 'Сб', variants: 2 },
    ]);
    assert.deepEqual(rows.map((r) => r.day_of_week), [0, 6]);
    assert.equal(rows[1].variants, 2);
    assert.equal(rows[1].timezone, 'Europe/Moscow');
    assert.equal(store.list(2).length, 0);

    store.replaceForBlog(1, [{ dayOfWeek: 3, timeLocal: '12:00' }]);
    assert.deepEqual(store.list(1).map((r) => r.day_of_week), [3]);
  } finally {
    store.close();
    safeRm(dir);
  }
});

test('blogSchedule: claim идемпотентен, error ретраится не больше MAX_ATTEMPTS', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'schedule-'));
  const store = new BlogScheduleStore(path.join(dir, 'schedule.sqlite'));
  try {
    const [s] = store.replaceForBlog(1, [{ dayOfWeek: 6, timeLocal: '10:00' }]);
    const slot = slotOf(s);
    const now = new Date('2026-10-24T07:00:00Z');

    const first = store.claim(slot, now);
    assert.notEqual(first, null);
    assert.equal(store.claim(slot, now), null, 'running не забирается повторно');
    store.finish(first!, 'success', 42, 'ok', now);
    assert.equal(store.claim(slot, now), null, 'success не перезапускается');
    assert.equal(store.listRuns()[0].post_id, 42);

    const failing = slotOf(s, '2026-10-31');
    let runId = store.claim(failing, now);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      assert.notEqual(runId, null, `attempt ${attempt} allowed`);
      store.finish(runId!, 'error', null, 'boom', now);
      runId = store.claim(failing, now);
    }
    assert.equal(runId, null, 'после MAX_ATTEMPTS слот закрыт');
    const runs = store.listRuns();
    assert.equal(runs.length, 2, 'success-слот + один переиспользуемый error-слот');
    assert.equal(runs[0].attempts, MAX_ATTEMPTS);
    assert.equal(runs[0].status, 'error');
  } finally {
    store.close();
    safeRm(dir);
  }
});

test('blogSchedule: расписание переживает переоткрытие файла', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'schedule-'));
  const file = path.join(dir, 'schedule.sqlite');
  const first = new BlogScheduleStore(file);
  first.replaceForBlog(3, [{ dayOfWeek: 0, timeLocal: '09:15', topic: 'Утро' }]);
  first.close();

  const second = new BlogScheduleStore(file);
  try {
    const rows = second.list(3);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].time_local, '09:15');
    assert.equal(rows[0].topic, 'Утро');
  } finally {
    second.close();
    safeRm(dir);
  }
});

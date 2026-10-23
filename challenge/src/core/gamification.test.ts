import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  GamificationDb,
  levelForXp,
  xpForLevel,
  EVENT_POINTS,
} from './gamification.js';

function makeDb(now: () => Date): { db: GamificationDb; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'gamify-'));
  return { db: new GamificationDb(path.join(dir, 'g.sqlite'), now), dir };
}

test('gamification: чистая математика уровней', () => {
  assert.equal(levelForXp(0), 1);
  assert.equal(xpForLevel(1), 100);
  assert.equal(levelForXp(100), 2); // 100 XP = уровень 2
  assert.equal(levelForXp(99), 1);
  assert.equal(levelForXp(400), 3); // floor(sqrt(4))+1
});

test('gamification: award начисляет XP и повышает уровень', () => {
  const { db, dir } = makeDb(() => new Date('2026-10-23T12:00:00'));
  try {
    const first = db.award('todo_completed');
    assert.equal(first.points, EVENT_POINTS.todo_completed);
    assert.equal(first.stats.xp, EVENT_POINTS.todo_completed);
    assert.equal(first.stats.level, 1);
    assert.equal(first.levelUp, false);

    // набрать >100 XP → уровень 2
    let r = first;
    for (let i = 0; i < 11; i++) r = db.award('post_published');
    assert.equal(r.stats.level, levelForXp(r.stats.xp));
    assert.ok(r.stats.level >= 2);

    const stats = db.getStats();
    assert.equal(stats.xp, r.stats.xp);
    assert.ok(stats.levelProgress >= 0 && stats.levelProgress <= 1);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('gamification: award возвращает levelProgress как getStats', () => {
  const { db, dir } = makeDb(() => new Date('2026-10-23T12:00:00'));
  try {
    // Середина уровня 1: прогресс совпадает с getStats и считается по формуле.
    const mid = db.award('todo_completed'); // 10 XP из 100
    assert.equal(mid.stats.levelProgress, db.getStats().levelProgress);
    assert.equal(mid.stats.levelProgress, 10 / 100);
    assert.ok(mid.stats.levelProgress > 0 && mid.stats.levelProgress < 1);

    // Всё поле stats от award идентично getStats после начисления.
    let last = mid;
    for (let i = 0; i < 9; i++) last = db.award('post_published');
    assert.deepEqual(last.stats, db.getStats());
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('gamification: award на границе уровня даёт levelProgress 0, как getStats', () => {
  const { db, dir } = makeDb(() => new Date('2026-10-23T12:00:00'));
  try {
    // 10 × 10 XP = ровно 100 XP: 10-е начисление переводит на уровень 2.
    let up = db.award('todo_completed');
    for (let i = 0; i < 9; i++) up = db.award('todo_completed');
    assert.equal(up.stats.xp, 100);
    assert.equal(up.stats.level, 2);
    assert.equal(up.levelUp, true);
    // Прогресс считается от пола нового уровня → сразу после level-up это 0.
    assert.equal(up.stats.levelProgress, 0);
    assert.equal(up.stats.levelProgress, db.getStats().levelProgress);

    // Первый шаг после level-up: прогресс уже ненулевой и снова совпадает.
    const next = db.award('todo_completed'); // 110 XP
    assert.equal(next.levelUp, false);
    assert.equal(next.stats.levelProgress, 10 / 300);
    assert.equal(next.stats.levelProgress, db.getStats().levelProgress);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('gamification: серия растёт в соседние дни и сбрасывается после пропуска', () => {
  let day = 1;
  const { db, dir } = makeDb(() => new Date(2026, 9, day, 12));
  try {
    db.award('assistant_used');
    day = 2;
    db.award('assistant_used');
    assert.equal(db.getStats().streak, 2);
    day = 5; // пропуск 3-4
    db.award('assistant_used');
    assert.equal(db.getStats().streak, 1);
    assert.equal(db.getStats().bestStreak, 2);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('gamification: достижение открывается один раз', () => {
  const { db, dir } = makeDb(() => new Date('2026-10-23T12:00:00'));
  try {
    // первое действие — first-task
    const first = db.award('todo_completed');
    const codes = first.unlocked.map((a) => a.code);
    assert.ok(codes.includes('first-task'));

    const again = db.award('todo_completed');
    assert.ok(!again.unlocked.some((a) => a.code === 'first-task'));

    const list = db.listAchievements();
    const firstTask = list.find((a) => a.code === 'first-task');
    assert.equal(firstTask?.unlocked, true);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

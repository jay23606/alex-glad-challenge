import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BlogAutomation, nextRunAfter } from './automation.js';

type RunBlog = (id: number) => Promise<{ postId?: number | null; message: string }>;

function make(dbDir: string, now: () => Date, runBlog?: RunBlog): BlogAutomation {
  return new BlogAutomation(path.join(dbDir, 'auto.sqlite'), {
    runBlog: runBlog ?? (async (id) => ({ postId: id, message: 'ok' })),
    blogExists: (id) => id === 1 || id === 2,
    now,
  });
}

// Windows: WAL-дескрипторы могут пережить close() до GC — EPERM на rmSync
// не является провалом теста.
function safeRm(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EBUSY') throw e;
  }
}

test('automation: nextRunAfter считает от последнего запуска или от now', () => {
  const now = new Date('2026-10-23T10:00:00Z');
  assert.equal(nextRunAfter(null, 360, now), now.toISOString()); // новое правило → due now
  assert.equal(new Date(nextRunAfter(now.toISOString(), 60, now)).getTime(), now.getTime() + 60 * 60_000);
});

test('automation: upsertRule валидирует интервал и существование блога', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'auto-'));
  const svc = make(dir, () => new Date('2026-10-23T10:00:00Z'));
  try {
    assert.throws(() => svc.upsertRule(999, { enabled: true }), RangeError);
    assert.throws(() => svc.upsertRule(1, { intervalMinutes: 1 }), RangeError);
    svc.upsertRule(1, { enabled: true, intervalMinutes: 60, autoPublish: true });
    const rule = svc.getRule(1);
    assert.equal(rule?.enabled, 1);
    assert.equal(rule?.auto_publish, 1);
    assert.ok(rule?.next_run_at);
  } finally {
    svc.close();
    safeRm(dir);
  }
});

test('automation: runNow записывает success; ошибка не валит сервис', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'auto-'));
  const svc = make(dir, () => new Date('2026-10-23T10:00:00Z'), async (id) => {
    if (id === 2) throw new Error('rss down');
    return { postId: 7, message: 'published' };
  });
  try {
    svc.upsertRule(1, { enabled: true });
    svc.upsertRule(2, { enabled: true });

    const ok = await svc.runNow(1);
    assert.equal(ok.status, 'success');
    assert.equal(ok.postId, 7);

    const err = await svc.runNow(2);
    assert.equal(err.status, 'error');
    assert.match(err.message, /rss down/);

    const runs = svc.listRuns();
    assert.equal(runs.length, 2);
    assert.equal(new Set(runs.map((r) => r.status)).size, 2);
  } finally {
    svc.close();
    safeRm(dir);
  }
});

test('automation: runDue запускает только наступившие правила', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'auto-'));
  let now = new Date('2026-10-23T10:00:00Z');
  const svc = make(dir, () => now, async (id) => ({ postId: null, message: `ran ${id}` }));
  try {
    svc.upsertRule(1, { enabled: true, intervalMinutes: 60 });
    svc.upsertRule(2, { enabled: true, intervalMinutes: 60 });

    // next_run_at = now (last_run null) → оба due
    const results = await svc.runDue();
    assert.equal(results.length, 2);

    // сразу повторно — next_run_at в будущем → ничего
    const second = await svc.runDue();
    assert.equal(second.length, 0);

    // сдвинуть время за интервал → снова due
    now = new Date(now.getTime() + 61 * 60_000);
    const third = await svc.runDue();
    assert.equal(third.length, 2);
  } finally {
    svc.close();
    safeRm(dir);
  }
});

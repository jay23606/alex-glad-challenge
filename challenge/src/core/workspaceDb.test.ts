import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { WorkspaceDb } from './workspaceDb.js';

test('workspace: проект → папка → элемент, каскадное удаление', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'workspace-'));
  try {
    const db = new WorkspaceDb(path.join(dir, 'workspace.sqlite'));
    const projectId = db.createProject({ name: 'Продукт', color: '#8B7CFF' });
    const folderId = db.createFolder(projectId, 'Блог');
    const itemId = db.createItem({ projectId, folderId, kind: 'task', title: 'Написать пост', dueAt: '2026-11-01T10:00:00Z' });

    assert.ok(db.getProject(projectId));
    assert.equal(db.getFolder(folderId)?.project_id, projectId);
    const item = db.getItem(itemId);
    assert.equal(item?.folder_id, folderId);
    assert.equal(item?.done, 0);

    assert.equal(db.listItems({ projectId }).length, 1);
    assert.equal(db.listItems({ projectId, includeDone: true, kind: 'task' }).length, 1);

    assert.ok(db.setItemDone(itemId, true));
    assert.equal(db.getItem(itemId)?.done, 1);
    assert.equal(db.listItems({ projectId }).length, 0); // done скрыт по умолчанию

    db.deleteProject(projectId);
    assert.equal(db.getProject(projectId), null);
    assert.equal(db.getFolder(folderId), null);
    assert.equal(db.getItem(itemId), null);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('workspace: валидация границ', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'workspace-'));
  try {
    const db = new WorkspaceDb(path.join(dir, 'workspace.sqlite'));
    assert.throws(() => db.createProject({ name: '  ' }), RangeError);
    assert.throws(() => db.createFolder(999, 'x'), RangeError);
    assert.throws(
      () => db.createItem({ projectId: 1, title: 'x', url: 'ftp://x' }),
      RangeError,
    );
    assert.throws(
      () => db.createItem({ projectId: 1, title: 'x', dueAt: 'not-a-date' }),
      RangeError,
    );
    const projectId = db.createProject({ name: 'A' });
    const other = db.createProject({ name: 'B' });
    const folderId = db.createFolder(projectId, 'F');
    assert.throws(() => db.createFolder(other, 'F2', folderId), RangeError);
    assert.throws(() => db.createItem({ projectId: other, folderId, title: 'x' }), RangeError);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('workspace: upcoming-окно отбирает только открытые задачи с дедлайном', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'workspace-'));
  try {
    const db = new WorkspaceDb(path.join(dir, 'workspace.sqlite'));
    const projectId = db.createProject({ name: 'P' });
    db.createItem({ projectId, kind: 'task', title: 'в окне', dueAt: '2026-11-10T09:00:00Z' });
    db.createItem({ projectId, kind: 'task', title: 'вне окна', dueAt: '2027-01-01T00:00:00Z' });
    const doneId = db.createItem({ projectId, kind: 'task', title: 'сделано', dueAt: '2026-11-11T00:00:00Z' });
    db.setItemDone(doneId, true);

    const upcoming = db.listUpcoming('2026-11-01T00:00:00Z', '2026-11-30T00:00:00Z');
    assert.deepEqual(upcoming.map((r) => r.title), ['в окне']);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

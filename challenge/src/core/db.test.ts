import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BlogDb, DEFAULT_BLOG_SLUG } from './db.js';

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

function tmpDb(): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'blogdb-'));
  return { dir, file: path.join(dir, 'blog.sqlite') };
}

test('db: свежий seed — блог «Факты» получает preset antonov, остальные default', () => {
  const { dir, file } = tmpDb();
  const db = new BlogDb(file);
  try {
    const fakty = db.getBlogBySlug(DEFAULT_BLOG_SLUG);
    assert.equal(fakty?.style_preset, 'antonov');
    assert.equal(db.getStylePreset(fakty!.id), 'antonov');
    const others = db.listBlogs().filter((b) => b.slug !== DEFAULT_BLOG_SLUG);
    assert.ok(others.length > 0);
    for (const b of others) assert.equal(b.style_preset, 'default');
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('db: updateBlog меняет style_preset, повторное открытие его не перетирает', () => {
  const { dir, file } = tmpDb();
  let db = new BlogDb(file);
  try {
    const blog = db.getBlogBySlug(DEFAULT_BLOG_SLUG)!;
    db.updateBlog(blog.id, { style_preset: 'default' });
    assert.equal(db.getBlogBySlug(DEFAULT_BLOG_SLUG)?.style_preset, 'default');
    db.updateBlog(blog.id, { style_preset: 'antonov' });
    assert.equal(db.getStylePreset(blog.id), 'antonov');
  } finally {
    db.close();
  }
  db = new BlogDb(file);
  try {
    assert.equal(db.getBlogBySlug(DEFAULT_BLOG_SLUG)?.style_preset, 'antonov');
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('db: миграция легаси-базы — ALTER blogs + antonov блогу «Факты», идемпотентно', () => {
  const { dir, file } = tmpDb();
  // Легаси-схема: blogs без style_preset, с одним блогом «Факты».
  const legacy = new DatabaseSync(file);
  legacy.exec(`
    CREATE TABLE blogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      profile TEXT,
      tg_chat_id TEXT,
      sources TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  legacy
    .prepare('INSERT INTO blogs (slug, name, profile, tg_chat_id, sources) VALUES (?, ?, ?, ?, ?)')
    .run(DEFAULT_BLOG_SLUG, 'Иди на факты глянь', 'default', null, null);
  legacy.close();

  let db = new BlogDb(file);
  try {
    const blog = db.getBlogBySlug(DEFAULT_BLOG_SLUG);
    assert.equal(blog?.style_preset, 'antonov');
    // Выбор пользователя важнее миграции: сбрасываем и переоткрываем.
    db.updateBlog(blog!.id, { style_preset: 'default' });
  } finally {
    db.close();
  }
  db = new BlogDb(file);
  try {
    assert.equal(db.getBlogBySlug(DEFAULT_BLOG_SLUG)?.style_preset, 'default');
  } finally {
    db.close();
    safeRm(dir);
  }
});

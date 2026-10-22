// Unit: миграция мульти-блога в BlogDb — реальный node:sqlite во временной папке.
// 1) Свежая БД: seed трёх блогов (lookatfacts = блог по умолчанию).
// 2) Легаси-БД (старая схема без blogs/blog_id): ALTER + бэкфилл существующих
//    строк в блог по умолчанию, повторное открытие идемпотентно.
// 3) Фильтры news/posts/style_samples по blogId; NULL-blogId = легаси «все».
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BlogDb, DEFAULT_BLOG_SLUG } from '@challenge/core/db';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'multiblog-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Легаси-схема (до мульти-блога): без таблицы blogs и без колонок blog_id.
function createLegacyDb(file: string): void {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      published_at TEXT NOT NULL,
      source TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      news_id INTEGER,
      content TEXT NOT NULL,
      verdict TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (news_id) REFERENCES news(id)
    );
    CREATE TABLE style_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(
    'INSERT INTO news (url, title, summary, published_at, source) VALUES (?, ?, ?, ?, ?)',
  ).run('https://example.com/a', 'Заголовок A', 'Текст A', '2026-09-30T00:00:00.000Z', 'example.com');
  db.prepare('INSERT INTO posts (news_id, content, verdict) VALUES (?, ?, ?)').run(1, 'Пост A', null);
  db.prepare('INSERT INTO style_samples (text) VALUES (?)').run('Образец A');
  db.close();
}

describe('BlogDb: мульти-блог', () => {
  it('свежая БД: сид трёх блогов, lookatfacts — по умолчанию', () => {
    const db = new BlogDb(path.join(dir, 'fresh.sqlite'));
    try {
      const blogs = db.listBlogs();
      expect(blogs.map((b) => b.slug)).toEqual(['lookatfacts', 'artemia-artel', 'nevsky-hram']);
      expect(blogs.map((b) => b.name)).toEqual([
        'Иди на факты глянь',
        'Артемия Артель',
        'Невский храм на Доваторцев',
      ]);
      const def = db.getBlogBySlug(DEFAULT_BLOG_SLUG);
      expect(def).not.toBeNull();
      expect(def?.profile).toBe('default');
      // Два новых блога — без голоса/источников (заполняются позже, PATCH /api/blogs).
      expect(db.getBlogBySlug('artemia-artel')?.profile).toBeNull();
      expect(db.getBlogBySlug('nevsky-hram')?.sources).toBeNull();
    } finally {
      db.close();
    }
  });

  it('легаси-БД: ALTER + бэкфилл в блог по умолчанию, повторное открытие не дублирует', () => {
    const file = path.join(dir, 'legacy.sqlite');
    createLegacyDb(file);

    const db = new BlogDb(file);
    try {
      expect(db.listBlogs()).toHaveLength(3);
      const defId = db.getBlogBySlug(DEFAULT_BLOG_SLUG)?.id ?? 0;
      expect(defId).toBeGreaterThan(0);
      // Существующий контент приписан блогу по умолчанию.
      expect(db.newsSince('2020-01-01')[0].blog_id).toBe(defId);
      expect(db.recentPosts(10)[0].blog_id).toBe(defId);
      expect(db.styleSamples(10)[0].blog_id).toBe(defId);
    } finally {
      db.close();
    }

    // Повторное открытие: сид не дублируется, бэкфилл не перетирает новые NULL.
    const db2 = new BlogDb(file);
    try {
      expect(db2.listBlogs()).toHaveLength(3);
      const hramId = db2.getBlogBySlug('nevsky-hram')?.id ?? 0;
      db2.insertPost('Легаси-пост без блога', null, null); // blog_id NULL
      // created_at имеет точность до секунды — ищем пост по содержимому.
      const legacy = db2.recentPosts(10).find((p) => p.content === 'Легаси-пост без блога');
      expect(legacy?.blog_id).toBeNull();
      // Фильтр по блогу не возвращает легаси-строку.
      expect(db2.recentPosts(10, hramId)).toHaveLength(0);
    } finally {
      db2.close();
    }
  });

  it('фильтры news/posts/style_samples по blogId; insertNews дедуп по URL глобальный', () => {
    const db = new BlogDb(path.join(dir, 'filters.sqlite'));
    try {
      const a = db.getBlogBySlug('artemia-artel')?.id ?? 0;
      const h = db.getBlogBySlug('nevsky-hram')?.id ?? 0;

      const iso = '2026-09-30T00:00:00.000Z';
      expect(db.insertNews(
        { url: 'https://a.example/1', title: 'A1', summary: 'a', published_at: iso, source: 'a.example' },
        a,
      )).toBe(true);
      expect(db.insertNews(
        { url: 'https://h.example/1', title: 'H1', summary: 'h', published_at: iso, source: 'h.example' },
        h,
      )).toBe(true);
      // Тот же URL в другой блог — глобальный UNIQUE режет (сознательное ограничение).
      expect(db.insertNews(
        { url: 'https://a.example/1', title: 'dup', summary: 'x', published_at: iso, source: 'a.example' },
        h,
      )).toBe(false);

      expect(db.unusedNewsSince('2026-01-01', a).map((n) => n.title)).toEqual(['A1']);
      expect(db.unusedNewsSince('2026-01-01', h).map((n) => n.title)).toEqual(['H1']);
      expect(db.unusedNewsSince('2026-01-01')).toHaveLength(2);

      db.insertPost('Пост A', null, null, a);
      db.insertPost('Пост H', null, null, h);
      expect(db.recentPosts(10, a).map((p) => p.content)).toEqual(['Пост A']);
      expect(db.recentPosts(10)).toHaveLength(2);

      db.addStyleSample('Голос A', a);
      db.addStyleSample('Голос H', h);
      expect(db.styleSamples(10, a).map((s) => s.text)).toEqual(['Голос A']);
      expect(db.styleSamples(10, h).map((s) => s.text)).toEqual(['Голос H']);
    } finally {
      db.close();
    }
  });

  it('updateBlog правит имя/профиль/tg_chat_id/sources; getBlog/getBlogBySlug', () => {
    const db = new BlogDb(path.join(dir, 'update.sqlite'));
    try {
      const hram = db.getBlogBySlug('nevsky-hram');
      expect(hram).not.toBeNull();
      db.updateBlog(hram!.id, {
        profile: 'nevsky-hram-voice',
        tg_chat_id: '-100999',
        sources: JSON.stringify(['https://t.me/s/nevsky']),
      });
      const after = db.getBlog(hram!.id);
      expect(after?.profile).toBe('nevsky-hram-voice');
      expect(after?.tg_chat_id).toBe('-100999');
      expect(JSON.parse(after?.sources ?? '[]')).toEqual(['https://t.me/s/nevsky']);
      expect(db.getBlog(9999)).toBeNull();
      expect(db.getBlogBySlug('nope')).toBeNull();
    } finally {
      db.close();
    }
  });
});

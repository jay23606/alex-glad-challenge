// Серверные хелперы мульти-блога: резолв блога по slug/undefined, загрузка
// профиля голоса блога, разбор источников. Единственное место, знающее правила
// «undefined = блог по умолчанию» и «профиль обязателен для генерации».
import 'server-only';
import {
  DEFAULT_BLOG_SLUG,
  ProfileManager,
  dataPath,
  type BlogRow,
} from './challenge';
import { getBlogDb } from './db';

export interface BlogResolution {
  blog: BlogRow | null;
  error?: string;
}

// blogRef = slug (или числовой id как строка). undefined → блог по умолчанию
// («Иди на факты глянь»); null → легаси-режим без блога (для вызовов без блога).
export function resolveBlog(blogRef?: string | null): BlogResolution {
  const db = getBlogDb();
  if (blogRef == null || blogRef === '') {
    return { blog: db.getBlogBySlug(DEFAULT_BLOG_SLUG) };
  }
  const byId = Number(blogRef);
  const blog = Number.isInteger(byId) && byId > 0 ? db.getBlog(byId) : db.getBlogBySlug(blogRef);
  if (!blog) return { blog: null, error: `Блог «${blogRef}» не найден` };
  return { blog };
}

// Профиль голоса блога: null = не настроен (генерация для такого блога запрещена,
// иначе писатель молча взял бы дефолтный футбольный профиль).
export function loadBlogProfile(blog: BlogRow): ProfileManager | null {
  if (!blog.profile) return null;
  const mgr = new ProfileManager(dataPath('profiles'));
  if (!mgr.load(blog.profile)) return null;
  return mgr;
}

export function blogProfileMissing(blog: BlogRow): string {
  return blog.profile
    ? `Профиль голоса «${blog.profile}» для блога «${blog.name}» не найден — создайте его в /chat (/profile)`
    : `У блога «${blog.name}» не настроен профиль голоса — задайте его через /api/blogs/${blog.slug}`;
}

// blogs.sources — JSON-массив URL RSS; null/битый = [] (пайплайн возьмёт дефолт).
export function blogSources(blog: BlogRow): string[] {
  if (!blog.sources) return [];
  try {
    const parsed = JSON.parse(blog.sources) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(String).filter((u) => /^https?:\/\//.test(u));
  } catch {
    return [];
  }
}

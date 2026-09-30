// Pipeline: связывает rss → агент 1 → агент 2 → агент 3.
// Запускается из CLI командой `news`.
// Профиль пользователя (день 12) прокидывается в PostWriter; мульти-блог:
// opts.blog задаёт источники RSS (blogs.sources) и штамп blog_id на новостях,
// постах и few-shot образцах. Без opts.blog — легаси-режим (дефолтные фиды,
// без штампа) для REPL/CLI-демо.

import { BlogDb, type BlogRow } from '../db.js';
import { LlmClient } from '../index.js';
import type { ProfileManager } from '../profile.js';
import { fetchAllFeedsDetailed, filterRecent, toNewsRow, feedsFromUrls } from './rss.js';
import { NewsFetcher, type NewsFetchResult } from './newsFetcher.js';
import { PostWriter, type WrittenPost } from './postWriter.js';
import { FactChecker, type FactCheckResult } from './factChecker.js';

export interface PipelineResult {
  news: NewsFetchResult;
  post: WrittenPost | null;
  factCheck: FactCheckResult | null;
  /** Ошибки RSS-фидов (для честного UI: «новостей нет, потому что фиды недоступны»). */
  rssErrors: string[];
}

// blogs.sources — JSON-массив URL; null/битый JSON = дефолтные фиды rss.ts.
function blogFeeds(blog: BlogRow): Array<{ source: string; url: string }> | null {
  if (!blog.sources) return null;
  try {
    const parsed = JSON.parse(blog.sources) as unknown;
    if (!Array.isArray(parsed)) return null;
    const urls = parsed.map(String).filter((u) => /^https?:\/\//.test(u));
    return urls.length > 0 ? feedsFromUrls(urls) : null;
  } catch {
    return null;
  }
}

export async function runNewsPipeline(
  db: BlogDb,
  client: LlmClient,
  opts: {
    maxAgeHours?: number;
    topK?: number;
    writeForIndex?: number;
    profile?: ProfileManager;
    blog?: BlogRow;
    signal?: AbortSignal;
  } = {},
): Promise<PipelineResult> {
  const maxAgeHours = opts.maxAgeHours ?? 24;
  const topK = opts.topK ?? 5;
  const blog = opts.blog ?? null;
  const profileActive = opts.profile?.active ?? null;

  // 0. Залить свежие RSS в БД (дубликаты по URL отсекаются UNIQUE-индексом).
  const { items: fresh, errors: rssErrors } = await fetchAllFeedsDetailed(
    blog ? (blogFeeds(blog) ?? undefined) : undefined,
  );
  if (rssErrors.length > 0) {
    console.warn(`[pipeline] RSS: ошибки фидов — ${rssErrors.join('; ')}`);
  }
  const items = filterRecent(fresh, maxAgeHours);
  let added = 0;
  for (const item of items) {
    if (db.insertNews(toNewsRow(item), blog?.id)) added++;
  }
  console.log(
    `[pipeline] RSS${blog ? ` [${blog.slug}]` : ''}: получено ${items.length}, новых в БД ${added}`,
  );

  // Профиль для диагностики.
  if (opts.profile?.activeName) {
    console.log(`[pipeline] Профиль: ${opts.profile.activeName} (${profileActive?.тематика ?? '—'})`);
  }

  // 1. Агент 1 — выбрать топ новостей (только этого блога, приоритет = тематика).
  opts.signal?.throwIfAborted();
  const fetcher = new NewsFetcher(client);
  const news = await fetcher.fetch(db, {
    maxAgeHours,
    topK,
    blogId: blog?.id,
    focus: profileActive?.тематика,
  });
  console.log(`[pipeline] Агент 1: кандидатов ${news.rawCount}, выбрано ${news.ranked.length}`);
  if (news.ranked.length === 0) {
    return { news, post: null, factCheck: null, rssErrors };
  }

  // По умолчанию — пишем пост про самую хайповую новость.
  const idx = Math.min(opts.writeForIndex ?? 0, news.ranked.length - 1);
  const chosen = news.ranked[idx].news;
  console.log(`[pipeline] Готовим пост про: "${chosen.title}"`);

  // 2. Агент 2 — написать пост (с профилем, если есть).
  opts.signal?.throwIfAborted();
  const writer = new PostWriter(client, opts.profile);
  const post = await writer.write(db, chosen, { blogId: blog?.id });
  console.log(`[pipeline] Агент 2: пост написан (${post.content.length} символов)`);

  // 3. Агент 3 — фактчекинг.
  opts.signal?.throwIfAborted();
  const checker = new FactChecker(client, {
    channel: profileActive?.канал,
    topic: profileActive?.тематика,
  });
  const factCheck = await checker.check(post.content, chosen);
  console.log(`[pipeline] Агент 3: verdict=${factCheck.verdict}, issues=${factCheck.issues.length}`);

  // Сохранить пост + вердикт, пометить новость использованной.
  db.insertPost(post.content, chosen.id, JSON.stringify(factCheck), blog?.id);
  db.markUsed(chosen.id);

  return { news, post, factCheck, rssErrors };
}

// Загрузка и парсинг RSS-лент футбольных источников.
// Возвращает плоский массив свежих новостей (за последние N часов).

import { XMLParser } from 'fast-xml-parser';

import type { NewsRow } from '../db.js';
import { clean } from '../sanitize.js';
import { netFetch } from '../net.js';

export interface RssItem {
  title: string;
  link: string;
  pubDate: string;       // как в ленте, парсится в Date
  contentSnippet: string;
  source: string;
}

const FEEDS: Array<{ source: string; url: string }> = [
  // Championat.com — футбол (Россия)
  { source: 'championat.com', url: 'https://www.championat.com/rss/news/football/' },
  // Sky Sports — football news (Англия)
  { source: 'skysports.com', url: 'https://www.skysports.com/rss/11095' },
  // Sky Sports — Premier League
  { source: 'skysports.com (EPL)', url: 'https://www.skysports.com/rss/12040' },
];

// Источники блога хранятся как JSON-массив URL (blogs.sources); имя источника —
// hostname без www (в БД оно только для показа).
export function feedsFromUrls(urls: string[]): Array<{ source: string; url: string }> {
  return urls.map((url) => {
    let host = url;
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      // невалидный URL оставляем как есть — фетч честно вернёт ошибку фида
    }
    return { source: host, url };
  });
}

// Нормализовать нестандартные сокращения часовых поясов (BST, EST, ...)
// в числовое смещение, чтобы Date.parse понимал.
function normalizeTz(s: string): string {
  const tzMap: Record<string, string> = {
    BST: '+01:00',  // British Summer Time
    GMT: '+00:00',
    EST: '-05:00',
    EDT: '-04:00',
    PST: '-08:00',
    PDT: '-07:00',
    CET: '+01:00',
    CEST: '+02:00',
    MSK: '+03:00',
  };
  return s.replace(/([A-Z]{2,5})\s*$/, (match, tz) => tzMap[tz] ?? match);
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

function snippetFrom(item: Record<string, unknown>): string {
  const raw =
    (item['description'] as string) ??
    (item['content:encoded'] as string) ??
    (item['summary'] as string) ??
    '';
  // Выкинуть HTML-теги, ужать до 400 символов.
  const text = String(raw).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return text.length > 400 ? text.slice(0, 397) + '...' : text;
}

// Один фид: бросает при сетевой/HTTP/парсинг-ошибке — collect на уровне
// fetchAllFeedsDetailed (чтобы scout/news могли честно показать «RSS недоступен»).
async function fetchFeed(feed: { source: string; url: string }): Promise<RssItem[]> {
  const resp = await netFetch(feed.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; llm-challenge-bot/0.1)' },
    timeoutMs: 10_000,
    label: `RSS ${feed.source}`,
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const xml = await resp.text();
  const parsed = xmlParser.parse(xml) as {
    rss?: { channel?: { item?: Record<string, unknown>[] } };
    feed?: { entry?: Record<string, unknown>[] };
  };

  const items = parsed.rss?.channel?.item ?? parsed.feed?.entry ?? [];
  return items.map((it) => ({
    title: String(it['title'] ?? '').trim(),
    link: String(it['link'] ?? it['@_link'] ?? '').trim(),
    pubDate: String(it['pubDate'] ?? it['published'] ?? it['updated'] ?? '').trim(),
    contentSnippet: snippetFrom(it),
    source: feed.source,
  }));
}

export async function fetchAllFeedsDetailed(
  feeds: Array<{ source: string; url: string }> = FEEDS,
): Promise<{ items: RssItem[]; errors: string[] }> {
  const settled = await Promise.all(
    feeds.map(async (feed) => {
      try {
        return { items: await fetchFeed(feed), error: null as string | null };
      } catch (err) {
        // fetchFeed уже ловит сам; страховка на случай изменений внутри.
        return { items: [] as RssItem[], error: `${feed.source}: ${(err as Error).message}` };
      }
    }),
  );
  return {
    items: settled.flatMap((s) => s.items),
    errors: settled.map((s) => s.error).filter((e): e is string => e !== null),
  };
}

export async function fetchAllFeeds(
  feeds: Array<{ source: string; url: string }> = FEEDS,
): Promise<RssItem[]> {
  return (await fetchAllFeedsDetailed(feeds)).items;
}

// Отфильтровать по давности (по умолчанию — последние 24 часа).
export function filterRecent(items: RssItem[], maxAgeHours = 24): RssItem[] {
  const cutoff = Date.now() - maxAgeHours * 3600_000;
  return items
    .filter((it) => {
      const t = Date.parse(normalizeTz(it.pubDate));
      return Number.isFinite(t) && t >= cutoff;
    })
    .sort((a, b) => Date.parse(normalizeTz(b.pubDate)) - Date.parse(normalizeTz(a.pubDate)));
}

// Конвертация RssItem в формат строки БД.
export function toNewsRow(
  item: RssItem,
): Omit<NewsRow, 'id' | 'used' | 'created_at' | 'blog_id'> {
  const published = new Date(Date.parse(normalizeTz(item.pubDate))).toISOString();
  return {
    url: item.link,
    title: clean(item.title),
    summary: clean(item.contentSnippet),
    published_at: published,
    source: item.source,
  };
}

// Агент 1. Сбор топа новостей из БД.
// Берёт свежие неиспользованные новости за последние N часов,
// через LLM выбирает 3-5 самых хайповых и релевантных Челси,
// и возвращает их с коротким резюме почему каждая важна.

import type { BlogDb, NewsRow } from '../db.js';
import { LlmClient, msg } from '../index.js';

export interface RankedNews {
  news: NewsRow;
  why: string;       // почему эта новость хайповая
  score: number;     // 0..10 по версии LLM
}

export interface NewsFetchResult {
  ranked: RankedNews[];
  rawCount: number;
}

export class NewsFetcher {
  constructor(private client: LlmClient) {}

  async fetch(
    db: BlogDb,
    opts: { maxAgeHours?: number; topK?: number; blogId?: number | null; focus?: string } = {},
  ): Promise<NewsFetchResult> {
    const maxAgeHours = opts.maxAgeHours ?? 24;
    const topK = opts.topK ?? 5;

    const since = new Date(Date.now() - maxAgeHours * 3600_000).toISOString();
    const candidates = db.unusedNewsSince(since, opts.blogId);

    if (candidates.length === 0) {
      return { ranked: [], rawCount: 0 };
    }

    // Если кандидатов <= topK — отдаём как есть, без LLM-фильтрации.
    if (candidates.length <= topK) {
      return {
        ranked: candidates.map((news) => ({ news, why: 'мало кандидатов — взяли все', score: 5 })),
        rawCount: candidates.length,
      };
    }

    const payload = candidates.slice(0, 15).map((n, i) => ({
      i,
      title: n.title,
      summary: n.summary.slice(0, 200),
      source: n.source,
      published_at: n.published_at,
    }));

    const priority = opts.focus ?? 'Челси, АПЛ, топ-игроки, ЧМ, трансферы';
    const prompt = `Из списка новостей ниже выбери топ-${topK} самых важных для аудитории канала (приоритет: ${priority}).

Новости:
${JSON.stringify(payload, null, 2)}

ОТВЕТ: строго JSON-массив, никаких рассуждений. ПЕРВЫЙ СИМВОЛ ОТВЕТА — "[".
[
  {"i": 0, "score": 9, "why": "5 слов"},
  {"i": 4, "score": 8, "why": "5 слов"}
]
"i" — индекс из списка (0-${payload.length - 1}). "score" — 0..10. "why" — КРАТКО, максимум 5 слов, без воды.
Не больше ${topK} объектов. Не пиши ничего до или после JSON.`;

    const raw = await this.client.chat(
      [msg.user(prompt)],
      { temperature: 0.2, maxTokens: 2000 },
    );

    const picks = parsePicks(raw);
    if (picks.length === 0) {
      console.error('[NewsFetcher] LLM не вернул валидный JSON. Первые 300 символов ответа:');
      console.error(raw.slice(0, 300));
    }
    const byIndex = new Map(candidates.map((n, i) => [i, n]));
    const ranked: RankedNews[] = picks
      .map((p) => {
        const news = byIndex.get(p.i);
        if (!news) return null;
        return { news, why: p.why ?? '—', score: p.score ?? 0 };
      })
      .filter((x): x is RankedNews => x !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return { ranked, rawCount: candidates.length };
  }
}

interface Pick {
  i: number;
  score?: number;
  why?: string;
}

function parsePicks(raw: string): Pick[] {
  // Снять markdown-обёртку ```json ... ``` если есть.
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('[');
  if (start === -1) return [];
  // Найти последнюю ']' — даже если JSON обрезан, мытащим валидные элементы.
  let end = cleaned.lastIndexOf(']');
  // Если нет закрывающей скобки вообще — попробовать закрыть вручную.
  let candidate: string;
  if (end === -1 || end <= start) {
    // Обрезанный JSON — пытаемся выделить полные объекты.
    candidate = extractCompleteObjects(cleaned.slice(start));
  } else {
    candidate = cleaned.slice(start, end + 1);
  }
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
      .map((x) => ({
        i: Number(x['i']),
        score: typeof x['score'] === 'number' ? (x['score'] as number) : undefined,
        why: typeof x['why'] === 'string' ? (x['why'] as string) : undefined,
      }))
      .filter((p) => Number.isFinite(p.i));
  } catch {
    return [];
  }
}

// Если JSON-массив обрезан посередине объекта, пытаемся оставить только целые.
function extractCompleteObjects(s: string): string {
  const objects: string[] = [];
  let depth = 0;
  let startIdx = -1;
  let inStr = false;
  let prev = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === '"' && prev !== '\\') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === '{') { if (depth === 0) startIdx = i; depth++; }
      else if (ch === '}') {
        depth--;
        if (depth === 0 && startIdx !== -1) {
          objects.push(s.slice(startIdx, i + 1));
          startIdx = -1;
        }
      }
    }
    prev = ch;
  }
  return '[' + objects.join(',') + ']';
}

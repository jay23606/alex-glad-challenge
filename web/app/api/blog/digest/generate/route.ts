// Route Handler: POST /api/blog/digest/generate — черновик еженедельного дайджеста
// одним LLM-вызовом (админ-фича «Дайджест одним кликом»). Отправки в TG здесь НЕТ —
// публикация только вручную через существующий /api/telegram/publish. Путь:
//   requireAuth (второй слой; middleware гейтит — путь НЕ в PUBLIC_PATHS) → zod
//   digestGenerateSchema (days 1..30, дефолт 7) → withDb(newsSince) [read-only:
//   по published_at, включая used; пул pipeline-новостей не расходуется] →
//   409 при пустом окне (LLM не вызывается) → LLM ВНЕ withDb-мьютекса (cloud-first,
//   фолбэк local — прецедент /api/demo/rag) → clamp ≤4096 (лимит TG, обрезка по
//   границе строки) → 200 {ok, digest, newsCount, sources, truncated}.
// Новости — tainted (RSS): clean() до промпта; URL — только http(s) (server-гард
// до промпта, параллель safeHref в клиенте); в промпт идут только
// title/summary(≤200)/url/published_at из БД; sources — из БД-выборки, не из ответа
// LLM (grounded by design). Ошибки LLM/сети → 502 safeMessage. server-only.
import 'server-only';
import { NextRequest } from 'next/server';

import { digestGenerateSchema } from '../../../../../lib/shared/forms';
import { requireAuth } from '../../../../../lib/auth';
import { getBlogDb, withDb } from '../../../../../lib/server/db';
import { pickLlmClient } from '../../../../../lib/server/llm';
import { getKeysStatus } from '../../../../../lib/server/env';
import { resolveBlog, loadBlogProfile } from '../../../../../lib/server/blogs';
import { safeMessage } from '../../../../../lib/server/safe-message';
import { clean, msg } from '../../../../../lib/server/challenge';
import type { ChatMessage } from '../../../../../lib/server/challenge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_DAYS = 7;
const MAX_NEWS = 60;           // cap свежайших — промпт не разрастается с ростом базы
const FIELD_MAX = 200;         // title/summary одной новости в промпте
const DIGEST_MAX_CHARS = 4096; // жёсткий лимит TG-сообщения
const PROMPT_TARGET_CHARS = 3500; // буфер под лимит TG (clamp — страховка)

// Голос дайджеста — от блога: имя канала + тематика профиля голоса (если настроен).
function digestSystem(channel: string, topic: string): string {
  return [
    `Ты — редактор телеграм-канала «${channel}»${topic ? ` (${topic})` : ''}. Собираешь дайджест недели.`,
    'Жёсткие правила:',
    '1. Использовать ТОЛЬКО факты из списка новостей: не добавлять факты, которых нет в списке.',
    '2. Каждый пункт завершается точным URL из списка — других ссылок нет.',
    '3. Plain text, без HTML/Markdown-разметки.',
    `4. Формат: заголовок + 5-7 пунктов вида «заголовок — 1-2 предложения — URL». Объём ≤${PROMPT_TARGET_CHARS} символов.`,
    '5. Последняя строка: «Подборка по новостям недели — полные разборы в канале».',
  ].join('\n');
}

interface DigestNewsItem {
  title: string;
  summary: string;
  url: string;
  published_at: string;
}

function digestMessages(news: DigestNewsItem[], channel: string, topic: string): ChatMessage[] {
  const payload = JSON.stringify(news, null, 2);
  return [
    msg.system(digestSystem(channel, topic)),
    msg.user(`Собери дайджест недели ТОЛЬКО по новостям из списка.\n\nНовости:\n${payload}`),
  ];
}

// Обрезка по границе строки + '…'; итог гарантированно ≤4096 (UI-счётчик и zod
// tgPublishSchema — вторая и третья линии защиты перед отправкой).
function clampDigest(raw: string): { text: string; truncated: boolean } {
  const trimmed = raw.trim();
  if (trimmed.length <= DIGEST_MAX_CHARS) return { text: trimmed, truncated: false };
  const cut = trimmed.slice(0, DIGEST_MAX_CHARS);
  const nl = cut.lastIndexOf('\n');
  const base = (nl > 0 ? cut.slice(0, nl) : cut).trimEnd().slice(0, DIGEST_MAX_CHARS - 2);
  return { text: `${base} …`, truncated: true };
}

export async function POST(req: NextRequest): Promise<Response> {
  // Второй auth-слой: генерация жжёт токены владельца — ошибка в middleware-matcher
  // не должна открывать бесплатный LLM-endpoint.
  const denied = requireAuth(req);
  if (denied) return denied;

  const parsed = digestGenerateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const days = parsed.data.days ?? DEFAULT_DAYS;

  // Мульти-блог: blog задан → новости и голос этого блога; не задан → легаси
  // (все новости, голос «Иди на факты глянь») — старые вызовы не ломаются.
  let blogId: number | null | undefined;
  let channel = 'Иди на факты глянь';
  let topic = 'футбол: Челси, АПЛ';
  if (parsed.data.blog) {
    const res = resolveBlog(parsed.data.blog);
    if (!res.blog) {
      return Response.json({ ok: false, error: res.error ?? 'blog not found' }, { status: 400 });
    }
    blogId = res.blog.id;
    channel = res.blog.name;
    const profile = loadBlogProfile(res.blog);
    if (profile?.active?.тематика) topic = profile.active.тематика;
  }

  // Чтение окна — короткий sync-read внутри withDb; LLM-вызов ниже — вне мьютекса,
  // чтобы не блокировать админ-операции на время генерации.
  const since = new Date(Date.now() - days * 24 * 3600_000).toISOString();
  const rows = await withDb(() => getBlogDb().newsSince(since, blogId));
  // RSS tainted: URL валидируем на сервере (параллель safeHref() в DigestComposer,
  // но на границе — до промпта), чтобы sources/newsCount и текст дайджеста
  // описывали одну выборку. Не-http(s) (javascript:/data:/битое) — дроп строки;
  // всё дропнулось → обычный 409 пустого окна, LLM не вызывается.
  const safeRows = rows.filter((r) => {
    try {
      const u = new URL(r.url);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  });
  if (safeRows.length === 0) {
    return Response.json(
      {
        ok: false,
        error: `За ${days} дней новостей нет — расширьте окно`,
        errorKind: 'empty-window',
      },
      { status: 409 },
    );
  }

  // RSS-контент tainted → clean() до промпта; ORDER BY published_at DESC —
  // slice берёт свежайшие.
  const news: DigestNewsItem[] = safeRows.slice(0, MAX_NEWS).map((n) => ({
    title: clean(n.title, FIELD_MAX),
    summary: clean(n.summary, FIELD_MAX),
    url: n.url,
    published_at: n.published_at,
  }));

  // Провайдера фиксирует сервер: cloud → фолбэк local; ни один не настроен → 502.
  const keys = getKeysStatus();
  try {
    const client = pickLlmClient(keys.cloud.configured ? 'cloud' : 'local');
    const raw = await client.chat(digestMessages(news, channel, topic), {
      temperature: 0.4,
      maxTokens: 1500,
    });
    const trimmed = raw.trim();
    if (!trimmed) throw new Error('LLM вернул пустой дайджест');
    const { text, truncated } = clampDigest(trimmed);
    const sources = news.map(({ title, url }) => ({ title, url }));
    return Response.json({ ok: true, digest: text, newsCount: sources.length, sources, truncated });
  } catch (e) {
    return Response.json(
      { ok: false, error: safeMessage(e instanceof Error ? e.message : 'digest generation failed') },
      { status: 502 },
    );
  }
}

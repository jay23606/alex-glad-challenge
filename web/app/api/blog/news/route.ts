// SSE Route Handler: блог-pipeline news (RSS → агент 1 → агент 2 → агент 3 → пост).
// День 28, web P4a. runtime=nodejs, force-dynamic. Логика server-only: все импорты core/
// идут через web/lib/server/* chokepoint (client bundle физически не получает core/).
//
// runNewsPipeline не имеет onProgress-колбэка, поэтому SSE отдаёт только start → done/error
// (задача P4a допускает). По завершении пост уже в blog.sqlite (insertPost внутри pipeline).
// Контракт событий (web/lib/shared/sse.ts):
//   {type:'stage',  step:'start'}                                   — старт pipeline
//   {type:'done',   post, topNews, verdict}                         — финал (post может быть null)
//   {type:'error',  message}                                        — обобщённое сообщение БЕЗ URL/ключа/пути
import 'server-only';
import { NextRequest } from 'next/server';

import { newsOptsSchema } from '../../../../lib/shared/forms';
import type { SseBlogNewsEvent } from '../../../../lib/shared/sse';
import { pickLlmClient } from '../../../../lib/server/llm';
import { getBlogDb, withDb } from '../../../../lib/server/db';
import { resolveBlog, loadBlogProfile, blogProfileMissing, blogSources } from '../../../../lib/server/blogs';
import {
  runNewsPipeline,
  ProfileManager,
  dataPath,
  type BlogRow,
} from '../../../../lib/server/challenge';
import { safeMessage } from '../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = newsOptsSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: parsed.error.issues[0]?.message ?? 'invalid request' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const { hours, top, forIndex, llm = 'cloud', blog: blogRef } = parsed.data;
  const client = pickLlmClient(llm);

  // Мульти-блог: blog задан → источники/профиль/штамп этого блога; не задан →
  // легаси-режим (дефолтные фиды, профиль default|первый) для старых вызовов.
  let blog: BlogRow | null = null;
  if (blogRef) {
    const res = resolveBlog(blogRef);
    if (!res.blog) {
      return new Response(JSON.stringify({ error: res.error ?? 'blog not found' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    blog = res.blog;
  }
  const blogProfile = blog ? loadBlogProfile(blog) : null;
  if (blog && !blogProfile) {
    return new Response(JSON.stringify({ error: blogProfileMissing(blog) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  // Блог без своих источников не должен молча получить дефолтные футбольные фиды.
  if (blog && blogSources(blog).length === 0) {
    return new Response(
      JSON.stringify({ error: `У блога «${blog.name}» не настроены RSS-источники — задайте их через PATCH /api/blogs/${blog.slug}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: SseBlogNewsEvent): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      try {
        send({ type: 'stage', step: 'start' });

        // Профиль: блог → его профиль голоса; легаси — зеркало cli runNewsCommand
        // (default | первый | создать default).
        const profile =
          blogProfile ??
          (() => {
            const mgr = new ProfileManager(dataPath('profiles'));
            const names = mgr.list();
            if (names.length > 0) {
              mgr.load(names.includes('default') ? 'default' : names[0]);
            } else {
              mgr.create('default');
            }
            return mgr;
          })();

        // withDb удерживает mutex на весь pipeline (sync DatabaseSync-вызовы + LLM).
        // Для 1-юзер локально приемлемо (R4, план §6) — то же, что в /api/rag/query.
        // id вставленного поста — через recentPosts(1) внутри той же блокировки (гонки нет).
        const { result, postId } = await withDb(async () => {
          const r = await runNewsPipeline(getBlogDb(), client, {
            maxAgeHours: hours,
            topK: top,
            writeForIndex: forIndex,
            profile,
            ...(blog ? { blog } : {}),
            signal: req.signal,
          });
          let pid: number | null = null;
          if (r.post) {
            const last = getBlogDb().recentPosts(1, blog?.id)[0];
            if (last) pid = last.id;
          }
          return { result: r, postId: pid };
        });

        send({
          type: 'done',
          post: result.post ? { id: postId ?? 0, content: result.post.content } : null,
          topNews: result.news.ranked.map((r) => ({
            title: r.news.title,
            score: r.score,
            why: r.why,
          })),
          verdict: result.factCheck?.verdict ?? null,
          // Поста нет и RSS фиды ответили ошибкой → честное объяснение вместо тишины.
          ...(result.post === null && result.rssErrors.length > 0
            ? { notice: `RSS-источники недоступны: ${result.rssErrors.join('; ')}` }
            : {}),
        });
      } catch (e) {
        const message = e instanceof Error ? safeMessage(e.message) : 'internal error';
        send({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

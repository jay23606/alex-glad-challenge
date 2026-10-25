// POST /api/blogs/[slug]/posts — ручной/праздничный пост по теме.
// {topic, comment?, variants?:1..3, publishNow?} → TopicPostWriter (без RSS),
// до 3 разных вариантов сохраняются черновиками (posts.topic/variant); при
// publishNow первый вариант уходит в Telegram-канал блога через единый
// publishToTelegram (outbox). requireApiAuth — cookie или mobile Bearer.
// server-only, внешний текст очищается clean() до промпта и БД.
import 'server-only';
import { NextRequest } from 'next/server';

import { requireApiAuth } from '../../../../../lib/auth';
import { blogTopicPostSchema } from '../../../../../lib/shared/forms';
import { clean, ProfileManager, TopicPostWriter, dataPath } from '../../../../../lib/server/challenge';
import { getBlogDb, withDb } from '../../../../../lib/server/db';
import { jsonError, jsonOk } from '../../../../../lib/server/http';
import { pickLlmClient } from '../../../../../lib/server/llm';
import { safeMessage } from '../../../../../lib/server/safe-message';
import { publishToTelegram } from '../../../../../lib/server/tg-publish';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MANUAL_VERDICT = JSON.stringify({
  verdict: 'ok',
  issues: [],
  reasoning: 'ручной пост по теме',
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;

  const { slug } = await params;
  const parsed = blogTopicPostSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? 'invalid request', 400);
  }
  const input = parsed.data;
  const topic = clean(input.topic, 500);
  const comment = input.comment ? clean(input.comment, 1000) : '';

  const prepared = await withDb(() => {
    const db = getBlogDb();
    const blog = db.getBlogBySlug(slug);
    if (!blog) return null;
    const recent = db
      .recentPosts(3, blog.id)
      .map((p) => p.content.replace(/\s+/g, ' ').trim().slice(0, 220));
    return { blog, recent };
  });
  if (!prepared) return jsonError('not found', 404);

  const { blog, recent } = prepared;
  let profile: ProfileManager | undefined;
  if (blog.profile) {
    const mgr = new ProfileManager(dataPath('profiles'));
    if (mgr.load(blog.profile)) profile = mgr;
  }

  let variants;
  try {
    const writer = new TopicPostWriter(pickLlmClient('cloud'));
    variants = await writer.writeMany(getBlogDb(), blog, {
      topic,
      comment,
      count: input.variants ?? 1,
      profile,
      recent,
    });
  } catch (e) {
    return jsonError(
      safeMessage(e instanceof Error ? e.message : 'generation failed'),
      502,
    );
  }
  if (variants.length === 0) return jsonError('Пост не сгенерирован', 502);

  const ids = await withDb(() => {
    const db = getBlogDb();
    return variants.map((v) =>
      db.insertPost(v.content, null, MANUAL_VERDICT, blog.id, topic, v.variant),
    );
  });

  const published = input.publishNow
    ? await publishToTelegram(
        variants[0].content,
        'blog',
        ids[0],
        'HTML',
        blog.tg_chat_id ?? undefined,
      )
    : null;

  return jsonOk(
    {
      posts: variants.map((v, i) => ({
        id: ids[i],
        variant: v.variant,
        angle: v.angle,
        content: v.content,
      })),
      published,
    },
    201,
  );
}

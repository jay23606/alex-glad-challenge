// /api/blogs/[slug] — настройка блога. GET → полный конфиг (промпты, источники,
// профиль). PATCH {name?, profile?, tgChatId?, stylePreset?, systemPrompt?,
// contextPrompt?, sources?} → updateBlog. requireApiAuth — второй auth-слой
// (cookie-сессия ИЛИ мобильный Bearer-токен: патчит конфиг блога, в т.ч. с
// мобильного клиента). profile — имя существующего профиля голоса (/chat) или
// null (сброс); sources — массив http(s)-URL, [] → null (дефолтные фиды);
// stylePreset — 'default' | 'antonov' (core stylePreset.ts); systemPrompt/
// contextPrompt — per-blog промпты, ''/null очищают. server-only.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { blogPatchSchema } from '../../../../lib/shared/forms';
import { requireApiAuth } from '../../../../lib/auth';
import { ProfileManager, dataPath } from '../../../../lib/server/challenge';
import { getBlogDb, withDb } from '../../../../lib/server/db';
import { blogSources } from '../../../../lib/server/blogs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return value.trim() === '' ? null : value;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;

  const { slug } = await params;
  const data = await withDb(() => {
    const blog = getBlogDb().getBlogBySlug(slug);
    if (!blog) return null;
    const names = new ProfileManager(dataPath('profiles')).list();
    return {
      id: blog.id,
      slug: blog.slug,
      name: blog.name,
      profile: blog.profile,
      hasProfile: Boolean(blog.profile && names.includes(blog.profile)),
      tgChatId: blog.tg_chat_id,
      stylePreset: blog.style_preset,
      systemPrompt: blog.system_prompt,
      contextPrompt: blog.context_prompt,
      sources: blogSources(blog),
      createdAt: blog.created_at,
    };
  });
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ blog: data }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;

  const { slug } = await params;
  const parsed = blogPatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const patch = parsed.data;

  const updated = await withDb(() => {
    const db = getBlogDb();
    const blog = db.getBlogBySlug(slug);
    if (!blog) return null;

    if (patch.profile !== undefined && patch.profile !== null) {
      const names = new ProfileManager(dataPath('profiles')).list();
      if (!names.includes(patch.profile)) {
        return { error: `Профиль «${patch.profile}» не найден — создайте его в /chat` } as const;
      }
    }
    db.updateBlog(blog.id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.profile !== undefined ? { profile: patch.profile } : {}),
      ...(patch.tgChatId !== undefined ? { tg_chat_id: patch.tgChatId === '' ? null : patch.tgChatId } : {}),
      ...(patch.stylePreset !== undefined ? { style_preset: patch.stylePreset } : {}),
      ...(patch.sources !== undefined
        ? { sources: patch.sources.length > 0 ? JSON.stringify(patch.sources) : null }
        : {}),
      ...(patch.systemPrompt !== undefined
        ? { system_prompt: emptyToNull(patch.systemPrompt) }
        : {}),
      ...(patch.contextPrompt !== undefined
        ? { context_prompt: emptyToNull(patch.contextPrompt) }
        : {}),
    });
    return { blog: db.getBlogBySlug(slug) };
  });

  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if ('error' in updated && updated.error) {
    return NextResponse.json({ error: updated.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, blog: updated.blog });
}

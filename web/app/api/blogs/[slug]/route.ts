// /api/blogs/[slug] — настройка блога. PATCH {name?, profile?, tgChatId?,
// stylePreset?, sources?} → updateBlog. requireApiAuth — второй auth-слой
// (cookie-сессия ИЛИ мобильный Bearer-токен: патчит конфиг блога, в т.ч. с
// мобильного клиента). profile — имя существующего профиля голоса (/chat) или
// null (сброс); sources — массив http(s)-URL, [] → null (дефолтные фиды);
// stylePreset — 'default' | 'antonov' (core stylePreset.ts). server-only.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { blogPatchSchema } from '../../../../lib/shared/forms';
import { requireApiAuth } from '../../../../lib/auth';
import { ProfileManager, dataPath } from '../../../../lib/server/challenge';
import { getBlogDb, withDb } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    });
    return { blog: db.getBlogBySlug(slug) };
  });

  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if ('error' in updated && updated.error) {
    return NextResponse.json({ error: updated.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, blog: updated.blog });
}

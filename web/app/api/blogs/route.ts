// /api/blogs — список блогов (мульти-блог). GET → blogs + производные флаги
// (hasProfile — профиль голоса задан и файл существует; sourcesCount; tgChatIdSet;
// stylePreset — пресет стиля из blogs.style_preset).
// server-only: core/ через chokepoint.
import 'server-only';
import { NextResponse } from 'next/server';

import { ProfileManager, dataPath } from '../../../lib/server/challenge';
import { getBlogDb, withDb } from '../../../lib/server/db';
import { blogSources } from '../../../lib/server/blogs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const blogs = await withDb(() => {
    const rows = getBlogDb().listBlogs();
    const names = new ProfileManager(dataPath('profiles')).list();
    return rows.map((b) => ({
      id: b.id,
      slug: b.slug,
      name: b.name,
      profile: b.profile,
      hasProfile: Boolean(b.profile && names.includes(b.profile)),
      sourcesCount: blogSources(b).length,
      tgChatIdSet: b.tg_chat_id !== null,
      stylePreset: b.style_preset,
      createdAt: b.created_at,
    }));
  });
  return NextResponse.json({ blogs });
}

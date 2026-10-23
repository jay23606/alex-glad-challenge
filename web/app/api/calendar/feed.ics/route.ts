// /api/calendar/feed.ics — экспорт событий в ICS (RFC 5545) для ручного импорта.
// Доступен по Bearer-токену мобильного клиента или cookie-сессии (требует auth,
// чтобы не палить приватный календарь).
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuth } from '../../../../lib/auth';
import { buildIcs } from '../../../../lib/server/challenge';
import { withDb } from '../../../../lib/server/db';
import { collectCalendarEvents } from '../../../../lib/server/calendar-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get('days') ?? '30') || 30));
  const ics = await withDb(() => buildIcs(collectCalendarEvents(days), 'Артель'));
  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="artel-${new Date().toISOString().slice(0, 10)}.ics"`,
      'Cache-Control': 'no-store',
    },
  });
}

// /api/calendar — события из задач и напоминаний (GET ?days=N).
import 'server-only';
import { NextRequest } from 'next/server';

import { requireApiAuth } from '../../../lib/auth';
import { jsonOk } from '../../../lib/server/http';
import { withDb } from '../../../lib/server/db';
import { getGoogleCalendarStatus } from '../../../lib/server/env';
import { collectCalendarEvents, calendarEventShape } from '../../../lib/server/calendar-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get('days') ?? '30') || 30));
  const events = await withDb(() => collectCalendarEvents(days).map(calendarEventShape));
  return jsonOk({ events, googleConfigured: getGoogleCalendarStatus().configured });
}

// /api/calendar/sync — пушит события в Google Calendar (если настроен OAuth).
// Без настроенного Google — 503 (не hard-fail); события остаются доступны через .ics.
import 'server-only';
import { NextRequest } from 'next/server';

import { requireApiAuth } from '../../../../lib/auth';
import { jsonOk, jsonError } from '../../../../lib/server/http';
import { withDb } from '../../../../lib/server/db';
import { GoogleCalendarClient, getGoogleCalendarConfig } from '../../../../lib/server/challenge';
import { collectCalendarEvents } from '../../../../lib/server/calendar-events';
import { safeMessage } from '../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const cfg = getGoogleCalendarConfig();
  if (!cfg) {
    return jsonError('Google Calendar не настроен (см. .env GOOGLE_CALENDAR_*)', 503);
  }
  const days = 30;
  try {
    const events = await withDb(() => collectCalendarEvents(days));
    const client = new GoogleCalendarClient({ config: cfg });
    let synced = 0;
    for (const event of events) {
      await client.insertEvent(event);
      synced += 1;
    }
    return jsonOk({ synced });
  } catch (e) {
    return jsonError(safeMessage(e instanceof Error ? e.message : 'sync failed'), 502);
  }
}

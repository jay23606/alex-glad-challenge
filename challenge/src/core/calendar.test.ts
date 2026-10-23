import test from 'node:test';
import assert from 'node:assert/strict';

import { buildIcs, deadlineEvent } from './calendar.js';
import { GoogleCalendarClient } from './googleCalendar.js';

test('calendar: buildIcs генерирует валидный каркас VCALENDAR', () => {
  const ics = buildIcs(
    [deadlineEvent({ uidPrefix: 'todo-1', title: 'Пост; с запятой', dueAt: '2026-11-01T10:00:00Z' })],
    'Артель',
  );
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /VERSION:2\.0/);
  assert.match(ics, /PRODID:-/);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /END:VEVENT/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.match(ics, /SUMMARY:Пост\\; с запятой/); // экранирование ;
  assert.match(ics, /DTSTART:20261101T100000Z/);
  assert.match(ics, /DTEND:20261101T103000Z/); // +30 мин
});

test('calendar: buildIcs экранирует перенос строки и бэкслеш', () => {
  const ics = buildIcs([
    {
      uid: 'x',
      title: 'a\\b',
      description: 'line1\nline2',
      start: '2026-11-01T10:00:00Z',
      end: null,
    },
  ]);
  assert.match(ics, /SUMMARY:a\\\\b/);
  assert.match(ics, /DESCRIPTION:line1\\nline2/);
});

test('calendar: deadlineEvent отклоняет невалидную дату через buildIcs', () => {
  assert.throws(
    () => buildIcs([{ uid: 'x', title: 't', description: '', start: 'not-a-date', end: null }]),
    RangeError,
  );
});

test('googleCalendar: обмен токена и insert без утечки секретов', async () => {
  const calls: string[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'tok-1' }), { status: 200 });
    }
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer tok-1');
    return new Response(JSON.stringify({ id: 'evt-1' }), { status: 200 });
  }) as typeof fetch;

  const client = new GoogleCalendarClient({
    config: {
      clientId: 'cid',
      clientSecret: 'csec',
      refreshToken: 'rtok',
      calendarId: 'primary',
    },
    fetchFn,
  });
  const id = await client.insertEvent({
    uid: 'a_b@c',
    title: 'Событие',
    description: '',
    start: '2026-11-01T10:00:00Z',
    end: '2026-11-01T10:30:00Z',
  });
  assert.equal(id, 'evt-1');
  assert.equal(calls.length, 2); // token + insert (токен кэшируется)
});

test('googleCalendar: ошибка обмена токена → понятная ошибка без значений', async () => {
  const fetchFn = (async () => new Response('{}', { status: 401 })) as typeof fetch;
  const client = new GoogleCalendarClient({
    config: { clientId: 'cid', clientSecret: 'csec', refreshToken: 'rtok', calendarId: 'primary' },
    fetchFn,
  });
  await assert.rejects(
    () => client.insertEvent({ uid: 'u', title: 't', description: '', start: '2026-11-01T10:00:00Z', end: null }),
    /google token exchange failed: HTTP 401/,
  );
});

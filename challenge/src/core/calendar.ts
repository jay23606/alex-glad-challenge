// Календарь: типизированные события и генератор ICS (RFC 5545, без внешних зависимостей).
// buildIcs — чистая функция: CRLF-строки, экранирование, UTC-время в формате
// YYYYMMDDTHHMMSSZ. События собираются адаптером (web) из todo/workspace/автоматизации.

export interface CalendarEvent {
  readonly uid: string;
  readonly title: string;
  readonly description: string;
  /** ISO-строка начала события. */
  readonly start: string;
  /** ISO-строка конца; null = событие без длительности (точечное). */
  readonly end: string | null;
  readonly location?: string | null;
  readonly href?: string | null;
}

function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n');
}

function icsUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new RangeError('event time must be a valid ISO date');
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

const fold = (line: string): string =>
  line.length <= 75 ? line : `${line.slice(0, 73)}\r\n ${line.slice(73)}`;

function vevent(event: CalendarEvent): string {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${icsText(event.uid)}`,
    `DTSTAMP:${icsUtc(new Date().toISOString())}`,
    `DTSTART:${icsUtc(event.start)}`,
  ];
  if (event.end) lines.push(`DTEND:${icsUtc(event.end)}`);
  lines.push(`SUMMARY:${icsText(event.title)}`);
  if (event.description) lines.push(`DESCRIPTION:${icsText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${icsText(event.location)}`);
  if (event.href) lines.push(`URL:${icsText(event.href)}`);
  lines.push('END:VEVENT');
  return lines.map(fold).join('\r\n');
}

export function buildIcs(events: ReadonlyArray<CalendarEvent>, name = 'Артель'): string {
  const body = events.map(vevent).join('\r\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Artel//RU',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsText(name)}`,
    body,
    'END:VCALENDAR',
  ]
    .filter((l) => l !== '')
    .join('\r\n')
    .concat('\r\n');
}

/** Дедлайн задачи/элемента как календарное событие (точечное, 30-минутный блок). */
export function deadlineEvent(input: {
  readonly uidPrefix: string;
  readonly title: string;
  readonly description?: string;
  readonly dueAt: string;
  readonly href?: string | null;
}): CalendarEvent {
  const start = new Date(input.dueAt);
  const end = new Date(start.getTime() + 30 * 60_000);
  return {
    uid: `${input.uidPrefix}@artel`,
    title: input.title,
    description: input.description ?? '',
    start: start.toISOString(),
    end: end.toISOString(),
    href: input.href ?? null,
  };
}

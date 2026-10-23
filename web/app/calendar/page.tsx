// /calendar — события из задач и напоминаний, экспорт .ics, синхронизация с Google.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { SectionHead } from '../components/ui/SectionHead';
import { EmptyState } from '../components/ui/EmptyState';

interface Event {
  uid: string;
  title: string;
  description: string;
  start: string;
  end: string | null;
  href: string | null;
  source: string;
}

export default function CalendarPage() {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [google, setGoogle] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/calendar?days=30');
    if (!r.ok) return;
    const data = (await r.json()) as { events: Event[]; googleConfigured: boolean };
    setEvents(data.events);
    setGoogle(data.googleConfigured);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = async () => {
    setSyncMsg(null);
    const r = await fetch('/api/calendar/sync', { method: 'POST' });
    const data = (await r.json()) as { ok?: boolean; synced?: number; error?: string };
    setSyncMsg(data.ok ? `Синхронизировано событий: ${data.synced}` : data.error ?? 'ошибка');
  };

  return (
    <div className="space-y-6">
      <SectionHead
        code="product · calendar"
        title="Календарь"
        description="Дедлайны задач проекта и напоминания. Экспорт в .ics или синхронизация с Google Calendar."
        actions={
          <>
            <a href="/api/calendar/feed.ics" className="text-sm text-accent hover:underline">скачать .ics</a>
            <Button variant="primary" onClick={sync} disabled={!google}>Синхронизировать</Button>
          </>
        }
      />
      {!google ? <p className="text-sm text-dim">Google Calendar не настроен — доступен экспорт .ics (GOOGLE_CALENDAR_* в .env).</p> : null}
      {syncMsg ? <p className="text-sm text-dim">{syncMsg}</p> : null}

      {events == null ? null : events.length === 0 ? (
        <EmptyState title="Событий нет" hint="Добавьте задаче проекта дедлайн — она появится здесь." />
      ) : (
        <Card label="Ближайшие события">
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.uid} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
                <div className="text-center text-xs text-dim">
                  <p className="text-lg font-semibold leading-none text-ink">{e.start.slice(8, 10)}</p>
                  <p>{e.start.slice(5, 7)}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{e.title}</p>
                  {e.description ? <p className="truncate text-xs text-dim">{e.description}</p> : null}
                </div>
                <span className="text-xs uppercase text-dim">{e.source}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

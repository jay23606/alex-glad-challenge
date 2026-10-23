// Колокольчик уведомлений (client): счётчик непрочитанных + дропдаун + «прочитать все».
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { IconBell } from './ui/icons';
import { useBrowserNotifications } from './browserNotify';

interface NotificationItem {
  id: number;
  type: string;
  title: string;
  body: string;
  href: string | null;
  read: boolean;
  createdAt: string;
}

export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const browserNotify = useBrowserNotifications();

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/notifications');
      if (!r.ok) return;
      const data = (await r.json()) as { unread: number; notifications: NotificationItem[] };
      setUnread(data.unread);
      setItems(data.notifications.slice(0, 8));
    } catch {
      // уведомления — вспомогательный UI, молча
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const markAll = useCallback(async () => {
    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markAllRead' }),
      });
      setUnread(0);
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={`Уведомления, непрочитанных: ${unread}`}
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-dim transition-colors duration-fast hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim"
      >
        <IconBell />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-10 z-dropdown w-80 rounded-xl border border-line bg-surface p-2 shadow-pop">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="font-sans text-xs font-semibold uppercase tracking-wider text-dim">Уведомления</span>
            {unread > 0 ? (
              <button type="button" onClick={markAll} className="text-xs text-accent hover:underline">
                прочитать все
              </button>
            ) : null}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-dim">Пока пусто</p>
            ) : (
              items.map((n) => (
                <div key={n.id} className={`rounded-md px-2 py-2 ${n.read ? 'opacity-60' : ''}`}>
                  <p className="text-sm font-medium text-ink">{n.title}</p>
                  <p className="line-clamp-2 text-xs text-dim">{n.body}</p>
                </div>
              ))
            )}
          </div>
          {browserNotify.supported ? (
            <div className="flex items-center justify-between border-t border-line px-2 py-1.5">
              <span className="text-xs text-dim">
                {browserNotify.permission === 'denied'
                  ? 'Браузерные уведомления запрещены в настройках браузера'
                  : 'Браузерные уведомления'}
              </span>
              {browserNotify.permission === 'denied' ? null : browserNotify.enabled &&
                browserNotify.permission === 'granted' ? (
                <button type="button" onClick={browserNotify.disable} className="text-xs text-accent hover:underline">
                  выключить
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void browserNotify.enable()}
                  className="text-xs text-accent hover:underline"
                >
                  включить
                </button>
              )}
            </div>
          ) : null}
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block rounded-md px-2 py-1.5 text-center text-xs text-accent hover:bg-surface-2"
          >
            все уведомления
          </Link>
        </div>
      ) : null}
    </div>
  );
}

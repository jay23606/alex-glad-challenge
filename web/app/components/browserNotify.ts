// Хук браузерных уведомлений (Notification API + poll /api/notifications).
// Без Web Push: работает только пока открыта вкладка. Состояние opt-in и
// маркер последнего показанного id — в localStorage. Молча деградирует, если
// Notification API нет или permission denied.
'use client';

import { useCallback, useEffect, useState } from 'react';

export type BrowserNotifyPermission = 'unsupported' | 'default' | 'granted' | 'denied';

const ENABLED_KEY = 'browserNotify:enabled';
const LAST_ID_KEY = 'browserNotify:lastId';
export const BROWSER_NOTIFY_INTERVAL_MS = 60_000;

interface UnreadNotification {
  id: number;
  title: string;
  body: string;
}

function isNotifySupported(): boolean {
  return typeof window !== 'undefined' && typeof window.Notification === 'function';
}

function currentPermission(): BrowserNotifyPermission {
  if (!isNotifySupported()) return 'unsupported';
  return Notification.permission;
}

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

function readLastId(): number | null {
  try {
    const raw = window.localStorage.getItem(LAST_ID_KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

function writeLastId(id: number): void {
  try {
    window.localStorage.setItem(LAST_ID_KEY, String(id));
  } catch {
    /* private mode — просто не запоминаем */
  }
}

function writeEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(ENABLED_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export interface BrowserNotifications {
  readonly supported: boolean;
  readonly permission: BrowserNotifyPermission;
  readonly enabled: boolean;
  readonly enable: () => Promise<void>;
  readonly disable: () => void;
}

export function useBrowserNotifications(intervalMs: number = BROWSER_NOTIFY_INTERVAL_MS): BrowserNotifications {
  const [supported] = useState(isNotifySupported);
  const [permission, setPermission] = useState<BrowserNotifyPermission>(currentPermission);
  const [enabled, setEnabled] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : readEnabled(),
  );

  const enable = useCallback(async () => {
    if (!isNotifySupported()) return;
    const p = await Notification.requestPermission();
    setPermission(p);
    if (p === 'granted') {
      setEnabled(true);
      writeEnabled(true);
    }
  }, []);

  const disable = useCallback(() => {
    setEnabled(false);
    writeEnabled(false);
  }, []);

  useEffect(() => {
    if (!enabled || permission !== 'granted') return;

    const poll = async (): Promise<void> => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      try {
        const r = await fetch('/api/notifications?unread=1');
        if (!r.ok) return;
        const data = (await r.json()) as { notifications?: UnreadNotification[] };
        const list = (data.notifications ?? []).slice().sort((a, b) => a.id - b.id);
        const lastId = readLastId();
        // Первый запуск: засеваем маркер текущим максимумом, чтобы не
        // показывать лавину старых непрочитанных.
        if (lastId === null) {
          writeLastId(list.length > 0 ? list[list.length - 1].id : 0);
          return;
        }
        const fresh = list.filter((n) => n.id > lastId);
        for (const n of fresh) {
          const notification = new Notification(n.title, { body: n.body });
          notification.onclick = () => window.focus();
        }
        if (fresh.length > 0) writeLastId(fresh[fresh.length - 1].id);
      } catch {
        // уведомления — вспомогательный UI, молча
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), intervalMs);
    return () => clearInterval(timer);
  }, [enabled, permission, intervalMs]);

  return { supported, permission, enabled, enable, disable };
}

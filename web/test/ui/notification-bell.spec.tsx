// @vitest-environment jsdom
// UI: футер NotificationBell (opt-in браузерных уведомлений) — чекбокс/тумблер
// «включить/выключить» вызывает Notification.requestPermission через хук
// useBrowserNotifications; при permission=denied — сообщение вместо тумблера;
// без Notification API футер не рендерится и компонент не падает.
// Сам хук (механика poll/Notification) покрыт browser-notify.spec.tsx.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NotificationBell } from '../../app/components/NotificationBell';

class MockNotification {
  static permission: 'default' | 'granted' | 'denied' = 'default';
  static requestPermission = vi.fn(async () => MockNotification.permission);
}

function jsonResponseUnreadEmpty(): Response {
  return { ok: true, json: async () => ({ unread: 0, notifications: [] }) } as Response;
}

async function openDropdown(): Promise<void> {
  // Колокольчик: aria-label с числом непрочитанных.
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Уведомления, непрочитанных: 0' }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  MockNotification.permission = 'default';
  MockNotification.requestPermission.mockClear();
  vi.stubGlobal('Notification', MockNotification);
  // mount-эффект грузит /api/notifications — в этих тестах unread пуст.
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponseUnreadEmpty()));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('NotificationBell: футер opt-in браузерных уведомлений', () => {
  it('«включить» вызывает Notification.requestPermission; granted → тумблер «выключить» + localStorage', async () => {
    render(<NotificationBell />);
    await openDropdown();

    // permission=default: футер с тумблером, запрос ещё не отправлен.
    expect(screen.getByText('Браузерные уведомления')).toBeInTheDocument();
    expect(MockNotification.requestPermission).not.toHaveBeenCalled();

    // Пользователь принимает системный промпт (как в browser-notify.spec).
    MockNotification.permission = 'granted';
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'включить' }));
    });
    expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1);
    // granted: opt-in сохранён, тумблер перевернулся.
    expect(window.localStorage.getItem('browserNotify:enabled')).toBe('1');
    expect(screen.getByRole('button', { name: 'выключить' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'включить' })).toBeNull();
  });

  it('permission=denied — сообщение о запрете вместо тумблера', async () => {
    MockNotification.permission = 'denied';
    render(<NotificationBell />);
    await openDropdown();

    expect(
      screen.getByText('Браузерные уведомления запрещены в настройках браузера'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'включить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'выключить' })).toBeNull();
  });

  it('без Notification API футер не рендерится, рендер не падает', async () => {
    vi.stubGlobal('Notification', undefined);
    render(<NotificationBell />);
    await openDropdown();

    // Колокольчик и дропдаун живы, блока браузерных уведомлений нет.
    expect(screen.getByRole('button', { name: 'Уведомления, непрочитанных: 0' })).toBeInTheDocument();
    expect(screen.getByText('Пока пусто')).toBeInTheDocument();
    expect(screen.queryByText('Браузерные уведомления')).toBeNull();
    expect(screen.queryByRole('button', { name: 'включить' })).toBeNull();
  });

  it('enabled+granted — сразу «выключить»; клик снимает opt-in (localStorage=0, обратно «включить»)', async () => {
    window.localStorage.setItem('browserNotify:enabled', '1');
    MockNotification.permission = 'granted';
    render(<NotificationBell />);
    await openDropdown();

    expect(screen.queryByRole('button', { name: 'включить' })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'выключить' }));
    });
    expect(window.localStorage.getItem('browserNotify:enabled')).toBe('0');
    expect(screen.getByRole('button', { name: 'включить' })).toBeInTheDocument();
  });
});

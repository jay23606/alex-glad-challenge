// @vitest-environment jsdom
// Hook: useBrowserNotifications — opt-in через Notification.requestPermission,
// poll /api/notifications?unread=1 по интервалу (только visible-вкладка),
// new Notification для свежих unread, маркер lastId в localStorage.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useBrowserNotifications } from '../../app/components/browserNotify';

class MockNotification {
  static permission: 'default' | 'granted' | 'denied' = 'default';
  static instances: MockNotification[] = [];
  static requestPermission = vi.fn(async () => MockNotification.permission);

  onclick: (() => void) | null = null;

  constructor(
    readonly title: string,
    readonly options?: { body?: string },
  ) {
    MockNotification.instances.push(this);
  }
}

function Host({ intervalMs = 1000 }: { intervalMs?: number }) {
  const bn = useBrowserNotifications(intervalMs);
  return (
    <div>
      <output data-testid="state">{`${bn.supported}:${bn.permission}:${bn.enabled}`}</output>
      <button type="button" onClick={() => void bn.enable()}>
        enable
      </button>
      <button type="button" onClick={bn.disable}>
        disable
      </button>
    </div>
  );
}

function jsonResponse(notifications: Array<{ id: number; title: string; body: string }>) {
  return {
    ok: true,
    json: async () => ({ unread: notifications.length, notifications }),
  } as Response;
}

async function flush(): Promise<void> {
  await act(async () => {});
}

beforeEach(() => {
  window.localStorage.clear();
  MockNotification.permission = 'default';
  MockNotification.instances = [];
  MockNotification.requestPermission.mockClear();
  vi.stubGlobal('Notification', MockNotification);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useBrowserNotifications', () => {
  it('первый poll только засевает lastId, не показывая старые уведомления', async () => {
    window.localStorage.setItem('browserNotify:enabled', '1');
    MockNotification.permission = 'granted';
    const fetchMock = vi.fn(async () =>
      jsonResponse([{ id: 5, title: 'Старое', body: 'уже было' }]),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<Host />);
    await flush();

    expect(fetchMock).toHaveBeenCalledWith('/api/notifications?unread=1');
    expect(MockNotification.instances).toHaveLength(0);
    expect(window.localStorage.getItem('browserNotify:lastId')).toBe('5');
  });

  it('новые unread (id > lastId) показываются через Notification, клик фокусит окно', async () => {
    window.localStorage.setItem('browserNotify:enabled', '1');
    window.localStorage.setItem('browserNotify:lastId', '5');
    MockNotification.permission = 'granted';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse([
          { id: 6, title: 'Пост опубликован', body: 'message_id=42' },
          { id: 4, title: 'Старое', body: 'пропустить' },
        ]),
      ),
    );
    const focusMock = vi.fn();
    window.focus = focusMock;

    render(<Host />);
    await flush();

    expect(MockNotification.instances).toHaveLength(1);
    const shown = MockNotification.instances[0];
    expect(shown.title).toBe('Пост опубликован');
    expect(shown.options?.body).toBe('message_id=42');
    expect(window.localStorage.getItem('browserNotify:lastId')).toBe('6');

    shown.onclick?.();
    expect(focusMock).toHaveBeenCalledTimes(1);
  });

  it('poll идёт по интервалу, но пропускается на скрытой вкладке', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem('browserNotify:enabled', '1');
    window.localStorage.setItem('browserNotify:lastId', '5');
    MockNotification.permission = 'granted';
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    render(<Host intervalMs={1000} />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue('visible');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('opt-in off — poll /api/notifications не отправляется вовсе; enabled=true + granted — отправляется', async () => {
    vi.useFakeTimers();
    MockNotification.permission = 'granted';
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    // Opt-in off: флага browserNotify:enabled нет в localStorage → useEffect
    // выходит рано: ни первого poll на монтировании, ни setInterval-тика.
    const { unmount } = render(<Host intervalMs={1000} />);
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();

    // enabled=true + granted: первый poll отправляется сразу при монтировании.
    window.localStorage.setItem('browserNotify:enabled', '1');
    render(<Host intervalMs={1000} />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('enable: granted → enabled + localStorage, denied → остаётся выключенным', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])));
    MockNotification.permission = 'granted';
    const { unmount } = render(<Host />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'enable' }));
    });
    expect(screen.getByTestId('state')).toHaveTextContent('true:granted:true');
    expect(window.localStorage.getItem('browserNotify:enabled')).toBe('1');
    unmount();

    window.localStorage.clear();
    MockNotification.permission = 'denied';
    render(<Host />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'enable' }));
    });
    expect(screen.getByTestId('state')).toHaveTextContent('true:denied:false');
    expect(window.localStorage.getItem('browserNotify:enabled')).toBeNull();
  });

  it('graceful degradation без Notification API: supported=false, enable — no-op', async () => {
    vi.stubGlobal('Notification', undefined);
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    render(<Host />);
    expect(screen.getByTestId('state')).toHaveTextContent('false:unsupported:false');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'enable' }));
    });
    expect(MockNotification.requestPermission).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Хост, отдающий наружу сам promise enable(), чтобы проверить, что он
  // резолвится, а не отклоняется (кнопка в Host делает void bn.enable()).
  let enablePromise: Promise<void> | null = null;
  function EnableHost() {
    const bn = useBrowserNotifications();
    return (
      <div>
        <output data-testid="state">{`${bn.supported}:${bn.permission}:${bn.enabled}`}</output>
        <button
          type="button"
          onClick={() => {
            enablePromise = bn.enable();
          }}
        >
          enable
        </button>
      </div>
    );
  }

  function clickEnableAndAwait(): Promise<void> {
    fireEvent.click(screen.getByRole('button', { name: 'enable' }));
    const p = enablePromise;
    if (p == null) throw new Error('enable() не вызван');
    return p;
  }

  it.each([
    ['reject', () => Promise.reject(new Error('пользователь отклонил'))],
    ['синхронный throw', () => {
      throw new Error('сбой requestPermission');
    }],
  ])('requestPermission %s — enable() резолвится, тихая деградация', async (_case, impl) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    MockNotification.requestPermission.mockImplementationOnce(impl);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])));

    render(<EnableHost />);
    await expect(clickEnableAndAwait()).resolves.toBeUndefined();
    await flush();

    // permission остался default, уведомления не включились.
    expect(screen.getByTestId('state')).toHaveTextContent('true:default:false');
    expect(window.localStorage.getItem('browserNotify:enabled')).toBeNull();
    // Без unhandled rejection в консоли.
    expect(consoleError).not.toHaveBeenCalled();
  });
});

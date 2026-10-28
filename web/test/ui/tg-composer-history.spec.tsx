// @vitest-environment jsdom
// UI: строка истории публикаций TgComposer (регрессия #105). История хранит
// TG-HTML (composer публикует с parse_mode HTML), поэтому видимый текст строки
// обязан строиться через tgVisibleText: литеральные уголки («5 < 10 > 3»)
// остаются видимым текстом, разрешённая разметка снимается, пробелы схлопываются.
// Прямой tgHtmlToPlain вырезал бы «< 10 >» как «тег» — строка показала бы «5 3».
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TgComposer } from '../../app/telegram/publish/TgComposer';

function jsonResponse(status: number, body: unknown): Response {
  const ok = status >= 200 && status < 300;
  return { ok, status, json: async () => body } as Response;
}

// Запись outbox как её хранит БД (TG-HTML: разметка разрешена, литеральные
// уголки — часть текста, переносы строк — внутри абзацев).
const OUTBOX_ITEM = {
  id: 1,
  text: '<b>Сравнение</b>: 5 < 10 > 3\nи <code>код</code>',
  source: 'manual' as const,
  blog_post_id: null,
  message_id: 42,
  status: 'ok' as const,
  error: null,
  created_at: '2026-01-01 10:00',
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/telegram/history?limit=20') {
        return jsonResponse(200, { items: [OUTBOX_ITEM] });
      }
      return jsonResponse(404, { error: 'unexpected fetch in test' });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TgComposer: превью строки истории (#105)', () => {
  it('строка рендерится через tgVisibleText: уголки живы, разметка снята, пробелы схлопнуты', async () => {
    render(<TgComposer tgConfigured channelLabel="@test" />);
    await act(async () => {}); // mount-загрузка /api/telegram/history резолвится

    // Ожидалось из '<b>Сравнение</b>: 5 < 10 > 3\nи <code>код</code>'
    // после tgVisibleText + collapse. Регрессия #105 давала «Сравнение: 5 3 и код».
    expect(screen.getByText('Сравнение: 5 < 10 > 3 и код')).toBeTruthy();
  });

  it('пустой текст после снятия разметки → плейсхолдер «(пусто)»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/telegram/history?limit=20') {
          return jsonResponse(200, { items: [{ ...OUTBOX_ITEM, id: 2, text: '<b></b>' }] });
        }
        return jsonResponse(404, { error: 'unexpected fetch in test' });
      }),
    );

    render(<TgComposer tgConfigured channelLabel="@test" />);
    await act(async () => {});

    expect(screen.getByText('(пусто)')).toBeTruthy();
  });
});

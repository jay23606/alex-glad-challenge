// @vitest-environment jsdom
// UI: /integrations — все пять контролов форм имеют accessible name через
// канонический Field (label↔контрол по htmlFor/id): «Новая подписка» —
// название, URL, секрет; «Входящие webhooks» — название, target-select.
// Логика создания/удаления здесь не трогается: mount-загрузка GET-ов
// застаблена пустыми списками, submit не вызывается.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import IntegrationsPage from '../../app/integrations/page';

function jsonResponse(status: number, body: unknown): Response {
  const ok = status >= 200 && status < 300;
  return { ok, status, json: async () => body } as Response;
}

let fetchMock: Mock;

beforeEach(() => {
  // Mount-load страницы: GET обоих списков → пусто. Любой другой вызов —
  // 404 (тест не создаёт/не удаляет, лишние fetch — признак бага).
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/integrations/webhooks') return jsonResponse(200, { webhooks: [] });
    if (url === '/api/integrations/inbound') return jsonResponse(200, { hooks: [] });
    return jsonResponse(404, { error: 'unexpected fetch in test' });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('IntegrationsPage: accessible names контролов', () => {
  it('пять контролов доступны по label (Field связывает label↔контрол)', async () => {
    render(<IntegrationsPage />);
    await act(async () => {}); // mount-load резолвится

    // getByLabelText бросает и на «не найдено», и на «несколько» —
    // каждый ассерт заодно проверяет уникальность имени.
    expect(screen.getByLabelText('Название')).toBeTruthy();
    expect(screen.getByLabelText('URL')).toBeTruthy();
    expect(screen.getByLabelText('Секрет подписи (необязательно)')).toBeTruthy();
    expect(screen.getByLabelText('Название (например, CI)')).toBeTruthy();
    expect(screen.getByLabelText('Куда доставлять')).toBeTruthy();
  });

  it('контролы блочные на всю ширину (grid-раскладка не сжата)', async () => {
    render(<IntegrationsPage />);
    await act(async () => {});

    for (const label of ['Название', 'URL', 'Секрет подписи (необязательно)']) {
      const el = screen.getByLabelText(label) as HTMLInputElement;
      expect(el.className).toContain('block');
      expect(el.className).toContain('w-full');
    }
    const inboundName = screen.getByLabelText('Название (например, CI)') as HTMLInputElement;
    expect(inboundName.className).toContain('block w-full');
    const target = screen.getByLabelText('Куда доставлять') as HTMLSelectElement;
    expect(target.className).toContain('block w-full');
    expect((target as HTMLSelectElement).tagName).toBe('SELECT');
  });
});

// @vitest-environment jsdom
// UI: /support — форма «Обращение» (submit-логика SupportPage). Клиентская
// валидация есть: пустая/пробельная тема ИЛИ описание → статус «Заполните
// тему и описание» и fetch не вызывается. Валидная отправка POST-ит
// /api/support/tickets с trim-нутыми subject/body; пустой/пробельный contact
// не попадает в JSON (contact: undefined выпадает при JSON.stringify).
// Успех (ok:true в теле) → статус + очистка всех трёх полей; ошибка API → текст
// data.error, без error — фолбэк «ошибка».
// Моки повторяют реальный контракт роута /api/support/tickets (jsonOk/jsonError):
// успех — HTTP 201 + {ok:true,id}; ошибка — HTTP 400 + {error}. page.tsx смотрит
// только data.ok из тела, HTTP-статус не проверяет.
// #104: статус озвучивается скринридеру — успех отправки role="status", ошибки
// (API и валидация формы) role="alert"; in-flight guard — кнопка loading
// (disabled + aria-busy) в полёте, повторный submit (клик/Enter) не шлёт второй POST.
// FAQ-поиск страницы здесь не трогаем — это отдельная ветка fetch.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import SupportPage from '../../app/support/page';

type JsonInit = { method?: string; headers?: Record<string, string>; body?: string };

// status и body раздельно: страница читает data.ok из тела, а мок должен
// воспроизводить и HTTP-статус реального роута (201/400).
function jsonResponse(status: number, body: unknown): Response {
  const ok = status >= 200 && status < 300;
  return { ok, status, json: async () => body } as Response;
}

const SUBJECT_INPUT = 'Тема';
const BODY_INPUT = 'Опишите проблему';
const CONTACT_INPUT = 'Контакт (email/telegram, необязательно)';

async function fillAndSubmit(fields: { subject?: string; body?: string; contact?: string }): Promise<void> {
  await act(async () => {
    if (fields.subject !== undefined) {
      fireEvent.change(screen.getByPlaceholderText(SUBJECT_INPUT), { target: { value: fields.subject } });
    }
    if (fields.body !== undefined) {
      fireEvent.change(screen.getByPlaceholderText(BODY_INPUT), { target: { value: fields.body } });
    }
    if (fields.contact !== undefined) {
      fireEvent.change(screen.getByPlaceholderText(CONTACT_INPUT), { target: { value: fields.contact } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
  });
}

function inputByPlaceholder(placeholder: string): HTMLInputElement {
  return screen.getByPlaceholderText(placeholder) as HTMLInputElement;
}

let fetchMock: Mock;

beforeEach(() => {
  // У страницы нет mount-fetch; стаб на всякий случай — сетевые тесты не ходят в сеть.
  fetchMock = vi.fn(async () => jsonResponse(201, { ok: true, id: 1 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SupportPage: submit формы «Обращение»', () => {
  it('пустая форма → POST не уходит, статус «Заполните тему и описание»', async () => {
    render(<SupportPage />);
    await fillAndSubmit({});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('Заполните тему и описание')).toBeTruthy();
  });

  it('пробельная тема при заполненном описании → POST не уходит (валидация по trim)', async () => {
    render(<SupportPage />);
    await fillAndSubmit({ subject: '   ', body: 'Опишу проблему' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('Заполните тему и описание')).toBeTruthy();
  });

  it('валидная тема + пробельное описание → POST не уходит (проверка body.trim тоже действует)', async () => {
    render(<SupportPage />);
    await fillAndSubmit({ subject: 'Тема', body: '  \n\t ' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('Заполните тему и описание')).toBeTruthy();
  });

  it('валидная форма с контактом → POST с {subject, body, contact} после trim', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { ok: true, id: 7 }));
    render(<SupportPage />);
    await fillAndSubmit({ subject: '  Баг в отчёте  ', body: '\tШаги: открыть /support ', contact: '  @glad  ' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, JsonInit];
    expect(url).toBe('/api/support/tickets');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      subject: 'Баг в отчёте',
      body: 'Шаги: открыть /support',
      contact: '@glad',
    });
  });

  it('пустой contact не попадает в payload; пробельный contact — тоже', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { ok: true, id: 7 }));
    render(<SupportPage />);
    await fillAndSubmit({ subject: 'Тема', body: 'Описание', contact: '   ' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, JsonInit];
    const payload = JSON.parse(init.body as string) as Record<string, string>;
    expect(payload).toEqual({ subject: 'Тема', body: 'Описание' });
    expect(Object.hasOwn(payload, 'contact')).toBe(false);
  });

  it('успех (HTTP 201, {ok:true}) → статус-подтверждение и все три поля очищены', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { ok: true, id: 7 }));
    render(<SupportPage />);
    await fillAndSubmit({ subject: 'Тема', body: 'Описание', contact: 'me@example.com' });

    expect(screen.getByText('Обращение создано — ответим в ближайшее время.')).toBeTruthy();
    expect(inputByPlaceholder(SUBJECT_INPUT).value).toBe('');
    expect(inputByPlaceholder(BODY_INPUT).value).toBe('');
    expect(inputByPlaceholder(CONTACT_INPUT).value).toBe('');
  });

  it('ошибка API (HTTP 400, {error}) → показывается текст ошибки, поля не очищаются', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'База знаний недоступна' }));
    render(<SupportPage />);
    await fillAndSubmit({ subject: 'Тема', body: 'Описание', contact: 'me@example.com' });

    expect(screen.getByText('База знаний недоступна')).toBeTruthy();
    expect(inputByPlaceholder(SUBJECT_INPUT).value).toBe('Тема');
    expect(inputByPlaceholder(BODY_INPUT).value).toBe('Описание');
  });

  it('тело ошибки без error (HTTP 400, {}) — фолбэк-статус «ошибка»', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, {}));
    render(<SupportPage />);
    await fillAndSubmit({ subject: 'Тема', body: 'Описание' });

    expect(screen.getByText('ошибка')).toBeTruthy();
  });

  it('статус озвучивается: успех — role="status", ошибки (API и валидация) — role="alert"', async () => {
    render(<SupportPage />);
    await fillAndSubmit({ subject: 'Тема', body: 'Описание' });

    expect(screen.getByText('Обращение создано — ответим в ближайшее время.').getAttribute('role')).toBe('status');

    // После успеха поля очищены — заполняем заново; API-ошибка → role="alert".
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'База знаний недоступна' }));
    await fillAndSubmit({ subject: 'Тема', body: 'Описание' });
    expect(screen.getByText('База знаний недоступна').getAttribute('role')).toBe('alert');

    // Ошибка API поля не очищает; пробельная тема → валидация, тоже role="alert".
    await fillAndSubmit({ subject: '   ', body: 'Описание' });
    expect(screen.getByText('Заполните тему и описание').getAttribute('role')).toBe('alert');
  });

  it('in-flight guard: в полёте кнопка disabled (aria-busy), повторный submit не шлёт второй fetch; после ответа кнопка снова активна', async () => {
    // Deferred-промис: первый POST висит, пока тест сам не разрешит его.
    let resolveFetch!: (response: Response) => void;
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    );
    render(<SupportPage />);
    await fillAndSubmit({ subject: 'Тема', body: 'Описание' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const submitBtn = screen.getByRole('button', { name: 'Отправить' }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
    expect(submitBtn.getAttribute('aria-busy')).toBe('true');

    // Повторный клик по кнопке и submit формы (Enter в поле) — оба глотаются guard'ом.
    await act(async () => {
      fireEvent.click(submitBtn);
      fireEvent.submit(submitBtn.closest('form') as HTMLFormElement);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Отвечаем ошибкой API: guard обязан сброситься не только на success.
    await act(async () => { resolveFetch(jsonResponse(400, { error: 'База знаний недоступна' })); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(submitBtn.disabled).toBe(false);
    expect(submitBtn.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByText('База знаний недоступна')).toBeTruthy();
  });
});

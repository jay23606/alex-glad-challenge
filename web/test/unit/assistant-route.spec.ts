// Unit: Route Handler POST /api/assistant — ИИ-помощник с контекстом продукта.
// Границы замоканы: db, automation-service, llm (pickLlmClient) и chokepoint
// (buildAssistantMessages) — сам route не мокается. Доменный контракт: без LLM → 503.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

const mocks = vi.hoisted(() => ({
  pickLlmClient: vi.fn(),
  buildAssistantMessages: vi.fn(),
  chat: vi.fn(),
  award: vi.fn(),
  listRules: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getBlogDb: vi.fn(() => ({ listBlogs: vi.fn(() => []) })),
  getGamificationDb: vi.fn(() => ({
    getStats: vi.fn(() => ({ xp: 10, level: 1 })),
    award: mocks.award,
  })),
  getNotificationDb: vi.fn(() => ({ unreadCount: vi.fn(() => 2) })),
  getWorkspaceDb: vi.fn(() => ({
    listProjects: vi.fn(() => []),
    listItems: vi.fn(() => []),
    listUpcoming: vi.fn(() => []),
  })),
  getTodoDb: vi.fn(() => ({ getDueTodos: vi.fn(() => []) })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../../lib/server/automation-service', () => ({
  getAutomation: vi.fn(() => ({ listRules: mocks.listRules })),
}));

vi.mock('../../lib/server/llm', () => ({
  pickLlmClient: mocks.pickLlmClient,
}));

vi.mock('../../lib/server/challenge', () => ({
  buildAssistantMessages: mocks.buildAssistantMessages,
}));

let POST: (req: NextRequest) => Promise<Response>;
let createSessionValue: () => string;

beforeAll(async () => {
  ({ POST } = await import('../../app/api/assistant/route'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

beforeEach(() => {
  mocks.pickLlmClient.mockReset().mockReturnValue({ chat: mocks.chat });
  mocks.chat.mockReset().mockResolvedValue('  ответ ассистента  ');
  mocks.buildAssistantMessages
    .mockReset()
    .mockReturnValue([{ role: 'user', content: 'Вопрос?' }]);
  mocks.award.mockReset();
  mocks.listRules.mockReset().mockReturnValue([]);
});

function req(body: unknown, withAuth = true): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/assistant', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(withAuth ? { cookie: `admin_session=${createSessionValue()}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/assistant', () => {
  it('без сессии → 401, LLM не резолвится', async () => {
    const res = await POST(req({ message: 'Привет' }, false));
    expect(res.status).toBe(401);
    expect(mocks.pickLlmClient).not.toHaveBeenCalled();
  });

  it('400: пустой вопрос (zod), pickLlmClient не вызывается', async () => {
    const res = await POST(req({ message: '   ' }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Вопрос не может быть пустым' });
    expect(mocks.pickLlmClient).not.toHaveBeenCalled();
  });

  it('503: LLM не настроен (pickLlmClient бросает) — честное сообщение, не выдуманный ответ', async () => {
    mocks.pickLlmClient.mockImplementation(() => {
      throw new Error('DEEPSEEK_API_KEY не задан');
    });
    const res = await POST(req({ message: 'Что по задачам?' }));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: 'LLM не настроен — задайте DEEPSEEK_API_KEY или локальную модель',
    });
    expect(mocks.chat).not.toHaveBeenCalled();
    expect(mocks.award).not.toHaveBeenCalled();
  });

  it('200: answer trim’нутый; snapshot собран из db; award("assistant_used") начислен', async () => {
    const res = await POST(req({ message: 'Что по задачам?' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, answer: 'ответ ассистента' });

    expect(mocks.buildAssistantMessages).toHaveBeenCalledTimes(1);
    const [snapshot, question] = mocks.buildAssistantMessages.mock.calls[0] as unknown as [
      { xp: number; level: number; unreadNotifications: number; dueTasks: number },
      string,
    ];
    expect(question).toBe('Что по задачам?');
    expect(snapshot).toMatchObject({ xp: 10, level: 1, unreadNotifications: 2 });

    expect(mocks.chat).toHaveBeenCalledWith([{ role: 'user', content: 'Вопрос?' }], {
      temperature: 0.3,
      maxTokens: 800,
    });
    expect(mocks.award).toHaveBeenCalledWith('assistant_used');
  });

  it('502: ошибка LLM проходит через safeMessage (без URL/ключей), award не начисляется', async () => {
    mocks.chat.mockRejectedValue(
      new Error('upstream failed: https://api.deepseek.com/v1 key sk-1234567890abcdef'),
    );
    const res = await POST(req({ message: 'Вопрос' }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toMatch(/https?:\/\//);
    expect(body.error).not.toContain('sk-1234567890abcdef');
    expect(body.error).toContain('upstream failed');
    expect(mocks.award).not.toHaveBeenCalled();
  });
});

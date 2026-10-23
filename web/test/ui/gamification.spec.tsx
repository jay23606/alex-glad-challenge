// @vitest-environment jsdom
// UI: /gamification читает вложенный ответ GET /api/gamification — xp/level/
// прогресс приходят внутри `stats` (issue #79: плоский View + слепой каст
// давали пустой уровень и NaN%). Журнал очков показывает человеческие подписи
// игровых событий вместо сырых кодов (issue #59: tg_game_win/tg_game_play).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import GamificationPage from '../../app/gamification/page';

function jsonResponse(payload: unknown, ok = true): Response {
  return { ok, json: async () => payload } as Response;
}

// Данные из repro issue #79: 1705 XP → уровень 5, прогресс 0.1166 → 12%.
const NESTED_RESPONSE = {
  ok: true,
  stats: { xp: 1705, level: 5, levelProgress: 0.1166, nextLevelXp: 2500, streak: 2, bestStreak: 2 },
  achievements: [
    { code: 'first_post', title: 'Первый пост', description: 'Опубликуйте пост', unlocked: true, unlockedAt: '2026-10-01T00:00:00.000Z' },
    { code: 'level_5', title: 'Пятый уровень', description: 'Достигните 5 уровня', unlocked: true, unlockedAt: '2026-10-20T00:00:00.000Z' },
    { code: 'streak_3', title: 'Три дня подряд', description: 'Серия 3 дня', unlocked: true, unlockedAt: '2026-10-22T00:00:00.000Z' },
    { code: 'posts_10', title: 'Десять постов', description: '10 постов', unlocked: false, unlockedAt: null },
    { code: 'tasks_25', title: '25 задач', description: '25 задач', unlocked: false, unlockedAt: null },
    { code: 'automations_5', title: '5 прогонов', description: '5 прогонов автоматизации', unlocked: false, unlockedAt: null },
    { code: 'assistant_10', title: '10 обращений', description: '10 обращений к ассистенту', unlocked: false, unlockedAt: null },
    { code: 'support_1', title: 'Первый тикет', description: 'Обращение в поддержку', unlocked: false, unlockedAt: null },
  ],
  events: [
    { id: 3, type: 'tg_game_win', points: 15, createdAt: '2026-10-23T21:00:00.000Z' },
    { id: 2, type: 'tg_game_play', points: 2, createdAt: '2026-10-23T21:00:00.000Z' },
    { id: 1, type: 'post_published', points: 10, createdAt: '2026-10-22T10:00:00.000Z' },
  ],
};

// Несовпадение контракта: API всегда отдавал nested stats; плоский объект —
// «чужой» ответ, который старый слепой каст (as View) проглатывал молча.
const FLAT_MISMATCHED_RESPONSE = {
  ok: true,
  xp: 1705,
  level: 5,
  levelProgress: 0.1166,
  nextLevelXp: 2500,
  streak: 2,
  bestStreak: 2,
  achievements: NESTED_RESPONSE.achievements,
  events: NESTED_RESPONSE.events,
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(NESTED_RESPONSE)));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GamificationPage: вложенный ответ /api/gamification (issue #79)', () => {
  it('уровень/XP/серия рендерятся из stats: 1705 XP, 12%, 2 дня подряд', async () => {
    render(<GamificationPage />);

    // Строка прогресса: "1705 XP · до 2500 XP (12%)", 12% = Math.round(0.1166·100).
    expect(await screen.findByText(/1705 XP · до 2500 XP \(12%\)/)).not.toBeNull();
    expect(screen.getByText('5')).not.toBeNull(); // уровень
    expect(screen.getByText('3')).not.toBeNull(); // открытых достижений из 8
    expect(screen.getByText('2')).not.toBeNull(); // серия
    expect(screen.getByText('дней подряд')).not.toBeNull();
    expect(screen.getByText('рекорд: 2 дней')).not.toBeNull();
    expect(fetch).toHaveBeenCalledWith('/api/gamification');
  });

  it('журнал очков: подписи игровых событий вместо сырых кодов', async () => {
    render(<GamificationPage />);

    expect(await screen.findByText('XP за игру: победа')).not.toBeNull();
    expect(screen.getByText('XP за игру: участие')).not.toBeNull();
    expect(screen.getByText('Публикация поста')).not.toBeNull();
    // Сырые коды в UI не просачиваются.
    expect(document.body.textContent).not.toContain('tg_game_win');
    expect(document.body.textContent).not.toContain('tg_game_play');
  });

  it('ответ не по контракту (плоский объект) не рендерит цифры/NaN', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(FLAT_MISMATCHED_RESPONSE)));
    render(<GamificationPage />);

    // Дожидаемся полной цепочки fetch→json→safeParse→setData: без flush
    // промис-макротаски негативные ассерты могли бы сработать до рендера
    // и тест прошёл бы зря даже на старом коде со слепым кастом.
    await act(async () => {
      // Executor-форма: web tsconfig lib < ES2024 (Promise.withResolvers недоступен).
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    // Валидация отбросила мусор — страница осталась в состоянии загрузки.
    expect(screen.getByText('Геймификация')).not.toBeNull();
    expect(screen.queryByText(/XP · до/)).toBeNull();
    expect(document.body.textContent).not.toContain('1705');
    expect(document.body.textContent).not.toContain('NaN');
  });

  it('ошибка сети (r.ok=false) — страница не падает, остаётся на заголовке', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, false)));
    render(<GamificationPage />);

    // Тот же flush цепочки — ассерты только после её завершения.
    await act(async () => {
      // Executor-форма: web tsconfig lib < ES2024 (Promise.withResolvers недоступен).
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(screen.getByText('Геймификация')).not.toBeNull();
    expect(screen.queryByText(/XP · до/)).toBeNull();
  });
});

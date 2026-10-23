// @vitest-environment jsdom
// Система тем: ThemePalette (радиокарточки в /settings) и ThemeToggle (быстрый
// dark/light + меню палитры в Nav). Проверяем поведение: class на <html>,
// запись выбора в localStorage (ключ next-themes по умолчанию 'theme'),
// aria-состояния. Обёртка — наш ThemeProvider с дефолтами (как в layout).
// matchMedia-стаб из setup.ts отвечает false на prefers-color-scheme: dark,
// поэтому 'system' резолвится в 'light' — тесты на это опираются.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider } from '../../app/components/ThemeProvider';
import { ThemePalette } from '../../app/components/ThemePalette';
import { ThemeToggle } from '../../app/components/ThemeToggle';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = '';
});

afterEach(cleanup);

describe('ThemePalette', () => {
  it('выбор палитры применяет class на <html> и сохраняет выбор', () => {
    render(
      <ThemeProvider>
        <ThemePalette />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('radio', { name: /Неон/ }));

    expect(document.documentElement.classList.contains('neon')).toBe(true);
    expect(window.localStorage.getItem('theme')).toBe('neon');
    expect(screen.getByRole('radio', { name: /Неон/ })).toBeChecked();
  });

  it('восстанавливает сохранённый выбор: активная карточка отмечена', () => {
    window.localStorage.setItem('theme', 'sepia');
    render(
      <ThemeProvider>
        <ThemePalette />
      </ThemeProvider>,
    );

    expect(screen.getByRole('radio', { name: /Сепия/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Системная/ })).not.toBeChecked();
  });
});

describe('ThemeToggle', () => {
  it('быстрая кнопка переключает dark/light (system резолвится в light)', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Включить тёмную тему' }));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(window.localStorage.getItem('theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Включить светлую тему' })).toBeInTheDocument();
  });

  it('меню палитры: все варианты доступны, выбор сепии применяется и закрывает меню', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Палитра темы' }));

    expect(screen.getByRole('menu', { name: 'Тема интерфейса' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(5);

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Сепия/ }));

    expect(document.documentElement.classList.contains('sepia')).toBe(true);
    expect(window.localStorage.getItem('theme')).toBe('sepia');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('активная палитра помечена в меню (aria-checked)', () => {
    window.localStorage.setItem('theme', 'neon');
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Палитра темы' }));

    expect(screen.getByRole('menuitemradio', { name: /Неон/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: /Системная/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('Escape закрывает меню без смены темы', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Палитра темы' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('theme')).toBeNull();
  });
});

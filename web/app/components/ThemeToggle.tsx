// Переключатель темы (next-themes, class-атрибут на html): компактная кнопка
// быстрого dark/light + кнопка «Палитра темы» с меню всех вариантов
// (system/dark/light/sepia/neon — варианты в lib/shared/theme).
// До гидратации — нейтральные кнопки (размер зафиксирован, без layout-shift
// и без рассинхрона SSR/клиент). Рендерится в Nav как есть, без правок Nav.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTheme } from 'next-themes';
import { IconCheck, IconMoon, IconSun } from './ui/icons';
import { THEME_OPTIONS, type ThemeChoice } from '../../lib/shared/theme';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim';

// Иконка палитры — 4 свотча (ui/icons не трогаем, иконка локальная).
function IconSwatches({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <circle cx="8.25" cy="8.25" r="3.25" opacity="0.95" />
      <circle cx="15.75" cy="8.25" r="3.25" opacity="0.55" />
      <circle cx="8.25" cy="15.75" r="3.25" opacity="0.55" />
      <circle cx="15.75" cy="15.75" r="3.25" opacity="0.95" />
    </svg>
  );
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { resolvedTheme, theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const close = useCallback(() => setOpen(false), []);

  // Меню открыто: клик/тап мимо и Escape закрывают; Escape возвращает фокус на кнопку.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      close();
      rootRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  // Открытие меню — фокус на активный (или первый) пункт.
  useEffect(() => {
    if (!open) return;
    const items = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
    );
    if (items.length === 0) return;
    const active = items.find((el) => el.getAttribute('aria-checked') === 'true') ?? items[0];
    active.focus();
  }, [open]);

  const isDark = resolvedTheme === 'dark';

  const pick = useCallback(
    (value: ThemeChoice) => {
      setTheme(value);
      close();
    },
    [setTheme, close],
  );

  // Роуминг фокуса стрелками по пунктам меню.
  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div ref={rootRef} className={`relative inline-flex items-center gap-0.5 ${className}`}>
      <button
        type="button"
        aria-label={mounted ? (isDark ? 'Включить светлую тему' : 'Включить тёмную тему') : 'Переключить тему'}
        title="Тема"
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-dim transition-colors duration-fast hover:text-ink ${FOCUS}`}
      >
        {mounted ? (
          isDark ? (
            <IconSun />
          ) : (
            <IconMoon />
          )
        ) : (
          <span className="h-4 w-4" aria-hidden="true" />
        )}
      </button>

      <button
        type="button"
        aria-label="Палитра темы"
        title="Палитра темы"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-dim transition-colors duration-fast hover:text-ink ${FOCUS}`}
      >
        <IconSwatches className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Тема интерфейса"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-line bg-surface p-1 shadow-pop"
        >
          {THEME_OPTIONS.map((option) => {
            const active = theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => pick(option.value)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-fast hover:bg-surface-2 focus-visible:outline-none focus-visible:bg-surface-2 focus-visible:text-ink ${
                  active ? 'text-accent' : 'text-ink'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 rounded-full border border-line"
                  style={{ background: option.preview.bg }}
                />
                <span className="flex-1">{option.label}</span>
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: option.preview.accent }}
                />
                {active && <IconCheck className="h-3.5 w-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

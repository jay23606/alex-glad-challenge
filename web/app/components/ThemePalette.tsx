// Селектор палитры темы для /settings: радиокарточки всех вариантов
// (system/dark/light/sepia/neon — данные в lib/shared/theme, цвета в globals.css).
// Client-only: useTheme требует браузер; до гидратации ни одна карточка не
// отмечена — совпадает с SSR-рендером, без рассинхрона. Никаких импортов core/.
'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { IconCheck } from './ui/icons';
import { THEME_OPTIONS } from '../../lib/shared/theme';

export function ThemePalette({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <fieldset className={className}>
      <legend className="text-xs font-medium text-dim">Палитра интерфейса</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {THEME_OPTIONS.map((option) => {
          const active = mounted && theme === option.value;
          return (
            <label
              key={option.value}
              className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-2.5 transition-colors duration-fast ${
                active
                  ? 'border-accent bg-accent/10'
                  : 'border-line hover:border-line-strong hover:bg-surface-2'
              }`}
            >
              <input
                type="radio"
                name="theme"
                className="sr-only"
                checked={active}
                onChange={() => setTheme(option.value)}
              />
              <span className="flex items-center justify-between">
                <span
                  aria-hidden="true"
                  className="h-5 w-5 rounded-full border border-line"
                  style={{ background: option.preview.bg }}
                />
                {active && (
                  <span aria-hidden="true">
                    <IconCheck className="h-4 w-4 text-accent" />
                  </span>
                )}
              </span>
              <span className="text-sm text-ink">{option.label}</span>
              <span className="text-xs text-dim">{option.hint}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

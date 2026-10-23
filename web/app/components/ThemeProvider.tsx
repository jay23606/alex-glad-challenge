'use client';

// Обёртка над next-themes. Client-component (next-themes использует DOM/useState).
// Владеет дефолтами системы тем (список палитр — lib/shared/theme, значения цветов
// — globals.css): 4 палитры class-атрибутом на <html> + режим system
// (prefers-color-scheme; анти-FOUC скрипт next-themes резолвит system до первого
// кадра, поэтому мигания нет). Вызывающий layout может переопределить любой проп —
// обычно передаёт только nonce для CSP.
import type { ComponentProps } from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { PALETTE_THEMES } from '../../lib/shared/theme';

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      themes={[...PALETTE_THEMES]}
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}

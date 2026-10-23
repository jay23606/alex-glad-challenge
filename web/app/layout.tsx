// Корневой layout. next-themes: 4 палитры (dark/light/sepia/neon) + режим system
// (prefers-color-scheme); дефолты владеет ThemeProvider (палитры — lib/shared/theme,
// значения цветов — globals.css). Класс темы ставится на <html> (в т.ч. анти-FOUC
// скриптом до первого кадра).
// Editorial-каркас: Header (Nav) сверху, main flex-1, Footer снизу (flex-col min-h-screen).
// Admin-auth (день 36): гость — урезанный хром (Nav без core-ссылок/статуса модели,
// БЕЗ Sidebar/Footer — те светят все защищённые маршруты); админ — полный каркас.
// Гостевая ветка main — БЕЗ контейнера (landing-v2): лендинг сам владеет секциями.
// Layout уже динамический (await headers() для nonce) — cookie-чтение кэш не ломает.
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { Manrope, IBM_Plex_Mono, Unbounded } from 'next/font/google';
import { ThemeProvider } from './components/ThemeProvider';
import { ToastProvider } from './components/ui/Toast';
import { PerfProbe } from './components/perf-probe';
import Nav from './components/Nav';
import { Sidebar } from './components/Sidebar';
import Footer from './components/Footer';
import { isAdminAuthed } from '../lib/server/session';
import './globals.css';

// Manrope — текстовый шрифт (variable, cyrillic); Unbounded — дисплейный для
// лендинга (--font-display); IBM Plex Mono остаётся моно-голосом данных/админки.
const manrope = Manrope({
  subsets: ['cyrillic', 'latin'],
  variable: '--font-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['cyrillic', 'latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

const unbounded = Unbounded({
  subsets: ['cyrillic', 'latin'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.WEB_PUBLIC_ORIGIN?.trim() || 'http://127.0.0.1:3000'),
  title: 'Артемия Артель — AI-инженер',
  description:
    'AI-инженер: локальные LLM-агенты, RAG, MCP-серверы, TG-автоматизация — системы, собранные и доведённые до работающего состояния.',
};

// Viewport — отдельный export (Next 15 App Router). Без него мобильные браузеры
// рендерят виртуальный ~980px viewport → сайт выглядит как уменьшенный десктоп.
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // nonce из middleware.ts — пробрасывается в next-themes prop `nonce`, чтобы anti-FOUC
  // inline-скрипт тоже покрывался CSP (иначе 1 residual violation под nonce-based политикой).
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const isAdmin = await isAdminAuthed();
  return (
    <html lang="ru" suppressHydrationWarning className={`${manrope.variable} ${plexMono.variable} ${unbounded.variable}`}>
      <body className="min-h-screen bg-bg font-sans text-ink antialiased">
        <ThemeProvider nonce={nonce}>
          <ToastProvider>
            <div className="flex min-h-screen flex-col">
              <Nav isAdmin={isAdmin} />
              {isAdmin ? (
                <>
                  <div className="flex flex-1">
                    <Sidebar />
                    <main className="flex-1 px-5 py-6">
                      <div className="mx-auto max-w-6xl">{children}</div>
                    </main>
                  </div>
                  <Footer />
                </>
              ) : (
                <main className="flex-1">{children}</main>
              )}
            </div>
          </ToastProvider>
        </ThemeProvider>
        <PerfProbe />
      </body>
    </html>
  );
}

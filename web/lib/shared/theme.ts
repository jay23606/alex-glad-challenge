// Единый источник системы тем: имена палитр, русские подписи и превью-цвета.
// CSS-значения каждой палитры (rgb-триплеты --bg/--accent/…) живут в
// web/app/globals.css — блоки html.dark/html.light/html.sepia/html.neon.
// 'system' — служебный режим next-themes (enableSystem): хранится в localStorage
// и резолвится в dark/light по prefers-color-scheme ещё до первого кадра
// (анти-FOUC скрипт next-themes), поэтому мигания темы нет.

/** Палитры, применяемые как class-атрибут на <html>. */
export const PALETTE_THEMES = ['dark', 'light', 'sepia', 'neon'] as const;
export type PaletteTheme = (typeof PALETTE_THEMES)[number];

/** Все варианты выбора: system + палитры (порядок = порядок в UI). */
export const THEME_CHOICES = ['system', ...PALETTE_THEMES] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

export interface ThemeOption {
  value: ThemeChoice;
  /** Подпись варианта (радиокарточка в /settings, пункт меню в ThemeToggle). */
  label: string;
  /** Короткое описание палитры под подписью. */
  hint: string;
  /** Превью для карточек/меню: фон палитры и её акцент (значения CSS background/color). */
  preview: { bg: string; accent: string };
}

export const THEME_OPTIONS: readonly ThemeOption[] = [
  {
    value: 'system',
    label: 'Системная',
    hint: 'как в ОС',
    preview: { bg: 'linear-gradient(90deg, #0f1417 50%, #f7f5f0 50%)', accent: '#8b7cff' },
  },
  {
    value: 'dark',
    label: 'Тёмная',
    hint: 'графит',
    preview: { bg: '#0f1417', accent: '#8b7cff' },
  },
  {
    value: 'light',
    label: 'Светлая',
    hint: 'бумага',
    preview: { bg: '#f7f5f0', accent: '#5a4bff' },
  },
  {
    value: 'sepia',
    label: 'Сепия',
    hint: 'тёплая бумага',
    preview: { bg: '#f3ebdd', accent: '#946026' },
  },
  {
    value: 'neon',
    label: 'Неон',
    hint: 'чёрный + неон',
    preview: { bg: '#07090e', accent: '#a76cff' },
  },
];

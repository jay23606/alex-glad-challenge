// Парсер инвокаций бота «Медиум» (M1): /команда[@BotName], reply на сообщение
// бота с командой, @упоминание бота в тексте («@bot на это сказал севенс парковка»).
// Чистый модуль — покрыт юнит-тестами.
//
// Публичные команды брендированы префиксом medium_/м, чтобы не пересекаться
// с другими ботами в чате. Старые короткие имена (/quote, /цитата и т.п.)
// по-прежнему распознаются, но в меню Telegram больше не регистрируются.

export const BOT_COMMANDS = [
  'цитата',
  'сказал',
  'игра',
  'изобрази',
  'какбы',
  'уровень',
  'reindex',
  'алиас',
  'алиасскан',
  'блоги',
  'авто',
  'off',
  'on',
  'стат',
] as const;

/** Латинские алиасы кириллических команд (для меню Telegram: Bot API принимает только [a-z0-9_]).
 *  reindex/off/on кириллического канона не имеют — они и есть канонические имена. */
export const BOT_COMMAND_ALIASES = {
  цитата: 'medium_quote',
  сказал: 'medium_said',
  игра: 'medium_game',
  изобрази: 'medium_improv',
  какбы: 'medium_asif',
  уровень: 'medium_level',
  алиас: 'alias',
  алиасскан: 'aliasscan',
  блоги: 'blogs',
  авто: 'auto',
  стат: 'stat',
} as const;

/** Обратный словарь: латинский алиас → кириллическое каноническое имя.
 *  Сюда же добавляем старые короткие имена для обратной совместимости. */
const LATIN_TO_COMMAND: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.entries(BOT_COMMAND_ALIASES).map(([cyr, lat]) => [lat, cyr])),
  quote: 'цитата',
  said: 'сказал',
  game: 'игра',
  improv: 'изобрази',
  asif: 'какбы',
  мцитата: 'цитата',
  мсказал: 'сказал',
  мигра: 'игра',
  мизобрази: 'изобрази',
  мкакбы: 'какбы',
  муровень: 'уровень',
  level: 'уровень',
};

/** Команда → человекочитаемое описание для меню Telegram.
 *  Ключи — латинские имена, которые попадут в setMyCommands. */
export const BOT_COMMAND_DESCRIPTIONS = {
  medium_quote: 'Жемчужина из истории чата (/мцитата)',
  medium_said: 'Досье: /medium_said <ник> [тема] (/мсказал)',
  medium_game: 'Угадай, кто это сказал (/мигра)',
  medium_improv: 'Как это было сказано (/мизобрази)',
  medium_asif: 'Диалог с духом автора (/мкакбы)',
  medium_level: 'XP, уровень и серия (/муровень)',
  reindex: 'Адм: дотянуть FTS-индекс',
  alias: 'Адм: алиасы ников (/алиас)',
  aliasscan: 'Адм: поиск прозвищ в базе (/алиасскан)',
  blogs: 'Адм: блоги и правила автоматизации (/блоги)',
  auto: 'Адм: /авто <блог> on|off|status|run',
  off: 'Адм: выключить бота',
  on: 'Адм: включить бота',
  stat: 'Адм: состояние (/стат)',
} as const;

export type BotCommandName = (typeof BOT_COMMANDS)[number];

export interface ParsedCommand {
  name: string;
  args: string;
}

/** '/мцитата севенс' | '/medium_said@BotName тема' → {name, args}; не команда → null. */
export function parseCommand(
  text: string | null | undefined,
  botUsername?: string,
): ParsedCommand | null {
  if (!text) return null;
  const m = /^\s*\/([^\s@]+)(?:@(\S+))?(?:\s+([\s\S]*))?$/.exec(text);
  if (!m) return null;
  if (botUsername && m[2] && m[2].toLowerCase() !== botUsername.toLowerCase()) return null;
  let name = m[1].toLowerCase().replace(/ё/g, 'е');
  // Латинские алиасы → кириллические канонические имена (/medium_quote = /цитата …).
  name = LATIN_TO_COMMAND[name] ?? name;
  // «стат»/«stat»-варианты не расширяем — фиксированный набор M1.
  if (!(BOT_COMMANDS as readonly string[]).includes(name)) return null;
  return { name, args: (m[3] ?? '').trim() };
}

/**
 * Инвокация из произвольного текста: слэш-команда; либо @упоминание бота →
 * остаток как команда, «(на это) сказал …» → сказал, «как бы …» → какбы (M3).
 * Не инвокация → null.
 */
export function extractInvocation(
  text: string | null | undefined,
  botUsername?: string,
): ParsedCommand | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.startsWith('/')) return parseCommand(trimmed, botUsername);
  if (!botUsername) return null;
  const at = `@${botUsername.toLowerCase()}`;
  if (!trimmed.toLowerCase().includes(at)) return null;
  const rest = trimmed.replaceAll(new RegExp(escapeRe(at), 'gi'), ' ').trim();
  if (!rest) return null;
  if (rest.startsWith('/')) return parseCommand(rest, botUsername);
  const said = /(?:на\s+это\s+)?сказал\s+(.+)/is.exec(rest);
  if (said) return { name: 'сказал', args: said[1].trim() };
  if (/как\s+бы/is.test(rest)) return { name: 'какбы', args: '' };
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

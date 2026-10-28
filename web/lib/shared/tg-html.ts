// Whitelist-парсер Telegram-HTML (ТЗ §7.1). Общий для клиентского превью и
// серверного sanitize перед publishPost. Разрешены теги разметки Bot API:
// <b> <i> <u> <s> <a href> <code> <pre> <blockquote> <tg-spoiler>.
// Всё остальное экранируется и отображается литерально (в превью и в TG —
// одинаково). Без зависимостей; доступен клиенту (web/lib/shared/*).

const SIMPLE_TAGS = new Set(['b', 'i', 'u', 's', 'code', 'pre', 'blockquote', 'tg-spoiler']);
const MAX_DEPTH = 8; // защита от мусорной вложенности
const HREF_RE = /^(https?:\/\/|tg:\/\/)/i;

interface TagToken {
  name: string;
  closing: boolean;
  href?: string;
}

function parseTag(inner: string): TagToken | null {
  const m = /^\/?([a-zA-Z][a-zA-Z0-9-]*)(\s.*)?$/.exec(inner);
  if (!m) return null;
  const name = m[1].toLowerCase();
  const closing = inner.startsWith('/');
  if (!SIMPLE_TAGS.has(name) && name !== 'a') return null;
  if (name === 'a' && !closing) {
    const hm = /href\s*=\s*"([^"]*)"/i.exec(m[2] ?? '');
    if (!hm || !HREF_RE.test(hm[1])) return null;
    return { name, closing, href: hm[1] };
  }
  return { name, closing };
}

function escapeAngle(s: string): string {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Нормализует разметку: разрешённые теги остаются (href только http/https/tg),
// запрещённые — уходят в текст. Баланс пар отслеживается счётчиком глубины:
// сироты-закрытия и превышение глубины экранируются.
export function sanitizeTgHtml(src: string): string {
  const depths = new Map<string, number>();
  let out = '';
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      out += src.slice(i);
      break;
    }
    out += src.slice(i, lt);
    const gt = src.indexOf('>', lt + 1);
    if (gt === -1) {
      out += escapeAngle(src.slice(lt));
      break;
    }
    const tag = parseTag(src.slice(lt + 1, gt));
    const raw = src.slice(lt, gt + 1);
    if (!tag) {
      out += escapeAngle(raw);
    } else {
      const depth = depths.get(tag.name) ?? 0;
      if (tag.closing) {
        if (depth > 0) {
          depths.set(tag.name, depth - 1);
          out += `</${tag.name}>`;
        } else {
          out += escapeAngle(raw);
        }
      } else if (depth < MAX_DEPTH) {
        depths.set(tag.name, depth + 1);
        out += tag.href !== undefined ? `<a href="${tag.href}">` : `<${tag.name}>`;
      } else {
        out += escapeAngle(raw);
      }
    }
    i = gt + 1;
  }
  return out;
}

// Видимый текст уведомления/confirm-превью с учётом эффективного parse mode:
// HTML → запрещённые/литеральные уголки проходят через sanitize (экранируются,
//   не вырезаются вслепую) и разворачиваются обратно в текст;
// none → строка и так чистый текст, разметка в ней литеральная по контракту.
export function tgVisibleText(src: string, parseMode: 'HTML' | 'none' = 'HTML'): string {
  return parseMode === 'none' ? src : tgHtmlToPlain(sanitizeTgHtml(src));
}

// Текст без разметки — для превью в confirm-диалогах и строк истории.
export function tgHtmlToPlain(src: string): string {
  return src
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

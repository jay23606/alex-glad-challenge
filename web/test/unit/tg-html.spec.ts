// Unit: whitelist-парсер Telegram-HTML (клиентский превью + серверный sanitize).
import { describe, expect, it } from 'vitest';
import { sanitizeTgHtml, tgHtmlToPlain, tgVisibleText } from '../../lib/shared/tg-html';

describe('sanitizeTgHtml', () => {
  it.each([
    ['<b>жирный</b>', '<b>жирный</b>'],
    ['<i>курс</i>', '<i>курс</i>'],
    ['<u>подчёркнутый</u>', '<u>подчёркнутый</u>'],
    ['<s>зачёркнутый</s>', '<s>зачёркнутый</s>'],
    ['<code>code</code>', '<code>code</code>'],
    ['<pre>block</pre>', '<pre>block</pre>'],
    ['<blockquote>цитата</blockquote>', '<blockquote>цитата</blockquote>'],
    ['<tg-spoiler>спойлер</tg-spoiler>', '<tg-spoiler>спойлер</tg-spoiler>'],
  ])('разрешает %j', (src, expected) => {
    expect(sanitizeTgHtml(src)).toBe(expected);
  });

  it('нормализует регистр тегов', () => {
    expect(sanitizeTgHtml('<B>hi</B>')).toBe('<b>hi</b>');
  });

  it('оставляет <a> только с валидным href (http/https/tg)', () => {
    expect(sanitizeTgHtml('<a href="https://t.me/x">ok</a>')).toBe('<a href="https://t.me/x">ok</a>');
    expect(sanitizeTgHtml('<a href="http://site.ru">ok</a>')).toBe('<a href="http://site.ru">ok</a>');
    expect(sanitizeTgHtml('<a href="tg://resolve?domain=x">ok</a>')).toBe(
      '<a href="tg://resolve?domain=x">ok</a>',
    );
  });

  it('выкидывает опасные схемы href (javascript:, data:) — тег уходит в текст', () => {
    expect(sanitizeTgHtml('<a href="javascript:alert(1)">x</a>')).toBe(
      '&lt;a href="javascript:alert(1)"&gt;x&lt;/a&gt;',
    );
    expect(sanitizeTgHtml('<a href="data:text/html,x">x</a>')).toBe(
      '&lt;a href="data:text/html,x"&gt;x&lt;/a&gt;',
    );
    // <a> без href — тоже не валидный тег разметки
    expect(sanitizeTgHtml('<a>x</a>')).toBe('&lt;a&gt;x&lt;/a&gt;');
  });

  it('экранирует запрещённые теги, не выполняя их', () => {
    expect(sanitizeTgHtml('hi <script>alert(1)</script>')).toBe(
      'hi &lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(sanitizeTgHtml('<br/>text')).toBe('&lt;br/&gt;text');
  });

  it('срезает атрибуты разрешённых тегов (кроме href у <a>)', () => {
    expect(sanitizeTgHtml('<b onclick="alert(1)" class="x">t</b>')).toBe('<b>t</b>');
  });

  it('сирота-закрытие уходит в текст, пары — норм', () => {
    expect(sanitizeTgHtml('</b>text')).toBe('&lt;/b&gt;text');
    expect(sanitizeTgHtml('<b>ok')).toBe('<b>ok');
  });

  it('капит глубину вложенности (8) — 9-й тег экранируется', () => {
    const depth8 = '<b>'.repeat(8) + 'x' + '</b>'.repeat(8);
    expect(sanitizeTgHtml(depth8)).toBe(depth8);
    const depth9 = '<b>'.repeat(9) + 'x';
    const out = sanitizeTgHtml(depth9);
    expect(out.startsWith('<b>'.repeat(8))).toBe(true);
    expect(out).toContain('&lt;b&gt;');
  });

  it('текст без разметки проходит как есть, угловые скобки в тексте экранируются', () => {
    expect(sanitizeTgHtml('просто текст 1 < 2')).toBe('просто текст 1 &lt; 2');
    expect(sanitizeTgHtml('без разметки')).toBe('без разметки');
  });
});

describe('tgHtmlToPlain', () => {
  it('снимает разметку и разворачивает сущности', () => {
    expect(tgHtmlToPlain('<b>жир</b> и <code>код</code>')).toBe('жир и код');
    expect(tgHtmlToPlain('a &lt; b')).toBe('a < b');
  });

  it('экранированные теги остаются текстом', () => {
    expect(tgHtmlToPlain(sanitizeTgHtml('<script>x</script>'))).toBe('<script>x</script>');
  });
});

describe('tgVisibleText', () => {
  it('HTML: литеральные уголки в тексте сохраняются (не вырезаются как «тег»)', () => {
    expect(tgVisibleText('5 < 10 > 3')).toBe('5 < 10 > 3');
  });

  // Контракт confirm-превью постов блога (blog/posts/[id]): черновик содержит
  // и разрешённую разметку, и литеральные уголки — снимается одно, второе видно.
  it('HTML: разметка снимается, литеральные уголки рядом сохраняются', () => {
    expect(tgVisibleText('<b>итог</b>: 5 < 10 > 3')).toBe('итог: 5 < 10 > 3');
  });

  it('HTML: разрешённая разметка снимается', () => {
    expect(tgVisibleText('<b>x</b>')).toBe('x');
  });

  it('HTML: запрещённый <script> остаётся видимым текстом', () => {
    expect(tgVisibleText('hi <script>alert(1)</script>')).toBe('hi <script>alert(1)</script>');
  });

  it('none: строка возвращается как есть — разметка литеральная по контракту', () => {
    expect(tgVisibleText('<b>x</b> 5 < 10', 'none')).toBe('<b>x</b> 5 < 10');
  });

  it('дефолт — HTML (совпадает с эффективным parse mode composer/publish)', () => {
    expect(tgVisibleText('<i>y</i>')).toBe(tgVisibleText('<i>y</i>', 'HTML'));
  });
});

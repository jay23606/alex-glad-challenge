// Агент 2. Написание поста в Telegram-канал.
// Профиль + few-shot примеры → промпт → пост.
// Ключевая логика:
//   1. ВСЕ поля профиля инжектируются отдельными блоками (не как текст).
//   2. Few-shot примеры — главная опора стиля (few-shot сильнее инструкций).
//   3. Структура промпта: system (роль + стиль) → few-shot → user (новость + правила).
//   4. Длина жёстко контролируется: 100-500 символов, иначе LLM растягивает.

import { DEFAULT_BLOG_SLUG, type BlogDb, type NewsRow, type StyleSampleRow } from '../db.js';
import type { LlmClient } from '../client.js';
import { msg } from '../types.js';
import type { ProfileManager } from '../profile.js';
import { presetSystemPrompt } from '../stylePreset.js';

export interface WrittenPost {
  content: string;
  news: NewsRow;
}

export interface WriteOptions {
  userTopic?: string;
  userComment?: string;
  // few-shot образцы стиля берутся только этого блога (style_samples.blog_id).
  blogId?: number | null;
}

export class PostWriter {
  constructor(
    private client: LlmClient,
    private profile?: ProfileManager,
  ) {}

  async write(db: BlogDb, news: NewsRow, opts: WriteOptions = {}): Promise<WrittenPost> {
    const blog = opts.blogId != null ? db.getBlog(opts.blogId) : null;
    // Легаси-дефолты (футбольный канал/@lookatfacts) допустимы только для блога
    // по умолчанию или вызова без блога; остальные блоги без профиля получают
    // своё имя и нейтральный стиль, а не чужой голос.
    const legacyDefaults = !blog || blog.slug === DEFAULT_BLOG_SLUG;

    // Приоритет system-промпта: явный per-blog → пресет → шаблон по профилю.
    // Явный промпт самодостаточен: few-shot образцы к нему не подмешиваются.
    const explicitPrompt = blog?.system_prompt?.trim() || null;
    const presetPrompt =
      !explicitPrompt && opts.blogId != null
        ? presetSystemPrompt(db.getStylePreset(opts.blogId))
        : null;
    const basePrompt = explicitPrompt ?? presetPrompt;
    const samples = basePrompt ? [] : db.styleSamples(3, opts.blogId);
    const contextPrompt = blog?.context_prompt?.trim() || null;

    // --- Извлекаем ВСЕ поля профиля ---
    const p = this.profile?.active;
    const channel = p?.канал ?? (blog ? blog.name : 'Иди на факты глянь');
    const topic = p?.тематика ?? (legacyDefaults ? `футбол: ФК «${p?.любимый_клуб ?? 'Челси'}»` : blog?.name ?? '');
    const style = p?.стиль ?? (legacyDefaults ? 'ироничный, резкий, с подколами' : 'живой, человеческий, без канцелярита');
    const emojiRule = p?.эмодзи ?? 'без эмодзи';
    const signature = p?.подпись ?? (legacyDefaults ? '@lookatfacts' : '');
    const lengthRule = p?.длина_постов ?? '100-500 символов';
    const formatRule = p?.формат_абзацев ?? '2-4 предложения на абзац';
    const taboos = p?.табу ?? 'без мата, без политики';
    const humor = p?.приемы_юмора ?? '';
    const language = p?.язык ?? 'русский';
    const signatureLine = signature ? `- Подпись в конце: ${signature}\n` : '';
    const contextBlock = contextPrompt
      ? `\n\n=== КОНТЕКСТ БЛОГА (постоянные факты, аудитория и тон) ===\n${contextPrompt}`
      : '';

    // --- System-промпт: роль + жёсткие правила стиля ---
    // Явный промпт/пресет идёт поверх профиля: профиль продолжает давать
    // канал/табу/подпись. Context prompt добавляется в обоих режимах.
    const system = basePrompt
      ? `${basePrompt}

КАНАЛ И ПРОФИЛЬ (обязательно):
- Шапка поста: «${channel}: » (без даты/времени). Первый символ ответа — «${channel[0]}».
${signatureLine}- Табу: ${taboos}.
- Язык: ${language}.${contextBlock}`
      : `Ты — автор Telegram-канала «${channel}» (${topic}).
Ты пишешь ${style}. Язык: ${language}.

ЖЁСТКИЕ ПРАВИЛА СТИЛЯ:
- ОБЪЁМ: ${lengthRule}. Если тема мелкая — хватит и 100-150 символов. НЕ РАСТЯГИВАЙ.
- ФОРМАТ: ${formatRule}.
- Шапка поста: «${channel}: » (без даты/времени). Первый символ ответа — «${channel[0]}».
- ЭМОДЗИ: ${emojiRule}.
${signatureLine}${humor ? `- ПРИЁМЫ ЮМОРА которые используй: ${humor}.` : ''}
- КАПСОМ выделять 1-2 ключевых слова для акцента (не весь текст).
- Риторические вопросы, разговорная речь.
- Не выдумывай факты, которых нет в источнике.
- Не обрезай пост на полуслове.
- ${taboos}.${contextBlock}`;

    // --- Few-shot: примеры реальных постов (главный учитель стиля) ---
    const fewShotBlock = samples.length > 0
      ? `=== ПРИМЕРЫ ТВОИХ ПОСТОВ (пиши ТАК ЖЕ) ===\n${formatSamples(samples)}\n`
      : '';

    // --- User-промпт: конкретная новость + доп. ввод ---
    const topicBlock = opts.userTopic
      ? `\nТЕМА ОТ АВТОРА (главный фокус): ${opts.userTopic}\n`
      : '';
    const commentBlock = opts.userComment
      ? `\nКОММЕНТАРИЙ АВТОРА (обязательно вплавь в текст): ${opts.userComment}\n`
      : '';

    const user = `${fewShotBlock}
=== НОВОСТЬ ДЛЯ ПОСТА ===
Заголовок: ${news.title}
Источник: ${news.source}
Текст: ${news.summary}
${topicBlock}${commentBlock}
Напиши пост. Выдай ТОЛЬКО готовый текст поста, без преамбул.`;

    const messages = [
      msg.system(system),
      msg.user(user),
    ];

    // few-shot сильнее в user-сообщениях после system.
    // Добавляем 1-2 примера как пары user/assistant для in-context learning.
    if (samples.length > 0) {
      const s1 = samples[0];
      messages.push(msg.user('Напиши пост по образцу выше.'));
      messages.push(msg.assistant(s1.text));
      if (samples.length > 1) {
        const s2 = samples[1];
        messages.push(msg.user(`Напиши пост на тему: ${s2.text.slice(0, 60)}...`));
        messages.push(msg.assistant(s2.text));
      }
      messages.push(msg.user(`${user}\n\nНапиши СВОЙ пост в том же стиле. Не повторяй примеры.`));
    }

    const content = await this.client.chat(messages, {
      temperature: 0.7,
      maxTokens: 2000,
    });

    const cleaned = cleanPost(content, channel);
    return { content: cleaned, news };
  }
}

function cleanPost(raw: string, channel = 'Иди на факты глянь'): string {
  let s = raw.trim();
  // Убираем markdown-обёртку.
  s = s.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '');
  // Убираем "Вот пост:" и подобные преамбулы.
  s = s.replace(/^(вот\s+пост|готово|пост:|пост готов)\s*:?\s*/i, '');
  // Если нет шапки — добавляем.
  if (!s.startsWith(channel)) {
    s = `${channel}: ` + s;
  }
  return s.trim();
}

function formatSamples(rows: StyleSampleRow[]): string {
  return rows
    .map((s, i) => `--- ПРИМЕР ${i + 1} ---\n${s.text}`)
    .join('\n\n');
}

export async function rewritePost(
  client: LlmClient,
  originalPost: string,
  edit: string,
  news: NewsRow,
  profile?: import('../profile.js').ProfileManager,
): Promise<string> {
  const p = profile?.active;
  const channel = p?.канал ?? 'Иди на факты глянь';
  const system = `Ты — автор Telegram-канала «${channel}».
${p ? `Стиль: ${p.стиль}. Эмодзи: ${p.эмодзи}. Подпись: ${p.подпись}.` : ''}
Перепиши пост с учётом правок. Сохрани стиль, шапку, подпись.
Объём: ${p?.длина_постов ?? '100-500 символов'}.
НЕ выдумывай факты. НЕ обрезай на полуслове.`;

  const user = `=== НОВОСТЬ (ИСТОЧНИК) ===
Заголовок: ${news.title}
Текст: ${news.summary}

=== ТЕКУЩИЙ ПОСТ ===
${originalPost}

=== ПРАВКИ ===
${edit}

Выдай только готовый пост.`;

  const content = await client.chat(
    [msg.system(system), msg.user(user)],
    { temperature: 0.7, maxTokens: 2000 },
  );
  return cleanPost(content, channel);
}


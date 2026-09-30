// Агент 2. Написание поста в Telegram-канал.
// Профиль + few-shot примеры → промпт → пост.
// Ключевая логика:
//   1. ВСЕ поля профиля инжектируются отдельными блоками (не как текст).
//   2. Few-shot примеры — главная опора стиля (few-shot сильнее инструкций).
//   3. Структура промпта: system (роль + стиль) → few-shot → user (новость + правила).
//   4. Длина жёстко контролируется: 100-500 символов, иначе LLM растягивает.

import type { BlogDb, NewsRow, StyleSampleRow } from '../db.js';
import { LlmClient, msg } from '../index.js';
import type { ProfileManager } from '../profile.js';

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
    const samples = db.styleSamples(3, opts.blogId);

    // --- Извлекаем ВСЕ поля профиля ---
    const p = this.profile?.active;
    const channel = p?.канал ?? 'Иди на факты глянь';
    const topic = p?.тематика ?? `футбол: ФК «${p?.любимый_клуб ?? 'Челси'}»`;
    const style = p?.стиль ?? 'ироничный, резкий, с подколами';
    const emojiRule = p?.эмодзи ?? 'без эмодзи';
    const signature = p?.подпись ?? '@lookatfacts';
    const lengthRule = p?.длина_постов ?? '100-500 символов';
    const formatRule = p?.формат_абзацев ?? '2-4 предложения на абзац';
    const taboos = p?.табу ?? 'без мата, без политики';
    const humor = p?.приемы_юмора ?? '';
    const language = p?.язык ?? 'русский';

    // --- System-промпт: роль + жёсткие правила стиля ---
    const system = `Ты — автор Telegram-канала «${channel}» (${topic}).
Ты пишешь ${style}. Язык: ${language}.

ЖЁСТКИЕ ПРАВИЛА СТИЛЯ:
- ОБЪЁМ: ${lengthRule}. Если тема мелкая — хватит и 100-150 символов. НЕ РАСТЯГИВАЙ.
- ФОРМАТ: ${formatRule}.
- Шапка поста: «${channel}: » (без даты/времени). Первый символ ответа — «${channel[0]}».
- ЭМОДЗИ: ${emojiRule}.
- Подпись в конце: ${signature}
${humor ? `- ПРИЁМЫ ЮМОРА которые используй: ${humor}.` : ''}
- КАПСОМ выделять 1-2 ключевых слова для акцента (не весь текст).
- Риторические вопросы, разговорная речь.
- Не выдумывай факты, которых нет в источнике.
- Не обрезай пост на полуслове.
- ${taboos}.`;

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
  client: import('../index.js').LlmClient,
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


// TopicPostWriter — пост по свободной теме без RSS/новостей (праздники, ручные
// посты, Telegram-команда). Использует per-blog промпты, голосовой профиль (если
// есть) и последние посты как anti-repeat. Варианты различаются углом подачи и
// температурой — один и тот же день может звучать по-разному, но остаётся в
// голосе блога. Внешний текст (тема/комментарий) очищается clean().

import type { LlmClient } from '../client.js';
import type { BlogDb, BlogRow } from '../db.js';
import { DEFAULT_BLOG_SLUG } from '../db.js';
import type { ProfileManager } from '../profile.js';
import { clean } from '../sanitize.js';
import { presetSystemPrompt } from '../stylePreset.js';
import { msg } from '../types.js';
import { cleanPost } from './postWriter.js';

export interface TopicVariantSpec {
  readonly id: string;
  readonly label: string;
  readonly instruction: string;
}

// Три устойчиво разных угла: тёплый/человеческий, сухой/фактологический,
// рефлексивный/история. Порядок = variant (0..2).
export const TOPIC_VARIANTS: readonly TopicVariantSpec[] = [
  {
    id: 'human',
    label: 'тёплый человеческий',
    instruction:
      'Угол: тёплый человеческий. Начни с конкретной сцены или детали, говори с читателем как живой человек, без пафоса и канцелярита.',
  },
  {
    id: 'short',
    label: 'короткий факт',
    instruction:
      'Угол: короткий факт. Максимально плотно: 1-3 предложения по сути, без вступлений, без лирики, но живо и по-человечески.',
  },
  {
    id: 'reflection',
    label: 'размышление',
    instruction:
      'Угол: размышление. Короткая история или мысль, которая подводит к теме; мягкий вывод, без морализаторства и назидания.',
  },
];

export interface TopicWriteOptions {
  readonly topic: string;
  readonly comment?: string;
  readonly variantIndex?: number;
  readonly profile?: ProfileManager;
  readonly recent?: readonly string[];
}

export interface WrittenTopicPost {
  readonly content: string;
  readonly variant: number;
  readonly angle: string;
}

export class TopicPostWriter {
  constructor(private readonly client: LlmClient) {}

  async writeMany(
    db: BlogDb,
    blog: BlogRow,
    opts: {
      readonly topic: string;
      readonly comment?: string;
      readonly count?: number;
      readonly profile?: ProfileManager;
      /** Готовый anti-repeat срез; если не задан — читается из БД. */
      readonly recent?: readonly string[];
    },
  ): Promise<WrittenTopicPost[]> {
    const count = Math.min(Math.max(Math.trunc(opts.count ?? 1), 1), TOPIC_VARIANTS.length);
    const recent =
      opts.recent ??
      db.recentPosts(3, blog.id).map((p) => p.content.replace(/\s+/g, ' ').trim().slice(0, 220));
    const out: WrittenTopicPost[] = [];
    for (let i = 0; i < count; i++) {
      out.push(
        await this.writeOne(blog, {
          topic: opts.topic,
          comment: opts.comment,
          variantIndex: i,
          profile: opts.profile,
          recent,
        }),
      );
    }
    return out;
  }

  async writeOne(blog: BlogRow, opts: TopicWriteOptions): Promise<WrittenTopicPost> {
    const variant = Math.min(Math.max(Math.trunc(opts.variantIndex ?? 0), 0), TOPIC_VARIANTS.length - 1);
    const angle = TOPIC_VARIANTS[variant];
    const p = opts.profile?.active;
    const legacyDefaults = blog.slug === DEFAULT_BLOG_SLUG;

    const channel = p?.канал ?? blog.name;
    const signature = p?.подпись ?? (legacyDefaults ? '@lookatfacts' : '');
    const taboos = p?.табу ?? 'без мата, без политики';
    const language = p?.язык ?? 'русский';
    const styleLine = p?.стиль ? `Стиль: ${p.стиль}.` : '';
    const contextPrompt = blog.context_prompt?.trim() || null;
    const explicitPrompt = blog.system_prompt?.trim() || presetSystemPrompt(blog.style_preset);

    const base =
      explicitPrompt ??
      `Ты — автор Telegram-канала «${channel}». Пиши живым, человеческим языком, без канцелярита, штампов и пафоса. ${styleLine}`.trim();

    const system = `${base}

КАНАЛ (обязательно):
- Шапка поста: «${channel}: » (без даты/времени). Первый символ ответа — «${channel[0]}».
${signature ? `- Подпись в конце: ${signature}\n` : ''}- Табу: ${taboos}.
- Язык: ${language}.
- Не выдумывай факты, цитаты, даты и имена, которых нет в теме/контексте.
${contextPrompt ? `\n=== КОНТЕКСТ БЛОГА (постоянные факты и тон) ===\n${contextPrompt}\n` : ''}
${angle.instruction}`;

    const topic = clean(opts.topic, 500);
    const comment = opts.comment ? clean(opts.comment, 1000) : '';
    const recentBlock =
      opts.recent && opts.recent.length > 0
        ? `\n=== ПОСЛЕДНИЕ ПОСТЫ (не повторяй формулировки и зачины) ===\n${opts.recent
            .map((s, i) => `${i + 1}. ${s}`)
            .join('\n')}\n`
        : '';

    const user = `=== ТЕМА ПОСТА ===\n${topic}
${comment ? `\n=== КОММЕНТАРИЙ АВТОРА (вплавь в текст) ===\n${comment}\n` : ''}${recentBlock}
Напиши пост. Выдай ТОЛЬКО готовый текст поста, без преамбул.`;

    const content = await this.client.chat([msg.system(system), msg.user(user)], {
      temperature: Math.min(0.7 + variant * 0.12, 0.94),
      maxTokens: 2000,
    });

    return { content: cleanPost(content, channel), variant, angle: angle.label };
  }
}

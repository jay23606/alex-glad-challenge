// Unit: zod-схемы форм, задействованные в TG-постинге.
import { describe, expect, it } from 'vitest';
import {
  chatSendSchema,
  newsOptsSchema,
  ragQuerySchema,
  scoutOptsSchema,
  styleSampleSchema,
  tgPublishSchema,
  todoAddSchema,
} from '../../lib/shared/forms';

describe('tgPublishSchema', () => {
  it('пустой текст отклоняется', () => {
    const r = tgPublishSchema.safeParse({ text: '   ' });
    expect(r.success).toBe(false);
  });

  it('4096 символов проходит, 4097 — нет (Bot API limit)', () => {
    expect(tgPublishSchema.safeParse({ text: 'a'.repeat(4096) }).success).toBe(true);
    expect(tgPublishSchema.safeParse({ text: 'a'.repeat(4097) }).success).toBe(false);
  });

  it('parseMode принимает только HTML|none; отсутствие = дефолт HTML', () => {
    expect(tgPublishSchema.safeParse({ text: 'x', parseMode: 'none' }).success).toBe(true);
    expect(tgPublishSchema.safeParse({ text: 'x', parseMode: 'MARKDOWN' }).success).toBe(false);
    const parsed = tgPublishSchema.parse({ text: 'x' });
    expect(parsed.parseMode ?? 'HTML').toBe('HTML');
  });
});

describe('newsOptsSchema / scoutOptsSchema', () => {
  it('hours ограничены 1..168', () => {
    expect(newsOptsSchema.safeParse({ hours: 0 }).success).toBe(false);
    expect(newsOptsSchema.safeParse({ hours: 169 }).success).toBe(false);
    expect(newsOptsSchema.safeParse({ hours: 48 }).success).toBe(true);
  });

  it('scout topK 1..10, llm enum', () => {
    expect(scoutOptsSchema.safeParse({ topK: 11 }).success).toBe(false);
    expect(scoutOptsSchema.safeParse({ topK: 3, llm: 'cloud' }).success).toBe(true);
    expect(scoutOptsSchema.safeParse({ llm: 'gpt5' }).success).toBe(false);
  });
});

describe('ragQuerySchema', () => {
  it('пустой/пробельный query отклоняется', () => {
    expect(ragQuerySchema.safeParse({ query: '' }).success).toBe(false);
    expect(ragQuerySchema.safeParse({ query: '   ' }).success).toBe(false);
  });

  it('query длиннее 2000 отклоняется, 2000 проходит', () => {
    expect(ragQuerySchema.safeParse({ query: 'в'.repeat(2001) }).success).toBe(false);
    expect(ragQuerySchema.safeParse({ query: 'в'.repeat(2000) }).success).toBe(true);
  });

  it('k — coerce к числу, границы 1..20, дробные отклоняются', () => {
    expect(ragQuerySchema.safeParse({ query: 'q', k: '5' }).success).toBe(true);
    expect(ragQuerySchema.safeParse({ query: 'q', k: 0 }).success).toBe(false);
    expect(ragQuerySchema.safeParse({ query: 'q', k: 21 }).success).toBe(false);
    expect(ragQuerySchema.safeParse({ query: 'q', k: 1.5 }).success).toBe(false);
  });

  it('strategy: только enum, llm: только local/cloud', () => {
    expect(ragQuerySchema.safeParse({ query: 'q', strategy: 'unknown' }).success).toBe(false);
    expect(ragQuerySchema.safeParse({ query: 'q', strategy: 'notes' }).success).toBe(true);
    expect(ragQuerySchema.safeParse({ query: 'q', llm: 'hybrid' }).success).toBe(false);
  });
});

describe('todoAddSchema', () => {
  it('пустой текст отклоняется, граница 500', () => {
    expect(todoAddSchema.safeParse({ text: ' ' }).success).toBe(false);
    expect(todoAddSchema.safeParse({ text: 'т'.repeat(500) }).success).toBe(true);
    expect(todoAddSchema.safeParse({ text: 'т'.repeat(501) }).success).toBe(false);
  });

  it('intervalHours: coerce, 1..168, только с recurring hourly по смыслу схемы', () => {
    expect(todoAddSchema.safeParse({ text: 'x', recurring: 'hourly', intervalHours: '24' }).success).toBe(true);
    expect(todoAddSchema.safeParse({ text: 'x', recurring: 'hourly', intervalHours: 0 }).success).toBe(false);
    expect(todoAddSchema.safeParse({ text: 'x', recurring: 'hourly', intervalHours: 169 }).success).toBe(false);
    expect(todoAddSchema.safeParse({ text: 'x', recurring: 'weekly', intervalHours: 2 }).success).toBe(true);
  });

  it('recurring: только enum или null', () => {
    expect(todoAddSchema.safeParse({ text: 'x', recurring: 'yearly' }).success).toBe(false);
    expect(todoAddSchema.safeParse({ text: 'x', recurring: null }).success).toBe(true);
  });
});

describe('chatSendSchema', () => {
  it('пробел отклоняется, границы 1..8000', () => {
    expect(chatSendSchema.safeParse({ text: ' ' }).success).toBe(false);
    expect(chatSendSchema.safeParse({ text: 'т'.repeat(8000) }).success).toBe(true);
    expect(chatSendSchema.safeParse({ text: 'т'.repeat(8001) }).success).toBe(false);
  });

  it('llm — только local/cloud', () => {
    expect(chatSendSchema.safeParse({ text: 'привет', llm: 'ollama' }).success).toBe(false);
    expect(chatSendSchema.safeParse({ text: 'привет', llm: 'cloud' }).success).toBe(true);
  });
});

describe('styleSampleSchema', () => {
  it('границы текста 1..4000 и blog 1..100', () => {
    expect(styleSampleSchema.safeParse({ text: '' }).success).toBe(false);
    expect(styleSampleSchema.safeParse({ text: 'т'.repeat(4000) }).success).toBe(true);
    expect(styleSampleSchema.safeParse({ text: 'т'.repeat(4001) }).success).toBe(false);
    expect(styleSampleSchema.safeParse({ text: 'x', blog: '' }).success).toBe(false);
    expect(styleSampleSchema.safeParse({ text: 'x', blog: 'b'.repeat(101) }).success).toBe(false);
    expect(styleSampleSchema.safeParse({ text: 'x', blog: 'lookatfacts' }).success).toBe(true);
  });
});

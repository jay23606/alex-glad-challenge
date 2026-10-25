// Прогон календарного расписания блогов (Сб/Вс, фиксированное локальное время).
// Отличается от AutomationRunner: там свежие RSS-новости каждые N минут, здесь —
// пост по теме расписания независимо от новостей. Слоты идемпотентны: повторный
// тик не создаёт дубль, ошибка ретраится до MAX_ATTEMPTS (blogSchedule.ts).
// DI: blogDb/store/client/getRule/publish инжектятся — тесты без сети и TG.

import type { LlmClient } from '../client.js';
import type { AutomationRuleRow } from '../automation.js';
import type { BlogDb, BlogRow } from '../db.js';
import type { ProfileManager } from '../profile.js';
import type { BlogScheduleRow, BlogScheduleStore, ScheduleSlot } from '../blogSchedule.js';
import { TopicPostWriter } from './topicWriter.js';
import { loadBlogProfile } from './automationRun.js';
import { publishPost, type PublishResult } from './telegram.js';

/** Публикация поста расписания: контент + блог + id созданного поста. */
export type SchedulePublish = (
  content: string,
  blog: BlogRow,
  postId: number,
) => Promise<PublishResult>;

export interface BlogScheduleRunnerOptions {
  readonly blogDb: BlogDb;
  readonly store: BlogScheduleStore;
  /** LLM-клиент или ленивый конструктор (web: ключей может не быть при старте). */
  readonly client: LlmClient | (() => LlmClient);
  readonly getRule: (blogId: number) => AutomationRuleRow | null;
  /** Публикация; по умолчанию publishPost(content, 'HTML', blogs.tg_chat_id). */
  readonly publish?: SchedulePublish;
  readonly profileDir?: string;
  readonly now?: () => Date;
  readonly windowMinutes?: number;
}

export interface ScheduleRunOutcome {
  readonly scheduleId: number;
  readonly blogId: number;
  readonly slotKey: string;
  readonly status: 'success' | 'error';
  readonly postId: number | null;
  readonly message: string;
}

export interface BlogScheduleRunner {
  /** Обработать все due-слоты; ошибка одного слота не рвёт остальные. */
  runDue(): Promise<ScheduleRunOutcome[]>;
}

function defaultTopic(blog: BlogRow, schedule: BlogScheduleRow): string {
  return schedule.topic.trim() || `Регулярный пост блога «${blog.name}»`;
}

export function createBlogScheduleRunner(
  opts: BlogScheduleRunnerOptions,
): BlogScheduleRunner {
  const now = opts.now ?? (() => new Date());
  const resolveClient = (): LlmClient =>
    typeof opts.client === 'function' ? opts.client() : opts.client;
  const publish: SchedulePublish =
    opts.publish ??
    ((content, blog) => publishPost(content, 'HTML', blog.tg_chat_id ?? undefined));

  async function runSlot(
    slot: ScheduleSlot,
    runId: number,
    profile: ProfileManager | null,
    blog: BlogRow,
  ): Promise<ScheduleRunOutcome> {
    let postId: number | null = null;
    try {
      const writer = new TopicPostWriter(resolveClient());
      const topic = defaultTopic(blog, slot.schedule);
      const variants = await writer.writeMany(opts.blogDb, blog, {
        topic,
        count: slot.schedule.variants,
        profile: profile ?? undefined,
      });
      const ids = variants.map((v) =>
        opts.blogDb.insertPost(v.content, null, null, blog.id, topic, v.variant),
      );
      postId = ids[0] ?? null;

      const rule = opts.getRule(blog.id);
      let published = false;
      if (rule && rule.auto_publish === 1) {
        const pub = await publish(variants[0].content, blog, ids[0]);
        if (!pub.ok) throw new Error(`Публикация не удалась: ${pub.error ?? 'unknown'}`);
        published = true;
      }

      const message = `Создано вариантов: ${ids.length}${
        published ? '; первый опубликован в TG' : ' (черновики)'
      }`;
      opts.store.finish(runId, 'success', postId, message, now());
      return {
        scheduleId: slot.schedule.id,
        blogId: slot.blogId,
        slotKey: slot.slotKey,
        status: 'success',
        postId,
        message,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      opts.store.finish(runId, 'error', postId, message, now());
      return {
        scheduleId: slot.schedule.id,
        blogId: slot.blogId,
        slotKey: slot.slotKey,
        status: 'error',
        postId,
        message,
      };
    }
  }

  /**
   * Ретрай после сбоя публикации: пост уже создан, заново генерировать не нужно
   * (иначе каждый тик плодил бы дубликаты черновиков). Генерация повторяется
   * только если предыдущая попытка не дошла до вставки поста.
   */
  async function retryExistingPost(
    slot: ScheduleSlot,
    runId: number,
    postId: number,
    blog: BlogRow,
  ): Promise<ScheduleRunOutcome> {
    try {
      const post = opts.blogDb.getPost(postId);
      if (!post) throw new Error('Ранее созданный пост не найден');
      const rule = opts.getRule(blog.id);
      let published = false;
      if (rule && rule.auto_publish === 1) {
        const pub = await publish(post.content, blog, post.id);
        if (!pub.ok) throw new Error(`Публикация не удалась: ${pub.error ?? 'unknown'}`);
        published = true;
      }
      const message = published
        ? 'Ранее созданный вариант опубликован в TG'
        : 'Черновик уже создан (без автопубликации)';
      opts.store.finish(runId, 'success', post.id, message, now());
      return {
        scheduleId: slot.schedule.id,
        blogId: slot.blogId,
        slotKey: slot.slotKey,
        status: 'success',
        postId: post.id,
        message,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      opts.store.finish(runId, 'error', postId, message, now());
      return {
        scheduleId: slot.schedule.id,
        blogId: slot.blogId,
        slotKey: slot.slotKey,
        status: 'error',
        postId,
        message,
      };
    }
  }

  return {
    async runDue(): Promise<ScheduleRunOutcome[]> {
      const slots = opts.store.due(now(), opts.windowMinutes ?? 180);
      const out: ScheduleRunOutcome[] = [];
      for (const slot of slots) {
        const runId = opts.store.claim(slot, now());
        if (runId === null) continue;

        const blog = opts.blogDb.getBlog(slot.blogId);
        if (!blog) {
          const message = `Блог ${slot.blogId} не найден`;
          opts.store.finish(runId, 'error', null, message, now());
          out.push({
            scheduleId: slot.schedule.id,
            blogId: slot.blogId,
            slotKey: slot.slotKey,
            status: 'error',
            postId: null,
            message,
          });
          continue;
        }

        const claimed = opts.store.getRun(runId);
        if (claimed?.post_id != null && opts.blogDb.getPost(claimed.post_id)) {
          out.push(await retryExistingPost(slot, runId, claimed.post_id, blog));
          continue;
        }

        const profile = loadBlogProfile(opts.profileDir, blog);
        out.push(await runSlot(slot, runId, profile, blog));
      }
      return out;
    },
  };
}

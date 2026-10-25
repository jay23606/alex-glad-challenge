// Расписание постов web: singleton BlogScheduleStore + runner поверх core.
// Хранилище отдельное (schedule.sqlite): календарные слоты живут независимо от
// интервальной автоматизации (automation.sqlite). При первом создании БД
// заводит храмовому блогу Сб+Вс 10:00 Europe/Moscow (черновики: auto_publish=0).
// Публикация — через publishToTelegram (outbox + человекочитаемые ошибки).
import 'server-only';

import {
  BlogScheduleStore,
  createBlogScheduleRunner,
  dataPath,
  type BlogScheduleRunner,
} from './challenge';
import { getBlogDb } from './db';
import { pickLlmClient } from './llm';
import { getAutomation } from './automation-service';
import { publishToTelegram } from './tg-publish';

const NEVSKY_SLUG = 'nevsky-hram';
const WEEKEND_DEFAULTS = [
  {
    dayOfWeek: 6,
    timeLocal: '10:00',
    timezone: 'Europe/Moscow',
    topic: 'Субботняя заметка: жизнь прихода, люди и события',
    variants: 1,
    enabled: true,
  },
  {
    dayOfWeek: 0,
    timeLocal: '10:00',
    timezone: 'Europe/Moscow',
    topic: 'Воскресная заметка: служба, Евангелие дня, мысли настоятеля',
    variants: 1,
    enabled: true,
  },
] as const;

let store: BlogScheduleStore | null = null;
let runner: BlogScheduleRunner | null = null;

function seedWeekendDefaults(target: BlogScheduleStore): void {
  const blog = getBlogDb().getBlogBySlug(NEVSKY_SLUG);
  if (!blog) return;
  target.replaceForBlog(blog.id, WEEKEND_DEFAULTS);
  const automation = getAutomation();
  if (!automation.getRule(blog.id)) {
    // Правило создаём выключенным: публикация расписания управляется его
    // auto_publish, а interval-новости для храма не нужны.
    automation.upsertRule(blog.id, { enabled: false, autoPublish: false });
  }
}

export function getBlogScheduleStore(): BlogScheduleStore {
  if (!store) {
    store = new BlogScheduleStore(dataPath('schedule.sqlite'));
    if (store.isNew) seedWeekendDefaults(store);
  }
  return store;
}

export function getBlogScheduleRunner(): BlogScheduleRunner {
  if (!runner) {
    runner = createBlogScheduleRunner({
      blogDb: getBlogDb(),
      store: getBlogScheduleStore(),
      client: () => pickLlmClient('cloud'),
      getRule: (blogId) => getAutomation().getRule(blogId),
      publish: async (content, blog, postId) => {
        const outcome = await publishToTelegram(
          content,
          'blog',
          postId,
          'HTML',
          blog.tg_chat_id ?? undefined,
        );
        return { ok: outcome.ok, messageId: outcome.messageId, error: outcome.error };
      },
    });
  }
  return runner;
}

/** Прогон due-слотов; ошибки слотов уже изолированы внутри runner. */
export async function runDueSchedules(): Promise<void> {
  await getBlogScheduleRunner().runDue();
}

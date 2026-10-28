// Общая фабрика блог-автоматизации (#78): один прогон блога для web и TG.
// Раньше логика дублировалась в web/lib/server/automation-service.ts и
// challenge/src/core/tg/automationRun.ts и уже расходилась (profile-паритет).
// Паритет поведения: pipeline (rss → новости → пост → фактчек) + профиль голоса
// блога (blogs.profile → <profileDir>/<name>.json) + публикация по auto_publish.
// Пресет стиля применяется в ядре (blogs.style_preset → PostWriter по blogId).
// DI: blogDb/client/getRule/publish инжектятся — тесты без сети и без TG.
// Ошибка публикации пробрасывается, чтобы BlogAutomation зафиксировал failed run.

import type { LlmClient } from '../client.js';
import type { AutomationRuleRow, BlogRunOutcome } from '../automation.js';
import type { BlogDb, BlogRow } from '../db.js';
import { ProfileManager } from '../profile.js';
import { dataPath } from '../paths.js';
import { runNewsPipeline } from './pipeline.js';
import { publishPost, type PublishResult } from './telegram.js';

/** Публикация поста: контент + блог (адаптеры берут chat_id из blogs.tg_chat_id). */
export type AutomationPublish = (
  content: string,
  blog: BlogRow,
) => Promise<PublishResult>;

export interface AutomationRunnerOptions {
  readonly blogDb: BlogDb;
  /** LLM-клиент или ленивый конструктор (web: ключей может не быть при инициализации адаптера). */
  readonly client: LlmClient | (() => LlmClient);
  /** Каталог профилей голоса; по умолчанию .data/profiles (паритет web и TG). */
  readonly profileDir?: string;
  /** Правило блога — источник auto_publish. Лениво: BlogAutomation создаётся поверх runner'а. */
  readonly getRule: (blogId: number) => AutomationRuleRow | null;
  /** Публикация; по умолчанию publishPost(content, 'HTML', blogs.tg_chat_id). */
  readonly publish?: AutomationPublish;
}

export interface AutomationRunner {
  runBlog(blogId: number): Promise<BlogRunOutcome>;
}

/**
 * Профиль по умолчанию: blogs.profile → <dir>/<name>.json; нет профиля/файла → null.
 * ProfileManager создаётся НА ВЫЗОВ: load() мутирует active-профиль, кэш одной
 * инстансы смешивал бы голоса при параллельных runBlog разных блогов
 * (writer читает profile.active после await'ов конвейера).
 */
export function loadBlogProfile(
  profileDir: string | undefined,
  blog: BlogRow,
): ProfileManager | null {
  if (!blog.profile) return null;
  const mgr = new ProfileManager(profileDir ?? dataPath('profiles'));
  return mgr.load(blog.profile) ? mgr : null;
}

/** Прогон блога: пост из свежих новостей + (auto_publish) публикация в TG. */
export function createAutomationRunner(
  opts: AutomationRunnerOptions,
): AutomationRunner {
  const resolveClient = (): LlmClient =>
    typeof opts.client === 'function' ? opts.client() : opts.client;
  const publish =
    opts.publish ??
    ((content, blog) =>
      publishPost(content, 'HTML', blog.tg_chat_id ?? undefined));

  return {
    async runBlog(blogId: number): Promise<BlogRunOutcome> {
      const blog: BlogRow | null = opts.blogDb.getBlog(blogId);
      if (!blog) throw new Error(`Блог ${blogId} не найден`);

      const result = await runNewsPipeline(opts.blogDb, resolveClient(), {
        blog,
        profile: loadBlogProfile(opts.profileDir, blog) ?? undefined,
      });
      if (!result.post) {
        return { postId: null, message: 'Свежих новостей нет — пост не создан' };
      }

      const content = result.post.content;
      const rule = opts.getRule(blogId);
      let published = false;
      if (rule && rule.auto_publish === 1) {
        const pub = await publish(content, blog);
        published = pub.ok;
        if (!pub.ok) throw new Error(`Публикация не удалась: ${pub.error}`);
      }

      return {
        postId: result.post.news.id,
        message: published
          ? 'Пост создан и опубликован в TG'
          : 'Пост создан (без автопубликации)',
      };
    },
  };
}

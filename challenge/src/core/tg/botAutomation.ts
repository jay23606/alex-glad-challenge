// Owner-команды блог-автоматизации бота «Медиум» (T2): /блоги и /авто.
// Вынесены из bot.ts, чтобы диспетчер оставался тонким (T9 light). BlogAutomation
// и BlogDb инжектятся узкими контрактами (тесты — без sqlite и сети); ошибки
// конвейера наружу — без URL/ключей (redactRunError).

import type { BlogAutomation, AutomationRuleRow, AutomationRunResult } from '../automation.js';
import type { BlogDb, BlogRow } from '../db.js';

/** Узкие контракты: только то, что нужно командам (подменяется фейками в тестах). */
export type AutomationCommandsSource = Pick<
  BlogAutomation,
  'getRule' | 'listRuns' | 'upsertRule' | 'runNow'
>;
export type BlogListSource = Pick<BlogDb, 'listBlogs'>;

export interface TopicPostRequest {
  readonly topic: string;
  readonly comment?: string;
  readonly variants: number;
  readonly publish: boolean;
}

export interface TopicPostResult {
  readonly ids: number[];
  readonly published: boolean;
  readonly message: string;
}

export type WriteTopicPost = (blog: BlogRow, req: TopicPostRequest) => Promise<TopicPostResult>;

export interface BotAutomationDeps {
  readonly automation: AutomationCommandsSource;
  readonly blogs: BlogListSource;
  readonly send: (chatId: string, text: string, replyTo?: number) => Promise<unknown>;
  /** Генерация поста по теме (общий LlmClient и BlogDb из createTgAutomationRunner). */
  readonly postTopic?: WriteTopicPost;
}

const AUTO_USAGE = 'Формат: /авто <блог> on|off|status|run (блог — slug или id; список: /блоги)';
const AUTO_ACTIONS = ['on', 'off', 'status', 'run'] as const;
const POST_USAGE =
  'Формат: /пост <блог> [publish] <тема> [| комментарий]\n' +
  'publish — сразу отправить в TG; без него создаётся черновик. Список блогов: /блоги';

export class BotAutomationCommands {
  constructor(private readonly d: BotAutomationDeps) {}

  /** /блоги — список блогов со статусом правила автоматизации. */
  async cmdBlogs(chatId: string, replyTo?: number): Promise<void> {
    const blogs = this.d.blogs.listBlogs();
    if (blogs.length === 0) {
      await this.d.send(chatId, 'Блогов пока нет.', replyTo);
      return;
    }
    const lines = blogs.map((b) => formatBlogLine(b, this.d.automation.getRule(b.id)));
    await this.d.send(chatId, `📚 Блоги:\n${lines.join('\n')}`, replyTo);
  }

  /** /авто <блог> on|off|status|run — правило автоматизации и ручной запуск конвейера. */
  async cmdAuto(args: string, chatId: string, replyTo?: number): Promise<void> {
    const [blogRef, actionRaw] = args.split(/\s+/).filter(Boolean);
    const action = AUTO_ACTIONS.find((a) => a === actionRaw);
    if (!blogRef || !action) {
      await this.d.send(chatId, AUTO_USAGE, replyTo);
      return;
    }
    const blog = this.resolveBlog(blogRef);
    if (!blog) {
      await this.d.send(chatId, `Блог «${blogRef}» не найден. Список: /блоги`, replyTo);
      return;
    }
    switch (action) {
      case 'status':
        await this.d.send(chatId, formatBlogStatus(blog, this.d.automation), replyTo);
        return;
      case 'on':
      case 'off': {
        const enabled = action === 'on';
        try {
          this.d.automation.upsertRule(blog.id, { enabled });
        } catch (err) {
          const reason = err instanceof Error ? err.message : 'unknown';
          await this.d.send(chatId, `⚠️ Не удалось обновить правило: ${redactRunError(reason)}`, replyTo);
          return;
        }
        const rule = this.d.automation.getRule(blog.id);
        await this.d.send(
          chatId,
          `✅ «${blog.name}»: автоматизация ${enabled ? 'включена' : 'выключена'}` +
            (rule ? ` (каждые ${rule.interval_minutes} мин, автопубликация ${rule.auto_publish === 1 ? 'вкл' : 'выкл'})` : ''),
          replyTo,
        );
        return;
      }
      case 'run': {
        await this.d.send(chatId, `⏳ Запускаю конвейер «${blog.name}»…`, replyTo);
        let result: AutomationRunResult;
        try {
          result = await this.d.automation.runNow(blog.id);
        } catch (err) {
          const reason = err instanceof Error ? err.message : 'automation failed';
          await this.d.send(chatId, `⚠️ «${blog.name}»: запуск упал — ${redactRunError(reason)}`, replyTo);
          return;
        }
        const icon = result.status === 'success' ? '✅' : '⚠️';
        await this.d.send(
          chatId,
          `${icon} «${blog.name}»: ${redactRunError(result.message)}`,
          replyTo,
        );
        return;
      }
    }
  }

  /**
   * /пост <блог> [publish] <тема> [| комментарий] — разовый/праздничный пост.
   * Без publish остаётся черновик; с publish первый вариант уходит в канал
   * блога (fallback TG_CHAT_ID). Генерация делегируется WriteTopicPost, чтобы
   * бот не создавал второй LLM-клиент.
   */
  async cmdPost(args: string, chatId: string, replyTo?: number): Promise<void> {
    const words = args.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      await this.d.send(chatId, POST_USAGE, replyTo);
      return;
    }
    const blogRef = words.shift()!;
    let publish = false;
    if (['publish', 'опубликовать', 'публик'].includes((words[0] ?? '').toLowerCase())) {
      publish = true;
      words.shift();
    }
    const rest = words.join(' ').trim();
    const sep = rest.indexOf('|');
    const topic = (sep >= 0 ? rest.slice(0, sep) : rest).trim();
    const comment = sep >= 0 ? rest.slice(sep + 1).trim() : '';
    if (topic.length < 3) {
      await this.d.send(chatId, POST_USAGE, replyTo);
      return;
    }

    const blog = this.resolveBlog(blogRef);
    if (!blog) {
      await this.d.send(chatId, `Блог «${blogRef}» не найден. Список: /блоги`, replyTo);
      return;
    }
    if (!this.d.postTopic) {
      await this.d.send(chatId, 'Автоматизация не сконфигурирована.', replyTo);
      return;
    }

    await this.d.send(
      chatId,
      `${publish ? 'Генерирую и публикую' : 'Генерирую черновик'} «${topic}» для «${blog.name}»…`,
      replyTo,
    );
    try {
      const result = await this.d.postTopic(blog, {
        topic,
        ...(comment ? { comment } : {}),
        variants: 1,
        publish,
      });
      const id = result.ids[0];
      const tail = id !== undefined ? ` (#${id})` : '';
      await this.d.send(
        chatId,
        result.published
          ? `✅ «${blog.name}»: пост опубликован в TG${tail}.`
          : `📝 «${blog.name}»: черновик создан${tail} — публикация не выполнялась.`,
        replyTo,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'post failed';
      await this.d.send(
        chatId,
        `⚠️ «${blog.name}»: не удалось создать пост — ${redactRunError(reason)}`,
        replyTo,
      );
    }
  }

  private resolveBlog(ref: string): BlogRow | null {
    const blogs = this.d.blogs.listBlogs();
    const byId = Number(ref);
    if (Number.isInteger(byId) && byId > 0) {
      return blogs.find((b) => b.id === byId) ?? null;
    }
    const lower = ref.toLowerCase();
    return blogs.find((b) => b.slug.toLowerCase() === lower) ?? null;
  }
}

function formatBlogLine(blog: BlogRow, rule: AutomationRuleRow | null): string {
  return `${blog.slug} (#${blog.id}) — «${blog.name}»: ${formatRuleStatus(rule)}`;
}

function formatRuleStatus(rule: AutomationRuleRow | null): string {
  if (!rule) return 'автоматизация выкл (правила нет)';
  const base = rule.enabled === 1 ? 'авто ВКЛ' : 'авто выкл';
  const details = `каждые ${rule.interval_minutes} мин, автопубликация ${rule.auto_publish === 1 ? 'вкл' : 'выкл'}`;
  const next =
    rule.enabled === 1 && rule.next_run_at
      ? `, след. запуск ${rule.next_run_at.slice(0, 16).replace('T', ' ')} UTC`
      : '';
  return `${base} (${details}${next})`;
}

function formatBlogStatus(blog: BlogRow, automation: AutomationCommandsSource): string {
  const rule = automation.getRule(blog.id);
  const lines = [`«${blog.name}» (${blog.slug}, #${blog.id}): ${formatRuleStatus(rule)}`];
  const last = automation.listRuns(30).find((r) => r.blog_id === blog.id);
  if (last) {
    const icon = last.status === 'success' ? '✅' : last.status === 'error' ? '⚠️' : '⏭';
    lines.push(
      `Последний запуск: ${icon} ${last.started_at.slice(0, 16).replace('T', ' ')} UTC — ${redactRunError(last.message)}`,
    );
  } else {
    lines.push('Запусков ещё не было.');
  }
  return lines.join('\n');
}

/** Тексты ошибок конвейера (LLM/сеть/TG) — режем URL, токены и длину. */
export function redactRunError(message: string): string {
  const clean = message
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .replace(/sk-[A-Za-z0-9_-]{4,}/g, 'sk-***');
  return clean.length > 200 ? `${clean.slice(0, 200)}…` : clean;
}

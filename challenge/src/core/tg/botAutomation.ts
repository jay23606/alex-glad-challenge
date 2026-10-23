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

export interface BotAutomationDeps {
  readonly automation: AutomationCommandsSource;
  readonly blogs: BlogListSource;
  readonly send: (chatId: string, text: string, replyTo?: number) => Promise<unknown>;
}

const AUTO_USAGE = 'Формат: /авто <блог> on|off|status|run (блог — slug или id; список: /блоги)';
const AUTO_ACTIONS = ['on', 'off', 'status', 'run'] as const;

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

// Core-раннер блог-автоматизации для TG-бота (#58): связывает BlogAutomation
// с блог-конвейером (rss → новости → пост → фактчек) и публикацией в TG.
// Пресет стиля применяется в ядре (blogs.style_preset → PostWriter по blogId) —
// здесь стиль вручную не трогаем. Ошибка публикации пробрасывается, чтобы
// BlogAutomation зафиксировал failed run (как в web-адаптере automation-service.ts).
// Единственное место TG-бота, знающее про LLM/TG-публикацию (тесты — без сети).

import { BlogDb } from '../db.js';
import type { BlogRow } from '../db.js';
import { LlmClient } from '../client.js';
import { BlogAutomation } from '../automation.js';
import type { BlogRunOutcome } from '../automation.js';
import { ProfileManager } from '../profile.js';
import { runNewsPipeline } from '../agents/pipeline.js';
import { publishPost } from '../agents/telegram.js';
import { dataPath } from '../paths.js';

export interface TgAutomationRunner {
  readonly automation: BlogAutomation;
  readonly blogs: BlogDb;
  close(): void;
}

/** Профиль голоса блога: blogs.profile → .data/profiles/<name>.json (паритет с web-адаптером). */
function loadBlogProfile(blog: BlogRow): ProfileManager | null {
  if (!blog.profile) return null;
  const mgr = new ProfileManager(dataPath('profiles'));
  return mgr.load(blog.profile) ? mgr : null;
}

/** Один прогон конвейера блога: пост + (auto_publish) публикация в TG. */
async function runBlogOnce(
  blogs: BlogDb,
  client: LlmClient,
  automation: BlogAutomation,
  blogId: number,
): Promise<BlogRunOutcome> {
  const blog: BlogRow | null = blogs.getBlog(blogId);
  if (!blog) throw new Error(`Блог ${blogId} не найден`);

  const result = await runNewsPipeline(blogs, client, {
    blog,
    profile: loadBlogProfile(blog) ?? undefined,
  });
  if (!result.post) {
    return { postId: null, message: 'Свежих новостей нет — пост не создан' };
  }

  const content = result.post.content;
  const rule = automation.getRule(blogId);
  let published = false;
  if (rule && rule.auto_publish === 1) {
    const pub = await publishPost(content, 'HTML', blog.tg_chat_id ?? undefined);
    published = pub.ok;
    if (!pub.ok) throw new Error(`Публикация не удалась: ${pub.error}`);
  }

  return {
    postId: result.post.news.id,
    message: published ? 'Пост создан и опубликован в TG' : 'Пост создан (без автопубликации)',
  };
}

/** Фабрика: BlogDb + LlmClient + BlogAutomation поверх .data/*.sqlite. */
export function createTgAutomationRunner(): TgAutomationRunner {
  const blogs = new BlogDb(dataPath('blog.sqlite'));
  const client = new LlmClient();
  const automation = new BlogAutomation(dataPath('automation.sqlite'), {
    runBlog: (blogId): Promise<BlogRunOutcome> => runBlogOnce(blogs, client, automation, blogId),
    blogExists: (id) => blogs.getBlog(id) !== null,
  });
  return {
    automation,
    blogs,
    close(): void {
      automation.close();
      blogs.close();
    },
  };
}

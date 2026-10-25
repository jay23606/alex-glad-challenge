// TG-раннер блог-автоматизации (#58): тонкая обёртка над общей фабрикой
// createAutomationRunner (#78) — pipeline + профиль голоса + публикация в TG
// по auto_publish живут в ядре (core/agents/automationRun.ts), здесь только
// сборка BlogDb + LlmClient + BlogAutomation поверх .data/*.sqlite.
// Пресет стиля применяется в ядре (blogs.style_preset → PostWriter по blogId) —
// стиль вручную не трогаем. Ошибка публикации пробрасывается фабрикой, чтобы
// BlogAutomation зафиксировал failed run (паритет с web-адаптером).
// Единственное место TG-бота, знающее про LLM/TG-публикацию (тесты — без сети).

import type { BlogRow } from '../db.js';
import { BlogDb } from '../db.js';
import { LlmClient } from '../client.js';
import { BlogAutomation } from '../automation.js';
import { createAutomationRunner, loadBlogProfile } from '../agents/automationRun.js';
import { publishPost } from '../agents/telegram.js';
import { TopicPostWriter } from '../agents/topicWriter.js';
import type { WriteTopicPost } from './botAutomation.js';
import { dataPath } from '../paths.js';

export interface TgAutomationRunner {
  readonly automation: BlogAutomation;
  readonly blogs: BlogDb;
  /** /пост: тот же BlogDb/LlmClient, что и автоматизация (без второго клиента). */
  readonly writeTopicPost: WriteTopicPost;
  close(): void;
}

/** Фабрика: BlogDb + LlmClient + BlogAutomation поверх .data/*.sqlite. */
export function createTgAutomationRunner(): TgAutomationRunner {
  const blogs = new BlogDb(dataPath('blog.sqlite'));
  const client = new LlmClient();
  let automation: BlogAutomation;
  const runner = createAutomationRunner({
    blogDb: blogs,
    client,
    getRule: (blogId) => automation.getRule(blogId),
  });
  automation = new BlogAutomation(dataPath('automation.sqlite'), {
    runBlog: (blogId) => runner.runBlog(blogId),
    blogExists: (id) => blogs.getBlog(id) !== null,
  });

  let topicWriter: TopicPostWriter | null = null;
  const writeTopicPost: WriteTopicPost = async (blog: BlogRow, req) => {
    if (!topicWriter) topicWriter = new TopicPostWriter(client);
    const profile = loadBlogProfile(undefined, blog);
    const posts = await topicWriter.writeMany(blogs, blog, {
      topic: req.topic,
      comment: req.comment,
      count: req.variants,
      profile: profile ?? undefined,
    });
    const ids = posts.map((p) =>
      blogs.insertPost(p.content, null, null, blog.id, req.topic, p.variant),
    );
    if (req.publish) {
      const pub = await publishPost(posts[0].content, 'HTML', blog.tg_chat_id ?? undefined);
      if (!pub.ok) throw new Error(`Публикация не удалась: ${pub.error ?? 'unknown'}`);
    }
    return {
      ids,
      published: req.publish,
      message: req.publish
        ? 'Пост создан и опубликован в TG'
        : 'Пост создан (без публикации)',
    };
  };

  return {
    automation,
    blogs,
    writeTopicPost,
    close(): void {
      automation.close();
      blogs.close();
    },
  };
}

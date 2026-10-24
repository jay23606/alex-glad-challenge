// TG-раннер блог-автоматизации (#58): тонкая обёртка над общей фабрикой
// createAutomationRunner (#78) — pipeline + профиль голоса + публикация в TG
// по auto_publish живут в ядре (core/agents/automationRun.ts), здесь только
// сборка BlogDb + LlmClient + BlogAutomation поверх .data/*.sqlite.
// Пресет стиля применяется в ядре (blogs.style_preset → PostWriter по blogId) —
// стиль вручную не трогаем. Ошибка публикации пробрасывается фабрикой, чтобы
// BlogAutomation зафиксировал failed run (паритет с web-адаптером).
// Единственное место TG-бота, знающее про LLM/TG-публикацию (тесты — без сети).

import { BlogDb } from '../db.js';
import { LlmClient } from '../client.js';
import { BlogAutomation } from '../automation.js';
import { createAutomationRunner } from '../agents/automationRun.js';
import { dataPath } from '../paths.js';

export interface TgAutomationRunner {
  readonly automation: BlogAutomation;
  readonly blogs: BlogDb;
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
  return {
    automation,
    blogs,
    close(): void {
      automation.close();
      blogs.close();
    },
  };
}

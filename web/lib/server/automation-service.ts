// Адаптер автоматизации (web): тонкая обёртка над общей фабрикой
// createAutomationRunner (#78, см. challenge/src/core/agents/automationRun.ts) —
// конвейер поста, профиль голоса блога и публикация в TG по auto_publish живут
// в ядре. runBlog инжектится в BlogAutomation; getRule связывается лениво
// (singleton создаётся поверх runner'а). Здесь — только сборка зависимостей web.

import 'server-only';

import { BlogAutomation, createAutomationRunner, dataPath } from './challenge';
import { getBlogDb } from './db';
import { pickLlmClient } from './llm';

let automation: BlogAutomation | null = null;

export function getAutomation(): BlogAutomation {
  if (!automation) {
    const runner = createAutomationRunner({
      blogDb: getBlogDb(),
      // Лениво: LlmClient() без ключей бросает, а getAutomation() дергают
      // GET-маршруты без LLM — клиент резолвится на прогон (как раньше).
      client: () => pickLlmClient('cloud'),
      getRule: (blogId) => automation?.getRule(blogId) ?? null,
    });
    automation = new BlogAutomation(dataPath('automation.sqlite'), {
      runBlog: (blogId) => runner.runBlog(blogId),
      blogExists: (id) => getBlogDb().getBlog(id) !== null,
    });
  }
  return automation;
}

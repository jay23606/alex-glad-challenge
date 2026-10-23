// Адаптер автоматизации: связывает core BlogAutomation с блог-конвейером
// и публикацией в TG. Стиль блога (пресет Антонова) применяется в ядре:
// blogs.style_preset → PostWriter (см. challenge/src/core/stylePreset.ts).
// runBlog инжектится в BlogAutomation; здесь — единственное место, где
// автоматизация знает про LLM/TG/профили (тесты core не ходят в сеть).

import 'server-only';

import { BlogAutomation, dataPath, publishPost, runNewsPipeline } from './challenge';
import type { BlogRunOutcome, BlogRow } from './challenge';
import { getBlogDb } from './db';
import { loadBlogProfile } from './blogs';
import { pickLlmClient } from './llm';

let automation: BlogAutomation | null = null;

async function runBlogForAutomation(blogId: number): Promise<BlogRunOutcome> {
  const blogDb = getBlogDb();
  const blog: BlogRow | null = blogDb.getBlog(blogId);
  if (!blog) throw new Error(`Блог ${blogId} не найден`);

  const client = pickLlmClient('cloud');
  const result = await runNewsPipeline(blogDb, client, {
    blog,
    profile: loadBlogProfile(blog) ?? undefined,
  });

  if (!result.post) {
    return { postId: null, message: 'Свежих новостей нет — пост не создан' };
  }

  const content = result.post.content;

  const rule = getAutomation().getRule(blogId);
  let published = false;
  if (rule && rule.auto_publish === 1) {
    const pub = await publishPost(content, 'HTML', blog.tg_chat_id ?? undefined);
    published = pub.ok;
    if (!pub.ok) throw new Error(`Публикация не удалась: ${pub.error}`);
  }

  return {
    postId: result.post.news?.id ?? null,
    message: published ? 'Пост создан и опубликован в TG' : 'Пост создан (без автопубликации)',
  };
}

export function getAutomation(): BlogAutomation {
  if (!automation) {
    automation = new BlogAutomation(dataPath('automation.sqlite'), {
      runBlog: runBlogForAutomation,
      blogExists: (id) => getBlogDb().getBlog(id) !== null,
    });
  }
  return automation;
}

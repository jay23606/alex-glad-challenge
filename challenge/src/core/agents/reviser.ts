// Агент 4. Ревизор (Reviser).
// Получает пост + verdict фактчекера + issues.
// Решает: переписать пост с учётом правок, или рекомендовать смену новости.
// Если verdict = needs_revision и issues medium/high → переписывает.
// Если issues все high (фактчекер нашёл критические ошибки) → рекомендует сменить новость.
// Переписанный пост отправляется обратно на фактчекинг.

import type { NewsRow } from '../db.js';
import type { LlmClient } from '../client.js';
import type { ProfileManager } from '../profile.js';
import type { FactCheckResult } from './factChecker.js';
import { rewritePost } from './postWriter.js';

export interface RevisionResult {
  action: 'rewritten' | 'switch_news';
  postContent: string;
  reason: string;
  issuesAddressed: string[];
}

export class Reviser {
  constructor(
    private client: LlmClient,
    private profile?: ProfileManager,
  ) {}

  // Решает и выполняет: переписать или сменить новость.
  async revise(
    postContent: string,
    news: NewsRow,
    factCheck: FactCheckResult,
  ): Promise<RevisionResult> {
    const highIssues = factCheck.issues.filter((i) => i.severity === 'high');
    const mediumIssues = factCheck.issues.filter((i) => i.severity === 'medium');

    // Если все факты критически неверны — лучше сменить новость.
    if (highIssues.length >= 2 && mediumIssues.length === 0 && factCheck.issues.length >= 2) {
      return {
        action: 'switch_news',
        postContent: '',
        reason: `Слишком много критических ошибок (${highIssues.length} high). Пост не спасти — лучше взять другую новость.`,
        issuesAddressed: [],
      };
    }

    // Иначе — переписываем с учётом issues.
    const editInstruction = this.buildEditInstruction(factCheck);
    const rewritten = await rewritePost(
      this.client,
      postContent,
      editInstruction,
      news,
      this.profile,
    );

    const issuesAddressed = factCheck.issues.map(
      (i) => `[${i.severity}] ${i.claim} → исправлено`,
    );

    return {
      action: 'rewritten',
      postContent: rewritten,
      reason: `Переписан с учётом ${factCheck.issues.length} правок фактчекера.`,
      issuesAddressed,
    };
  }

  private buildEditInstruction(fc: FactCheckResult): string {
    const parts: string[] = [];

    if (fc.recommendation) {
      parts.push(`Рекомендация фактчекера: ${fc.recommendation}`);
    }

    for (const issue of fc.issues) {
      parts.push(
        `ИСПРАВЬ [${issue.severity}]: ${issue.claim}. ` +
        `Источник: ${issue.source}. ` +
        `Устрани это расхождение.`,
      );
    }

    // Если есть общая рекомендация — добавим.
    parts.push('Сохрани стиль, шапку и подпись. Не выдумывай новые факты.');

    return parts.join('\n');
  }
}

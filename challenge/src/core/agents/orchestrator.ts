// Агент-оркестратор: собирает топ от 3 параллельных агентов,
// через LLM выбирает финальный топ-3 самых горячих тем.
// Знает запрос пользователя (что ищем), но каждый агент видит только свой скоуп.

import type { LlmClient } from '../client.js';
import { msg } from '../types.js';
import type { SourceAgentResult, TrendingTopic } from './sourceAgent.js';

export interface OrchestratorResult {
  ranked: Array<TrendingTopic & { orchestratorScore: number; orchestratorReason: string }>;
  rawResults: SourceAgentResult[];
}

export class Orchestrator {
  constructor(private client: LlmClient) {}

  async decide(
    results: SourceAgentResult[],
    userQuery: string,
    topK: number = 3,
  ): Promise<OrchestratorResult> {
    // Собираем все темы в один компактный список.
    const allTopics: Array<{ idx: string; topic: TrendingTopic }> = [];
    for (const r of results) {
      for (let i = 0; i < r.topics.length; i++) {
        const t = r.topics[i];
        allTopics.push({ idx: `${r.agent}-${i}`, topic: t });
      }
    }

    if (allTopics.length === 0) {
      return { ranked: [], rawResults: results };
    }

    // Компактный список для LLM — только заголовки + hype + источник.
    const lines = allTopics.map(({ idx, topic }) => {
      const hype = topic.hypeScore > 0 ? ` [${topic.hypeScore}] ${topic.hypeReason}` : '';
      return `${idx}: (${topic.source}) ${topic.title}${hype}`;
    });

    const prompt = `Ты спортивный редактор-оркестратор. Тебе пришли темы от трёх источников.

ЗАПРОС ПОЛЬЗОВАТЕЛЯ: ${userQuery}

ИСТОЧНИКИ И ТЕМЫ:
${lines.join('\n')}

Выбери ТОП-${topK} самых актуальных и обсуждаемых тем, которые лучше всего подходят для поста.
Учитывай: совпадения между источниками (одна тема в RSS и Reddit = высокий приоритет),
количество обсуждений (reactions, comments, upvotes), и релевантность запросу.

Ответь СТРОГО JSON-массивом. ПЕРВЫЙ СИМВОЛ — "[".
[{"idx": "rss-0", "score": 95, "reason": "Тема везде обсуждается"}]

idx — точный индекс из списка выше. score — 0-100. reason — почему.`;

    const raw = await this.client.chat(
      [msg.user(prompt)],
      { temperature: 0.2, maxTokens: 1500 },
    );

    const picks = this.parsePicks(raw, allTopics);

    return { ranked: picks, rawResults: results };
  }

  private parsePicks(
    raw: string,
    allTopics: Array<{ idx: string; topic: TrendingTopic }>,
  ): Array<TrendingTopic & { orchestratorScore: number; orchestratorReason: string }> {
    // Снять markdown обёртку.
    const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1) return [];

    try {
      const arr = JSON.parse(cleaned.slice(start, end + 1)) as Array<{
        idx: string;
        score: number;
        reason: string;
      }>;

      const topicMap = new Map(allTopics.map((t) => [t.idx, t.topic]));

      return arr
        .filter((p) => topicMap.has(p.idx))
        .map((p) => {
          const t = topicMap.get(p.idx)!;
          return {
            ...t,
            orchestratorScore: p.score,
            orchestratorReason: p.reason,
          };
        });
    } catch {
      return [];
    }
  }
}

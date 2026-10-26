// Pipeline этапа 1: параллельный сбор + оркестратор.
// 3 агента работают одновременно (Promise.all),
// каждый видит только свой источник.
// Оркестратор ждёт всех, выбирает финальный топ-3.

import type { BlogDb } from '../db.js';
import type { LlmClient } from '../client.js';
import { DATA_DIR } from '../paths.js';
import type { SourceAgent } from './sourceAgent.js';
import { RssSourceAgent } from './rssSource.js';
import { ForumScannerAgent } from './forumScanner.js';
import { TelegramScannerAgent, type AskFn } from './telegramScanner.js';
import { Orchestrator, type OrchestratorResult } from './orchestrator.js';

export async function runSourceAgents(
  db: BlogDb,
  client: LlmClient,
  opts: {
    maxAgeHours?: number;
    userQuery?: string;
    topK?: number;
    enableTelegram?: boolean;
    enableForum?: boolean;
    sessionDir?: string;
    ask?: AskFn;
    signal?: AbortSignal;
    /** Прогресс в sink вызова (CLI/REPL = console.log). Default — тишина:
     * вызывается из web SSE, шуметь в stdout сервера нельзя (§8.2). */
    log?: (line: string) => void;
  } = {},
): Promise<OrchestratorResult> {
  const maxAgeHours = opts.maxAgeHours ?? 24;
  const topK = opts.topK ?? 3;
  const userQuery = opts.userQuery ?? 'самые горячие футбольные новости';
  const log = opts.log ?? (() => {});

  // Создаём агентов.
  const agents: SourceAgent[] = [
    new RssSourceAgent(db, maxAgeHours, 10),
  ];

  if (opts.enableForum !== false) {
    agents.push(new ForumScannerAgent(10));
  }

  if (opts.enableTelegram !== false) {
    // sessionDir по умолчанию — DATA_DIR (cwd-независимо, см. paths.ts). Раньше был
    // literal '.data' (cwd-relative) — работал только при запуске из challenge/.
    const tgAgent = new TelegramScannerAgent(opts.sessionDir ?? DATA_DIR, opts.ask);
    agents.push(tgAgent);
  }

  log(`[stage1] Запуск ${agents.length} агентов параллельно...`);

  // Параллельный запуск всех агентов.
  const results = await Promise.all(
    agents.map(async (agent) => {
      log(`[stage1] ${agent.name}: старт...`);
      const result = await agent.fetch();
      log(`[stage1] ${agent.name}: ${result.topics.length} тем${result.error ? ` (ошибка: ${result.error})` : ''}`);
      return result;
    }),
  );

  // Отключаем Telegram-клиент если был.
  for (const agent of agents) {
    if (agent instanceof TelegramScannerAgent) {
      await agent.disconnect();
    }
  }

  // Оркестратор: LLM выбирает финальный топ.
  // follow-up P5 В3: coarse-abort — если клиент ушёл (SSE disconnect) во время сбора,
  // не запускаем тяжёлый LLM-шаг оркестратора. source-агенты не стримят через chatStream,
  // поэтому fetch-abort тут не действует (только guard между стадиями).
  opts.signal?.throwIfAborted();
  log(`[stage1] Оркестратор: выбор топ-${topK}...`);
  const orchestrator = new Orchestrator(client);
  const orchResult = await orchestrator.decide(results, userQuery, topK);

  log(`[stage1] Оркестратор: выбрано ${orchResult.ranked.length} тем`);
  for (const r of orchResult.ranked) {
    log(`  [${r.orchestratorScore}] (${r.source}) ${r.title}`);
    log(`    ${r.orchestratorReason}`);
  }

  return orchResult;
}

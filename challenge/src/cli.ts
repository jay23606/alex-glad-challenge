// CLI монолита.
//
// Использование:
//   pnpm --filter challenge start                      # интерактивный REPL с агентом
//   pnpm --filter challenge start -- chat              # тот же REPL (по умолчанию)
//   pnpm --filter challenge start -- chat --strategy sliding
//   pnpm --filter challenge start -- chat --system "Ты ревьюер"
//   pnpm --filter challenge start -- list              # список всех демо
//   pnpm --filter challenge start -- day-03            # прогнать демо конкретного дня
//   pnpm --filter challenge start -- latest            # прогнать последний день
//   pnpm --filter challenge start -- news              # блог-pipeline: rss → 3 агента → пост
//   pnpm --filter challenge start -- news --hours 48
//   pnpm --filter challenge start -- news --publish     # опубликовать пост в Telegram
//   pnpm --filter challenge start -- seed-style        # залить образцы стиля в БД
//   pnpm --filter challenge start -- help

import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';

import { loadEnvUpward } from './core/env.js';
import { dataPath } from './core/paths.js';
loadEnvUpward();

import { demos, findDemo, latestDemo } from './demos/registry.js';
import { runServer } from './demos/day-17-server.js';
import { runServer as runDay18Server } from './demos/day-18-server.js';
import { runDay20Server } from './demos/day-20-server.js';
import { runDay25Server } from './demos/day-25-server.js';
import { runDay20 } from './demos/day-20.js';
import { startRepl } from './repl.js';
import { BlogDb, LlmClient, ProfileManager } from './core/index.js';
import { runNewsPipeline } from './core/agents/pipeline.js';
import { seedStyleSamples } from './core/agents/seed.js';
import { publishPost, isTelegramConfigured } from './core/agents/telegram.js';
import { McpHttpClient } from './core/mcpHttpClient.js';
import { parseTodoArgs } from './core/todoParser.js';
import { runAgentRequest } from './core/mcpAgentLoop.js';
import { runAssistantServer } from './core/assistantMcp.js';
import { indexDocsCorpus, askDevAssistant, CLOUD_DOWN_MESSAGE } from './core/rag/devAssistant.js';
import { reviewPr } from './core/rag/prReview.js';
import { findRepoRoot } from './core/rag/docsCorpus.js';
import { runCrmServer } from './core/crmMcp.js';
import { CrmDb } from './core/crmDb.js';
import { askSupportAssistant, buildFaqChunks } from './core/support/supportAssistant.js';
import { seedSupport } from './core/support/faqSeed.js';
import { runFileServer } from './core/fileMcp.js';
import { runFindUsages, runUpdateDocs } from './core/fileAssistant.js';
import { runRefactor, runScaffold, runClassify } from './core/fileAgent.js';
import { GuardError } from './core/fileGuard.js';
import {
  RagStore,
  Retriever,
  makeEmbedder,
  makeLocalLlmClient,
  runIndexing,
  loadEval,
  runEval,
  runEvalAB,
  runEvalDay24,
  answerWithRag,
  answerNoRag,
  DEFAULT_RAG_THRESHOLD,
  saveChatTitle,
  loadChatTitles,
  loadAliases,
  addAlias,
  removeAlias,
  findAliasByChatKey,
  resolveChatRefForRepl,
} from './core/rag/index.js';
import type { ChunkingStrategy, RagOptions } from './core/rag/index.js';
import type { ChatSourceFilter, Embedder } from './core/rag/index.js';
import { getConnectedRawScanClient, isScanConfigured, disconnectScanClient } from './core/agents/telegramScan.js';
import type { RawTelegramClient } from './core/agents/telegramScan.js';
import {
  TgStore,
  resolveChatTopic,
  resolveChatKey,
  listForumTopicIds,
  parseChatTopicInput,
  probeTopic,
  probeTopicViaSearch,
  collectTopic,
  buildTopicChunks,
  assertDimCompatible,
} from './core/tg/index.js';
import type { ProbeMessage, ChatTopicRef, TgBuiltChunk } from './core/tg/index.js';
import { runTgBot } from './core/tg/bot.js';
import { runMaximBot } from './core/tg/maximBot.js';
import { indexDocuments, formatDuration } from './core/rag/pipeline.js';
import { embedConfigFromEnv } from './core/rag/index.js';
import { clean } from './core/sanitize.js';

const DB_PATH = dataPath('blog.sqlite');
const PROFILE_DIR = dataPath('profiles');
const RAG_DB_PATH = dataPath('rag.sqlite');
const RAG_DOCS_DIR = path.join(process.cwd(), 'src', 'data', 'rag-sample');
const RAG_EVAL_FILE = path.join(process.cwd(), 'src', 'data', 'rag-eval.json');
const TG_DB_PATH = dataPath('tg.sqlite');

function printHelp(): void {
  console.log('Использование:');
  console.log('  pnpm --filter challenge start -- <command>');
  console.log('');
  console.log('Команды:');
  console.log('  (без аргумента)  Интерактивный REPL с агентом (вариант B)');
  console.log('  chat             То же самое — глобальный чат, внутри: /day, /strategy, /usage');
  console.log('    --strategy <name>  стартовая стратегия: full | sliding | sticky | branching');
  console.log('    --system <text>    стартовый system-промпт');
  console.log('  list             Список всех дней');
  console.log('  latest           Прогнать последний день');
  console.log('  day-NN           Прогнать демо конкретного дня (day-01, day-14, day-15, ...)');
  console.log('                   ВАЖНО: дефис, не пробел! "day-14" — верно, "day 14" — не сработает.');
  console.log('  news             Блог-pipeline: RSS → агент 1 → агент 2 → агент 3');
  console.log('    --hours <N>        окно свежести (по умолчанию 24)');
  console.log('    --top <N>          сколько топ-новостей брать (по умолчанию 5)');
  console.log('    --for <i>          индекс новости из топа для поста (0 = самая хайповая)');
  console.log('    --publish          опубликовать готовый пост в Telegram (только если verdict=ok)');
  console.log('  seed-style       Залить образцы стиля канала в БД (один раз)');
  console.log('  db-stats         Статистика БД: сколько новостей/постов/образцов');
  console.log('  rag index [path] Индексировать каталог документов в RAG-индекс (день 21, локальные эмбеддинги)');
  console.log('    --strategy <name>   только fixed | structure (по умолчанию обе)');
  console.log('  rag query "<q>"  Вопрос по индексу (день 22); нужен локальный LLM');
  console.log('    --no-rag            ответ без индекса (общие знания)');
  console.log('    --strategy <name>   fixed (по умолч.) | structure | telegram');
  console.log('    --k <N>             сколько чанков брать (по умолчанию 4)');
  console.log('    --chat <ref>        фильтр по чату (chatKey -100… | t.me/c/<id> | @username), только telegram');
  console.log('    --topic <id>        уточнить до топика (только вместе с --chat)');
  console.log('    --llm local|cloud   LLM для ответа (по умолч. local; cloud = DeepSeek/OpenRouter)');
  console.log('  rag index-tg <chat> [<topicId>]  TG-топик → length-чанки (склейка сообщ.) → RAG strategy=telegram');
  console.log('    --top <N>           tier1: top-N чанков по реакциям (по умолч. 1500), чистит telegram');
  console.log('    --rest              tier2: доклеить хвост (остальные чанки), НЕ чистит индекс');
  console.log('    --reset             полный reindex: пересобирает чанки RAG-индекса');
  console.log('    --limit <N>         ограничить collect (только smoke; на chunk-build не влияет)');
  console.log('  rag index-tg <chat>              ВЕСЬ чат: forum=все топики (GetForumTopics),');
  console.log('                                       не-forum=основной поток (topic_id=0). Только с --reset');
  console.log('  tg-collect <chat> [<topicId>]  Собрать forum-топик в .data/tg.sqlite (MTProto userbot)');
  console.log('    --probe             dry-run: проверить чтение топика (5 сообщ.), без записи');
  console.log('    --limit <N>         ограничить число сообщений (для --probe / smoke)');
  console.log('    --resume            продолжить прерванный сбор с курсора');
  console.log('    --reset             полный re-fetch: сброс курсора, сборка с нуля чата;');
  console.log('                        уже скачанные сообщения НЕ удаляются (upsert-дедуп)');
  console.log('  tg-top <chat> [<topicId>]  Топ сообщений по реакциям/дате (SQL над tg.sqlite, без сети)');
  console.log('    --by likes|date     сортировка (по умолч. likes)');
  console.log('    --limit <N>         сколько строк (по умолч. 20)');
  console.log('  tg-bot           Бот «Медиум» в чате «Факты в чате» (Bot API long polling, M1)');
  console.log('    --index-only       собрать/доклеить FTS-индекс (tg-fts.sqlite) и выйти, без сети');
  console.log('    --rebuild          полная перестройка FTS-индекса (можно вместе с --index-only)');
  console.log('  maxim-bot        Бот «Максим Артемьевич» (QA Lead front-back): напутствия в чат + капс при молчании');
  console.log('  rag eval         10 контрольных вопросов: RAG vs без RAG');
  console.log('  rag chat         Интерактивный RAG-сеанс: /chat /topic /local /cloud /list /alias /norag /help /quit');
  console.log('    --strategy <name>   стартовая стратегия (default fixed) | telegram (для --chat)');
  console.log('    --chat <ref>        стартовый TG-чат: chatKey | t.me/c/<id> | alias (force strategy=telegram)');
  console.log('    --topic <id>        стартовый topic (только вместе с --chat)');
  console.log('    --llm local|cloud   LLM для ответа (default local)');
  console.log('  mcp-server       Поднять локальный MCP HTTP-сервер (day-17)');
  console.log('    --port <N>         порт (по умолчанию 3001)');
  console.log('  scheduler        Поднять MCP-сервер day-18: TODO + MCP→MCP + фоновые напоминания');
  console.log('    --port <N>         порт (по умолчанию 3001)');
  console.log('  day-20-server    Поднять world-mcp + telegram-mcp (HTTP) для оркентсрации дня 20');
  console.log('    --port <N>         порт world-mcp (по умолчанию 3021); telegram-mcp = port+1');
  console.log('  day-25           RAG-чат с памятью задачи (REPL: история + цель/термины/ограничения)');
  console.log('  day-25-server    STDIO-MCP-сервер чата с RAG + памятью задачи (tools: chat, task-state)');
  console.log('  ask "<вопрос>"   Ответ ассистента о структуре репо (RAG docs → local draft → cloud refine)');
  console.log('  pr-review        AI-ревью Pull Request (diff → cloud Claude → markdown; для GitHub Action)');
  console.log('    --diff-file <path>     файл unified diff PR (обязательно; Action пишет сюда `gh pr diff`)');
  console.log('    --files <path>         файл со списком изменённых путей, по одному на строку (опц.)');
  console.log('    --out <path>           писать markdown в файл (default — stdout)');
  console.log('    --max-diff-bytes <N>   лимит длины diff, далее truncate (по умолч. 48000)');
  console.log('    --local                включить retrieval из индекса docs (Ollama) перед cloud-ревью');
  console.log('  rag index-docs   Индексировать кураторский корпус dev-assistant (README/AGENTS/docs → стратегия docs)');
  console.log('  assistant-server Поднять STDIO-MCP dev-assistant (tool: git_branch, read-only)');
  console.log('  support-seed     Залить CRM-демо-данные CloudNote (5 users + 5 tickets в blog.sqlite, идемпотентно)');
  console.log('  rag index-faq    Индексировать FAQ-корпус support-assistant (4 Q&A CloudNote → стратегия faq)');
  console.log('  support           Интерактивный режим: спросит email (login-gate по CRM) и вопрос');
  console.log('  support --list    Показать список пользователей CRM (id, name, email, plan)');
  console.log('  support --user <N> [--ticket <N>] "<вопрос>"');
  console.log('                   Legacy one-shot: ответ поддержки CloudNote (RAG faq → local draft → CRM через MCP → cloud refine)');
  console.log('  crm-server       Поднять STDIO-MCP crm-server (tools: get_user, get_ticket — read-only)');
  console.log('  file-server [--write]  Поднять STDIO-MCP file-server (file_search, file_read[ + file_write])');
  console.log('  files find <symbol>    Сценарий 1: найти использования символа (read-only, без cloud)');
  console.log('  files docs "<goal>" [--write]');
  console.log("                        Сценарий 2: обновить doc (README|AGENTS|docs/*) по цели;");
  console.log('                        default dry-run = unified diff; --write персистит.');
  console.log('  files refactor "<goal>" [--write]');
  console.log('                        Сценарий 3: refactor .ts в challenge/src/ (cloud draft + typecheck-rollback);');
  console.log('                        protected-set (cli/registry/env/client/types/sanitize/file*/mcp*) — отказ exit 3.');
  console.log('  files scaffold "<goal>" [--write]');
  console.log('                        Сценарий 4: создать новый .ts в challenge/src/utils/** (dry-run preview / --write);');
  console.log('                        не перезаписывает существующее, в registry не вписывается.');
  console.log('  files run "<goal>"    Сценарий 5: classify NL → docs|refactor|scaffold и делегировать (dry-run).');
  console.log('  day-20 [текст]   Оркестрация: filesystem-mcp (vault, stdio) + world-mcp. Текст = запрос');
  console.log('    --write           разрешить write_file и send_to_chat в Telegram (иначе dry-run)');
  console.log('  agent "<запрос>"  Юзер вводит запрос → агент сам гонит цепочку MCP-тулов на сервере');
  console.log('    --server <url>     переопределить сервер (по умолчанию api.memo7.ru)');
  console.log('');
  console.log('  Команды для MCP-сервера (по умолчанию: https://api.memo7.ru/mcp):');
  console.log('  todo <text>      Добавить задачу (разовая)');
  console.log('    --daily            повторять каждый день');
  console.log('    --weekly <day>     повторять раз в неделю (0=Вс … 6=Сб)');
  console.log('    --hourly [N]        повторять каждые N часов (по умолчанию 1)');
  console.log('  remind <text>    Добавить напоминание (синоним todo)');
  console.log('  todos [--pending|--done|--dismissed]');
  console.log('                   Список задач (опциональный фильтр по статусу)');
  console.log('  done <id>        Завершить задачу');
  console.log('  dismiss <id>     Отклонить задачу');
  console.log('  rm-todo <id>     Удалить задачу');
  console.log('  summary          Отправить сводку ожидающих задач в Telegram');
  console.log('  mcp <tool> [args...]');
  console.log('                   Вызвать любой MCP-инструмент напрямую');
  console.log('    --json             вывести сырой JSON-ответ');
  console.log('  mcp-tools        Список всех MCP-инструментов на сервере');
  console.log('    --server <url>     для todo/remind/mcp: переопределить URL');
  console.log('  help             Эта справка');
}

interface ChatFlags {
  strategy?: string;
  system?: string;
}

/** Парсит --port <N> из argv; возвращает default если флаг отсутствует. */
function parsePort(argv: string[], defaultPort: number): number {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isInteger(n) && n > 0 && n < 65536) return n;
    }
  }
  return defaultPort;
}

function parseChatFlags(argv: string[]): ChatFlags {
  const flags: ChatFlags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--strategy' && argv[i + 1]) { flags.strategy = argv[++i]; continue; }
    if (argv[i] === '--system' && argv[i + 1]) { flags.system = argv[++i]; continue; }
  }
  return flags;
}

// --- MCP-клиент: команды для общения с сервером ---

const DEFAULT_MCP_URL = process.env.MCP_SERVER_URL ?? 'https://api.memo7.ru/mcp';

/** Извлечь --server <url> из argv; возвращает tuple [url, remainder]. */
function parseServerUrl(argv: string[]): [string, string[]] {
  const idx = argv.indexOf('--server');
  if (idx >= 0 && argv[idx + 1]) {
    return [argv[idx + 1], [...argv.slice(0, idx), ...argv.slice(idx + 2)]];
  }
  return [DEFAULT_MCP_URL, argv];
}

/** Подключиться к MCP-серверу и вызвать tool. */
async function callMcpTool(serverUrl: string, toolName: string, args?: Record<string, unknown>): Promise<string> {
  const client = new McpHttpClient(serverUrl);
  try {
    await client.connect();
    const result = await client.callTool(toolName, args);
    return result;
  } finally {
    client.disconnect();
  }
}

/** Подключиться и вызвать tool, вернув сырой JSON-RPC response. */
async function callMcpToolRaw(serverUrl: string, toolName: string, args?: Record<string, unknown>): Promise<unknown> {
  const client = new McpHttpClient(serverUrl);
  try {
    await client.connect();
    // @ts-expect-error — доступ к внутреннему request для сырого ответа
    const resp = await client.request('tools/call', { name: toolName, arguments: args ?? {} });
    return resp;
  } finally {
    client.disconnect();
  }
}

async function runMcpCommand(argv: string[]): Promise<void> {
  const [serverUrl, rest] = parseServerUrl(argv);
  const cmd = rest[0];
  const tail = rest.slice(1);

  try {
    switch (cmd) {
      // --- todo / remind: добавить задачу ---
      case 'todo':
      case 'remind': {
        const { text, args: parsed } = parseTodoArgs(tail);
        if (!text) {
          console.error('Укажи текст задачи: pnpm start -- todo "Сделать зарядку"');
          process.exit(1);
        }

        const result = await callMcpTool(serverUrl, 'add_todo', parsed);
        console.log(result);
        break;
      }

      // --- todos: список ---
      case 'todos': {
        const status = tail.find((a) => a === '--pending' || a === '--done' || a === '--dismissed');
        const statusMap: Record<string, string> = { '--pending': 'pending', '--done': 'done', '--dismissed': 'dismissed' };
        const args = status ? { status: statusMap[status] } : {};
        const result = await callMcpTool(serverUrl, 'list_todos', args);
        console.log(result);
        break;
      }

      // --- done: завершить ---
      case 'done': {
        const id = Number(tail.filter((a) => !a.startsWith('--'))[0]);
        if (!id || isNaN(id)) {
          console.error('Укажи ID: pnpm start -- done 3');
          process.exit(1);
        }
        const result = await callMcpTool(serverUrl, 'complete_todo', { id });
        console.log(result);
        break;
      }

      // --- dismiss: отклонить ---
      case 'dismiss': {
        const id = Number(tail.filter((a) => !a.startsWith('--'))[0]);
        if (!id || isNaN(id)) {
          console.error('Укажи ID: pnpm start -- dismiss 3');
          process.exit(1);
        }
        const result = await callMcpTool(serverUrl, 'dismiss_todo', { id });
        console.log(result);
        break;
      }

      // --- rm-todo: удалить ---
      case 'rm-todo': {
        const id = Number(tail.filter((a) => !a.startsWith('--'))[0]);
        if (!id || isNaN(id)) {
          console.error('Укажи ID: pnpm start -- rm-todo 3');
          process.exit(1);
        }
        const result = await callMcpTool(serverUrl, 'delete_todo', { id });
        console.log(result);
        break;
      }

      // --- summary: отправить в Telegram ---
      case 'summary': {
        const result = await callMcpTool(serverUrl, 'send_summary', {});
        console.log(result);
        break;
      }

      // --- mcp: произвольный вызов ---
      case 'mcp': {
        const toolName = tail[0];
        if (!toolName) {
          console.error('Укажи имя инструмента: pnpm start -- mcp add_todo');
          process.exit(1);
        }
        const toolArgsRaw = tail.slice(1);
        let toolArgs: Record<string, unknown> = {};

        // Парсим key=value пары, иначе всё как строка
        if (toolArgsRaw.length > 0) {
          const jsonIdx = toolArgsRaw.indexOf('--json');
          const argsPart = jsonIdx >= 0 ? toolArgsRaw.slice(0, jsonIdx) : toolArgsRaw;
          const useJson = jsonIdx >= 0;

          if (argsPart.length === 1) {
            // Один аргумент — пытаемся распарсить как JSON, иначе как строку
            try {
              toolArgs = JSON.parse(argsPart[0]);
            } catch {
              toolArgs = { text: argsPart[0] };
            }
          } else {
            // Несколько аргументов — key=value
            for (const part of argsPart) {
              const eqIdx = part.indexOf('=');
              if (eqIdx > 0) {
                const key = part.slice(0, eqIdx);
                const val: unknown = part.slice(eqIdx + 1);
                // Пытаемся парсить значение
                try { toolArgs[key] = JSON.parse(val as string); } catch { toolArgs[key] = val; }
              }
            }
          }

          if (useJson) {
            const raw = await callMcpToolRaw(serverUrl, toolName, toolArgs);
            console.log(JSON.stringify(raw, null, 2));
          } else {
            const result = await callMcpTool(serverUrl, toolName, toolArgs);
            console.log(result);
          }
        } else {
          const result = await callMcpTool(serverUrl, toolName, {});
          console.log(result);
        }
        break;
      }

      // --- mcp-tools: список инструментов ---
      case 'mcp-tools': {
        const client = new McpHttpClient(serverUrl);
        try {
          await client.connect();
          const tools = await client.listTools();
          if (tools.length === 0) {
            console.log('Нет инструментов на сервере.');
          } else {
            console.log(`Инструменты (${tools.length}):`);
            for (const t of tools) {
              console.log(`  ${t.name}${t.description ? ` — ${t.description}` : ''}`);
            }
          }
        } finally {
          client.disconnect();
        }
        break;
      }

      default:
        console.error(`Неизвестная MCP-команда: ${cmd}`);
        process.exit(1);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`MCP ошибка: ${msg}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // pnpm в части версий передаёт `--` буквально (pnpm run start -- list);
  // ни одна команда не начинается с `--` — глотаем ведущий разделитель.
  if (argv[0] === '--') argv.shift();
  const arg = argv[0];

  // По умолчанию (без аргумента) или явный chat — запускаем REPL.
  if (!arg || arg === 'chat') {
    const flags = parseChatFlags(argv.slice(1));
    const client = new LlmClient();
    await startRepl(client, {
      strategyName: flags.strategy,
      systemPrompt: flags.system,
    });
    return;
  }

  if (arg === 'list') {
    console.log('Доступные демо:');
    for (const d of demos) {
      console.log(`  ${d.id}   ${d.title}`);
    }
    return;
  }

  if (arg === 'latest') {
    const demo = latestDemo();
    console.log(`▶ Запуск: ${demo.id} — ${demo.title}\n`);
    await demo.run();
    return;
  }

  if (arg === 'news') {
    await runNewsCommand(argv.slice(1));
    return;
  }

  if (arg === 'seed-style') {
    await runSeedStyleCommand();
    return;
  }

  if (arg === 'db-stats') {
    runDbStatsCommand();
    return;
  }

  if (arg === 'ask') {
    const question = argv.slice(1).join(' ').trim();
    if (!question) {
      console.error('Укажите вопрос: pnpm --filter challenge start -- ask "..."');
      process.exit(1);
    }
    await runAskCommand(question);
    return;
  }

  if (arg === 'pr-review') {
    await runPrReviewCommand(argv.slice(1));
    return;
  }

  if (arg === 'support') {
    const a = argv.slice(1);
    if (a.includes('--list')) {
      await runSupportListCommand();
    } else if (a.includes('--user')) {
      await runSupportCommand(a);
    } else {
      await runSupportInteractive();
    }
    return;
  }

  if (arg === 'support-seed') {
    await runSupportSeedCommand();
    return;
  }

  if (arg === 'crm-server') {
    console.log('▶ crm-server: STDIO-MCP-сервер (JSON-RPC over stdin/stdout, tools: get_user, get_ticket)');
    await runCrmServer();
    return;
  }

  if (arg === 'help' || arg === '--help' || arg === '-h') {
    printHelp();
    return;
  }

  if (arg === 'mcp-server') {
    const port = parsePort(argv.slice(1), 3001);
    console.log(`▶ MCP HTTP-сервер: старт на http://localhost:${port}/mcp`);
    console.log('  Инструменты: get_user_posts, get_todos, add_note, list_notes');
    console.log('');
    await runServer(port);
    return;
  }

  if (arg === 'scheduler') {
    const port = parsePort(argv.slice(1), 3001);
    console.log(`▶ Day-18 Scheduler MCP-сервер: старт на http://localhost:${port}/mcp`);
    await runDay18Server(port);
    return;
  }

  if (arg === 'day-20-server') {
    const port = parsePort(argv.slice(1), 3021);
    console.log(`▶ Day-20 world-mcp: старт на http://localhost:${port}/mcp`);
    await runDay20Server(port);
    return;
  }

  if (arg === 'day-25-server') {
    console.log('▶ Day-25 rag-chat: STDIO-MCP-сервер (JSON-RPC over stdin/stdout)');
    await runDay25Server();
    return;
  }

  if (arg === 'assistant-server') {
    console.log('▶ dev-assistant: STDIO-MCP-сервер (JSON-RPC over stdin/stdout, tool: git_branch)');
    await runAssistantServer();
    return;
  }

  if (arg === 'day-20') {
    const rest = argv.slice(1);
    const write = rest.includes('--write');
    const text = rest.filter((a) => a !== '--write').join(' ').trim();
    console.log(`▶ Day-20 оркестрация (${write ? 'write' : 'dry-run'})`);
    await runDay20(text || undefined, write);
    return;
  }

  if (arg === 'rag') {
    await runRagCommand(argv.slice(1));
    return;
  }

  if (arg === 'agent') {
    const [serverUrl, rest] = parseServerUrl(argv.slice(1));
    const request = rest.join(' ').trim();
    if (!request) {
      console.error(
        'Укажи запрос: pnpm --filter challenge start -- agent "просканируй последние 200 сообщений в чате \'факты в чате\' и пришли отчёт"',
      );
      process.exit(1);
    }
    console.log(`▶ Агент → ${serverUrl}`);
    console.log(`  запрос: ${request}\n`);
    const agentClient = new LlmClient();
    try {
      const answer = await runAgentRequest(agentClient, serverUrl, request);
      console.log(`\nОтвет: ${answer}`);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.error(`agent error: ${m}`);
      process.exit(1);
    }
    return;
  }

  // --- MCP-клиент команды ---
  if (['todo', 'remind', 'todos', 'done', 'dismiss', 'rm-todo', 'summary', 'mcp', 'mcp-tools'].includes(arg)) {
    await runMcpCommand(argv);
    return;
  }

  // --- TG-топик → tg.sqlite (НЕ день челленджа; до findDemo, чтобы не уйти в demo-dispatch) ---
  if (arg === 'tg-collect') {
    await runTgCollectCommand(argv.slice(1));
    return;
  }
  if (arg === 'tg-top') {
    await runTgTopCommand(argv.slice(1));
    return;
  }

  // --- Бот «Медиум» (M1): long polling Bot API, цитаты/сказал/игра из tg.sqlite ---
  if (arg === 'tg-bot') {
    const rest = argv.slice(1);
    await runTgBot({
      indexOnly: rest.includes('--index-only'),
      rebuildIndex: rest.includes('--rebuild'),
    });
    return;
  }

  // --- Бот «Максим Артемьевич» (QA Lead front-back): напутствия + капс при молчании ---
  if (arg === 'maxim-bot') {
    await runMaximBot();
    return;
  }

  if (arg === 'file-server') {
    const allowWrite = argv.slice(1).includes('--write');
    console.log(
      `▶ file-server: STDIO-MCP (tools: file_search, file_read${allowWrite ? ', file_write' : ''})`,
    );
    await runFileServer(allowWrite);
    return;
  }

  if (arg === 'files') {
    const sub = argv[1];
    if (sub === 'find') {
      const symbol = argv.slice(2).join(' ').trim();
      if (!symbol) {
        console.error('Укажите символ: files find "LlmClient"');
        process.exit(1);
      }
      await runFilesFindCommand(symbol);
      return;
    }
    if (sub === 'docs') {
      const rest = argv.slice(2);
      const write = rest.includes('--write');
      const goal = rest.filter((a) => a !== '--write').join(' ').trim();
      if (!goal) {
        console.error('Укажите цель: files docs "обновить README раздел про install" [--write]');
        process.exit(1);
      }
      await runFilesDocsCommand(goal, write);
      return;
    }
    if (sub === 'refactor') {
      const rest = argv.slice(2);
      const write = rest.includes('--write');
      const goal = rest.filter((a) => a !== '--write').join(' ').trim();
      if (!goal) {
        console.error(
          'Укажите цель: files refactor "переименуй X в challenge/src/core/memory.ts" [--write]',
        );
        process.exit(1);
      }
      await runFilesRefactorCommand(goal, write);
      return;
    }
    if (sub === 'scaffold') {
      const rest = argv.slice(2);
      const write = rest.includes('--write');
      const goal = rest.filter((a) => a !== '--write').join(' ').trim();
      if (!goal) {
        console.error('Укажите цель: files scaffold "создай утилиту string-utils" [--write]');
        process.exit(1);
      }
      await runFilesScaffoldCommand(goal, write);
      return;
    }
    if (sub === 'run') {
      const goal = argv.slice(2).join(' ').trim();
      if (!goal) {
        console.error(
          'Укажите цель: files run "обновить README | переименуй X | создай утилиту Y"',
        );
        process.exit(1);
      }
      await runFilesRunCommand(goal);
      return;
    }
    console.error(
      'Использование: files find <symbol> | files docs|refactor|scaffold "<goal>" [--write] | files run "<goal>"',
    );
    process.exit(1);
  }

  // Если это день из реестра — прогоняем демо.
  const demo = findDemo(arg);
  if (demo) {
    console.log(`▶ Запуск: ${demo.id} — ${demo.title}\n`);
    await demo.run();
    return;
  }

  console.error(`Неизвестная команда "${arg}".`);
  console.error('Доступные дни: ' + demos.map((d) => d.id).join(', '));
  console.error('Команды: chat, list, latest, news, seed-style, db-stats, rag, tg-collect, tg-top, tg-bot, maxim-bot, mcp-server, scheduler, day-20-server, day-20, todo, remind, todos, done, summary, mcp, mcp-tools, ask, support, support-seed, crm-server, file-server, files, help');
  process.exit(1);
}

// --- подкоманды для блога ---

interface NewsFlags { hours?: number; top?: number; forIndex?: number; publish?: boolean; }

function parseNewsFlags(argv: string[]): NewsFlags {
  const flags: NewsFlags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--hours' && argv[i + 1]) { flags.hours = Number(argv[++i]); continue; }
    if (argv[i] === '--top' && argv[i + 1]) { flags.top = Number(argv[++i]); continue; }
    if (argv[i] === '--for' && argv[i + 1]) { flags.forIndex = Number(argv[++i]); continue; }
    if (argv[i] === '--publish') { flags.publish = true; continue; }
  }
  return flags;
}

async function runNewsCommand(argv: string[]): Promise<void> {
  const flags = parseNewsFlags(argv);
  const client = new LlmClient();
  const db = new BlogDb(DB_PATH);
  try {
    console.log('▶ Блог-pipeline: RSS → агент 1 → агент 2 → агент 3\n');
    const profile = new ProfileManager(PROFILE_DIR);
    const names = profile.list();
    if (names.length > 0) {
      profile.load(names.includes('default') ? 'default' : names[0]);
    } else {
      profile.create('default');
    }
    const result = await runNewsPipeline(db, client, {
      maxAgeHours: flags.hours,
      topK: flags.top,
      writeForIndex: flags.forIndex,
      profile,
    });

    console.log('\n=== Топ-новости (агент 1) ===');
    for (const r of result.news.ranked) {
      console.log(`  [${r.score}] ${r.news.title}  (${r.why})`);
    }

    if (!result.post) {
      console.log('\nНет подходящих новостей для поста.');
      return;
    }

    console.log('\n=== Пост (агент 2) ===');
    console.log(result.post.content);

    if (result.factCheck) {
      console.log('\n=== Фактчекинг (агент 3) ===');

      // Chain-of-thought рассуждения агенту 3 — показать ход мысли.
      if (result.factCheck.reasoning.trim()) {
        console.log('\n--- ход рассуждений ---');
        console.log(result.factCheck.reasoning.trim());
        console.log('--- конец рассуждений ---\n');
      }

      console.log(`verdict: ${result.factCheck.verdict}`);
      console.log(`recommendation: ${result.factCheck.recommendation}`);
      if (result.factCheck.issues.length > 0) {
        console.log('issues:');
        for (const issue of result.factCheck.issues) {
          console.log(`  [${issue.severity}] ${issue.claim}`);
          console.log(`         vs: ${issue.source}`);
        }
      } else {
        console.log('issues: нет');
      }
    }

    // Публикация в Telegram (флаг --publish).
    if (flags.publish) {
      if (!isTelegramConfigured()) {
        console.log('\n[telegram] TG_BOT_TOKEN или TG_CHAT_ID не заданы в .env — пропуск.');
      } else if (result.factCheck && result.factCheck.verdict !== 'ok') {
        console.log('\n[telegram] verdict != ok — пост НЕ опубликован (нужна правка).');
      } else {
        console.log('\n[telegram] Публикую пост в канал...');
        const tg = await publishPost(result.post.content);
        if (tg.ok) {
          console.log(`[telegram] Пост опубликован (message_id=${tg.messageId}).`);
        } else {
          console.error(`[telegram] Ошибка: ${tg.error}`);
        }
      }
    }
  } finally {
    db.close();
  }
}

async function runSeedStyleCommand(): Promise<void> {
  const db = new BlogDb(DB_PATH);
  try {
    const added = await seedStyleSamples(db);
    console.log(`Залито образцов стиля: ${added}. Всего в БД: ${db.styleSamplesCount()}.`);
  } finally {
    db.close();
  }
}

function runDbStatsCommand(): void {
  const db = new BlogDb(DB_PATH);
  try {
    console.log(`news:           ${db.newsCount()}`);
    console.log(`posts:          ${db.postsCount()}`);
    console.log(`style_samples:  ${db.styleSamplesCount()}`);
  } finally {
    db.close();
  }
}

// --- RAG (дни 21–22): индекс / запрос / eval. Только локальные модели. ---

interface RagFlags {
  strategy?: ChunkingStrategy;
  k?: number;        // финальный topK (alias --topk)
  topk?: number;     // финальный topK (явный)
  pool?: number;     // candidate pool для retrieve
  threshold?: number;
  floor?: number;    // день 24: опц. floor для guard'а «не знаю» (minScore)
  rerank?: boolean;
  rewrite?: boolean;
  noRag?: boolean;
  ab?: boolean;
  set?: string;      // день 24: набор вопросов для eval ('day24' → rag-eval-day24.json)
  llm?: 'local' | 'cloud'; // RAG-LLM: default local (AC-C1), cloud = DEEPSEEK/OPENROUTER
  chat?: string;     // chat-фильтр: chatKey ('-100…') или chatRef (t.me/c/<id>, @username)
  topic?: number;    // опц. topicId, только вместе с --chat
}

function parseRagFlags(argv: string[]): { flags: RagFlags; rest: string[] } {
  const flags: RagFlags = {};
  const rest: string[] = [];
  const num = (v: string): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--strategy' && argv[i + 1]) {
      const v = argv[++i];
      if (v === 'fixed' || v === 'structure' || v === 'telegram') flags.strategy = v;
      continue;
    }
    if (a === '--k' && argv[i + 1]) { flags.k = num(argv[++i]); continue; }
    if (a === '--topk' && argv[i + 1]) { flags.topk = num(argv[++i]); continue; }
    if (a === '--pool' && argv[i + 1]) { flags.pool = num(argv[++i]); continue; }
    if (a === '--threshold' && argv[i + 1]) { flags.threshold = num(argv[++i]); continue; }
    if (a === '--floor' && argv[i + 1]) { flags.floor = num(argv[++i]); continue; }
    if (a === '--no-rag') { flags.noRag = true; continue; }
    if (a === '--rerank') { flags.rerank = true; continue; }
    if (a === '--no-rerank') { flags.rerank = false; continue; }
    if (a === '--rewrite') { flags.rewrite = true; continue; }
    if (a === '--no-rewrite') { flags.rewrite = false; continue; }
    if (a === '--ab') { flags.ab = true; continue; }
    if (a === '--set' && argv[i + 1]) { flags.set = argv[++i]; continue; }
    if (a === '--llm' && argv[i + 1]) {
      const v = argv[++i];
      if (v === 'local' || v === 'cloud') flags.llm = v;
      continue;
    }
    if (a === '--chat' && argv[i + 1]) { flags.chat = argv[++i]; continue; }
    if (a === '--topic' && argv[i + 1]) { flags.topic = num(argv[++i]); continue; }
    rest.push(a);
  }
  return { flags, rest };
}

// Собирает RagOptions из флагов. --topk имеет приоритет над --k; pool по умолч. 20
// (candidate pool для реранка/фильтра); threshold по умолч. DEFAULT_RAG_THRESHOLD.
function buildRagOpts(flags: RagFlags): RagOptions {
  return {
    k: flags.topk ?? flags.k ?? 4,
    pool: flags.pool ?? 20,
    threshold: flags.threshold ?? DEFAULT_RAG_THRESHOLD,
    rerank: flags.rerank ?? false,
    rewrite: flags.rewrite ?? false,
    minScore: flags.floor,
  };
}

// RAG-LLM по --llm: default local (как раньше, AC-C1), cloud = внешний LlmClient
// (DEEPSEEK/OPENROUTER). Эмбеддинги ВСЕГДА локальные — makeEmbedder() от --llm не
// зависит (критично: dim=4096). llm.ts НЕ правим (инвариант «СТРОГО локальный» для
// дней 21+ снимает только пользователь явным --llm cloud).
function makeRagLlmClient(pref: 'local' | 'cloud' | undefined): LlmClient {
  return pref === 'cloud' ? new LlmClient() : makeLocalLlmClient();
}

// Резолв --chat/--topic в ChatSourceFilter. Offline для numeric chatKey / t.me/c/<id>;
// @username/bare-name — через MTProto resolveChatKey (требует подключенный клиент).
// no-data guard (§2.6): 0 чанков этого chatKey в индексе → дружелюбная ошибка + exit(1).
// Возвращает undefined если фильтр не нужен (нет --chat, или strategy != telegram).
async function resolveChatFilter(
  flags: RagFlags,
  strategy: ChunkingStrategy,
  store: RagStore,
): Promise<ChatSourceFilter | undefined> {
  if (flags.topic != null && flags.chat == null) {
    console.error('--topic требует --chat: укажите --chat <chatKey|ref> вместе с --topic.');
    process.exit(1);
  }
  if (!flags.chat) return undefined;
  if (strategy !== 'telegram') {
    console.warn(
      `⚠️  --chat применяется только к strategy=telegram (сейчас ${strategy}) — игнорируется.`,
    );
    return undefined;
  }

  // 1. chatKey: offline для numeric / t.me/c/<id>; MTProto для @username/bare-name.
  const { peer, topicId: topicFromUrl } = parseChatTopicInput(flags.chat);
  let chatKey: string;
  if (/^-100\d+$/.test(peer)) {
    chatKey = peer;
  } else {
    if (!isScanConfigured()) {
      console.error(
        `Не удалось определить chatKey для "${flags.chat}" без MTProto. ` +
          'Используйте numeric chatKey (-100…) или t.me/c/<id>, либо настройте TG_API_ID/TG_API_HASH/TG_SESSION.',
      );
      process.exit(1);
    }
    const client = await getConnectedRawScanClient();
    if (!client) {
      console.error('Не удалось подключиться к MTProto для резолва chatKey.');
      process.exit(1);
    }
    try {
      const r = await resolveChatKey(client, flags.chat);
      chatKey = r.chatKey;
    } finally {
      await safeDisconnectScan();
    }
  }

  // 2. no-data guard: чанков этого chatKey нет в индексе → ненужный fallback на всю
  //    партицию (молчаливый). Лучше явная подсказка скачать+проиндексировать.
  if (store.countBySourcePrefix(strategy, chatKey) === 0) {
    console.error(
      `Нет данных по чату "${chatKey}". Сначала скачайте (` +
        `tg-collect ${flags.chat}${flags.topic != null ? ` ${flags.topic}` : ''}` +
        `), затем индексируйте (rag index-tg ${flags.chat}${flags.topic != null ? ` ${flags.topic}` : ''}).`,
    );
    process.exit(1);
  }

  const topicId = flags.topic ?? topicFromUrl;
  return topicId != null && Number.isFinite(topicId) ? { chatKey, topicId } : { chatKey };
}
function printRagStage(stage: { step: string; detail: Record<string, unknown> }): void {
  if (stage.step === 'rewrite') {
    const d = stage.detail as { original: string; rewritten: string };
    console.log(`  [rewrite] "${d.original}" → "${d.rewritten}"`);
  } else if (stage.step === 'retrieve') {
    const d = stage.detail as { query: string; pool: number };
    console.log(`  [retrieve] pool=${d.pool}`);
  } else if (stage.step === 'filter') {
    const d = stage.detail as { before: number; after: number; threshold: number };
    console.log(`  [filter] ${d.before} → ${d.after} (threshold=${d.threshold})`);
  } else if (stage.step === 'rerank') {
    const d = stage.detail as { before: number; after: number; fallback: boolean; rankDelta: number };
    console.log(`  [rerank] ${d.before} → ${d.after} (fallback=${d.fallback}, Δrank=${d.rankDelta.toFixed(2)})`);
  } else if (stage.step === 'guard') {
    const d = stage.detail as { reason: 'empty' | 'floor'; filteredSize: number; maxScore: number };
    console.log(`  [guard] gaveUp: ${d.reason} (filteredSize=${d.filteredSize}, maxScore=${d.maxScore.toFixed(3)})`);
  } else if (stage.step === 'llm') {
    const d = stage.detail as { topK: number };
    console.log(`  [llm] topK=${d.topK}`);
  }
}

// live-индикатор ожидания локальной модели в RAG-чате: крутится, пока идёт
// LLM-вызов, чтобы REPL не выглядел зависшим. stop() затирает линию пробелами
// (без ANSI — работает в любом терминале).
function startSpinner(label: string): { stop: () => void } {
  const frames = ['|', '/', '-', '\\'];
  let i = 0;
  let maxLen = 0;
  const render = (): void => {
    const s = `  ${label}… ${frames[i % frames.length]}`;
    if (s.length > maxLen) maxLen = s.length;
    process.stdout.write('\r' + s);
    i++;
  };
  render();
  const id = setInterval(render, 150);
  return {
    stop() {
      clearInterval(id);
      process.stdout.write('\r' + ' '.repeat(maxLen) + '\r');
    },
  };
}

// Non-fatal chat-фильтр для REPL `/chat` (R-1): fatal resolveChatFilter НЕ трогаем
// (AC-B5/B6 для rag query/eval остаются на exit-пути). Возвращает result, не process.exit.
function applyChatFilterForRepl(
  strategy: ChunkingStrategy,
  chatKey: string,
  topicId: number | undefined,
  store: RagStore,
): { ok: true; filter: ChatSourceFilter } | { ok: false; error: string } {
  if (strategy !== 'telegram') {
    return { ok: false, error: '/chat работает только при strategy=telegram.' };
  }
  if (store.countBySourcePrefix('telegram', chatKey) === 0) {
    const topicSuffix = topicId != null ? ` ${topicId}` : '';
    return {
      ok: false,
      error:
        `Нет данных по чату "${chatKey}". Сначала скачайте (tg-collect ${chatKey}${topicSuffix}), ` +
        `затем индексируйте (rag index-tg ${chatKey}${topicSuffix}).`,
    };
  }
  return {
    ok: true,
    filter: topicId != null && Number.isFinite(topicId) ? { chatKey, topicId } : { chatKey },
  };
}

function printReplChatHelp(): void {
  console.log('RAG-чат. Три независимых переключателя (не путать):');
  console.log('  • где ищем — стратегия: telegram (чаты) | fixed | structure (документы).');
  console.log('    Задаётся флагом --strategy на старте; /chat принудительно ставит telegram.');
  console.log('  • какая модель — /local (Ollama, по умолчанию) | /cloud (DeepSeek/OpenRouter).');
  console.log('  • RAG или нет — ищем с цитатами | /norag (модель напрямую, без базы и отсылок).');
  console.log('');
  console.log('Команды:');
  console.log('  /chat <name|ref>   фильтр telegram-чата: alias | title | -100… | t.me/c/<id>');
  console.log('                     (force strategy=telegram; без арг — показать текущий)');
  console.log('  /topic <id>        сузить до топика; /topic без арг — сброс (весь чат)');
  console.log('  /local  /cloud     переключить LLM');
  console.log('  /list              проиндексированные чаты (+ title, alias, число чанков)');
  console.log('  /alias add <name> <chatKey> [topicId]   /alias list   /alias rm <name>');
  console.log('  /norag             с RAG / без RAG');
  console.log('  /help  /quit       помощь / выход');
  console.log('');
  console.log('Документы (fixed/structure): /chat НЕ работает — стартуй с --strategy fixed.');
  console.log('Новый чат в индекс: rag index-tg <chatKey> БЕЗ topicId');
  console.log('  (с topicId снесёт ВСЕ telegram-чаты — известный баг).\n');
}

async function runAskCommand(question: string): Promise<void> {
  const store = new RagStore(RAG_DB_PATH);
  try {
    console.log(`▶ dev-assistant /ask: ${question}\n`);
    const res = await askDevAssistant(question, store);
    console.log(res.answer);
    console.log('');
    console.log('Источники:');
    const srcLines = res.sources.map(
      (s, i) =>
        `  [${i + 1}] ${s.chunk.metadata.section} (score=${s.score.toFixed(2)}, source=${s.chunk.metadata.source})`,
    );
    console.log(srcLines.length > 0 ? srcLines.join('\n') : '(нет — сработал guard «не знаю»)');
    const quoteLines = (res.quotes ?? []).map(
      (q) => `- [${q.chunkId}] ${q.snippet.replace(/\s+/g, ' ')}`,
    );
    if (quoteLines.length > 0) {
      console.log('\nЦитаты:');
      console.log(quoteLines.join('\n'));
    }
    const tag =
      res.cloudStatus === 'ok'
        ? `cloud: ${res.cloudModel} (${res.dtMs ?? 0}ms)`
        : res.cloudStatus === 'no-key'
          ? 'cloud: нет OPENROUTER_API_KEY (draft-only)'
          : 'cloud: недоступен (draft-only, fallback)';
    console.log(`\n[${tag}]`);
  } finally {
    store.close();
  }
}

interface PrReviewFlags {
  diffFile?: string;
  filesFile?: string;
  base?: string;
  head?: string;
  local: boolean;
  out?: string;
  maxDiffBytes?: number;
}

function parsePrReviewFlags(argv: string[]): PrReviewFlags {
  const flags: PrReviewFlags = { local: false };
  const num = (v: string): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--diff-file' && argv[i + 1]) { flags.diffFile = argv[++i]; continue; }
    if (a === '--files' && argv[i + 1]) { flags.filesFile = argv[++i]; continue; }
    if (a === '--base' && argv[i + 1]) { flags.base = argv[++i]; continue; }
    if (a === '--head' && argv[i + 1]) { flags.head = argv[++i]; continue; }
    if (a === '--out' && argv[i + 1]) { flags.out = argv[++i]; continue; }
    if (a === '--max-diff-bytes' && argv[i + 1]) { flags.maxDiffBytes = num(argv[++i]); continue; }
    if (a === '--local') { flags.local = true; continue; }
  }
  return flags;
}

// День 32: AI-ревью PR. diff из --diff-file → cloud Claude (через prReview.reviewPr)
// → markdown в --out/stdout. Режим --local = +retrieval из индекса docs. Cloud-down:
// нет ключа/сеть упала → fallback-тело, всегда exit 0 (GitHub Action НЕ краснеет).
async function runPrReviewCommand(argv: string[]): Promise<void> {
  const flags = parsePrReviewFlags(argv);

  if (!flags.diffFile) {
    // base/head git-режим — stretch из плана; MVP требует --diff-file (как в workflow).
    console.error(
      'Укажите --diff-file <path>: pr-review --diff-file diff.patch [--files files.txt] [--out review.md]',
    );
    process.exit(1);
  }

  let diff: string;
  try {
    diff = fs.readFileSync(flags.diffFile, 'utf8');
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error(`Не удалось прочитать --diff-file "${flags.diffFile}": ${m}`);
    process.exit(1);
  }

  const changedFiles: string[] = [];
  if (flags.filesFile) {
    try {
      const raw = fs.readFileSync(flags.filesFile, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const t = line.trim();
        if (t.length > 0) changedFiles.push(t);
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.error(`Не удалось прочитать --files "${flags.filesFile}": ${m}`);
      process.exit(1);
    }
  }

  const mode: 'cloud' | 'local' = flags.local ? 'local' : 'cloud';

  let review: string;
  let meta: { cloudStatus: string; truncated: boolean; sourcesLen: number; cloudModel?: string; dtMs?: number };
  try {
    if (mode === 'local') {
      const store = new RagStore(RAG_DB_PATH);
      try {
        const result = await reviewPr({
          mode: 'local',
          store,
          diff,
          changedFiles,
          maxDiffBytes: flags.maxDiffBytes,
        });
        review = result.review;
        meta = {
          cloudStatus: result.cloudStatus,
          truncated: result.truncated,
          sourcesLen: result.sources.length,
          cloudModel: result.cloudModel,
          dtMs: result.dtMs,
        };
      } finally {
        store.close();
      }
    } else {
      const result = await reviewPr({
        mode: 'cloud',
        diff,
        changedFiles,
        maxDiffBytes: flags.maxDiffBytes,
      });
      review = result.review;
      meta = {
        cloudStatus: result.cloudStatus,
        truncated: result.truncated,
        sourcesLen: result.sources.length,
        cloudModel: result.cloudModel,
        dtMs: result.dtMs,
      };
    }
  } catch (err) {
    // reviewPr сам ловит cloud-ошибки; сюда попадаем только при неожиданном падении
    // (например, open RagStore). Guard: НЕ красним Action — fallback + exit 0.
    const m = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[pr-review] unexpected error: ${m.split('\n')[0].slice(0, 200)}\n`);
    review =
      '⚠ Cloud-ревью недоступно — внутренняя ошибка pr-review (см. логи Action).\n\nАвтоматическое ревью пропущено.';
    meta = { cloudStatus: 'fallback', truncated: false, sourcesLen: 0 };
  }

  // Метастатус — ТОЛЬКО в stderr (review в stdout/--out не смешивается с мета).
  const metaParts = [
    `cloudStatus=${meta.cloudStatus}`,
    `truncated=${meta.truncated}`,
    `sources=${meta.sourcesLen}`,
  ];
  if (meta.cloudModel) metaParts.push(`model=${meta.cloudModel}`);
  if (meta.dtMs != null) metaParts.push(`dt=${meta.dtMs}ms`);
  process.stderr.write(`[pr-review] ${metaParts.join(' ')}\n`);

  if (flags.out) {
    fs.writeFileSync(flags.out, review);
    process.stderr.write(`[pr-review] markdown written to ${flags.out}\n`);
  } else {
    console.log(review);
  }
  // Явный exit 0: cloud-down/неожиданная ошибка НЕ краснят GitHub Action.
  process.exit(0);
}

// --- support-assistant (день 33): RAG faq + CRM (MCP round-trip) + cloud refine ---

interface SupportFlags {
  userId?: number;
  ticketId?: number;
}

function parseSupportFlags(argv: string[]): { flags: SupportFlags; rest: string[] } {
  const flags: SupportFlags = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user' && argv[i + 1]) { flags.userId = Number(argv[++i]); continue; }
    if (a === '--ticket' && argv[i + 1]) { flags.ticketId = Number(argv[++i]); continue; }
    rest.push(a);
  }
  return { flags, rest };
}

async function runSupportCommand(argv: string[]): Promise<void> {
  const { flags, rest } = parseSupportFlags(argv);
  const question = rest.join(' ').trim();
  if (!question) {
    console.error(
      'Укажите вопрос: pnpm --filter challenge exec tsx src/cli.ts support --user <N> [--ticket <N>] "вопрос"',
    );
    process.exit(1);
  }
  if (flags.userId == null || !Number.isInteger(flags.userId) || flags.userId <= 0) {
    console.error('--user <N> обязательно (положительное целое): support --user 1 [--ticket 1] "вопрос"');
    process.exit(1);
  }
  if (flags.ticketId != null && (!Number.isInteger(flags.ticketId) || flags.ticketId <= 0)) {
    console.error('--ticket <N> должен быть положительным целым.');
    process.exit(1);
  }
  const store = new RagStore(RAG_DB_PATH);
  try {
    console.log(
      `▶ support: user=${flags.userId}${flags.ticketId != null ? ` ticket=${flags.ticketId}` : ''} | ${question}\n`,
    );
    const res = await askSupportAssistant(question, store, {
      userId: flags.userId,
      ticketId: flags.ticketId,
    });
    printSupportAnswer(res);
  } finally {
    store.close();
  }
}

// День 34: файловый ассистент. Сценарий 1 — find-usages (read-only, без cloud).
async function runFilesFindCommand(symbol: string): Promise<void> {
  console.log(`▶ files find: ${symbol}\n`);
  try {
    const res = await runFindUsages(symbol);
    if (res.matches.length === 0) {
      console.log('(нет совпадений внутри allowlist)');
    } else {
      for (const m of res.matches) console.log(`${m.file}:${m.line}: ${m.text}`);
      if (res.truncated) console.log(`\n…[показаны первые ${res.matches.length}]…`);
    }
    process.exit(0);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error(`files find error: ${m.split('\n')[0].slice(0, 300)}`);
    process.exit(e instanceof GuardError ? 3 : 1);
  }
}

// День 34: файловый ассистент. Сценарий 2 — обновить doc (cloud draft → dry-run/--write).
async function runFilesDocsCommand(goal: string, write: boolean): Promise<void> {
  console.log(`▶ files docs (${write ? 'write' : 'dry-run'}): ${goal}\n`);
  try {
    const res = await runUpdateDocs(goal, { write });
    console.log(`target: ${res.targetPath}`);
    if (res.cloudStatus !== 'ok') {
      console.log(CLOUD_DOWN_MESSAGE);
    }
    if (res.written) {
      console.log(`записано ${res.afterBytes} байт (было ${res.beforeBytes}).`);
    } else {
      console.log('--- diff (dry-run) ---');
      console.log(res.diff || '(нет изменений)');
    }
    process.exit(0);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error(`files docs error: ${m.split('\n')[0].slice(0, 300)}`);
    process.exit(e instanceof GuardError ? 3 : 1);
  }
}

// День 34 (fixup): files refactor — cloud draft .ts с typecheck-rollback.
async function runFilesRefactorCommand(goal: string, write: boolean): Promise<void> {
  console.log(`▶ files refactor (${write ? 'write' : 'dry-run'}): ${goal}\n`);
  try {
    const res = await runRefactor(goal, { write });
    console.log(`target: ${res.targetPath}`);
    if (res.cloudStatus !== 'ok') {
      console.log(CLOUD_DOWN_MESSAGE);
    }
    if (res.rollback) {
      console.log(`⚠ typecheck FAILED (${res.rollback.reason}) → rollback restored snapshot.`);
      console.error(res.rollback.stderr);
      process.exit(1);
    }
    if (res.written) {
      console.log(`записано ${res.afterBytes} байт (было ${res.beforeBytes}).`);
    } else {
      console.log('--- diff (dry-run) ---');
      console.log(res.diff || '(нет изменений)');
    }
    process.exit(0);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error(`files refactor error: ${m.split('\n')[0].slice(0, 300)}`);
    process.exit(e instanceof GuardError ? 3 : 1);
  }
}

// День 34 (fixup): files scaffold — новый .ts в challenge/src/utils/**.
async function runFilesScaffoldCommand(goal: string, write: boolean): Promise<void> {
  console.log(`▶ files scaffold (${write ? 'write' : 'dry-run'}): ${goal}\n`);
  try {
    const res = await runScaffold(goal, { write });
    console.log(`target: ${res.targetPath}`);
    if (res.cloudStatus !== 'ok') {
      console.log(CLOUD_DOWN_MESSAGE);
    }
    if (res.rollback) {
      console.log(`⚠ typecheck FAILED (${res.rollback.reason}) → rollback (new file unlinked).`);
      console.error(res.rollback.stderr);
      process.exit(1);
    }
    if (res.created) {
      console.log(`создан новый файл (${res.targetPath}).`);
    } else {
      console.log('--- preview (dry-run) ---');
      console.log(res.preview || '(пустой драфт)');
    }
    process.exit(0);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error(`files scaffold error: ${m.split('\n')[0].slice(0, 300)}`);
    process.exit(e instanceof GuardError ? 3 : 1);
  }
}

// День 34 (fixup): files run — classify NL → {docs|refactor|scaffold} и делегировать.
async function runFilesRunCommand(goal: string): Promise<void> {
  console.log(`▶ files run: ${goal}\n`);
  const cls = runClassify(goal);
  if (cls.type === 'ambiguous') {
    console.error(
      `Не удалось определить тип задачи (matched: ${cls.matched?.join(', ') || 'none'}). ` +
        'Уточните: «док/readme» (docs), «рефактор/переименуй» (refactor), «создай утилиту» (scaffold).',
    );
    process.exit(1);
  }
  console.log(`classify → ${cls.type}`);
  // Делегируем в dry-run варианты (run = safe-by-default, без авто --write).
  if (cls.type === 'docs') await runFilesDocsCommand(goal, false);
  else if (cls.type === 'refactor') await runFilesRefactorCommand(goal, false);
  else await runFilesScaffoldCommand(goal, false);
}

// Один readline на prompt — зеркало defaultAsk из telegramScanner.ts (не экспортируется).
function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });
}

// Общий формат вывода ответа support (legacy one-shot и interactive).
function printSupportAnswer(res: Awaited<ReturnType<typeof askSupportAssistant>>): void {
  console.log(res.answer);
  console.log('');
  console.log('Источники FAQ:');
  const srcLines = res.sources.map(
    (s, i) =>
      `  [${i + 1}] ${s.chunk.metadata.section} (score=${s.score.toFixed(2)}, source=${s.chunk.metadata.source})`,
  );
  console.log(srcLines.length > 0 ? srcLines.join('\n') : '(нет — guard/crm-miss)');
  if (res.user) {
    console.log(
      `\nПрофиль CRM: ${res.user.name} (plan=${res.user.plan}, two_fa=${res.user.two_fa ? 'on' : 'off'}, email=${res.user.email})`,
    );
  }
  if (res.ticket) {
    const det =
      typeof res.ticket.details === 'string' ? res.ticket.details : JSON.stringify(res.ticket.details);
    console.log(
      `Тикет CRM #${res.ticket.id}: ${res.ticket.subject} [status=${res.ticket.status}, priority=${res.ticket.priority}]`,
    );
    console.log(`  details: ${det}`);
  }
  const tag =
    res.cloudStatus === 'ok'
      ? `cloud: ${res.cloudModel} (${res.dtMs ?? 0}ms)`
      : res.cloudStatus === 'no-key'
        ? 'cloud: нет OPENROUTER_API_KEY (draft-only)'
        : res.cloudStatus === 'fallback'
          ? 'cloud: недоступен (draft-only, fallback)'
          : res.cloudStatus === 'guard'
            ? 'guard: FAQ не нашёл релевантного (без LLM/MCP)'
            : 'crm: пользователь не найден';
  console.log(`\n[${tag}]`);
}

async function runSupportSeedCommand(): Promise<void> {
  const db = new CrmDb(DB_PATH);
  try {
    const r = seedSupport(db);
    console.log(
      `CRM seed: добавлено ${r.users} пользователей и ${r.tickets} тикетов (всего в БД: users=${db.usersCount()}, tickets=${db.ticketsCount()}).`,
    );
  } finally {
    db.close();
  }
}

async function runSupportListCommand(): Promise<void> {
  const db = new CrmDb(DB_PATH);
  try {
    const users = db.listUsers();
    if (users.length === 0) {
      console.log('CRM пуст. Залейте демо: support-seed');
      return;
    }
    for (const u of users) {
      console.log(`#${u.id}  ${u.name} <${u.email}> [${u.plan}]`);
    }
  } finally {
    db.close();
  }
}

// support без --list/--user → интерактивный диалог.
// Email → login-gate по CRM (miss = стоп, exit 2) → вопрос → pipeline.
const MAX_SUPPORT_EMAIL = 254;
const MAX_SUPPORT_QUESTION = 1000;

async function runSupportInteractive(): Promise<void> {
  const emailRaw = await ask('Email: ');
  const email = clean(emailRaw, MAX_SUPPORT_EMAIL);
  if (email.length === 0) {
    console.log('Email не введён.');
    process.exit(2);
  }
  const db = new CrmDb(DB_PATH);
  let userId: number;
  try {
    const user = db.getUserByEmail(email);
    if (!user) {
      console.log('Пользователь не найден. Проверьте email или посмотрите список: support --list');
      process.exit(2);
    }
    userId = user.id;
  } finally {
    db.close();
  }
  const questionRaw = await ask('Вопрос: ');
  const question = clean(questionRaw, MAX_SUPPORT_QUESTION);
  if (question.length === 0) {
    console.log('Вопрос не указан.');
    process.exit(1);
  }
  const store = new RagStore(RAG_DB_PATH);
  try {
    console.log(`\n▶ support: user=${userId} | ${question}\n`);
    const res = await askSupportAssistant(question, store, { userId });
    printSupportAnswer(res);
  } finally {
    store.close();
  }
}

async function runRagCommand(argv: string[]): Promise<void> {
  const sub = argv[0];
  try {
    if (sub === 'index-tg') {
      await runRagIndexTgCommand(argv.slice(1));
      return;
    }

    if (sub === 'index-docs') {
      // Кураторский корпус dev-assistant → партиция 'docs'. Через indexDocuments
      // (НЕ runIndexing): clearStrategy('docs') чистит ТОЛЬКО 'docs', партиции
      // fixed/structure/telegram не затрагиваются.
      const store = new RagStore(RAG_DB_PATH);
      try {
        console.log('▶ RAG index-docs: кураторский корпус dev-assistant → стратегия docs');
        const r = await indexDocsCorpus(store, findRepoRoot());
        console.log(`  docs: проиндексировано ${r.chunks} чанков (всего в 'docs': ${store.count('docs')})`);
      } finally {
        store.close();
      }
      return;
    }

    if (sub === 'index-faq') {
      // Кураторский FAQ-корпус support-assistant → партиция 'faq'. Через
      // indexDocuments (НЕ runIndexing): clearStrategy('faq') чистит ТОЛЬКО 'faq',
      // партиции fixed/structure/telegram/docs не затрагиваются (memory:
      // RAG index read-only для существующих партиций). Эмбеддинги локальные (Ollama).
      const store = new RagStore(RAG_DB_PATH);
      try {
        console.log('▶ RAG index-faq: кураторский FAQ support-assistant → стратегия faq');
        const embedder = makeEmbedder();
        const chunks = buildFaqChunks();
        store.clearStrategy('faq');
        await indexDocuments(store, 'faq', chunks, embedder, 32);
        console.log(`  faq: проиндексировано ${chunks.length} чанков (всего в 'faq': ${store.count('faq')})`);
      } finally {
        store.close();
      }
      return;
    }

    if (sub === 'index') {
      const { flags, rest } = parseRagFlags(argv.slice(1));
      const docsDir = rest[0] ?? RAG_DOCS_DIR;
      const strategies = flags.strategy ? [flags.strategy] : undefined;
      const store = new RagStore(RAG_DB_PATH);
      try {
        console.log(`▶ RAG index: ${docsDir} → ${RAG_DB_PATH}`);
        const result = await runIndexing(store, { docsDir, strategies });
        for (const s of Object.keys(result)) {
          const st = result[s];
          console.log(`  ${s}: ${st.chunks} чанков, среднее ${st.avgLen} симв, dim=${st.dim ?? '-'}`);
        }
      } finally {
        store.close();
      }
      return;
    }

    if (sub === 'query') {
      const { flags, rest } = parseRagFlags(argv.slice(1));
      const question = rest.join(' ').trim();
      if (!question) {
        console.error('Укажи вопрос: pnpm --filter challenge start -- rag query "..."');
        process.exit(1);
      }
      const strategy: ChunkingStrategy = flags.strategy ?? 'fixed';
      const client = makeRagLlmClient(flags.llm);
      if (flags.noRag) {
        console.log(`▶ RAG query (без RAG): ${question}\n`);
        console.log(await answerNoRag(client, question));
        return;
      }
      const store = new RagStore(RAG_DB_PATH);
      try {
        if (store.count(strategy) === 0) {
          console.error(`Индекс пуст (${strategy}). Сначала: rag index`);
          process.exit(1);
        }
        const sourceFilter = await resolveChatFilter(flags, strategy, store);
        const retriever = new Retriever(store, makeEmbedder(), strategy, sourceFilter);
        const opts = buildRagOpts(flags);
        console.log(
          `▶ RAG query (${strategy}, pool=${opts.pool}, topK=${opts.k}, threshold=${opts.threshold}, rerank=${opts.rerank}, rewrite=${opts.rewrite}): ${question}\n`,
        );
        const { answer, sources, quotes, debug } = await answerWithRag(client, retriever, question, {
          ...opts,
          onProgress: printRagStage,
        });
        console.log('Источники:');
        for (const s of sources) {
          console.log(`  [${s.score.toFixed(3)}] ${s.chunk.metadata.source} | ${s.chunk.metadata.section}`);
        }
        if (quotes && quotes.length > 0) {
          console.log('Цитаты:');
          for (const q of quotes) {
            console.log(`  [${q.chunkId}] ${q.snippet}`);
          }
        }
        if (debug) {
          console.log(
            `\nОтладка: pool=${debug.poolSize} filtered=${debug.filteredSize} threshold=${debug.threshold} ` +
              `rerank=${debug.rerankApplied} fallback=${debug.fallback} Δrank=${debug.rankDelta.toFixed(2)} ` +
              `rewritten=${debug.rewritten}`,
          );
        }
        const guardLabel = debug?.gaveUp ? ' [guard: не знаю]' : '';
        console.log('\nОтвет:');
        console.log(answer + guardLabel);
      } finally {
        store.close();
      }
      return;
    }

    if (sub === 'eval') {
      const { flags } = parseRagFlags(argv.slice(1));
      const strategy: ChunkingStrategy = flags.strategy ?? 'fixed';
      const client = makeRagLlmClient(flags.llm);
      const store = new RagStore(RAG_DB_PATH);
      try {
        if (store.count(strategy) === 0) {
          console.error(`Индекс пуст (${strategy}). Сначала: rag index`);
          process.exit(1);
        }
        const sourceFilter = await resolveChatFilter(flags, strategy, store);
        const retriever = new Retriever(store, makeEmbedder(), strategy, sourceFilter);
        if (flags.set === 'day24') {
          const opts = buildRagOpts(flags);
          console.log(`=== Day-24 eval: 10 вопросов broad→narrow ===`);
          console.log(
            `  [стратегия: ${strategy} | rerank: ${opts.rerank ? 'on' : 'off'} | ` +
              `threshold: ${opts.threshold} | floor: ${opts.minScore ?? '-'}]\n`,
          );
          const result = await runEvalDay24(client, retriever, opts);
          for (let i = 0; i < result.rows.length; i++) {
            const { question, answer } = result.rows[i];
            const level = question.level ?? '-';
            const gaveUp = answer.debug?.gaveUp === true;
            const reason = gaveUp ? ((answer.debug?.filteredSize ?? 0) === 0 ? 'empty' : 'floor') : null;
            const guardTxt = gaveUp ? `ДА (reason=${reason})` : 'no';
            const expectedTxt = question.expectedGuard === true ? ' (ожидаемо)' : '';
            const marker = /\[\d+\]/.test(answer.answer) ? 'yes' : 'no';
            console.log(`[#${i + 1} ${level}] ${question.q}`);
            console.log(
              `  guard: ${guardTxt}${expectedTxt} | sources: ${answer.sources.length} | ` +
                `quotes: ${answer.quotes?.length ?? 0} | marker: ${marker}`,
            );
            console.log(`  ответ:  ${answer.answer.replace(/\s+/g, ' ').slice(0, 200)}`);
            if (answer.sources.length > 0) {
              console.log('  источники:');
              for (let j = 0; j < answer.sources.length; j++) {
                const s = answer.sources[j];
                console.log(
                  `    [${j + 1}] ${s.chunk.metadata.source} | ${s.chunk.metadata.section} | score=${s.score.toFixed(2)}`,
                );
              }
            }
            const quotes = answer.quotes ?? [];
            if (quotes.length > 0) {
              console.log('  цитаты:');
              for (let j = 0; j < quotes.length; j++) {
                const qq = quotes[j];
                console.log(
                  `    [${j + 1}] ${qq.chunkId} | ${qq.section} | ${qq.snippet.replace(/\s+/g, ' ').slice(0, 160)}`,
                );
              }
            }
          }
          const m = result.metrics;
          const sc = Math.round(m.sourcesCoverage * m.questions);
          const qc = Math.round(m.quotesCoverage * m.questions);
          const gc = Math.round(m.guardTriggered * m.questions);
          const mc = Math.round(m.answerHasCitationMarker * m.questions);
          console.log(`\n=== Метрики Day24 (${m.questions} вопросов) ===`);
          console.log(`  sourcesCoverage:         ${sc}/${m.questions} (${m.sourcesCoverage.toFixed(2)})`);
          console.log(`  quotesCoverage:          ${qc}/${m.questions} (${m.quotesCoverage.toFixed(2)})`);
          console.log(`  guardTriggered:          ${gc}/${m.questions} (${m.guardTriggered.toFixed(2)})`);
          console.log(
            `  answerHasCitationMarker: ${mc}/${m.questions} (${m.answerHasCitationMarker.toFixed(2)})`,
          );
          return;
        }
        const questions = await loadEval(RAG_EVAL_FILE);
        if (flags.ab) {
          const opts = buildRagOpts(flags);
          console.log(
            `▶ RAG eval A/B: ${questions.length} вопросов, стратегия ${strategy}, ` +
              `pool=${opts.pool}, topK=${opts.k}, threshold=${opts.threshold}\n`,
          );
          const result = await runEvalAB(client, retriever, questions, {
            k: opts.k,
            pool: opts.pool,
            threshold: opts.threshold,
          });
          console.log(`\n=== A/B: baseline (cosine-only) vs improved (+LLM rerank) ===`);
          const metrics: [string, number, number][] = [
            ['coversSources', result.baseline.coversSources, result.improved.coversSources],
            ['meanScore', result.baseline.meanScore, result.improved.meanScore],
            ['keptAfterFilter', result.baseline.keptAfterFilter, result.improved.keptAfterFilter],
            ['avgRankDelta', result.baseline.avgRankDelta, result.improved.avgRankDelta],
            ['questions', result.baseline.questions, result.improved.questions],
          ];
          console.log('  metric            | baseline | improved |     Δ');
          console.log('  ------------------|----------|----------|------');
          for (const [name, b, im] of metrics) {
            const d = im - b;
            const sign = d > 0 ? '+' : '';
            const fmt = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(3));
            const dv = Number.isInteger(d) ? `${sign}${d}` : `${sign}${d.toFixed(3)}`;
            console.log(
              `  ${name.padEnd(18)} | ${fmt(b).padStart(8)} | ${fmt(im).padStart(8)} | ${dv.padStart(5)}`,
            );
          }
          const fbRate = result.improved.questions > 0
            ? result.perQuestion.filter((r) => r.improved.debug?.fallback).length / result.improved.questions
            : 0;
          console.log(`\n  fallback rate (improved): ${(fbRate * 100).toFixed(0)}%`);
          console.log(`  avgRankDelta (improved): ${result.improved.avgRankDelta.toFixed(2)}`);
        } else {
          console.log(`▶ RAG eval: ${questions.length} вопросов, стратегия ${strategy}\n`);
          const rows = await runEval(client, retriever, questions);
          for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            console.log(`Q${i + 1}: ${r.question.q}`);
            console.log(`  без RAG: ${r.noRag.replace(/\s+/g, ' ').slice(0, 160)}`);
            console.log(`  с RAG:   ${r.withRag.replace(/\s+/g, ' ').slice(0, 160)}`);
            const src = r.sources.map((s) => `${s.source}(${s.score.toFixed(2)})`).join(', ');
            console.log(`  источники: ${src}\n`);
          }
        }
      } finally {
        store.close();
      }
      return;
    }

    if (sub === 'chat') {
      const { flags } = parseRagFlags(argv.slice(1));
      const opts = buildRagOpts(flags);
      const embedder = makeEmbedder();
      const store = new RagStore(RAG_DB_PATH);
      try {
        // strategy: force=telegram при --chat (R-3); иначе из флагов/default fixed.
        let strategy: ChunkingStrategy = flags.strategy ?? 'fixed';
        if (flags.chat) strategy = 'telegram';
        if (store.count(strategy) === 0) {
          console.error(
            `Индекс пуст (${strategy}). Сначала: ${strategy === 'telegram' ? 'rag index-tg <chat>' : 'rag index'}`,
          );
          process.exit(1);
        }

        let llmPref: 'local' | 'cloud' = flags.llm ?? 'local';
        let client = makeRagLlmClient(llmPref);
        let modelName = client.defaultModel;

        // Session-состояние (мутируется слэшами). Флаги задают начальное.
        let sourceFilter: ChatSourceFilter | undefined;
        let currentChatKey: string | undefined;
        let currentTopicId: number | undefined;
        let currentAliasName: string | undefined;
        let noRag = false;

        if (flags.chat) {
          // Стартовый чат из флагов: resolve → apply; ошибка → exit 1.
          const resolved = resolveChatRefForRepl(flags.chat, loadChatTitles(), loadAliases());
          if (!resolved.ok) {
            console.error(resolved.error);
            process.exit(1);
          }
          const applied = applyChatFilterForRepl(
            strategy,
            resolved.chatKey,
            flags.topic ?? resolved.topicId,
            store,
          );
          if (!applied.ok) {
            console.error(applied.error);
            process.exit(1);
          }
          sourceFilter = applied.filter;
          currentChatKey = resolved.chatKey;
          currentTopicId = applied.filter.topicId;
          if (resolved.origin === 'alias') currentAliasName = resolved.label;
        } else {
          // Без --chat: fatal-путь (AC-B5: --topic без --chat → exit 1). Не-telegram warn.
          sourceFilter = await resolveChatFilter(flags, strategy, store);
        }

        let retriever = new Retriever(store, embedder, strategy, sourceFilter);
        const stagesOn = opts.rerank || opts.rewrite;

        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        // При pipe/EOF readline закрывается до завершения активного хода — флаг+await
        // turnChain защищают от prompt() на закрытом интерфейсе (borrow day-25.ts:718-730).
        let rlClosed = false;
        rl.on('close', () => {
          rlClosed = true;
        });
        const prompt = (): void => {
          if (!rlClosed) rl.prompt();
        };
        const chatLabel = (): string => {
          const base = currentAliasName ?? currentChatKey ?? 'all';
          return currentTopicId != null ? `${base}/${currentTopicId}` : base;
        };
        const updatePrompt = (): void => {
          rl.setPrompt(`you (${noRag ? 'no-rag' : 'rag'} | ${chatLabel()} | ${llmPref})> `);
        };

        console.log(
          `▶ RAG чат (${strategy}, pool=${opts.pool}, topK=${opts.k}, threshold=${opts.threshold}, ` +
            `rerank=${opts.rerank}, rewrite=${opts.rewrite}). Источник — мануал в индексе.`,
        );
        console.log('  /help — команды (chat/topic/llm/list/alias/norag)');

        updatePrompt();
        prompt();

        const handleLine = async (line: string): Promise<void> => {
          const q = line.trim();
          if (!q) {
            prompt();
            return;
          }
          if (q === '/quit' || q === '/exit') {
            rl.close();
            return;
          }
          if (q === '/help') {
            printReplChatHelp();
            prompt();
            return;
          }
          if (q === '/norag') {
            noRag = !noRag;
            updatePrompt();
            console.log(`режим: ${noRag ? 'без RAG (общие знания)' : 'с RAG (по мануалу)'}`);
            prompt();
            return;
          }
          if (q === '/local') {
            llmPref = 'local';
            client = makeRagLlmClient('local');
            modelName = client.defaultModel;
            updatePrompt();
            console.log(`LLM: local (${modelName})`);
            prompt();
            return;
          }
          if (q === '/cloud') {
            try {
              const next = makeRagLlmClient('cloud');
              llmPref = 'cloud';
              client = next;
              modelName = client.defaultModel;
              updatePrompt();
              console.log(`LLM: cloud (${modelName})`);
            } catch (err) {
              // Без cloud-ключей фабрика бросает — откат, сессия жива (AC-S18). Ключ не утёк.
              const m = err instanceof Error ? err.message : String(err);
              console.error(`не удалось переключиться на cloud: ${m}`);
            }
            prompt();
            return;
          }
          if (q === '/list') {
            const chats = store.listTelegramChats();
            if (chats.length === 0) {
              console.log('(нет проиндексированных telegram-чатов).');
            } else {
              const titles = loadChatTitles();
              console.log('\nИзвестные чаты (telegram):');
              for (const c of chats) {
                const marker = c.chatKey === currentChatKey ? '* ' : '  ';
                const title = titles[c.chatKey] ?? '(нет title)';
                const aliasEntry = findAliasByChatKey(c.chatKey);
                const topicStr = `${c.topics} topic${c.topics === 1 ? '' : 's'}`;
                console.log(
                  `${marker}${c.chatKey} | ${title} | alias=${aliasEntry ? aliasEntry.name : '-'} | ${c.chunks} chunks, ${topicStr}`,
                );
              }
            }
            console.log('');
            prompt();
            return;
          }
          if (q === '/chat' || q.startsWith('/chat ')) {
            if (q === '/chat') {
              console.log(
                `текущий чат: ${chatLabel()}${currentChatKey ? ` (chatKey=${currentChatKey})` : ' — не выбран'}`,
              );
              prompt();
              return;
            }
            const arg = q.slice('/chat '.length).trim();
            const resolved = resolveChatRefForRepl(arg, loadChatTitles(), loadAliases());
            if (!resolved.ok) {
              console.error(resolved.error);
              prompt();
              return;
            }
            // No-op если тот же chatKey+topicId уже активен (AC-S14, без MTProto).
            const nextTopic = resolved.topicId ?? undefined;
            if (resolved.chatKey === currentChatKey && nextTopic === currentTopicId) {
              console.log(`чат уже активен: ${chatLabel()}`);
              prompt();
              return;
            }
            const applied = applyChatFilterForRepl('telegram', resolved.chatKey, resolved.topicId, store);
            if (!applied.ok) {
              console.error(applied.error);
              prompt();
              return;
            }
            strategy = 'telegram';
            sourceFilter = applied.filter;
            currentChatKey = resolved.chatKey;
            currentTopicId = resolved.topicId;
            currentAliasName = resolved.origin === 'alias' ? resolved.label : undefined;
            retriever = new Retriever(store, embedder, strategy, sourceFilter);
            updatePrompt();
            console.log(`чат: ${chatLabel()} | ${store.countBySourcePrefix('telegram', currentChatKey)} chunks`);
            prompt();
            return;
          }
          if (q === '/topic' || q.startsWith('/topic ')) {
            if (currentChatKey == null) {
              console.error('/topic требует активного чата: сначала /chat <ref>.');
              prompt();
              return;
            }
            if (q === '/topic') {
              currentTopicId = undefined;
              sourceFilter = { chatKey: currentChatKey };
              retriever = new Retriever(store, embedder, strategy, sourceFilter);
              updatePrompt();
              console.log(`topic сброшен — весь чат ${currentChatKey}`);
              prompt();
              return;
            }
            const tid = Number(q.slice('/topic '.length).trim());
            if (!Number.isFinite(tid)) {
              console.error('/topic <id>: id должен быть числом.');
              prompt();
              return;
            }
            currentTopicId = tid;
            sourceFilter = { chatKey: currentChatKey, topicId: tid };
            retriever = new Retriever(store, embedder, strategy, sourceFilter);
            updatePrompt();
            console.log(`topic: ${tid}`);
            prompt();
            return;
          }
          if (q === '/alias' || q.startsWith('/alias ')) {
            const rest = q.startsWith('/alias ') ? q.slice('/alias '.length).trim() : '';
            if (!rest || rest === 'list') {
              const aliases = loadAliases();
              const names = Object.keys(aliases).sort();
              if (names.length === 0) {
                console.log('(нет alias-ов). /alias add <name> <chatKey> [topicId]');
              } else {
                console.log('\nAlias-ы:');
                for (const name of names) {
                  const a = aliases[name];
                  console.log(`  ${name} → ${a.chatKey}${a.topicId != null ? `/${a.topicId}` : ''}`);
                }
              }
              console.log('');
              prompt();
              return;
            }
            const parts = rest.split(/\s+/);
            const subAlias = parts[0];
            if (subAlias === 'add') {
              if (parts.length < 3) {
                console.error('/alias add <name> <chatKey> [topicId].');
                prompt();
                return;
              }
              const aname = parts[1];
              const ack = parts[2];
              if (!/^-100\d+$/.test(ack)) {
                console.error(
                  `chatKey должен быть numeric -100… (получено "${ack}"). @username не поддерживается.`,
                );
                prompt();
                return;
              }
              let atopic: number | undefined;
              if (parts[3] != null) {
                const t = Number(parts[3]);
                if (!Number.isFinite(t)) {
                  console.error('/alias add: topicId должен быть числом.');
                  prompt();
                  return;
                }
                atopic = t;
              }
              addAlias(aname, ack, atopic);
              console.log(`alias добавлен: ${aname} → ${ack}${atopic != null ? `/${atopic}` : ''}`);
              if (currentChatKey === ack) {
                currentAliasName = aname.toLowerCase();
                updatePrompt();
              }
              prompt();
              return;
            }
            if (subAlias === 'rm') {
              if (parts.length < 2) {
                console.error('/alias rm <name>.');
                prompt();
                return;
              }
              const rname = parts[1];
              const existed = removeAlias(rname);
              if (!existed) {
                console.error(`alias не найден: ${rname}`);
              } else {
                console.log(`alias удалён: ${rname}`);
                if (currentAliasName && currentAliasName === rname.toLowerCase()) {
                  currentAliasName = undefined;
                  updatePrompt();
                }
              }
              prompt();
              return;
            }
            console.error('/alias: ожидалось add | list | rm.');
            prompt();
            return;
          }

          // Обычный вопрос: RAG или no-RAG с текущими client/retriever.
          const t0 = Date.now();
          const spinner = startSpinner('думаю');
          try {
            if (noRag) {
              const answer = await answerNoRag(client, q);
              spinner.stop();
              const dt = Date.now() - t0;
              console.log('\n' + answer);
              console.log(`[model: ${modelName} | rag: — | ${dt}ms]\n`);
            } else {
              const { answer, sources, quotes, debug } = await answerWithRag(client, retriever, q, opts);
              spinner.stop();
              const dt = Date.now() - t0;
              const src = sources
                .map((s) => `${s.chunk.metadata.section}[${s.score.toFixed(2)}]`)
                .join(', ');
              console.log(`\nисточники: ${src}`);
              if (quotes && quotes.length > 0) {
                const qt = quotes.map((qq) => qq.snippet.replace(/\s+/g, ' ')).join(' / ');
                console.log(`цитаты: ${qt}`);
              }
              console.log(answer);
              // Базовая метка — как в дне 22. При включённых стадиях (rerank/rewrite)
              // показываем состав пайплайна: pool → filt → rerank → topK.
              const guardTag = debug?.gaveUp ? ' | guard: не знаю' : '';
              let label = `[model: ${modelName} | rag: ${sources.length} chunks | ${dt}ms${guardTag}]`;
              if (stagesOn && debug) {
                const stages =
                  `pool ${debug.poolSize} → filt ${debug.filteredSize}` +
                  (debug.rerankApplied ? ` → rerank ${sources.length}` : '');
                label = `[model: ${modelName} | rag: ${stages} | ${dt}ms${guardTag}]`;
              }
              console.log(`${label}\n`);
            }
          } catch (err) {
            spinner.stop();
            const m = err instanceof Error ? err.message : String(err);
            console.error(`ошибка: ${m}`);
          }
          prompt();
        };

        // Сериализация ходов: readline не await'ит async-колбэк ('line'-события
        // стреляют подряд при paste/pipe) — каждое ждёт предыдущий через then-chain.
        let turnChain: Promise<void> = Promise.resolve();
        rl.on('line', (line) => {
          turnChain = turnChain.then(() => handleLine(line));
        });
        await new Promise<void>((res) => rl.once('close', res));
        await turnChain;
      } finally {
        store.close();
      }
      return;
    }

    console.error('Использование: rag index|query|eval|chat');
    process.exit(1);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error(`RAG ошибка: ${m}`);
    process.exit(1);
  }
}

// --- TG-топик (НЕ день челленджа): collect / top / index-tg ---

// gramjs update-loop при disconnect может бросать TIMEOUT/CDN-* в cleanup — это
// не наша ошибка (данные уже сохранены). Глушим cleanup-ошибки, чтобы не валить
// exit code CLI. На MCP/news-путь (использует disconnectScanClient напрямую) НЕ влияет.
async function safeDisconnectScan(): Promise<void> {
  try {
    await disconnectScanClient();
  } catch {
    /* cleanup-ошибка gramjs update-loop после успешной операции — игнорируем */
  }
}

interface TgCmdFlags {
  limit?: number;
  resume?: boolean;
  reset?: boolean;
  probe?: boolean;
  plain?: boolean;
  by?: 'likes' | 'date';
  top?: number;
  rest?: boolean;
}

function parseTgArgs(argv: string[]): { flags: TgCmdFlags; positional: string[] } {
  const flags: TgCmdFlags = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit' && argv[i + 1]) { flags.limit = Number(argv[++i]); continue; }
    if (a === '--resume') { flags.resume = true; continue; }
    if (a === '--reset') { flags.reset = true; continue; }
    if (a === '--probe') { flags.probe = true; continue; }
    if (a === '--plain') { flags.plain = true; continue; }
    if (a === '--by' && argv[i + 1]) {
      const v = argv[++i];
      if (v === 'likes' || v === 'date') flags.by = v;
      continue;
    }
    if (a === '--top' && argv[i + 1]) { flags.top = Number(argv[++i]); continue; }
    if (a === '--rest') { flags.rest = true; continue; }
    positional.push(a);
  }
  return { flags, positional };
}

// Live-прогресс эмбеддинга strategy='telegram' (compact-копия makeIndexProgress из
// pipeline.ts, чтобы не расширять публичный API pipeline). Рапорт каждые ~5%.
function makeTgIndexProgress(total: number): (done: number) => void {
  const start = Date.now();
  let lastBucket = -1;
  return (done: number) => {
    const pct = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 100;
    const bucket = Math.floor(pct / 5) * 5;
    const isDone = done >= total;
    if (!isDone && bucket <= lastBucket) return;
    lastBucket = bucket;
    const elapsed = Date.now() - start;
    if (isDone) {
      console.log(`  [telegram ${done}/${total} · 100% · готово за ${formatDuration(elapsed)}]`);
      return;
    }
    const rate = done > 0 ? elapsed / done : 0;
    const eta = rate * (total - done);
    console.log(
      `  [telegram ${done}/${total} · ${pct}% · ~${formatDuration(eta)} left · ${Math.round(rate)}ms/chunk]`,
    );
  };
}

// Read-only probe: проверяет форум-чтение через iterMessages({replyTo}); при пустом
// результате или RPC-ошибке — fallback Api.messages.Search({topMsgId}). Оба пути
// печатаются; 0 сообщений на обоих → явное предупреждение (probe = GO/NO-GO гейт).
async function runProbe(
  client: RawTelegramClient,
  ref: ChatTopicRef,
  limit: number,
): Promise<void> {
  console.log(
    `▶ probe: chat=${ref.chatTitle} (chatKey=${ref.chatKey}), topic=${ref.topicId}, limit=${limit}`,
  );
  let msgs: ProbeMessage[] = [];
  let path = 'replyTo';
  try {
    msgs = await probeTopic(client, ref, limit);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/PEER_ID_INVALID|CHAT_|FORUM|TOPIC|CHANNEL/i.test(msg)) {
      console.warn(`⚠️  replyTo-путь упал (${msg}). Пробую fallback Api.messages.Search({topMsgId}).`);
      path = 'search';
      msgs = await probeTopicViaSearch(client, ref, limit);
    } else {
      throw err;
    }
  }
  if (msgs.length === 0 && path === 'replyTo') {
    console.warn('⚠️  replyTo-путь вернул 0 сообщений. Пробую fallback Api.messages.Search({topMsgId}).');
    path = 'search';
    try {
      msgs = await probeTopicViaSearch(client, ref, limit);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`✖ Search-fallback тоже упал: ${msg}`);
      msgs = [];
    }
  }
  for (const m of msgs) {
    console.log(
      `  [${m.msgId}] ${m.fromName} @ ${m.dateIso} | реакции=${m.reactions.total} ${JSON.stringify(m.reactions.byEmoji)}`,
    );
    const snippet = m.text.replace(/\s+/g, ' ').slice(0, 120);
    if (snippet) console.log(`      ${snippet}`);
  }
  console.log(`✅ ${path}-путь: прочитано ${msgs.length} сообщений.`);
  if (msgs.length === 0) {
    console.warn(
      '⚠️  оба пути (replyTo + Search) вернули 0 — проверьте chat/topicId и что userbot — участник чата.',
    );
  }
}

async function runTgCollectCommand(argv: string[]): Promise<void> {
  const { flags, positional } = parseTgArgs(argv);
  const chatInput = positional[0];
  if (!chatInput) {
    console.error('Укажите chat: tg-collect <chatRef> [<topicId>] [--probe|--limit N|--resume|--reset]');
    process.exit(1);
  }
  if (!isScanConfigured()) {
    console.error(
      'MTProto не настроен: задайте TG_API_ID, TG_API_HASH, TG_SESSION в .env (или .data/tg-session.json).',
    );
    process.exit(1);
  }
  const client = await getConnectedRawScanClient();
  if (!client) {
    console.error('Не удалось подключиться к MTProto (см. ошибки выше).');
    process.exit(1);
  }
  const store = new TgStore(TG_DB_PATH);
  try {
    const ref = await resolveChatTopic(client, chatInput, positional[1]);
    console.log(`▶ chat: ${ref.chatTitle} | chatKey=${ref.chatKey} | topicId=${ref.topicId}`);

    if (flags.probe) {
      await runProbe(client, ref, flags.limit ?? 5);
      return;
    }

    const t0 = Date.now();
    const result = await collectTopic(store, client, ref, {
      limit: flags.limit,
      resume: flags.resume,
      reset: flags.reset,
      plain: flags.plain,
      onProgress: ({ fetched, newlyInserted, lastId }) => {
        console.log(`  [collect] fetched=${fetched} new=${newlyInserted} last_id=${lastId ?? '-'}`);
      },
    });
    console.log(
      `\n✅ mode=${result.mode}: fetched=${result.fetched} new=${result.newlyInserted} updated=${result.updated} ` +
        `| всего в БД: ${result.total} | range ${result.minIdSeen ?? '-'}..${result.maxIdSeen ?? '-'} ` +
        `| ${formatDuration(Date.now() - t0)}`,
    );
  } finally {
    store.close();
    await safeDisconnectScan();
  }
}

async function runTgTopCommand(argv: string[]): Promise<void> {
  const { flags, positional } = parseTgArgs(argv);
  const chatInput = positional[0];
  if (!chatInput) {
    console.error('Укажите chat: tg-top <chatRef> [<topicId>] [--by likes|date] [--limit N]');
    process.exit(1);
  }
  const { peer, topicId: parsed } = parseChatTopicInput(chatInput, positional[1]);
  let topicId = parsed;
  if ((topicId == null || !Number.isFinite(topicId)) && process.env.TG_TOPIC) {
    topicId = Number(process.env.TG_TOPIC);
  }
  if (topicId == null || !Number.isFinite(topicId)) {
    console.error(
      'topicId не задан: tg-top <chatRef> <topicId> (или URL t.me/<chat>/<topicId>, или env TG_TOPIC).',
    );
    process.exit(1);
  }
  const by = flags.by ?? 'likes';
  const limit = flags.limit ?? 20;

  const store = new TgStore(TG_DB_PATH);
  try {
    // Offline candidate-keys из ввода (БЕЗ сети): peer и @username-варианты.
    let chatKey: string | null = null;
    const cands = [peer];
    if (peer.startsWith('@')) cands.push(peer.slice(1));
    for (const k of cands) {
      if (store.countInTopic(k, topicId) > 0) {
        chatKey = k;
        break;
      }
    }
    // Network resolve если offline не нашёл — даёт тот же chatKey, что при collect.
    if (!chatKey && isScanConfigured()) {
      const client = await getConnectedRawScanClient();
      if (client) {
        try {
          const ref = await resolveChatTopic(client, chatInput, positional[1]);
          if (store.countInTopic(ref.chatKey, ref.topicId) > 0) chatKey = ref.chatKey;
        } finally {
          await safeDisconnectScan();
        }
      }
    }
    if (!chatKey) {
      console.error(
        `Топик не найден в tg.sqlite (пробовали: ${cands.join(', ')}). Сначала: tg-collect ${chatInput} ${topicId}`,
      );
      process.exit(1);
    }
    const rows = by === 'date'
      ? store.topByDate(chatKey, topicId, limit)
      : store.topByReactions(chatKey, topicId, limit);
    if (rows.length === 0) {
      console.log(`В топике ${chatKey}/${topicId} нет сообщений.`);
      return;
    }
    console.log(`▶ tg-top ${chatKey}/${topicId} by=${by} (${rows.length} строк)\n`);
    for (const r of rows) {
      const emoji = r.reaction_total > 0
        ? ` | реакции=${r.reaction_total} ${r.reactions_json}`
        : '';
      console.log(`  [${r.msg_id}] ${r.from_name} @ ${r.date_iso}${emoji}`);
      const text = r.text.replace(/\s+/g, ' ').slice(0, 120);
      if (text) console.log(`      ${text}`);
    }
  } finally {
    store.close();
  }
}

// Whole-chat индексация (forum = все топики; не-forum = основной поток topic_id=0).
// Защита от дублей: только через --reset (plain INSERT без UNIQUE на rag_chunks).
// clearBySourcePrefix чистит только этот чат — остальные telegram-чанки не трогаем.
async function runRagIndexTgWholeChat(
  flags: TgCmdFlags,
  chatInput: string,
  tg: TgStore,
  store: RagStore,
  embedder: Embedder,
): Promise<void> {
  if (!flags.reset) {
    console.error(
      'Whole-chat индексация работает только с --reset (защита от дублей чанков, ' +
        'plain INSERT без UNIQUE). Добавьте --reset: rag index-tg <chat> --reset',
    );
    process.exit(1);
  }
  if (flags.rest) {
    console.warn('⚠️  --rest не имеет смысла в whole-chat режиме — игнорируется.');
  }
  if (!isScanConfigured()) {
    console.error('MTProto не настроен: задайте TG_API_ID, TG_API_HASH, TG_SESSION в .env.');
    process.exit(1);
  }
  const client = await getConnectedRawScanClient();
  if (!client) {
    console.error('Не удалось подключиться к MTProto (см. ошибки выше).');
    process.exit(1);
  }
  try {
    const resolved = await resolveChatKey(client, chatInput);
    const { chatKey, chatTitle } = resolved;
    const entity = resolved.entity;
    const isForum = Boolean((entity as { forum?: boolean }).forum);
    console.log(`▶ chat: ${chatTitle} | chatKey=${chatKey} | forum=${isForum}`);
    // Кэшируем title для REPL `/chat <title>` и /list (наполняется только здесь —
    // в БД title чата не хранится). См. chatCatalog.ts.
    saveChatTitle(chatKey, chatTitle);

    // 1. Список topicId: forum → GetForumTopics (fallback на собранные в tg.sqlite);
    //    не-forum → единственный «топик» topic_id=0 (основной поток).
    let topicIds: number[];
    if (isForum) {
      try {
        topicIds = await listForumTopicIds(client, entity);
        console.log(`  forum: ${topicIds.length} топиков через GetForumTopics.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        topicIds = tg.listTopicIds(chatKey);
        console.warn(
          `⚠️  перечисление forum-топиков через MTProto не удалось (${msg}). ` +
            `Индексирую ранее собранные топики из tg.sqlite (${topicIds.length}). ` +
            `Для новых запустите: tg-collect ${chatInput} <topicId>.`,
        );
      }
      if (topicIds.length === 0) {
        console.error(
          `Нет топиков для индексации (чат "${chatKey}" пуст или не собран). ` +
            `Сначала: tg-collect ${chatInput} <topicId>.`,
        );
        process.exit(1);
      }
    } else {
      topicIds = [0];
    }

    // 2. Чистим только этот чат (не всю партицию telegram).
    const before = store.countBySourcePrefix('telegram', chatKey);
    store.clearBySourcePrefix('telegram', chatKey);
    console.log(`  очищено чанков этого чата в telegram: ${before}.`);

    // 3. Собираем чанки по всем топикам (с авто-collect пустых).
    const allBuilt: TgBuiltChunk[] = [];
    for (const topicId of topicIds) {
      let inTopic = tg.countInTopic(chatKey, topicId);
      if (inTopic === 0) {
        const ref: ChatTopicRef = {
          entity,
          chatKey,
          topicId,
          chatTitle,
        };
        const t0 = Date.now();
        const r = await collectTopic(tg, client, ref, {
          limit: flags.limit,
          ...(topicId === 0 ? { plain: true } : {}),
          onProgress: ({ fetched, newlyInserted }) =>
            console.log(`  [collect topic ${topicId}] fetched=${fetched} new=${newlyInserted}`),
        });
        inTopic = r.total;
        console.log(
          `  topic ${topicId}: auto-collect (${r.mode}) fetched=${r.fetched} new=${r.newlyInserted} ` +
            `| всего: ${r.total} | ${formatDuration(Date.now() - t0)}`,
        );
      } else {
        console.log(`  topic ${topicId}: уже собран (${inTopic} сообщ.) — collect пропущен.`);
      }
      const rows = tg.listForIndex(chatKey, topicId);
      const built = buildTopicChunks(rows);
      if (built.length > 0) allBuilt.push(...built);
    }

    if (allBuilt.length === 0) {
      console.error(
        'buildTopicChunks вернул 0 чанков по всем топикам — нечего индексировать ' +
          '(возможно, только media-only/пустые сообщения).',
      );
      process.exit(1);
    }

    // 4. Глобальный рейтинг по реакциям across topics, top-N ограничивает итог.
    allBuilt.sort((a, b) => b.reactionTotal - a.reactionTotal);
    const DEFAULT_TG_TOP = 1500;
    const n = flags.top ?? DEFAULT_TG_TOP;
    const tier = allBuilt.slice(0, n);
    const chunks = tier.map((t) => t.chunk);

    console.log(
      `▶ индексация: telegram whole-chat top-${tier.length} из ${allBuilt.length} ` +
        `(по ${topicIds.length} топикам) | батчей: ${Math.ceil(chunks.length / 32)} (×32)`,
    );
    const t1 = Date.now();
    await indexDocuments(store, 'telegram', chunks, embedder, 32, makeTgIndexProgress(chunks.length));
    const st = store.stats('telegram');
    console.log(
      `✅ indexed: ${st.chunks} чанков всего в telegram, dim=${st.dim ?? '-'} | ${formatDuration(Date.now() - t1)}`,
    );
    assertDimCompatible(store, embedder);
  } finally {
    await safeDisconnectScan();
  }
}

async function runRagIndexTgCommand(argv: string[]): Promise<void> {
  const { flags, positional } = parseTgArgs(argv);
  const chatInput = positional[0];
  if (!chatInput) {
    console.error('Укажите chat: rag index-tg <chatRef> [<topicId>] [--reset] [--limit N]');
    process.exit(1);
  }
  const embedCfg = embedConfigFromEnv();
  console.log(`▶ embedder: ${embedCfg.model} @ ${embedCfg.baseUrl}`);
  const embedder = makeEmbedder();

  const tg = new TgStore(TG_DB_PATH);
  const store = new RagStore(RAG_DB_PATH);
  try {
    // 1. Узнать topicId: позиционный / URL / env. Нет → whole-chat режим.
    const { peer, topicId: parsed } = parseChatTopicInput(chatInput, positional[1]);
    let tid: number | undefined = parsed;
    if ((tid == null || !Number.isFinite(tid)) && process.env.TG_TOPIC) tid = Number(process.env.TG_TOPIC);
    if (tid == null || !Number.isFinite(tid)) {
      await runRagIndexTgWholeChat(flags, chatInput, tg, store, embedder);
      return;
    }

    // Single-topic: offline-candidates chatKey по tid (БЕЗ сети), иначе MTProto resolve ниже.
    let chatKey: string | null = null;
    let topicId: number | null = null;
    if (!flags.reset) {
      const cands = [peer];
      if (peer.startsWith('@')) cands.push(peer.slice(1));
      for (const k of cands) {
        if (tg.countInTopic(k, tid) > 0) {
          chatKey = k;
          topicId = tid;
          break;
        }
      }
    }

    // 2. авто-collect, если chatKey неизвестен ИЛИ --reset ИЛИ топик пуст.
    if (chatKey == null || topicId == null || flags.reset) {
      if (!isScanConfigured()) {
        console.error('MTProto не настроен: задайте TG_API_ID, TG_API_HASH, TG_SESSION в .env.');
        process.exit(1);
      }
      const client = await getConnectedRawScanClient();
      if (!client) {
        console.error('Не удалось подключиться к MTProto (см. ошибки выше).');
        process.exit(1);
      }
      try {
        const ref = await resolveChatTopic(client, chatInput, positional[1]);
        chatKey = ref.chatKey;
        topicId = ref.topicId;
        // Кэшируем title при MTProto-резолве (offline-путь single-topic не пишет —
        // наполнится при ближайшем --reset/авто-collect).
        saveChatTitle(ref.chatKey, ref.chatTitle);
        const before = tg.countInTopic(chatKey, topicId);
        if (flags.reset || before === 0) {
          const t0 = Date.now();
          const r = await collectTopic(tg, client, ref, {
            reset: flags.reset,
            limit: flags.limit,
            onProgress: ({ fetched, newlyInserted }) =>
              console.log(`  [collect] fetched=${fetched} new=${newlyInserted}`),
          });
          console.log(
            `✅ collect (${r.mode}): fetched=${r.fetched} new=${r.newlyInserted} | всего: ${r.total} | ${formatDuration(Date.now() - t0)}`,
          );
        } else {
          console.log(
            `ℹ️  топик уже собран (${before} сообщ.) — collect пропущен. Используйте --reset для re-fetch.`,
          );
        }
      } finally {
        await safeDisconnectScan();
      }
    }

    // 3. Length-чанки (склейка сообщений + границы по размеру/gap), ранжированы по реакциям.
    const rows = tg.listForIndex(chatKey!, topicId!);
    if (rows.length === 0) {
      console.error(
        `Нет текстовых сообщений в топике ${chatKey}/${topicId} (только media-only/пустые). Индексация отменена.`,
      );
      process.exit(1);
    }
    const built = buildTopicChunks(rows);
    if (built.length === 0) {
      console.error('buildTopicChunks вернул 0 чанков — нечего индексировать.');
      process.exit(1);
    }
    const DEFAULT_TG_TOP = 1500;
    const n = flags.top ?? DEFAULT_TG_TOP;
    // tier = выбор чанков; label — человекочитаемое описание для лога.
    let tier: typeof built;
    let label: string;
    if (flags.reset) {
      // Полный reindex: чистим и пишем все чанки в порядке убывания реакций.
      store.clearStrategy('telegram');
      tier = built;
      label = `full (--reset, все ${built.length})`;
    } else if (flags.rest) {
      // tier2: доклейка хвоста. НЕ чистим — tier1 уже в индексе. chunkId диапазонов
      // не пересекаются с tier1 → INSERT ортогонален (no UNIQUE, no conflict).
      tier = built.slice(n);
      label = `tier2 (rest, skip top-${n}, ${tier.length} из ${built.length})`;
      if (store.count('telegram') === 0) {
        console.warn('⚠️  tier2 при пустом telegram-индексе. Сначала прогони tier1 (без --rest).');
      }
    } else {
      // tier1 (default): top-N по реакциям. Чистим — повторный прогон переиндексирует top-N.
      store.clearStrategy('telegram');
      tier = built.slice(0, n);
      label = `tier1 (top-${tier.length} из ${built.length} по реакциям)`;
    }
    if (tier.length === 0) {
      console.log(`ℹ️  Нечего индексировать (${label}).`);
      return;
    }
    const chunks = tier.map((t) => t.chunk);
    console.log(`▶ индексация: telegram ${label} | батчей: ${Math.ceil(chunks.length / 32)} (×32)`);
    const t1 = Date.now();
    await indexDocuments(store, 'telegram', chunks, embedder, 32, makeTgIndexProgress(chunks.length));
    const st = store.stats('telegram');
    console.log(`✅ indexed: ${st.chunks} чанков, dim=${st.dim ?? '-'} | ${formatDuration(Date.now() - t1)}`);
    assertDimCompatible(store, embedder); // sanity: dim index'а совместим с embedder
  } finally {
    tg.close();
    store.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Интерактивный чат-REPL с агентом.
// Переиспользует LlmClient и стратегии контекста из core/.
//
// Запуск:
//   pnpm --filter challenge start
//   pnpm --filter challenge start -- chat --strategy sliding --system "Ты ревьюер"

import readline from 'node:readline';

import { Agent, Branching, Constraints, type ContextStrategy, FullHistory, LlmClient, Memory, msg, ProfileManager, SlidingWindow, StickyFacts } from './core/index.js';
import { demos, findDemo } from './demos/registry.js';
import { McpHttpClient } from './core/mcpHttpClient.js';
import { parseTodoArgs } from './core/todoParser.js';
import { runNewsPipeline } from './core/agents/pipeline.js';
import { rewritePost } from './core/agents/postWriter.js';
import { runSourceAgents } from './core/agents/sourcePipeline.js';
import type { AskFn } from './core/agents/telegramScanner.js';
import { StatefulPipeline } from './core/agents/statefulPipeline.js';
import { publishPost, isTelegramConfigured } from './core/agents/telegram.js';
import { BlogDb } from './core/db.js';
import { runAgentRequest } from './core/mcpAgentLoop.js';
import { runDay20 } from './demos/day-20.js';
import { dataPath } from './core/paths.js';
import { RagStore } from './core/rag/index.js';
import { askDevAssistant, CLOUD_DOWN_MESSAGE } from './core/rag/devAssistant.js';
import { runRefactor, runScaffold, runClassify } from './core/fileAgent.js';
import { runFindUsages, runUpdateDocs } from './core/fileAssistant.js';

interface ReplOptions {
  systemPrompt?: string;
  strategyName?: string;
  windowSize?: number;
}

const DEFAULT_SYSTEM = 'Ты — ассистент в CLI. Отвечай кратко и по делу.';
const STRATEGY_NAMES = ['full', 'sliding', 'sticky', 'branching'] as const;
type StrategyName = (typeof STRATEGY_NAMES)[number];

// --- ANSI-цвета (без внешних зависимостей) ---
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

function makeStrategy(name: StrategyName, windowSize: number): ContextStrategy {
  switch (name) {
    case 'sliding': return new SlidingWindow(windowSize);
    case 'sticky': return new StickyFacts(windowSize);
    case 'branching': return new Branching();
    case 'full':
    default: return new FullHistory();
  }
}

function isStrategyName(s: string): s is StrategyName {
  return (STRATEGY_NAMES as ReadonlyArray<string>).includes(s);
}

function trunc(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

// --- Tab-completer: список всех команд для автодополнения по Tab ---
const ALL_COMMANDS = [
  '/help', '/h',
  '/status', '/st', '/system-info', '/sysinfo',
  '/usage',
  '/list',
  '/day ', '/run ',
  '/strategy ', '/strategy full', '/strategy sliding', '/strategy sticky', '/strategy branching',
  '/system ',
  '/reset',
  '/branch ', '/switch ', '/branches',
  '/remember ', '/forget ', '/task ', '/task-add ', '/task-clear', '/task',
  '/memory', '/memory-save', '/memory-on', '/memory-off',
  '/profile', '/profiles', '/profile-use ', '/profile-new ', '/profile-copy ',
  '/profile-edit ', '/profile-note ', '/profile-notes', '/profile-note-rm ',
  '/profile-reset',
  '/news ', '/news --hours ', '/news --top ', '/news --for ', '/news --publish',
  '/news-i ', '/news-interactive ',
  '/write ',
  '/pipeline ', '/pipeline auto ', '/pipeline run ', '/pipeline pick ', '/pipeline next',
  '/pipeline edit ', '/pipeline retry', '/pipeline accept', '/pipeline publish',
  '/pipeline status', '/pipeline resume', '/pipeline reset',
  '/posts', '/post ', '/post-publish ',
  '/scout ', '/scout --hours ', '/scout --top ', '/scout --no-telegram ', '/scout --no-forum ',
  '/constraints', '/constraint add ', '/constraint rm ',
  '/db-stats',
  '/todo ', '/remind ', '/todos', '/todos --pending', '/todos --done', '/done ', '/dismiss ', '/rm-todo ', '/summary', '/mcp ', '/mcp-tools',
  '/agent ',
  '/briefing ', '/briefing --write',
  '/ask ',
  '/files', '/files ',
  '/quit', '/exit',
];

function makeCompleter(): (line: string) => [string[], string] {
  return (line: string): [string[], string] => {
    // Если строка не начинается с / — это обычное сообщение, не дополняем.
    if (!line.startsWith('/')) return [[], ''];

    // Для команд с подкомандами (/pipeline run, /profile-use default и т.д.)
    // ищем совпадение по всей строке.
    const parts = line.split(/\s+/);
    if (parts.length > 2) return [[], '']; // слишком глубокий путь — не дополняем

    const matches = ALL_COMMANDS.filter((cmd) => cmd.startsWith(line));
    return [matches, line];
  };
}

interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface SessionState {
  agent: Agent;
  client: LlmClient;
  strategy: ContextStrategy;
  system: string;
  windowSize: number;
  usage: Usage;
  memory: Memory;
  memoryEnabled: boolean;
  profile: ProfileManager;
  constraints: Constraints;
  ask: AskFn;
}

export async function startRepl(client: LlmClient, opts: ReplOptions = {}): Promise<void> {
  const system = opts.systemPrompt ?? DEFAULT_SYSTEM;
  const strategyName = opts.strategyName ?? 'full';
  const windowSize = opts.windowSize ?? 10;

  const state: SessionState = {
    agent: new Agent(client, system),
    client,
    strategy: makeStrategy(isStrategyName(strategyName) ? strategyName : 'full', windowSize),
    system,
    windowSize,
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    memory: new Memory({ filePath: dataPath('memory.json'), shortTermLimit: windowSize }),
    memoryEnabled: false,
    profile: new ProfileManager(dataPath('profiles')),
    constraints: new Constraints(dataPath('constraints.json')),
    ask: (q: string) => new Promise((resolve) => { rl?.question(q, (a) => resolve(a.trim())); }),
  };

  // Загружаем long-term, профиль и инварианты с диска при старте.
  const loaded = state.memory.loadLongTerm();
  if (loaded > 0) {
    state.memoryEnabled = true;
  }
  state.constraints.load();
  // Загружаем профиль 'default' (или первый доступный).
  const profiles = state.profile.list();
  if (profiles.length > 0) {
    state.profile.load(profiles.includes('default') ? 'default' : profiles[0]);
  } else {
    state.profile.create('default');
  }

  printBanner(state);
  printCompactHelp();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: formatPrompt(state),
    completer: makeCompleter(),
  });

  rl.prompt();

  let closed = false;

  rl.on('line', async (raw: string) => {
    const line = raw.trim();
    if (line === '') { if (!closed) rl.prompt(); return; }

    if (line === '/quit' || line === '/exit') {
      closed = true;
      rl.close();
      return;
    }

    if (line.startsWith('/')) {
      await handleCommand(line, state, rl);
      if (!closed) {
        rl.setPrompt(formatPrompt(state));
        rl.prompt();
      }
      return;
    }

    // Обычное сообщение.
    process.stdout.write(c.dim + '... ' + c.reset);
    try {
      let context: import('./core/index.js').ChatMessage[];
      if (state.memoryEnabled) {
        // Memory mode: short-term из memory, working + long-term инжектятся.
        state.memory.addMessage(msg.user(line));
        context = state.memory.context(state.system);
      } else {
        // Strategy mode (по умолчанию).
        state.strategy.addMessage(msg.user(line));
        context = state.strategy.context();
      }

      // Инъекция инвариантов (день 14): жёсткие правила, LLM не может нарушать.
      const constraintMessages = state.constraints.toSystemMessages();
      // Инъекция профиля в каждый запрос (день 12).
      const profileSystem = msg.system(state.profile.toSystemBlock());
      // Структурный системный промпт: заставляет LLM думать по этапам.
      const structuralSystem = msg.system(
        'СТРУКТУРНЫЙ РЕЖИМ. Каждый твой ответ следует шаблону:\n' +
        '1. ПЛАН — кратко: что собираешься сделать (1-2 строки).\n' +
        '2. ВАЛИДАЦИЯ — проверка: хватает ли данных? Нет ли противоречий?\n' +
        '3. ОТВЕТ — сам результат.\n\n' +
        'Правила:\n' +
        '- НЕ перепрыгивай к ответу без плана.\n' +
        '- Если данных недостаточно — скажи это в валидации и спроси.\n' +
        '- План и валидация — КРАТКО (по 1-2 строки), не раздувай.\n' +
        '- Отвечай на том же языке, что и пользователь.\n' +
        '- Для простых вопросов (калькулятор, факт) план может быть в одно слово.'
      );
      context = [...constraintMessages, profileSystem, structuralSystem, ...context];

      const { content, usage: u } = await client.chatWithUsage(context, {
        temperature: 0.7,
      });
      accumulateUsage(state.usage, u);
      if (state.memoryEnabled) {
        state.memory.addMessage(msg.assistant(content));
      } else {
        state.strategy.addMessage(msg.assistant(content));
      }
      process.stdout.write('\r' + ' '.repeat(4) + '\r');
      console.log(c.green + c.bold + 'assistant' + c.reset + ': ' + content);
      console.log(c.gray + `  ↑ ${u.prompt_tokens}/${u.completion_tokens}/${u.total_tokens} tok · Σ ${state.usage.total_tokens}` + c.reset);
      console.log('');
    } catch (err) {
      process.stdout.write('\r' + ' '.repeat(4) + '\r');
      console.log(c.red + 'error' + c.reset + ': ' + (err as Error).message + '\n');
    }
    if (!closed) {
      rl.setPrompt(formatPrompt(state));
      rl.prompt();
    }
  });

  rl.on('close', () => { closed = true; });

  await new Promise<void>((resolve) => {
    rl.on('close', () => {
      console.log('\n' + c.gray + 'session closed.' + c.reset);
      resolve();
    });
  });
}

function accumulateUsage(acc: Usage, add: Usage): void {
  acc.prompt_tokens += add.prompt_tokens;
  acc.completion_tokens += add.completion_tokens;
  acc.total_tokens += add.total_tokens;
}

function formatPrompt(state: SessionState): string {
  const stratTag = c.magenta + (state.memoryEnabled ? 'mem' : state.strategy.name) + c.reset;
  const tokTag = c.gray + `${state.usage.total_tokens} tok` + c.reset;
  const branchInfo = (!state.memoryEnabled && state.strategy instanceof Branching)
    ? ' ' + c.blue + `#${state.strategy.activeBranchId}` + c.reset
    : '';
  const memTag = state.memoryEnabled && state.memory.longTermKeys.length > 0
    ? ' ' + c.yellow + `★${state.memory.longTermKeys.length}` + c.reset
    : '';
  return `${stratTag}${branchInfo}${memTag} ${tokTag}> `;
}

function printBanner(state: SessionState): void {
  const line = c.gray + '─'.repeat(56) + c.reset;
  console.log('');
  console.log(line);
  console.log(c.bold + c.cyan + '  LLM Challenge REPL' + c.reset + c.gray + '  ·  monolith chat agent' + c.reset);
  console.log(line);
  console.log(c.gray + '  model   ' + c.reset + state.client.defaultModel);
  console.log(c.gray + '  context ' + c.reset + state.strategy.name);
  console.log(c.gray + '  system  ' + c.reset + trunc(state.system, 50));
  console.log(line);
  console.log('');
}

function printCompactHelp(): void {
  console.log(c.gray + '  Команды начинаются с /. Tab — автодополнение. Просто текст — отправится в LLM.' + c.reset);
  console.log(c.gray + '  /help — полный список, /quit — выход.\n' + c.reset);
}

async function handleCommand(raw: string, state: SessionState, _rl: unknown): Promise<void> {
  const [cmd, ...rest] = raw.slice(1).split(/\s+/);
  const arg = rest.join(' ');

  switch (cmd) {
    case 'help':
    case 'h': {
      printFullHelp(state);
      return;
    }
    case 'status':
    case 'st': {
      printStatus(state);
      return;
    }
    case 'list': {
      printDemosList();
      return;
    }
    case 'ask': {
      const q = arg.trim();
      if (!q) {
        console.log(c.gray + 'Использование: /ask <вопрос>\n' + c.reset);
        return;
      }
      const store = new RagStore(dataPath('rag.sqlite'));
      try {
        console.log(c.cyan + '▶ dev-assistant:' + c.reset + ' ' + q + '\n');
        const res = await askDevAssistant(q, store);
        console.log(res.answer);
        const srcLines = res.sources.map(
          (s, i) =>
            `  [${i + 1}] ${s.chunk.metadata.section} (score=${s.score.toFixed(2)}, source=${s.chunk.metadata.source})`,
        );
        console.log(c.gray + 'Источники:' + c.reset);
        console.log(srcLines.length > 0 ? srcLines.join('\n') : c.gray + '(нет — guard «не знаю»)' + c.reset);
        const tag =
          res.cloudStatus === 'ok'
            ? `cloud: ${res.cloudModel} (${res.dtMs ?? 0}ms)`
            : res.cloudStatus === 'no-key'
              ? 'cloud: нет OPENROUTER_API_KEY (draft-only)'
              : 'cloud: недоступен (draft-only)';
        console.log(c.gray + '[' + tag + ']' + c.reset + '\n');
      } catch (err) {
        console.log(c.red + 'Ошибка /ask: ' + (err instanceof Error ? err.message : String(err)) + c.reset + '\n');
      } finally {
        store.close();
      }
      return;
    }
    case 'day': {
      if (!arg) { console.log(c.gray + 'Использование: /day <id>, например /day day-06\n' + c.reset); return; }
      const demo = findDemo(arg);
      if (!demo) { console.log(c.red + `День "${arg}" не найден. /list покажет все.` + c.reset + '\n'); return; }
      console.log(c.cyan + demo.id + c.reset + '  ' + demo.title + '\n');
      return;
    }
    case 'run': {
      if (!arg) { console.log(c.gray + 'Запуск демо: /run day-14 (дефис, не пробел!)\n' + c.reset); return; }
      const demo = findDemo(arg);
      if (!demo) { console.log(c.red + `День "${arg}" не найден. /list покажет все.` + c.reset + '\n'); return; }
      console.log(c.bold + c.cyan + `\n▶ Запуск: ${demo.id} — ${demo.title}\n` + c.reset);
      try {
        await demo.run();
      } catch (err) {
        console.log(c.red + 'Ошибка демо: ' + (err as Error).message + c.reset + '\n');
      }
      console.log('');
      return;
    }
    case 'strategy': {
      if (!arg) {
        console.log(c.gray + `Текущая стратегия: ${state.strategy.name}. Доступно: full, sliding, sticky, branching\n` + c.reset);
        return;
      }
      if (!isStrategyName(arg)) {
        console.log(c.red + `Неизвестная стратегия "${arg}". Доступно: full, sliding, sticky, branching` + c.reset + '\n');
        return;
      }
      state.strategy = makeStrategy(arg, state.windowSize);
      console.log(c.magenta + 'strategy → ' + arg + c.reset + c.gray + '  (история сброшена)\n' + c.reset);
      return;
    }
    case 'system': {
      if (!arg) {
        console.log(c.gray + 'Текущий system: ' + state.system + '\n');
        console.log(c.gray + 'Сменить: /system <новый system-промпт>\n' + c.reset);
        return;
      }
      state.system = arg;
      state.agent.reset();
      state.strategy = makeStrategy(state.strategy.name === 'branching' ? 'branching' : 'full', state.windowSize);
      state.strategy.clear();
      state.strategy.addMessage(msg.system(arg));
      console.log(c.blue + 'system → ' + c.reset + trunc(arg, 60) + c.gray + '  (история сброшена)\n' + c.reset);
      return;
    }
    case 'branch': {
      if (!(state.strategy instanceof Branching)) {
        console.log(c.yellow + 'Команда доступна только в /strategy branching' + c.reset + '\n');
        return;
      }
      const id = state.strategy.checkpoint(arg || `branch-${Date.now()}`);
      console.log(c.blue + 'branch +' + c.reset + ` id=${id} "${arg || 'auto'}"\n`);
      return;
    }
    case 'switch': {
      if (!(state.strategy instanceof Branching)) {
        console.log(c.yellow + 'Команда доступна только в /strategy branching' + c.reset + '\n');
        return;
      }
      const id = Number(arg);
      if (!Number.isFinite(id)) {
        console.log(c.gray + 'Использование: /switch <id>\n' + c.reset);
        return;
      }
      try {
        state.strategy.switchTo(id);
        console.log(c.blue + 'switch → ' + c.reset + `ветка ${id}\n`);
      } catch (e) {
        console.log(c.red + (e as Error).message + c.reset + '\n');
      }
      return;
    }
    case 'branches': {
      if (!(state.strategy instanceof Branching)) {
        console.log(c.yellow + 'Команда доступна только в /strategy branching' + c.reset + '\n');
        return;
      }
      const list = state.strategy.listBranches();
      if (list.length === 0) {
        console.log(c.gray + 'Нет веток (только main).\n' + c.reset);
        return;
      }
      console.log(c.bold + 'Ветки:' + c.reset);
      for (const info of list) {
        const marker = info.id === state.strategy.activeBranchId ? c.green + ' *' + c.reset : '  ';
        console.log(`${marker} ${c.gray}#${info.id}${c.reset}  ${info.label}  ${c.gray}(${info.messageCount} сообщений)${c.reset}`);
      }
      console.log('');
      return;
    }
    case 'reset': {
      state.strategy.clear();
      state.agent.reset();
      state.strategy.addMessage(msg.system(state.system));
      state.memory.clearShortTerm();
      state.usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      console.log(c.yellow + 'reset' + c.reset + c.gray + '  история, ветки, usage (system + long-term сохранены)\n' + c.reset);
      return;
    }
    case 'remember': {
      if (!arg) {
        console.log(c.gray + 'Использование: /remember <ключ>: <значение>\n  Пример: /remember имя: Артём\n' + c.reset);
        return;
      }
      const sep = arg.indexOf(':');
      if (sep === -1) {
        console.log(c.red + 'Формат: /remember <ключ>: <значение>' + c.reset + '\n');
        return;
      }
      const key = arg.slice(0, sep).trim();
      const value = arg.slice(sep + 1).trim();
      state.memory.remember(key, value);
      state.memoryEnabled = true;
      console.log(c.yellow + '★ long-term' + c.reset + ` + "${key}: ${value}"`);
      console.log(c.gray + '  (всего в long-term: ' + state.memory.longTermKeys.length + ')\n' + c.reset);
      return;
    }
    case 'forget': {
      if (!arg) {
        console.log(c.gray + 'Использование: /forget <ключ>\n  Например: /forget имя\n' + c.reset);
        return;
      }
      if (state.memory.forget(arg)) {
        console.log(c.yellow + '★ long-term' + c.reset + ` - "${arg}"`);
        console.log(c.gray + '  (осталось: ' + state.memory.longTermKeys.length + ')\n' + c.reset);
      } else {
        console.log(c.red + `Ключ "${arg}" не найден в long-term.` + c.reset + '\n');
      }
      return;
    }
    case 'task': {
      if (!arg) {
        if (state.memory.task) {
          console.log(c.gray + 'Текущая задача: ' + c.reset + state.memory.task + '\n');
        } else {
          console.log(c.gray + 'Нет активной задачи. Задать: /task <описание>\n' + c.reset);
        }
        return;
      }
      state.memory.setTask(arg);
      state.memoryEnabled = true;
      console.log(c.blue + 'task' + c.reset + ` → ${arg}\n`);
      return;
    }
    case 'task-add': {
      if (!arg) {
        console.log(c.gray + 'Использование: /task-add <ключ>: <значение>\n' + c.reset);
        return;
      }
      const sep = arg.indexOf(':');
      if (sep === -1) {
        console.log(c.red + 'Формат: /task-add <ключ>: <значение>' + c.reset + '\n');
        return;
      }
      const key = arg.slice(0, sep).trim();
      const value = arg.slice(sep + 1).trim();
      state.memory.setWorkingFact(key, value);
      state.memoryEnabled = true;
      console.log(c.blue + 'task' + c.reset + ` + "${key}: ${value}"\n`);
      return;
    }
    case 'task-clear': {
      state.memory.clearWorking();
      console.log(c.blue + 'task' + c.reset + c.gray + ' cleared (задача + факты)\n' + c.reset);
      return;
    }
    case 'memory': {
      printMemory(state);
      return;
    }
    case 'memory-save': {
      state.memory.saveLongTerm();
      console.log(c.green + 'long-term сохранён на диск.' + c.reset + '\n');
      return;
    }
    case 'memory-on': {
      state.memoryEnabled = true;
      console.log(c.green + 'Memory mode ON' + c.reset + c.gray + '  (context строится из 3 слоёв памяти)\n' + c.reset);
      return;
    }
    case 'memory-off': {
      state.memoryEnabled = false;
      console.log(c.gray + 'Memory mode OFF' + c.reset + c.gray + '  (context строится из strategy)\n' + c.reset);
      return;
    }
    case 'profile': {
      printProfile(state);
      return;
    }
    case 'profiles': {
      const list = state.profile.list();
      const active = state.profile.activeName;
      console.log(c.bold + 'Профили:' + c.reset);
      for (const name of list) {
        const marker = name === active ? c.green + ' *' + c.reset : '  ';
        console.log(`${marker} ${name}`);
      }
      console.log(c.gray + '\n  * = активный\n' + c.reset);
      return;
    }
    case 'profile-use': {
      if (!arg) {
        console.log(c.gray + 'Использование: /profile-use <имя>\n' + c.reset);
        return;
      }
      if (state.profile.load(arg)) {
        console.log(c.green + 'profile → ' + arg + c.reset + '\n');
      } else {
        console.log(c.red + `Профиль "${arg}" не найден. /profiles — список.` + c.reset + '\n');
      }
      return;
    }
    case 'profile-new': {
      if (!arg) {
        console.log(c.gray + 'Использование: /profile-new <имя>\n' + c.reset);
        return;
      }
      state.profile.create(arg);
      console.log(c.green + 'profile + ' + arg + c.reset + c.gray + '  (создан с значениями по умолчанию)\n' + c.reset);
      return;
    }
    case 'profile-copy': {
      if (!arg) {
        console.log(c.gray + 'Использование: /profile-copy <новое имя>\n' + c.reset);
        return;
      }
      if (state.profile.copy(arg)) {
        console.log(c.green + 'profile → copy → ' + arg + c.reset + '\n');
      } else {
        console.log(c.red + 'Нет активного профиля для копирования.' + c.reset + '\n');
      }
      return;
    }
    case 'profile-edit': {
      if (!arg) {
        console.log(c.gray + 'Редактирование естественным языком:\n  /profile-edit убери эмодзи и добавь сарказма\n' + c.reset);
        return;
      }
      if (!state.profile.activeName) {
        console.log(c.red + 'Нет активного профиля.' + c.reset + '\n');
        return;
      }
      console.log(c.gray + 'LLM редактирует профиль...' + c.reset);
      try {
        const diff = await state.profile.editViaLLM(arg, state.client);
        console.log(c.magenta + 'profile' + c.reset + ' (' + state.profile.activeName + ') обновлён:');
        console.log(c.gray + diff + c.reset + '\n');
      } catch (e) {
        console.log(c.red + 'Ошибка: ' + (e as Error).message + c.reset + '\n');
      }
      return;
    }
    case 'profile-reset': {
      state.profile.reset();
      state.profile.save();
      console.log(c.yellow + 'profile reset' + c.reset + c.gray + '  (значения по умолчанию)\n' + c.reset);
      return;
    }
    case 'profile-note': {
      if (!arg) {
        console.log(c.gray + 'Добавить заметку: /profile-note <текст>\n' + c.reset);
        return;
      }
      state.profile.addNote(arg);
      console.log(c.magenta + 'note +' + c.reset + ` "${arg.slice(0, 60)}${arg.length > 60 ? '...' : ''}"`);
      console.log(c.gray + `  (всего заметок: ${state.profile.notes.length})\n` + c.reset);
      return;
    }
    case 'profile-notes': {
      const notes = state.profile.notes;
      if (notes.length === 0) {
        console.log(c.gray + 'Заметок нет. Добавить: /profile-note <текст>\n' + c.reset);
        return;
      }
      console.log(c.bold + `Заметки (${notes.length}):` + c.reset);
      notes.forEach((n, i) => {
        console.log(c.gray + `  ${i}.` + c.reset + ` ${n}`);
      });
      console.log(c.gray + '\nУдалить: /profile-note-rm <номер>\n' + c.reset);
      return;
    }
    case 'profile-note-rm': {
      const idx = Number(arg);
      if (!Number.isFinite(idx)) {
        console.log(c.gray + 'Использование: /profile-note-rm <номер>\n' + c.reset);
        return;
      }
      if (state.profile.removeNote(idx)) {
        console.log(c.green + `Заметка ${idx} удалена.` + c.reset + '\n');
      } else {
        console.log(c.red + `Нет заметки с номером ${idx}.` + c.reset + '\n');
      }
      return;
    }
    case 'usage': {
      const u = state.usage;
      const bar = '█'.repeat(Math.min(20, Math.round(u.total_tokens / 500))) +
                  '░'.repeat(Math.max(0, 20 - Math.round(u.total_tokens / 500)));
      console.log(c.bold + 'Использование токенов:' + c.reset);
      console.log(c.gray + '  prompt     ' + c.reset + u.prompt_tokens);
      console.log(c.gray + '  completion ' + c.reset + u.completion_tokens);
      console.log(c.gray + '  total      ' + c.reset + u.total_tokens);
      console.log(c.gray + '  ' + bar + c.reset + '\n');
      return;
    }
    case 'system-info':
    case 'sysinfo': {
      await printSystemInfo(state);
      return;
    }
    case 'scout': {
      await handleScoutCommand(arg, state);
      return;
    }
    case 'constraint':
    case 'constraints': {
      const [csub, ...crest] = arg.split(/\s+/);
      const carg = crest.join(' ').trim();
      handleConstraintsCommand(csub ?? '', carg, state);
      return;
    }
    case 'news': {
      await handleNewsCommand(arg, state);
      return;
    }
    case 'db-stats': {
      handleDbStatsCommand();
      return;
    }
    case 'news-i':
    case 'news-interactive': {
      await handleNewsInteractiveCommand(arg, state);
      return;
    }
    case 'write': {
      await handleWriteCommand(arg, state);
      return;
    }
    case 'pipeline': {
      await handlePipelineCommand(arg, state);
      return;
    }
    case 'posts': {
      handlePostsCommand();
      return;
    }
    case 'post': {
      handlePostCommand(arg);
      return;
    }
    case 'post-publish': {
      await handlePostPublishCommand(arg);
      return;
    }
    case 'quit':
    case 'exit':
      return;
    case 'todo':
    case 'remind':
    case 'todos':
    case 'done':
    case 'dismiss':
    case 'rm-todo':
    case 'summary':
    case 'mcp':
    case 'mcp-tools':
      await handleMcpCommand(cmd, arg, state);
      return;
    case 'agent': {
      if (!arg) {
        console.log(c.gray + 'Использование: /agent <запрос>\n  Пример: /agent просканируй последние 200 сообщений в чате "факты в чате" и пришли отчёт\n' + c.reset);
        return;
      }
      const serverUrl = mcpUrl();
      console.log(c.gray + 'Агент гонит цепочку MCP-тулов на ' + serverUrl + ' ...\n' + c.reset);
      try {
        const answer = await runAgentRequest(state.client, serverUrl, arg);
        console.log(c.green + 'agent' + c.reset + ': ' + answer + '\n');
      } catch (err) {
        console.log(c.red + 'agent error: ' + (err instanceof Error ? err.message : String(err)) + c.reset + '\n');
      }
      return;
    }
    case 'briefing': {
      // /briefing <запрос> [--write] — оркестрация дня 20 (filesystem+world+telegram).
      const write = arg.includes('--write');
      const request = arg.replace('--write', '').trim();
      console.log(
        c.gray +
          `Оркентсрация дня 20 (${write ? 'write: vault + Telegram' : 'dry-run'})...` +
          c.reset +
          '\n',
      );
      console.log(
        c.gray +
          'Нужен поднятый day-20-server: pnpm --filter challenge start -- day-20-server' +
          c.reset +
          '\n',
      );
      try {
        await runDay20(request || undefined, write);
      } catch (err) {
        console.log(
          c.red + 'briefing error: ' + (err instanceof Error ? err.message : String(err)) + c.reset + '\n',
        );
      }
      console.log('');
      return;
    }
    case 'files': {
      await handleFilesCommand(arg);
      return;
    }
    default:
      console.log(c.red + `Неизвестная команда /${cmd}` + c.reset + c.gray + '  /help — список.\n' + c.reset);
  }
}

// --- MCP-команды в REPL ---

/** URL MCP-сервера: env MCP_SERVER_URL (локальный режим), иначе prod. */
const mcpUrl = (): string => process.env.MCP_SERVER_URL ?? 'https://api.memo7.ru/mcp';

async function mcpCall(toolName: string, args?: Record<string, unknown>): Promise<string> {
  const client = new McpHttpClient(mcpUrl());
  try {
    await client.connect();
    return await client.callTool(toolName, args);
  } finally {
    client.disconnect();
  }
}

async function handleMcpCommand(cmd: string, arg: string, _state: SessionState): Promise<void> {
  const label = c.cyan + '/mcp' + c.reset;
  try {
    switch (cmd) {
      case 'todo':
      case 'remind': {
        if (!arg) {
          console.log(c.gray + `Использование: /todo <текст> [--daily|--weekly N|--hourly N]\n` + c.reset);
          return;
        }
        const parts = arg.split(/\s+/);
        const { text, args: parsed } = parseTodoArgs(parts);
        if (!text) {
          console.log(c.gray + `Использование: /todo <текст> [--daily|--weekly N|--hourly N]\n` + c.reset);
          return;
        }
        const result = await mcpCall('add_todo', parsed);
        console.log(label + ' ✓ ' + result + c.reset);
        break;
      }
      case 'todos': {
        const statusMap: Record<string, string> = { '--pending': 'pending', '--done': 'done', '--dismissed': 'dismissed' };
        const status = statusMap[arg] || undefined;
        const result = await mcpCall('list_todos', status ? { status } : {});
        console.log(result);
        break;
      }
      case 'done': {
        const id = Number(arg);
        if (!id || isNaN(id)) { console.log(c.red + 'Укажи ID: /done 3\n' + c.reset); return; }
        const result = await mcpCall('complete_todo', { id });
        console.log(label + ' ✓ ' + result + c.reset);
        break;
      }
      case 'dismiss': {
        const id = Number(arg);
        if (!id || isNaN(id)) { console.log(c.red + 'Укажи ID: /dismiss 3\n' + c.reset); return; }
        const result = await mcpCall('dismiss_todo', { id });
        console.log(label + ' ✓ ' + result + c.reset);
        break;
      }
      case 'rm-todo': {
        const id = Number(arg);
        if (!id || isNaN(id)) { console.log(c.red + 'Укажи ID: /rm-todo 3\n' + c.reset); return; }
        const result = await mcpCall('delete_todo', { id });
        console.log(label + ' ✓ ' + result + c.reset);
        break;
      }
      case 'summary': {
        const result = await mcpCall('send_summary', {});
        console.log(label + ' ✓ ' + result + c.reset);
        break;
      }
      case 'mcp-tools': {
        const client = new McpHttpClient(mcpUrl());
        try {
          await client.connect();
          const tools = await client.listTools();
          if (tools.length === 0) {
            console.log(c.gray + 'Нет инструментов на сервере.\n' + c.reset);
          } else {
            console.log(c.bold + `Инструменты (${tools.length}):` + c.reset);
            for (const t of tools) {
              console.log('  ' + c.green + t.name + c.reset + (t.description ? c.gray + ' — ' + t.description + c.reset : ''));
            }
            console.log('');
          }
        } finally {
          client.disconnect();
        }
        break;
      }
      case 'mcp': {
        const mcpParts = arg.split(/\s+/);
        const toolName = mcpParts[0];
        if (!toolName) { console.log(c.gray + 'Использование: /mcp <tool> [key=value ...]\n' + c.reset); return; }
        const restParts = mcpParts.slice(1);
        const mcpArgs: Record<string, unknown> = {};
        for (const part of restParts) {
          const eqIdx = part.indexOf('=');
          if (eqIdx > 0) {
            const key = part.slice(0, eqIdx);
            const val: unknown = part.slice(eqIdx + 1);
            try { mcpArgs[key] = JSON.parse(val as string); } catch { mcpArgs[key] = val; }
          }
        }
        const result = await mcpCall(toolName, mcpArgs);
        console.log(result);
        break;
      }
    }
  } catch (err) {
    console.log(c.red + 'MCP ошибка: ' + (err instanceof Error ? err.message : String(err)) + c.reset + '\n');
  }
}

function printFullHelp(state: SessionState): void {
  const header = (text: string) => console.log(c.bold + c.cyan + text + c.reset);
  const row = (cmd: string, desc: string) => console.log('  ' + c.green + cmd.padEnd(28) + c.reset + c.gray + desc + c.reset);

  console.log('');
  header('Состояние сессии');
  row('/status', 'краткий статус (модель, стратегия, токены)');
  row('/system-info', 'полная сводка: память, профиль, инварианты, агенты, БД');
  row('/usage', 'накопленные токены с прогресс-баром');
  console.log('');
  header('Контекст');
  row('/strategy [name]', 'full | sliding | sticky | branching');
  row('/system <text>', 'сменить system-промпт');
  row('/reset', 'очистить историю и usage (system + long-term сохраняются)');
  console.log('');
  header('Память (день 11: 3 слоя)');
  row('/remember <key>: <val>', 'сохранить в long-term (переживает перезапуск)');
  row('/forget <key>', 'удалить из long-term');
  row('/task <description>', 'задать текущую задачу (working memory)');
  row('/task-add <key>: <val>', 'добавить факт в working memory');
  row('/task-clear', 'очистить working memory');
  row('/memory', 'показать все 3 слоя памяти');
  row('/memory-save', 'записать long-term на диск');
  row('/memory-on', 'включить memory mode (context из 3 слоёв)');
  row('/memory-off', 'выключить (обычная strategy)');
  console.log('');
  header('Профили (день 12: персонализация)');
  row('/profile', 'показать активный профиль + заметки');
  row('/profiles', 'список всех профилей');
  row('/profile-use <name>', 'переключиться на профиль');
  row('/profile-new <name>', 'создать новый профиль (по умолчанию)');
  row('/profile-copy <name>', 'копировать активный профиль');
  row('/profile-edit <text>', 'редактировать через LLM (поля + заметки)');
  row('/profile-note <text>', 'добавить заметку вручную');
  row('/profile-notes', 'список всех заметок');
  row('/profile-note-rm <N>', 'удалить заметку по номеру');
  row('/profile-reset', 'сбросить активный профиль к умолчанию');
  console.log('');
  header('Блог-агенты');
  row('/news [opts]', 'pipeline RSS→агенты→пост. Опции: --hours N --top K --for i --publish');
  row('/news-i [opts]', 'интерактивный: выбор новости, правки поста, решение по фактчекингу');
  row('/write <тема>', 'свободный пост на любую тему (без RSS), + личный комментарий');
  row('/pipeline auto', 'авто-прогон: 4 агента, FSM, ревизор — без ручного управления');
  row('/pipeline run', 'ручной запуск: только RSS + агент 1 (топ-новости)');
  row('/pipeline pick <N>', 'выбрать новость → агент 2 + 3');
  row('/pipeline next', 'автопереход: ревизор или фактчекинг');
  row('/pipeline edit <text>', 'ручная правка поста');
  row('/pipeline accept', 'принять как есть → done');
  row('/pipeline publish', 'опубликовать в Telegram');
  row('/pipeline status', 'состояние FSM');
  row('/posts', 'последние сохранённые посты');
  row('/post <id>', 'показать пост по номеру');
  row('/post-publish <id>', 'опубликовать сохранённый пост в Telegram');
  row('/db-stats', 'статистика БД');
  console.log('');
  header('Ветки диалога  (только в /strategy branching)');
  row('/branch [label]', 'чекпойнт + новая ветка');
  row('/switch <id>', 'переключиться на ветку');
  row('/branches', 'список веток');
  console.log('');
  header('Инварианты (день 14: ограничения)');
  row('/constraints', 'список всех инвариантов');
  row('/constraint add <type> <t>: <d>', 'добавить (architecture|tech_decision|stack|business|custom)');
  row('/constraint rm <id>', 'удалить инвариант');
  console.log('');
  header('Блог-агенты');
  row('/scout [opts]', '3 агента параллельно (RSS+форумы+TG) → оркестратор: топ-K тем');
  row('/news [opts]', 'pipeline RSS→агенты→пост. Опции: --hours N --top K --for i --publish');
  row('/db-stats', 'статистика БД: новости, посты, образцы стиля');
  console.log('');
  header('Дни');
  row('/list', 'список всех дней');
  row('/day <id>', 'описание дня (например /day day-14)');
  row('/run <id>', 'запустить демо дня (например /run day-14)');
  console.log('');
  header('MCP-сервер (api.memo7.ru)');
  row('/todo <text> [--daily|--weekly N|--hourly N]', 'добавить задачу / напоминание');
  row('/todos [--pending|--done]', 'список задач');
  row('/done <id>', 'завершить задачу');
  row('/dismiss <id>', 'отклонить');
  row('/rm-todo <id>', 'удалить');
  row('/summary', 'отправить сводку в Telegram');
  row('/mcp-tools', 'список инструментов на MCP-сервере');
  row('/mcp <tool> key=val ...', 'вызвать любой MCP-инструмент');
  console.log('');
  header('Оркестрация дня 20 (filesystem + world + telegram)');
  row('/briefing <запрос>', 'мульти-MCP брифинг по vault (dry-run, только чтение)');
  row('/briefing <запрос> --write', 'записать брифинг в vault и отправить в Telegram');
  console.log('');
  header('Dev-assistant');
  row('/ask <вопрос>', 'ответ о структуре репо (RAG docs → local draft → cloud refine)');
  console.log('');
  header('Файловый агент (день 34)');
  row('/files find <symbol>', 'найти использования символа (read-only, без cloud)');
  row('/files docs <goal> [--write]', 'обновить doc (README|AGENTS|docs/*): dry-run diff / --write');
  row('/files refactor <goal> [--write]', 'рефактор .ts в challenge/src/ (typecheck-rollback)');
  row('/files scaffold <goal> [--write]', 'новый .ts в challenge/src/utils/** (dry-run / --write)');
  row('/files run <NL>', 'классификация NL → docs|refactor|scaffold (dry-run, без --write)');
  console.log('');
  header('Системные');
  row('/help, /h', 'эта справка');
  row('/quit, /exit', 'выход (или Ctrl+D)');
  console.log('');
  const mode = state.memoryEnabled ? c.green + 'memory' + c.reset : c.magenta + state.strategy.name + c.reset;
  console.log(c.gray + 'Режим контекста: ' + mode + '\n');
}

function printMemory(state: SessionState): void {
  const line = c.gray + '─'.repeat(50) + c.reset;
  console.log('');
  console.log(line);
  console.log(c.bold + '  Memory Layers (день 11)' + c.reset);
  console.log(line);

  // Long-term.
  console.log(c.yellow + '  LONG-TERM' + c.reset + c.gray + '  (.data/memory.json, переживает перезапуск)' + c.reset);
  const ltKeys = state.memory.longTermKeys;
  if (ltKeys.length === 0) {
    console.log(c.gray + '    (пусто)' + c.reset);
  } else {
    for (const k of ltKeys) {
      console.log(c.gray + '    ' + c.reset + k + ': ' + state.memory.recall(k));
    }
  }

  // Working.
  console.log(c.blue + '\n  WORKING' + c.reset + c.gray + '  (RAM, данные текущей задачи)' + c.reset);
  if (state.memory.task) {
    console.log(c.gray + '    задача: ' + c.reset + state.memory.task);
  }
  const wKeys = state.memory.workingKeys;
  if (wKeys.length === 0 && !state.memory.task) {
    console.log(c.gray + '    (пусто)' + c.reset);
  } else {
    for (const k of wKeys) {
      console.log(c.gray + '    ' + c.reset + k + ': ' + state.memory.getWorkingFact(k));
    }
  }

  // Short-term.
  console.log(c.gray + '\n  SHORT-TERM' + c.reset + c.gray + '  (RAM, последние сообщения)' + c.reset);
  const snap = state.memory.snapshot();
  console.log(c.gray + '    сообщений: ' + snap.shortTermCount + c.reset);

  // Mode.
  console.log(c.gray + '\n  режим: ' + c.reset + (state.memoryEnabled ? c.green + 'memory ON' + c.reset : c.gray + 'memory OFF (strategy mode)' + c.reset));
  console.log(line + '\n');
}

const DB_PATH = dataPath('blog.sqlite');

async function handleNewsCommand(arg: string, state: SessionState): Promise<void> {
  // Парсим флаги из аргумента.
  const parts = arg.split(/\s+/);
  let hours = 24, topK = 5, forIndex = 0, publish = false;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '--hours' && parts[i + 1]) { hours = Number(parts[++i]); continue; }
    if (parts[i] === '--top' && parts[i + 1]) { topK = Number(parts[++i]); continue; }
    if (parts[i] === '--for' && parts[i + 1]) { forIndex = Number(parts[++i]); continue; }
    if (parts[i] === '--publish') { publish = true; continue; }
  }

  const db = new BlogDb(DB_PATH);
  try {
    console.log(c.bold + c.cyan + '\n▶ Блог-pipeline: RSS → агент 1 → агент 2 → агент 3\n' + c.reset);
    const result = await runNewsPipeline(db, state.client, {
      maxAgeHours: hours,
      topK,
      writeForIndex: forIndex,
      profile: state.profile,
      log: console.log,
    });

    console.log('\n' + c.bold + '=== Топ-новости (агент 1) ===' + c.reset);
    for (const r of result.news.ranked) {
      console.log(`  ${c.green}[${r.score}]${c.reset} ${r.news.title}  ${c.gray}(${r.why})${c.reset}`);
    }

    if (!result.post) {
      console.log(c.yellow + '\nНет подходящих новостей для поста.' + c.reset + '\n');
      return;
    }

    console.log('\n' + c.bold + '=== Пост (агент 2) ===' + c.reset);
    console.log(result.post.content);

    if (result.factCheck) {
      console.log('\n' + c.bold + '=== Фактчекинг (агент 3) ===' + c.reset);
      if (result.factCheck.reasoning.trim()) {
        console.log(c.gray + '\n--- ход рассуждений ---' + c.reset);
        console.log(result.factCheck.reasoning.trim());
        console.log(c.gray + '--- конец рассуждений ---\n' + c.reset);
      }
      const vc = result.factCheck.verdict === 'ok' ? c.green : c.yellow;
      console.log(`${c.gray}verdict:${c.reset} ${vc}${result.factCheck.verdict}${c.reset}`);
      console.log(c.gray + 'recommendation: ' + c.reset + result.factCheck.recommendation);
      if (result.factCheck.issues.length > 0) {
        console.log(c.gray + 'issues:' + c.reset);
        for (const issue of result.factCheck.issues) {
          console.log(`  ${c.red}[${issue.severity}]${c.reset} ${issue.claim}`);
          console.log(`         ${c.gray}vs: ${issue.source}${c.reset}`);
        }
      } else {
        console.log(c.gray + 'issues: нет' + c.reset);
      }
    }

    // Публикация в Telegram.
    if (publish) {
      if (!isTelegramConfigured()) {
        console.log(c.yellow + '\n[telegram] TG_BOT_TOKEN или TG_CHAT_ID не заданы — пропуск.' + c.reset + '\n');
      } else if (result.factCheck && result.factCheck.verdict !== 'ok') {
        console.log(c.yellow + '\n[telegram] verdict != ok — пост НЕ опубликован.' + c.reset + '\n');
      } else {
        console.log(c.gray + '\n[telegram] Публикую...' + c.reset);
        const tg = await publishPost(result.post.content);
        if (tg.ok) {
          console.log(c.green + `[telegram] Пост опубликован (message_id=${tg.messageId}).` + c.reset + '\n');
        } else {
          console.error(c.red + `[telegram] Ошибка: ${tg.error}` + c.reset + '\n');
        }
      }
    } else {
      console.log(c.gray + '\n(без публикации. Добавьте --publish для отправки в Telegram)\n' + c.reset);
    }
  } catch (err) {
    console.log(c.red + 'Ошибка pipeline: ' + (err as Error).message + c.reset + '\n');
  } finally {
    db.close();
  }
}

function handleDbStatsCommand(): void {
  const db = new BlogDb(DB_PATH);
  try {
    console.log('');
    console.log(c.bold + '=== БД блог-агентов ===' + c.reset);
    console.log(c.gray + '  файл:' + c.reset + ' ' + DB_PATH);
    console.log(c.gray + '  новостей:' + c.reset + ' ' + db.newsCount());
    console.log(c.gray + '  постов:' + c.reset + '   ' + db.postsCount());
    console.log(c.gray + '  стилей:' + c.reset + '   ' + db.styleSamplesCount());
    console.log('');
  } finally {
    db.close();
  }
}

async function handleNewsInteractiveCommand(arg: string, state: SessionState): Promise<void> {
  const parts = arg.split(/\s+/);
  let hours = 24, topK = 5;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '--hours' && parts[i + 1]) { hours = Number(parts[++i]); continue; }
    if (parts[i] === '--top' && parts[i + 1]) { topK = Number(parts[++i]); continue; }
  }

  const db = new BlogDb(DB_PATH);

  const ask = state.ask;

  try {
    console.log(c.bold + c.cyan + '\n▶ Интерактивный pipeline\n' + c.reset);

    // --- ШАГ 0: RSS ---
    console.log(c.gray + '[0] Загружаю RSS...\n' + c.reset);
    const { fetchAllFeeds, filterRecent, toNewsRow } = await import('./core/agents/rss.js');
    const items = filterRecent(await fetchAllFeeds(), hours);
    let added = 0;
    for (const item of items) { if (db.insertNews(toNewsRow(item))) added++; }
    console.log(`    получено ${items.length}, новых ${added}\n`);

    // --- ШАГ 1: Агент 1 (топ-новости) ---
    console.log(c.gray + '[1] Агент 1: выбираю топ-новости...\n' + c.reset);
    const { NewsFetcher } = await import('./core/agents/newsFetcher.js');
    const fetcher = new NewsFetcher(state.client);
    const news = await fetcher.fetch(db, { maxAgeHours: hours, topK });

    if (news.ranked.length === 0) {
      console.log(c.yellow + 'Нет новостей.\n' + c.reset);
      return;
    }

    console.log(c.bold + '    Топ-новости:' + c.reset);
    news.ranked.forEach((r, i) => {
      console.log(`    ${c.green}${i}${c.reset} [${r.score}] ${r.news.title}`);
      console.log(`      ${c.gray}(${r.why})${c.reset}`);
    });

    // Выбор новости.
    let chosenIdx = 0;
    if (news.ranked.length > 1) {
      const choice = await ask(c.gray + '\nКакую новость берём? (Enter = 0, или номер): ' + c.reset);
      if (choice && /^\d+$/.test(choice)) {
        chosenIdx = Math.min(Number(choice), news.ranked.length - 1);
      }
    }
    const chosen = news.ranked[chosenIdx].news;
    console.log(c.green + `\n→ "${chosen.title}"\n` + c.reset);

    // --- Своя тема или комментарий от автора ---
    let userTopic: string | undefined;
    let userComment: string | undefined;
    const customChoice = await ask(
      c.gray + 'Своя тема или комментарий? (Enter = нет, "topic ..." = своя тема, "comment ..." = личный комментарий): ' + c.reset,
    );
    if (customChoice.startsWith('topic ') || customChoice.startsWith('тема ')) {
      userTopic = customChoice.replace(/^(topic|тема)\s+/, '');
      console.log(c.gray + `    тема: "${userTopic}"\n` + c.reset);
    } else if (customChoice.startsWith('comment ') || customChoice.startsWith('коммент ')) {
      userComment = customChoice.replace(/^(comment|коммент)\s+/, '');
      console.log(c.gray + `    комментарий: "${userComment}"\n` + c.reset);
    } else if (customChoice) {
      // Любой другой текст = комментарий.
      userComment = customChoice;
      console.log(c.gray + `    комментарий: "${userComment}"\n` + c.reset);
    }

    // --- ШАГ 2: Агент 2 (пост) ---
    console.log(c.gray + '[2] Агент 2: пишу пост...\n' + c.reset);
    const { PostWriter } = await import('./core/agents/postWriter.js');
    const writer = new PostWriter(state.client, state.profile);
    let post = await writer.write(db, chosen, { userTopic, userComment });

    // Цикл правок поста.
    while (true) {
      console.log(c.bold + '    === Пост ===' + c.reset);
      console.log(post.content);
      console.log('');

      const edit = await ask(
        c.gray + 'Правки? (Enter = дальше, "edit <текст>" = переписать, "rewrite" = заново): ' + c.reset,
      );

      if (!edit) break;

      if (edit === 'rewrite') {
        console.log(c.gray + '\n    Переписываю заново...\n' + c.reset);
        post = await writer.write(db, chosen, { userTopic, userComment });
        continue;
      }

      if (edit.startsWith('edit ') || edit.startsWith('edit ')) {
        const instruction = edit.replace(/^edit\s+/, '');
        console.log(c.gray + '\n    Вношу правки...\n' + c.reset);
        post = { content: await rewritePost(state.client, post.content, instruction, chosen, state.profile), news: chosen };
        continue;
      }

      // Любой другой текст = правка.
      console.log(c.gray + '\n    Вношу правки...\n' + c.reset);
      post = { content: await rewritePost(state.client, post.content, edit, chosen, state.profile), news: chosen };
    }

    // --- ШАГ 3: Агент 3 (фактчекинг) ---
    console.log(c.gray + '\n[3] Агент 3: фактчекинг...\n' + c.reset);
    const { FactChecker } = await import('./core/agents/factChecker.js');
    const checker = new FactChecker(state.client);
    const factCheck = await checker.check(post.content, chosen);

    if (factCheck.reasoning.trim()) {
      console.log(c.gray + '    --- рассуждения ---' + c.reset);
      console.log(factCheck.reasoning.trim());
      console.log(c.gray + '    --- конец ---\n' + c.reset);
    }
    const vc = factCheck.verdict === 'ok' ? c.green : c.yellow;
    console.log(`    ${c.gray}verdict:${c.reset} ${vc}${factCheck.verdict}${c.reset}`);
    if (factCheck.issues.length > 0) {
      for (const issue of factCheck.issues) {
        console.log(`    ${c.red}[${issue.severity}]${c.reset} ${issue.claim}`);
        console.log(`           ${c.gray}vs: ${issue.source}${c.reset}`);
      }
    }

    // Решение после фактчекинга.
    const afterFc = await ask(
      c.gray + '\nДействия? (Enter = финал, "edit <текст>" = правки, "ignore" = игнорить вердикт): ' + c.reset,
    );

    if (afterFc && afterFc !== 'ignore') {
      const instruction = afterFc.replace(/^edit\s+/, '');
      console.log(c.gray + '\n    Вношу правки...\n' + c.reset);
      post = { content: await rewritePost(state.client, post.content, instruction, chosen, state.profile), news: chosen };
      console.log(c.bold + '\n    === Финальный пост ===' + c.reset);
      console.log(post.content + '\n');
    }

    // --- ШАГ 4: Публикация ---
    const pub = await ask(
      c.gray + 'Опубликовать в Telegram? (y/N): ' + c.reset,
    );

    // Сохранить в БД.
    db.insertPost(post.content, chosen.id, JSON.stringify(factCheck));
    db.markUsed(chosen.id);

    if (pub.toLowerCase() === 'y' || pub.toLowerCase() === 'д') {
      if (!isTelegramConfigured()) {
        console.log(c.yellow + 'TG не настроен.\n' + c.reset);
      } else {
        const tg = await publishPost(post.content);
        if (tg.ok) {
          console.log(c.green + `\n[telegram] Опубликовано (message_id=${tg.messageId}).\n` + c.reset);
        } else {
          console.log(c.red + `\n[telegram] Ошибка: ${tg.error}\n` + c.reset);
        }
      }
    } else {
      console.log(c.gray + '\nБез публикации. Пост сохранён в БД.\n' + c.reset);
    }
  } catch (err) {
    console.log(c.red + '\nОшибка: ' + (err as Error).message + c.reset + '\n');
  } finally {
    db.close();
  }
}

/** /write — написать пост на любую тему без RSS.
 *  Многоэтапный flow: план → подтверждение → черновик → валидация → финал. */
async function handleWriteCommand(arg: string, state: SessionState): Promise<void> {
  const db = new BlogDb(DB_PATH);
  const ask = state.ask;

  try {
    let topic = arg.trim();
    if (!topic) {
      console.log(c.bold + c.cyan + '\n▶ Свободный пост\n' + c.reset);
      topic = await ask(c.gray + 'О чём пишем? (тема/новость): ' + c.reset);
    }
    if (!topic) {
      console.log(c.yellow + 'Тема не задана.\n' + c.reset);
      return;
    }

    const comment = await ask(
      c.gray + 'Личный комментарий? (Enter = нет): ' + c.reset,
    );

    const fakeNews = {
      id: 0,
      title: topic,
      source: 'от автора',
      summary: comment || topic,
      url: '',
      published_at: new Date().toISOString(),
      used: 0,
    } as import('./core/db.js').NewsRow;

    // === ЭТАП 1: ПЛАН ===
    const p = state.profile.active;
    const club = p?.любимый_клуб ?? 'Челси';
    const style = p?.стиль ?? 'ироничный, резкий';
    const lengthRule = p?.длина_постов ?? '100-500 символов';

    console.log(c.gray + '\n[план] Думаю над углом подачи...\n' + c.reset);
    const planPrompt = `Ты автор Telegram-канала «Иди на факты глянь» про ФК «${club}».
Стиль: ${style}. Объём поста: ${lengthRule}.

Тема: ${topic}
${comment ? `Комментарий автора: ${comment}` : ''}

Предложи КРАТКИЙ план поста (2-3 строки):
- Какой угол/крючок?
- Главная мысль?
- Какая эмоция?

Выдай только план, без самого поста.`;

    const plan = (await state.client.chat(
      [msg.system(planPrompt), msg.user('Предложи план поста.')],
      { temperature: 0.3, maxTokens: 300 },
    )).trim();

    console.log(c.bold + c.cyan + '\n=== ПЛАН ===' + c.reset);
    console.log(plan + '\n');

    // Подтверждение плана.
    let planApproved = false;
    while (!planApproved) {
      const planChoice = await ask(
        c.gray + 'План ок? (Enter = да, "edit ..." = скорректировать, "retry" = новый план): ' + c.reset,
      );
      if (!planChoice) {
        planApproved = true;
        break;
      }
      if (planChoice === 'retry') {
        console.log(c.gray + '\n[план] Генерирую новый...\n' + c.reset);
        const newPlan = (await state.client.chat(
          [msg.system(planPrompt + '\n\nПредыдущий план был отклонён. Предложи ДРУГОЙ угол.'), msg.user('Новый план.')],
          { temperature: 0.5, maxTokens: 300 },
        )).trim();
        console.log(c.bold + c.cyan + '\n=== НОВЫЙ ПЛАН ===' + c.reset);
        console.log(newPlan + '\n');
        continue;
      }
      // edit — принимаем правки и идём дальше.
      planApproved = true;
    }

    // === ЭТАП 2: ЧЕРНОВИК + ВАЛИДАЦИЯ + ФИНАЛ ===
    console.log(c.gray + '\n[черновик] Пишу пост по плану...\n' + c.reset);
    const { PostWriter } = await import('./core/agents/postWriter.js');
    const writer = new PostWriter(state.client, state.profile);
    let post = await writer.write(db, fakeNews, {
      userTopic: topic,
      userComment: comment || undefined,
    });

    // Валидация: проверяем длину и стиль.
    const len = post.content.length;
    const minLen = 80;
    const maxLen = 600;
    const issues: string[] = [];
    if (len < minLen) issues.push(`слишком короткий (${len} симв.)`);
    if (len > maxLen) issues.push(`слишком длинный (${len} симв.)`);
    if (!post.content.startsWith('Иди на факты')) issues.push('нет шапки');
    if (!post.content.includes('@lookatfacts') && !post.content.includes(p?.подпись ?? '@lookatfacts')) {
      issues.push('нет подписи');
    }

    if (issues.length > 0) {
      console.log(c.yellow + '[валидация] Замечания: ' + issues.join(', ') + c.reset);
      console.log(c.gray + 'Перегенерирую...\n' + c.reset);
      post = await writer.write(db, fakeNews, { userTopic: topic, userComment: comment || undefined });
    } else {
      console.log(c.green + '[валидация] ОК' + c.reset);
    }

    // Цикл правок.
    while (true) {
      console.log(c.bold + '\n    === Пост ===' + c.reset);
      console.log(post.content + '\n');
      console.log(c.gray + `    (${post.content.length} симв.)\n` + c.reset);

      const edit = await ask(
        c.gray + 'Правки? (Enter = дальше, "rewrite" = заново, любой текст = правка): ' + c.reset,
      );
      if (!edit) break;

      if (edit === 'rewrite') {
        post = await writer.write(db, fakeNews, { userTopic: topic, userComment: comment || undefined });
        continue;
      }
      post = { content: await rewritePost(state.client, post.content, edit, fakeNews, state.profile), news: fakeNews };
    }

    // Публикация.
    db.insertPost(post.content, null, JSON.stringify({ verdict: 'ok', issues: [], reasoning: 'свободный пост' }));
    const pub = await ask(c.gray + 'Опубликовать в Telegram? (y/N): ' + c.reset);
    if (pub.toLowerCase() === 'y' || pub.toLowerCase() === 'д') {
      if (!isTelegramConfigured()) {
        console.log(c.yellow + 'TG не настроен.\n' + c.reset);
      } else {
        const tg = await publishPost(post.content);
        if (tg.ok) {
          console.log(c.green + `\n[telegram] Опубликовано (message_id=${tg.messageId}).\n` + c.reset);
        } else {
          console.log(c.red + `\n[telegram] Ошибка: ${tg.error}\n` + c.reset);
        }
      }
    } else {
      console.log(c.gray + 'Без публикации. Пост сохранён в БД.\n' + c.reset);
    }
  } catch (err) {
    console.log(c.red + '\nОшибка: ' + (err as Error).message + c.reset + '\n');
  } finally {
    db.close();
  }
}

const PIPELINE_STATE_PATH = dataPath('pipeline-state.json');

async function handleScoutCommand(arg: string, state: SessionState): Promise<void> {
  // Парсим флаги.
  const parts = arg.split(/\s+/);
  let hours = 24, topK = 3;
  let query = 'самые горячие футбольные новости для Челси';
  let noTelegram = false;
  let noForum = false;

  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '--hours' && parts[i + 1]) { hours = Number(parts[++i]); continue; }
    if (parts[i] === '--top' && parts[i + 1]) { topK = Number(parts[++i]); continue; }
    if (parts[i] === '--query' && parts[i + 1]) {
      const qparts: string[] = [];
      i++;
      while (i < parts.length && !parts[i].startsWith('--')) { qparts.push(parts[i]); i++; }
      query = qparts.join(' ');
      i--;
      continue;
    }
    if (parts[i] === '--no-telegram') { noTelegram = true; continue; }
    if (parts[i] === '--no-forum') { noForum = true; continue; }
  }

  const db = new BlogDb(DB_PATH);
  try {
    console.log(c.bold + c.cyan + '\n▶ Scout: 3 агента параллельно → оркестратор\n' + c.reset);
    console.log(c.gray + `  запрос: ${query}` + c.reset);
    console.log(c.gray + `  источники: RSS${noForum ? '' : ' + Reddit + Sports.ru'}${noTelegram ? '' : ' + Telegram'}\n` + c.reset);

    const result = await runSourceAgents(db, state.client, {
      maxAgeHours: hours,
      userQuery: query,
      topK,
      enableTelegram: !noTelegram,
      enableForum: !noForum,
      ask: state.ask,
      log: console.log,
    });

    // Показываем результаты каждого агента.
    for (const r of result.rawResults) {
      console.log(c.bold + `\n=== ${r.agent} (${r.topics.length} тем) ===` + c.reset);
      if (r.error) console.log(c.yellow + `  ошибка: ${r.error}` + c.reset);
      for (const t of r.topics.slice(0, 5)) {
        const hype = t.hypeScore > 0 ? c.green + ` [${t.hypeScore}]${c.reset}` : '';
        console.log(`  ${t.title.slice(0, 80)}${hype} ${c.gray}${t.hypeReason}${c.reset}`);
      }
    }

    // Финальный топ от оркестратора.
    console.log(c.bold + c.green + '\n=== ОРКЕСТРАТОР: ТОП-' + topK + ' ===' + c.reset);
    for (const t of result.ranked) {
      console.log(`\n  ${c.green}[${t.orchestratorScore}]${c.reset} (${t.source}) ${t.title}`);
      console.log(`    ${c.gray}${t.orchestratorReason}${c.reset}`);
      if (t.url) console.log(`    ${c.gray}${t.url}${c.reset}`);
    }

    if (result.ranked.length === 0) {
      console.log(c.yellow + '\nОркестратор не выбрал ни одной темы.' + c.reset);
      return;
    }

    // --- Выбор темы для поста ---
    let chosenIdx = 0;
    if (result.ranked.length > 1) {
      const choice = await state.ask(
        c.gray + '\nКакую тему берём для поста? (Enter = 0, или номер): ' + c.reset,
      );
      if (choice && /^\d+$/.test(choice)) {
        chosenIdx = Math.min(Number(choice), result.ranked.length - 1);
      }
    }
    const chosen = result.ranked[chosenIdx];
    console.log(c.green + `\n→ "${chosen.title}"\n` + c.reset);

    // --- Своя тема или комментарий ---
    let userTopic: string | undefined;
    let userComment: string | undefined;
    const customChoice = await state.ask(
      c.gray + 'Своя тема или комментарий? (Enter = нет, "topic ..." = тема, "comment ..." = комментарий): ' + c.reset,
    );
    if (customChoice.startsWith('topic ') || customChoice.startsWith('тема ')) {
      userTopic = customChoice.replace(/^(topic|тема)\s+/, '');
      console.log(c.gray + `    тема: "${userTopic}"\n` + c.reset);
    } else if (customChoice.startsWith('comment ') || customChoice.startsWith('коммент ')) {
      userComment = customChoice.replace(/^(comment|коммент)\s+/, '');
      console.log(c.gray + `    комментарий: "${userComment}"\n` + c.reset);
    } else if (customChoice) {
      userComment = customChoice;
      console.log(c.gray + `    комментарий: "${userComment}"\n` + c.reset);
    }

    // --- Написание поста ---
    console.log(c.gray + 'Пишу пост...\n' + c.reset);
    const { PostWriter } = await import('./core/agents/postWriter.js');
    const writer = new PostWriter(state.client, state.profile);
    const fakeNews = {
      id: 0,
      title: chosen.title,
      source: chosen.source,
      summary: chosen.description ?? chosen.title,
      url: chosen.url ?? '',
      published_at: new Date().toISOString(),
      used: 0,
    } as import('./core/db.js').NewsRow;

    let post = await writer.write(db, fakeNews, { userTopic, userComment });

    // Цикл правок.
    while (true) {
      console.log(c.bold + '\n    === Пост ===' + c.reset);
      console.log(post.content + '\n');

      const edit = await state.ask(
        c.gray + 'Правки? (Enter = дальше, "rewrite" = заново, любой текст = правка): ' + c.reset,
      );
      if (!edit) break;

      if (edit === 'rewrite') {
        post = await writer.write(db, fakeNews, { userTopic, userComment });
        continue;
      }
      post = { content: await rewritePost(state.client, post.content, edit, fakeNews, state.profile), news: fakeNews };
    }

    // --- Публикация ---
    db.insertPost(post.content, null, JSON.stringify({ verdict: 'ok', issues: [], reasoning: 'scout pipeline' }));
    const pub = await state.ask(c.gray + '\nОпубликовать в Telegram? (y/N): ' + c.reset);
    if (pub.toLowerCase() === 'y' || pub.toLowerCase() === 'д') {
      if (!isTelegramConfigured()) {
        console.log(c.yellow + 'TG не настроен.\n' + c.reset);
      } else {
        const tg = await publishPost(post.content);
        if (tg.ok) {
          console.log(c.green + `\n[telegram] Опубликовано (message_id=${tg.messageId}).\n` + c.reset);
        } else {
          console.log(c.red + `\n[telegram] Ошибка: ${tg.error}\n` + c.reset);
        }
      }
    } else {
      console.log(c.gray + '\nБез публикации. Пост сохранён в БД.\n' + c.reset);
    }
  } catch (err) {
    console.log(c.red + '\nОшибка scout: ' + (err as Error).message + c.reset + '\n');
  } finally {
    db.close();
  }
}

async function handlePipelineCommand(arg: string, state: SessionState): Promise<void> {
  const [sub, ...rest] = arg.split(/\s+/);
  const subArg = rest.join(' ').trim();
  const db = new BlogDb(DB_PATH);

  try {
    const fsm = new StatefulPipeline(db, state.client, state.profile, PIPELINE_STATE_PATH);

    switch (sub) {
      case '':
      case 'status': {
        console.log(c.bold + c.cyan + '\n=== Pipeline FSM ===' + c.reset);
        console.log(fsm.status());
        if (fsm.current.postContent) {
          console.log(c.gray + '\n--- Текущий пост ---' + c.reset);
          console.log(fsm.current.postContent);
        }
        console.log('');
        return;
      }

      case 'run': {
        const parts = subArg.split(/\s+/);
        let hours = 24, topK = 5;
        for (let i = 0; i < parts.length; i++) {
          if (parts[i] === '--hours' && parts[i + 1]) hours = Number(parts[++i]);
          if (parts[i] === '--top' && parts[i + 1]) topK = Number(parts[++i]);
        }
        console.log(c.bold + c.cyan + '\n▶ Запуск pipeline...\n' + c.reset);
        const r = await fsm.run(hours, topK);
        console.log(r.output + '\n');
        return;
      }

      case 'auto': {
        const parts = subArg.split(/\s+/);
        let hours = 24, topK = 5;
        for (let i = 0; i < parts.length; i++) {
          if (parts[i] === '--hours' && parts[i + 1]) hours = Number(parts[++i]);
          if (parts[i] === '--top' && parts[i + 1]) topK = Number(parts[++i]);
        }
        console.log(c.bold + c.cyan + '\n▶ Автоматический pipeline (4 агента, FSM, ревизор)...\n' + c.reset);
        const r = await fsm.runAuto(hours, topK);
        console.log(r.output + '\n');
        return;
      }

      case 'pick': {
        const idx = Number(subArg);
        if (!Number.isFinite(idx)) {
          console.log(c.red + 'Укажите номер: /pipeline pick <N>\n' + c.reset);
          return;
        }
        console.log(c.gray + 'Пишу пост...\n' + c.reset);
        const r = await fsm.pick(idx);
        console.log(r.output + '\n');
        return;
      }

      case 'next': {
        console.log(c.gray + '...\n' + c.reset);
        const r = await fsm.next();
        console.log(r.output + '\n');
        return;
      }

      case 'edit': {
        if (!subArg) {
          console.log(c.gray + 'Правки: /pipeline edit <текст>\n' + c.reset);
          return;
        }
        console.log(c.gray + 'Вношу правки...\n' + c.reset);
        const r = await fsm.manualEdit(subArg);
        console.log(r.output + '\n');
        return;
      }

      case 'retry': {
        console.log(c.gray + 'Переписываю...\n' + c.reset);
        const r = await fsm.retry();
        console.log(r.output + '\n');
        return;
      }

      case 'accept': {
        const r = fsm.accept();
        fsm.finalize();
        console.log(c.green + r.output + '\n' + c.reset);
        return;
      }

      case 'publish': {
        if (fsm.current.stage !== 'done') {
          console.log(c.yellow + 'Pipeline не завершён. /pipeline accept или пройдите до конца.\n' + c.reset);
          return;
        }
        if (!fsm.current.postContent) {
          console.log(c.red + 'Нет поста.\n' + c.reset);
          return;
        }
        if (!isTelegramConfigured()) {
          console.log(c.yellow + 'TG не настроен.\n' + c.reset);
          return;
        }
        const tg = await publishPost(fsm.current.postContent);
        if (tg.ok) {
          console.log(c.green + `\n[telegram] Опубликовано (message_id=${tg.messageId}).\n` + c.reset);
        } else {
          console.log(c.red + `\n[telegram] Ошибка: ${tg.error}\n` + c.reset);
        }
        return;
      }

      case 'reset': {
        fsm.reset();
        console.log(c.yellow + 'Pipeline сброшен.\n' + c.reset);
        return;
      }

      case 'resume': {
        const saved = fsm.current;
        if (saved.stage === 'idle' || saved.history.length === 0) {
          console.log(c.gray + 'Нет сохранённого состояния. /pipeline run\n' + c.reset);
          return;
        }
        console.log(c.green + 'Возобновлено:\n' + c.reset);
        console.log(fsm.status() + '\n');
        return;
      }

      default:
        console.log(c.red + `Неизвестная подкоманда /pipeline ${sub}` + c.reset);
        console.log(c.gray + 'Доступно: run, pick, next, edit, retry, accept, publish, status, resume, reset\n' + c.reset);
    }
  } catch (err) {
    console.log(c.red + 'Ошибка pipeline: ' + (err as Error).message + c.reset + '\n');
  } finally {
    db.close();
  }
}

function handlePostsCommand(): void {
  const db = new BlogDb(DB_PATH);
  try {
    const posts = db.recentPosts(10);
    if (posts.length === 0) {
      console.log(c.gray + '\nНет сохранённых постов.\n' + c.reset);
      return;
    }
    console.log(c.bold + c.cyan + '\n=== Последние посты ===' + c.reset);
    for (const p of posts) {
      const preview = p.content.slice(0, 70).replace(/\n/g, ' ');
      const verdict = p.verdict ? JSON.parse(p.verdict) : null;
      const vc = verdict?.verdict === 'ok' ? c.green : verdict?.verdict ? c.yellow : c.gray;
      console.log(`  ${c.cyan}#${p.id}${c.reset} ${vc}${verdict?.verdict ?? '—'}${c.reset} ${c.gray}${p.created_at}${c.reset}`);
      console.log(`        ${preview}...`);
    }
    console.log(c.gray + '\nПоказать: /post <id>, опубликовать: /post-publish <id>\n' + c.reset);
  } finally {
    db.close();
  }
}

function handlePostCommand(arg: string): void {
  const id = Number(arg);
  if (!Number.isFinite(id)) {
    console.log(c.gray + 'Использование: /post <id>\n' + c.reset);
    return;
  }
  const db = new BlogDb(DB_PATH);
  try {
    const post = db.getPost(id);
    if (!post) {
      console.log(c.red + `Пост #${id} не найден.\n` + c.reset);
      return;
    }
    console.log(c.bold + c.cyan + `\n=== Пост #${post.id} ===` + c.reset);
    console.log(c.gray + `Дата: ${post.created_at}${c.reset}`);
    if (post.verdict) {
      try {
        const fc = JSON.parse(post.verdict);
        const vc = fc.verdict === 'ok' ? c.green : c.yellow;
        console.log(c.gray + 'Вердикт: ' + c.reset + vc + fc.verdict + c.reset);
      } catch { /* ignore */ }
    }
    console.log('');
    console.log(post.content);
    console.log(c.gray + '\nОпубликовать: /post-publish ' + post.id + '\n' + c.reset);
  } finally {
    db.close();
  }
}

function handleConstraintsCommand(sub: string, arg: string, state: SessionState): void {
  const typeLabels: Record<string, string> = {
    architecture: 'Архитектура',
    tech_decision: 'Тех. решения',
    stack: 'Стек',
    business: 'Бизнес',
    custom: 'Прочее',
  };
  const typeColors: Record<string, string> = {
    architecture: c.cyan,
    tech_decision: c.blue,
    stack: c.magenta,
    business: c.green,
    custom: c.yellow,
  };

  switch (sub) {
    case '':
    case 'list': {
      const items = state.constraints.all;
      if (items.length === 0) {
        console.log(c.gray + '\nИнвариантов нет.\n' + c.reset);
      } else {
        console.log(c.bold + c.red + '\n=== ИНВАРИАНТЫ (' + items.length + ') ===' + c.reset);
        for (const item of items) {
          const tc = typeColors[item.type] ?? c.gray;
          console.log(`  ${tc}${item.id}${c.reset} ${tc}[${typeLabels[item.type] ?? item.type}]${c.reset} ${c.bold}${item.title}${c.reset}`);
          console.log(`        ${c.gray}${item.description}${c.reset}`);
        }
      }
      // Всегда показываем справку по типам и примерам.
      console.log(c.bold + '\nТипы инвариантов:' + c.reset);
      console.log('  ' + c.cyan + 'architecture  ' + c.reset + c.gray + 'выбранная архитектура' + c.reset);
      console.log('  ' + c.blue + 'tech_decision ' + c.reset + c.gray + 'принятые технические решения' + c.reset);
      console.log('  ' + c.magenta + 'stack         ' + c.reset + c.gray + 'ограничения по стеку' + c.reset);
      console.log('  ' + c.green + 'business      ' + c.reset + c.gray + 'бизнес-правила' + c.reset);
      console.log('  ' + c.yellow + 'custom        ' + c.reset + c.gray + 'произвольные' + c.reset);
      console.log(c.gray + '\nПримеры:' + c.reset);
      console.log(c.gray + '  /constraint add stack язык: только TypeScript, никакого Rust' + c.reset);
      console.log(c.gray + '  /constraint add architecture монолит: единый challenge/, без микросервисов' + c.reset);
      console.log(c.gray + '  /constraint add business бюджет: 0 рублей, без облака' + c.reset);
      console.log(c.gray + '  /constraint rm stack-001\n' + c.reset);
      return;
    }

    case 'add': {
      // Формат: /constraint add <type> <title>: <description>
      if (!arg) {
        console.log(c.gray + 'Формат: /constraint add <type> <title>: <описание>\n' +
          '  Типы: architecture, tech_decision, stack, business, custom\n' +
          '  Пример: /constraint add stack язык: только TypeScript, никакого Rust\n' + c.reset);
        return;
      }
      const sep = arg.indexOf(':');
      if (sep === -1) {
        console.log(c.red + 'Формат: /constraint add <type> <title>: <описание>' + c.reset + '\n');
        return;
      }
      const before = arg.slice(0, sep).trim();
      const description = arg.slice(sep + 1).trim();
      const [type, ...titleParts] = before.split(/\s+/);
      const title = titleParts.join(' ').trim() || '(без названия)';
      try {
        const c_item = state.constraints.add(type as import('./core/index.js').ConstraintType, title, description);
        console.log(c.red + 'INVARIANT +' + c.reset + ` ${c_item.id} [${type}] ${title}: ${description}\n`);
      } catch (e) {
        console.log(c.red + (e as Error).message + c.reset + '\n');
      }
      return;
    }

    case 'rm':
    case 'remove':
    case 'del': {
      if (!arg) {
        console.log(c.gray + 'Использование: /constraint rm <id>\n' + c.reset);
        return;
      }
      if (state.constraints.remove(arg)) {
        console.log(c.red + 'INVARIANT -' + c.reset + ` ${arg} удалён.\n`);
      } else {
        console.log(c.red + `Инвариант ${arg} не найден.\n` + c.reset);
      }
      return;
    }

    default:
      console.log(c.red + `Неизвестная подкоманда: ${sub}` + c.reset);
      console.log(c.gray + 'Доступно: list, add <type> <title>: <desc>, rm <id>\n' + c.reset);
  }
}

async function handlePostPublishCommand(arg: string): Promise<void> {
  const id = Number(arg);
  if (!Number.isFinite(id)) {
    console.log(c.gray + 'Использование: /post-publish <id>\n' + c.reset);
    return;
  }
  if (!isTelegramConfigured()) {
    console.log(c.yellow + 'TG не настроен.\n' + c.reset);
    return;
  }
  const db = new BlogDb(DB_PATH);
  try {
    const post = db.getPost(id);
    if (!post) {
      console.log(c.red + `Пост #${id} не найден.\n` + c.reset);
      return;
    }
    console.log(c.gray + 'Публикую...\n' + c.reset);
    const tg = await publishPost(post.content);
    if (tg.ok) {
      console.log(c.green + `[telegram] Пост #${id} опубликован (message_id=${tg.messageId}).\n` + c.reset);
    } else {
      console.log(c.red + `[telegram] Ошибка: ${tg.error}\n` + c.reset);
    }
  } finally {
    db.close();
  }
}

// --- Файловый агент (день 34) в REPL ---
// Зеркало cli.ts:runFiles*Command по выводу, но БЕЗ process.exit — REPL продолжает.

function printFilesError(e: unknown): void {
  const m = e instanceof Error ? e.message : String(e);
  console.log(c.red + 'files error: ' + m.split('\n')[0].slice(0, 300) + c.reset + '\n');
}

function printCloudStatus(status: 'ok' | 'no-key' | 'fallback'): void {
  if (status !== 'ok') console.log(c.gray + CLOUD_DOWN_MESSAGE + c.reset);
}

function printDocsResult(res: Awaited<ReturnType<typeof runUpdateDocs>>): void {
  console.log(c.gray + 'target:' + c.reset + ' ' + res.targetPath);
  printCloudStatus(res.cloudStatus);
  if (res.written) {
    console.log(c.green + `записано ${res.afterBytes} байт (было ${res.beforeBytes}).` + c.reset);
  } else {
    console.log(c.gray + '--- diff (dry-run) ---' + c.reset);
    console.log(res.diff || c.gray + '(нет изменений)' + c.reset);
  }
}

function printRefactorResult(res: Awaited<ReturnType<typeof runRefactor>>): void {
  console.log(c.gray + 'target:' + c.reset + ' ' + res.targetPath);
  printCloudStatus(res.cloudStatus);
  if (res.rollback) {
    console.log(c.yellow + `⚠ typecheck FAILED (${res.rollback.reason}) → rollback restored snapshot.` + c.reset);
    console.log(c.gray + res.rollback.stderr + c.reset);
  }
  if (res.written) {
    console.log(c.green + `записано ${res.afterBytes} байт (было ${res.beforeBytes}).` + c.reset);
  } else {
    console.log(c.gray + '--- diff (dry-run) ---' + c.reset);
    console.log(res.diff || c.gray + '(нет изменений)' + c.reset);
  }
}

function printScaffoldResult(res: Awaited<ReturnType<typeof runScaffold>>): void {
  console.log(c.gray + 'target:' + c.reset + ' ' + res.targetPath);
  printCloudStatus(res.cloudStatus);
  if (res.rollback) {
    console.log(c.yellow + `⚠ typecheck FAILED (${res.rollback.reason}) → rollback (new file unlinked).` + c.reset);
    console.log(c.gray + res.rollback.stderr + c.reset);
  }
  if (res.created) {
    console.log(c.green + `создан новый файл (${res.targetPath}).` + c.reset);
  } else {
    console.log(c.gray + '--- preview (dry-run) ---' + c.reset);
    console.log(res.preview || c.gray + '(пустой драфт)' + c.reset);
  }
}

function printFilesUsage(): void {
  console.log(c.gray + 'Файловый агент. Команды:' + c.reset);
  console.log('  ' + c.cyan + '/files find <symbol>' + c.reset + c.gray + ' — использования символа (read-only)' + c.reset);
  console.log('  ' + c.cyan + '/files docs <goal> [--write]' + c.reset + c.gray + ' — обновить doc (README|AGENTS|docs/*)' + c.reset);
  console.log('  ' + c.cyan + '/files refactor <goal> [--write]' + c.reset + c.gray + ' — рефактор .ts в challenge/src/' + c.reset);
  console.log('  ' + c.cyan + '/files scaffold <goal> [--write]' + c.reset + c.gray + ' — новый .ts в challenge/src/utils/**' + c.reset);
  console.log('  ' + c.cyan + '/files run <NL>' + c.reset + c.gray + ' — классификация → docs|refactor|scaffold (dry-run)' + c.reset);
  console.log('');
}

async function handleFilesCommand(arg: string): Promise<void> {
  const [sub, ...rest] = arg.split(/\s+/);
  const subArg = rest.join(' ').trim();

  switch (sub) {
    case '':
    case 'help':
      printFilesUsage();
      return;

    case 'find': {
      const symbol = subArg;
      if (!symbol) {
        console.log(c.gray + 'Использование: /files find <symbol>\n' + c.reset);
        return;
      }
      console.log(c.cyan + '▶ files find:' + c.reset + ' ' + symbol + '\n');
      try {
        const res = await runFindUsages(symbol);
        if (res.matches.length === 0) {
          console.log(c.gray + '(нет совпадений внутри allowlist)' + c.reset);
        } else {
          for (const m of res.matches) console.log(`${m.file}:${m.line}: ${m.text}`);
          if (res.truncated) console.log(c.gray + `\n…[показаны первые ${res.matches.length}]…` + c.reset);
        }
      } catch (e) {
        printFilesError(e);
        return;
      }
      console.log('');
      return;
    }

    case 'docs': {
      const write = rest.includes('--write');
      const goal = rest.filter((a) => a !== '--write').join(' ').trim();
      if (!goal) {
        console.log(c.gray + 'Использование: /files docs <goal> [--write]\n' + c.reset);
        return;
      }
      console.log(c.cyan + `▶ files docs (${write ? 'write' : 'dry-run'}):` + c.reset + ' ' + goal + '\n');
      try {
        printDocsResult(await runUpdateDocs(goal, { write }));
      } catch (e) {
        printFilesError(e);
        return;
      }
      console.log('');
      return;
    }

    case 'refactor': {
      const write = rest.includes('--write');
      const goal = rest.filter((a) => a !== '--write').join(' ').trim();
      if (!goal) {
        console.log(c.gray + 'Использование: /files refactor <goal> [--write]\n' + c.reset);
        return;
      }
      console.log(c.cyan + `▶ files refactor (${write ? 'write' : 'dry-run'}):` + c.reset + ' ' + goal + '\n');
      try {
        printRefactorResult(await runRefactor(goal, { write, log: console.log }));
      } catch (e) {
        printFilesError(e);
        return;
      }
      console.log('');
      return;
    }

    case 'scaffold': {
      const write = rest.includes('--write');
      const goal = rest.filter((a) => a !== '--write').join(' ').trim();
      if (!goal) {
        console.log(c.gray + 'Использование: /files scaffold <goal> [--write]\n' + c.reset);
        return;
      }
      console.log(c.cyan + `▶ files scaffold (${write ? 'write' : 'dry-run'}):` + c.reset + ' ' + goal + '\n');
      try {
        printScaffoldResult(await runScaffold(goal, { write, log: console.log }));
      } catch (e) {
        printFilesError(e);
        return;
      }
      console.log('');
      return;
    }

    case 'run': {
      // NL-классификация → docs|refactor|scaffold. В БЕЗ --write (REPL-безопасность),
      // --write не парсится (зеркало cli.ts:runFilesRunCommand).
      const nl = subArg;
      if (!nl) {
        console.log(c.gray + 'Использование: /files run <NL>\n' + c.reset);
        return;
      }
      console.log(c.cyan + '▶ files run:' + c.reset + ' ' + nl + '\n');
      const cls = runClassify(nl);
      if (cls.type === 'ambiguous') {
        console.log(
          c.yellow +
            `Не удалось определить тип задачи (matched: ${cls.matched?.join(', ') || 'none'}).` +
            c.reset,
        );
        console.log(
          c.gray +
            'Уточни: «док/readme» (docs), «рефактор/переименуй» (refactor), «создай утилиту» (scaffold).\n' +
            c.reset,
        );
        return;
      }
      console.log(c.gray + `classify → ${cls.type}` + c.reset + '\n');
      try {
        if (cls.type === 'docs') printDocsResult(await runUpdateDocs(nl, { write: false }));
        else if (cls.type === 'refactor') printRefactorResult(await runRefactor(nl, { write: false, log: console.log }));
        else printScaffoldResult(await runScaffold(nl, { write: false, log: console.log }));
      } catch (e) {
        printFilesError(e);
        return;
      }
      console.log('');
      return;
    }

    default:
      console.log(c.red + `Неизвестная подкоманда /files ${sub}` + c.reset);
      printFilesUsage();
  }
}

function printStatus(state: SessionState): void {
  const line = c.gray + '─'.repeat(40) + c.reset;
  console.log('');
  console.log(line);
  console.log(c.bold + '  Status' + c.reset);
  console.log(line);
  console.log(c.gray + '  model    ' + c.reset + state.client.defaultModel);
  const mode = state.memoryEnabled ? c.green + 'memory' + c.reset : state.strategy.name;
  console.log(c.gray + '  context  ' + c.reset + mode);
  if (state.memoryEnabled) {
    console.log(c.gray + '  long-term' + c.reset + ' ' + state.memory.longTermKeys.length + ' entries');
    console.log(c.gray + '  working  ' + c.reset + ' ' + state.memory.workingKeys.length + ' facts');
  } else if (state.strategy instanceof Branching) {
    console.log(c.gray + '  branch   ' + c.reset + '#' + state.strategy.activeBranchId);
  }
  console.log(c.gray + '  system   ' + c.reset + trunc(state.system, 50));
  console.log(c.gray + '  tokens   ' + c.reset + `Σ ${state.usage.total_tokens} (↑${state.usage.prompt_tokens}/↓${state.usage.completion_tokens})`);
  console.log(line + '\n');
}

function printDemosList(): void {
  console.log(c.bold + 'Дни:' + c.reset);
  for (const d of demos) {
    console.log('  ' + c.cyan + d.id.padEnd(10) + c.reset + d.title);
  }
  console.log('');
}

function printProfile(state: SessionState): void {
  const line = c.gray + '─'.repeat(50) + c.reset;
  console.log('');
  console.log(line);
  console.log(c.bold + '  Профиль: ' + c.cyan + (state.profile.activeName ?? '?') + c.reset);
  console.log(line);
  if (!state.profile.active) {
    console.log(c.gray + '  (нет активного профиля)' + c.reset);
    console.log(line + '\n');
    return;
  }
  const snap = state.profile.snapshot();
  for (const key of state.profile.fields) {
    console.log(c.gray + '  ' + key.padEnd(20) + c.reset + snap[key]);
  }
  const notes = state.profile.notes;
  if (notes.length > 0) {
    console.log(c.gray + '  ' + 'заметки'.padEnd(20) + c.reset + `${notes.length} шт.`);
    notes.forEach((n, i) => {
      const preview = n.length > 70 ? n.slice(0, 67) + '...' : n;
      console.log(c.gray + `  ${String(i).padStart(20)}. ` + c.reset + preview);
    });
  } else {
    console.log(c.gray + '  ' + 'заметки'.padEnd(20) + c.reset + '(пусто)');
  }
  console.log(line + '\n');
}

async function printSystemInfo(state: SessionState): Promise<void> {
  const line = c.gray + '═'.repeat(60) + c.reset;

  console.log('\n' + line);
  console.log(c.bold + c.cyan + '  SYSTEM INFO' + c.reset + c.gray + '  — полная сводка состояния' + c.reset);
  console.log(line);

  // Модель.
  console.log(c.bold + '\n  МОДЕЛЬ' + c.reset);
  console.log(c.gray + '  модель: ' + c.reset + state.client.defaultModel);

  // Память: long-term.
  console.log(c.bold + '\n  ДОЛГОВРЕМЕННАЯ ПАМЯТЬ' + c.reset + c.gray + '  (.data/memory.json)' + c.reset);
  const ltKeys = state.memory.longTermKeys;
  if (ltKeys.length === 0) {
    console.log(c.gray + '    (пусто)' + c.reset);
  } else {
    for (const k of ltKeys) {
      const v = state.memory.recall(k) ?? '';
      console.log(c.gray + '    ' + c.reset + k + ': ' + trunc(v, 50));
    }
  }

  // Память: working.
  console.log(c.bold + '\n  РАБОЧАЯ ПАМЯТЬ' + c.reset + c.gray + '  (RAM, текущая задача)' + c.reset);
  if (state.memory.task) {
    console.log(c.gray + '    задача: ' + c.reset + state.memory.task);
  } else {
    console.log(c.gray + '    задача: (не задана)' + c.reset);
  }
  const wKeys = state.memory.workingKeys;
  if (wKeys.length > 0) {
    for (const k of wKeys) {
      console.log(c.gray + '    ' + c.reset + k + ': ' + state.memory.getWorkingFact(k));
    }
  } else {
    console.log(c.gray + '    факты: (пусто)' + c.reset);
  }

  // Память: short-term.
  console.log(c.bold + '\n  КРАТКОСРОЧНАЯ ПАМЯТЬ' + c.reset + c.gray + '  (RAM, диалог)' + c.reset);
  const snap = state.memory.snapshot();
  console.log(c.gray + '    сообщений: ' + snap.shortTermCount + c.reset);

  // Профиль.
  console.log(c.bold + '\n  ПРОФИЛЬ' + c.reset + c.gray + '  (.data/profiles/)' + c.reset);
  console.log(c.gray + '    активный: ' + c.reset + (state.profile.activeName ?? '(нет)'));
  if (state.profile.active) {
    const psnap = state.profile.snapshot();
    for (const key of state.profile.fields) {
      console.log(c.gray + '    ' + key.padEnd(18) + c.reset + trunc(String(psnap[key]), 45));
    }
    const notes = state.profile.notes;
    console.log(c.gray + '    ' + 'заметки'.padEnd(18) + c.reset + `${notes.length} шт.`);
  }
  const allProfiles = state.profile.list();
  console.log(c.gray + '    все профили:    ' + c.reset + (allProfiles.join(', ') || '(нет)'));

  // Инварианты.
  console.log(c.bold + '\n  ИНВАРИАНТЫ' + c.reset + c.gray + '  (.data/constraints.json)' + c.reset);
  const constraints = state.constraints.all;
  if (constraints.length === 0) {
    console.log(c.gray + '    (пусто)' + c.reset);
  } else {
    for (const ci of constraints) {
      console.log(c.gray + '    ' + c.reset + `${ci.id} [${ci.type}] ${ci.title}: ${trunc(ci.description, 40)}`);
    }
  }

  // Блог-агенты.
  console.log(c.bold + '\n  БЛОГ-АГЕНТЫ' + c.reset);
  let dbStats = '(БД недоступна)';
  try {
    const { BlogDb } = await import('./core/db.js');
    const db = new BlogDb(DB_PATH);
    dbStats = `новостей: ${db.newsCount()}, постов: ${db.postsCount()}, стилей: ${db.styleSamplesCount()}`;
    db.close();
  } catch { /* ignore */ }
  console.log(c.gray + '    БД:           ' + c.reset + dbStats);
  console.log(c.gray + '    агент 1:      ' + c.reset + 'NewsFetcher — топ-новостей из RSS');
  console.log(c.gray + '    агент 2:      ' + c.reset + 'PostWriter — пост (стиль + профиль)');
  console.log(c.gray + '    агент 3:      ' + c.reset + 'FactChecker — фактчекинг (CoT + JSON)');
  console.log(c.gray + '    агент 4:      ' + c.reset + 'Reviser — правка / смена новости');
  console.log(c.gray + '    FSM:          ' + c.reset + 'idle → planning → execution → validation → revision → done');
  console.log(c.gray + '    RSS:          ' + c.reset + 'championat.com, skysports.com x2');
  const tgStatus = isTelegramConfigured() ? c.green + 'настроен' + c.reset : c.gray + 'не настроен' + c.reset;
  console.log(c.gray + '    Telegram:     ' + c.reset + tgStatus);

  // Режим.
  console.log(c.bold + '\n  РЕЖИМ' + c.reset);
  console.log(c.gray + '    контекст: ' + c.reset + (state.memoryEnabled ? c.green + 'memory' + c.reset : state.strategy.name));
  console.log(c.gray + '    токенов:  ' + c.reset + '\u03A3 ' + state.usage.total_tokens);

  console.log('\n' + line + '\n');
}

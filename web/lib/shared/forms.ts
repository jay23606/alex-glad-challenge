// Zod-схемы форм/Route-параметров. Доступны клиенту (без server-only, без core/).
// P1+: RAG-query + todo. Валидация на границе — инвариант CLAUDE.md.

import { z } from 'zod';

export const ragQuerySchema = z.object({
  query: z.string().trim().min(1, 'Введите вопрос').max(2000, 'Слишком длинный запрос'),
  // 'notes' — партиция заметок владельца (/rag/ingest): Retriever принимает её
  // как ChunkingStrategy, ChatSourceFilter остаётся только для 'telegram'.
  strategy: z.enum(['fixed', 'structure', 'telegram', 'notes']).optional(),
  k: z.coerce.number().int().min(1).max(20).optional(),
  llm: z.enum(['local', 'cloud']).optional(),
  noRag: z.boolean().optional(),
});
export type RagQueryInput = z.infer<typeof ragQuerySchema>;

export const todoAddSchema = z.object({
  text: z.string().trim().min(1, 'Текст обязателен').max(500),
  recurring: z.enum(['daily', 'weekly', 'hourly']).nullable().optional(),
  // Для recurring='hourly': интервал в часах. По умолчанию 1 (наследует getDueTodos-логику).
  intervalHours: z.coerce.number().int().min(1).max(168).optional(),
});
export type TodoAddInput = z.infer<typeof todoAddSchema>;

// --- P2: Chat-агент ---

// Стратегия контекста (зеркало repl.ts STRATEGY_NAMES).
export const strategyNameSchema = z.enum(['full', 'sliding', 'sticky', 'branching']);
export type StrategyName = z.infer<typeof strategyNameSchema>;

// POST /api/chat/[sessionId] — отправить реплику (SSE-стрим).
export const chatSendSchema = z.object({
  text: z.string().trim().min(1, 'Введите сообщение').max(8000, 'Слишком длинное сообщение'),
  llm: z.enum(['local', 'cloud']).optional(),
});
export type ChatSendInput = z.infer<typeof chatSendSchema>;

// POST /api/chat — создать сессию.
export const chatSessionCreateSchema = z.object({
  strategy: strategyNameSchema.optional(),
  system: z.string().trim().max(2000).optional(),
  windowSize: z.coerce.number().int().min(1).max(100).optional(),
  memoryEnabled: z.boolean().optional(),
});
export type ChatSessionCreateInput = z.infer<typeof chatSessionCreateSchema>;

// PATCH /api/chat/[sessionId] — обновить настройки сессии (без mutations памяти — это P2b).
export const chatSessionUpdateSchema = z.object({
  strategy: strategyNameSchema.optional(),
  system: z.string().trim().max(2000).optional(),
  windowSize: z.coerce.number().int().min(1).max(100).optional(),
  memoryEnabled: z.boolean().optional(),
  reset: z.boolean().optional(),
});
export type ChatSessionUpdateInput = z.infer<typeof chatSessionUpdateSchema>;

// --- P2b: Chat-фичи — mutations (memory/branch/profile/constraints) ---

export const constraintTypeSchema = z.enum(['architecture', 'tech_decision', 'stack', 'business', 'custom']);
export type ConstraintTypeInput = z.infer<typeof constraintTypeSchema>;

// POST /api/chat/[sessionId]/memory
export const memoryActionSchema = z.object({
  action: z.enum(['remember', 'forget', 'task', 'task-add', 'task-clear', 'fact-rm', 'on', 'off']),
  key: z.string().trim().min(1).max(200).optional(),
  value: z.string().trim().max(2000).optional(),
  description: z.string().trim().max(2000).optional(),
});
export type MemoryActionInput = z.infer<typeof memoryActionSchema>;

// POST /api/chat/[sessionId]/branch
export const branchActionSchema = z.object({
  action: z.enum(['checkpoint', 'switch']),
  label: z.string().trim().min(1).max(100).optional(),
  id: z.coerce.number().int().min(0).optional(),
});
export type BranchActionInput = z.infer<typeof branchActionSchema>;

// POST /api/chat/[sessionId]/profile
export const profileActionSchema = z.object({
  action: z.enum(['use', 'edit', 'new', 'copy', 'delete', 'reset', 'note']),
  name: z.string().trim().min(1).max(100).optional(),
  base: z.string().trim().min(1).max(100).optional(),
  instruction: z.string().trim().min(1).max(2000).optional(),
  text: z.string().trim().min(1).max(2000).optional(),
  llm: z.enum(['local', 'cloud']).optional(),
});
export type ProfileActionInput = z.infer<typeof profileActionSchema>;

// POST /api/chat/[sessionId]/constraints
export const constraintsActionSchema = z.object({
  action: z.enum(['add', 'rm']),
  type: constraintTypeSchema.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  id: z.string().trim().min(1).max(100).optional(),
});
export type ConstraintsActionInput = z.infer<typeof constraintsActionSchema>;

// --- P3a: RAG-chat (DialogDb session) + TG top (read-only) + chat-alias catalog ---

// POST /api/rag/chat — создать DialogDb-чат.
export const ragChatCreateSchema = z.object({
  title: z.string().trim().max(120).optional(),
});
export type RagChatCreateInput = z.infer<typeof ragChatCreateSchema>;

// POST /api/rag/chat/[dialogChatId] — RAG-реплика (SSE-стрим).
// strategy='telegram' включает ChatSourceFilter (нужен chatKey; topicId опц.).
export const ragChatSendSchema = z.object({
  text: z.string().trim().min(1, 'Введите сообщение').max(8000, 'Слишком длинное сообщение'),
  // 'notes' — партиция заметок владельца (/rag/ingest), поиск по базе знаний.
  strategy: z.enum(['fixed', 'structure', 'telegram', 'notes']).optional(),
  k: z.coerce.number().int().min(1).max(20).optional(),
  llm: z.enum(['local', 'cloud']).optional(),
  chatKey: z.string().trim().max(200).optional(),
  topicId: z.coerce.number().int().min(0).optional(),
  // P3b: /norag — ответ без RAG-стадий (answerNoRag + chatStream). Зеркало /api/rag/query.
  noRag: z.boolean().optional(),
});
export type RagChatSendInput = z.infer<typeof ragChatSendSchema>;

// PATCH /api/rag/chat/[dialogChatId] — переименование + task state (/-команды).
// task — задать goal (task state остаётся: terms/constraints не трогаем здесь);
// taskClear — сбросить весь task state.
export const ragChatPatchSchema = z.object({
  title: z.string().trim().max(120).optional(),
  task: z.string().trim().max(500).optional(),
  taskClear: z.boolean().optional(),
});
export type RagChatPatchInput = z.infer<typeof ragChatPatchSchema>;

// GET /api/tg/top — топ-сообщения топика (read-only).
export const tgTopSchema = z.object({
  chatKey: z.string().trim().min(1, 'chatKey обязателен').max(200),
  topicId: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  by: z.enum(['reactions', 'date']).optional(),
});
export type TgTopInput = z.infer<typeof tgTopSchema>;

// POST /api/rag/chats — alias add/rm.
export const aliasActionSchema = z.object({
  action: z.enum(['add', 'rm']),
  name: z.string().trim().min(1, 'Имя alias обязательно').max(100),
  chatKey: z.string().trim().max(200).optional(),
  topicId: z.coerce.number().int().min(0).optional(),
});
export type AliasActionInput = z.infer<typeof aliasActionSchema>;

// --- P4a: Блог-ядро (news pipeline + posts + style) ---

// POST /api/blog/news (SSE) — news-pipeline opts. Зеркало cli runNewsCommand flags
// (--hours/--top/--for). Поле `forIndex` соответствует `writeForIndex` в runNewsPipeline
// (имя `for` зарезервировано, не используем как ключ-деструктуризацию).
// blog — slug блога (мульти-блог): определяет RSS-источники, профиль голоса и
// штамп blog_id; отсутствует → легаси-режим (блог по умолчанию на сервере).
export const newsOptsSchema = z.object({
  hours: z.coerce.number().int().min(1, 'hours: 1..168').max(168).optional(),
  top: z.coerce.number().int().min(1, 'top: 1..50').max(50).optional(),
  forIndex: z.coerce.number().int().min(0).optional(),
  llm: z.enum(['local', 'cloud']).optional(),
  blog: z.string().trim().min(1).max(100).optional(),
});
export type NewsOptsInput = z.infer<typeof newsOptsSchema>;

// PATCH /api/blog/posts/[id] — обновить контент поста.
export const postUpdateSchema = z.object({
  content: z.string().trim().min(1, 'Контент обязателен').max(8000, 'Слишком длинный пост'),
});
export type PostUpdateInput = z.infer<typeof postUpdateSchema>;

// POST /api/blog/style — образец стиля. blog — slug блога (few-shot пул блога);
// отсутствует → легаси-общий пул (blog_id NULL).
export const styleSampleSchema = z.object({
  text: z.string().trim().min(1, 'Текст обязателен').max(4000, 'Слишком длинный образец'),
  blog: z.string().trim().min(1).max(100).optional(),
});
export type StyleSampleInput = z.infer<typeof styleSampleSchema>;

// --- P4b: FSM pipeline-state + scout ---

// 6 стадий FSM (зеркало core/agents/stateMachine.ts PipelineStage).
export const pipelineStageSchema = z.enum([
  'idle',
  'planning',
  'execution',
  'validation',
  'revision',
  'done',
]);
export type PipelineStageInput = z.infer<typeof pipelineStageSchema>;

// POST /api/blog/pipeline — transition | reset. `to` обязателен для transition.
// `from` — для гостевого sandbox-режима: клиент заявляет свою текущую стадию,
// сервер валидирует переход от неё (боевой pipeline-state.json не читается/не пишется).
export const pipelineActionSchema = z
  .object({
    action: z.enum(['transition', 'reset']),
    to: pipelineStageSchema.optional(),
    from: pipelineStageSchema.optional(),
    detail: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.action !== 'transition' || d.to !== undefined, {
    message: 'Стадия назначения (to) обязательна для transition',
    path: ['to'],
  });
export type PipelineActionInput = z.infer<typeof pipelineActionSchema>;

// POST /api/blog/scout (SSE) — opts для runSourceAgents. enableTelegram по умолчанию
// выключен на уровне route (MTProto/TG_SESSION — credential-тяжёлый путь); Forum — вкл.
export const scoutOptsSchema = z.object({
  hours: z.coerce.number().int().min(1, 'hours: 1..168').max(168).optional(),
  topK: z.coerce.number().int().min(1, 'topK: 1..10').max(10).optional(),
  query: z.string().trim().max(500).optional(),
  enableTelegram: z.boolean().optional(),
  enableForum: z.boolean().optional(),
  llm: z.enum(['local', 'cloud']).optional(),
});
export type ScoutOptsInput = z.infer<typeof scoutOptsSchema>;

// --- P5: MCP admin + agent + summary + settings ---

// POST /api/mcp/call — generic вызов MCP-инструмента. args = user-supplied JSON, идёт
// КАК ДАННЫЕ (JSON-RPC params в McpHttpClient.callTool), не исполняется как код.
export const mcpCallSchema = z.object({
  tool: z.string().trim().min(1, 'Имя инструмента обязательно').max(200),
  args: z.record(z.string(), z.unknown()).optional(),
});
export type McpCallInput = z.infer<typeof mcpCallSchema>;

// POST /api/agent — single-shot вопрос LLM через core/Agent (stateless, без сессии).
export const agentSchema = z.object({
  prompt: z.string().trim().min(1, 'Введите вопрос').max(8000, 'Слишком длинный промпт'),
  llm: z.enum(['local', 'cloud']).optional(),
});
export type AgentInput = z.infer<typeof agentSchema>;

// POST /api/summary — опубликовать сводку ожидающих задач в TG-канал.
// publish:true + isTelegramConfigured() → publishPost(summary). Иначе — только текст.
export const summaryPublishSchema = z.object({
  publish: z.boolean().optional(),
});
export type SummaryPublishInput = z.infer<typeof summaryPublishSchema>;

// POST /api/settings — preference client→cookie. MCP_URL НЕ принимается (read-only, §8 SSRF).
export const settingsSchema = z.object({
  modelPref: z.enum(['local', 'cloud']).optional(),
});
export type SettingsInput = z.infer<typeof settingsSchema>;

// --- P3b: TG collect + RAG index/index-tg + TG publish ---

// POST /api/tg/collect (SSE) — single-topic MTProto-сбор в tg.sqlite. Зеркало cli tg-collect.
// topicId опционален: resolveChatTopic бросает понятную ошибку, если он не извлекается
// из chatRef (t.me/<chat>/<topicId>) и не задан явно (кли требует topicId для forum).
export const tgCollectSchema = z.object({
  chatRef: z.string().trim().min(1, 'chatRef обязателен').max(200),
  topicId: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1, 'limit: 1..5000').max(5000).optional(),
  reset: z.boolean().optional(),
});
export type TgCollectInput = z.infer<typeof tgCollectSchema>;

// POST /api/rag/index (SSE) — индексация docs (fixed/structure). Мутирует rag.sqlite.
// strategies обязательно и непустое: web = destructive-action, полный reindex без явного
// выбора запрещён (memory-инвариант «индекс собран вручную, не реиндексировать без запроса»).
export const ragIndexSchema = z.object({
  strategies: z.array(z.enum(['fixed', 'structure'])).min(1, 'Укажите хотя бы одну стратегию'),
});
export type RagIndexInput = z.infer<typeof ragIndexSchema>;

// POST /api/rag/index-tg (SSE) — индексация telegram. ⚠️ LANDMINE:
// single-topic (topicId задан) при reset:true чистит ВСЮ telegram-партицию (clearStrategy).
// whole-chat (topicId не задан) чистит только чат (clearBySourcePrefix) — безопаснее.
export const ragIndexTgSchema = z.object({
  chatRef: z.string().trim().min(1, 'chatRef обязателен').max(200),
  topicId: z.coerce.number().int().min(0).optional(),
  reset: z.boolean().optional(),
  limit: z.coerce.number().int().min(1, 'limit: 1..5000').max(5000).optional(),
  wholeChat: z.boolean().optional(),
  top: z.coerce.number().int().min(1, 'top: 1..5000').max(5000).optional(),
});
export type RagIndexTgInput = z.infer<typeof ragIndexTgSchema>;

// POST /api/telegram/publish — отправка текста в TG-канал (Bot API). Реальный внешний эффект.
// parseMode: 'HTML' (дефолт) | 'none' — без разметки; sanitize — на сервере (tg-html.ts).
export const tgPublishSchema = z.object({
  text: z.string().trim().min(1, 'Текст обязателен').max(4096, 'TG: до 4096 символов'),
  parseMode: z.enum(['HTML', 'none']).optional(),
});
export type TgPublishInput = z.infer<typeof tgPublishSchema>;

// POST /api/blog/digest/generate — окно дайджеста в днях по published_at (включая
// used). Дефолт 7 — на сервере (контракт П-1: поле оставляет расширение окна UI
// без ломки контракта). blog — slug блога: новости и голос канала этого блога.
export const digestGenerateSchema = z.object({
  days: z.coerce.number().int().min(1).max(30).optional(),
  blog: z.string().trim().min(1).max(100).optional(),
});
export type DigestGenerateInput = z.infer<typeof digestGenerateSchema>;

// PATCH /api/blogs/[slug] — настройка блога (имя, профиль голоса, TG-чат,
// RSS-источники, пресет стиля, per-blog промпты). profile: имя из /chat-профилей
// или null (сброс). sources: массив http(s)-URL (≤20); [] сбрасывает на дефолтные
// фиды (null в БД). stylePreset: значения синхронны с core stylePreset.ts (shared
// не импортирует core). systemPrompt/contextPrompt: null или '' очищают значение.
export const blogPatchSchema = z.object({
  name: z.string().trim().min(1, 'Имя обязательно').max(120).optional(),
  profile: z.string().trim().max(100).nullable().optional(),
  tgChatId: z.string().trim().max(100).nullable().optional(),
  stylePreset: z.enum(['default', 'antonov']).optional(),
  systemPrompt: z.string().max(8000, 'System prompt: до 8000 символов').nullable().optional(),
  contextPrompt: z.string().max(8000, 'Context prompt: до 8000 символов').nullable().optional(),
  sources: z
    .array(
      z
        .string()
        .trim()
        .max(500)
        .regex(/^https?:\/\//, 'Источник должен быть http(s)-URL'),
    )
    .max(20, 'Источников — не больше 20')
    .optional(),
});
export type BlogPatchInput = z.infer<typeof blogPatchSchema>;

// --- Day 36: admin-auth ---

// POST /api/auth/login — пароль единственного админа. Без .trim(): пробелы в
// пароле легальны (граница = длина, валидация — на сервере).
export const loginSchema = z.object({
  password: z.string().min(1, 'Введите пароль').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

// --- Meetup: публичный генератор Jira-задач (/jira) ---

// POST /api/jira/generate — описание фичи своими словами. Публичный LLM-endpoint:
// cap длины здесь + rate-limit в роуте. clean() на сервере перед промптом.

// Формат выходного контракта генератора: 'user-story' (7 блоков, дефолт на сервере)
// | 'star' (6 секций S/T/A/R + Gherkin-AC + Scope). Enum в shared — виден обоим
// берегам без server-only (прецедент strategyNameSchema); сервер потребляет в jira-persona.
export const jiraFormatSchema = z.enum(['user-story', 'star']);
export type JiraFormat = z.infer<typeof jiraFormatSchema>;

export const jiraGenerateSchema = z.object({
  description: z
    .string()
    .trim()
    .min(20, 'Опишите фичу подробнее — минимум 20 символов')
    .max(2000, 'Слишком длинное описание — максимум 2000 символов'),
  llm: z.enum(['local', 'cloud']).optional(),
  format: jiraFormatSchema.optional(),
});
export type JiraGenerateInput = z.infer<typeof jiraGenerateSchema>;

// --- Demo: публичный RAG (/demo) ---

// POST /api/demo/rag — вопрос гостя к публичной базе знаний (партиция structure).
// Публичный LLM+RAG-endpoint: cap 300 здесь + rate-limit в роуте. Полей llm/strategy/k
// в схеме НЕТ — сервер фиксирует всё сам (замороженный контракт, план §2).
export const demoRagSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, 'Введите вопрос')
    .max(300, 'Слишком длинный вопрос — максимум 300 символов'),
});
export type DemoRagInput = z.infer<typeof demoRagSchema>;

// POST /api/style/rewrite — «Антоновайзер»: переписать текст в стиле
// канала-инсайдера (публичный LLM-endpoint: cap 2000 + rate-limit в роуте).
// mode/format/signature — предпочтения подачи; llm — выбор движка (облако или
// локальная Ollama, оба настроены сервером). Промпт и модели фиксирует сервер.
export const styleRewriteSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Введите текст')
    .max(2000, 'Слишком длинный текст — максимум 2000 символов'),
  mode: z.enum(['soft', 'normal', 'hard']).default('normal'),
  format: z.enum(['auto', 'post', 'essay', 'guide', 'calm']).default('auto'),
  signature: z.boolean().default(false),
  llm: z.enum(['cloud', 'local']).default('cloud'),
});
export type StyleRewriteInput = z.infer<typeof styleRewriteSchema>;

// POST /api/antonov/rewrite — студия канала /antonov (авторизованный роут,
// НЕ публичный): те же поля подачи, что у /api/style/rewrite, но кап хозяина —
// текст до 15000 (длинная статья с запасом). Лимиты запросов задаёт роут
// (шире публичных).
export const antonovRewriteSchema = styleRewriteSchema.extend({
  text: z
    .string()
    .trim()
    .min(1, 'Введите текст')
    .max(15000, 'Слишком длинный текст — максимум 15000 символов'),
});
export type AntonovRewriteInput = z.infer<typeof antonovRewriteSchema>;

// POST /api/antonov/thread — агент «Поток-перевод» (авторизованный роут): чужой
// разбор → серия постов ТГ с рамкой переводчика (пост 1 — рамка, середина —
// голос автора, последний — «прим. переводчика» + источник). Кап исходника —
// как у студии (15000). author/source идут в рамку первого и последнего поста;
// images — описания картинок (по одному на элемент), модель раскладывает их
// маркерами [📸: …] по постам по смыслу.
export const antonovThreadSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Введите текст')
    .max(15000, 'Слишком длинный текст — максимум 15000 символов'),
  author: z.string().trim().max(120, 'Имя автора — до 120 символов').default(''),
  source: z.string().trim().max(300, 'Ссылка на источник — до 300 символов').default(''),
  images: z
    .array(z.string().trim().min(1).max(200, 'Описание картинки — до 200 символов'))
    .max(12, 'Картинок — не больше 12')
    .default([]),
  mode: z.enum(['soft', 'normal', 'hard']).default('normal'),
  llm: z.enum(['cloud', 'local']).default('cloud'),
});
export type AntonovThreadInput = z.infer<typeof antonovThreadSchema>;

// --- rag-ingest: «База знаний» /rag/ingest (партиция 'notes') ---

// POST /api/rag/notes — заметка владельца (JSON-ветка). Границы по замороженному
// контракту (план §1); clean() применяется на сервере ПОВЕРХ схемы (tainted).
export const noteIngestSchema = z.object({
  title: z.string().trim().min(1, 'Введите заголовок заметки').max(120, 'Заголовок — до 120 символов'),
  text: z.string().trim().min(1, 'Введите текст заметки').max(20000, 'Текст — до 20000 символов'),
});
export type NoteIngestInput = z.infer<typeof noteIngestSchema>;

// DELETE /api/rag/notes — удалить заметку по source. Сервер ДО SQL дополнительно
// проверяет префикс note:// (deleteBySource — exact-match по (strategy, source),
// без префикс-чека можно удалить чужую партицию по точному source).
export const noteDeleteSchema = z.object({
  source: z.string().trim().min(1, 'source обязателен').max(200),
});
export type NoteDeleteInput = z.infer<typeof noteDeleteSchema>;

// Файл-ветка POST /api/rag/notes (multipart): поле file — чистый текст ≤ 512 КБ.
// Константы + чистая функция — единый источник текстов ошибок для клиентской
// превалидации (П-3) и сервера (роут); без server-only — импортируется клиентом.
export const NOTE_FILE_MAX_BYTES = 512 * 1024;
export const NOTE_FILE_EXT: readonly string[] = ['.txt', '.md', '.markdown'];

/** null = файл ок; иначе человекочитаемая причина отказа (ext проверяется первым). */
export function noteFileError(name: string, size: number): string | null {
  const lower = name.toLowerCase();
  if (!NOTE_FILE_EXT.some((ext) => lower.endsWith(ext))) {
    return 'Поддерживаются только файлы .txt, .md и .markdown';
  }
  if (size > NOTE_FILE_MAX_BYTES) {
    return 'Файл слишком большой — максимум 512 КБ';
  }
  return null;
}

// --- Token estimate: POST /api/tokens/estimate ---

// Грубая оценка токенов по UTF-8-байтам (bytes / 4) — без токенизатора.
// content НЕ trim'ится: оценка должна отражать реальный промпт, включая пробелы.
// Границы защищают event loop от гигантских JSON-тел (200 × 100k символов).
export const tokenEstimateMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().max(100_000, 'Сообщение — до 100000 символов'),
});
export type TokenEstimateMessageInput = z.infer<typeof tokenEstimateMessageSchema>;

export const tokenEstimateSchema = z.object({
  messages: z.array(tokenEstimateMessageSchema).max(200, 'Сообщений — не больше 200'),
  budget: z
    .number()
    .int('Бюджет должен быть целым числом')
    .nonnegative('Бюджет не может быть отрицательным')
    .optional(),
});
export type TokenEstimateInput = z.infer<typeof tokenEstimateSchema>;

// --- Product: workspace (проекты/папки/элементы) ---

export const workspaceProjectSchema = z.object({
  name: z.string().trim().min(1, 'Название обязательно').max(120),
  description: z.string().trim().max(1000).optional(),
  color: z.string().trim().max(20).optional(),
});
export type WorkspaceProjectInput = z.infer<typeof workspaceProjectSchema>;

export const workspaceProjectPatchSchema = workspaceProjectSchema
  .partial()
  .extend({ status: z.enum(['active', 'archived']).optional() });
export type WorkspaceProjectPatchInput = z.infer<typeof workspaceProjectPatchSchema>;

export const workspaceFolderSchema = z.object({
  projectId: z.number().int().positive(),
  name: z.string().trim().min(1).max(120),
  parentId: z.number().int().positive().nullable().optional(),
});
export type WorkspaceFolderInput = z.infer<typeof workspaceFolderSchema>;

export const workspaceItemSchema = z.object({
  projectId: z.number().int().positive(),
  folderId: z.number().int().positive().nullable().optional(),
  kind: z.enum(['note', 'task', 'link']).optional(),
  title: z.string().trim().min(1, 'Заголовок обязателен').max(500),
  body: z.string().trim().max(20000).optional(),
  url: z.string().trim().max(2000).optional(),
  dueAt: z.string().trim().max(40).optional(),
});
export type WorkspaceItemInput = z.infer<typeof workspaceItemSchema>;

export const workspaceItemPatchSchema = z.object({
  id: z.number().int().positive(),
  done: z.boolean().optional(),
  title: z.string().trim().min(1).max(500).optional(),
  body: z.string().trim().max(20000).optional(),
  dueAt: z.string().trim().max(40).nullable().optional(),
});
export type WorkspaceItemPatchInput = z.infer<typeof workspaceItemPatchSchema>;

// --- Product: уведомления ---

export const notificationActionSchema = z.object({
  action: z.enum(['markAllRead', 'markRead']),
  id: z.number().int().positive().optional(),
});
export type NotificationActionInput = z.infer<typeof notificationActionSchema>;

// --- Product: автоматизация ---

export const automationConfigureSchema = z.object({
  action: z.literal('configure'),
  blogId: z.number().int().positive(),
  enabled: z.boolean().optional(),
  intervalMinutes: z.number().int().min(5).optional(),
  autoPublish: z.boolean().optional(),
});
export type AutomationConfigureInput = z.infer<typeof automationConfigureSchema>;

export const automationRunSchema = z.object({
  action: z.literal('run'),
  blogId: z.number().int().positive(),
});
export type AutomationRunInput = z.infer<typeof automationRunSchema>;

// --- Product: интеграции (webhooks) ---

export const webhookSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(2000),
  secret: z.string().max(200).optional(),
  events: z
    .array(z.enum(['post_published', 'todo_completed', 'automation_run', 'notification']))
    .max(20)
    .optional(),
});
export type WebhookInputSchema = z.infer<typeof webhookSchema>;

// Входящие webhooks: POST /api/integrations/inbound — создать хук (секрет генерит сервер).
export const inboundHookCreateSchema = z.object({
  name: z.string().trim().min(1, 'Название обязательно').max(120),
  target: z.enum(['notification', 'todo']),
});
export type InboundHookCreateInput = z.infer<typeof inboundHookCreateSchema>;

// POST /api/integrations/inbound/[id] — событие от внешнего сервиса (публичный роут,
// авторизация — HMAC-подпись сырого тела, не сессия). Границы защищают от гигантских тел.
export const inboundEventSchema = z.object({
  title: z.string().trim().min(1, 'title обязателен').max(200),
  body: z.string().trim().max(2000).optional(),
  href: z.string().trim().max(500).optional(),
});
export type InboundEventInput = z.infer<typeof inboundEventSchema>;

// --- Product: поддержка ---

export const supportTicketSchema = z.object({
  subject: z.string().trim().min(1, 'Тема обязательна').max(200),
  body: z.string().trim().min(1, 'Опишите проблему').max(5000),
  contact: z.string().trim().max(200).optional(),
});
export type SupportTicketInput = z.infer<typeof supportTicketSchema>;

// --- Product: ИИ-помощник ---

export const assistantSchema = z.object({
  message: z.string().trim().min(1, 'Вопрос не может быть пустым').max(2000),
});
export type AssistantInput = z.infer<typeof assistantSchema>;

// --- Product: календарь (sync) ---

export const calendarSyncSchema = z.object({
  days: z.number().int().min(1).max(90).optional(),
});
export type CalendarSyncInput = z.infer<typeof calendarSyncSchema>;

// --- Product: геймификация ---

// Ответ GET /api/gamification (docs/api-contracts.md): xp/level/прогресс
// вложены в `stats`, достижения и журнал — top-level. Плоский View + слепой
// каст на /gamification прятали рассинхрон (issue #79) — ответ парсится по
// схеме на границе. levelProgress — ДОЛЯ 0..1, не процент (клиент ×100 сам).
export const gamificationViewSchema = z.object({
  stats: z.object({
    xp: z.number(),
    level: z.number(),
    levelProgress: z.number(),
    nextLevelXp: z.number(),
    streak: z.number(),
    bestStreak: z.number(),
  }),
  achievements: z.array(
    z.object({
      code: z.string(),
      title: z.string(),
      description: z.string(),
      unlocked: z.boolean(),
    }),
  ),
  events: z.array(
    z.object({
      id: z.number(),
      type: z.string(),
      points: z.number(),
      createdAt: z.string(),
    }),
  ),
});
export type GamificationView = z.infer<typeof gamificationViewSchema>;

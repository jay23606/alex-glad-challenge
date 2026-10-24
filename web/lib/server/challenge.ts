// ЕДИНСТВЕННЫЙ chokepoint импорта @challenge/core/* в web.
//
// `import 'server-only'` гарантирует: любой модуль, импортирующий отсюда, физически
// не может попасть в client bundle (компилятор Next выбросит ошибку сборки). Client
// компоненты обязаны импортировать только из web/lib/shared/* — никогда из core/.
//
// Подмножество для P0: БД-классы + dataPath. P1+ расширит (LlmClient, answerWithRag,
// Retriever, TodoDb-методы и т.д.) — сюда же, не плодя новых chokepoint'ов.
import 'server-only';

export { dataPath, DATA_DIR } from '@challenge/core/paths';
export { BlogDb, DEFAULT_BLOG_SLUG } from '@challenge/core/db';
export type { NewsRow, PostRow, StyleSampleRow, BlogRow } from '@challenge/core/db';
export { RagStore } from '@challenge/core/rag/store';
export { DialogDb } from '@challenge/core/dialogDb';
export type { ChatRow, MessageRow } from '@challenge/core/dialogDb';
export { TgStore } from '@challenge/core/tg/tgStore';
export { TodoDb } from '@challenge/core/todoDb';
export type { TodoRow } from '@challenge/core/todoDb';
// P1: streaming RAG + Retriever/embedder + guard-константа.
export { Retriever } from '@challenge/core/rag/retriever';
export { makeEmbedder } from '@challenge/core/rag/embedder';
export { answerWithRag, answerNoRag, GUARD_ANSWER } from '@challenge/core/rag/rag';
export type { RagDebug, RagAnswer, RagStage } from '@challenge/core/rag/rag';
export type { ScoredChunk, Quote } from '@challenge/core/rag/types';
export type { ChatMessage, Role, ChatParams } from '@challenge/core/types';
export { msg } from '@challenge/core/types';
// P2: Chat-агент — память, стратегии, профиль, инварианты (consume as-is).
export { Memory } from '@challenge/core/memory';
export type { LongTermEntry, MemorySnapshot } from '@challenge/core/memory';
export { ProfileManager } from '@challenge/core/profile';
export type { UserProfile } from '@challenge/core/profile';
export { Constraints } from '@challenge/core/constraints';
export type { Constraint, ConstraintType } from '@challenge/core/constraints';
export { FullHistory, SlidingWindow, StickyFacts, Branching } from '@challenge/core/strategy';
export type { ContextStrategy } from '@challenge/core/strategy';
// P2b: sanitize tainted-инструкции (profile-edit) перед передачей в LLM.
export { clean } from '@challenge/core/sanitize';
// P3a: RAG-chat каталог + aliases, DialogDb task-state, TG-source filter для Retriever.
export {
  loadChatTitles,
  loadAliases,
  addAlias,
  removeAlias,
  findAliasByName,
  findAliasByChatKey,
} from '@challenge/core/rag/chatCatalog';
export type { ChatAlias } from '@challenge/core/rag/chatCatalog';
export type { SerializedTaskState } from '@challenge/core/dialogDb';
export type { ChatSourceFilter, ChunkingStrategy } from '@challenge/core/rag/types';
// P4a: Блог-pipeline (RSS→3 агента→пост) + публикация в TG-канал.
// publishPost — реальный внешний эффект; route вызывает только при isTelegramConfigured().
export { runNewsPipeline } from '@challenge/core/agents/pipeline';
export type { PipelineResult } from '@challenge/core/agents/pipeline';
export { publishPost, isTelegramConfigured } from '@challenge/core/agents/telegram';
export type { PublishResult } from '@challenge/core/agents/telegram';
// P4b: FSM pipeline-state (stateMachine) + scout (3 source-агента → оркестратор).
// stateMachine тянет только node:fs + type-only (NewsRow/FactCheckResult) — barrel-чистый.
// sourcePipeline тянет agents-barrel через rssSource/forumScanner/telegramScanner/orchestrator
// → seed.ts. С follow-up P4a seed.ts использует path.dirname(fileURLToPath(import.meta.url))
// (webpack-resolvable), поэтому stub в web/ больше не нужен — грузится оригинал.
export { runSourceAgents } from '@challenge/core/agents/sourcePipeline';
export type { OrchestratorResult } from '@challenge/core/agents/orchestrator';
export type { TrendingTopic, SourceAgentResult } from '@challenge/core/agents/sourceAgent';
export {
  STAGE_INFO,
  createInitialState,
  transition,
  saveState,
  loadState,
  clearState,
  allowedTransitions,
  isTransitionAllowed,
  expectedActionFor,
  TransitionError,
} from '@challenge/core/agents/stateMachine';
export type { PipelineStage, PipelineState, PipelineStep } from '@challenge/core/agents/stateMachine';
// P5: generic MCP-клиент (tools/call к настроенному MCP-серверу) + stateful LLM-агент (/agent).
export { McpHttpClient } from '@challenge/core/mcpHttpClient';
export type { McpHttpTool, McpHttpServerInfo } from '@challenge/core/mcpHttpClient';
export { Agent } from '@challenge/core/agent';
// P3b: TG-collect (MTProto) + RAG index/index-tg + TG-publish.
// MTProto-клиент — переиспользуем core/-хелпер (getConnectedRawScanClient), а не плодим
// wrapper: один init/туннель/session на процесс, TG_SESSION в одном месте (security).
// collectTopic имеет onProgress → live SSE; runIndexing — без внешнего onProgress (start→done).
export {
  collectTopic,
  buildTopicChunks,
  messageToChunk,
  resolveChatTopic,
  resolveChatKey,
  listForumTopicIds,
} from '@challenge/core/tg/topicCollector';
export type {
  ChatTopicRef,
  CollectResult,
  CollectOpts,
  TgBuiltChunk,
} from '@challenge/core/tg/topicCollector';
export type { TgMessageRow } from '@challenge/core/tg/tgStore';
export { indexDocuments, runIndexing, RAG_STRATEGIES } from '@challenge/core/rag/pipeline';
export type { IndexingResult } from '@challenge/core/rag/pipeline';
export type { Chunk, Embedder } from '@challenge/core/rag/types';
// rag-ingest: ингест заметок владельца (/rag/ingest) в партицию 'notes'.
// listNotes/deleteBySource/count — методы RagStore (выше), отдельных экспортов не нужно.
export { ingestNote } from '@challenge/core/rag/notesIngest';
export type { NoteIngestResult } from '@challenge/core/rag/notesIngest';
export {
  getConnectedRawScanClient,
  disconnectScanClient,
  isScanConfigured,
} from '@challenge/core/agents/telegramScan';
export type { RawTelegramClient } from '@challenge/core/agents/telegramScan';
export { saveChatTitle } from '@challenge/core/rag/chatCatalog';
// Оценка токенов: чистая эвристика UTF-8 bytes / 4 (POST /api/tokens/estimate).
export { TokenEstimator, DEFAULT_BYTES_PER_TOKEN } from '@challenge/core/tokenEstimator';
export type {
  TokenEstimatorOptions,
  TextEstimate,
  MessageEstimate,
  TokenEstimate,
} from '@challenge/core/tokenEstimator';
// Product: workspace (проекты/папки/элементы).
export { WorkspaceDb } from '@challenge/core/workspaceDb';
export type { ProjectRow, FolderRow, WorkspaceItemRow, ItemInput, ItemFilter } from '@challenge/core/workspaceDb';
// Product: геймификация.
export { GamificationDb, levelForXp, xpForLevel, EVENT_POINTS, ACHIEVEMENTS } from '@challenge/core/gamification';
export type { GamificationStats, AwardResult, Achievement } from '@challenge/core/gamification';
// Product: уведомления.
export { NotificationDb, NotificationService } from '@challenge/core/notifications';
export type { NotificationRow, NotificationInput, NotificationChannel } from '@challenge/core/notifications';
// Product: автоматизация блогов.
export { BlogAutomation, nextRunAfter } from '@challenge/core/automation';
export type { AutomationRuleRow, AutomationRunRow, BlogRunOutcome, AutomationRunResult } from '@challenge/core/automation';
// Общая фабрика прогона блога (pipeline + профиль + публикация по auto_publish).
export { createAutomationRunner } from '@challenge/core/agents/automationRun';
// Product: календарь + Google Calendar.
export { buildIcs, deadlineEvent } from '@challenge/core/calendar';
export type { CalendarEvent } from '@challenge/core/calendar';
export { GoogleCalendarClient } from '@challenge/core/googleCalendar';
// Product: интеграции (webhooks).
export { WebhookDb, deliverEvent, validateWebhookUrl, signPayload, verifySignature } from '@challenge/core/webhooks';
export type { WebhookRow, WebhookEvent } from '@challenge/core/webhooks';
// Product: интеграции (входящие webhooks).
export { InboundHookDb, handleInboundEvent } from '@challenge/core/inboundWebhooks';
export type { InboundHookRow, InboundTarget, InboundEvent } from '@challenge/core/inboundWebhooks';
// Product: поддержка.
export { SupportCenterDb, searchFaq, buildSupportContext, ARTEL_FAQ } from '@challenge/core/supportCenter';
export type { FaqMatch, SupportTicketRow } from '@challenge/core/supportCenter';
// Product: ИИ-помощник (контекст).
export { renderAssistantContext, buildAssistantMessages } from '@challenge/core/assistant';
export type { AssistantSnapshot } from '@challenge/core/assistant';
// Product: env-конфиги (Google Calendar / мобильный токен) — наружу только значения,
// не секреты; потребители маскируют.
export { getGoogleCalendarConfig, getMobileApiToken } from '@challenge/core/env';
export type { GoogleCalendarConfig } from '@challenge/core/env';

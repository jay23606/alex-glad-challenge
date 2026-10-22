// core: общая библиотека монолита.
// LLM-клиент с OpenAI-совместимым Chat Completions API + типы + стратегии контекста + блог-агенты.

export type { ChatMessage, Role, LlmRequest, LlmResponse, Usage, ChatParams } from './types.js';
export { msg } from './types.js';
export { LlmClient } from './client.js';
export type { ProviderConfig } from './client.js';
export { Agent } from './agent.js';
export type { ContextStrategy, ContextStats } from './strategy.js';
export { FullHistory, SlidingWindow, StickyFacts, Branching } from './strategy.js';
export { loadEnvUpward } from './env.js';
export { Memory } from './memory.js';
export type { LongTermEntry, MemorySnapshot } from './memory.js';
export { ProfileManager } from './profile.js';
export type { UserProfile } from './profile.js';
export { Constraints } from './constraints.js';
export type { Constraint, ConstraintType } from './constraints.js';

export { BlogDb } from './db.js';
export type { NewsRow, PostRow, StyleSampleRow } from './db.js';
export { DialogDb } from './dialogDb.js';
export type { ChatRow, MessageRow, SerializedTaskState, PastQaRow } from './dialogDb.js';
export { McpStdioClient } from './mcp.js';
export type { McpTool, McpServerInfo, McpInitResult } from './mcp.js';
export { McpStdioServer } from './mcpServer.js';
export type { McpServerTool, McpToolResult, McpServerConfig } from './mcpServer.js';
export { McpHttpServer } from './mcpHttpServer.js';
export { McpHttpClient } from './mcpHttpClient.js';
export type { McpHttpTool, McpHttpServerInfo } from './mcpHttpClient.js';
export { TodoDb } from './todoDb.js';
export type { TodoRow } from './todoDb.js';
export { parseTodoArgs } from './todoParser.js';
export type { ParsedTodoArgs } from './todoParser.js';
export { TokenEstimator, DEFAULT_BYTES_PER_TOKEN } from './tokenEstimator.js';
export type {
  TokenEstimatorOptions,
  TextEstimate,
  MessageEstimate,
  TokenEstimate,
} from './tokenEstimator.js';
export * as agents from './agents/index.js';

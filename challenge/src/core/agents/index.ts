// Агенты для блога «Иди на факты глянь».

export { NewsFetcher } from './newsFetcher.js';
export type { NewsFetchResult, RankedNews } from './newsFetcher.js';

export { PostWriter, rewritePost } from './postWriter.js';
export type { WrittenPost } from './postWriter.js';

export { FactChecker } from './factChecker.js';
export type { FactCheckResult, FactCheckIssue } from './factChecker.js';

export { runNewsPipeline } from './pipeline.js';
export type { PipelineResult } from './pipeline.js';

export { createAutomationRunner } from './automationRun.js';
export type { AutomationRunner, AutomationRunnerOptions, AutomationPublish } from './automationRun.js';

export { fetchAllFeeds, filterRecent, toNewsRow } from './rss.js';
export type { RssItem } from './rss.js';

export { seedStyleSamples } from './seed.js';

export { publishPost, isTelegramConfigured } from './telegram.js';
export type { PublishResult } from './telegram.js';

export { Reviser } from './reviser.js';
export type { RevisionResult } from './reviser.js';

export type { SourceAgent, SourceAgentResult, TrendingTopic } from './sourceAgent.js';
export { RssSourceAgent } from './rssSource.js';
export { ForumScannerAgent } from './forumScanner.js';
export { TelegramScannerAgent } from './telegramScanner.js';
export { Orchestrator } from './orchestrator.js';
export type { OrchestratorResult } from './orchestrator.js';
export { runSourceAgents } from './sourcePipeline.js';

export { StatefulPipeline } from './statefulPipeline.js';
export {
  createInitialState,
  loadState,
  saveState,
  expectedActionFor,
  STAGE_INFO,
  isTransitionAllowed,
  allowedTransitions,
  TransitionError,
} from './stateMachine.js';
export type { PipelineState, PipelineStage } from './stateMachine.js';

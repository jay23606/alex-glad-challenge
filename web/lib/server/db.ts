// Module-level singletons БД для server-side (Route Handlers / Server Components).
//
// node:sqlite DatabaseSync синхронный и блокирует event loop Next. Singleton'ы живут
// один раз на процесс (WAL); пути — через dataPath() (cwd-независимо, challenge/.data).
//
// withDb() — минимальная промис-очередь (serial): сериализует обращения к DatabaseSync,
// защищая от ре-ентрантных вызовов из параллельных Server Actions (1-юзер локально,
// но гарантия корректности). P1+ (запись/SSE) использует её; P0 только читает.
import 'server-only';
import {
  BlogDb,
  RagStore,
  DialogDb,
  TgStore,
  TodoDb,
  WorkspaceDb,
  GamificationDb,
  NotificationDb,
  SupportCenterDb,
  WebhookDb,
  InboundHookDb,
  dataPath,
} from './challenge';

let blog: BlogDb | null = null;
let rag: RagStore | null = null;
let dialog: DialogDb | null = null;
let tg: TgStore | null = null;
let todo: TodoDb | null = null;
let workspace: WorkspaceDb | null = null;
let gamification: GamificationDb | null = null;
let notifications: NotificationDb | null = null;
let support: SupportCenterDb | null = null;
let webhooks: WebhookDb | null = null;
let inboundHooks: InboundHookDb | null = null;

export function getBlogDb(): BlogDb {
  if (!blog) blog = new BlogDb(dataPath('blog.sqlite'));
  return blog;
}

export function getRagStore(): RagStore {
  if (!rag) rag = new RagStore(dataPath('rag.sqlite'));
  return rag;
}

export function getDialogDb(): DialogDb {
  if (!dialog) dialog = new DialogDb(dataPath('dialog.sqlite'));
  return dialog;
}

export function getTgStore(): TgStore {
  if (!tg) tg = new TgStore(dataPath('tg.sqlite'));
  return tg;
}

export function getTodoDb(): TodoDb {
  // day-18-server создавал <cwd>/.data/todos.sqlite; dataPath() — cwd-независимый
  // эквивалент (всегда challenge/.data/todos.sqlite). P1 singleton для /mcp/todos.
  if (!todo) todo = new TodoDb(dataPath('todos.sqlite'));
  return todo;
}

export function getWorkspaceDb(): WorkspaceDb {
  if (!workspace) workspace = new WorkspaceDb(dataPath('workspace.sqlite'));
  return workspace;
}

export function getGamificationDb(): GamificationDb {
  if (!gamification) gamification = new GamificationDb(dataPath('gamification.sqlite'));
  return gamification;
}

export function getNotificationDb(): NotificationDb {
  if (!notifications) notifications = new NotificationDb(dataPath('notifications.sqlite'));
  return notifications;
}

export function getSupportDb(): SupportCenterDb {
  if (!support) support = new SupportCenterDb(dataPath('support.sqlite'));
  return support;
}

export function getWebhookDb(): WebhookDb {
  if (!webhooks) webhooks = new WebhookDb(dataPath('webhooks.sqlite'));
  return webhooks;
}

export function getInboundHookDb(): InboundHookDb {
  if (!inboundHooks) inboundHooks = new InboundHookDb(dataPath('webhooks.sqlite'));
  return inboundHooks;
}

// Serial-обёртка: fn выполняется строго после предыдущего withDb-вызова. Ошибки одного
// вызова не рвут очередь для последующих (tail сглатывает reject).
let tail: Promise<unknown> = Promise.resolve();

export function withDb<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = tail.then(fn, fn) as Promise<T>;
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

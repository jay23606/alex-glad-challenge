// ИИ-помощник по продукту: собирает снапшот состояния (проекты/задачи/автоматизация/
// уведомления/геймификация) и рендерит системный контекст для LLM. Чистая функция —
// LLM-вызов остаётся в адаптере (web), тесты не ходят в сеть.

import type { ChatMessage } from './types.js';
import { msg } from './types.js';

export interface AssistantProject {
  readonly name: string;
  readonly openTasks: number;
}

export interface AssistantRule {
  readonly blogName: string;
  readonly enabled: boolean;
  readonly intervalMinutes: number;
  readonly autoPublish: boolean;
}

export interface AssistantSnapshot {
  readonly projects: ReadonlyArray<AssistantProject>;
  readonly dueTasks: number;
  readonly unreadNotifications: number;
  readonly automation: ReadonlyArray<AssistantRule>;
  readonly xp: number;
  readonly level: number;
}

export function renderAssistantContext(snapshot: AssistantSnapshot): string {
  const projectLines =
    snapshot.projects.length === 0
      ? ['- (проектов нет)']
      : snapshot.projects.map((p) => `- ${p.name} — открытых задач: ${p.openTasks}`);
  const automationLines =
    snapshot.automation.length === 0
      ? ['- (правил автоматизации нет)']
      : snapshot.automation.map(
          (r) =>
            `- ${r.blogName}: ${r.enabled ? `включено, каждые ${r.intervalMinutes} мин` : 'выключено'}, автопубликация ${r.autoPublish ? 'да' : 'нет'}`,
        );
  return [
    'Текущее состояние «Артели»:',
    `Геймификация: ${snapshot.xp} XP, уровень ${snapshot.level}.`,
    `Задач с дедлайном скоро: ${snapshot.dueTasks}. Непрочитанных уведомлений: ${snapshot.unreadNotifications}.`,
    'Проекты:',
    ...projectLines,
    'Автоматизация блогов:',
    ...automationLines,
  ].join('\n');
}

export function buildAssistantMessages(snapshot: AssistantSnapshot, question: string): ChatMessage[] {
  return [
    msg.system(
      'Ты — ИИ-помощник личного продукта «Артель» (автоматизация блогов, Telegram, проекты, календарь, геймификация). ' +
        'Отвечай на русском, кратко и по делу. Опирайся на приведённый ниже контекст состояния; ' +
        'если данных нет — так и скажи, не выдумывай.\n\n' +
        renderAssistantContext(snapshot),
    ),
    msg.user(question),
  ];
}

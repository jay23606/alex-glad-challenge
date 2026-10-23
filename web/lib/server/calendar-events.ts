// Сбор событий календаря из workspace-задач и todo-напоминаний.
// Единый источник для GET /api/calendar и .ics-фида — без дублирования логики.
import 'server-only';

import { deadlineEvent } from './challenge';
import type { CalendarEvent } from './challenge';
import { getWorkspaceDb, getTodoDb } from './db';

export function collectCalendarEvents(days: number, now = new Date()): CalendarEvent[] {
  const from = now.toISOString();
  const to = new Date(now.getTime() + days * 86_400_000).toISOString();
  const events: CalendarEvent[] = [];

  for (const item of getWorkspaceDb().listUpcoming(from, to)) {
    events.push(
      deadlineEvent({
        uidPrefix: `workspace-${item.id}`,
        title: item.title,
        description: item.body || 'Задача проекта',
        dueAt: item.due_at ?? now.toISOString(),
        href: '/projects',
      }),
    );
  }

  for (const todo of getTodoDb().getDueTodos()) {
    if (!todo.scheduled_at) continue;
    const due = new Date(todo.scheduled_at);
    if (due < now || due > new Date(to)) continue;
    events.push(
      deadlineEvent({
        uidPrefix: `todo-${todo.id}`,
        title: todo.text,
        description: 'Напоминание',
        dueAt: todo.scheduled_at,
        href: '/mcp/todos',
      }),
    );
  }

  return events.sort((a, b) => a.start.localeCompare(b.start));
}

export function calendarEventShape(e: CalendarEvent) {
  return {
    uid: e.uid,
    title: e.title,
    description: e.description,
    start: e.start,
    end: e.end,
    href: e.href,
    source: e.uid.startsWith('todo-') ? 'todo' : 'workspace',
  };
}

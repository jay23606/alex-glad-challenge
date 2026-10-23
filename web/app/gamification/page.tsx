// /gamification — XP, уровни, серии и достижения.
'use client';

import { useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { SectionHead } from '../components/ui/SectionHead';

interface Achievement {
  code: string;
  title: string;
  description: string;
  unlocked: boolean;
}
interface View {
  xp: number;
  level: number;
  levelProgress: number;
  nextLevelXp: number;
  streak: number;
  bestStreak: number;
  achievements: Achievement[];
  events: Array<{ id: number; type: string; points: number; createdAt: string }>;
}

const EVENT_LABEL: Record<string, string> = {
  post_published: 'Публикация поста',
  todo_completed: 'Задача выполнена',
  workspace_item: 'Элемент проекта',
  automation_run: 'Прогон автоматизации',
  assistant_used: 'Обращение к ассистенту',
  support_ticket: 'Обращение в поддержку',
};

export default function GamificationPage() {
  const [data, setData] = useState<View | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await fetch('/api/gamification');
      if (r.ok) setData((await r.json()) as View);
    })();
  }, []);

  if (!data) return <SectionHead code="product · xp" title="Геймификация" />;

  const pct = Math.round(data.levelProgress * 100);

  return (
    <div className="space-y-6">
      <SectionHead code="product · xp" title="Геймификация" description="Очки за реальные действия, уровни, ежедневные серии и достижения." />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card label="Уровень">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-semibold text-ink">{data.level}</span>
            <span className="text-sm text-dim">уровень</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-dim">
            {data.xp} XP · до {data.nextLevelXp} XP ({pct}%)
          </p>
        </Card>
        <Card label="Серия">
          <p className="text-3xl font-semibold text-ink">{data.streak} <span className="text-sm text-dim">дней подряд</span></p>
          <p className="mt-1 text-xs text-dim">рекорд: {data.bestStreak} дней</p>
        </Card>
        <Card label="Достижения">
          <p className="text-3xl font-semibold text-ink">
            {data.achievements.filter((a) => a.unlocked).length}
            <span className="text-sm text-dim"> / {data.achievements.length}</span>
          </p>
          <p className="mt-1 text-xs text-dim">открыто достижений</p>
        </Card>
      </div>

      <Card label="Достижения">
        <div className="grid gap-2 sm:grid-cols-2">
          {data.achievements.map((a) => (
            <div key={a.code} className={`rounded-lg border px-3 py-2 ${a.unlocked ? 'border-accent/40 bg-surface-2' : 'border-line bg-surface opacity-50'}`}>
              <p className="text-sm font-medium text-ink">{a.title}</p>
              <p className="text-xs text-dim">{a.description}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card label="Журнал очков">
        {data.events.length === 0 ? (
          <p className="text-sm text-dim">Действий пока нет.</p>
        ) : (
          <ul className="space-y-1">
            {data.events.map((e) => (
              <li key={e.id} className="flex items-center justify-between text-sm">
                <span className="text-ink">{EVENT_LABEL[e.type] ?? e.type}</span>
                <span className="font-mono text-accent">+{e.points}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

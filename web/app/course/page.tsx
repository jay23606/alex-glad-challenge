// /course — список уроков курса I2N Challenge #8 (server component, без client JS).
// Карточка: badge (вступление/неделя N), длительность, summary + зачем/какую боль.
// Данные — напрямую из CourseDb через withDb (серверный chokepoint).
import Link from 'next/link';

import { SectionHead } from '../components/ui/SectionHead';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { IconList } from '../components/ui/icons';
import { getCourseDb, withDb } from '../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Курс I2N #8' };

function formatDuration(ms: number): string {
  if (ms <= 0) return '';
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

interface LessonCard {
  slug: string;
  title: string;
  kind: string;
  weekNo: number | null;
  durationMs: number;
  summary: string;
  why: string;
  pain: string;
}

export default async function CoursePage() {
  const lessons = await withDb<LessonCard[]>(() =>
    getCourseDb()
      .listLessons()
      .map((l) => ({
        slug: l.slug,
        title: l.title,
        kind: l.kind,
        weekNo: l.weekNo,
        durationMs: l.durationMs,
        summary: l.summary,
        why: l.why,
        pain: l.pain,
      })),
  );

  return (
    <div className="space-y-6">
      <SectionHead
        code="course · i2n challenge #8 · поток 6"
        title="Курс"
        description="Лекции челленджа: короткое пояснение, ключевые выдержки и полная транскрипция с таймкодами."
      />
      {lessons.length === 0 ? (
        <EmptyState
          icon={<IconList className="size-8" />}
          title="Уроки ещё не импортированы"
          hint={
            <>
              Импорт: <code className="font-mono text-xs">pnpm --filter challenge start -- course-import &lt;dir&gt;</code>
            </>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {lessons.map((l) => (
            <Link key={l.slug} href={`/course/${l.slug}`} className="group block">
              <Card variant="interactive" arrow className="h-full">
                <div className="flex items-center gap-2">
                  <Badge tone={l.kind === 'intro' ? 'accent' : 'neutral'}>
                    {l.kind === 'intro' ? 'вступление' : `неделя ${l.weekNo ?? '?'}`}
                  </Badge>
                  {l.durationMs > 0 ? (
                    <span className="font-mono text-xs text-dim">{formatDuration(l.durationMs)}</span>
                  ) : null}
                </div>
                <h2 className="mt-2 font-sans text-lg font-semibold text-ink">{l.title}</h2>
                {l.summary ? (
                  <p className="mt-2 text-sm leading-relaxed text-dim">{l.summary}</p>
                ) : null}
                {l.pain ? (
                  <p className="mt-2 text-xs leading-relaxed text-dim">
                    <span className="font-medium text-ink">Боль:</span> {l.pain}
                  </p>
                ) : null}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

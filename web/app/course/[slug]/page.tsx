// /course/[slug] — урок курса: зачем/боль, ключевые выдержки с пояснениями и
// полная транскрипция по таймкодс-секциям (server component, без client JS).
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SectionHead } from '../../components/ui/SectionHead';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { IconChevronLeft } from '../../components/ui/icons';
import { getCourseDb, withDb } from '../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function formatTs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

interface LessonDetail {
  slug: string;
  title: string;
  kind: string;
  weekNo: number | null;
  durationMs: number;
  summary: string;
  why: string;
  pain: string;
  sections: Array<{ idx: number; startMs: number; endMs: number; text: string }>;
  excerpts: Array<{ idx: number; quote: string; explanation: string }>;
}

async function loadLesson(slug: string): Promise<LessonDetail | null> {
  return withDb(() => {
    const db = getCourseDb();
    const lesson = db.getLesson(slug);
    if (!lesson) return null;
    return {
      slug: lesson.slug,
      title: lesson.title,
      kind: lesson.kind,
      weekNo: lesson.weekNo,
      durationMs: lesson.durationMs,
      summary: lesson.summary,
      why: lesson.why,
      pain: lesson.pain,
      sections: db.getSections(lesson.id).map((s) => ({
        idx: s.idx,
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
      })),
      excerpts: db.getExcerpts(lesson.id).map((e) => ({
        idx: e.idx,
        quote: e.quote,
        explanation: e.explanation,
      })),
    };
  });
}

export default async function CourseLessonPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const lesson = await loadLesson(slug);
  if (!lesson) notFound();

  return (
    <div className="space-y-6">
      <Link
        href="/course"
        className="inline-flex items-center gap-1 text-sm text-dim transition-colors hover:text-ink"
      >
        <IconChevronLeft className="size-4" />
        Все уроки
      </Link>

      <SectionHead
        code={`course · ${lesson.kind === 'intro' ? 'вступление' : `неделя ${lesson.weekNo ?? '?'}`}`}
        title={lesson.title}
        actions={
          lesson.durationMs > 0 ? (
            <Badge tone="dim">{Math.round(lesson.durationMs / 60_000)} мин</Badge>
          ) : null
        }
      />

      {lesson.summary ? (
        <Card label="О чём урок">
          <p className="text-sm leading-relaxed text-ink">{lesson.summary}</p>
          {lesson.why ? (
            <p className="mt-3 text-sm leading-relaxed text-dim">
              <span className="font-medium text-ink">Зачем смотреть:</span> {lesson.why}
            </p>
          ) : null}
          {lesson.pain ? (
            <p className="mt-2 text-sm leading-relaxed text-dim">
              <span className="font-medium text-ink">Какую боль закрывает:</span> {lesson.pain}
            </p>
          ) : null}
        </Card>
      ) : null}

      {lesson.excerpts.length > 0 ? (
        <Card label={`Ключевые выдержки · ${lesson.excerpts.length}`}>
          <ol className="space-y-4">
            {lesson.excerpts.map((e) => (
              <li key={e.idx} className="border-l-2 border-accent-dim pl-3">
                <p className="font-sans text-sm font-medium leading-relaxed text-ink">«{e.quote}»</p>
                <p className="mt-1 text-sm leading-relaxed text-dim">{e.explanation}</p>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {lesson.sections.length > 0 ? (
        <Card label={`Полная транскрипция · ${lesson.sections.length} секций`}>
          <div className="space-y-4">
            {lesson.sections.map((s) => (
              <section key={s.idx}>
                <p className="font-mono text-xs text-dim">
                  {formatTs(s.startMs)} — {formatTs(s.endMs)}
                </p>
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink">{s.text}</p>
              </section>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

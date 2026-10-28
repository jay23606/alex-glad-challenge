// Импорт транскрипций курса в CourseDb: *.transcript.json (таймкодсы) +
// курируемые метаданные (summary/why/pain/excerpts) из JSON-файлов.
//
// Секции: utterances группируются в отрезки ≈3 минуты (MAX_SECTION_MS) с
// оверлапом в одну реплику (SECTION_OVERLAP_UTTERANCES), чтобы граница не рвала
// мысль. Slug выводится из имени файла: «N неделя …» → week-N, «…вступление…» →
// intro. Курирование подключается по слагу из <metaDir>/<slug>.json; без него
// урок импортируется с пустыми summary/why/pain/excerpts (полная транскрипция
// доступна и без курирования).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { clean } from './sanitize.js';
import type { CourseDb, LessonInput } from './courseDb.js';

export interface TranscriptUtterance {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface TranscriptFile {
  readonly durationMs: number;
  readonly utterances: ReadonlyArray<TranscriptUtterance>;
}

export interface LessonMeta {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly why: string;
  readonly pain: string;
  readonly excerpts: ReadonlyArray<{ readonly quote: string; readonly explanation: string }>;
}

const MAX_SECTION_MS = 180_000;
const SECTION_OVERLAP_UTTERANCES = 1;
const MIN_SECTION_CHARS = 200;

/** Slug по имени файла транскрипции: «1 неделя 6 поток v2 (1)» → week-1. */
export function slugFromFilename(filename: string): string | null {
  const base = filename.replace(/\.transcript\.json$/i, '');
  const week = /^(\d+)\s+неделя/iu.exec(base);
  if (week) return `week-${week[1]}`;
  if (/вступление/iu.test(base)) return 'intro';
  return null;
}

/** kind/weekNo по слагу: intro → ('intro', null), week-N → ('week', N). */
export function kindFromSlug(slug: string): { kind: string; weekNo: number | null } {
  const m = /^week-(\d+)$/.exec(slug);
  if (m) return { kind: 'week', weekNo: Number(m[1]) };
  return { kind: 'intro', weekNo: null };
}

/** Распарсить *.transcript.json: { duration, utterances: [{start,end,text}] }. */
export function parseTranscript(raw: string): TranscriptFile {
  const data = JSON.parse(raw) as {
    duration?: unknown;
    utterances?: unknown;
  };
  const durationMs = typeof data.duration === 'number' && data.duration > 0 ? data.duration : 0;
  if (!Array.isArray(data.utterances) || data.utterances.length === 0) {
    throw new Error('transcript: пустой или отсутствующий массив utterances');
  }
  const utterances: TranscriptUtterance[] = [];
  for (const u of data.utterances) {
    const rec = u as { start?: unknown; end?: unknown; text?: unknown };
    const text = typeof rec.text === 'string' ? clean(rec.text) : '';
    if (!text) continue;
    utterances.push({
      start: typeof rec.start === 'number' ? Math.max(0, rec.start) : 0,
      end: typeof rec.end === 'number' ? Math.max(0, rec.end) : 0,
      text,
    });
  }
  if (utterances.length === 0) throw new Error('transcript: все utterances пустые');
  return { durationMs, utterances };
}

export interface BuiltSection {
  readonly idx: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

/** Группировка utterances в секции ≈MAX_SECTION_MS с оверлапом в 1 реплику. */
export function buildSections(utterances: ReadonlyArray<TranscriptUtterance>): BuiltSection[] {
  const sections: BuiltSection[] = [];
  let start = 0;
  let idx = 0;
  while (start < utterances.length) {
    let end = start;
    let chars = 0;
    while (end < utterances.length) {
      const u = utterances[end];
      const span = u.end - utterances[start].start;
      if (end > start && (span > MAX_SECTION_MS || chars > 8000)) break;
      chars += u.text.length;
      end += 1;
    }
    const slice = utterances.slice(start, end);
    const text = slice.map((u) => u.text).join(' ');
    // Не выдаём крошечные хвосты: приклеиваем к предыдущей секции.
    if (sections.length > 0 && text.length < MIN_SECTION_CHARS && end >= utterances.length) {
      const prev = sections[sections.length - 1];
      sections[sections.length - 1] = {
        ...prev,
        endMs: slice[slice.length - 1].end,
        text: `${prev.text} ${text}`.trim(),
      };
      break;
    }
    sections.push({
      idx,
      startMs: slice[0].start,
      endMs: slice[slice.length - 1].end,
      text,
    });
    idx += 1;
    if (end >= utterances.length) break;
    start = Math.max(start + 1, end - SECTION_OVERLAP_UTTERANCES);
  }
  return sections;
}

/** Прочитать курированные метаданные <metaDir>/<slug>.json (или null). */
export function loadLessonMeta(metaDir: string, slug: string): LessonMeta | null {
  const file = path.join(metaDir, `${slug}.json`);
  // Отсутствие файла — штатная деградация (урок без курирования). Битый
  // JSON/"частично валидный" файл — ошибка данных: молча глотать её нельзя,
  // оператор должен увидеть причину, а не только «без метаданных» в CLI.
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as Partial<LessonMeta>;
    if (typeof data.title !== 'string' || !data.title.trim()) return null;
    const excerpts = Array.isArray(data.excerpts)
      ? data.excerpts
          .filter((e): e is { quote: string; explanation: string } => {
            const rec = e as { quote?: unknown; explanation?: unknown };
            return typeof rec.quote === 'string' && typeof rec.explanation === 'string';
          })
          .map((e, i) => ({ idx: i, quote: e.quote, explanation: e.explanation }))
      : [];
    return {
      slug,
      title: data.title,
      summary: typeof data.summary === 'string' ? data.summary : '',
      why: typeof data.why === 'string' ? data.why : '',
      pain: typeof data.pain === 'string' ? data.pain : '',
      excerpts,
    };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error(`courseImport: метаданные ${file} повреждены и пропущены (${m})`);
    return null;
  }
}

export interface ImportResult {
  readonly slug: string;
  readonly title: string;
  readonly sections: number;
  readonly excerpts: number;
  readonly curated: boolean;
}

/** Собрать LessonInput из transcript-файла + опциональных метаданных. */
export function buildLessonInput(
  transcriptPath: string,
  meta: LessonMeta | null,
): LessonInput {
  const slug = slugFromFilename(path.basename(transcriptPath));
  if (!slug) {
    throw new Error(
      `не удалось вывести slug из имени файла «${path.basename(transcriptPath)}» (ожидается «N неделя …» или «…вступление…»)`,
    );
  }
  const transcript = parseTranscript(readFileSync(transcriptPath, 'utf8'));
  const sections = buildSections(transcript.utterances);
  const kindInfo = kindFromSlug(slug);
  const title = meta?.title ?? defaultTitle(slug);
  const excerpts = (meta?.excerpts ?? []).map((e, i) => ({
    idx: i,
    quote: e.quote,
    explanation: e.explanation,
  }));
  return {
    slug,
    title,
    kind: kindInfo.kind,
    weekNo: kindInfo.weekNo,
    durationMs: transcript.durationMs,
    summary: meta?.summary ?? '',
    why: meta?.why ?? '',
    pain: meta?.pain ?? '',
    sourceFile: path.basename(transcriptPath),
    sections,
    excerpts,
  };
}

function defaultTitle(slug: string): string {
  const m = /^week-(\d+)$/.exec(slug);
  if (m) return `Неделя ${m[1]}`;
  if (slug === 'intro') return 'Вступление';
  return slug;
}

/**
 * Импортировать все *.transcript.json из dir в db.
 * metaDir — каталог с курированными <slug>.json; если не передан, ищем рядом.
 */
export function importCourseDir(db: CourseDb, dir: string, metaDir?: string): ImportResult[] {
  const metaBase = metaDir ?? dir;
  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.transcript.json'))
    .sort();
  const results: ImportResult[] = [];
  for (const file of files) {
    const slug = slugFromFilename(file);
    if (!slug) continue;
    const input = buildLessonInput(path.join(dir, file), loadLessonMeta(metaBase, slug));
    db.upsertLesson(input);
    results.push({
      slug: input.slug,
      title: input.title,
      sections: input.sections.length,
      excerpts: input.excerpts.length,
      curated: input.excerpts.length > 0 || input.summary.length > 0,
    });
  }
  return results;
}

// /antonov — студия канала «Антонов такой Антонов» с двумя режимами:
//   «Пост» — черновик любого текста голосом канала (POST /api/antonov/rewrite);
//   «Поток-перевод» — агент потока: чужой разбор → серия постов ТГ с рамкой
//   переводчика (POST /api/antonov/thread): пост 1 — рамка, середина — голос
//   автора, последний — «прим. переводчика» + источник; картинки раскладываются
//   маркерами по постам (по одной в строке на входе).
// Личный инструмент владельца (за auth-middleware), потребитель серверных
// промптов lib/server/style-prompt.ts (STYLE_SYSTEM_PROMPT / THREAD_SYSTEM_PROMPT)
// — без копий на клиенте. 'use client' по канону тул-страниц (/joker): textarea +
// счётчик + истории-пресеты (текст + тон + формат) + тон + формат + подпись +
// движок → 200 {ok,post|posts} | 429/400/502/503. Контролы общие с публичным
// /style (components/style/StyleControls) — формулировки не расходятся.
// Клиентский таймаут: cloud 150с (провайдер режет генерацию на 120-й), local 600с
// (потолок серверного вызова Ollama). История удачных генераций режима «Пост» —
// localStorage (последние 10), читается в useEffect (не в рендере — готча
// гидрации). Импорты — только data/* и components (без lib/server, core).
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { INPUT_CLASS } from '../components/ui/Field';
import { SectionHead } from '../components/ui/SectionHead';
import { SectionLabel } from '../components/ui/SectionLabel';
import {
  StyleEnginePicker,
  StyleExampleCards,
  StyleFormatPicker,
  StyleSignatureToggle,
  StyleTonePicker,
} from '../components/style/StyleControls';
import { useModelPrefDefault } from '../../lib/shared/use-model-pref';
import {
  styleCopy,
  styleExamples,
  styleFormatLabel,
  styleToneLabel,
  threadCopy,
  type StyleExample,
  type StyleFormat,
  type StyleLlm,
  type StyleTone,
} from '../../data/style';

const MAX_TEXT = 15000; // контракт antonovRewriteSchema/antonovThreadSchema (zod на сервере вторым слоем)
// Локальная Ollama на слабом CPU генерирует дольше облака — таймаут подвижный.
// local 600с = серверному потолку Ollama (core/rag/llm.ts): qwen3.5:4b на
// CPU-swap ~5 tok/s, дайджест до 3000 токенов ≈ до 10 мин; раньше клиент отваливался
// на 300-й, пока сервер продолжал генерировать вхолостую.
const TIMEOUT_CLOUD_MS = 150_000;
const TIMEOUT_LOCAL_MS = 600_000;
const HISTORY_KEY = 'antonov-history-v1';
const HISTORY_MAX = 10;
const MAX_AUTHOR = 120; // контракт antonovThreadSchema
const MAX_SOURCE = 300;
// Метаданные потока-перевода — стековая форма (label над полем): INPUT_CLASS
// блочность/ширину не задаёт, добавляем локально (глобально менять нельзя —
// затронет другие страницы; аналог TICKET_FIELD_CLASS в /support).
const THREAD_META_FIELD_CLASS = `block w-full ${INPUT_CLASS}`;
const MAX_IMAGES = 12;
// Жёсткий кап поста Telegram — для счётчика в UI (сервер держит запас 4000).
const TG_POST_LIMIT = 4096;

type Kind = 'post' | 'thread';
type Mode = StyleTone;
type Format = StyleFormat;
type Llm = StyleLlm;
type Status = 'idle' | 'loading' | 'done' | 'error';

interface RewriteResponse {
  ok: boolean;
  post?: string;
  provider?: Llm;
  error?: string;
  retryAfterSec?: number;
}

interface ThreadResponse {
  ok: boolean;
  posts?: string[];
  provider?: Llm;
  error?: string;
  retryAfterSec?: number;
}

interface HistoryItem {
  ts: number;
  text: string;
  post: string;
  mode: Mode;
  format: Format;
}

const KINDS: ReadonlyArray<{ id: Kind; label: string }> = [
  { id: 'post', label: threadCopy.kindPost },
  { id: 'thread', label: threadCopy.kindThread },
];

const CHANNEL_URL = 'https://t.me/auantonov';

function loadHistory(): HistoryItem[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (it): it is HistoryItem =>
        !!it &&
        typeof it === 'object' &&
        typeof (it as HistoryItem).ts === 'number' &&
        typeof (it as HistoryItem).text === 'string' &&
        typeof (it as HistoryItem).post === 'string',
    );
  } catch {
    return [];
  }
}

function saveHistory(items: HistoryItem[]): void {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_MAX)));
  } catch {
    // localStorage может быть недоступен (приватный режим) — история просто не пишется.
  }
}

export default function AntonovPage() {
  const [kind, setKind] = useState<Kind>('post');
  const [text, setText] = useState('');
  const [author, setAuthor] = useState('');
  const [source, setSource] = useState('');
  const [images, setImages] = useState('');
  const [mode, setMode] = useState<Mode>('normal');
  const [format, setFormat] = useState<Format>('auto');
  const [signature, setSignature] = useState(false);
  const [llm, setLlm] = useState<Llm>('cloud');
  const [status, setStatus] = useState<Status>('idle');
  const [post, setPost] = useState<string | null>(null);
  const [posts, setPosts] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedPost, setCopiedPost] = useState<number | null>(null);
  const [exampleNote, setExampleNote] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  // Предпочтение движка из настроек (cookie model_pref) — best-effort, до выбора юзера.
  useModelPrefDefault(setLlm);

  // История — только на клиенте после гидратации (localStorage-остров).
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // Размонтирование — снять висящий запрос.
  useEffect(() => () => abortRef.current?.abort(), []);

  const resetResult = useCallback(() => {
    setPost(null);
    setPosts(null);
    setError(null);
    setCopied(false);
    setCopiedAll(false);
    setCopiedPost(null);
  }, []);

  const switchKind = useCallback(
    (next: Kind) => {
      if (next === kind) return;
      setKind(next);
      resetResult();
    },
    [kind, resetResult],
  );

  const applyExample = useCallback(
    (example: StyleExample) => {
      setKind('post');
      setText(example.text);
      setMode(example.tone);
      setFormat(example.format);
      setSignature(example.signature);
      setExampleNote(
        `История «${example.title}»: тон «${styleToneLabel(example.tone)}», формат «${styleFormatLabel(example.format)}». Можно править.`,
      );
      setStatus('idle');
      resetResult();
      requestAnimationFrame(() => {
        textRef.current?.focus();
        textRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    },
    [resetResult],
  );

  const setErrorFromResponse = useCallback(
    (r: Response, data: { error?: string; retryAfterSec?: number } | null) => {
      let base: string;
      if (data?.error != null) base = data.error;
      else if (r.status === 502) base = styleCopy.errorBaseUnavailable;
      else base = `Ошибка ${r.status}`;
      const retryMin =
        data && typeof data.retryAfterSec === 'number'
          ? Math.max(1, Math.ceil(data.retryAfterSec / 60))
          : null;
      setStatus('error');
      setError(
        retryMin !== null && !base.includes('мин') ? `${base} Повторите через ~${retryMin} мин.` : base,
      );
    },
    [],
  );

  const submit = useCallback(async () => {
    const t = text.trim();
    if (t.length === 0 || t.length > MAX_TEXT) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const timer = setTimeout(() => ac.abort(), llm === 'local' ? TIMEOUT_LOCAL_MS : TIMEOUT_CLOUD_MS);

    setStatus('loading');
    resetResult();
    try {
      if (kind === 'thread') {
        const imageLines = images
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .slice(0, MAX_IMAGES);
        const r = await fetch('/api/antonov/thread', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: t, author: author.trim(), source: source.trim(), images: imageLines, mode, llm }),
          signal: ac.signal,
        });
        const data = (await r.json().catch(() => null)) as ThreadResponse | null;
        const validPosts =
          data !== null && data.ok && Array.isArray(data.posts) && data.posts.length > 0
            ? data.posts.filter((p): p is string => typeof p === 'string')
            : null;
        if (validPosts !== null) {
          setPosts(validPosts);
          setStatus('done');
          requestAnimationFrame(() => resultRef.current?.focus());
        } else {
          setErrorFromResponse(r, data);
        }
      } else {
        const r = await fetch('/api/antonov/rewrite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: t, mode, format, signature, llm }),
          signal: ac.signal,
        });
        const data = (await r.json().catch(() => null)) as RewriteResponse | null;
        if (data !== null && data.ok && typeof data.post === 'string') {
          setPost(data.post);
          setStatus('done');
          setHistory((prev) => {
            const next = [
              { ts: Date.now(), text: t, post: data.post as string, mode, format },
              ...prev.filter((it) => it.post !== data.post),
            ].slice(0, HISTORY_MAX);
            saveHistory(next);
            return next;
          });
          requestAnimationFrame(() => resultRef.current?.focus());
        } else {
          setErrorFromResponse(r, data);
        }
      }
    } catch (e) {
      setStatus('error');
      setError(
        e instanceof DOMException && e.name === 'AbortError'
          ? styleCopy.errorTimeout
          : styleCopy.errorNetwork,
      );
    } finally {
      clearTimeout(timer);
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [kind, text, author, source, images, mode, format, signature, llm, resetResult, setErrorFromResponse]);

  const copyPost = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API может быть запрещён (http, разрешения) — молча остаёмся.
    }
  }, []);

  const copyThreadPost = useCallback(async (value: string, index: number) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedPost(index);
      setTimeout(() => setCopiedPost(null), 2000);
    } catch {
      // Clipboard API может быть запрещён (http, разрешения) — молча остаёмся.
    }
  }, []);

  const copyAllPosts = useCallback(async () => {
    if (posts === null) return;
    try {
      await navigator.clipboard.writeText(posts.join('\n\n───\n\n'));
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch {
      // Clipboard API может быть запрещён (http, разрешения) — молча остаёмся.
    }
  }, [posts]);

  const restore = useCallback((it: HistoryItem) => {
    setKind('post');
    setText(it.text);
    setMode(it.mode);
    setFormat(it.format);
    setPost(it.post);
    setPosts(null);
    setStatus('done');
    setError(null);
    setCopied(false);
  }, []);

  const dropItem = useCallback((ts: number) => {
    setHistory((prev) => {
      const next = prev.filter((it) => it.ts !== ts);
      saveHistory(next);
      return next;
    });
  }, []);

  const loading = status === 'loading';
  const disabled = loading || text.trim().length === 0 || text.trim().length > MAX_TEXT;
  const busyLabel = kind === 'thread' ? threadCopy.rewriting : styleCopy.rewriting;
  const submitLabel = kind === 'thread' ? threadCopy.rewrite : styleCopy.rewrite;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <SectionHead
        code="канал"
        title="Антонов такой Антонов"
        description="Черновик любого текста голосом канала: тон, формат, подпись. Второй режим — поток-перевод чужого разбора с рамкой переводчика. Промпты те же, что у публичного Антоновайзера."
        actions={
          <a
            href={CHANNEL_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-line-strong px-3.5 py-1.5 text-sm font-medium text-dim transition-colors duration-fast hover:border-accent-dim hover:text-ink"
          >
            Канал ↗
          </a>
        }
      />

      <Card label="исходник">
        {/* Режим студии: одиночный пост или поток-перевод чужого разбора. */}
        <fieldset className="mb-4" disabled={loading}>
          <legend className="font-mono text-xs uppercase tracking-wider text-dim">
            {threadCopy.kindLabel}
          </legend>
          <div className="mt-2 inline-flex rounded-md border border-line bg-surface p-1" role="radiogroup" aria-label={threadCopy.kindLabel}>
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                role="radio"
                aria-checked={kind === k.id}
                className={`rounded px-3.5 py-1.5 text-sm font-medium transition-colors duration-fast ${
                  kind === k.id ? 'bg-accent text-accent-ink' : 'text-dim hover:text-ink'
                }`}
                onClick={() => switchKind(k.id)}
              >
                {k.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label htmlFor="antonov-text" className="sr-only">
          {styleCopy.textLabel}
        </label>
        <textarea
          id="antonov-text"
          ref={textRef}
          className={`h-44 w-full resize-y ${INPUT_CLASS}`}
          value={text}
          maxLength={MAX_TEXT}
          onChange={(e) => {
            setText(e.target.value);
            setExampleNote(null);
          }}
          placeholder={styleCopy.textPlaceholder}
          disabled={loading}
        />
        <div className="mt-1.5 text-right font-mono text-xs text-dim">
          {text.length} / {MAX_TEXT}
        </div>

        {kind === 'thread' && (
          <>
            <p className="mt-2 text-xs leading-relaxed text-dim">{threadCopy.frameHint}</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="antonov-author"
                  className="block font-mono text-xs uppercase tracking-wider text-dim"
                >
                  {threadCopy.authorLabel}
                </label>
                <input
                  id="antonov-author"
                  type="text"
                  className={`mt-2 ${THREAD_META_FIELD_CLASS}`}
                  value={author}
                  maxLength={MAX_AUTHOR}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder={threadCopy.authorPlaceholder}
                  disabled={loading}
                />
              </div>
              <div>
                <label
                  htmlFor="antonov-source"
                  className="block font-mono text-xs uppercase tracking-wider text-dim"
                >
                  {threadCopy.sourceLabel}
                </label>
                <input
                  id="antonov-source"
                  type="text"
                  className={`mt-2 ${THREAD_META_FIELD_CLASS}`}
                  value={source}
                  maxLength={MAX_SOURCE}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder={threadCopy.sourcePlaceholder}
                  disabled={loading}
                />
              </div>
            </div>
            <div className="mt-4">
              <label
                htmlFor="antonov-images"
                className="block font-mono text-xs uppercase tracking-wider text-dim"
              >
                {threadCopy.imagesLabel}
              </label>
              <textarea
                id="antonov-images"
                className={`mt-2 h-24 w-full resize-y ${INPUT_CLASS}`}
                value={images}
                onChange={(e) => setImages(e.target.value)}
                placeholder={threadCopy.imagesPlaceholder}
                disabled={loading}
              />
            </div>
          </>
        )}

        {kind === 'post' && styleExamples.length > 0 && (
          <StyleExampleCards
            examples={styleExamples}
            onApply={applyExample}
            disabled={loading}
            variant="dark"
            appliedLabel={exampleNote}
          />
        )}

        <div className="mt-5">
          <StyleTonePicker value={mode} onChange={setMode} disabled={loading} variant="dark" />
        </div>

        {kind === 'post' && (
          <div className="mt-5">
            <StyleFormatPicker
              value={format}
              onChange={setFormat}
              disabled={loading}
              variant="dark"
            />
          </div>
        )}

        <div className={`mt-5 grid gap-3 ${kind === 'post' ? 'sm:grid-cols-2' : ''}`}>
          {kind === 'post' && (
            <StyleSignatureToggle
              checked={signature}
              onChange={setSignature}
              disabled={loading}
              variant="dark"
            />
          )}
          <StyleEnginePicker
            value={llm}
            onChange={setLlm}
            disabled={loading}
            variant="dark"
            hint={kind === 'thread' ? threadCopy.localHint : undefined}
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <Button variant="primary" onClick={() => void submit()} disabled={disabled} loading={loading}>
            {loading ? busyLabel : submitLabel}
          </Button>
          {!loading && text.trim().length === 0 && (
            <span className="text-sm text-dim">{styleCopy.emptyHint}</span>
          )}
        </div>
      </Card>

      {/* Единая live-область результата: loading / посты / ошибка. */}
      <div ref={resultRef} role="status" aria-live="polite" tabIndex={-1} className="focus:outline-none">
        {loading && (
          <Card label="результат">
            <p className="flex items-center gap-3 text-sm text-dim">
              <span
                aria-hidden="true"
                className="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-accent border-t-transparent"
              />
              {busyLabel}
            </p>
          </Card>
        )}

        {status === 'done' && kind === 'post' && post !== null && (
          <Card
            label={styleCopy.resultTitle}
            actions={
              <Button size="sm" variant="ghost" onClick={() => void copyPost(post)}>
                {copied ? styleCopy.copied : styleCopy.copy}
              </Button>
            }
          >
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{post}</p>
          </Card>
        )}

        {status === 'done' && kind === 'thread' && posts !== null && (
          <section>
            <div className="flex items-center justify-between gap-3">
              <SectionLabel>{`${threadCopy.resultTitle} · ${posts.length}`}</SectionLabel>
              <Button size="sm" variant="ghost" onClick={() => void copyAllPosts()}>
                {copiedAll ? styleCopy.copied : threadCopy.copyAll}
              </Button>
            </div>
            <div className="mt-2 flex flex-col gap-3">
              {posts.map((p, i) => (
                <Card
                  key={`${i}-${p.slice(0, 24)}`}
                  label={`пост ${i + 1}`}
                  actions={
                    <Button size="sm" variant="ghost" onClick={() => void copyThreadPost(p, i)}>
                      {copiedPost === i ? styleCopy.copied : styleCopy.copy}
                    </Button>
                  }
                >
                  <div className="mb-1 text-right font-mono text-[11px] text-dim">
                    {p.length} / {TG_POST_LIMIT}
                  </div>
                  <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{p}</p>
                </Card>
              ))}
            </div>
          </section>
        )}

        {status === 'error' && error !== null && (
          <Card tone="danger" label="ошибка">
            <p className="text-sm leading-relaxed text-err">{error}</p>
          </Card>
        )}
      </div>

      {kind === 'post' && history.length > 0 && (
        <Card label="история (последние 10)">
          <ul className="flex flex-col gap-2">
            {history.map((it) => (
              <li
                key={it.ts}
                className="flex items-start justify-between gap-3 rounded-lg border border-line px-3 py-2"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left transition-colors duration-fast hover:text-ink"
                  onClick={() => restore(it)}
                  title="Открыть в студии"
                >
                  <span className="block truncate text-sm text-ink">
                    {it.post.split('\n')[0] || it.text.slice(0, 80)}
                  </span>
                  <span className="mt-0.5 block font-mono text-[11px] text-dim">
                    {new Date(it.ts).toLocaleString('ru-RU')} · {it.text.length} зн. ·{' '}
                    {styleToneLabel(it.mode)} · {styleFormatLabel(it.format)}
                  </span>
                </button>
                <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(it.post)}>
                  {styleCopy.copy}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => dropItem(it.ts)} aria-label="Удалить из истории">
                  ✕
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

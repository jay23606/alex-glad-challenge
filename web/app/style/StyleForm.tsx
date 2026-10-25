// /style — client-остров «Антоновайзера» (единственный client-компонент
// страницы; паттерн DemoRagForm, светлый мир .lp). Продуктовый порядок:
// текст → готовые истории (подставляют текст + тон + формат) → тон → формат →
// подпись/движок → POST /api/style/rewrite по контракту:
// 200 {ok,post} | 400/429/502/503 {ok:false,error,retryAfterSec?}.
// Abort: размонтирование, новый запрос, клиентский таймаут 150с (LLM-провайдер
// сам режет генерацию на 120-й). Результат — plain text + кнопка «Скопировать».
// Импорты — только data/* и общие controls (инвариант: client не тянет lib/server).
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  styleCopy,
  styleFormatLabel,
  styleToneLabel,
  type StyleExample,
  type StyleFormat,
  type StyleLlm,
  type StyleTone,
} from '../../data/style';
import {
  StyleEnginePicker,
  StyleExampleCards,
  StyleFormatPicker,
  StyleSignatureToggle,
  StyleTonePicker,
} from '../components/style/StyleControls';
import { useModelPrefDefault } from '../../lib/shared/use-model-pref';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-paper';

const TEXTAREA =
  'w-full resize-y rounded-xl border border-p-line bg-paper-2 p-3 text-[15px] leading-relaxed text-p-ink placeholder:text-p-dim/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-paper';

const MAX_TEXT = 2000; // контракт формы (zod на сервере вторым слоем)
// Локальная Ollama на слабом CPU генерирует дольше облака — таймаут подвижный.
const TIMEOUT_CLOUD_MS = 150_000;
const TIMEOUT_LOCAL_MS = 300_000;

type Status = 'idle' | 'loading' | 'done' | 'error';

interface RewriteResponse {
  ok: boolean;
  post?: string;
  provider?: StyleLlm;
  error?: string;
  retryAfterSec?: number;
}

interface ResultMeta {
  tone: StyleTone;
  format: StyleFormat;
}

export function StyleForm({ examples }: { examples?: readonly StyleExample[] }) {
  const [text, setText] = useState('');
  const [tone, setTone] = useState<StyleTone>('normal');
  const [format, setFormat] = useState<StyleFormat>('auto');
  const [signature, setSignature] = useState(false);
  const [llm, setLlm] = useState<StyleLlm>('cloud');
  const [status, setStatus] = useState<Status>('idle');
  const [post, setPost] = useState<string | null>(null);
  const [resultMeta, setResultMeta] = useState<ResultMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [exampleNote, setExampleNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  // Предпочтение движка из настроек (cookie model_pref) — best-effort, до выбора юзера.
  useModelPrefDefault(setLlm);

  // Размонтирование — снять висящий запрос.
  useEffect(() => () => abortRef.current?.abort(), []);

  const applyExample = useCallback((example: StyleExample) => {
    setText(example.text);
    setTone(example.tone);
    setFormat(example.format);
    setSignature(example.signature);
    setExampleNote(
      `История «${example.title}»: тон «${styleToneLabel(example.tone)}», формат «${styleFormatLabel(example.format)}». Можно править.`,
    );
    setStatus('idle');
    setPost(null);
    setResultMeta(null);
    setError(null);
    setCopied(false);
    requestAnimationFrame(() => {
      textRef.current?.focus();
      textRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, []);

  const submit = useCallback(async () => {
    const t = text.trim();
    if (t.length === 0 || t.length > MAX_TEXT) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const timer = setTimeout(() => ac.abort(), llm === 'local' ? TIMEOUT_LOCAL_MS : TIMEOUT_CLOUD_MS);

    setStatus('loading');
    setPost(null);
    setResultMeta(null);
    setError(null);
    setCopied(false);
    try {
      const r = await fetch('/api/style/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t, mode: tone, format, signature, llm }),
        signal: ac.signal,
      });
      const data = (await r.json().catch(() => null)) as RewriteResponse | null;
      if (data !== null && data.ok && typeof data.post === 'string') {
        setPost(data.post);
        setResultMeta({ tone, format });
        setStatus('done');
        requestAnimationFrame(() => resultRef.current?.focus());
      } else {
        let base: string;
        if (data?.error != null) base = data.error;
        else if (r.status === 502) base = styleCopy.errorBaseUnavailable;
        else base = `Ошибка ${r.status}`;
        const retryMin =
          data && !data.ok && typeof data.retryAfterSec === 'number'
            ? Math.max(1, Math.ceil(data.retryAfterSec / 60))
            : null;
        setStatus('error');
        setError(
          retryMin !== null && !base.includes('мин') ? `${base} Повторите через ~${retryMin} мин.` : base,
        );
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
  }, [text, tone, format, signature, llm]);

  const copy = useCallback(async () => {
    if (post === null) return;
    try {
      await navigator.clipboard.writeText(post);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API может быть запрещён (http, разрешения) — молча остаёмся.
    }
  }, [post]);

  const loading = status === 'loading';
  const disabled = loading || text.trim().length === 0 || text.trim().length > MAX_TEXT;

  return (
    <div className="lp-card relative overflow-hidden p-5 md:p-8">
      <div className="lp-blob lp-blob-indigo -right-10 -top-10 h-40 w-40" aria-hidden="true" />

      <div className="relative">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <label
            htmlFor="style-text"
            className="block font-mono text-xs uppercase tracking-[0.18em] text-p-dim"
          >
            {styleCopy.textLabel}
          </label>
          <span className="font-mono text-xs text-p-dim">
            {text.length} / {MAX_TEXT}
          </span>
        </div>
        <textarea
          id="style-text"
          ref={textRef}
          className={`mt-3 h-36 ${TEXTAREA}`}
          value={text}
          maxLength={MAX_TEXT}
          onChange={(e) => {
            setText(e.target.value);
            setExampleNote(null);
          }}
          placeholder={styleCopy.textPlaceholder}
          disabled={loading}
        />

        {/* Готовые истории: подставляют текст, тон и формат — продукт объясняется сам. */}
        {examples && examples.length > 0 && (
          <StyleExampleCards
            examples={examples}
            onApply={applyExample}
            disabled={loading}
            variant="light"
            appliedLabel={exampleNote}
          />
        )}

        <div className="mt-6">
          <StyleTonePicker value={tone} onChange={setTone} disabled={loading} variant="light" />
        </div>

        <div className="mt-6">
          <StyleFormatPicker value={format} onChange={setFormat} disabled={loading} variant="light" />
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <StyleSignatureToggle
            checked={signature}
            onChange={setSignature}
            disabled={loading}
            variant="light"
          />
          <StyleEnginePicker
            value={llm}
            onChange={setLlm}
            disabled={loading}
            variant="light"
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            type="button"
            className={`inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-brand-600 px-7 text-base font-bold text-white shadow-lift transition-all duration-base ease-system hover:-translate-y-0.5 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${FOCUS}`}
            onClick={() => void submit()}
            disabled={disabled}
          >
            {loading && (
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
              />
            )}
            {loading ? styleCopy.rewriting : styleCopy.rewrite}
          </button>
          {!loading && text.trim().length === 0 && (
            <span className="text-sm text-p-dim">{styleCopy.emptyHint}</span>
          )}
        </div>

        {/* Единая live-область результата: loading / пост / ошибка. */}
        <div
          ref={resultRef}
          role="status"
          aria-live="polite"
          tabIndex={-1}
          className="mt-6 focus:outline-none"
        >
          {loading && (
            <p className="flex items-center gap-3 text-sm text-p-dim">
              <span
                aria-hidden="true"
                className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand-300 border-t-brand-600"
              />
              {styleCopy.rewriting}
            </p>
          )}

          {status === 'done' && post !== null && resultMeta !== null && (
            <section aria-label={styleCopy.resultTitle} className="rounded-xl border border-p-line bg-paper-2 p-4 md:p-5">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div>
                  <h3 className="font-display text-lg font-semibold text-p-ink">
                    {styleCopy.resultTitle}
                  </h3>
                  <p className="mt-1 font-mono text-[11px] text-p-dim">
                    {`${styleCopy.resultTone} «${styleToneLabel(resultMeta.tone)}» · ${styleCopy.resultFormat} «${styleFormatLabel(resultMeta.format)}»`}
                  </p>
                </div>
                <button
                  type="button"
                  className={`lp-chip transition-colors duration-fast hover:border-brand-300 hover:text-brand-600 ${FOCUS}`}
                  onClick={() => void copy()}
                >
                  {copied ? styleCopy.copied : styleCopy.copy}
                </button>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-p-ink md:text-base">
                {post}
              </p>
            </section>
          )}

          {status === 'error' && error !== null && (
            <p className="rounded-xl border border-err/40 bg-err/10 p-4 text-sm leading-relaxed text-err">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

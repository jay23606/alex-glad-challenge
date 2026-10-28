// TgComposer (ТЗ §7.1): состояния form → confirming (Dialog) → sending → done|error.
// Панель разметки (B/I/U/S/code/link оборачивают выделение или вставляют пару в
// курсор), счётчик n/4096 (warn ≥3800), табы превью Рендер|HTML, автосохранение
// черновика в localStorage (debounce 500ms), история публикаций (outbox, 20).
// Ошибка Bot API: toast + Card с причиной, текст не теряется, «Повторить» /
// «Повторить через Nс» при 429. Клиент импортирует только lib/shared/*.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Textarea } from '../../components/ui/Textarea';
import { Tabs } from '../../components/ui/Tabs';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { TgMessage } from '../../components/ui/TgMessage';
import { useToast } from '../../components/ui/Toast';
import {
  IconChevronDown,
  IconHistory,
  IconSend,
  IconWarning,
} from '../../components/ui/icons';
import { tgVisibleText } from '../../../lib/shared/tg-html';

const MAX = 4096;
const WARN_AT = 3800;
const DRAFT_KEY = 'tg-compose-draft';
const HISTORY_LIMIT = 20;

interface HistoryItem {
  id: number;
  text: string;
  source: 'manual' | 'blog' | 'summary';
  blog_post_id: number | null;
  message_id: number | null;
  status: 'ok' | 'error';
  error: string | null;
  created_at: string;
}

interface LastError {
  message: string;
  kind?: string;
  retryAfter?: number;
}

const SOURCE_TONE: Record<HistoryItem['source'], 'accent' | 'dim' | 'warn'> = {
  manual: 'accent',
  blog: 'dim',
  summary: 'warn',
};

// Панель-помощник: обёртка выделения или вставка пары тегов в курсор.
const WRAPPERS: Array<{ label: string; open: string; close: string; title: string }> = [
  { label: 'B', open: '<b>', close: '</b>', title: 'Жирный' },
  { label: 'I', open: '<i>', close: '</i>', title: 'Курсив' },
  { label: 'U', open: '<u>', close: '</u>', title: 'Подчёркнутый' },
  { label: 'S', open: '<s>', close: '</s>', title: 'Зачёркнутый' },
  { label: 'code', open: '<code>', close: '</code>', title: 'Моноширинный' },
];

export function TgComposer({
  tgConfigured,
  channelLabel,
}: {
  tgConfigured: boolean;
  channelLabel: string | null;
}) {
  const { toast } = useToast();
  const taRef = useRef<HTMLTextAreaElement>(null);

  const [text, setText] = useState('');
  const [tab, setTab] = useState<'render' | 'html'>('render');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [lastError, setLastError] = useState<LastError | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const over = text.length > MAX;
  const canPublish = tgConfigured && text.trim().length > 0 && !over && !sending;

  // Черновик: восстановление при открытии + автосохранение (debounce 500ms).
  useEffect(() => {
    try {
      const d = localStorage.getItem(DRAFT_KEY);
      if (d) setText(d);
    } catch {
      /* приватный режим — без черновика */
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (text) localStorage.setItem(DRAFT_KEY, text);
        else localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* noop */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [text]);

  // Обратный отсчёт для 429 (Bot API retry_after).
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const r = await fetch(`/api/telegram/history?limit=${HISTORY_LIMIT}`);
      const j = (await r.json().catch(() => ({}))) as { items?: HistoryItem[] };
      setHistory(j.items ?? []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // --- разметка-помощник -------------------------------------------------
  const surround = (open: string, close: string): void => {
    const el = taRef.current;
    if (!el) return;
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const sel = text.slice(start, end);
    const next = text.slice(0, start) + open + sel + close + text.slice(end);
    setText(next);
    const selStart = start + open.length;
    const selEnd = sel ? selStart + sel.length : selStart;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  };

  const insertLink = (): void => {
    const el = taRef.current;
    if (!el) return;
    const at = el.selectionStart ?? text.length;
    const snippet = '<a href="url">текст</a>';
    const next = text.slice(0, at) + snippet + text.slice(el.selectionEnd ?? at);
    setText(next);
    const hrefStart = at + '<a href="'.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(hrefStart, hrefStart + 'url'.length);
    });
  };

  // --- отправка -----------------------------------------------------------
  const doSend = async (): Promise<void> => {
    setSending(true);
    try {
      const resp = await fetch('/api/telegram/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), parseMode: 'HTML' }),
      });
      const j = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        messageId?: number;
        error?: string;
        errorKind?: string;
        retryAfter?: number;
      };
      if (!resp.ok || !j.ok) {
        setLastError({
          message: j.error ?? `HTTP ${resp.status}`,
          kind: j.errorKind,
          retryAfter: j.retryAfter,
        });
        if (j.retryAfter !== undefined) setCooldown(j.retryAfter);
        toast('err', j.error ?? 'Ошибка отправки');
      } else {
        toast('ok', `Опубликовано (message_id=${j.messageId ?? '?'})`);
        setLastError(null);
        setText('');
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch {
          /* noop */
        }
        void loadHistory();
        requestAnimationFrame(() => taRef.current?.focus());
      }
    } catch {
      setLastError({ message: 'Telegram недоступен (сеть). Текст сохранён — повторите', kind: 'network' });
      toast('err', 'Ошибка сети — текст сохранён');
    } finally {
      setSending(false);
    }
  };

  // Confirm-превью: composer всегда шлёт parseMode 'HTML' — литеральные
  // уголки в черновике не вырезаются, а остаются видимым текстом.
  const previewPlain = tgVisibleText(text).split('\n');
  const confirmPreview = previewPlain.slice(0, 6).join('\n');

  return (
    <div className="space-y-6">
      {!tgConfigured && (
        <Card tone="warn">
          <p className="text-sm font-medium text-warn">Telegram не настроен</p>
          <p className="mt-1 text-sm text-warn/80">
            Превью и разметка доступны, отправка выключена. Задайте TG_BOT_TOKEN и TG_CHAT_ID в .env.
          </p>
        </Card>
      )}

      <Card label="компоузер">
        {/* Панель-помощник над полем */}
        <div className="mb-2 flex flex-wrap items-center gap-1" role="toolbar" aria-label="Разметка Telegram-HTML">
          {WRAPPERS.map((w) => (
            <button
              key={w.label}
              type="button"
              title={w.title}
              aria-label={w.title}
              onClick={() => surround(w.open, w.close)}
              className="min-h-8 rounded-sm border border-line-strong px-2 font-mono text-xs text-dim transition-colors duration-fast hover:border-accent-dim hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim"
            >
              {w.label}
            </button>
          ))}
          <button
            type="button"
            title="Ссылка"
            aria-label="Вставить ссылку"
            onClick={insertLink}
            className="min-h-8 rounded-sm border border-line-strong px-2 font-mono text-xs text-dim transition-colors duration-fast hover:border-accent-dim hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim"
          >
            link
          </button>
          <span className="ml-auto font-mono text-[11px] text-dim">parse_mode: HTML</span>
        </div>

        <Field
          id="tg-compose-text"
          label="Текст сообщения"
          hint={
            <>
              Разметка Telegram-HTML: <code className="font-mono">&lt;b&gt; &lt;i&gt; &lt;u&gt; &lt;s&gt; &lt;a href&gt; &lt;code&gt; &lt;pre&gt; &lt;blockquote&gt; &lt;tg-spoiler&gt;</code>
            </>
          }
          error={over ? `Превышен лимит ${MAX} символов — сократите текст` : undefined}
        >
          <Textarea
            value={text}
            onValueChange={setText}
            max={MAX}
            warnAt={WARN_AT}
            rows={7}
            inputRef={taRef}
            disabled={sending}
            placeholder="Текст поста (HTML-разметка разрешена)…"
          />
        </Field>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {cooldown > 0 ? (
            <Button
              variant="primary"
              icon={<IconSend />}
              onClick={() => setConfirmOpen(true)}
              disabled
              title={`Повтор через ${cooldown} с`}
            >
              Повторить через {cooldown}с
            </Button>
          ) : (
            <Button variant="primary" icon={<IconSend />} onClick={() => setConfirmOpen(true)} disabled={!canPublish}>
              Опубликовать
            </Button>
          )}
          {text && (
            <Button variant="ghost" onClick={() => setText('')} disabled={sending}>
              Очистить
            </Button>
          )}
        </div>
      </Card>

      {/* Превью: Рендер (пузырь Telegram) | HTML (исходник) */}
      <Card
        label="превью"
        actions={
          <Tabs
            label="Вид превью"
            tabs={[
              { id: 'render', label: 'Рендер' },
              { id: 'html', label: 'HTML' },
            ]}
            active={tab}
            onChange={(id) => setTab(id as 'render' | 'html')}
          />
        }
      >
        {text.trim() ? (
          tab === 'render' ? (
            <TgMessage html={text} />
          ) : (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-bg p-3 font-mono text-xs leading-relaxed text-dim">
              {text}
            </pre>
          )
        ) : (
          <p className="text-sm text-dim">Введите текст — превью появится здесь.</p>
        )}
      </Card>

      {/* Ошибка последней отправки: причина + Повторить (текст остался в редакторе) */}
      {lastError && (
        <Card tone="danger" label="ошибка отправки">
          <p className="flex items-start gap-2 text-sm text-err">
            <span aria-hidden="true" className="mt-0.5 shrink-0">
              <IconWarning />
            </span>
            <span>{lastError.message}</span>
          </p>
          <div className="mt-3">
            <Button variant="ghost" onClick={() => setLastError(null)}>
              Скрыть
            </Button>
          </div>
        </Card>
      )}

      {/* История публикаций (outbox); якорь #history — цель плитки J3 с /dashboard */}
      <div id="history" className="scroll-mt-20">
      <Card
        label="история публикаций"
        actions={
          <Button variant="ghost" size="sm" icon={<IconHistory />} onClick={() => void loadHistory()} disabled={historyLoading}>
            {historyLoading ? 'загрузка…' : 'обновить'}
          </Button>
        }
      >
        {historyLoading && history.length === 0 ? (
          <div className="space-y-2">
            <Skeleton variant="line" />
            <Skeleton variant="line" />
            <Skeleton variant="line" />
          </div>
        ) : history.length === 0 ? (
          <EmptyState
            icon={<IconHistory />}
            title="Публикаций ещё не было"
            hint="Здесь появятся все отправки в канал: ручные, из блога и сводки — с message_id и статусом."
          />
        ) : (
          <ul className="divide-y divide-line">
            {history.map((h) => {
              const expanded = expandedId === h.id;
              return (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : h.id)}
                    aria-expanded={expanded}
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-2 text-left transition-colors duration-fast hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim"
                  >
                    <span aria-hidden="true" className={`shrink-0 text-dim transition-transform duration-fast ${expanded ? 'rotate-0' : '-rotate-90'}`}>
                      <IconChevronDown />
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-dim">{h.created_at}</span>
                    <Badge tone={SOURCE_TONE[h.source]}>{h.source}</Badge>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {tgVisibleText(h.text).replace(/\s+/g, ' ').trim() || '(пусто)'}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-dim">
                      {h.message_id !== null ? `msg ${h.message_id}` : '—'}
                    </span>
                    {h.status === 'ok' ? <Badge tone="ok">ok</Badge> : <Badge tone="err">error</Badge>}
                  </button>
                  {expanded && (
                    <div className="pb-3">
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-bg p-3 font-mono text-xs leading-relaxed text-dim">
                        {h.text}
                      </pre>
                      {h.error && <p className="mt-2 text-xs text-err">{h.error}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      </div>

      {/* Confirm: цель + свернутое превью + пометка о реальной отправке */}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={doSend}
        title="Отправить в канал?"
        confirmLabel="Опубликовать"
        body={
          <div className="space-y-3">
            <p className="flex items-center gap-2">
              Канал: <Badge tone="accent">{channelLabel ?? 'TG_CHAT_ID'}</Badge>
            </p>
            <p className="rounded-md border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
              Реальная отправка — сообщение уйдёт подписчикам канала.
            </p>
            <div className="rounded-md border border-line bg-bg p-2">
              <pre className="max-h-32 overflow-hidden whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-dim">
                {confirmPreview}
                {previewPlain.length > 6 ? '\n…' : ''}
              </pre>
              <p className="mt-1 text-right font-mono text-[11px] tabular-nums text-dim">
                {text.length} / {MAX} символов
              </p>
            </div>
          </div>
        }
      />
    </div>
  );
}

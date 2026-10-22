// DigestComposer (next-feature-2, П-2): «дайджест одним кликом».
// Фазы idle → generating → preview → published. Сборка: POST /api/blog/digest/generate
// { days } → 200 { ok, digest, newsCount, sources, truncated } | 409 (пустое окно,
// показываем честно) | 502/сеть (toast + карточка ошибки). Публикация — только вручную,
// через СУЩЕСТВУЮЩИЙ POST /api/telegram/publish { text, parseMode: 'none' } после
// ConfirmDialog (реальный внешний эффект). Черновик (текст+источники) автосохраняется
// в localStorage (digest-draft, debounce 500ms), восстанавливается при открытии,
// чистится после публикации. Клиент импортирует только app/components/ui/* —
// никаких core/server.
'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, INPUT_CLASS } from '../../components/ui/Field';
import { Textarea } from '../../components/ui/Textarea';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';
import { IconCheck, IconExternal, IconRss, IconSend, IconWarning } from '../../components/ui/icons';

const MAX = 4096;
const WARN_AT = 3800;
const DRAFT_KEY = 'digest-draft';

interface DigestSource {
  title: string;
  url: string;
}

interface DigestDraft {
  text: string;
  sources: DigestSource[];
  newsCount: number;
  savedAt: string;
}

type Phase = 'idle' | 'generating' | 'preview' | 'published';

interface LastError {
  message: string;
}

// Наружу отдаём только http(s) — протокол-гуард на клиенте (план П-2).
function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

interface BlogOption {
  slug: string;
  name: string;
  hasProfile: boolean;
}

export function DigestComposer({
  tgConfigured,
  channelLabel,
}: {
  tgConfigured: boolean;
  channelLabel: string | null;
}) {
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>('idle');
  const [days, setDays] = useState<7 | 14>(7);
  const [blogs, setBlogs] = useState<BlogOption[]>([]);
  const [blog, setBlog] = useState<string>('');
  const [digest, setDigest] = useState('');
  const [sources, setSources] = useState<DigestSource[]>([]);
  const [newsCount, setNewsCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [emptyWindow, setEmptyWindow] = useState(false);
  const [lastError, setLastError] = useState<LastError | null>(null);
  const [publishedMsgId, setPublishedMsgId] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const over = digest.length > MAX;
  const canPublish = tgConfigured && digest.trim().length > 0 && !over && !sending;
  const generating = phase === 'generating';

  // Черновик: восстановление при монтировании…
  useEffect(() => {
    fetch('/api/blogs')
      .then((r) => r.json())
      .then((j: { blogs?: BlogOption[] }) => setBlogs(j.blogs ?? []))
      .catch(() => setBlogs([]));
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as Partial<DigestDraft>;
      if (typeof d.text === 'string' && d.text.trim()) {
        setDigest(d.text);
        setSources(
          Array.isArray(d.sources)
            ? d.sources.filter((s): s is DigestSource => !!s && typeof s.url === 'string')
            : [],
        );
        setNewsCount(typeof d.newsCount === 'number' ? d.newsCount : 0);
        setPhase('preview');
      }
    } catch {
      /* битый черновик — начинаем с чистого */
    }
  }, []);

  // …и автосохранение (debounce 500ms).
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (digest.trim()) {
          const draft: DigestDraft = {
            text: digest,
            sources,
            newsCount,
            savedAt: new Date().toISOString(),
          };
          localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        } else {
          localStorage.removeItem(DRAFT_KEY);
        }
      } catch {
        /* приватный режим — без черновика */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [digest, sources, newsCount]);

  const generate = async (): Promise<void> => {
    setPhase('generating');
    setEmptyWindow(false);
    setLastError(null);
    setPublishedMsgId(null);
    try {
      const resp = await fetch('/api/blog/digest/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days, ...(blog ? { blog } : {}) }),
      });
      const j = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        digest?: string;
        newsCount?: number;
        sources?: DigestSource[];
        truncated?: boolean;
        error?: string;
      };
      // Пустое окно — честный отказ сервера, LLM не вызывался.
      if (resp.status === 409) {
        setEmptyWindow(true);
        setPhase('idle');
        return;
      }
      if (!resp.ok || !j.ok || typeof j.digest !== 'string') {
        setLastError({ message: j.error ?? `HTTP ${resp.status}` });
        toast('err', j.error ?? 'Не удалось собрать дайджест');
        setPhase(digest.trim() ? 'preview' : 'idle');
        return;
      }
      setDigest(j.digest);
      setSources(Array.isArray(j.sources) ? j.sources : []);
      setNewsCount(typeof j.newsCount === 'number' ? j.newsCount : 0);
      setTruncated(Boolean(j.truncated));
      setPhase('preview');
    } catch {
      setLastError({ message: 'Сеть недоступна — попробуйте ещё раз' });
      toast('err', 'Ошибка сети при сборке дайджеста');
      setPhase(digest.trim() ? 'preview' : 'idle');
    }
  };

  // Отправка: ConfirmDialog подтверждён → существующий publish-роут (plain text).
  // Ошибка не стирает текст — правишь и повторяешь.
  const doSend = async (): Promise<void> => {
    setSending(true);
    try {
      const resp = await fetch('/api/telegram/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: digest.trim(), parseMode: 'none' }),
      });
      const j = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        messageId?: number;
        error?: string;
      };
      if (!resp.ok || !j.ok) {
        setLastError({ message: j.error ?? `HTTP ${resp.status}` });
        toast('err', j.error ?? 'Ошибка отправки — текст сохранён');
      } else {
        toast('ok', `Опубликовано (message_id=${j.messageId ?? '?'})`);
        setLastError(null);
        setPublishedMsgId(j.messageId ?? null);
        setDigest('');
        setSources([]);
        setNewsCount(0);
        setTruncated(false);
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch {
          /* noop */
        }
        setPhase('published');
      }
    } catch {
      setLastError({ message: 'Telegram недоступен (сеть). Текст сохранён — повторите' });
      toast('err', 'Ошибка сети — текст сохранён');
    } finally {
      setSending(false);
    }
  };

  const digestLines = digest.split('\n');
  const confirmPreview = digestLines.slice(0, 6).join('\n');

  return (
    <div className="space-y-6">
      {!tgConfigured && (
        <Card tone="warn">
          <p className="text-sm font-medium text-warn">Telegram не настроен</p>
          <p className="mt-1 text-sm text-warn/80">
            Сборка и редактирование доступны, отправка выключена. Задайте TG_BOT_TOKEN и TG_CHAT_ID в .env.
          </p>
        </Card>
      )}

      <Card label="сборка">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-xs font-medium text-dim">Блог</span>
            <select
              className={`mt-1 min-w-48 ${INPUT_CLASS}`}
              value={blog}
              onChange={(e) => setBlog(e.target.value)}
              disabled={generating}
            >
              {blogs.map((b) => (
                <option key={b.slug} value={b.slug}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium text-dim">Окно</span>
            <select
              className={`mt-1 ${INPUT_CLASS}`}
              value={days}
              onChange={(e) => setDays(Number(e.target.value) as 7 | 14)}
              disabled={generating}
            >
              <option value={7}>7 дней</option>
              <option value={14}>14 дней</option>
            </select>
          </label>
          <Button
            variant="primary"
            icon={<IconRss />}
            loading={generating}
            onClick={() => void generate()}
            disabled={generating || (blog !== '' && !blogs.find((b) => b.slug === blog)?.hasProfile)}
          >
            Собрать дайджест
          </Button>
          {generating && (
            <p className="w-full text-xs leading-relaxed text-dim" role="status">
              LLM пишет дайджест — обычно 30–120 с…
            </p>
          )}
        </div>

        {generating && (
          <div className="mt-4 space-y-2">
            <Skeleton variant="line" />
            <Skeleton variant="line" />
            <Skeleton variant="line" />
          </div>
        )}

        {emptyWindow && !generating && (
          <div className="mt-4">
            <EmptyState
              icon={<IconRss />}
              title="Новостей нет — расширьте окно"
              hint={`За последние ${days} дн. новостей не нашлось. Выберите окно 14 дней или сначала соберите новости в /blog/news.`}
            />
          </div>
        )}
      </Card>

      {phase === 'published' && (
        <Card>
          <p className="flex items-center gap-2 text-sm text-ok">
            <span aria-hidden="true" className="shrink-0">
              <IconCheck />
            </span>
            <span>
              Дайджест опубликован{publishedMsgId !== null ? ` (message_id=${publishedMsgId})` : ''}.
            </span>
          </p>
          <p className="mt-1 text-xs text-dim">История отправок — в /telegram/publish. Можно собирать следующий.</p>
        </Card>
      )}

      {lastError && (
        <Card tone="danger" label="ошибка">
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

      {digest.trim() && (
        <>
          <Card
            label="превью"
            actions={
              truncated ? <Badge tone="warn">обрезано до 4096</Badge> : <Badge tone="dim">черновик</Badge>
            }
          >
            <Field
              id="digest-text"
              label="Текст дайджеста"
              error={over ? `Превышен лимит ${MAX} символов — сократите текст` : undefined}
            >
              <Textarea
                value={digest}
                onValueChange={setDigest}
                max={MAX}
                warnAt={WARN_AT}
                rows={10}
                disabled={sending}
                placeholder="Текст дайджеста…"
              />
            </Field>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                icon={<IconSend />}
                onClick={() => setConfirmOpen(true)}
                disabled={!canPublish}
              >
                Отправить в TG
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setDigest('');
                  setSources([]);
                  setNewsCount(0);
                  setTruncated(false);
                  setPhase('idle');
                }}
                disabled={sending}
              >
                Очистить
              </Button>
              {!tgConfigured && <span className="text-xs text-warn">отправка выключена — TG не настроен</span>}
            </div>
          </Card>

          <Card label="источники" actions={<Badge tone="dim">{newsCount} шт.</Badge>}>
            <p className="mb-2 text-xs text-dim">
              Сверьте факты перед отправкой — каждый пункт дайджеста должен трассироваться в новость.
            </p>
            {sources.length === 0 ? (
              <p className="text-sm text-dim">Список пуст.</p>
            ) : (
              <ul className="divide-y divide-line">
                {sources.map((s, i) => {
                  const href = safeHref(s.url);
                  return (
                    <li key={`${i}-${s.url}`} className="py-2 text-sm">
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-start gap-1.5 text-ink transition-colors duration-fast hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim"
                        >
                          <span aria-hidden="true" className="mt-0.5 shrink-0 text-dim">
                            <IconExternal />
                          </span>
                          <span className="min-w-0 break-words">{s.title || s.url}</span>
                        </a>
                      ) : (
                        <span className="break-words text-dim">{s.title || s.url}</span>
                      )}
                      {href && <span className="ml-2 font-mono text-[11px] text-dim">{domainOf(s.url)}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}

      {/* Confirm: канал + предупреждение о реальной отправке + свернутое превью */}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={doSend}
        title="Отправить дайджест в канал?"
        confirmLabel="Опубликовать"
        body={
          <div className="space-y-3">
            <p className="flex items-center gap-2">
              Канал: <Badge tone="accent">{channelLabel ?? 'TG_CHAT_ID'}</Badge>
            </p>
            <p className="rounded-md border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
              Реальная отправка — пост уйдёт подписчикам.
            </p>
            <div className="rounded-md border border-line bg-bg p-2">
              <pre className="max-h-32 overflow-hidden whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-dim">
                {confirmPreview}
                {digestLines.length > 6 ? '\n…' : ''}
              </pre>
              <p className="mt-1 text-right font-mono text-[11px] tabular-nums text-dim">
                {digest.length} / {MAX} символов
              </p>
            </div>
          </div>
        }
      />
    </div>
  );
}

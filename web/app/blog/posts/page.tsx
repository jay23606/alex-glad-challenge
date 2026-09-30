// /blog/posts — список постов (ТЗ §8.4): таблица на desktop, карточки на mobile.
// Колонки: # · превью · блог · verdict · created · статус TG (join outbox) · действия
// (открыть / удалить через ConfirmDialog — инлайн-publish из списка сознательно
// не делается, опасные кнопки только в карточке поста). Фильтр по блогу
// (?blog=slug, мульти-блог). Пустое состояние — EmptyState с путём создания
// постов. 'use client'. НИКАКИХ импортов core/.
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SectionHead } from '../../components/ui/SectionHead';
import { Button } from '../../components/ui/Button';
import { Badge, statusBadge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Tooltip } from '../../components/ui/Tooltip';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';
import { IconChevronRight, IconExternal, IconTrash } from '../../components/ui/icons';
import { INPUT_CLASS } from '../../components/ui/Field';

interface BlogOption {
  slug: string;
  name: string;
}

interface PostItem {
  id: number;
  news_id: number | null;
  content: string;
  verdict: string | null;
  created_at: string;
  blog: { id: number; slug: string; name: string } | null;
  tg: {
    status: 'ok' | 'error';
    messageId: number | null;
    createdAt: string;
    error: string | null;
  } | null;
}

function snippet(s: string, n = 140): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function verdictLabel(v: string | null): { text: string; tone: 'ok' | 'warn' | 'err' | 'dim' } | null {
  if (!v) return null;
  try {
    const parsed = JSON.parse(v) as { verdict?: string };
    const verdict = parsed.verdict;
    if (verdict === 'ok') return { text: 'ok', tone: 'ok' };
    if (verdict === 'revise') return { text: 'revise', tone: 'warn' };
    if (verdict === 'reject') return { text: 'reject', tone: 'err' };
    return { text: verdict ?? '?', tone: 'dim' };
  } catch {
    return { text: '?', tone: 'dim' };
  }
}

// Шапка таблицы: sans medium (данные в ячейках остаются mono)
const TH = 'px-3 py-2 text-xs font-medium text-dim';

export default function BlogPostsPage() {
  const { toast } = useToast();
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [blogs, setBlogs] = useState<BlogOption[]>([]);
  const [blogFilter, setBlogFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<PostItem | null>(null);

  useEffect(() => {
    fetch('/api/blogs')
      .then((r) => r.json())
      .then((j: { blogs?: BlogOption[] }) => setBlogs(j.blogs ?? []))
      .catch(() => setBlogs([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/blog/posts?limit=50${blogFilter ? `&blog=${encodeURIComponent(blogFilter)}` : ''}`, { method: 'GET' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { posts: PostItem[] };
      setPosts(data.posts ?? []);
    } catch (e) {
      toast('err', e instanceof Error ? e.message : 'Не удалось загрузить посты');
    } finally {
      setLoading(false);
    }
  }, [toast, blogFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const del = useCallback(async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      const resp = await fetch(`/api/blog/posts/${target.id}`, { method: 'DELETE' });
      if (!resp.ok) {
        const j = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${resp.status}`);
      }
      toast('ok', `Пост #${target.id} удалён`);
      void load();
    } catch (e) {
      toast('err', e instanceof Error ? e.message : 'Не удалось удалить');
      throw e;
    }
  }, [deleteTarget, load, toast]);

  return (
    <div className="space-y-6">
      <SectionHead
        code="posts · blog.sqlite"
        title="Посты блога"
        description="Правка и публикация в Telegram — из карточки поста."
        actions={
          <span className="flex items-center gap-2">
            <select
              aria-label="Фильтр по блогу"
              className={`${INPUT_CLASS} h-9 max-w-56 text-sm`}
              value={blogFilter}
              onChange={(e) => setBlogFilter(e.target.value)}
            >
              <option value="">все блоги</option>
              {blogs.map((b) => (
                <option key={b.slug} value={b.slug}>
                  {b.name}
                </option>
              ))}
            </select>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              {loading ? 'загрузка…' : 'обновить'}
            </Button>
          </span>
        }
      />

      {loading && posts.length === 0 ? (
        <div className="space-y-2">
          <Skeleton variant="line" />
          <Skeleton variant="line" />
          <Skeleton variant="line" />
        </div>
      ) : posts.length === 0 ? (
        <EmptyState
          title="Постов пока нет"
          hint="Посты создаются конвейером блог-агентов (/blog/pipeline) или генератором новостей (/blog/news). Затем их можно править и публиковать в Telegram."
          action={
            <Link href="/blog/pipeline">
              <Button variant="primary">Открыть pipeline</Button>
            </Link>
          }
        />
      ) : (
        <>
          {/* Desktop: таблица */}
          <div className="hidden overflow-x-auto rounded-lg border border-line bg-surface shadow-panel sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className={TH}>#</th>
                  <th className={TH}>превью</th>
                  <th className={TH}>блог</th>
                  <th className={TH}>verdict</th>
                  <th className={TH}>created</th>
                  <th className={TH}>telegram</th>
                  <th className={TH}>действия</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => {
                  const v = verdictLabel(p.verdict);
                  return (
                    <tr key={p.id} className="group border-b border-line transition-colors duration-fast last:border-0 hover:bg-surface-2">
                      <td className="px-3 py-2 font-mono text-xs tabular-nums text-dim">
                        <Link href={`/blog/posts/${p.id}`} className="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim">
                          #{p.id}
                        </Link>
                      </td>
                      <td className="max-w-0 px-3 py-2">
                        <Link href={`/blog/posts/${p.id}`} className="flex items-center gap-1.5 text-ink transition-colors duration-fast hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim">
                          <span className="min-w-0 flex-1 truncate">{snippet(p.content)}</span>
                          {/* Аффорданс строки-ссылки: «увидел стрелку — можно нажать» */}
                          <IconChevronRight className="h-3.5 w-3.5 shrink-0 text-accent transition-transform duration-fast group-hover:translate-x-0.5" />
                        </Link>
                      </td>
                      <td className="max-w-32 px-3 py-2">
                        {p.blog ? (
                          <Badge tone="dim">{p.blog.name}</Badge>
                        ) : (
                          <span className="text-dim">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{v ? <Badge tone={v.tone}>{v.text}</Badge> : <span className="text-dim">—</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums text-dim">{p.created_at}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {p.tg ? (
                          <span className="inline-flex items-center gap-1.5" title={p.tg.error ?? undefined}>
                            {statusBadge(p.tg.status === 'ok' ? 'published' : 'error')}
                            {p.tg.messageId !== null && (
                              <span className="font-mono text-[11px] tabular-nums text-dim">msg {p.tg.messageId}</span>
                            )}
                          </span>
                        ) : (
                          statusBadge('draft')
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <div className="flex items-center gap-1">
                          <Tooltip label="Открыть пост">
                            <Link
                              href={`/blog/posts/${p.id}`}
                              aria-label={`Открыть пост #${p.id}`}
                              className="inline-flex h-8 w-8 max-md:h-10 max-md:w-10 items-center justify-center rounded-md border border-line-strong font-medium text-dim transition-colors duration-fast hover:border-accent-dim hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                            >
                              <IconExternal />
                            </Link>
                          </Tooltip>
                          <Tooltip label="Удалить">
                            <Button variant="danger" size="sm" square aria-label={`Удалить пост #${p.id}`} onClick={() => setDeleteTarget(p)}>
                              <IconTrash />
                            </Button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: карточки */}
          <div className="space-y-3 sm:hidden">
            {posts.map((p) => {
              const v = verdictLabel(p.verdict);
              return (
                <div key={p.id} className="rounded-lg border border-line bg-surface p-3 shadow-panel">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/blog/posts/${p.id}`} className="font-mono text-xs tabular-nums text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim">
                      #{p.id}
                    </Link>
                    <span className="flex items-center gap-1.5">{v ? <Badge tone={v.tone}>{v.text}</Badge> : null}
                      {p.tg ? statusBadge(p.tg.status === 'ok' ? 'published' : 'error') : statusBadge('draft')}
                    </span>
                  </div>
                  {p.blog && <p className="mt-1 text-xs text-dim">{p.blog.name}</p>}
                  <Link href={`/blog/posts/${p.id}`} className="mt-2 flex items-start gap-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim">
                    <span className="min-w-0 flex-1">{snippet(p.content, 180)}</span>
                    <IconChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                  </Link>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] tabular-nums text-dim">
                      {p.created_at}
                      {p.tg?.messageId !== null && p.tg ? ` · msg ${p.tg.messageId}` : ''}
                    </span>
                    <Button variant="danger" size="sm" icon={<IconTrash />} onClick={() => setDeleteTarget(p)}>
                      Удалить
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={del}
        title={deleteTarget ? `Удалить пост #${deleteTarget.id}?` : 'Удалить пост?'}
        confirmLabel="Удалить безвозвратно"
        tone="danger"
        body={<p>Пост будет удалён из blog.sqlite вместе с содержимым. Действие безвозвратно.</p>}
      />
    </div>
  );
}

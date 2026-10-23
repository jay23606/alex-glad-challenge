// /automation — правила автоматизации блогов + ручной запуск + история.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { SectionHead } from '../components/ui/SectionHead';
import { EmptyState } from '../components/ui/EmptyState';

interface Rule {
  blogId: number;
  blogSlug: string | null;
  blogName: string;
  stylePreset: 'default' | 'antonov';
  enabled: boolean;
  intervalMinutes: number;
  autoPublish: boolean;
  nextRunAt: string | null;
}
interface Run {
  id: number;
  blogId: number;
  status: string;
  message: string;
  startedAt: string;
}

export default function AutomationPage() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/automation');
    if (!r.ok) return setError('не удалось загрузить');
    const data = (await r.json()) as { rules: Rule[]; runs: Run[] };
    setRules(data.rules);
    setRuns(data.runs);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const configure = async (blogId: number, patch: Partial<Pick<Rule, 'enabled' | 'intervalMinutes' | 'autoPublish'>>) => {
    await fetch('/api/automation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'configure', blogId, ...patch }),
    });
    void load();
  };

  const runNow = async (blogId: number) => {
    setError(null);
    const r = await fetch('/api/automation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'run', blogId }),
    });
    const data = (await r.json()) as { status?: string; message?: string; error?: string };
    if (!r.ok || data.error) setError(data.error ?? 'ошибка запуска');
    void load();
  };

  const setPreset = async (slug: string, stylePreset: Rule['stylePreset']) => {
    setError(null);
    const r = await fetch(`/api/blogs/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stylePreset }),
    });
    if (!r.ok) {
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? 'не удалось сменить пресет');
    }
    void load();
  };

  return (
    <div className="space-y-6">
      <SectionHead code="product · automation" title="Автоматизация блогов" description="Расписание генерации и публикации постов по каждому блогу. Стиль задаётся пресетом блога ниже; пресет Антонова — один из вариантов." />
      {error ? <p className="text-sm text-err">{error}</p> : null}

      {rules == null ? null : rules.length === 0 ? (
        <EmptyState title="Правил нет" hint="Включите автоматизацию для блога ниже." />
      ) : (
        <Card label="Правила">
          <ul className="space-y-3">
            {rules.map((r) => (
              <li key={r.blogId} className="rounded-xl border border-line bg-surface p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">{r.blogName}</p>
                    <p className="text-xs text-dim">
                      {r.enabled ? `каждые ${r.intervalMinutes} мин` : 'выключено'}
                      {r.nextRunAt && r.enabled ? ` · следующий запуск ${r.nextRunAt.slice(0, 16).replace('T', ' ')}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs text-dim">
                      <input type="checkbox" checked={r.enabled} onChange={(e) => configure(r.blogId, { enabled: e.target.checked })} className="accent-accent" />
                      вкл
                    </label>
                    <label className="flex items-center gap-1 text-xs text-dim">
                      <input type="checkbox" checked={r.autoPublish} onChange={(e) => configure(r.blogId, { autoPublish: e.target.checked })} className="accent-accent" />
                      автопубликация
                    </label>
                    <Button variant="primary" onClick={() => runNow(r.blogId)}>Запустить</Button>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-dim">
                  интервал:
                  <select
                    value={r.intervalMinutes}
                    onChange={(e) => configure(r.blogId, { intervalMinutes: Number(e.target.value) })}
                    className="rounded border border-line bg-surface-2 px-2 py-1 text-ink"
                  >
                    {[5, 30, 60, 180, 360, 720, 1440].map((m) => (
                      <option key={m} value={m}>{m} мин</option>
                    ))}
                  </select>
                  {r.blogSlug ? (
                    <>
                      пресет стиля:
                      <select
                        aria-label="Пресет стиля"
                        value={r.stylePreset}
                        onChange={(e) => setPreset(r.blogSlug as string, e.target.value as Rule['stylePreset'])}
                        className="rounded border border-line bg-surface-2 px-2 py-1 text-ink"
                      >
                        <option value="default">по умолчанию</option>
                        <option value="antonov">Антонов</option>
                      </select>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card label="Последние запуски">
        {runs.length === 0 ? (
          <p className="text-sm text-dim">Запусков ещё не было.</p>
        ) : (
          <ul className="space-y-1">
            {runs.slice(0, 20).map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-sm">
                <span className={`h-2 w-2 rounded-full ${r.status === 'success' ? 'bg-ok' : r.status === 'error' ? 'bg-err' : 'bg-dim'}`} />
                <span className="text-dim">#{r.blogId}</span>
                <span className="truncate text-ink">{r.message}</span>
                <span className="ml-auto text-xs text-dim">{r.startedAt.slice(0, 16).replace('T', ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

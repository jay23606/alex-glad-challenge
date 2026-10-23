// /projects — проекты и элементы (workspace). Создание проекта/элемента, toggle задачи.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { SectionHead } from '../components/ui/SectionHead';
import { EmptyState } from '../components/ui/EmptyState';
import { INPUT_CLASS } from '../components/ui/Field';

interface Project {
  id: number;
  name: string;
  description: string;
  color: string;
  status: string;
}
interface Item {
  id: number;
  projectId: number;
  kind: 'note' | 'task' | 'link';
  title: string;
  body: string;
  url: string | null;
  dueAt: string | null;
  done: boolean;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'note' | 'task' | 'link'>('task');
  const [dueAt, setDueAt] = useState('');

  const loadProjects = useCallback(async () => {
    try {
      const r = await fetch('/api/workspace/projects');
      const data = (await r.json()) as { projects: Project[] };
      setProjects(data.projects);
    } catch {
      setError('не удалось загрузить проекты');
    }
  }, []);

  const loadItems = useCallback(async (projectId: number) => {
    try {
      const r = await fetch(`/api/workspace/items?projectId=${projectId}`);
      const data = (await r.json()) as { items: Item[] };
      setItems(data.items);
    } catch {
      setError('не удалось загрузить элементы');
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (active != null) void loadItems(active);
  }, [active, loadItems]);

  const createProject = async () => {
    if (!name.trim()) return;
    const r = await fetch('/api/workspace/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    const data = (await r.json()) as { ok?: boolean; id?: number; error?: string };
    if (!r.ok || !data.id) return setError(data.error ?? 'ошибка');
    setName('');
    await loadProjects();
    setActive(data.id);
  };

  const createItem = async () => {
    if (active == null || !title.trim()) return;
    const r = await fetch('/api/workspace/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: active, title: title.trim(), kind, dueAt: dueAt || null }),
    });
    if (!r.ok) return setError('ошибка создания');
    setTitle('');
    setDueAt('');
    await loadItems(active);
  };

  const toggle = async (item: Item) => {
    await fetch('/api/workspace/items/' + item.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, done: !item.done }),
    });
    if (active != null) await loadItems(active);
  };

  return (
    <div className="space-y-6">
      <SectionHead code="product · workspace" title="Проекты и папки" description="Рабочие проекты: задачи, заметки и ссылки с дедлайнами для календаря." />
      {error ? <p className="text-sm text-err">{error}</p> : null}

      <Card label="Новый проект">
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название проекта" className={INPUT_CLASS} />
          <Button variant="primary" onClick={createProject}>Создать</Button>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => setActive(p.id)}
            className={`rounded-xl border p-4 text-left transition-colors ${
              active === p.id ? 'border-accent bg-surface-2' : 'border-line bg-surface hover:bg-surface-2'
            }`}
          >
            <span className="mb-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
            <p className="font-medium text-ink">{p.name}</p>
            <p className="line-clamp-2 text-xs text-dim">{p.description || '—'}</p>
          </button>
        ))}
      </div>

      {active != null ? (
        <Card label="Элементы">
          <div className="mb-3 flex flex-wrap gap-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Что сделать" className={`flex-1 ${INPUT_CLASS}`} />
            <select value={kind} onChange={(e) => setKind(e.target.value as 'note' | 'task' | 'link')} className={INPUT_CLASS}>
              <option value="task">задача</option>
              <option value="note">заметка</option>
              <option value="link">ссылка</option>
            </select>
            <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={INPUT_CLASS} />
            <Button variant="primary" onClick={createItem}>+</Button>
          </div>
          {items.length === 0 ? (
            <EmptyState title="Элементов пока нет" hint="Добавьте первую задачу или заметку." />
          ) : (
            <ul className="space-y-2">
              {items.map((it) => (
                <li key={it.id} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
                  <input type="checkbox" checked={it.done} onChange={() => toggle(it)} className="h-4 w-4 accent-accent" />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${it.done ? 'text-dim line-through' : 'text-ink'}`}>{it.title}</p>
                    {it.dueAt ? <p className="text-xs text-dim">до {it.dueAt.slice(0, 10)}</p> : null}
                  </div>
                  <span className="text-xs uppercase text-dim">{it.kind}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <EmptyState title="Выберите проект" hint="Или создайте новый выше." />
      )}
    </div>
  );
}

// /integrations — исходящие webhook-подписки на события продукта.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { SectionHead } from '../components/ui/SectionHead';
import { EmptyState } from '../components/ui/EmptyState';
import { INPUT_CLASS } from '../components/ui/Field';

// Форма «Входящие webhooks» — стековый блок (space-y-2): INPUT_CLASS
// блочность/ширину не задаёт, добавляем локально (глобально менять нельзя —
// затронет другие страницы; аналог TICKET_FIELD_CLASS в /support).
const INBOUND_FIELD_CLASS = `block w-full ${INPUT_CLASS}`;

interface Webhook {
  id: number;
  name: string;
  url: string;
  hasSecret: boolean;
  events: string[];
  enabled: boolean;
}

interface InboundHook {
  id: number;
  name: string;
  target: 'notification' | 'todo';
  url: string;
  createdAt: string;
}

const EVENTS = ['post_published', 'todo_completed', 'automation_run', 'notification'] as const;

export default function IntegrationsPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [events, setEvents] = useState<string[]>(['post_published']);
  const [error, setError] = useState<string | null>(null);
  // Входящие хуки (T7)
  const [inbound, setInbound] = useState<InboundHook[]>([]);
  const [inName, setInName] = useState('');
  const [inTarget, setInTarget] = useState<'notification' | 'todo'>('notification');
  const [inError, setInError] = useState<string | null>(null);
  const [inCreated, setInCreated] = useState<{ id: number; secret: string; url: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/integrations/webhooks');
    if (r.ok) setWebhooks(((await r.json()) as { webhooks: Webhook[] }).webhooks);
    const ri = await fetch('/api/integrations/inbound');
    if (ri.ok) setInbound(((await ri.json()) as { hooks: InboundHook[] }).hooks);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleEvent = (e: string) =>
    setEvents((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));

  const create = async () => {
    setError(null);
    const r = await fetch('/api/integrations/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), url: url.trim(), secret: secret || undefined, events }),
    });
    const data = (await r.json()) as { ok?: boolean; error?: string };
    if (!r.ok || data.error) return setError(data.error ?? 'ошибка');
    setName('');
    setUrl('');
    setSecret('');
    setEvents(['post_published']);
    void load();
  };

  const remove = async (id: number) => {
    await fetch(`/api/integrations/webhooks/${id}`, { method: 'DELETE' });
    void load();
  };

  const createInbound = async () => {
    setInError(null);
    setInCreated(null);
    const r = await fetch('/api/integrations/inbound', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: inName.trim(), target: inTarget }),
    });
    const data = (await r.json()) as { ok?: boolean; error?: string; id?: number; secret?: string; url?: string };
    if (!r.ok || data.error) return setInError(data.error ?? 'ошибка');
    setInCreated({ id: data.id ?? 0, secret: data.secret ?? '', url: data.url ?? '' });
    setInName('');
    void load();
  };

  const removeInbound = async (id: number) => {
    await fetch(`/api/integrations/inbound/${id}`, { method: 'DELETE' });
    void load();
  };

  return (
    <div className="space-y-6">
      <SectionHead code="product · integrations" title="Интеграции" description="Исходящие webhook'и с HMAC-подписью на события публикации, задач и автоматизации." />

      <Card label="Новая подписка">
        <div className="space-y-2">
          {/* name+URL — 2 колонки от sm, секрет — полная строка; на узких — стек (inputs инлайновые, без grid сжимаются в одну строку). */}
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название" className={INPUT_CLASS} />
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hook" className={INPUT_CLASS} />
            <input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Секрет подписи (необязательно)" className={`${INPUT_CLASS} sm:col-span-2`} />
          </div>
          <div className="flex flex-wrap gap-2">
            {EVENTS.map((e) => (
              <label key={e} className="flex items-center gap-1 text-xs text-dim">
                <input type="checkbox" checked={events.includes(e)} onChange={() => toggleEvent(e)} className="accent-accent" />
                {e}
              </label>
            ))}
          </div>
          <Button variant="primary" onClick={create}>Добавить</Button>
          {error ? <p className="text-sm text-err">{error}</p> : null}
        </div>
      </Card>

      <Card label="Подписки">
        {webhooks.length === 0 ? (
          <EmptyState title="Подписок нет" hint="Webhook'и получат JSON с полями event и payload и заголовком x-artel-signature." />
        ) : (
          <ul className="space-y-2">
            {webhooks.map((w) => (
              <li key={w.id} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{w.name}</p>
                  <p className="truncate text-xs text-dim">{w.url}</p>
                </div>
                <span className="text-xs text-dim">{w.events.join(', ')}</span>
                <Button variant="danger" onClick={() => remove(w.id)}>удалить</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card label="Входящие webhooks">
        <div className="space-y-2">
          <p className="text-xs text-dim">
            Внешний сервис шлёт POST на URL хука с заголовком x-artel-signature (HMAC-SHA256 тела секретом);
            событие превращается в уведомление или todo.
          </p>
          <input value={inName} onChange={(e) => setInName(e.target.value)} placeholder="Название (например, CI)" className={INBOUND_FIELD_CLASS} />
          <select value={inTarget} onChange={(e) => setInTarget(e.target.value as 'notification' | 'todo')} className={INBOUND_FIELD_CLASS}>
            <option value="notification">уведомление</option>
            <option value="todo">todo</option>
          </select>
          <Button variant="primary" onClick={createInbound}>Создать хук</Button>
          {inError ? <p className="text-sm text-err">{inError}</p> : null}
          {inCreated ? (
            <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs text-dim">
              <p>Секрет показывается один раз — сохраните его:</p>
              <p className="break-all font-mono text-ink">{inCreated.secret}</p>
              <p className="mt-1">URL: <span className="font-mono text-ink">{inCreated.url}</span></p>
            </div>
          ) : null}
        </div>
        {inbound.length === 0 ? (
          <EmptyState title="Входящих хуков нет" hint="Создайте хук — система покажет секрет и URL для внешнего сервиса." />
        ) : (
          <ul className="mt-3 space-y-2">
            {inbound.map((h) => (
              <li key={h.id} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{h.name}</p>
                  <p className="truncate text-xs text-dim">{h.url} → {h.target === 'notification' ? 'уведомление' : 'todo'}</p>
                </div>
                <Button variant="danger" onClick={() => removeInbound(h.id)}>удалить</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

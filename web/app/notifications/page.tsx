// /notifications — центр уведомлений.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { SectionHead } from '../components/ui/SectionHead';
import { EmptyState } from '../components/ui/EmptyState';

interface Notification {
  id: number;
  type: string;
  title: string;
  body: string;
  href: string | null;
  read: boolean;
  createdAt: string;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    const r = await fetch('/api/notifications');
    if (!r.ok) return;
    const data = (await r.json()) as { unread: number; notifications: Notification[] };
    setItems(data.notifications);
    setUnread(data.unread);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const markAll = async () => {
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'markAllRead' }),
    });
    void load();
  };

  return (
    <div className="space-y-6">
      <SectionHead
        code="product · alerts"
        title="Уведомления"
        description="События автоматизации, публикаций и задач."
        actions={unread > 0 ? <Button variant="primary" onClick={markAll}>Прочитать все</Button> : undefined}
      />
      {items == null ? null : items.length === 0 ? (
        <EmptyState title="Уведомлений нет" hint="Здесь появятся события публикаций, автоматизации и дедлайнов." />
      ) : (
        <Card>
          <ul className="space-y-2">
            {items.map((n) => (
              <li key={n.id} className={`rounded-lg border border-line bg-surface px-3 py-2 ${n.read ? 'opacity-60' : ''}`}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-ink">{n.title}</p>
                  <span className="text-xs text-dim">{n.createdAt.slice(0, 16).replace('T', ' ')}</span>
                </div>
                <p className="mt-1 text-sm text-dim">{n.body}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

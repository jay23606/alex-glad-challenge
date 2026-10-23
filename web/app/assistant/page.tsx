// /assistant — ИИ-помощник по продукту (контекст проектов/автоматизации/уведомлений).
'use client';

import { useCallback, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { SectionHead } from '../components/ui/SectionHead';
import { INPUT_CLASS } from '../components/ui/Field';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

export default function AssistantPage() {
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setTurns((prev) => [...prev, { role: 'user', text }]);
    setInput('');
    try {
      const r = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = (await r.json()) as { ok?: boolean; answer?: string; error?: string };
      setTurns((prev) => [
        ...prev,
        { role: 'assistant', text: data.answer ?? data.error ?? 'нет ответа' },
      ]);
    } catch {
      setTurns((prev) => [...prev, { role: 'assistant', text: 'не удалось получить ответ' }]);
    } finally {
      setBusy(false);
    }
  }, [input, busy]);

  return (
    <div className="space-y-6">
      <SectionHead code="product · ai" title="ИИ-помощник" description="Спросите о проектах, задачах, автоматизации и уведомлениях — помощник отвечает по актуальному состоянию." />

      <Card>
        <div className="space-y-3">
          {turns.length === 0 ? (
            <p className="text-sm text-dim">Например: «сколько у меня открытых задач?» или «что включено в автоматизации?»</p>
          ) : (
            turns.map((t, i) => (
              <div key={i} className={`rounded-xl px-3 py-2 ${t.role === 'user' ? 'ml-auto max-w-[80%] bg-accent/10 text-ink' : 'bg-surface-2 text-ink'}`}>
                <p className="whitespace-pre-wrap text-sm">{t.text}</p>
              </div>
            ))
          )}
        </div>
        <div className="mt-4 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void send()}
            placeholder="Вопрос к ассистенту…"
            className={`flex-1 ${INPUT_CLASS}`}
          />
          <Button variant="primary" loading={busy} onClick={send}>Отправить</Button>
        </div>
      </Card>
    </div>
  );
}

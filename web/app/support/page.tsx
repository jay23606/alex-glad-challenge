// /support — FAQ-поиск + обращение в поддержку (тикет).
'use client';

import { useCallback, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { SectionHead } from '../components/ui/SectionHead';
import { Field, INPUT_CLASS } from '../components/ui/Field';

// Форма «Обращение»: INPUT_CLASS не задаёт блочность/ширину, добавляем локально
// (глобально менять INPUT_CLASS нельзя — затронет другие страницы).
const TICKET_FIELD_CLASS = `block w-full ${INPUT_CLASS}`;

interface FaqResult {
  question: string;
  answer: string;
  score: number;
}

export default function SupportPage() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<FaqResult[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [contact, setContact] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const search = useCallback(async () => {
    if (!q.trim()) return setResults([]);
    const r = await fetch(`/api/support/faq?q=${encodeURIComponent(q.trim())}`);
    if (r.ok) setResults(((await r.json()) as { results: FaqResult[] }).results);
  }, [q]);

  const submit = async () => {
    setStatus(null);
    if (!subject.trim() || !body.trim()) return setStatus('Заполните тему и описание');
    const r = await fetch('/api/support/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: subject.trim(), body: body.trim(), contact: contact.trim() || undefined }),
    });
    const data = (await r.json()) as { ok?: boolean; error?: string };
    setStatus(data.ok ? 'Обращение создано — ответим в ближайшее время.' : data.error ?? 'ошибка');
    if (data.ok) {
      setSubject('');
      setBody('');
      setContact('');
    }
  };

  return (
    <div className="space-y-6">
      <SectionHead code="product · support" title="Поддержка" description="Поиск по базе знаний и обращения в поддержку." />

      <Card label="База знаний">
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
            placeholder="Например: как включить автоматизацию"
            className={`flex-1 ${INPUT_CLASS}`}
          />
          <Button variant="primary" onClick={search}>Найти</Button>
        </div>
        {results.length > 0 ? (
          <div className="mt-4 space-y-3">
            {results.map((r) => (
              <div key={r.question} className="rounded-lg border border-line bg-surface p-3">
                <p className="text-sm font-medium text-ink">{r.question}</p>
                <p className="mt-1 text-sm text-dim">{r.answer}</p>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <Card label="Обращение">
        {/* <form>: Enter в полях шлёт форму; кнопка type="submit" (a11y). */}
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field id="support-subject" label="Тема">
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Тема" className={TICKET_FIELD_CLASS} />
          </Field>
          <Field id="support-body" label="Описание">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Опишите проблему" className={`h-24 resize-y ${TICKET_FIELD_CLASS}`} />
          </Field>
          <Field id="support-contact" label="Контакт (email/telegram, необязательно)">
            <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Контакт (email/telegram, необязательно)" className={TICKET_FIELD_CLASS} />
          </Field>
          <Button variant="primary" type="submit">Отправить</Button>
          {status ? <p className="text-sm text-dim">{status}</p> : null}
        </form>
      </Card>
    </div>
  );
}

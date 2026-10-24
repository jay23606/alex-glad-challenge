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

// role: alert — ошибки валидации и ошибки API; status — успех отправки.
type TicketStatus = { text: string; role: 'alert' | 'status' };

export default function SupportPage() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<FaqResult[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [contact, setContact] = useState('');
  const [status, setStatus] = useState<TicketStatus | null>(null);
  // In-flight guard от двойной отправки (канон — LoginForm: loading + disable).
  const [submitting, setSubmitting] = useState(false);

  const search = useCallback(async () => {
    if (!q.trim()) return setResults([]);
    const r = await fetch(`/api/support/faq?q=${encodeURIComponent(q.trim())}`);
    if (r.ok) setResults(((await r.json()) as { results: FaqResult[] }).results);
  }, [q]);

  const submit = async () => {
    if (submitting) return;
    setStatus(null);
    if (!subject.trim() || !body.trim()) {
      return setStatus({ text: 'Заполните тему и описание', role: 'alert' });
    }
    setSubmitting(true);
    try {
      const r = await fetch('/api/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), body: body.trim(), contact: contact.trim() || undefined }),
      });
      const data = (await r.json()) as { ok?: boolean; error?: string };
      setStatus(
        data.ok
          ? { text: 'Обращение создано — ответим в ближайшее время.', role: 'status' }
          : { text: data.error ?? 'ошибка', role: 'alert' },
      );
      if (data.ok) {
        setSubject('');
        setBody('');
        setContact('');
      }
    } finally {
      setSubmitting(false);
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
        {/* <form>: Enter в полях шлёт форму; кнопка type="submit" (a11y);
            submitting → disabled, guard от двойной отправки. */}
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
          <Button variant="primary" type="submit" loading={submitting}>Отправить</Button>
          {status ? <p role={status.role} className="text-sm text-dim">{status.text}</p> : null}
        </form>
      </Card>
    </div>
  );
}

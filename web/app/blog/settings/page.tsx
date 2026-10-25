// /blog/settings — удалённая настройка блога: system prompt + context prompt.
// 'use client': GET /api/blogs и GET/PATCH /api/blogs/[slug]. Промпты — главный
// рычаг «человечности» и различия блогов; сохраняются per blog (blogs.system_prompt
// / context_prompt). Пустое поле очищает override (null). НИКАКИХ импортов core/.
'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, INPUT_CLASS } from '../../components/ui/Field';
import { SectionHead } from '../../components/ui/SectionHead';
import { Textarea } from '../../components/ui/Textarea';
import { useToast } from '../../components/ui/Toast';

interface BlogOption {
  slug: string;
  name: string;
}

interface BlogConfig {
  slug: string;
  name: string;
  profile: string | null;
  hasProfile: boolean;
  tgChatId: string | null;
  stylePreset: 'default' | 'antonov';
  systemPrompt: string | null;
  contextPrompt: string | null;
  sources: string[];
}

export default function BlogSettingsPage() {
  const { toast } = useToast();
  const [blogs, setBlogs] = useState<BlogOption[]>([]);
  const [slug, setSlug] = useState('');
  const [config, setConfig] = useState<BlogConfig | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [contextPrompt, setContextPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/blogs')
      .then((r) => r.json())
      .then((j: { blogs?: BlogOption[] }) => {
        const list = j.blogs ?? [];
        setBlogs(list);
        setSlug((prev) => prev || list[0]?.slug || '');
      })
      .catch(() => setBlogs([]));
  }, []);

  const load = useCallback(
    async (target: string) => {
      if (!target) return;
      setLoading(true);
      try {
        const resp = await fetch(`/api/blogs/${encodeURIComponent(target)}`);
        if (!resp.ok) {
          const j = (await resp.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${resp.status}`);
        }
        const data = (await resp.json()) as { blog: BlogConfig };
        setConfig(data.blog);
        setSystemPrompt(data.blog.systemPrompt ?? '');
        setContextPrompt(data.blog.contextPrompt ?? '');
      } catch (e) {
        toast('err', e instanceof Error ? e.message : 'Не удалось загрузить блог');
        setConfig(null);
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    void load(slug);
  }, [slug, load]);

  const save = useCallback(async () => {
    if (!config || saving) return;
    setSaving(true);
    try {
      const resp = await fetch(`/api/blogs/${encodeURIComponent(config.slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt: systemPrompt.trim() === '' ? null : systemPrompt,
          contextPrompt: contextPrompt.trim() === '' ? null : contextPrompt,
        }),
      });
      if (!resp.ok) {
        const j = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as { blog: BlogConfig };
      setConfig(data.blog);
      setSystemPrompt(data.blog.systemPrompt ?? '');
      setContextPrompt(data.blog.contextPrompt ?? '');
      toast('ok', 'Промпты блога сохранены');
    } catch (e) {
      toast('err', e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }, [config, saving, systemPrompt, contextPrompt, toast]);

  const dirty =
    config !== null &&
    (systemPrompt !== (config.systemPrompt ?? '') ||
      contextPrompt !== (config.contextPrompt ?? ''));

  return (
    <div className="space-y-6">
      <SectionHead
        code="blog · settings"
        title="Настройки блога"
        description="Голос каждого блога: system prompt задаёт роль и правила, context prompt — постоянные факты и интонацию."
        actions={
          <select
            aria-label="Блог"
            className={`${INPUT_CLASS} h-9 max-w-64 text-sm`}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            disabled={loading || saving}
          >
            {blogs.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.name}
              </option>
            ))}
          </select>
        }
      />

      {config ? (
        <Card label={`${config.name} · ${config.slug}`}>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-dim">
            <span>профиль голоса: {config.profile ?? '—'}</span>
            <span>· Telegram: {config.tgChatId ?? 'общий канал'}</span>
            <span>· источники: {config.sources.length}</span>
            {!config.hasProfile && (
              <span className="text-warn">· профиль не найден — работает на промптах блога</span>
            )}
          </div>

          <div className="space-y-4">
            <Field
              id="system-prompt"
              label="System prompt"
              hint="Заменяет пресет/шаблон: роль, стиль, объём, запреты. Канал и подпись добавляются автоматически."
            >
              <Textarea
                value={systemPrompt}
                onValueChange={setSystemPrompt}
                max={8000}
                rows={10}
                placeholder="Ты — автор Telegram-канала храма… Пиши тепло, по-человечески, без канцелярита…"
                disabled={saving}
              />
            </Field>

            <Field
              id="context-prompt"
              label="Context prompt"
              hint="Постоянный контекст: факты о храме/аудитории, повторяющиеся темы, чего избегать. Подмешивается к каждому посту."
            >
              <Textarea
                value={contextPrompt}
                onValueChange={setContextPrompt}
                max={8000}
                rows={8}
                placeholder="Аудитория — прихожане и жители района. Настоятель — отец N. Не выдумывать цитаты и даты…"
                disabled={saving}
              />
            </Field>

            <div className="flex items-center gap-2">
              <Button variant="primary" onClick={save} disabled={saving || !dirty}>
                Сохранить промпты
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setSystemPrompt(config.systemPrompt ?? '');
                  setContextPrompt(config.contextPrompt ?? '');
                }}
                disabled={saving || !dirty}
              >
                Откатить
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <p className="text-sm text-dim">{loading ? 'Загрузка…' : 'Блог не выбран.'}</p>
      )}
    </div>
  );
}

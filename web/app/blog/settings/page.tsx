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
import { BlogCheatSheet } from './BlogCheatSheet';

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

interface ScheduleEntry {
  dayOfWeek: number;
  timeLocal: string;
  timezone: string;
  topic: string;
  variants: number;
  enabled: boolean;
}

interface ScheduleRun {
  id: number;
  status: 'running' | 'success' | 'error';
  attempts: number;
  postId: number | null;
  message: string;
  startedAt: string;
}

interface ScheduleResponse {
  schedules?: Array<{
    dayOfWeek: number;
    timeLocal: string;
    timezone: string;
    topic: string;
    variants: number;
    enabled: boolean;
  }>;
  runs?: ScheduleRun[];
}

const DAY_OPTIONS = [
  { value: 1, label: 'Понедельник' },
  { value: 2, label: 'Вторник' },
  { value: 3, label: 'Среда' },
  { value: 4, label: 'Четверг' },
  { value: 5, label: 'Пятница' },
  { value: 6, label: 'Суббота' },
  { value: 0, label: 'Воскресенье' },
];

export default function BlogSettingsPage() {
  const { toast } = useToast();
  const [blogs, setBlogs] = useState<BlogOption[]>([]);
  const [slug, setSlug] = useState('');
  const [config, setConfig] = useState<BlogConfig | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [contextPrompt, setContextPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [topic, setTopic] = useState('');
  const [comment, setComment] = useState('');
  const [variants, setVariants] = useState(1);
  const [publishNow, setPublishNow] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<
    Array<{ id: number; variant: number; angle: string }>
  >([]);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [scheduleRuns, setScheduleRuns] = useState<ScheduleRun[]>([]);
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);

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

        // Расписание вспомогательное: его сбой не должен скрывать настройки
        // промптов. null = секция покажет пустой список.
        const scheduleData = await fetch(
          `/api/blogs/${encodeURIComponent(target)}/schedule`,
        )
          .then((r) => (r.ok ? (r.json() as Promise<ScheduleResponse>) : null))
          .catch(() => null);
        setSchedule((scheduleData?.schedules ?? []).map((s) => ({ ...s })));
        setScheduleRuns(scheduleData?.runs ?? []);
        setScheduleDirty(false);
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

  const createPost = useCallback(async () => {
    if (!config || creating) return;
    setCreating(true);
    setCreated([]);
    try {
      const resp = await fetch(`/api/blogs/${encodeURIComponent(config.slug)}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          ...(comment.trim() ? { comment } : {}),
          variants,
          publishNow,
        }),
      });
      const data = (await resp.json().catch(() => ({}))) as {
        error?: string;
        posts?: Array<{ id: number; variant: number; angle: string }>;
        published?: { ok: boolean; error?: string } | null;
      };
      if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`);
      setCreated(data.posts ?? []);
      setTopic('');
      if (data.published && !data.published.ok) {
        toast('err', `Пост создан, но публикация не удалась: ${data.published.error ?? 'ошибка'}`);
      } else {
        toast('ok', data.published?.ok ? 'Пост создан и опубликован' : 'Черновики созданы');
      }
    } catch (e) {
      toast('err', e instanceof Error ? e.message : 'Не удалось создать пост');
    } finally {
      setCreating(false);
    }
  }, [config, creating, topic, comment, variants, publishNow, toast]);

  const updateSlot = useCallback((index: number, patch: Partial<ScheduleEntry>) => {
    setSchedule((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    setScheduleDirty(true);
  }, []);

  const addSlot = useCallback(() => {
    setSchedule((prev) => {
      const used = new Set(prev.map((s) => s.dayOfWeek));
      const day = [6, 0, 1, 2, 3, 4, 5].find((d) => !used.has(d)) ?? 6;
      return [
        ...prev,
        {
          dayOfWeek: day,
          timeLocal: '10:00',
          timezone: 'Europe/Moscow',
          topic: '',
          variants: 1,
          enabled: true,
        },
      ];
    });
    setScheduleDirty(true);
  }, []);

  const removeSlot = useCallback((index: number) => {
    setSchedule((prev) => prev.filter((_, i) => i !== index));
    setScheduleDirty(true);
  }, []);

  const saveSchedule = useCallback(async () => {
    if (!config || scheduleSaving) return;
    setScheduleSaving(true);
    try {
      const resp = await fetch(
        `/api/blogs/${encodeURIComponent(config.slug)}/schedule`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries: schedule }),
        },
      );
      const data = (await resp.json().catch(() => ({}))) as ScheduleResponse & {
        error?: string;
      };
      if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`);
      setSchedule((data.schedules ?? []).map((s) => ({ ...s })));
      setScheduleDirty(false);
      toast('ok', 'Расписание сохранено');
    } catch (e) {
      toast('err', e instanceof Error ? e.message : 'Не удалось сохранить расписание');
    } finally {
      setScheduleSaving(false);
    }
  }, [config, schedule, scheduleSaving, toast]);

  const dirty =
    config !== null &&
    (systemPrompt !== (config.systemPrompt ?? '') ||
      contextPrompt !== (config.contextPrompt ?? ''));

  return (
    <div className="space-y-6">
      <SectionHead
        code="blog · settings"
        title="Управление блогами"
        description="Выберите блог сверху: промпты, праздничный пост и расписание — здесь. Ниже — короткая шпаргалка."
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

      <BlogCheatSheet />

      {config ? (
        <>
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

        <Card label="праздничный пост по теме">
          <div className="space-y-4">
            <Field
              id="topic"
              label="Тема"
              hint="Разовый пост без RSS: праздник, объявление, важная дата. До 3 вариантов одной темы."
            >
              <input
                className={`${INPUT_CLASS} w-full`}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                maxLength={500}
                placeholder="Рождественская служба 7 января"
                disabled={creating}
              />
            </Field>

            <Field
              id="topic-comment"
              label="Комментарий автора (необязательно)"
              hint="Что обязательно упомянуть: время, место, детали, интонация."
            >
              <Textarea
                value={comment}
                onValueChange={setComment}
                max={1000}
                rows={4}
                placeholder="Служба в 9:00, после — чай в трапезной…"
                disabled={creating}
              />
            </Field>

            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2 text-dim">
                вариантов:
                <select
                  aria-label="Количество вариантов"
                  className={INPUT_CLASS}
                  value={variants}
                  onChange={(e) => setVariants(Number(e.target.value))}
                  disabled={creating}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-dim">
                <input
                  type="checkbox"
                  checked={publishNow}
                  onChange={(e) => setPublishNow(e.target.checked)}
                  className="accent-accent"
                  disabled={creating}
                />
                сразу опубликовать первый вариант
              </label>
              <Button
                variant="primary"
                onClick={createPost}
                disabled={creating || topic.trim().length < 3}
              >
                {creating ? 'Генерирую…' : 'Создать пост'}
              </Button>
            </div>
            {publishNow && (
              <p className="rounded-md border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
                Реальная отправка: первый вариант уйдёт в Telegram-канал блога
                {config.tgChatId ? ` (${config.tgChatId})` : ' (общий канал)'}.
              </p>
            )}

            {created.length > 0 && (
              <div className="rounded-md border border-line bg-surface-2 p-3 text-sm">
                <p className="text-dim">Созданные варианты:</p>
                <ul className="mt-1 space-y-1">
                  {created.map((p) => (
                    <li key={p.id}>
                      <a href={`/blog/posts/${p.id}`} className="text-accent hover:underline">
                        #{p.id}
                      </a>{' '}
                      <span className="text-dim">· вариант {p.variant + 1} · {p.angle}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>

        <Card label="расписание постов (дни недели)">
          <div className="space-y-4">
            <p className="text-xs text-dim">
              Слоты запускаются в локальном времени таймзоны (окно догона 3 часа). По
              умолчанию создаются черновики; автопубликация включается правилом блога
              в <a href="/automation" className="text-accent hover:underline">/automation</a>.
            </p>

            {schedule.length === 0 ? (
              <p className="rounded-md border border-line bg-surface-2 p-3 text-sm text-dim">
                Слотов нет — добавьте день и время.
              </p>
            ) : (
              <div className="space-y-3">
                {schedule.map((s, i) => (
                  <div key={i} className="rounded-md border border-line bg-surface-2 p-3">
                    <div className="flex flex-wrap items-end gap-3 text-xs text-dim">
                      <label className="flex flex-col gap-1">
                        день
                        <select
                          className={INPUT_CLASS}
                          value={s.dayOfWeek}
                          onChange={(e) => updateSlot(i, { dayOfWeek: Number(e.target.value) })}
                          disabled={scheduleSaving}
                        >
                          {DAY_OPTIONS.map((d) => (
                            <option key={d.value} value={d.value}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        время
                        <input
                          type="time"
                          className={INPUT_CLASS}
                          value={s.timeLocal}
                          onChange={(e) => updateSlot(i, { timeLocal: e.target.value })}
                          disabled={scheduleSaving}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        таймзона
                        <input
                          className={`${INPUT_CLASS} w-40`}
                          value={s.timezone}
                          onChange={(e) => updateSlot(i, { timezone: e.target.value })}
                          disabled={scheduleSaving}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        вариантов
                        <select
                          className={INPUT_CLASS}
                          value={s.variants}
                          onChange={(e) => updateSlot(i, { variants: Number(e.target.value) })}
                          disabled={scheduleSaving}
                        >
                          <option value={1}>1</option>
                          <option value={2}>2</option>
                          <option value={3}>3</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-2 pb-2">
                        <input
                          type="checkbox"
                          checked={s.enabled}
                          onChange={(e) => updateSlot(i, { enabled: e.target.checked })}
                          className="accent-accent"
                          disabled={scheduleSaving}
                        />
                        включён
                      </label>
                      <button
                        type="button"
                        className="pb-2 text-xs text-err hover:underline disabled:opacity-50"
                        onClick={() => removeSlot(i)}
                        disabled={scheduleSaving}
                      >
                        удалить
                      </button>
                    </div>
                    <label className="mt-2 flex flex-col gap-1 text-xs text-dim">
                      тема / фокус (пусто = регулярный пост блога)
                      <input
                        className={`${INPUT_CLASS} w-full`}
                        value={s.topic}
                        maxLength={500}
                        onChange={(e) => updateSlot(i, { topic: e.target.value })}
                        placeholder="Субботняя заметка: жизнь прихода, люди и события"
                        disabled={scheduleSaving}
                      />
                    </label>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={addSlot} disabled={scheduleSaving || schedule.length >= 14}>
                Добавить слот
              </Button>
              <Button
                variant="primary"
                onClick={saveSchedule}
                disabled={scheduleSaving || !scheduleDirty}
              >
                {scheduleSaving ? 'Сохраняю…' : 'Сохранить расписание'}
              </Button>
            </div>

            {scheduleRuns.length > 0 && (
              <div className="rounded-md border border-line p-3 text-xs">
                <p className="mb-1 text-dim">Последние запуски</p>
                <ul className="space-y-1">
                  {scheduleRuns.slice(0, 5).map((r) => (
                    <li key={r.id} className="flex flex-wrap gap-2">
                      <span className={r.status === 'success' ? 'text-ok' : 'text-err'}>
                        {r.status}
                      </span>
                      <span className="text-dim">{r.startedAt}</span>
                      <span className="text-dim">попыток: {r.attempts}</span>
                      <span>{r.message}</span>
                      {r.postId !== null && (
                        <a href={`/blog/posts/${r.postId}`} className="text-accent hover:underline">
                          #{r.postId}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
        </>
      ) : (
        <p className="text-sm text-dim">{loading ? 'Загрузка…' : 'Блог не выбран.'}</p>
      )}
    </div>
  );
}

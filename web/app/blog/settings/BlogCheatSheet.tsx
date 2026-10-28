import { Card } from '../../components/ui/Card';

const STEPS = [
  {
    title: 'Выберите блог',
    text: 'Список сверху. Промпты, расписание и Telegram-канал сохраняются отдельно для каждого блога.',
  },
  {
    title: 'Настройте голос',
    text: 'System prompt — роль, стиль и запреты. Context prompt — факты, имена и интонация. Нажмите «Сохранить промпты».',
  },
  {
    title: 'Создайте разовый пост',
    text: 'Введите тему (от 3 символов) и нажмите «Создать пост». Это черновик; «Опубликовать» сразу отправит первый вариант в Telegram.',
  },
  {
    title: 'Задайте расписание',
    text: 'Добавьте слот: день, время, часовой пояс, тема. Включите его и сохраните. Повторный запуск не создаст дубль за тот же слот.',
  },
  {
    title: 'Проверьте результат',
    text: 'Черновики — в разделе «Посты». Автопубликация и история запусков — в «Автоматизации».',
  },
] as const;

export function BlogCheatSheet() {
  return (
    <Card label="шпаргалка · как пользоваться">
      <p className="text-sm leading-relaxed text-dim">
        Всё управление — на этой странице. Сначала выберите блог в списке сверху:
        у каждого блога свои промпты, расписание и Telegram-канал.
      </p>

      <ol className="mt-3 grid gap-2.5 sm:grid-cols-2">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="flex gap-3 rounded-lg border border-line bg-surface-2 p-3"
          >
            <span
              aria-hidden="true"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 font-mono text-[11px] font-semibold text-accent"
            >
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{step.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-dim">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs leading-relaxed text-warn">
        <strong className="font-semibold">Безопасный режим:</strong> по умолчанию
        создаются черновики. Пост уйдёт в Telegram только если вы включили
        «Опубликовать» или автопубликацию в{' '}
        <a href="/automation" className="underline">
          автоматизации
        </a>
        .
      </div>

      <details className="mt-3 rounded-lg border border-line bg-surface-2 p-3">
        <summary className="cursor-pointer select-none text-sm font-medium text-ink">
          Telegram-команда и частые вопросы
        </summary>
        <div className="mt-3 space-y-3 text-xs leading-relaxed text-dim">
          <p>Праздничный пост можно создать из Telegram (только владелец):</p>
          <pre className="overflow-x-auto rounded-md border border-line bg-surface p-2 font-mono text-[11px] text-ink">
            {`/пост <блог> [publish] <тема> [| комментарий]`}
          </pre>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              без <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11px] text-ink">publish</code> —
              черновик;
            </li>
            <li>
              с <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11px] text-ink">publish</code> —
              первый вариант сразу в канал блога;
            </li>
            <li>
              список блогов —{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11px] text-ink">/блоги</code>.
            </li>
          </ul>
          <ul className="space-y-2">
            <li>
              <strong className="text-ink">Публикуется только первый вариант.</strong>{' '}
              Остальные остаются черновиками — откройте их в «Постах».
            </li>
            <li>
              <strong className="text-ink">Нет профиля голоса?</strong> Это нормально:
              пост пишется по промптам и названию блога, без футбольных дефолтов.
            </li>
            <li>
              <strong className="text-ink">Расписание не сработало?</strong> Проверьте
              день, время, часовой пояс и галочку «Включено»; последние запуски — ниже.
            </li>
          </ul>
        </div>
      </details>
    </Card>
  );
}

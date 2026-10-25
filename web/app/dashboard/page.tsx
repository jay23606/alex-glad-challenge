// Dashboard (/dashboard) — server component (ТЗ §8.3): хаб админки.
// (а) Быстрые действия: «Новый пост в TG» (J1), «Черновики блога» (J2),
//     «История публикаций» (J3); (б) карта возможностей — все инструменты
//     сгруппированы по задачам владельца (наполнение канала, стиль, база знаний,
//     архив TG, сервисы), по карточке на страницу с человеческим описанием;
//     (в) статус-строка ключей + tg configured (getKeysStatus — только флаги/мета,
//     значения секретов NEVER); (г) тайлы статистики (live-БД). Все обращения к БД —
//     server-only singletons + withDb(). force-dynamic: читает live-данные каждый запрос.
import Link from 'next/link';
import type { Metadata } from 'next';
import type { ComponentType, ReactNode } from 'react';
import { getBlogDb, getDialogDb, getRagStore, getTgStore, withDb } from '../../lib/server/db';
import { getKeysStatus } from '../../lib/server/env';
import { SectionHead } from '../components/ui/SectionHead';
import { SectionLabel } from '../components/ui/SectionLabel';
import { Card } from '../components/ui/Card';
import { Tile } from '../components/ui/Tile';
import { StatusDot } from '../components/ui/StatusDot';
import {
  IconCheck,
  IconCpu,
  IconDatabase,
  IconDownload,
  IconEdit,
  IconEye,
  IconGlobe,
  IconHistory,
  IconLayers,
  IconList,
  IconMessages,
  IconPlay,
  IconPlug,
  IconRss,
  IconSearch,
  IconSend,
  IconSliders,
  IconSparkles,
  IconTelegram,
  IconWand,
} from '../components/ui/icons';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Dashboard' };

interface DashboardStats {
  blogs: number;
  news: number;
  posts: number;
  styleSamples: number;
  ragFixed: number;
  ragStructure: number;
  ragTelegram: number;
  tgMessages: number;
  tgTopics: number;
  tgChats: number;
  dialogChats: number;
  dialogMessages: number;
}

async function readStats(): Promise<DashboardStats> {
  return withDb(() => {
    const blog = getBlogDb();
    const rag = getRagStore();
    const tg = getTgStore();
    const dialog = getDialogDb();
    const tgStats = tg.stats();
    const chats = dialog.listChats(2000);
    return {
      blogs: blog.listBlogs().length,
      news: blog.newsCount(),
      posts: blog.postsCount(),
      styleSamples: blog.styleSamplesCount(),
      ragFixed: rag.count('fixed'),
      ragStructure: rag.count('structure'),
      ragTelegram: rag.count('telegram'),
      tgMessages: tgStats.messages,
      tgTopics: tgStats.topics,
      tgChats: tgStats.chats,
      dialogChats: chats.length,
      dialogMessages: chats.reduce((sum, c) => sum + c.msg_count, 0),
    };
  });
}

// Быстрое действие — интерактивная карточка-ссылка (путь ≤ 1 клика от /dashboard, ТЗ G1).
// Контракт «интерактив vs инфо»: тень+hover+стрелка = можно нажать (Card variant="interactive").
function QuickAction({
  href,
  icon: Icon,
  title,
  desc,
}: {
  href: string;
  icon?: ComponentType;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <Card variant="interactive" arrow className="h-full">
        <span className="flex items-center gap-2 font-sans text-sm font-semibold text-ink">
          {Icon ? (
            <span aria-hidden="true" className="shrink-0 text-accent">
              <Icon />
            </span>
          ) : null}
          {title}
        </span>
        <span className="mt-1 block text-sm leading-snug text-dim group-hover:text-ink">{desc}</span>
      </Card>
    </Link>
  );
}

// Карта возможностей: одна группа = одна задача владельца, одна карточка = одна
// страница инструмента. Описания — человеческим голосом, ≤ 1 предложения, без
// dev-жаргона (контракт вкуса владельца).
const CAPABILITY_GROUPS: Array<{
  label: string;
  items: Array<{ href: string; icon: ComponentType; title: string; desc: string }>;
}> = [
  {
    label: 'наполнение канала',
    items: [
      {
        href: '/blog/scout',
        icon: IconRss,
        title: 'Скаут тем',
        desc: 'Три агента прочёсывают RSS, форумы и Telegram и сводят найденное в топ лучших тем по вашему запросу.',
      },
      {
        href: '/blog/news',
        icon: IconEdit,
        title: 'Пост из новостей',
        desc: 'Свежие новости выбранного блога превращает в готовый черновик поста голосом этого блога.',
      },
      {
        href: '/blog/digest',
        icon: IconSparkles,
        title: 'Дайджест недели',
        desc: 'Недельный дайджест одним кликом: соберёт и покажет предпросмотр — в канал уйдёт только после вашего подтверждения.',
      },
      {
        href: '/blog/posts',
        icon: IconHistory,
        title: 'Посты блога',
        desc: 'Все посты: правка, статусы, публикация в канал из карточки.',
      },
      {
        href: '/summary',
        icon: IconSend,
        title: 'Сводка задач в канал',
        desc: 'Собирает накопившиеся задачи в один текст и отправляет в Telegram после подтверждения.',
      },
      {
        href: '/blog/pipeline',
        icon: IconCheck,
        title: 'Стадии конвейера',
        desc: 'Шпаргалка по конвейеру: какие стадии проходит пост и какое действие ждёт систему на каждой.',
      },
    ],
  },
  {
    label: 'стиль и тексты',
    items: [
      {
        href: '/antonov',
        icon: IconWand,
        title: 'Студия «Антонов»',
        desc: 'Черновик любого текста голосом канала: тон, формат, подпись — и режим потока-перевода чужого разбора.',
      },
      {
        href: '/style',
        icon: IconGlobe,
        title: 'Антоновайзер',
        desc: 'Публичный переписыватель: вставьте текст — получите пост с позицией, настроением и панчем.',
      },
      {
        href: '/joker',
        icon: IconMessages,
        title: 'Кино-Шутник',
        desc: 'Развлекательный чат-шутник на локальной модели: работает даже без облачных ключей.',
      },
    ],
  },
  {
    label: 'база знаний',
    items: [
      {
        href: '/rag/ingest',
        icon: IconDatabase,
        title: 'Пополнить базу',
        desc: 'Заметки, файлы и Telegram-чаты складываются в одну базу знаний.',
      },
      {
        href: '/rag',
        icon: IconSearch,
        title: 'Спросить базу',
        desc: 'Задаёте вопрос — получаете ответ с цитатами из собственной базы знаний.',
      },
      {
        href: '/rag/chat',
        icon: IconMessages,
        title: 'Чат по базе',
        desc: 'Ассистент в диалоге: сам ищет по базе знаний и отвечает со ссылками на источники.',
      },
      {
        href: '/rag/chats',
        icon: IconList,
        title: 'Каталог чатов',
        desc: 'Какие Telegram-чаты система знает и как их вызывать по короткому имени.',
      },
    ],
  },
  {
    label: 'архив telegram',
    items: [
      {
        href: '/tg/top',
        icon: IconEye,
        title: 'Топ сообщений',
        desc: 'Самые обсуждаемые сообщения любого известного топика — только чтение, архив не меняется.',
      },
      {
        href: '/tg/collect',
        icon: IconDownload,
        title: 'Докачать архив',
        desc: 'Дозагружает сообщения форум-чата в локальный архив с живым прогрессом.',
      },
      {
        href: '/evolute',
        icon: IconTelegram,
        title: 'Эволют',
        desc: 'Отобранный топ полезных сообщений «Эволют-чата» и ассистент, который отвечает по его истории.',
      },
    ],
  },
  {
    label: 'сервисы и обслуживание',
    items: [
      {
        href: '/chat',
        icon: IconMessages,
        title: 'Чат с моделью',
        desc: 'Обычный чат с облачной или локальной моделью — с ветками диалога и настраиваемым поведением.',
      },
      {
        href: '/agent',
        icon: IconSparkles,
        title: 'Разовый вопрос',
        desc: 'Один вопрос — один ответ без истории: быстро проверить мысль или модель.',
      },
      {
        href: '/mcp/tools',
        icon: IconPlug,
        title: 'MCP-инструменты',
        desc: 'Какие внешние инструменты сейчас подключены к системе.',
      },
      {
        href: '/mcp/call',
        icon: IconPlay,
        title: 'Вызов инструмента',
        desc: 'Запустить подключённый инструмент с нужными аргументами и сразу увидеть результат.',
      },
      {
        href: '/mcp/todos',
        icon: IconCheck,
        title: 'Задачи',
        desc: 'Общий список дел: добавить, отметить сделанным, удалить.',
      },
      {
        href: '/briefing',
        icon: IconEye,
        title: 'Сводка системы',
        desc: 'Мгновенная картина: задачи, статистика баз, топ Telegram.',
      },
      {
        href: '/rag/index',
        icon: IconLayers,
        title: 'Переиндексация',
        desc: 'Служебное: пересобрать поисковый индекс — документы здесь, Telegram-архив на соседней странице.',
      },
      {
        href: '/admin/servers',
        icon: IconCpu,
        title: 'Серверы',
        desc: 'Какие сервисы и ключи настроены — только факт, без значений секретов.',
      },
      {
        href: '/settings',
        icon: IconSliders,
        title: 'Настройки',
        desc: 'Модель по умолчанию для сайта и обзор текущей конфигурации.',
      },
    ],
  },
];

export default async function DashboardPage() {
  const [stats, keys] = await Promise.all([readStats(), Promise.resolve(getKeysStatus())]);
  const ragTotal = stats.ragFixed + stats.ragStructure + stats.ragTelegram;
  const deepseekOn = keys.cloud.configured && keys.cloud.provider === 'DeepSeek';
  const openrouterOn = keys.cloud.configured && keys.cloud.provider === 'OpenRouter';

  const statusLine: Array<{ status: 'ok' | 'off'; label: ReactNode }> = [
    { status: deepseekOn ? 'ok' : 'off', label: 'DeepSeek' },
    { status: openrouterOn ? 'ok' : 'off', label: 'OpenRouter' },
    { status: keys.local.configured ? 'ok' : 'off', label: 'Local LLM · Ollama' },
    { status: keys.embed.configured ? 'ok' : 'off', label: 'Embeddings' },
    { status: keys.mtproto.configured ? 'ok' : 'off', label: 'MTProto · userbot' },
    {
      status: keys.botApi.configured ? 'ok' : 'off',
      label: keys.botApi.channelLabel ? `Bot API · ${keys.botApi.channelLabel}` : 'Bot API',
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHead
        code="dashboard · live"
        title="Dashboard"
        description="Карта возможностей: что умеет система и куда нажимать. Ключи показаны только как факт настройки — значения секретов не отображаются."
      />

      {/* ── Быстрые действия (J1/J2/J3) ── */}
      <section>
        <SectionLabel>быстрые действия</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-3">
          <QuickAction
            href="/telegram/publish"
            icon={IconSend}
            title="Новый пост в TG"
            desc="Компоузер: разметка, превью, подтверждение, отправка"
          />
          <QuickAction
            href="/blog/posts"
            icon={IconEdit}
            title="Черновики блога"
            desc="Правка постов и публикация в канал из карточки"
          />
          <QuickAction
            href="/telegram/publish#history"
            icon={IconHistory}
            title="История публикаций"
            desc="Outbox: что ушло, message_id, ошибки"
          />
        </div>
      </section>

      {/* ── Карта возможностей: группа = задача владельца ── */}
      {CAPABILITY_GROUPS.map((g) => (
        <section key={g.label}>
          <SectionLabel>{g.label}</SectionLabel>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {g.items.map((it) => (
              <QuickAction
                key={it.href}
                href={it.href}
                icon={it.icon}
                title={it.title}
                desc={it.desc}
              />
            ))}
          </div>
        </section>
      ))}

      {/* ── Статус: ключи + tg configured (Boolean only, values NEVER) ── */}
      <section>
        <SectionLabel>Ключи и сервисы</SectionLabel>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {statusLine.map((s) => (
            <StatusDot key={String(s.label)} status={s.status} label={s.label} />
          ))}
        </div>
      </section>

      {/* ── Active model (public-мета, не секрет) ── */}
      <section>
        <SectionLabel>Модель</SectionLabel>
        {keys.activeModel ? (
          <StatusDot status="ok" label={`${keys.activeProvider ?? 'model'} · ${keys.activeModel}`} />
        ) : (
          <StatusDot status="warn" label="LLM не настроен — задайте ключи в .env" />
        )}
      </section>

      {/* ── DB stats ── */}
      <section>
        <SectionLabel>Базы данных</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Tile label="блоги" value={stats.blogs} />
          <Tile label="новости" value={stats.news} />
          <Tile label="посты" value={stats.posts} />
          <Tile label="стиль" value={stats.styleSamples} />
          <Tile
            label="rag"
            value={ragTotal}
            hint={`f ${stats.ragFixed} · s ${stats.ragStructure} · tg ${stats.ragTelegram}`}
          />
          <Tile label="tg сообщения" value={stats.tgMessages} hint={`${stats.tgChats} chats · ${stats.tgTopics} topics`} />
          <Tile label="диалоги" value={stats.dialogChats} hint={`${stats.dialogMessages} msg`} />
        </div>
      </section>
    </div>
  );
}

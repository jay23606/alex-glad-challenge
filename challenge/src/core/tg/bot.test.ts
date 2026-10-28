import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MediumBot, weightedDistractors } from './bot.js';
import { BotAutomationCommands } from './botAutomation.js';
import type { BlogRow } from '../db.js';
import { GamificationDb, EVENT_POINTS } from '../gamification.js';
import { OutboxQueue, UserCommandQueue, ConcurrencyLimiter } from './botQueue.js';
import type { OutboundMessage } from './botQueue.js';
import type { TgCallbackQuery, TgUpdate } from './botApi.js';
import type { ImprovGame } from './botImprov.js';
import type { AuthorEntry } from './botNames.js';

const CHAT = '-1001736860345';

const DIRECTORY: AuthorEntry[] = [
  {
    fromId: '100',
    name: 'Saveliy',
    messages: 100,
    textMessages: 90,
    firstDate: '2022-03-23T00:00:00.000Z',
    lastDate: '2026-09-18T00:00:00.000Z',
  },
];

interface BotHarness {
  bot: MediumBot;
  sent: OutboundMessage[];
  deleted: number[];
  edits: Array<{ chatId: string; msgId: number; text: string }>;
  answered: Array<string | undefined>;
  session: { startedAt: number; updatesSeen: number; enabled: boolean };
  announceId(): number;
}

function makeBot(
  opts: {
    enabled?: boolean;
    generateImitation?: (
      a: unknown,
      history: Array<{ role: string; content: string }>,
      s: string[],
    ) => Promise<string>;
    said?: {
      hits: Array<{ topicId: number; msgId: number }>;
      rows: Map<string, unknown>;
    };
    /** Задан → апдейты от этого userId проходят owner-гейт диспетчера. */
    ownerChatId?: string;
    /** Инъекция команд /блоги и /авто (по умолчанию не задана — как в проде без блога). */
    automationCommands?: BotAutomationCommands;
    /** XP за TG-игры (#59): инъекция геймификации (по умолчанию нет — как в тестах бота). */
    gamification?: GamificationDb;
  } = {},
): BotHarness {
  const sent: OutboundMessage[] = [];
  const deleted: number[] = [];
  const edits: Array<{ chatId: string; msgId: number; text: string }> = [];
  const answered: Array<string | undefined> = [];
  const queue = new OutboxQueue({
    sender: async (m) => {
      sent.push(m);
      return 100 + sent.length;
    },
    gapMs: 1,
    sleep: async () => {},
  });
  const session = { startedAt: 0, updatesSeen: 0, enabled: opts.enabled ?? true };
  const deps = {
    api: {
      sendMessage: async () => 1,
      deleteMessage: async (_chatId: string, messageId: number) => {
        deleted.push(messageId);
        return true;
      },
      editMessageText: async (chatId: string, messageId: number, text: string) => {
        edits.push({ chatId, msgId: messageId, text });
        return true;
      },
      answerCallbackQuery: async (_id: string, text?: string) => {
        answered.push(text);
        return true;
      },
    },
    store: {
      setState: () => {},
      getState: () => null,
      randomAuthorGameQuote: () => null,
      sampleAuthorDate: () => null,
      sampleAuthorQuotes: () => [],
      listAliases: () => new Map(),
      getMessagesByKeys: () => opts.said?.rows ?? new Map(),
    },
    fts: { get: () => ({ search: () => opts.said?.hits ?? [] }) },
    queue,
    commandQueue: new UserCommandQueue(),
    kakbyLimiter: new ConcurrencyLimiter(3),
    directory: { get: () => DIRECTORY },
    cfg: {
      allowChats: new Set([CHAT]),
      ownerChatId: opts.ownerChatId ?? null,
      pollTimeoutSec: 5,
      botToken: 'токен',
    },
    automationCommands: opts.automationCommands,
    gamification: opts.gamification,
    session,
    botId: '999',
    generateImitation: opts.generateImitation,
  } as unknown as ConstructorParameters<typeof MediumBot>[0];
  const bot = new MediumBot(deps);
  return {
    bot,
    sent,
    deleted,
    edits,
    answered,
    session,
    announceId: () => 100 + sent.length,
  };
}

function improvOf(h: BotHarness): ImprovGame {
  return (h.bot as unknown as { improv: ImprovGame }).improv;
}

function ctx(chatId = CHAT): { chatId: string; userId: string; userName: string; replyTo: number; isOwner: boolean } {
  return { chatId, userId: 'u1', userName: 'Юзер', replyTo: 5, isOwner: true };
}

/** Раунд /игра без живого таймера — для проверок слота и ревила. */
function stubTimer(): NodeJS.Timeout {
  return setTimeout(() => {}, 30);
}

function messageUpdate(
  messageId: number,
  replyTo?: number,
  text = 'Пародия на манеру автора',
  userId = 42,
): TgUpdate {
  return {
    update_id: messageId,
    message: {
      message_id: messageId,
      chat: { id: Number(CHAT), type: 'supergroup' },
      from: { id: userId, first_name: `Юзер${userId}`, is_bot: false },
      text,
      ...(replyTo !== undefined ? { reply_to_message: { message_id: replyTo } } : {}),
    },
  };
}

async function startImprovRound(h: BotHarness): Promise<void> {
  await improvOf(h).start({
    chatId: CHAT,
    author: DIRECTORY[0],
    theme: '',
    real: {
      msgId: 1,
      text: 'Настоящая цитата автора про футбол и парковку',
      dateIso: '2023-07-11T00:00:00.000Z',
      reactions: 10,
    },
  });
}

test('фикс D7: revealRound при выключенном боте молча снимает раунд, без поста', async () => {
  const h = makeBot({ enabled: false });
  try {
    (h.bot as unknown as { rounds: Map<string, unknown> }).rounds.set(CHAT, {
      seq: 1,
      chatId: CHAT,
      correctFromId: '100',
      options: [],
      quoteText: 'цитата',
      quoteDate: '2024-01-01T00:00:00.000Z',
      quoteReactions: 3,
      endsAt: Date.now() + 1000,
      timer: stubTimer(),
      finished: false,
    });
    await (h.bot as unknown as { revealRound(c: string, t: boolean): Promise<void> }).revealRound(CHAT, true);
    assert.equal(h.sent.length, 0, 'после /off ревил не публикуется');
    assert.equal((h.bot as unknown as { rounds: Map<string, unknown> }).rounds.has(CHAT), false, 'раунд снят');
  } finally {
    h.bot.cancelTimers();
  }
});

test('revealRound при включённом боте работает как раньше (контроль D7)', async () => {
  const h = makeBot();
  try {
    (h.bot as unknown as { rounds: Map<string, unknown> }).rounds.set(CHAT, {
      seq: 1,
      chatId: CHAT,
      correctFromId: '100',
      options: [],
      quoteText: 'цитата',
      quoteDate: '2024-01-01T00:00:00.000Z',
      quoteReactions: 3,
      endsAt: Date.now() + 1000,
      timer: stubTimer(),
      finished: false,
    });
    await (h.bot as unknown as { revealRound(c: string, t: boolean): Promise<void> }).revealRound(CHAT, true);
    assert.equal(h.sent.length, 1);
    assert.match(h.sent[0].text, /⏰ Время вышло!/);
    assert.match(h.sent[0].text, /Saveliy · \[01\.01\.2024\]/);
  } finally {
    h.bot.cancelTimers();
  }
});

test('взаимоисключение: раунд «изобрази» блокирует /игра и наоборот', async () => {
  const h = makeBot();
  try {
    await startImprovRound(h);
    await (h.bot as unknown as { cmdGame(c: unknown): Promise<void> }).cmdGame(ctx());
    assert.match(h.sent.at(-1)!.text, /Раунд уже идёт/);
    h.bot.cancelTimers();

    (h.bot as unknown as { rounds: Map<string, unknown> }).rounds.set(CHAT, {
      finished: false,
      endsAt: Date.now() + 20_000,
      timer: stubTimer(),
    });
    h.sent.length = 0;
    await (h.bot as unknown as { cmdImprov(a: string, c: unknown): Promise<void> }).cmdImprov('saveliy парковка', ctx());
    assert.match(h.sent.at(-1)!.text, /Раунд уже идёт/);
  } finally {
    h.bot.cancelTimers();
  }
});

test('MAJOR-фикс: кнопка дизамбиги (res:) при активной /игра → отказ, раунд не стартует', async () => {
  const h = makeBot();
  try {
    (h.bot as unknown as { rounds: Map<string, unknown> }).rounds.set(CHAT, {
      finished: false,
      endsAt: Date.now() + 20_000,
      timer: stubTimer(),
    });
    const token = 'tok12345';
    (h.bot as unknown as { pending: Map<string, unknown> }).pending.set(token, {
      chatId: CHAT,
      cmdName: 'изобрази',
      argsText: '',
      replyTo: 5,
      expiresAt: Date.now() + 60_000,
    });
    const cb: TgCallbackQuery = {
      id: 'cbz',
      from: { id: 42, first_name: 'Юзер' },
      message: {
        message_id: 1,
        chat: { id: Number(CHAT), type: 'supergroup' },
        from: { id: 42, first_name: 'Юзер', is_bot: false },
      },
      data: `res:${token}:100`,
    };
    await (h.bot as unknown as { handleCallback(cb: TgCallbackQuery): Promise<void> }).handleCallback(cb);
    assert.match(h.sent.at(-1)!.text, /Раунд уже идёт/, 'гард в cmdImprovStart сработал');
    assert.equal(improvOf(h).hasActiveRound(CHAT), null, 'второй раунд не стартовал');
  } finally {
    h.bot.cancelTimers();
  }
});

test('reply-ветка: реплай на анонс «Изобрази» становится записью и удаляется', async () => {
  const h = makeBot();
  try {
    await startImprovRound(h);
    const announce = h.announceId();
    await h.bot.handleUpdate(messageUpdate(500, announce));
    assert.deepEqual(h.deleted, [500], 'запись принята и скрыта');
    assert.ok(h.edits.some((e) => e.text.includes('✍️ Принято: 1/3')), 'счётчик отредактирован');
    await h.bot.handleUpdate(messageUpdate(501, announce + 5));
    assert.deepEqual(h.deleted, [500], 'реплай на чужую карточку бота — молча');
  } finally {
    h.bot.cancelTimers();
  }
});

test('общий счёт: очки /игра видны в ревиле «изобрази»', async () => {
  const h = makeBot();
  try {
    (h.bot as unknown as { addScore(c: string, u: string, n: string, d: number): void }).addScore(
      CHAT,
      'u1',
      'Знаток',
      2,
    );
    await startImprovRound(h);
    const announce = h.announceId();
    await h.bot.handleUpdate(messageUpdate(500, announce, undefined, 42));
    await h.bot.handleUpdate(messageUpdate(501, announce, 'Пародия первая, но не настоящая', 43));
    await h.bot.handleUpdate(messageUpdate(502, announce, 'Пародия вторая, тоже не настоящая', 44));
    assert.ok(
      h.edits.some((e) => e.text.includes('✍️ Принято: 3/3')),
      'все три записи приняты (минимальное окно держит набор открытым)',
    );
    // окно 45 с нарочно коротким не делаем — закрываем набор вручную (как таймер)
    const game = improvOf(h);
    await (game as unknown as { closeCollect(c: string): void }).closeCollect(CHAT);
    const token = (game as unknown as { rounds: Map<string, { token: string }> }).rounds.get(CHAT)?.token ?? '';
    assert.ok(token, 'раунд «изобрази» жив');
    await game.handleVote('cb1', CHAT, 'v1', 'Голос', token, '1');
    await game.handleVote('cb2', CHAT, 'v2', 'Голос', token, '2');
    await game.handleVote('cb3', CHAT, 'v3', 'Голос', token, '3');
    await (game as unknown as { reveal(c: string): Promise<void> }).reveal(CHAT);
    assert.match(h.sent.at(-1)!.text, /🏆 Сессия: .*Знаток — 2/, 'доска общая: очки /игра в топе');
    assert.equal(game.hasActiveRound(CHAT), null, 'раунд завершён');
  } finally {
    h.bot.cancelTimers();
  }
});

test('improv XP (#59): ревил начисляет tg_game_play/tg_game_win через gamification', async () => {
  // Полный провод: хук из конструктора MediumBot → GamificationDb.award.
  const dir = mkdtempSync(path.join(tmpdir(), 'tgxp-'));
  const gamification = new GamificationDb(path.join(dir, 'g.sqlite'));
  const h = makeBot({ gamification });
  try {
    await startImprovRound(h);
    const announce = h.announceId();
    await h.bot.handleUpdate(messageUpdate(500, announce, 'Пародия первая про чай и самовар', 42));
    await h.bot.handleUpdate(messageUpdate(501, announce, 'Пародия вторая про футбол', 43));
    const game = improvOf(h);
    // Шаги таймера раунда вызываются вручную: доступ к приватным методам ImprovGame.
    const timerSteps = game as unknown as {
      closeCollect(chatId: string): void;
      reveal(chatId: string): Promise<void>;
    };
    await timerSteps.closeCollect(CHAT);
    const votePost = h.sent.find((m) => m.text.includes('голосование!'));
    assert.ok(votePost, 'пост голосования ушёл');
    const buttons = votePost!.markup?.inline_keyboard[0] ?? [];
    const token = buttons[0]?.callback_data.split(':')[1] ?? '';
    const idxOf = (marker: string): string | undefined => {
      const line = votePost!.text.split('\n').find((l) => l.includes(marker));
      return /^(\d+)\. /.exec(line ?? '')?.[1];
    };
    const realIdx = idxOf('«Настоящая цитата автора про футбол и парковку»');
    const parodyIdx = idxOf('«Пародия первая про чай и самовар»');
    assert.ok(token && realIdx && parodyIdx, 'кнопки и варианты разобраны');
    await game.handleVote('cb1', CHAT, 'g1', 'Знаток', token, realIdx);
    await game.handleVote('cb2', CHAT, 'g2', 'Обманутый', token, parodyIdx);
    await timerSteps.reveal(CHAT);
    // Ассерт по ref, не по порядку listEvents (#94): reverse-chron порядок не контракт.
    // Приватное состояние ImprovGame, доступ только для теста: seq раунда входит в ref.
    const improvRounds = (game as unknown as { rounds: Map<string, { seq: number }> }).rounds;
    const roundSeq = improvRounds.get(CHAT)?.seq ?? -1;
    const byRef = new Map(gamification.listEvents().map((e) => [e.ref, e]));
    const win = byRef.get(`improv:${CHAT}:${roundSeq}:42`);
    const play = byRef.get(`improv:${CHAT}:${roundSeq}:g1`);
    assert.ok(win, `win-событие с ref improv:${CHAT}:<seq>:42 записано`);
    assert.ok(play, `play-событие с ref improv:${CHAT}:<seq>:g1 записано`);
    assert.equal(win.type, 'tg_game_win', 'win автору шаржа (p1)');
    assert.equal(win.points, EVENT_POINTS.tg_game_win);
    assert.equal(play.type, 'tg_game_play', 'play угадавшему настоящую (g1)');
    assert.equal(play.points, EVENT_POINTS.tg_game_play);
    assert.equal(gamification.getStats().xp, EVENT_POINTS.tg_game_win + EVENT_POINTS.tg_game_play);
  } finally {
    h.bot.cancelTimers();
    gamification.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('improv XP: сбой gamification.award не срывает ревил (#94)', async () => {
  // Фейк с падающим award (приведение к GamificationDb — инъекция в makeBot):
  // XP — best effort, ревил раунда не зависит от геймификации.
  let awardCalls = 0;
  const brokenGamification = {
    award: () => {
      awardCalls++;
      throw new Error('xp storage down');
    },
  } as unknown as GamificationDb;
  const h = makeBot({ gamification: brokenGamification });
  try {
    await startImprovRound(h);
    const announce = h.announceId();
    await h.bot.handleUpdate(messageUpdate(500, announce, 'Пародия первая про чай и самовар', 42));
    await h.bot.handleUpdate(messageUpdate(501, announce, 'Пародия вторая про футбол', 43));
    const game = improvOf(h);
    // Таймеры шагаем вручную через приватные методы ImprovGame (как в тесте выше).
    const steps = game as unknown as {
      closeCollect(chatId: string): void;
      reveal(chatId: string): Promise<void>;
    };
    await steps.closeCollect(CHAT);
    const votePost = h.sent.find((m) => m.text.includes('голосование!'));
    assert.ok(votePost, 'пост голосования ушёл');
    // Голос за любой вариант: настоящая → play, пародия → win (золотой шарж) —
    // в обоих случаях awardGame вызывается и фейк кидает.
    const [cbData] = votePost!.markup?.inline_keyboard[0] ?? [];
    const parts = cbData?.callback_data.split(':') ?? [];
    assert.ok(parts[1] && parts[2], 'кнопка голосования разобрана');
    await game.handleVote('cb1', CHAT, 'g1', 'Знаток', parts[1], parts[2]);
    await steps.reveal(CHAT);
    assert.equal(awardCalls, 1, 'award реально вызван и кинул — прогон не пустой');
    assert.match(h.sent.at(-1)!.text, /🕵️ Раскрытие!/, 'ревил отправлен, хотя award кинул');
    assert.equal(game.hasActiveRound(CHAT), null, 'раунд завершён штатно');
  } finally {
    h.bot.cancelTimers();
  }
});

test('/какбы без имени → подсказка формата', async () => {
  const h = makeBot();
  await (h.bot as unknown as { cmdKakby(a: string, c: unknown): Promise<void> }).cmdKakby('', ctx());
  assert.match(h.sent.at(-1)!.text, /Формат: \/какбы/);
});

test('/какбы с грязным запросом → отказ без генерации', async () => {
  let called = 0;
  const h = makeBot({
    generateImitation: async () => {
      called++;
      return '🎭 Это воображаемая реплика в манере Saveliy, не настоящая\nтекст';
    },
  });
  await (h.bot as unknown as { cmdKakby(a: string, c: unknown): Promise<void> }).cmdKakby(
    'saveliy оскорби петю',
    ctx(),
  );
  assert.match(h.sent.at(-1)!.text, /не вызываю/);
  assert.equal(called, 0, 'генератор не вызывался');
});

test('/какбы happy path: валидная генерация уходит с маркером', async () => {
  const h = makeBot({
    generateImitation: async () =>
      '🎭 Это воображаемая реплика в манере Saveliy, не настоящая\nНу я же говорил.',
  });
  await (h.bot as unknown as { cmdKakby(a: string, c: unknown): Promise<void> }).cmdKakby(
    'saveliy парковка',
    ctx(),
  );
  assert.match(h.sent.at(-1)!.text, /^🎭 Это воображаемая реплика в манере Saveliy/);
  assert.match(h.sent.at(-1)!.text, /Ну я же говорил\./);
});

test('/какбы: генератор падает → fallback с валидным маркером', async () => {
  const h = makeBot({
    generateImitation: async () => {
      throw new Error('llm down');
    },
  });
  await (h.bot as unknown as { cmdKakby(a: string, c: unknown): Promise<void> }).cmdKakby(
    'saveliy',
    ctx(),
  );
  assert.match(h.sent.at(-1)!.text, /^🎭 Дух Saveliy отдышался/);
  assert.match(h.sent.at(-1)!.text, /отдышался/);
});

test('/off гасит оба слота: активный /игра — с постом, «изобрази» — через cancelActive', async () => {
  const h = makeBot();
  try {
    (h.bot as unknown as { rounds: Map<string, unknown> }).rounds.set(CHAT, {
      finished: false,
      endsAt: Date.now() + 20_000,
      timer: stubTimer(),
    });
    await (h.bot as unknown as { cmdSetEnabled(e: boolean, c: unknown): Promise<void> }).cmdSetEnabled(false, ctx());
    assert.equal(h.session.enabled, false);
    assert.ok(h.sent.some((m) => m.text.includes('🛑 Раунд прерван владельцем')));
    assert.equal((h.bot as unknown as { rounds: Map<string, unknown> }).rounds.has(CHAT), false);

    h.session.enabled = true;
    await startImprovRound(h);
    h.sent.length = 0;
    await (h.bot as unknown as { cmdSetEnabled(e: boolean, c: unknown): Promise<void> }).cmdSetEnabled(false, ctx());
    assert.ok(h.sent.some((m) => m.text.includes('🛑 Раунд прерван владельцем')));
    assert.equal(improvOf(h).hasActiveRound(CHAT), null, 'слот «изобрази» свободен');
  } finally {
    h.bot.cancelTimers();
  }
});

function saidFixture(count: number): {
  hits: Array<{ topicId: number; msgId: number }>;
  rows: Map<string, unknown>;
} {
  const hits = Array.from({ length: count }, (_, i) => ({ topicId: 0, msgId: 100 + i }));
  const rows = new Map(
    hits.map((h, i) => [
      `0:${h.msgId}`,
      {
        msg_id: h.msgId,
        text: `Цитата номер ${i + 1} про парковку и всё такое`,
        date_iso: '2024-01-01T00:00:00.000Z',
        reaction_total: i, // score растёт с i → порядок детерминирован
        from_id: '100',
      },
    ]),
  );
  return { hits, rows };
}

function saidCallback(data: string): TgUpdate {
  return {
    update_id: 900,
    callback_query: {
      id: 'cb-said',
      from: { id: 42, first_name: 'Юзер' },
      message: {
        message_id: 1,
        chat: { id: Number(CHAT), type: 'supergroup' },
        from: { id: 42, first_name: 'Юзер', is_bot: false },
      },
      data,
    },
  };
}

test('/сказал: >5 результатов → кнопка «Ещё», колбэк листает дальше', async () => {
  const h = makeBot({ said: saidFixture(7) });
  await (h.bot as unknown as {
    sendSaidQuotes(a: unknown, t: string, q: string, c: unknown): Promise<void>;
  }).sendSaidQuotes(DIRECTORY[0], 'про парковку', 'парковк*', ctx());

  const first = h.sent.at(-1)!;
  assert.match(first.text, /💬 Saveliy про «парковку»/, 'стоп-слово «про» убрано из заголовка');
  assert.match(first.text, /1\. \[01\.01\.2024\] Цитата номер 7/);
  assert.match(first.text, /5\. \[01\.01\.2024\] Цитата номер 3/);
  assert.doesNotMatch(first.text, /Цитата номер 2\b/);
  const btn = first.markup?.inline_keyboard[0]?.[0];
  assert.ok(btn, 'кнопка «Ещё» есть');
  assert.match(btn.text, /Ещё 2 ▸ \(осталось 2\)/);
  const token = btn.callback_data.replace('said:', '');

  await h.bot.handleUpdate(saidCallback(`said:${token}`));
  const second = h.sent.at(-1)!;
  assert.match(second.text, /💬 Saveliy про «парковку» \(продолжение\)/);
  assert.match(second.text, /6\. \[01\.01\.2024\] Цитата номер 2/);
  assert.match(second.text, /7\. \[01\.01\.2024\] Цитата номер 1/);
  assert.equal(second.markup, undefined, 'кнопки больше нет — лист закончился');
});

test('/сказал: неизвестный/просроченный токен пагинации → «Лист устарел»', async () => {
  const h = makeBot({ said: saidFixture(7) });
  await h.bot.handleUpdate(saidCallback('said:nope1234'));
  assert.match(h.answered.at(-1) ?? '', /Лист устарел/);
});

test('/какбы диалог: реплай на реплику духа → продолжение с историей', async () => {
  const calls: string[][] = [];
  const h = makeBot({
    generateImitation: async (_a, history: Array<{ role: string; content: string }>, _s) => {
      calls.push(history.map((m) => m.content));
      return '🎭 Дух Saveliy:\nОтвечаю в манере.';
    },
  });
  await (h.bot as unknown as { cmdKakby(a: string, c: unknown): Promise<void> }).cmdKakby('saveliy', ctx());
  assert.equal(h.sent.length, 1, 'дух поприветствовал');
  const spiritMsgId = 100 + h.sent.length; // id первой реплики духа

  await h.bot.handleUpdate(messageUpdate(500, spiritMsgId, 'а что думаешь про судейство?', 42));
  assert.equal(h.sent.length, 2, 'пришла вторая реплика');
  assert.match(h.sent.at(-1)!.text, /^🎭 Дух Saveliy:/);
  assert.equal(calls.length, 2, 'LLM вызван дважды');
  assert.ok(
    calls[1].some((c) => c.includes('а что думаешь про судейство?')),
    'текст юзера дошёл до LLM',
  );
  assert.ok(
    calls[1].some((c) => c.includes('Отвечаю в манере.')),
    'в истории — прошлая реплика духа (без маркера)',
  );
  assert.ok(
    !calls[1].some((c) => c.includes('🎭')),
    'маркер не попадает в историю',
  );
});

test('/какбы диалог: реплай на чужое сообщение и посторонний текст — молчание', async () => {
  const h = makeBot({
    generateImitation: async () => '🎭 Дух Saveliy:\nтекст',
  });
  await (h.bot as unknown as { cmdKakby(a: string, c: unknown): Promise<void> }).cmdKakby('saveliy', ctx());
  assert.equal(h.sent.length, 1);
  await h.bot.handleUpdate(messageUpdate(501, 999, 'реплай на чужое', 42));
  await h.bot.handleUpdate(messageUpdate(502, undefined, 'просто болтовня', 42));
  assert.equal(h.sent.length, 1, 'дух молчит без триггера');
});

test('/какбы стоп — сеанс закрыт, дух молчит', async () => {
  const h = makeBot({
    generateImitation: async () => '🎭 Дух Saveliy:\nпривет',
  });
  const bot = h.bot as unknown as { cmdKakby(a: string, c: unknown): Promise<void> };
  await bot.cmdKakby('saveliy', ctx());
  const spiritMsgId = 100 + h.sent.length;
  await bot.cmdKakby('стоп', ctx());
  assert.match(h.sent.at(-1)!.text, /Сеанс окончен/);
  await h.bot.handleUpdate(messageUpdate(503, spiritMsgId, 'алло?', 42));
  assert.equal(h.sent.length, 2, 'после стопа дух молчит');
});

test('/какбы стоп без сеанса — честное «никого не вызываю»', async () => {
  const h = makeBot();
  await (h.bot as unknown as { cmdKakby(a: string, c: unknown): Promise<void> }).cmdKakby('стоп', ctx());
  assert.match(h.sent.at(-1)!.text, /никого не вызываю/);
});

test('weightedDistractors: k разных авторов, без повторов, k > пула → весь пул', () => {
  const pool: AuthorEntry[] = Array.from({ length: 20 }, (_, i) => ({
    fromId: String(i),
    name: `Автор ${i}`,
    messages: i + 1,
    textMessages: i + 1,
    firstDate: '2022-03-23T00:00:00.000Z',
    lastDate: '2026-09-18T00:00:00.000Z',
  }));
  const picked = weightedDistractors(pool, 7);
  assert.equal(picked.length, 7, 'ровно k выбрано');
  assert.equal(new Set(picked.map((e) => e.fromId)).size, 7, 'все разные');
  const ids = new Set(pool.map((e) => e.fromId));
  for (const p of picked) assert.ok(ids.has(p.fromId), 'каждый выбранный из пула');
  const all = weightedDistractors(pool, 100);
  assert.equal(all.length, 20, 'k больше пула → весь пул без дублей');
});

test('weightedDistractors: активные авторы выбираются чаще молчунов', () => {
  const loud: AuthorEntry[] = Array.from({ length: 3 }, (_, i) => ({
    fromId: `loud${i}`,
    name: `Громкий ${i}`,
    messages: 500,
    textMessages: 500,
    firstDate: '2022-03-23T00:00:00.000Z',
    lastDate: '2026-09-18T00:00:00.000Z',
  }));
  const quiet: AuthorEntry[] = Array.from({ length: 30 }, (_, i) => ({
    fromId: `q${i}`,
    name: `Тихий ${i}`,
    messages: 1,
    textMessages: 1,
    firstDate: '2022-03-23T00:00:00.000Z',
    lastDate: '2026-09-18T00:00:00.000Z',
  }));
  const loudSet = new Set(loud.map((e) => e.fromId));
  let loudPicks = 0;
  const runs = 2000;
  for (let i = 0; i < runs; i++) {
    const picked = weightedDistractors([...loud, ...quiet], 1);
    if (loudSet.has(picked[0].fromId)) loudPicks++;
  }
  // 3 громких (вес 500) против 30 тихих (вес 1): ожидание ~1500/2000, допускаем шум
  assert.ok(loudPicks > runs * 0.7, `громкие доминируют: ${loudPicks}/${runs}`);
});

test('dispatch #58: /уровень доступен не-owner, /блоги и /авто — молчание (owner-only)', async () => {
  // ownerChatId: null в makeBot → все апдейты не-owner; gamification не инжектнут,
  // поэтому guard-ответ cmdLevel доказывает достижимость публичной секции диспетчера.
  const h = makeBot();
  try {
    await h.bot.handleUpdate(messageUpdate(600, undefined, '/уровень'));
    assert.equal(h.sent.length, 1, '/уровень — публичная: не-owner получает ответ');
    assert.match(h.sent[0]?.text ?? '', /Геймификация недоступна/);
    await h.bot.handleUpdate(messageUpdate(601, undefined, '/блоги'));
    await h.bot.handleUpdate(messageUpdate(602, undefined, '/авто idinafakty on'));
    await h.bot.handleUpdate(messageUpdate(603, undefined, '/пост idinafakty Рождество'));
    assert.equal(h.sent.length, 1, 'owner-команды для не-owner — молчание');
  } finally {
    h.bot.cancelTimers();
  }
});

test('dispatch #58: owner проходит гейт — /блоги отвечает списком блогов', async () => {
  // Зеркало теста выше: молчание для не-owner не доказывает, что легитимный
  // owner доходит до cmdBlogs (гейт bot.ts: if (!ctx.isOwner) return).
  const ownerSent: Array<{ chatId: string; text: string; replyTo?: number }> = [];
  const blogs: BlogRow[] = [
    {
      id: 1,
      slug: 'idinafakty',
      name: 'Иди на факты глянь',
      profile: null,
      tg_chat_id: null,
      sources: null,
      style_preset: 'default',
      system_prompt: null,
      context_prompt: null,
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ];
  const automationCommands = new BotAutomationCommands({
    automation: {
      getRule: () => null,
      listRuns: () => [],
      upsertRule: () => true,
      runNow: async () => ({ blogId: 1, status: 'success', message: 'Пост создан', postId: 1 }),
    },
    blogs: { listBlogs: () => blogs },
    send: async (chatId, text, replyTo) => {
      ownerSent.push({ chatId, text, replyTo });
    },
  });
  const h = makeBot({ ownerChatId: '777', automationCommands });
  try {
    await h.bot.handleUpdate(messageUpdate(610, undefined, '/блоги', 777));
    assert.equal(ownerSent.length, 1, 'owner получает ответ на /блоги');
    assert.equal(ownerSent[0]?.chatId, CHAT);
    assert.equal(ownerSent[0]?.replyTo, 610);
    assert.match(ownerSent[0]?.text ?? '', /idinafakty \(#1\) — «Иди на факты глянь»/);
    // Тот же бот: не-owner по-прежнему молчит (гейт стоит до automationCommands).
    await h.bot.handleUpdate(messageUpdate(611, undefined, '/блоги', 42));
    assert.equal(ownerSent.length, 1, 'не-owner ответа не получает');
    assert.equal(h.sent.length, 0, 'ответ шёл через automationCommands.send, не через общий outbox');
  } finally {
    h.bot.cancelTimers();
  }
});

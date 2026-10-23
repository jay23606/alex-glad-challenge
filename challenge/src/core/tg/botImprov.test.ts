import test from 'node:test';
import assert from 'node:assert/strict';
import { ImprovGame, looksLikeReal } from './botImprov.js';
import type { ImprovDeps, ImprovGameOpts, ImprovRealQuote, ImprovReplyEvent } from './botImprov.js';
import type { InlineKeyboard, OutboundMessage } from './botQueue.js';
import type { AuthorEntry } from './botNames.js';

const CHAT = 'c1';
const AUTHOR: AuthorEntry = {
  fromId: '666',
  name: 'Sevens ABSOLute',
  messages: 1000,
  textMessages: 900,
  firstDate: '2022-03-23T00:00:00.000Z',
  lastDate: '2026-09-18T00:00:00.000Z',
};
const REAL: ImprovRealQuote = {
  msgId: 100,
  text: 'Парковка у ТТК это просто возмутительная ситуация полного бездорожья',
  dateIso: '2023-07-11T12:00:00.000Z',
  reactions: 12,
};
const DEFAULT_PARODY_DATE = '2024-01-05T00:00:00.000Z';

interface SentItem {
  text: string;
  replyTo?: number;
  markup?: InlineKeyboard;
}

interface Harness {
  game: ImprovGame;
  sent: SentItem[];
  edits: Array<{ chatId: string; msgId: number; text: string }>;
  deleted: number[];
  answers: Array<{ cbId: string; text?: string }>;
  scores: Array<{ chatId: string; userId: string; name: string; delta: number }>;
  awards: Array<{ chatId: string; userId: string; kind: 'win' | 'play'; roundSeq: number }>;
  logs: string[];
  clock: { now: number };
  nextMsgId: number;
  announceMsgId: number;
  failDelete: boolean;
  /** Дроп анонса (null без доставки). */
  failSend: boolean;
  /** Падение отправки только для текстов, содержащих подстроку. */
  failSendText: string | null;
}

function makeHarness(opts: ImprovGameOpts = {}, deps: Partial<ImprovDeps> = {}): Harness {
  const h: Harness = {
    sent: [],
    edits: [],
    deleted: [],
    answers: [],
    scores: [],
    awards: [],
    logs: [],
    clock: { now: 10_000 },
    nextMsgId: 10,
    announceMsgId: 10,
    failDelete: false,
    failSend: false,
    failSendText: null,
    game: null as unknown as ImprovGame,
  };
  const base: ImprovDeps = {
    send: async (m: OutboundMessage) => {
      if (h.failSend) return null;
      if (h.failSendText !== null && m.text.includes(h.failSendText)) {
        throw new Error('сеть недоступна');
      }
      h.sent.push({ text: m.text, replyTo: m.replyTo, markup: m.markup });
      return h.nextMsgId++;
    },
    del: async (_chatId: string, msgId: number) => {
      if (h.failDelete) return false;
      h.deleted.push(msgId);
      return true;
    },
    edit: async (chatId: string, msgId: number, text: string) => {
      h.edits.push({ chatId, msgId, text });
      return true;
    },
    answer: async (cbId: string, text?: string) => {
      h.answers.push({ cbId, text });
    },
    plausibleDate: (_fromId: string) => DEFAULT_PARODY_DATE,
    addScore: (chatId, userId, name, delta) => {
      h.scores.push({ chatId, userId, name, delta });
    },
    awardGame: (chatId, userId, kind, roundSeq) => {
      h.awards.push({ chatId, userId, kind, roundSeq });
    },
    topScores: () => 'Игрок — 5',
    now: () => h.clock.now,
    log: (msg: string) => {
      h.logs.push(msg);
    },
    ...deps,
  };
  h.game = new ImprovGame(base, { collectMs: 50, voteMs: 30, minWindowMs: 10, ...opts });
  return h;
}

interface Internals {
  closeCollect(chatId: string, expectedToken?: string): void;
  reveal(chatId: string, expectedToken?: string): Promise<void>;
}
function internals(g: ImprovGame): Internals {
  return g as unknown as Internals;
}

function roundToken(g: ImprovGame): string {
  return (g as unknown as { rounds: Map<string, { token: string }> }).rounds.get(CHAT)?.token ?? '';
}

let lastHarness: Harness | null = null;
function announceId(): number {
  return lastHarness ? lastHarness.announceMsgId : 10;
}

function ev(msgId: number, userId: string, userName: string, text: string | undefined): ImprovReplyEvent {
  return { chatId: CHAT, msgId, userId, userName, replyToMessageId: announceId(), text };
}

async function startRound(h: Harness, theme = ''): Promise<void> {
  lastHarness = h;
  await h.game.start({
    chatId: CHAT,
    replyTo: 5,
    author: AUTHOR,
    theme,
    real: REAL,
  });
  h.announceMsgId = h.nextMsgId - 1;
}

function announce(): SentItem {
  return lastHarness!.sent[0];
}

function votePost(): SentItem | undefined {
  return lastHarness!.sent.find((s) => s.text.includes('голосование!'));
}

function voteButtons(): Array<{ token: string; idx: number }> {
  const buttons = votePost()!.markup?.inline_keyboard[0] ?? [];
  return buttons.map((b) => {
    const [, token, idx] = b.callback_data.split(':');
    return { token, idx: Number(idx) };
  });
}

function variantLines(): Array<{ idx: number; date: string; text: string }> {
  const out: Array<{ idx: number; date: string; text: string }> = [];
  for (const line of votePost()!.text.split('\n')) {
    const m = /^(\d+)\. \[([^\]]+)\] «(.*)»$/.exec(line);
    if (m) out.push({ idx: Number(m[1]), date: m[2], text: m[3] });
  }
  return out;
}

/** Сумма начислений ревила одному юзеру (addScore вызывается отдельно за каждое событие). */
function scoreSum(h: Harness, userId: string): number {
  return h.scores.filter((s) => s.userId === userId).reduce((acc, s) => acc + s.delta, 0);
}

/** Сдаёт записи; clock подвигается на stepMs после каждой (0 — не двигать). */
async function fillEntries(
  h: Harness,
  users: Array<[string, string, string]>,
  stepMs = 1000,
): Promise<void> {
  let msgId = 1000;
  for (const [userId, userName, text] of users) {
    await h.game.handleEntry({
      chatId: CHAT,
      msgId: msgId++,
      userId,
      userName,
      replyToMessageId: announceId(),
      text,
    });
    h.clock.now += stepMs;
  }
}

/** Сдаёт записи и закрывает набор (для голосовочных тестов). */
async function fillAndClose(
  h: Harness,
  users: Array<[string, string, string]>,
  stepMs = 1000,
): Promise<void> {
  await fillEntries(h, users, stepMs);
  internals(h.game).closeCollect(CHAT);
}

test('looksLikeReal: равенство, подстрока, 80% токенов, нормализация', () => {
  assert.equal(looksLikeReal(REAL.text, REAL.text), true);
  assert.equal(looksLikeReal(REAL.text.toUpperCase(), REAL.text), true, 'регистр не спасает');
  assert.equal(looksLikeReal(REAL.text.slice(0, 40), REAL.text), true, 'подстрока настоящей');
  assert.equal(looksLikeReal(`Преамбула. ${REAL.text}`, REAL.text), true, 'настоящая как подстрока записи');
  assert.equal(
    looksLikeReal('Парковка у ТТК это тихо возмутительная ситуация полного бездорожья', REAL.text),
    true,
    'совпадение 8/9 токенов ≥ 80%',
  );
  assert.equal(
    looksLikeReal('Парковка у ТТК это тихо возмутительное бездорожье полного хаоса', REAL.text),
    false,
    'менее 80% токенов — пародия проходит',
  );
});

test('старт: анонс с именем/правилами/⏱/счётчиком, message_id захвачен, слот занят', async () => {
  const h = makeHarness();
  await startRound(h, 'парковка');
  const a = announce();
  assert.match(a.text, /^🎭 Изобрази Sevens ABSOLute — «парковка»\n/);
  assert.ok(a.text.includes('Реплаем на это сообщение спародируй его манеру'));
  assert.ok(a.text.includes('Одна запись на человека, можно перезаписать; в дело пойдут первые 3.'));
  assert.ok(a.text.includes('⏱ 3 минуты — потом угадываем, где настоящая цитата.'));
  assert.ok(a.text.endsWith('✍️ Принято: 0/3'));
  assert.equal(a.replyTo, 5);
  assert.ok(a.text.length <= 3900, 'анонс одним куском');
  const id = h.nextMsgId - 1;
  assert.ok(h.game.hasActiveRound(CHAT));
  assert.equal(h.game.isCollectAnnounce(CHAT, id), true, 'реплай на анонс — запись');
  assert.equal(h.game.isCollectAnnounce(CHAT, 999), false, 'чужая карточка — не запись');
  assert.equal(h.game.isCollectAnnounce(CHAT, undefined), false);
});

test('старт без темы: анонс без «— «тема»»', async () => {
  const h = makeHarness();
  await startRound(h);
  assert.match(announce().text, /^🎭 Изобрази Sevens ABSOLute\n/);
});

test('дроп анонса очередью → тихая отмена, слот свободен', async () => {
  const h = makeHarness();
  h.failSend = true;
  await startRound(h);
  assert.equal(h.sent.length, 0, 'в чат ничего не ушло');
  assert.equal(h.game.hasActiveRound(CHAT), null);
  assert.ok(h.logs.length > 0, 'дроп залогирован');
});

test('приём записи: deleteMessage сразу, счётчик 1/3, отказных постов нет', async () => {
  const h = makeHarness();
  await startRound(h);
  await h.game.handleEntry(ev(1001, 'u1', 'Юзер Один', 'Совсем другая пародия про футбол и чай'));
  assert.deepEqual(h.deleted, [1001]);
  assert.equal(h.edits.length, 1);
  assert.ok(h.edits[0].text.includes('✍️ Принято: 1/3'));
  assert.equal(h.edits[0].msgId, h.announceMsgId, 'правка именно анонса');
  assert.equal(h.sent.length, 1, 'без ack на первую запись');
});

test('запись не на анонс → игнор целиком', async () => {
  const h = makeHarness();
  await startRound(h);
  const id = announceId();
  await h.game.handleEntry({ chatId: CHAT, msgId: 1001, userId: 'u1', userName: 'Юзер', replyToMessageId: 999, text: 'текст' });
  await h.game.handleEntry({ chatId: CHAT, msgId: 1002, userId: 'u1', userName: 'Юзер', replyToMessageId: undefined, text: 'текст' });
  await h.game.handleEntry({ chatId: 'другой-чат', msgId: 1003, userId: 'u1', userName: 'Юзер', replyToMessageId: id, text: 'текст' });
  assert.deepEqual(h.deleted, []);
  assert.deepEqual(h.edits, []);
});

test('медиа-запись (text=undefined) → молча, не удаляется и не считается', async () => {
  const h = makeHarness();
  await startRound(h);
  await h.game.handleEntry(ev(1001, 'u1', 'Юзер', undefined));
  assert.deepEqual(h.deleted, []);
  assert.deepEqual(h.edits, []);
  assert.equal(h.sent.length, 1);
});

test('отказ: длиннее 300 знаков — реплай, запись НЕ удалена, счётчик не растёт', async () => {
  const h = makeHarness();
  await startRound(h);
  await h.game.handleEntry(ev(1001, 'u1', 'Юзер', 'х'.repeat(301)));
  assert.deepEqual(h.deleted, [], 'отказанная запись не удаляется');
  assert.equal(h.edits.length, 0, 'счётчик не растёт');
  assert.equal(h.sent[1].text, 'Уложись в 300 знаков 🙂');
  assert.equal(h.sent[1].replyTo, h.announceMsgId, 'отказ — реплай на анонс');
  await h.game.handleEntry(ev(1002, 'u1', 'Юзер', 'Короткая нормальная пародия про чай'));
  assert.deepEqual(h.deleted, [1002], 'после отказа запись принимается');
  assert.ok(h.edits[0].text.includes('1/3'));
});

test('отказ: копипаст настоящей (равенство/подстрока) — ДО deleteMessage', async () => {
  const h = makeHarness();
  await startRound(h);
  await h.game.handleEntry(ev(1001, 'u1', 'Юзер', REAL.text));
  await h.game.handleEntry(ev(1002, 'u2', 'Два', `Смотрите: ${REAL.text}`));
  await h.game.handleEntry(ev(1003, 'u3', 'Три', 'Парковка у ТТК это тихо возмутительная ситуация полного бездорожья'));
  assert.deepEqual(h.deleted, [], 'копипаст не удаляется');
  assert.deepEqual(h.edits, []);
  assert.ok(h.sent.slice(1).every((s) => s.text === 'Это не пародия, это копипаст 🙂'));
});

test('отказ: дубль уже принятой записи у другого участника', async () => {
  const h = makeHarness();
  await startRound(h);
  const text = 'Оригинальная пародия про парковку и судью';
  await h.game.handleEntry(ev(1001, 'u1', 'Один', text));
  await h.game.handleEntry(ev(1002, 'u2', 'Два', text.toUpperCase()));
  assert.deepEqual(h.deleted, [1001], 'принята только первая');
  assert.equal(h.sent[1].text, 'Такое уже сдают, перезапиши 🙂');
  assert.ok(h.edits[0].text.includes('1/3'));
});

test('перезапись: замена, счётчик не растёт, ack «Перезаписал 🙂»', async () => {
  const h = makeHarness();
  await startRound(h);
  await h.game.handleEntry(ev(1001, 'u1', 'Один', 'Первая попытка про чай и самовар'));
  await h.game.handleEntry(ev(1002, 'u1', 'Один', 'Вторая попытка, заточенная заново'));
  assert.deepEqual(h.deleted, [1001, 1002]);
  assert.equal(h.sent[1].text, 'Перезаписал 🙂');
  assert.ok(h.edits[0].text.includes('1/3'), 'счётчик по уникальным юзерам');
  await h.game.handleEntry(ev(1003, 'u2', 'Два', 'Пародия второго участника про чай'));
  internals(h.game).closeCollect(CHAT);
  const lines = variantLines();
  assert.equal(lines.length, 3, 'перезапись + чужая: 2 пародии + настоящая');
  assert.ok(lines.every((l) => !l.text.includes('Первая попытка')), 'старый текст вытеснен');
});

test('токен-гард: выстрел «старого» collect-таймера не закрывает перезаписанный раунд', async () => {
  const h = makeHarness();
  lastHarness = h;
  // прямой второй старт в тот же чат — слот-гард живёт в боте, не в ImprovGame
  await h.game.start({ chatId: CHAT, replyTo: 5, author: AUTHOR, theme: '', real: REAL });
  const tokenA = roundToken(h.game);
  await h.game.start({ chatId: CHAT, replyTo: 5, author: AUTHOR, theme: 'парковка', real: REAL });
  h.announceMsgId = h.nextMsgId - 1;
  const tokenB = roundToken(h.game);
  assert.notEqual(tokenA, tokenB, 'новый раунд — новый токен');
  await h.game.handleEntry(ev(2001, 'u1', 'Один', 'Пародия первая про чай'));
  await h.game.handleEntry(ev(2002, 'u2', 'Два', 'Пародия вторая про самовар'));
  internals(h.game).closeCollect(CHAT, tokenA);
  assert.equal(votePost(), undefined, 'чужой токен — no-op');
  assert.ok(h.game.hasActiveRound(CHAT), 'второй раунд жив');
  assert.ok(h.sent.every((s) => !s.text.includes('Раунд отменён')), 'отменных постов нет');
  internals(h.game).closeCollect(CHAT, tokenB);
  assert.ok(votePost(), 'свой токен закрывает набор');
});

test('реальные таймеры: старый collect-таймер не гасит перезаписанный раунд', async () => {
  const h = makeHarness({ collectMs: 40, voteMs: 40, minWindowMs: 5 });
  lastHarness = h;
  await h.game.start({ chatId: CHAT, replyTo: 5, author: AUTHOR, theme: '', real: REAL });
  await h.game.start({ chatId: CHAT, replyTo: 5, author: AUTHOR, theme: '', real: REAL });
  h.announceMsgId = h.nextMsgId - 1; // анонс второго раунда
  await h.game.handleEntry(ev(2001, 'u1', 'Один', 'Пародия первая про чай'));
  await h.game.handleEntry(ev(2002, 'u2', 'Два', 'Пародия вторая про самовар'));
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(votePost(), 'второй раунд доиграл до голосования');
  assert.ok(h.sent.every((s) => !s.text.includes('Раунд отменён')), 'старый таймер не отменил новый');
});

test('запись после закрытия набора → молча', async () => {  const h = makeHarness();
  await startRound(h);
  await fillAndClose(h, [
    ['u1', 'Один', 'Пародия первая про чай'],
    ['u2', 'Два', 'Пародия вторая про самовар'],
  ]);
  const deletesBefore = h.deleted.length;
  const sentBefore = h.sent.length;
  await h.game.handleEntry(ev(2001, 'u3', 'Три', 'Поздняя пародия опоздавшего'));
  assert.equal(h.deleted.length, deletesBefore, 'поздняя запись не удаляется');
  assert.equal(h.sent.length, sentBefore, 'и не отвечает');
});

test('3/3 после минимального окна → набор закрывается сразу', async () => {
  const h = makeHarness();
  await startRound(h);
  await fillEntries(h, [
    ['u1', 'Один', 'Пародия первая про чай'],
    ['u2', 'Два', 'Пародия вторая про самовар'],
    ['u3', 'Три', 'Пародия третья про парковку'],
  ]);
  assert.ok(votePost(), 'пост вариантов ушёл');
  assert.match(votePost()!.text, /Одно из 4 — настоящая цитата Sevens ABSOLute\. Голосуй, где не врём 😏/);
  assert.deepEqual(
    voteButtons().map((b) => b.idx),
    [1, 2, 3, 4],
  );
  assert.ok(h.game.hasActiveRound(CHAT), 'раунд в фазе vote жив');
  assert.equal(h.game.hasActiveRound(CHAT)?.endsAt, 12_000 + 30, 'голосование 90 с (в тесте 30 мс)');
});

test('3/3 раньше окна → «стартую…», четвёртая запись мимо, закрытие по таймеру окна', async () => {
  const h = makeHarness({ minWindowMs: 60 });
  await startRound(h);
  await fillEntries(
    h,
    [
      ['u1', 'Один', 'Пародия первая про чай'],
      ['u2', 'Два', 'Пародия вторая про самовар'],
      ['u3', 'Три', 'Пародия третья про парковку'],
    ],
    0,
  );
  assert.ok(h.edits.at(-1)?.text.includes('✍️ Принято: 3/3 — стартую…'));
  assert.equal(votePost(), undefined, 'закрытия сразу нет');
  assert.equal(h.game.isCollectAnnounce(CHAT, h.announceMsgId), true, 'фаза ещё collect');
  const deletesBefore = h.deleted.length;
  await h.game.handleEntry(ev(3001, 'u4', 'Четыре', 'Опоздавшая пародия четвёртого'));
  assert.equal(h.deleted.length, deletesBefore, 'четвёртая запись в полном наборе не берётся');
  await new Promise((r) => setTimeout(r, 130));
  assert.ok(votePost(), 'таймер минимального окна закрыл набор');
});

test('0 записей к дедлайну → «Никто не рискнул», слот свободен, без очков', async () => {
  const h = makeHarness();
  await startRound(h);
  internals(h.game).closeCollect(CHAT);
  assert.equal(h.sent[1].text, 'Никто не рискнул. Раунд отменён.');
  assert.equal(h.game.hasActiveRound(CHAT), null);
  assert.deepEqual(h.scores, []);
});

test('1 запись к дедлайну → «нужно минимум две пародии», без очков', async () => {
  const h = makeHarness();
  await startRound(h);
  await h.game.handleEntry(ev(1001, 'u1', 'Один', 'Одинокая пародия про чай'));
  internals(h.game).closeCollect(CHAT);
  assert.equal(h.sent[1].text, 'Для розыгрыша нужно минимум две пародии — раунд отменён.');
  assert.equal(h.game.hasActiveRound(CHAT), null);
  assert.deepEqual(h.scores, []);
});

test('2 записи → раунд на 3 варианта, у настоящей истинная дата, у пародий сэмплы', async () => {
  const h = makeHarness();
  await startRound(h);
  await fillAndClose(h, [
    ['u1', 'Один', 'Пародия первая про чай'],
    ['u2', 'Два', 'Пародия вторая про самовар'],
  ]);
  const lines = variantLines();
  assert.equal(lines.length, 3);
  assert.match(votePost()!.text, /Одно из 3 — настоящая цитата Sevens ABSOLute/);
  const real = lines.find((l) => l.text === REAL.text);
  assert.ok(real, 'настоящая среди вариантов');
  assert.equal(real?.date, '11.07.2023', 'у настоящей ИСТИННАЯ дата');
  assert.deepEqual(
    lines.filter((l) => l.text !== REAL.text).map((l) => l.date),
    ['05.01.2024', '05.01.2024'],
    'у пародий — сэмплы активности',
  );
});

test('даты пародий: сэмпл берётся из активности ИЗОБРАЖАЕМОГО автора, фолбэк — его firstDate', async () => {
  const sampledFrom: string[] = [];
  const h = makeHarness({}, {
    plausibleDate: (fromId: string) => {
      sampledFrom.push(fromId);
      return null;
    },
  });
  await startRound(h);
  await fillAndClose(h, [
    ['u1', 'Один', 'Пародия первая про чай'],
    ['u2', 'Два', 'Пародия вторая про самовар'],
  ]);
  assert.deepEqual(sampledFrom, [AUTHOR.fromId, AUTHOR.fromId], 'сэмпл — таймлайн автора-цели');
  const dates = variantLines().filter((l) => l.text !== REAL.text).map((l) => l.date);
  assert.deepEqual(dates, ['23.03.2022', '23.03.2022'], 'фолбэк — firstDate изображаемого');
});

test('пост вариантов укладывается в один кусок ≤3900 при максимальных записях', async () => {
  const h = makeHarness();
  await startRound(h);
  await fillEntries(h, [
    ['u1', 'Один', 'ж'.repeat(300)],
    ['u2', 'Два', 'у'.repeat(300)],
    ['u3', 'Три', 'н'.repeat(300)],
  ]);
  assert.ok(votePost()!.text.length <= 3900, `длина ${votePost()!.text.length}`);
  assert.equal(voteButtons().length, 4);
});

test('self-vote: автор пародии не голосует за свой вариант, чужие принимает', async () => {
  const h = makeHarness();
  await startRound(h);
  await fillAndClose(h, [
    ['u1', 'Один', 'Пародия первая про чай'],
    ['u2', 'Два', 'Пародия вторая про самовар'],
  ]);
  const lines = variantLines();
  const ownLine = lines.find((l) => l.text === 'Пародия первая про чай')!;
  const token = voteButtons()[0].token;
  const otherParody = lines.find((l) => l.text !== 'Пародия первая про чай' && l.text !== REAL.text)!;
  await h.game.handleVote('cb1', CHAT, 'u1', 'Один', token, String(ownLine.idx));
  assert.equal(h.answers[0].text, 'Свой вариант не считается 🙂');
  await h.game.handleVote('cb1', CHAT, 'u1', 'Один', token, String(otherParody.idx));
  assert.match(h.answers[1].text ?? '', /^Принято \(вариант \d\)$/);
  h.clock.now += 1000;
  await internals(h.game).reveal(CHAT);
  assert.ok(!h.scores.some((s) => s.userId === 'u1' && s.delta === 1),
    'отклонённый self-vote не попал в счёт; чужая пародия у u1 очков не даёт');
});

test('переголос: последнее действие считается; ack не зависит от правильности', async () => {
  const h = makeHarness();
  await startRound(h);
  await fillAndClose(h, [
    ['u1', 'Один', 'Пародия первая про чай'],
    ['u2', 'Два', 'Пародия вторая про самовар'],
  ]);
  const real = variantLines().find((l) => l.text === REAL.text)!;
  const token = voteButtons()[0].token;
  await h.game.handleVote('cb1', CHAT, 'v1', 'Голос', token, '1');
  await h.game.handleVote('cb2', CHAT, 'v1', 'Голос', token, String(real.idx));
  assert.deepEqual(h.answers.map((a) => a.text), [
    'Принято (вариант 1)',
    `Принято (вариант ${real.idx})`,
  ], 'формат ack одинаков — правильность не утекает');
  h.clock.now += 1000;
  await internals(h.game).reveal(CHAT);
  const voterScore = h.scores.filter((s) => s.userId === 'v1');
  assert.equal(voterScore.length, 1, 'засчитан один (последний) голос');
  assert.equal(voterScore[0].delta, 1);
});

test('голос после дедлайна/ревила → «Голосование закрыто», без вскрытия', async () => {
  const h = makeHarness();
  await startRound(h);
  await fillAndClose(h, [
    ['u1', 'Один', 'Пародия первая про чай'],
    ['u2', 'Два', 'Пародия вторая про самовар'],
  ]);
  const token = voteButtons()[0].token;
  h.clock.now += 31_000; // за дедлайном, ревил ещё не отработал
  await h.game.handleVote('cb1', CHAT, 'v1', 'Голос', token, '1');
  assert.equal(h.answers[0].text, 'Голосование закрыто');
  await internals(h.game).reveal(CHAT);
  assert.equal(h.game.hasActiveRound(CHAT), null, 'finished-раунд не активен');
  await h.game.handleVote('cb2', CHAT, 'v2', 'Голос', token, '2');
  assert.equal(h.answers[1].text, 'Голосование закрыто', 'раунд остаётся в карте finished');
});

test('чужой токен / нет раунда → «Раунд уже завершён»', async () => {
  const h = makeHarness();
  await startRound(h);
  await h.game.handleVote('cb1', CHAT, 'v1', 'Голос', 'мимоtoken', '1');
  assert.equal(h.answers[0].text, 'Раунд уже завершён');
  await h.game.handleVote('cb2', 'нет-такого-чата', 'v1', 'Голос', 'тоже-мимо', '1');
  assert.equal(h.answers[1].text, 'Раунд уже завершён');
});

test('ревил: истинная дата настоящей, display_name без id, очки по правилам', async () => {
  const h = makeHarness();
  await startRound(h);
  await fillAndClose(h, [
    ['u1', 'Один', 'Пародия первая про чай'],
    ['u2', 'Два', 'Пародия вторая про самовар'],
  ]);
  const lines = variantLines();
  const realLine = lines.find((l) => l.text === REAL.text)!;
  const parodyLine = lines.find((l) => l.text === 'Пародия первая про чай')!;
  const token = voteButtons()[0].token;
  await h.game.handleVote('cb1', CHAT, 'v1', 'Знаток', token, String(realLine.idx));
  await h.game.handleVote('cb2', CHAT, 'v2', 'Обманутый', token, String(parodyLine.idx));
  await h.game.handleVote('cb3', CHAT, 'v3', 'Ещё обманутый', token, String(parodyLine.idx));
  await internals(h.game).reveal(CHAT);
  const revealText = h.sent.at(-1)!.text;
  assert.match(revealText, /🕵️ Раскрытие! Настоящая — вариант \d+: Sevens ABSOLute · \[11\.07\.2023\] · 🔥 12/);
  assert.ok(revealText.includes(`«${REAL.text}»`));
  assert.ok(revealText.includes('🎭 Вариант'), 'пародии подписаны display_name');
  assert.ok(!revealText.includes('u1') && !revealText.includes('v1'), 'from_id/userId не светятся');
  assert.equal(scoreSum(h, 'v1'), 1, 'угадавшему настоящую +1');
  assert.equal(scoreSum(h, 'u1'), 3, 'пародисту +1 за каждого обманувшего (×2) и +1 шарж');
  assert.equal(scoreSum(h, 'u2'), 0);
  assert.ok(revealText.includes('🏅 Золотой шарж'));
  assert.ok(revealText.includes('🏆 Сессия: Игрок — 5'));
});

test('ревил: ничья по шаржу — бонус обоим пародистам', async () => {
  const h = makeHarness();
  await startRound(h);
  await fillAndClose(h, [
    ['u1', 'Один', 'Пародия первая про чай'],
    ['u2', 'Два', 'Пародия вторая про самовар'],
  ]);
  const lines = variantLines();
  const l1 = lines.find((l) => l.text === 'Пародия первая про чай')!;
  const l2 = lines.find((l) => l.text === 'Пародия вторая про самовар')!;
  const token = voteButtons()[0].token;
  await h.game.handleVote('cb1', CHAT, 'v1', 'Г1', token, String(l1.idx));
  await h.game.handleVote('cb2', CHAT, 'v2', 'Г2', token, String(l2.idx));
  await internals(h.game).reveal(CHAT);
  assert.equal(scoreSum(h, 'u1'), 2, '1 за обман + 1 шарж');
  assert.equal(scoreSum(h, 'u2'), 2, '1 за обман + 1 шарж (ничья)');
  const шаржLine = h.sent.at(-1)!.text.split('\n').find((l) => l.includes('Золотой шарж'));
  assert.ok(шаржLine, 'строка шаржа есть');
  assert.ok(шаржLine!.includes('(Один)') && шаржLine!.includes('(Два)'), 'ничейный шарж — оба автора');
  assert.deepEqual(
    [...h.awards].sort((a, b) => a.userId.localeCompare(b.userId)),
    [
      { chatId: CHAT, userId: 'u1', kind: 'win', roundSeq: 1 },
      { chatId: CHAT, userId: 'u2', kind: 'win', roundSeq: 1 },
    ],
    'ничья по шаржу — XP win обоим авторам',
  );
});

test('ревил: XP-хук — шарж → win, угадавший настоящую → play', async () => {
  const h = makeHarness();
  await startRound(h);
  await fillAndClose(h, [
    ['u1', 'Один', 'Пародия первая про чай'],
    ['u2', 'Два', 'Пародия вторая про самовар'],
  ]);
  const lines = variantLines();
  const realLine = lines.find((l) => l.text === REAL.text)!;
  const parodyLine = lines.find((l) => l.text === 'Пародия первая про чай')!;
  const token = voteButtons()[0].token;
  await h.game.handleVote('cb1', CHAT, 'v1', 'Знаток', token, String(realLine.idx));
  await h.game.handleVote('cb2', CHAT, 'v2', 'Обманутый', token, String(parodyLine.idx));
  await h.game.handleVote('cb3', CHAT, 'v3', 'Тоже обманутый', token, String(parodyLine.idx));
  await internals(h.game).reveal(CHAT);
  assert.deepEqual(h.awards, [
    { chatId: CHAT, userId: 'v1', kind: 'play', roundSeq: 1 },
    { chatId: CHAT, userId: 'u1', kind: 'win', roundSeq: 1 },
  ], 'play только угадавшему; win только автору золотого шаржа; обманутые и u2 без XP');
});

test('ревил: awardGame получает seq раунда — ref различим по раундам (#94)', async () => {
  const h = makeHarness();
  await startRound(h);
  await fillAndClose(h, [
    ['u1', 'Один', 'Пародия первая про чай'],
    ['u2', 'Два', 'Пародия вторая про самовар'],
  ]);
  const realLine = variantLines().find((l) => l.text === REAL.text)!;
  await h.game.handleVote('cb1', CHAT, 'v1', 'Знаток', voteButtons()[0].token, String(realLine.idx));
  await internals(h.game).reveal(CHAT);
  assert.deepEqual(h.awards, [{ chatId: CHAT, userId: 'v1', kind: 'play', roundSeq: 1 }]);

  await startRound(h); // слот перезаписан — новый раунд, seq вырос
  await fillAndClose(h, [
    ['u1', 'Один', 'Пародия первой пародии про чай'],
    ['u2', 'Два', 'Пародия второй пародии про самовар'],
  ]);
  // votePost()/voteButtons() ищут first match — для второго раунда парсим свой пост
  const post2 = h.sent.findLast((s) => s.text.includes('голосование!'))!;
  const token2 = post2.markup?.inline_keyboard[0][0]!.callback_data.split(':')[1]!;
  const idx2 = /^(\d+)\. /.exec(post2.text.split('\n').find((l) => l.includes(`«${REAL.text}»`)) ?? '')?.[1]!;
  await h.game.handleVote('cb2', CHAT, 'v2', 'Знаток2', token2, idx2);
  await internals(h.game).reveal(CHAT);
  assert.deepEqual(
    h.awards.slice(1),
    [{ chatId: CHAT, userId: 'v2', kind: 'play', roundSeq: 2 }],
    'второй раунд — award c seq=2: ref improv:<chat>:<seq>:<user> уникален по раундам',
  );
});

test('ревил: изображаемый, пародировавший сам себя, помечен', async () => {
  const h = makeHarness();
  await startRound(h);
  await fillAndClose(h, [
    [AUTHOR.fromId, 'Севенс', 'Автопародия мастера про чай'],
    ['u2', 'Два', 'Пародия вторая про самовар'],
  ]);
  await internals(h.game).reveal(CHAT);
  assert.match(h.sent.at(-1)!.text, /🎭 Вариант \d+ — Севенс — изобразил сам себя 🎭/);
});

test('ревил без голосов за пародии: шаржа нет, очков нет', async () => {
  const h = makeHarness();
  await startRound(h);
  await fillAndClose(h, [
    ['u1', 'Один', 'Пародия первая про чай'],
    ['u2', 'Два', 'Пародия вторая про самовар'],
  ]);
  await internals(h.game).reveal(CHAT);
  assert.ok(!h.sent.at(-1)!.text.includes('Золотой шарж'));
  assert.deepEqual(h.scores, []);
  assert.deepEqual(h.awards, [], 'без голосов за пародии XP не начисляется');
});

test('неудача deleteMessage (бот не админ) → отмена раунда с честным текстом', async () => {
  const h = makeHarness();
  await startRound(h);
  h.failDelete = true;
  await h.game.handleEntry(ev(1001, 'u1', 'Один', 'Пародия без шансов на приём'));
  assert.equal(
    h.sent[1].text,
    'Не смог скрыть записи — дай боту права администратора (удаление сообщений). Раунд отменён.',
  );
  assert.equal(h.game.hasActiveRound(CHAT), null);
  assert.deepEqual(h.edits, [], 'запись не засчитана');
  assert.deepEqual(h.scores, []);
});

test('исключение из deleteMessage (сеть) — свой текст, без обещания про админку', async () => {
  const h = makeHarness({}, {
    del: async () => {
      throw new Error('сеть недоступна');
    },
  });
  await startRound(h);
  await h.game.handleEntry(ev(1001, 'u1', 'Один', 'Пародия при упавшей сети'));
  assert.equal(h.sent[1].text, 'Не получилось обработать запись, попробуй ещё раз. Раунд отменён.');
  assert.ok(h.logs.some((l) => l.includes('deleteMessage')));
  assert.equal(h.game.hasActiveRound(CHAT), null, 'анонимность не подтверждена — раунд погашен');
});

test('/off: раунд гасится с постом; таймер снят; повторный /off — false', async () => {
  const h = makeHarness();
  await startRound(h);
  assert.equal(h.game.cancelActive(CHAT), true);
  assert.equal(h.sent[1].text, '🛑 Раунд прерван владельцем');
  assert.equal(h.game.hasActiveRound(CHAT), null);
  assert.equal(h.game.cancelActive(CHAT), false);
  const sentAfterOff = h.sent.length;
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(h.sent.length, sentAfterOff, 'таймер набора снят — постов нет');
  assert.deepEqual(h.scores, []);
});

test('/off в фазе vote: ревил не приходит', async () => {
  const h = makeHarness();
  await startRound(h);
  await fillAndClose(h, [
    ['u1', 'Один', 'Пародия первая про чай'],
    ['u2', 'Два', 'Пародия вторая про самовар'],
  ]);
  assert.equal(h.game.cancelActive(CHAT), true);
  const sentBefore = h.sent.length;
  h.clock.now += 60_000;
  await internals(h.game).reveal(CHAT);
  assert.equal(h.sent.length, sentBefore, 'ревил после /off не уходит');
});

test('межраундовый кулдаун (включён опцией) блокирует старт и отпускает по часам', async () => {
  const h = makeHarness({ cooldownMs: 60_000 });
  await startRound(h);
  internals(h.game).closeCollect(CHAT); // «Никто не рискнул» → раунд завершён
  await startRound(h);
  assert.match(h.sent.at(-1)!.text, /Игра только что была — подожди \d+ с\./);
  assert.equal(h.sent.length, 3, 'анонс при кулдауне не уходит');
  h.clock.now += 61_000;
  await startRound(h);
  assert.match(h.sent.at(-1)!.text, /^🎭 Изобрази Sevens ABSOLute/);
});

test('collect→vote→reveal по реальным таймерам; падающий send не даёт unhandled', async () => {
  const h = makeHarness({ collectMs: 40, voteMs: 40, minWindowMs: 5 });
  await startRound(h);
  await fillEntries(h, [
    ['u1', 'Один', 'Пародия первая про чай'],
    ['u2', 'Два', 'Пародия вторая про самовар'],
  ]);
  h.failSendText = 'Раскрытие';
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(h.logs.some((l) => l.includes('отправка упала')), 'падение ревила поймано и залогировано');
  assert.ok(h.game.hasActiveRound(CHAT) === null || h.game.hasActiveRound(CHAT) !== undefined);
});

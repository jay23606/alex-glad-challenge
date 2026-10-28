import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isReleaseDay,
  computeNextNudgeAt,
  toCapsText,
  buildCapsMessage,
  parseMaximCommand,
  parseTemperature,
  isAddressedToBot,
  stripAddress,
  pickMood,
  pickPingCandidates,
} from './maximBot.js';

const EPOCH = '2026-10-06'; // релиз 41
const PERIOD = 14;

test('isReleaseDay: только день релиза, день после — обычный', () => {
  assert.equal(isReleaseDay(new Date(2026, 9, 6, 15, 0), EPOCH, PERIOD), true); // релиз 41
  assert.equal(isReleaseDay(new Date(2026, 9, 7, 9, 0), EPOCH, PERIOD), false); // день после
  assert.equal(isReleaseDay(new Date(2026, 9, 8, 9, 0), EPOCH, PERIOD), false);
  assert.equal(isReleaseDay(new Date(2026, 9, 20, 12, 0), EPOCH, PERIOD), true); // релиз 43
  assert.equal(isReleaseDay(new Date(2026, 9, 21, 12, 0), EPOCH, PERIOD), false);
  assert.equal(isReleaseDay(new Date(2026, 9, 19, 23, 59), EPOCH, PERIOD), false);
  assert.equal(isReleaseDay(new Date(2026, 9, 5, 12, 0), EPOCH, PERIOD), false); // до эпохи
  assert.equal(isReleaseDay(new Date(2026, 9, 6), 'кривая-дата', PERIOD), false);
});

const SCHED = {
  releaseEpoch: EPOCH,
  releasePeriodDays: PERIOD,
  dailyWindowStartHour: 10,
  dailyWindowEndHour: 20,
};

test('computeNextNudgeAt: релизный день, окно впереди — слот сегодня', () => {
  const now = new Date(2026, 9, 20, 8, 0); // день релиза 43, утро
  const next = computeNextNudgeAt(now, SCHED, () => 0);
  assert.equal(next, new Date(2026, 9, 20, 10, 0).getTime());
});

test('computeNextNudgeAt: релизный день, слот внутри окна — случайный час', () => {
  const now = new Date(2026, 9, 20, 12, 0);
  const next = computeNextNudgeAt(now, SCHED, () => 0.999);
  assert.ok(next > now.getTime());
  assert.ok(next <= new Date(2026, 9, 20, 20, 0).getTime());
});

test('computeNextNudgeAt: релизный день, окно прошло — следующий релиз', () => {
  const now = new Date(2026, 9, 20, 21, 0); // слот сегодня уже прошёл
  const next = computeNextNudgeAt(now, SCHED, () => 0);
  assert.equal(next, new Date(2026, 10, 3, 10, 0).getTime()); // релиз 45
});

test('computeNextNudgeAt: обычный день — ближайший релиз', () => {
  const now = new Date(2026, 9, 8, 12, 0); // обычный день
  const next = computeNextNudgeAt(now, SCHED, () => 0);
  assert.equal(next, new Date(2026, 9, 20, 10, 0).getTime());
});

test('computeNextNudgeAt: до эпохи — первый релиз', () => {
  const now = new Date(2026, 8, 30, 12, 0);
  const next = computeNextNudgeAt(now, SCHED, () => 0);
  assert.equal(next, new Date(2026, 9, 6, 10, 0).getTime());
});

test('computeNextNudgeAt: битая эпоха — напутствий нет', () => {
  const cfg = { ...SCHED, releaseEpoch: 'кривая-дата' };
  const next = computeNextNudgeAt(new Date(2026, 9, 20, 12, 0), cfg, () => 0);
  assert.ok(next >= 8.64e15);
});

test('toCapsText: верхний регистр и восклицания', () => {
  assert.equal(toCapsText('с продом повнимательнее'), 'С ПРОДОМ ПОВНИМАТЕЛЬНЕЕ!!!');
  assert.equal(toCapsText('переводи в ревью!'), 'ПЕРЕВОДИ В РЕВЬЮ!');
});

test('buildCapsMessage: капс + пинги, без пингов — только капс', () => {
  assert.equal(
    buildCapsMessage('с продом повнимательнее', ['sevens', 'temi4']),
    'С ПРОДОМ ПОВНИМАТЕЛЬНЕЕ!!!\n@sevens @temi4',
  );
  assert.equal(buildCapsMessage('переводи в ревью', []), 'ПЕРЕВОДИ В РЕВЬЮ!!!');
  assert.equal(buildCapsMessage('переводи в ревью', ['']), 'ПЕРЕВОДИ В РЕВЬЮ!!!');
});

test('parseMaximCommand: префиксные команды, аргументы, @суффикс', () => {
  assert.deepEqual(parseMaximCommand('/start'), { name: 'start', arg: '' });
  assert.deepEqual(parseMaximCommand('/start@alert_max_temi4_bot', 'alert_max_temi4_bot'), {
    name: 'start',
    arg: '',
  });
  assert.deepEqual(parseMaximCommand('/maxim_temp'), { name: 'temp', arg: '' });
  assert.deepEqual(parseMaximCommand('/maxim_temp 1.3'), { name: 'temp', arg: '1.3' });
  assert.deepEqual(parseMaximCommand('/maxim_say'), { name: 'say', arg: '' });
  assert.deepEqual(parseMaximCommand('/maxim_status'), { name: 'status', arg: '' });
  assert.deepEqual(parseMaximCommand('/MAXIM_TEMP@alert_max_temi4_bot 0.5', 'alert_max_temi4_bot'), {
    name: 'temp',
    arg: '0.5',
  });
  assert.equal(parseMaximCommand('/maxim_temp@OtherBot 0.5', 'alert_max_temi4_bot'), null);
  assert.equal(parseMaximCommand('/temp 1.3'), null); // без префикса — не наша
  assert.equal(parseMaximCommand('просто текст'), null);
});

test('parseTemperature: 0–2, запятая, мусор — null', () => {
  assert.equal(parseTemperature('1.3'), 1.3);
  assert.equal(parseTemperature('0'), 0);
  assert.equal(parseTemperature('2'), 2);
  assert.equal(parseTemperature('0,7'), 0.7);
  assert.equal(parseTemperature('2.1'), null);
  assert.equal(parseTemperature('-1'), null);
  assert.equal(parseTemperature('много'), null);
});

const BOT = { botId: 8974515926, botUsername: 'alert_max_temi4_bot' };

test('isAddressedToBot: реплай боту, @упоминание, имя в начале', () => {
  assert.equal(isAddressedToBot({ text: 'ок', replyFromId: BOT.botId, ...BOT }), true);
  assert.equal(isAddressedToBot({ text: 'ок', replyFromId: 123, ...BOT }), false);
  assert.equal(isAddressedToBot({ text: '@alert_max_temi4_bot глянь задачу', ...BOT }), true);
  assert.equal(isAddressedToBot({ text: 'глянь @ALERT_MAX_TEMI4_BOT задачу', ...BOT }), true);
  assert.equal(isAddressedToBot({ text: 'максим, с продом что?', ...BOT }), true);
  assert.equal(isAddressedToBot({ text: 'Максим Артемьевич! тесты упали', ...BOT }), true);
  assert.equal(isAddressedToBot({ text: 'макс: прими ревью', ...BOT }), true);
  assert.equal(isAddressedToBot({ text: 'а максим в курсе?', ...BOT }), false); // имя не в начале
  assert.equal(isAddressedToBot({ text: 'максимилиан, привет', ...BOT }), false); // другое имя
  assert.equal(isAddressedToBot({ text: 'просто сообщение в чат', ...BOT }), false);
});

test('stripAddress: срезает @упоминание и ведущее имя', () => {
  assert.equal(stripAddress('@alert_max_temi4_bot глянь задачу', BOT.botUsername), 'глянь задачу');
  assert.equal(stripAddress('максим, с продом что?', BOT.botUsername), 'с продом что?');
  assert.equal(stripAddress('Максим Артемьевич! тесты упали', BOT.botUsername), 'тесты упали');
  assert.equal(stripAddress('просто текст', BOT.botUsername), 'просто текст');
});

test('pickMood: вспышка по кубику', () => {
  assert.equal(pickMood(() => 0.0), 'angry');
  assert.equal(pickMood(() => 0.149), 'angry');
  assert.equal(pickMood(() => 0.15), 'calm');
  assert.equal(pickMood(() => 0.9), 'calm');
});

const PINGS = [
  { id: 1, username: 'maxim', lastSeen: 500, lastPingedAt: 0 },
  { id: 2, username: 'temi4', lastSeen: 400, lastPingedAt: 0 },
  { id: 3, username: 'alina', lastSeen: 300, lastPingedAt: 0 },
  { id: 4, username: 'kot', lastSeen: 200, lastPingedAt: 0 },
  { id: 5, username: 'kirill', lastSeen: 100, lastPingedAt: 0 },
];

test('pickPingCandidates: без истории пингов — поочерёдно, а не самые свежие', () => {
  // Все lastPingedAt равны → берём тех, кто дольше молчал, а не топ по lastSeen.
  const picked = pickPingCandidates(PINGS, 999, 3);
  assert.deepEqual(picked.map((p) => p.username), ['kirill', 'kot', 'alina']);
});

test('pickPingCandidates: ротация — следующим заходом идут другие', () => {
  const now = 1000;
  const round1 = pickPingCandidates(PINGS, 999, 3);
  assert.deepEqual(round1.map((p) => p.username), ['kirill', 'kot', 'alina']);
  for (const p of round1) p.lastPingedAt = now;
  // Раунд 2: сначала никогда не пингованные (temi4, maxim), затем — самый
  // давний из пингованных (kirill).
  const round2 = pickPingCandidates(PINGS, 999, 3);
  assert.deepEqual(round2.map((p) => p.username), ['temi4', 'maxim', 'kirill']);
  // Раунд 3: все пингованы → сначала те, чей пинг старее, среди равных —
  // кто дольше молчал.
  const later = 2000;
  for (const p of round2) p.lastPingedAt = later;
  const round3 = pickPingCandidates(PINGS, 999, 3);
  assert.deepEqual(round3.map((p) => p.username), ['kot', 'alina', 'kirill']);
});

test('pickPingCandidates: автор исключается, без юзернейма не пингуем', () => {
  const list = [
    { id: 1, username: 'maxim', lastSeen: 500, lastPingedAt: 0 },
    { id: 2, username: undefined, lastSeen: 400, lastPingedAt: 0 },
    { id: 3, username: 'alina', lastSeen: 300, lastPingedAt: 0 },
  ];
  assert.deepEqual(
    pickPingCandidates(list, 1, 3).map((p) => p.username),
    ['alina'],
  );
});

test('pickPingCandidates: никогда не пингованные (lastPingedAt=0) идут первыми', () => {
  const list = [
    { id: 1, username: 'a', lastSeen: 900, lastPingedAt: 100 },
    { id: 2, username: 'b', lastSeen: 10, lastPingedAt: 0 },
    { id: 3, username: 'c', lastSeen: 800, lastPingedAt: 50 },
  ];
  assert.deepEqual(
    pickPingCandidates(list, 999, 2).map((p) => p.username),
    ['b', 'c'],
  );
});

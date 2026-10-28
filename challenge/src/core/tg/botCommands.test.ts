import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, extractInvocation, BOT_COMMANDS } from './botCommands.js';

test('parseCommand: базовые команды M1', () => {
  assert.deepEqual(parseCommand('/цитата'), { name: 'цитата', args: '' });
  assert.deepEqual(parseCommand('/цитата севенс'), { name: 'цитата', args: 'севенс' });
  assert.deepEqual(parseCommand('/сказал севенс парковка у ТТК'), {
    name: 'сказал',
    args: 'севенс парковка у ТТК',
  });
  assert.deepEqual(parseCommand('/игра'), { name: 'игра', args: '' });
  assert.deepEqual(parseCommand('/стат'), { name: 'стат', args: '' });
  assert.deepEqual(parseCommand('/reindex'), { name: 'reindex', args: '' });
  assert.deepEqual(parseCommand('/алиас сёва Saveliy'), { name: 'алиас', args: 'сёва Saveliy' });
  assert.deepEqual(parseCommand('/алиасскан Temi4 Facts'), { name: 'алиасскан', args: 'Temi4 Facts' });
  assert.deepEqual(parseCommand('/off'), { name: 'off', args: '' });
  assert.deepEqual(parseCommand('/on'), { name: 'on', args: '' });
});

test('parseCommand: регистр и @имя-бота', () => {
  assert.deepEqual(parseCommand('/ЦИТАТА'), { name: 'цитата', args: '' });
  const r = parseCommand('/сказал@MediumBot парковка', 'MediumBot');
  assert.deepEqual(r, { name: 'сказал', args: 'парковка' });
  assert.equal(parseCommand('/цитата@OtherBot', 'MediumBot'), null);
});

test('parseCommand: /изобрази <имя> [тема…]', () => {
  assert.deepEqual(parseCommand('/изобрази севенс парковка'), {
    name: 'изобрази',
    args: 'севенс парковка',
  });
  assert.deepEqual(parseCommand('/ИЗОБРАЗИ савелий'), { name: 'изобрази', args: 'савелий' });
  assert.deepEqual(parseCommand('/изобрази@MediumBot севенс', 'MediumBot'), {
    name: 'изобрази',
    args: 'севенс',
  });
  assert.deepEqual(parseCommand('/изобрази'), { name: 'изобрази', args: '' });
});

test('parseCommand: не-команды и чужие команды → null', () => {
  assert.equal(parseCommand(null), null);
  assert.equal(parseCommand(''), null);
  assert.equal(parseCommand('привет /цитата'), null);
  assert.equal(parseCommand('/неизвестная foo'), null);
});

test('extractInvocation: @упоминание «на это сказал …»', () => {
  const r = extractInvocation('@MediumBot на это сказал савелий трансферы', 'MediumBot');
  assert.deepEqual(r, { name: 'сказал', args: 'савелий трансферы' });
  const r2 = extractInvocation('@mediumbot сказал севенс судейство', 'MediumBot');
  assert.deepEqual(r2, { name: 'сказал', args: 'севенс судейство' });
});

test('extractInvocation: @упоминание с командой и «как бы»', () => {
  assert.deepEqual(extractInvocation('@medium /цитата', 'medium'), { name: 'цитата', args: '' });
  assert.deepEqual(extractInvocation('@medium как бы отреагировал краснобелый', 'medium'), {
    name: 'какбы',
    args: '',
  });
  assert.equal(extractInvocation('@medium', 'medium'), null);
});

test('parseCommand: новые брендированные имена medium_* и кириллические м-*', () => {
  assert.deepEqual(parseCommand('/medium_quote'), { name: 'цитата', args: '' });
  assert.deepEqual(parseCommand('/MEDIUM_SAID севенс парковка'), { name: 'сказал', args: 'севенс парковка' });
  assert.deepEqual(parseCommand('/medium_game'), { name: 'игра', args: '' });
  assert.deepEqual(parseCommand('/medium_improv севенс'), { name: 'изобрази', args: 'севенс' });
  assert.deepEqual(parseCommand('/medium_asif севенс парковка'), { name: 'какбы', args: 'севенс парковка' });
  assert.deepEqual(parseCommand('/мцитата'), { name: 'цитата', args: '' });
  assert.deepEqual(parseCommand('/мсказал севенс судейство'), { name: 'сказал', args: 'севенс судейство' });
  assert.deepEqual(parseCommand('/мигра'), { name: 'игра', args: '' });
  assert.deepEqual(parseCommand('/мизобрази севенс'), { name: 'изобрази', args: 'севенс' });
  assert.deepEqual(parseCommand('/мкакбы севенс'), { name: 'какбы', args: 'севенс' });
});

test('parseCommand: старые короткие имена остаются алиасами', () => {
  assert.deepEqual(parseCommand('/quote'), { name: 'цитата', args: '' });
  assert.deepEqual(parseCommand('/QUOTE'), { name: 'цитата', args: '' });
  assert.deepEqual(parseCommand('/said севенс парковка'), {
    name: 'сказал',
    args: 'севенс парковка',
  });
  assert.deepEqual(parseCommand('/game'), { name: 'игра', args: '' });
  assert.deepEqual(parseCommand('/improv севенс'), { name: 'изобрази', args: 'севенс' });
  assert.deepEqual(parseCommand('/asif севенс парковка'), { name: 'какбы', args: 'севенс парковка' });
  assert.deepEqual(parseCommand('/stat'), { name: 'стат', args: '' });
  assert.deepEqual(parseCommand('/post nevsky-hram Рождество'), {
    name: 'пост',
    args: 'nevsky-hram Рождество',
  });
  assert.deepEqual(parseCommand('/alias сёва Saveliy'), { name: 'алиас', args: 'сёва Saveliy' });
  assert.deepEqual(parseCommand('/reindex'), { name: 'reindex', args: '' });
});

test('parseCommand: /start не игровая команда (обрабатывается отдельно в bot.ts)', () => {
  assert.equal(parseCommand('/start'), null);
  assert.equal(parseCommand('/start@memo7repost_bot', 'memo7repost_bot'), null);
});

test('extractInvocation: обычный текст не инвокация', () => {
  assert.equal(extractInvocation('на это сказал савелий', 'medium'), null);
  assert.equal(extractInvocation('просто сообщение @другойбот', 'medium'), null);
});

test('BOT_COMMANDS: фиксированный набор M1 + брендированные + админские + gamification/automation', () => {
  assert.deepEqual(
    [...BOT_COMMANDS].sort(),
    [
      'off',
      'on',
      'reindex',
      'авто',
      'алиас',
      'алиасскан',
      'блоги',
      'игра',
      'изобрази',
      'какбы',
      'пост',
      'сказал',
      'стат',
      'уровень',
      'цитата',
    ],
  );
});

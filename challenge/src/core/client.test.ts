// Тесты LlmClient: гигиена ошибок (нет утечки тела ответа провайдера).
// Регрессия issue #139: chatRaw при !resp.ok включал тело ответа в Error —
// оно может уйти в логи/наружу через safeMessage (он не чистит произвольные тела).

import test from 'node:test';
import assert from 'node:assert/strict';

import { LlmClient } from './client.js';
import { msg } from './types.js';

// Секретный маркер как будто вернул провайдер (квоты, модели, отражённый промпт).
const SECRET = 'SECRET-PROVIDER-PAYLOAD-42';

function providerClient(): LlmClient {
  // Loopback-адрес валиден: fetch замокан, сети нет.
  return new LlmClient({ baseUrl: 'http://127.0.0.1:9', apiKey: 'test-key', defaultModel: 'test' });
}

test('chatRaw: ошибка API не содержит тело ответа провайдера (только статус)', async (t) => {
  const mocked = () =>
    new Response(JSON.stringify({ error: { message: SECRET } }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  t.mock.method(globalThis, 'fetch', mocked);

  await assert.rejects(
    providerClient().chatRaw({ model: 'test', messages: [msg.user('привет')] }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /LLM API error 429/);
      assert.ok(!err.message.includes(SECRET), 'тело ответа не должно попадать в Error');
      return true;
    },
  );
});

test('chatRaw: ок-ответ не тронут (регресс не ломает happy path)', async (t) => {
  const mocked = () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: 'ок' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  t.mock.method(globalThis, 'fetch', mocked);

  const content = await providerClient().chatRaw({ model: 'test', messages: [msg.user('привет')] });
  assert.equal(content.choices[0]?.message?.content, 'ок');
});

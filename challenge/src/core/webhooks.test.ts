import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  WebhookDb,
  validateWebhookUrl,
  signPayload,
  verifySignature,
  deliverEvent,
} from './webhooks.js';

test('webhooks: validateWebhookUrl отклоняет небезопасные URL', () => {
  assert.throws(() => validateWebhookUrl('not-a-url'), RangeError);
  assert.throws(() => validateWebhookUrl('ftp://x/y'), RangeError);
  assert.throws(() => validateWebhookUrl('https://user:pass@x/y'), RangeError);
  assert.throws(() => validateWebhookUrl('http://169.254.169.254/latest'), RangeError);
  assert.equal(validateWebhookUrl('https://example.com/hook'), 'https://example.com/hook');
  assert.equal(validateWebhookUrl('http://127.0.0.1:9000/h'), 'http://127.0.0.1:9000/h');
});

test('webhooks: подпись и проверка HMAC', () => {
  const sig = signPayload('secret', '{"a":1}');
  assert.equal(verifySignature('secret', '{"a":1}', sig), true);
  assert.equal(verifySignature('other', '{"a":1}', sig), false);
  assert.equal(verifySignature('secret', '{"a":2}', sig), false);
  // Fail-closed (аудит #98): пустой секрет (DEFAULT '' в схеме) не аутентифицирует.
  assert.equal(verifySignature('', '{"a":1}', signPayload('', '{"a":1}')), false);
});

test('webhooks: подпись по сырым байтам (Uint8Array) — BOM и битый UTF-8 (issue #98)', () => {
  const bomBody = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a":1}')]);
  const bomSig = signPayload('secret', bomBody);
  assert.equal(verifySignature('secret', bomBody, bomSig), true);
  // Строка без BOM — другие байты: подпись байт с BOM не подходит.
  assert.equal(verifySignature('secret', '{"a":1}', bomSig), false);
  const brokenBody = Buffer.concat([Buffer.from('{"a":"'), Buffer.from([0xff]), Buffer.from('"}')]);
  const brokenSig = signPayload('secret', brokenBody);
  assert.equal(verifySignature('secret', brokenBody, brokenSig), true);
  // Декодированная строка (0xFF → U+FFFD) — другие байты.
  const decoded = new TextDecoder().decode(brokenBody);
  assert.equal(verifySignature('secret', decoded, brokenSig), false);
});

test('webhooks: deliverEvent доставляет только подписанным на событие', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'webhook-'));
  try {
    const db = new WebhookDb(path.join(dir, 'w.sqlite'));
    db.create({ name: 'a', url: 'http://127.0.0.1:9000/a', events: ['post_published'], secret: 'outbound-secret-a' });
    db.create({ name: 'b', url: 'http://127.0.0.1:9000/b', events: ['todo_completed'], enabled: false });
    db.create({ name: 'c', url: 'http://127.0.0.1:9000/c', events: ['automation_run'] });

    const received: string[] = [];
    const captured: Array<{ body: string; signature: string | undefined }> = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      received.push(String(url));
      captured.push({
        body: typeof init?.body === 'string' ? init.body : '',
        signature: (init?.headers as Record<string, string> | undefined)?.['x-artel-signature'],
      });
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    const delivered = await deliverEvent(db, 'post_published', { id: 1 }, { fetchFn });
    assert.equal(delivered, 1);
    assert.deepEqual(received, ['http://127.0.0.1:9000/a']);

    // Контракт outbound→inbound (issue #98): подпись доставленного тела валидна
    // при проверке по байтам — тем же путём, что и inbound-роут.
    assert.ok(captured[0]?.signature);
    assert.equal(
      verifySignature('outbound-secret-a', new TextEncoder().encode(captured[0].body), captured[0].signature),
      true,
    );

    const deliveries = db.listDeliveries();
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].event, 'post_published');
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('webhooks: ошибка сети фиксируется как error, не бросается наружу', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'webhook-'));
  try {
    const db = new WebhookDb(path.join(dir, 'w.sqlite'));
    db.create({ name: 'a', url: 'http://127.0.0.1:9000/a', events: ['post_published'] });
    const fetchFn = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const delivered = await deliverEvent(db, 'post_published', {}, { fetchFn });
    assert.equal(delivered, 0);
    assert.equal(db.listDeliveries()[0].status, 'error');
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

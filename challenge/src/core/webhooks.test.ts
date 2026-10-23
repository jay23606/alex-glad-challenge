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
});

test('webhooks: deliverEvent доставляет только подписанным на событие', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'webhook-'));
  try {
    const db = new WebhookDb(path.join(dir, 'w.sqlite'));
    db.create({ name: 'a', url: 'http://127.0.0.1:9000/a', events: ['post_published'] });
    db.create({ name: 'b', url: 'http://127.0.0.1:9000/b', events: ['todo_completed'], enabled: false });
    db.create({ name: 'c', url: 'http://127.0.0.1:9000/c', events: ['automation_run'] });

    const received: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      received.push(String(url));
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    const delivered = await deliverEvent(db, 'post_published', { id: 1 }, { fetchFn });
    assert.equal(delivered, 1);
    assert.deepEqual(received, ['http://127.0.0.1:9000/a']);

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

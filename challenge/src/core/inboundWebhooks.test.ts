import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { InboundHookDb, handleInboundEvent } from './inboundWebhooks.js';
import { signPayload, verifySignature } from './webhooks.js';
import { NotificationDb, NotificationService } from './notifications.js';
import { TodoDb } from './todoDb.js';

function withTmp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'inbound-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

test('inbound: create генерит секрет, list/get не требуют его знания', () => {
  withTmp((dir) => {
    const db = new InboundHookDb(path.join(dir, 'w.sqlite'));
    const a = db.create({ name: 'deploy', target: 'notification' });
    const b = db.create({ name: 'ci', target: 'todo' });
    assert.ok(a.secret.length >= 32);
    assert.notEqual(a.secret, b.secret);
    assert.equal(db.get(a.id)?.target, 'notification');
    assert.equal(db.list().length, 2);
    assert.equal(db.delete(b.id), true);
    assert.equal(db.get(b.id), null);
    assert.equal(db.delete(b.id), false);
    db.close();
  });
});

test('inbound: create валидирует name и target', () => {
  withTmp((dir) => {
    const db = new InboundHookDb(path.join(dir, 'w.sqlite'));
    assert.throws(() => db.create({ name: '   ', target: 'notification' }), RangeError);
    // target — закрытый литеральный набор
    assert.throws(
      () => db.create({ name: 'x', target: 'email' as 'notification' }),
      RangeError,
    );
    db.close();
  });
});

test('inbound: подпись валидна/невалидна (verifySignature по секрету хука)', () => {
  withTmp((dir) => {
    const db = new InboundHookDb(path.join(dir, 'w.sqlite'));
    const { id, secret } = db.create({ name: 'hook', target: 'notification' });
    const body = JSON.stringify({ title: 'deploy finished' });
    const sig = signPayload(secret, body);
    assert.equal(verifySignature(secret, body, sig), true);
    assert.equal(verifySignature(secret, body, 'deadbeef'), false);
    assert.equal(verifySignature(secret, body + ' ', sig), false);
    assert.equal(verifySignature('other-secret', body, sig), false);
    assert.ok(id > 0);
    db.close();
  });
});

test('inbound: handleInboundEvent target=notification создаёт уведомление', () => {
  withTmp((dir) => {
    const hooks = new InboundHookDb(path.join(dir, 'w.sqlite'));
    const notifications = new NotificationDb(path.join(dir, 'n.sqlite'));
    const service = new NotificationService(notifications);
    const { id } = hooks.create({ name: 'deploy', target: 'notification' });
    const hook = hooks.get(id);
    assert.ok(hook);

    const nid = handleInboundEvent(hook, { title: 'релиз 1.2.3', body: 'ok', href: '/blog' }, {
      notifications: service,
    });
    const rows = notifications.list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, nid);
    assert.equal(rows[0].type, 'system');
    assert.equal(rows[0].title, 'deploy: релиз 1.2.3');
    assert.equal(rows[0].href, '/blog');
    hooks.close();
    notifications.close();
  });
});

test('inbound: handleInboundEvent target=todo создаёт задачу', () => {
  withTmp((dir) => {
    const hooks = new InboundHookDb(path.join(dir, 'w.sqlite'));
    const todos = new TodoDb(path.join(dir, 't.sqlite'));
    const { id } = hooks.create({ name: 'ci', target: 'todo' });
    const hook = hooks.get(id);
    assert.ok(hook);

    const tid = handleInboundEvent(hook, { title: 'build failed', body: 'tests red' }, { todos });
    const rows = todos.listTodos('pending');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, tid);
    assert.equal(rows[0].text, '[ci] build failed — tests red');
    hooks.close();
    todos.close();
  });
});

test('inbound: handleInboundEvent защищает инварианты без границы', () => {
  withTmp((dir) => {
    const hooks = new InboundHookDb(path.join(dir, 'w.sqlite'));
    const { id } = hooks.create({ name: 'hook', target: 'notification' });
    const hook = hooks.get(id);
    assert.ok(hook);
    assert.throws(
      () => handleInboundEvent(hook, { title: '   ' }, {}),
      RangeError,
    );
    assert.throws(
      () => handleInboundEvent(hook, { title: 'x' }, {}),
      /notifications dependency is required/,
    );
    hooks.close();
  });
});

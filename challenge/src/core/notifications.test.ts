import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { NotificationDb, NotificationService } from './notifications.js';

function makeDb(): { db: NotificationDb; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'notify-'));
  return { db: new NotificationDb(path.join(dir, 'n.sqlite')), dir };
}

test('notifications: unread-счётчик и отметка прочитанным', () => {
  const { db, dir } = makeDb();
  try {
    const id1 = db.add({ type: 'post_published', title: 'a', body: 'b' });
    db.add({ type: 'todo_due', title: 'c', body: 'd' });
    assert.equal(db.unreadCount(), 2);
    assert.equal(db.list(10, true).length, 2);

    assert.ok(db.markRead(id1));
    assert.equal(db.unreadCount(), 1);

    assert.equal(db.markAllRead(), 1);
    assert.equal(db.unreadCount(), 0);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('notifications: ошибка канала не теряет запись', () => {
  const { db, dir } = makeDb();
  try {
    const service = new NotificationService(db, [
      {
        send() {
          throw new Error('down');
        },
      },
    ]);
    const id = service.notify({ type: 'system', title: 't', body: 'b' });
    assert.equal(db.unreadCount(), 1);
    assert.ok(id > 0);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

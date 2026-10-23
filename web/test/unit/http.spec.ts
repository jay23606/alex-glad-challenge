import { describe, expect, it } from 'vitest';

import { jsonOk, jsonError } from '../../lib/server/http';

describe('http helpers', () => {
  it('jsonOk добавляет ok:true и no-store', () => {
    const res = jsonOk({ id: 1 });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    void res.json().then((body) => expect(body).toEqual({ ok: true, id: 1 }));
  });

  it('jsonError возвращает {error} с no-store', () => {
    const res = jsonError('bad', 400);
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    void res.json().then((body) => expect(body).toEqual({ error: 'bad' }));
  });
});

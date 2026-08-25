import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { DbLike } from '../plugins/db.js';

describe('GET /api/health', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 200 with status ok and db up when the DB check succeeds', async () => {
    const stubDb: DbLike = { checkDb: async () => true };
    app = await buildApp({ db: stubDb });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.status).toBe('ok');
    expect(payload.db).toBe('up');
  });

  it('returns a non-2xx error envelope with db down when the DB check fails', async () => {
    const stubDb: DbLike = { checkDb: async () => false };
    app = await buildApp({ db: stubDb });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(503);
    const payload = response.json();
    expect(payload.error.code).toBe('SERVICE_UNAVAILABLE');
  });
});

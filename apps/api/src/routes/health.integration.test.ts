import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

// Boots the REAL app (real db plugin, no stub) and hits GET /api/health
// against a real Postgres instance (Docker locally, `services.postgres` in
// CI). This is the harness the user required to keep validating the lazy
// pg pool end-to-end. Run via `pnpm test:integration`, separate from the
// unit suite so unit tests never require Postgres.
describe('GET /api/health (integration, real Postgres)', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 200 with db up when the real database is reachable', async () => {
    app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.status).toBe('ok');
    expect(payload.db).toBe('up');
  });
});

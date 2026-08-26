import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors.js';
import { fetchSession } from './session.js';

/** Builds a Response-shaped stub; `json` rejects when `body` is omitted. */
function stubFetch(response: { ok: boolean; status: number; body?: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status,
      json: async () => {
        if (!('body' in response)) throw new SyntaxError('Unexpected token');
        return response.body;
      },
    }),
  );
}

describe('fetchSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the usuario on a 200 response', async () => {
    const usuario = {
      id: '1',
      nombre: 'Ana',
      email: 'ana@test.com',
      rol: 'encargado' as const,
      debeCambiarPassword: false,
    };
    stubFetch({ ok: true, status: 200, body: { usuario } });

    await expect(fetchSession()).resolves.toEqual(usuario);
  });

  it('returns null on a 401 ApiError instead of rethrowing', async () => {
    stubFetch({
      ok: false,
      status: 401,
      body: { error: { code: 'UNAUTHORIZED', message: 'No autorizado' } },
    });

    await expect(fetchSession()).resolves.toBeNull();
  });

  it('rethrows any other ApiError', async () => {
    stubFetch({
      ok: false,
      status: 500,
      body: { error: { code: 'INTERNAL_ERROR', message: 'Boom' } },
    });

    const error = await fetchSession().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
  });

  it('rethrows a non-ApiError failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('network down')),
    );

    await expect(fetchSession()).rejects.toBeInstanceOf(TypeError);
  });
});

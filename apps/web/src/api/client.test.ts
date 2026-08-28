import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './client.js';
import { ApiError, isApiError } from './errors.js';

/** Builds a Response-shaped stub; `json` rejects when `body` is omitted. */
function stubFetch(response: {
  ok: boolean;
  status: number;
  body?: unknown;
}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status,
    json: async () => {
      if (!('body' in response)) throw new SyntaxError('Unexpected token');
      return response.body;
    },
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the /api URL and sends credentials include', async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      body: { status: 'ok' },
    });

    await apiFetch('/health');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('returns the parsed body on a 2xx response', async () => {
    stubFetch({ ok: true, status: 200, body: { status: 'ok' } });

    await expect(apiFetch('/health')).resolves.toEqual({ status: 'ok' });
  });

  it('throws an ApiError carrying the envelope code, message and details', async () => {
    stubFetch({
      ok: false,
      status: 423,
      body: {
        error: {
          code: 'ACCOUNT_LOCKED',
          message: 'Cuenta bloqueada',
          details: { retryAfter: 300 },
        },
      },
    });

    // The UI branches on `code`; losing it is what this whole seam exists to prevent.
    const error = await apiFetch('/auth/login').catch((e: unknown) => e);

    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({
      status: 423,
      code: 'ACCOUNT_LOCKED',
      message: 'Cuenta bloqueada',
      details: { retryAfter: 300 },
    });
  });

  it('falls back to UNEXPECTED_RESPONSE when the body is not valid JSON', async () => {
    stubFetch({ ok: false, status: 502 });

    const error = await apiFetch('/health').catch((e: unknown) => e);

    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({ status: 502, code: 'UNEXPECTED_RESPONSE' });
    expect((error as ApiError).message).toContain('502');
  });

  it('falls back to UNEXPECTED_RESPONSE when the body does not match the envelope', async () => {
    stubFetch({ ok: false, status: 500, body: { oops: true } });

    const error = await apiFetch('/health').catch((e: unknown) => e);

    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({ status: 500, code: 'UNEXPECTED_RESPONSE' });
  });

  it('leaves details undefined when the envelope omits them', async () => {
    stubFetch({
      ok: false,
      status: 401,
      body: { error: { code: 'UNAUTHORIZED', message: 'No autorizado' } },
    });

    const error = await apiFetch('/auth/me').catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect((error as ApiError).details).toBeUndefined();
  });

  // Fastify's JSON parser rejects an empty body when the request declares
  // `Content-Type: application/json`, and app.ts maps that rejection to a 500.
  // Sending the header unconditionally therefore broke every bodyless POST:
  // `POST /api/auth/logout` answered 500 in this exact shape. The API's own
  // tests missed it because `app.inject` only sends the headers a test passes.
  it('omits Content-Type when the request carries no body', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: { ok: true } });

    await apiFetch('/auth/logout', { method: 'POST' });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as
      | Record<string, string>
      | undefined;
    expect(headers).not.toHaveProperty('Content-Type');
  });

  it('sends Content-Type: application/json when the request carries a body', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: { ok: true } });

    await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.c' }),
    });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as
      | Record<string, string>
      | undefined;
    expect(headers?.['Content-Type']).toBe('application/json');
  });

  it('lets an explicit Content-Type from the caller win', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: { ok: true } });

    await apiFetch('/upload', {
      method: 'POST',
      body: 'raw',
      headers: { 'Content-Type': 'text/plain' },
    });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as
      | Record<string, string>
      | undefined;
    expect(headers?.['Content-Type']).toBe('text/plain');
  });
});

describe('isApiError', () => {
  it('rejects a plain Error', () => {
    expect(isApiError(new Error('boom'))).toBe(false);
  });

  it('accepts an ApiError', () => {
    expect(isApiError(new ApiError(500, 'INTERNAL_ERROR', 'boom'))).toBe(true);
  });
});

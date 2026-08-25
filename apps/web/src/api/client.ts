import { ApiError } from './errors.js';

/** Used when the response body is not the API's error envelope. */
const FALLBACK_CODE = 'UNEXPECTED_RESPONSE';

type ErrorEnvelope = {
  error: { code: string; message: string; details?: unknown };
};

/**
 * Narrows an already-parsed body to the API's error envelope. Anything else —
 * a proxy's HTML error page, a truncated response — falls back, so the UI
 * always receives a typed error instead of a crash.
 */
function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  if (typeof body !== 'object' || body === null) return false;
  const { error } = body as { error?: unknown };
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === 'string' && typeof message === 'string';
}

async function toApiError(response: Response): Promise<ApiError> {
  const fallback = () =>
    new ApiError(
      response.status,
      FALLBACK_CODE,
      `API request failed with status ${response.status}`,
    );

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return fallback();
  }

  if (!isErrorEnvelope(body)) return fallback();

  return new ApiError(
    response.status,
    body.error.code,
    body.error.message,
    body.error.details,
  );
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  return (await response.json()) as T;
}

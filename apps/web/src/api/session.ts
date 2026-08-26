import { queryOptions } from '@tanstack/react-query';
import { apiFetch } from './client.js';
import { isApiError } from './errors.js';
import type { paths } from './schema.js';

/** Shape of the `usuario` object returned by `/api/auth/me` and `/api/auth/login`. */
export type Usuario =
  paths['/api/auth/me']['get']['responses']['200']['content']['application/json']['usuario'];

type MeResponse =
  paths['/api/auth/me']['get']['responses']['200']['content']['application/json'];

/**
 * Fetches the current session. A 401 means "no session" rather than an
 * error (D13): the guards need a definite answer, not an error state. Any
 * other failure (e.g. a 500) rethrows — that is not "logged out".
 */
export async function fetchSession(): Promise<Usuario | null> {
  try {
    const { usuario } = await apiFetch<MeResponse>('/auth/me');
    return usuario;
  } catch (error) {
    if (isApiError(error) && error.status === 401) return null;
    throw error;
  }
}

/**
 * `retry: false` and a 30s `staleTime` so route navigation does not re-hit
 * `/me` on every click (Render free tier cold starts).
 */
export const sessionQueryOptions = queryOptions({
  queryKey: ['session'] as const,
  queryFn: fetchSession,
  retry: false,
  staleTime: 30_000,
});

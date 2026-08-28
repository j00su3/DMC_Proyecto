import { queryOptions } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';

/**
 * Query key factory (D7) with a list/detail discriminator, so "refetch every
 * page but only this detail" stays expressible — exactly what PATCH needs.
 *
 * D9 (uniform rule, not per-mutation judgement): no mutation in this feature
 * ever calls `queryClient.setQueryData`. All five usuarios mutations
 * (create, update, deactivate, reactivate, password-reset) invalidate
 * instead. This is a deliberate departure from `useLogin.ts`/
 * `useChangePassword.ts`'s in-repo precedent — right there because the login
 * response *is* the session; here a mutation returns one user while a cache
 * entry is a whole ordered page, and two of the five responses carry a
 * one-time plaintext credential that must never be spliced into a
 * long-lived cache entry (D12).
 */
export const usuariosKeys = {
  all: ['usuarios'] as const,
  lists: () => [...usuariosKeys.all, 'list'] as const,
  list: (page: number) => [...usuariosKeys.lists(), { page }] as const,
  details: () => [...usuariosKeys.all, 'detail'] as const,
  detail: (id: string) => [...usuariosKeys.details(), id] as const,
};

/** Matches the server's default page size (D6) — no picker in this change. */
export const PAGE_SIZE = 20;

type ListResponse =
  paths['/api/usuarios']['get']['responses']['200']['content']['application/json'];

/**
 * Shared between `useUsuarios` (component-level, `keepPreviousData`) and the
 * list route's `loader` (D11's out-of-range correction, which needs the
 * settled response before the component ever renders) — one query
 * definition, two consumers of the same cache entry.
 */
export function usuariosListQueryOptions(page: number) {
  return queryOptions({
    queryKey: usuariosKeys.list(page),
    queryFn: () =>
      apiFetch<ListResponse>(`/usuarios?page=${page}&pageSize=${PAGE_SIZE}`),
  });
}

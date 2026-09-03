import { queryOptions } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';

export type EstadoAlerta = 'activa' | 'vista' | 'resuelta';

/** Key factory mirroring `features/productos/queries.ts:6-13`, keyed by
 * `page`/`estado`, plus a dedicated `conteo()` branch for the polled badge
 * (kept separate from `lists()` so invalidating the list never re-triggers
 * the count poll's own cache entry, and vice versa). */
export const alertasKeys = {
  all: ['alertas'] as const,
  lists: () => [...alertasKeys.all, 'list'] as const,
  list: (page: number, estado?: EstadoAlerta) =>
    [...alertasKeys.lists(), { page, estado }] as const,
  conteo: () => [...alertasKeys.all, 'conteo'] as const,
};

/** Matches the server's default page size (`apps/api/src/lib/pagination.ts`). */
export const PAGE_SIZE = 20;

type ListResponse =
  paths['/api/alertas']['get']['responses']['200']['content']['application/json'];
type ConteoResponse =
  paths['/api/alertas/conteo']['get']['responses']['200']['content']['application/json'];

export function alertasListQueryOptions(page = 1, estado?: EstadoAlerta) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  if (estado) params.set('estado', estado);
  return queryOptions({
    queryKey: alertasKeys.list(page, estado),
    queryFn: () => apiFetch<ListResponse>(`/alertas?${params.toString()}`),
  });
}

/**
 * PD-4: dedicated route (`GET /alertas/conteo`), not the list route's
 * `total` — the badge must not pull full rows over a cold-starting
 * free-tier Render service. `refetchInterval: 60_000` lives HERE, on the
 * options object, so it is assertable by a plain unit test without
 * advancing timers.
 */
export function alertasConteoQueryOptions() {
  return queryOptions({
    queryKey: alertasKeys.conteo(),
    queryFn: () => apiFetch<ConteoResponse>('/alertas/conteo'),
    refetchInterval: 60_000,
  });
}

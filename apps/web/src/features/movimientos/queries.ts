import { queryOptions } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';

/** Key factory mirroring `features/productos/queries.ts:6-13`, keyed by
 * `productoId` and `page` (D4's `listByProducto` scopes by product). */
export const movimientosKeys = {
  all: ['movimientos'] as const,
  lists: () => [...movimientosKeys.all, 'list'] as const,
  list: (productoId: string, page: number) =>
    [...movimientosKeys.lists(), productoId, { page }] as const,
};

/** Matches the server's default page size — no picker in this change. */
export const PAGE_SIZE = 20;

type ListResponse =
  paths['/api/productos/{id}/movimientos']['get']['responses']['200']['content']['application/json'];

/**
 * Shared between `useMovimientos` and any future route `loader`. Follows
 * `productos/queries.ts`'s invalidate-never-`setQueryData` rule: mutations
 * that write a movement invalidate `lists()`, never patch this cache
 * directly (`useRegistrarMovimiento.ts`).
 */
export function movimientosListQueryOptions(productoId: string, page: number) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  return queryOptions({
    queryKey: movimientosKeys.list(productoId, page),
    queryFn: () =>
      apiFetch<ListResponse>(
        `/productos/${productoId}/movimientos?${params.toString()}`,
      ),
  });
}

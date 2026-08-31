import { queryOptions } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';

/**
 * Key factory mirroring `features/productos/queries.ts:6-13`. The POS
 * catalog (`GET /api/ventas/catalogo`, D11) has no search box in this
 * change, so unlike `productosKeys.list`, `page` is the only key input —
 * design.md's Open Question 2 (alphabetical, paginated) has no `q`
 * parameter to key on.
 */
export const posCatalogoKeys = {
  all: ['pos', 'catalogo'] as const,
  lists: () => [...posCatalogoKeys.all, 'list'] as const,
  list: (page: number) => [...posCatalogoKeys.lists(), { page }] as const,
};

/** Matches design.md's Open Question 2 provisional stance — no picker in this change. */
export const PAGE_SIZE = 20;

type CatalogoResponse =
  paths['/api/ventas/catalogo']['get']['responses']['200']['content']['application/json'];

/**
 * Shared between `useCatalogo` and any future route `loader`. D11: the
 * server already excludes inactive products (PD-8) and orders
 * alphabetically, so this options builder only pages — it never filters
 * client-side.
 */
export function catalogoListQueryOptions(page: number) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  return queryOptions({
    queryKey: posCatalogoKeys.list(page),
    queryFn: () =>
      apiFetch<CatalogoResponse>(`/ventas/catalogo?${params.toString()}`),
  });
}

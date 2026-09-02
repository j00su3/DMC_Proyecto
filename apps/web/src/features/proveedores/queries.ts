import { queryOptions } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';

/**
 * Key factory (shape of `features/productos/queries.ts:6-13`). No `details()`
 * branch: D3 — `proveedorDto` is byte-identical between list and detail
 * responses, so the detail pane derives its record from the already-fetched
 * list (`data.find(p => p.id === selected)`) rather than issuing a second
 * `GET /proveedores/:id`. Every mutation in this feature must invalidate
 * both `proveedoresKeys.all` and `proveedoresActivosKeys.all`
 * (`features/productos/useProveedoresActivos.ts`), or creating/editing a
 * supplier here leaves that other feature's dropdown stale.
 */
export const proveedoresKeys = {
  all: ['proveedores', 'maestro'] as const,
  lists: () => [...proveedoresKeys.all, 'list'] as const,
};

/** Server's own max page size (`apps/api/src/lib/pagination.ts`) — D1/PD-1:
 * one unpaginated fetch of the full catalog, no `page`/`pageSize` control. */
export const PAGE_SIZE = 100;

type ListResponse =
  paths['/api/proveedores']['get']['responses']['200']['content']['application/json'];

/**
 * Fresh query (D3) — not reused from `useProveedoresActivos`, which filters
 * to `activo` only and would hide inactive suppliers this screen must show.
 */
export function proveedoresListQueryOptions() {
  return queryOptions({
    queryKey: proveedoresKeys.lists(),
    queryFn: () =>
      apiFetch<ListResponse>(`/proveedores?page=1&pageSize=${PAGE_SIZE}`),
  });
}

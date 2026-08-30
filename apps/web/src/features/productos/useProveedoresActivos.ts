import { queryOptions, useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';

type ListResponse =
  paths['/api/proveedores']['get']['responses']['200']['content']['application/json'];

/**
 * `GET /api/proveedores` supports only `page`/`pageSize` (no `activo`
 * filter, no `q` — confirmed against `apps/api/src/routes/proveedores.ts`),
 * so "active suppliers only" (productos-ui / Create/Edit Form's supplier
 * selector requirement) is a client-side filter on top of one page fetch.
 * `pageSize: 100` is the route's own max (`lib/pagination.ts`) — this
 * repository seeds four suppliers today, well under that cap; a supplier
 * count that outgrows one page is a future problem, not this slice's.
 */
export const proveedoresActivosKeys = {
  all: ['proveedores', 'activos'] as const,
};

export function proveedoresActivosQueryOptions() {
  return queryOptions({
    queryKey: proveedoresActivosKeys.all,
    queryFn: () => apiFetch<ListResponse>('/proveedores?page=1&pageSize=100'),
    select: (response) => response.data.filter((p) => p.activo),
  });
}

/** Active suppliers only, for the product create/edit form's selector. */
export function useProveedoresActivos() {
  return useQuery(proveedoresActivosQueryOptions());
}

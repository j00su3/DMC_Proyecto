import { queryOptions } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';

/** One key — the route has no filters/pagination (D4: `ACTIVIDAD_RECIENTE_LIMIT`
 * is a route-level constant, never a client query param). */
export const dashboardKeys = {
  all: ['dashboard'] as const,
  resumen: () => [...dashboardKeys.all, 'resumen'] as const,
};

type ResumenResponse =
  paths['/api/dashboard/resumen']['get']['responses']['200']['content']['application/json'];

/**
 * Zero-arg query options for `GET /api/dashboard/resumen` (D3/D5) — one
 * payload for all 4 KPI cards, fetched once per dashboard mount.
 */
export function dashboardResumenQueryOptions() {
  return queryOptions({
    queryKey: dashboardKeys.resumen(),
    queryFn: () => apiFetch<ResumenResponse>('/dashboard/resumen'),
  });
}

import { queryOptions } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';

/** Matches the server's default page size (`apps/api/src/lib/pagination.ts`),
 * same constant every other paginated feature in this codebase uses. */
export const PAGE_SIZE = 20;

/**
 * Key factory mirroring `features/alertas/queries.ts`'s shape — one branch
 * per report, each keyed by its own filter inputs so invalidating one report
 * never touches another's cache entry.
 */
export const reportesKeys = {
  all: ['reportes'] as const,
  stockActual: (page: number) =>
    [...reportesKeys.all, 'stock-actual', { page }] as const,
  bajoMinimo: (page: number) =>
    [...reportesKeys.all, 'bajo-minimo', { page }] as const,
  movimientos: (page: number, fechaDesde: string, fechaHasta: string) =>
    [
      ...reportesKeys.all,
      'movimientos',
      { page, fechaDesde, fechaHasta },
    ] as const,
  discrepancias: (page: number) =>
    [...reportesKeys.all, 'discrepancias', { page }] as const,
};

type StockActualResponse =
  paths['/api/reportes/stock-actual']['get']['responses']['200']['content']['application/json'];
type BajoMinimoResponse =
  paths['/api/reportes/bajo-minimo']['get']['responses']['200']['content']['application/json'];
type MovimientosResponse =
  paths['/api/reportes/movimientos']['get']['responses']['200']['content']['application/json'];
type DiscrepanciasResponse =
  paths['/api/reportes/discrepancias']['get']['responses']['200']['content']['application/json'];

export function stockActualQueryOptions(page = 1) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  return queryOptions({
    queryKey: reportesKeys.stockActual(page),
    queryFn: () =>
      apiFetch<StockActualResponse>(
        `/reportes/stock-actual?${params.toString()}`,
      ),
  });
}

export function bajoMinimoQueryOptions(page = 1) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  return queryOptions({
    queryKey: reportesKeys.bajoMinimo(page),
    queryFn: () =>
      apiFetch<BajoMinimoResponse>(
        `/reportes/bajo-minimo?${params.toString()}`,
      ),
  });
}

/**
 * `fechaDesde`/`fechaHasta` are required query params on the server (D5) —
 * both roles get the same date-range control (proposal.md's ratified
 * scoping decision 2); the server enforces deposito's row-level scope, this
 * hook just passes the filter through unmodified.
 */
export function movimientosPeriodoQueryOptions(
  page: number,
  fechaDesde: string,
  fechaHasta: string,
) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
    fechaDesde,
    fechaHasta,
  });
  return queryOptions({
    queryKey: reportesKeys.movimientos(page, fechaDesde, fechaHasta),
    queryFn: () =>
      apiFetch<MovimientosResponse>(
        `/reportes/movimientos?${params.toString()}`,
      ),
  });
}

export function discrepanciasQueryOptions(page = 1) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  return queryOptions({
    queryKey: reportesKeys.discrepancias(page),
    queryFn: () =>
      apiFetch<DiscrepanciasResponse>(
        `/reportes/discrepancias?${params.toString()}`,
      ),
  });
}

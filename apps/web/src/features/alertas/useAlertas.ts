import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { EstadoAlerta } from './queries.js';
import { alertasListQueryOptions } from './queries.js';

/**
 * List query keyed by `alertasKeys.list(page, estado)`. Mirrors
 * `features/productos/useProductos.ts`: `placeholderData: keepPreviousData`
 * keeps the previous rows visible under `isPlaceholderData` while a new
 * page/filter request is in flight instead of blanking the table.
 */
export function useAlertas(page: number, estado?: EstadoAlerta) {
  return useQuery({
    ...alertasListQueryOptions(page, estado),
    placeholderData: keepPreviousData,
  });
}

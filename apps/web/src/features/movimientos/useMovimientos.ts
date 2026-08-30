import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { movimientosListQueryOptions } from './queries.js';

/**
 * List query keyed by `movimientosKeys.list(productoId, page)`, mirroring
 * `features/productos/useProductos.ts`. `placeholderData: keepPreviousData`
 * keeps the previous page's rows visible under `isPlaceholderData` while a
 * new page is in flight, instead of the table blanking out.
 */
export function useMovimientos(productoId: string, page: number) {
  return useQuery({
    ...movimientosListQueryOptions(productoId, page),
    placeholderData: keepPreviousData,
  });
}

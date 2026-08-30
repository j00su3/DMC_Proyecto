import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { productosListQueryOptions } from './queries.js';

/**
 * List query keyed by `productosKeys.list(page, q)`. `placeholderData:
 * keepPreviousData` mirrors `useUsuarios`: while a new page/search request
 * is in flight, the previous rows stay visible under `isPlaceholderData`
 * instead of the table blanking out.
 */
export function useProductos(page: number, q: string) {
  return useQuery({
    ...productosListQueryOptions(page, q),
    placeholderData: keepPreviousData,
  });
}

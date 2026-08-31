import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { catalogoListQueryOptions } from './queries.js';

/**
 * List query keyed by `posCatalogoKeys.list(page)`. `placeholderData:
 * keepPreviousData` mirrors `features/productos/useProductos.ts`: while a
 * new page request is in flight, the previous grid stays visible under
 * `isPlaceholderData` instead of flashing empty.
 */
export function useCatalogo(page: number) {
  return useQuery({
    ...catalogoListQueryOptions(page),
    placeholderData: keepPreviousData,
  });
}

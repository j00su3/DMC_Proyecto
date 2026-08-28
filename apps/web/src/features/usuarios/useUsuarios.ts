import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { usuariosListQueryOptions } from './queries.js';

/**
 * List query keyed by `usuariosKeys.list(page)` (D7). `placeholderData:
 * keepPreviousData` (D8, TanStack Query v5 import): while a new page is in
 * flight, the previous page's rows stay visible under `isPlaceholderData`
 * rather than the table blanking out. Live controls during that window
 * would let a double-click queue a page change against data that has not
 * arrived, landing two pages from the click — the route's component
 * disables pagination controls and marks the table `aria-busy` while this
 * flag is true.
 */
export function useUsuarios(page: number) {
  return useQuery({
    ...usuariosListQueryOptions(page),
    placeholderData: keepPreviousData,
  });
}

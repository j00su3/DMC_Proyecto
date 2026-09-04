import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { stockActualQueryOptions } from './queries.js';

/**
 * `placeholderData: keepPreviousData` mirrors `features/alertas/useAlertas.ts`
 * — keeps the previous rows visible under `isPlaceholderData` instead of
 * blanking the table between page requests.
 */
export function useStockActual(page: number) {
  return useQuery({
    ...stockActualQueryOptions(page),
    placeholderData: keepPreviousData,
  });
}

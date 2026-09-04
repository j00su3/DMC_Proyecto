import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { discrepanciasQueryOptions } from './queries.js';

export function useDiscrepancias(page: number) {
  return useQuery({
    ...discrepanciasQueryOptions(page),
    placeholderData: keepPreviousData,
  });
}

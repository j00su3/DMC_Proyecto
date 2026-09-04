import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { bajoMinimoQueryOptions } from './queries.js';

export function useBajoMinimo(page: number) {
  return useQuery({
    ...bajoMinimoQueryOptions(page),
    placeholderData: keepPreviousData,
  });
}

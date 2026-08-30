import { queryOptions } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';

/** Key factory mirroring `features/usuarios/queries.ts:5-18`, keyed by `page` and `q`. */
export const productosKeys = {
  all: ['productos'] as const,
  lists: () => [...productosKeys.all, 'list'] as const,
  list: (page: number, q: string) =>
    [...productosKeys.lists(), { page, q }] as const,
  details: () => [...productosKeys.all, 'detail'] as const,
  detail: (id: string) => [...productosKeys.details(), id] as const,
};

/** Matches the server's default page size — no picker in this change. */
export const PAGE_SIZE = 20;

type ListResponse =
  paths['/api/productos']['get']['responses']['200']['content']['application/json'];

/**
 * Shared between `useProductos` and the list route's `loader` (D9's
 * invalidate-never-`setQueryData` rule applies to every mutation using
 * this key).
 */
export function productosListQueryOptions(page: number, q: string) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  if (q) params.set('q', q);
  return queryOptions({
    queryKey: productosKeys.list(page, q),
    queryFn: () => apiFetch<ListResponse>(`/productos?${params.toString()}`),
  });
}

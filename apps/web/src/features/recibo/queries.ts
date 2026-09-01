import { queryOptions } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';

/** Key factory mirroring `features/productos/queries.ts:6-13`. */
export const reciboKeys = {
  all: ['recibo'] as const,
  details: () => [...reciboKeys.all, 'detail'] as const,
  detail: (id: string) => [...reciboKeys.details(), id] as const,
  byNumeros: () => [...reciboKeys.all, 'byNumero'] as const,
  byNumero: (numero: number) => [...reciboKeys.byNumeros(), numero] as const,
};

type DetailResponse =
  paths['/api/ventas/{id}']['get']['responses']['200']['content']['application/json'];

type ByNumeroResponse =
  paths['/api/ventas/numero/{numeroCorrelativo}']['get']['responses']['200']['content']['application/json'];

/** `GET /api/ventas/:id`, keyed by `reciboKeys.detail(id)`. */
export function reciboDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: reciboKeys.detail(id),
    queryFn: () => apiFetch<DetailResponse>(`/ventas/${id}`),
  });
}

/**
 * `GET /api/ventas/numero/:numeroCorrelativo`, keyed by
 * `reciboKeys.byNumero(numero)`. `enabled` is the caller's job (D3 —
 * search-on-submit, not on every keystroke), applied in `useReciboPorNumero`.
 */
export function reciboByNumeroQueryOptions(numero: number) {
  return queryOptions({
    queryKey: reciboKeys.byNumero(numero),
    queryFn: () => apiFetch<ByNumeroResponse>(`/ventas/numero/${numero}`),
  });
}

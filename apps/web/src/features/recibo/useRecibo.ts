import { useQuery } from '@tanstack/react-query';
import {
  reciboByNumeroQueryOptions,
  reciboDetailQueryOptions,
} from './queries.js';

/**
 * Detail query keyed by `reciboKeys.detail(id)`, mirroring
 * `features/usuarios/useUsuario.ts`. Always enabled — the receipt route
 * (Phase 3) always has an `id` to render. Errors surface as the typed
 * `ApiError` untouched; mapping `SALE_NOT_FOUND` to copy is
 * `errorMessages.ts`'s job.
 */
export function useRecibo(id: string) {
  return useQuery(reciboDetailQueryOptions(id));
}

/**
 * Lookup by `numeroCorrelativo`, keyed by `reciboKeys.byNumero(numero)`.
 * `enabled` is caller-controlled (D3 — the search route gates this on
 * submit, not on every keystroke, so it does not fire while the user is
 * still typing).
 */
export function useReciboPorNumero(numero: number, enabled: boolean) {
  return useQuery({ ...reciboByNumeroQueryOptions(numero), enabled });
}

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';
import { usuariosKeys } from './queries.js';

type DetailResponse =
  paths['/api/usuarios/{id}']['get']['responses']['200']['content']['application/json'];

/**
 * Detail query keyed by `usuariosKeys.detail(id)` (D7). Errors surface as the
 * typed `ApiError` untouched — mapping a code to copy is `errorMessages.ts`'s
 * job, applied by the route's component, not by the hook.
 */
export function useUsuario(id: string) {
  return useQuery({
    queryKey: usuariosKeys.detail(id),
    queryFn: () => apiFetch<DetailResponse>(`/usuarios/${id}`),
  });
}

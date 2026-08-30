import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';
import { productosKeys } from './queries.js';

type DetailResponse =
  paths['/api/productos/{id}']['get']['responses']['200']['content']['application/json'];

/**
 * Detail query keyed by `productosKeys.detail(id)`, mirroring
 * `features/usuarios/useUsuario.ts`. Errors surface as the typed `ApiError`
 * untouched — mapping a code to copy is `errorMessages.ts`'s job.
 */
export function useProducto(id: string) {
  return useQuery({
    queryKey: productosKeys.detail(id),
    queryFn: () => apiFetch<DetailResponse>(`/productos/${id}`),
  });
}

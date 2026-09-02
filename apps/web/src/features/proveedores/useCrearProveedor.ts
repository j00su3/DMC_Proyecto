import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';
import { proveedoresActivosKeys } from '../productos/useProveedoresActivos.js';
import { proveedoresKeys } from './queries.js';
import type { CrearProveedorInput } from './schemas.js';

type CreateResponse =
  paths['/api/proveedores']['post']['responses']['201']['content']['application/json'];

/**
 * Mirrors `features/productos/useCrearProducto.ts` (mutation +
 * invalidate-never-`setQueryData`, D9). D3: invalidates
 * `proveedoresActivosKeys.all` too, or a new supplier leaves
 * `ProductoForm`'s selector stale.
 */
export function useCrearProveedor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CrearProveedorInput) =>
      apiFetch<CreateResponse>('/proveedores', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: proveedoresKeys.all }),
        queryClient.invalidateQueries({
          queryKey: proveedoresActivosKeys.all,
        }),
      ]);
    },
  });
}

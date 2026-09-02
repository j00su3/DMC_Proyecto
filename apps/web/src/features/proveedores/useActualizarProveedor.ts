import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';
import { proveedoresActivosKeys } from '../productos/useProveedoresActivos.js';
import { proveedoresKeys } from './queries.js';
import type { ActualizarProveedorInput } from './schemas.js';

type UpdateResponse =
  paths['/api/proveedores/{id}']['patch']['responses']['200']['content']['application/json'];

/**
 * Mirrors `useCrearProveedor.ts` (mutation + invalidate-never-`setQueryData`).
 * No separate `detail(id)` key to invalidate (D3 — no `useProveedor(id)`
 * hook exists); `proveedoresKeys.all` covers the one list this feature owns.
 */
export function useActualizarProveedor(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ActualizarProveedorInput) =>
      apiFetch<UpdateResponse>(`/proveedores/${id}`, {
        method: 'PATCH',
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

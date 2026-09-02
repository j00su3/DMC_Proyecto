import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';
import { proveedoresActivosKeys } from '../productos/useProveedoresActivos.js';
import { proveedoresKeys } from './queries.js';

type EstadoResponse =
  paths['/api/proveedores/{id}/deactivate']['post']['responses']['200']['content']['application/json'];

/**
 * Mirrors `features/productos/useEstadoProducto.ts` — no `body` key at all
 * (both routes take none), invalidates `proveedoresKeys.all` +
 * `proveedoresActivosKeys.all` on success (D3/D9), matching
 * `useCrearProveedor`/`useActualizarProveedor`.
 */
function useEstadoMutation(segment: 'deactivate' | 'reactivate') {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<EstadoResponse>(`/proveedores/${id}/${segment}`, {
        method: 'POST',
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

export function useEstadoProveedor() {
  return {
    deactivate: useEstadoMutation('deactivate'),
    reactivate: useEstadoMutation('reactivate'),
  };
}

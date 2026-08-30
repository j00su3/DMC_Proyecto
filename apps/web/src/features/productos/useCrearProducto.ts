import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';
import { productosKeys } from './queries.js';
import type { CrearProductoInput } from './schemas.js';

type CreateResponse =
  paths['/api/productos']['post']['responses']['201']['content']['application/json'];
/** Mirrors `useCrearUsuario.ts` (mutation + invalidate-never-`setQueryData`,
 * D9), minus the credential handoff — no secret to shield here. */
export function useCrearProducto() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CrearProductoInput) =>
      apiFetch<CreateResponse>('/productos', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productosKeys.lists() });
    },
  });
}

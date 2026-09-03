import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';
import { alertasKeys } from './queries.js';

type ResolverResponse =
  paths['/api/alertas/{id}/resolver']['post']['responses']['200']['content']['application/json'];

/**
 * One mutation object shared by every row in `AlertasTable` — `mutate(id)`
 * takes the alert id per call, unlike `useActualizarProducto`'s per-record
 * hook (that pattern fits a single-record edit form, not a table). PD-3:
 * `encargado`-only server-side; the route's `config.roles` 403 is the real
 * boundary. Invalidates `alertasKeys.all`, matching the invalidate-never-
 * `setQueryData` rule this codebase uses everywhere else.
 */
export function useResolverAlerta() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<ResolverResponse>(`/alertas/${id}/resolver`, {
        method: 'POST',
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: alertasKeys.all });
    },
  });
}

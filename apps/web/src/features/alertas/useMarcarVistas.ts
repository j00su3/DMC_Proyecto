import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';
import { alertasKeys } from './queries.js';

type MarcarVistasResponse =
  paths['/api/alertas/marcar-vistas']['post']['responses']['200']['content']['application/json'];

/**
 * Fires once on mount — a route effect, not a user action (task 4.4).
 * `useMutation`'s `mutate` identity is stable across re-renders, so the
 * `useEffect` below runs the POST exactly once per mount, not once per
 * render. Invalidates `alertasKeys.all` on success (a `vista` transition
 * changes what the list/badge should show).
 */
export function useMarcarVistas() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<MarcarVistasResponse>('/alertas/marcar-vistas', {
        method: 'POST',
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: alertasKeys.all });
    },
  });

  const { mutate } = mutation;
  useEffect(() => {
    mutate();
  }, [mutate]);

  return mutation;
}

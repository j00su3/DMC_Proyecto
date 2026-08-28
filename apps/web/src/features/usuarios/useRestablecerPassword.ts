import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';
import { usuariosKeys } from './queries.js';
import type { CredentialHandoff } from './useCrearUsuario.js';

type ResetResponse =
  paths['/api/usuarios/{id}/password-reset']['post']['responses']['200']['content']['application/json'];

/**
 * D12's narrowing pattern, repeated for reset rather than reused as a
 * generic — `useCrearUsuario`'s containment is structural (mutationFn
 * narrows the type, not a shared helper), and this hook must be provably
 * the same shape, not merely assumed to be. Instantiated once at the
 * list/detail screen level (design.md's data-flow note): a row is free to
 * unmount under a refetch and must not be the only holder of the
 * credential. The target id is a mutate-time argument, matching
 * `useEstadoUsuario`'s shape — the list screen holds one instance and
 * dispatches it against whichever row's button was clicked. `apiFetch` is
 * called with no `body` key at all ("Two corrections" in tasks.md).
 */
export function useRestablecerPassword() {
  const queryClient = useQueryClient();
  const [credential, setCredential] = useState<CredentialHandoff | null>(null);

  const mutation = useMutation({
    mutationFn: async (id: string) => {
      const body = await apiFetch<ResetResponse>(
        `/usuarios/${id}/password-reset`,
        { method: 'POST' },
      );
      setCredential({
        nombre: body.usuario.nombre,
        passwordTemporal: body.passwordTemporal,
      });
      // The ONLY value that becomes mutation state — no passwordTemporal
      // member exists on this type, so no consumer of mutation.data can
      // reach it.
      return body.usuario;
    },
    onSuccess: (_usuario, id) => {
      // NOT awaited: the credential must be on screen the instant it
      // exists. NOT setQueryData (D9) — invalidate only.
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: usuariosKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: usuariosKeys.detail(id) }),
      ]);
    },
  });

  return {
    mutate: mutation.mutate,
    isPending: mutation.isPending,
    error: mutation.error,
    /** Local component state. Never cached, never persisted, never in the URL. */
    credential,
    /** Explicit dismissal — the only non-unmount way this reaches null. */
    acknowledge: () => setCredential(null),
  };
}

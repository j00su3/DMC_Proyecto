import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';
import { usuariosKeys } from './queries.js';
import type { CrearUsuarioInput } from './schemas.js';

type CreateResponse =
  paths['/api/usuarios']['post']['responses']['201']['content']['application/json'];

/**
 * Local component state only. Never cached, never persisted, never in the
 * URL — the mirror of `gestion-usuarios D8` on the client (D12).
 */
export interface CredentialHandoff {
  nombre: string;
  passwordTemporal: string;
}

/**
 * D12: the plaintext is contained **by type, not by discipline**. The
 * `mutationFn` narrows inside itself — it awaits `apiFetch`, hands the
 * plaintext to a local `useState` setter, and returns only `body.usuario`.
 * `mutation.data` is therefore typed `UsuarioResumen`, which has no
 * `passwordTemporal` member: no reader can reach a key the result type does
 * not have. The server's `Cache-Control: no-store` closes the *transport*
 * copy; this closes the *application* copies (query cache, mutation cache,
 * router/URL state, both web storages).
 */
export function useCrearUsuario() {
  const queryClient = useQueryClient();
  const [credential, setCredential] = useState<CredentialHandoff | null>(null);

  const mutation = useMutation({
    mutationFn: async (input: CrearUsuarioInput) => {
      const body = await apiFetch<CreateResponse>('/usuarios', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setCredential({
        nombre: body.usuario.nombre,
        passwordTemporal: body.passwordTemporal,
      });
      // The ONLY value that becomes mutation state — no passwordTemporal
      // member exists on this type, so no consumer of mutation.data can
      // reach it.
      return body.usuario;
    },
    onSuccess: () => {
      // NOT awaited: the credential must be on screen the instant it
      // exists, never gated on a refetch that could fail. NOT
      // setQueryData (D9) — invalidate only.
      void queryClient.invalidateQueries({
        queryKey: usuariosKeys.lists(),
      });
      // NO navigate() here, unlike useLogin/useChangePassword: those carry
      // no payload the user must read, this one does. Navigation happens
      // only from acknowledge().
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

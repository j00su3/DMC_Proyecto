import { createRoute } from '@tanstack/react-router';
import { type FormEvent, useEffect, useState } from 'react';
import { isApiError } from '../api/errors.js';
import { Button } from '../components/ui/Button.js';
import { FormError } from '../components/ui/FormError.js';
import { TextField } from '../components/ui/TextField.js';
import { reciboErrorMessage } from '../features/recibo/errorMessages.js';
import { useReciboPorNumero } from '../features/recibo/useRecibo.js';
import { shellLayout } from './shellLayout.js';

/**
 * recibo-ui / Correlativo Search (D3, D4). Landing route for the
 * search-by-`numeroCorrelativo` affordance — the only entry point for
 * someone who holds a correlativo but no venta id (D3's rejection of
 * embedding the search inside `/ventas/$id/recibo`'s not-found state).
 *
 * Sibling of `posRoute`/`reciboRoute` under `shellLayout`, NOT
 * `encargadoLayout` — same D4 reasoning: PD-4's audit-style access gates
 * both roles server-side, so the client guard must not exceed it.
 *
 * No sidebar entry (PD-11) — reachable only via the POS success state
 * (Phase 5) and `/ventas/$id/recibo`'s not-found recovery link, or a direct
 * URL. No list/browse control anywhere on this route (PD-1 scope boundary).
 */
export const reciboBuscarRoute = createRoute({
  getParentRoute: () => shellLayout,
  path: '/ventas/recibo',
  component: ReciboBuscarScreen,
});

function ReciboBuscarScreen() {
  const navigate = reciboBuscarRoute.useNavigate();
  const [input, setInput] = useState('');
  const [numero, setNumero] = useState<number | undefined>(undefined);
  const [validationError, setValidationError] = useState<string | undefined>();

  // Search-on-submit (D3), not on every keystroke: `enabled` only turns
  // true after a valid submission sets `numero`.
  const query = useReciboPorNumero(numero ?? 0, numero !== undefined);

  useEffect(() => {
    if (query.data) {
      // `replace: true` (D3) so Back returns to the search, not a redirect
      // loop between the search and the receipt it just resolved to.
      navigate({
        to: '/ventas/$id/recibo',
        params: { id: query.data.venta.id },
        replace: true,
      });
    }
  }, [query.data, navigate]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = input.trim();
    const parsed = Number(trimmed);

    if (!trimmed || !Number.isInteger(parsed) || parsed <= 0) {
      setValidationError('Ingrese un número correlativo válido.');
      setNumero(undefined);
      return;
    }

    setValidationError(undefined);
    setNumero(parsed);
  }

  const apiErrorMessage =
    query.isError && numero !== undefined
      ? isApiError(query.error)
        ? reciboErrorMessage(query.error)
        : 'Ocurrió un error inesperado. Intente de nuevo.'
      : undefined;

  const errorMessage = validationError ?? apiErrorMessage;

  return (
    <div>
      <h1>Buscar recibo</h1>
      <form onSubmit={submit} noValidate>
        <TextField
          id="numeroCorrelativo"
          label="Número correlativo"
          inputMode="numeric"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <Button type="submit" variant="primary" isPending={query.isFetching}>
          Buscar
        </Button>
      </form>

      {errorMessage ? <FormError message={errorMessage} /> : null}
    </div>
  );
}

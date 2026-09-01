import { createRoute } from '@tanstack/react-router';
import { isApiError } from '../api/errors.js';
import { FormError } from '../components/ui/FormError.js';
import { Recibo } from '../features/recibo/Recibo.js';
import { reciboErrorMessage } from '../features/recibo/errorMessages.js';
import { useRecibo } from '../features/recibo/useRecibo.js';
import { shellLayout } from './shellLayout.js';

/**
 * recibo-ui / Printable Receipt Route (D3, D4). Sibling of `posRoute` under
 * `shellLayout`, NOT `encargadoLayout` — three independent reasons in D4 all
 * apply: the client guard must mirror the server's `roles: ['encargado',
 * 'deposito']` boundary (PD-4, audit-style access), CLAUDE.md's own rule
 * ("Route guards are for encargado-only subtrees"), and the concrete
 * breakage a `deposito` cashier would hit clicking the POS success screen's
 * link to their own just-confirmed sale.
 *
 * On `SALE_NOT_FOUND` (or any other API error, per PD-5's single generic
 * treatment) renders the same generic not-found message the correlativo
 * search shows, with a recovery link to `/ventas/recibo` (D3's recovery
 * affordance, built in Phase 4). Plain `<a>`, not a typed `Link`: that
 * route does not exist in `routeTree` yet in this slice, so a typed
 * `to="/ventas/recibo"` would fail `tsc` before Phase 4 lands — the design
 * explicitly says not to gate this task on Phase 4.
 */
export const reciboRoute = createRoute({
  getParentRoute: () => shellLayout,
  path: '/ventas/$id/recibo',
  component: ReciboScreen,
});

function ReciboScreen() {
  const { id } = reciboRoute.useParams();
  const query = useRecibo(id);

  if (query.isError) {
    const message = isApiError(query.error)
      ? reciboErrorMessage(query.error)
      : 'Ocurrió un error inesperado. Intente de nuevo.';
    return (
      <div>
        <h1>Recibo</h1>
        <FormError message={message} />
        <p>
          <a href="/ventas/recibo">Buscar otro recibo</a>
        </p>
      </div>
    );
  }

  if (!query.data) {
    return <h1>Recibo</h1>;
  }

  return <Recibo recibo={query.data} />;
}

import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { isApiError } from '../api/errors.js';
import { Button } from '../components/ui/Button.js';
import { FormError } from '../components/ui/FormError.js';
import { AnularVentaModal } from '../features/recibo/AnularVentaModal.js';
import { Recibo } from '../features/recibo/Recibo.js';
import { reciboErrorMessage } from '../features/recibo/errorMessages.js';
import { useAnularVenta } from '../features/recibo/useAnularVenta.js';
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
 *
 * Phase 7 (backlog #9, anulación de venta) adds the anulación trigger + its
 * modal here, on the ROUTE component, per design's "UI entry point on the
 * receipt route" decision and PD-4 — `Recibo.tsx` itself is NOT touched.
 * The trigger is a UX affordance only, gated on `usuario.rol === 'encargado'
 * && venta.estado === 'confirmada'`; the server's `roles: ['encargado']` on
 * `POST /api/ventas/:id/anular` (and its `SALE_ALREADY_VOIDED` 409) remain
 * the real boundary (CLAUDE.md's "Authorization is server-side" rule).
 */
export const reciboRoute = createRoute({
  getParentRoute: () => shellLayout,
  path: '/ventas/$id/recibo',
  component: ReciboScreen,
});

function ReciboScreen() {
  const { id } = reciboRoute.useParams();
  const navigate = reciboRoute.useNavigate();
  const { usuario } = reciboRoute.useRouteContext();
  const query = useRecibo(id);
  const anular = useAnularVenta(id);
  const [isModalOpen, setIsModalOpen] = useState(false);

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

  const { venta } = query.data;
  const canAnular =
    usuario.rol === 'encargado' && venta.estado === 'confirmada';
  const anularServerError = anular.error
    ? isApiError(anular.error)
      ? reciboErrorMessage(anular.error)
      : 'Ocurrió un error inesperado. Intente de nuevo.'
    : undefined;

  return (
    <>
      <Recibo recibo={query.data} onVolver={() => navigate({ to: '/pos' })} />

      {canAnular ? (
        <Button variant="secondary" onClick={() => setIsModalOpen(true)}>
          Anular venta
        </Button>
      ) : null}

      {isModalOpen ? (
        <AnularVentaModal
          onClose={() => setIsModalOpen(false)}
          onSubmit={(values) =>
            anular.mutate(values, {
              onSuccess: () => setIsModalOpen(false),
            })
          }
          isPending={anular.isPending}
          serverError={anularServerError}
        />
      ) : null}
    </>
  );
}

import { createRoute } from '@tanstack/react-router';
import { isApiError } from '../api/errors.js';
import { FormError } from '../components/ui/FormError.js';
import stackStyles from '../components/ui/screenStack.module.css';
import { AlertasTable } from '../features/alertas/AlertasTable.js';
import { alertasErrorMessage } from '../features/alertas/errorMessages.js';
import { alertasListQueryOptions } from '../features/alertas/queries.js';
import { useAlertas } from '../features/alertas/useAlertas.js';
import { useMarcarVistas } from '../features/alertas/useMarcarVistas.js';
import { useResolverAlerta } from '../features/alertas/useResolverAlerta.js';
import { shellLayout } from './shellLayout.js';

const PAGE = 1;

/**
 * alertas-ui / "Role Gate — Alert Screen Reachable By Both Roles": under
 * `shellLayout`, NOT `encargadoLayout` — mirrors the backend's read access
 * (both `encargado` and `deposito` can `GET /api/alertas`). Only the
 * resolve control is role-gated, inside `AlertasTable`.
 */
export const alertasRoute = createRoute({
  getParentRoute: () => shellLayout,
  path: '/alertas',
  loader: async ({ context }) => {
    // Swallowed deliberately (`productos.tsx:45-53` precedent): a thrown
    // loader error hits the router's generic CatchBoundary, not this
    // screen. `useAlertas` re-reads the same now-errored cache entry and
    // surfaces it through `query.isError`.
    await context.queryClient
      .ensureQueryData(alertasListQueryOptions(PAGE))
      .catch(() => undefined);
  },
  component: AlertasScreen,
});

function AlertasScreen() {
  const { usuario } = alertasRoute.useRouteContext();
  const query = useAlertas(PAGE);
  const resolver = useResolverAlerta();
  // Fires once on mount, not a user action (task 4.4/4.6) — marks every
  // `activa` alert as `vista`.
  useMarcarVistas();

  if (query.isError) {
    const message = isApiError(query.error)
      ? alertasErrorMessage(query.error)
      : 'Ocurrió un error inesperado. Intente de nuevo.';
    return (
      <div className={stackStyles.stack}>
        <h1>Alertas</h1>
        <FormError message={message} />
      </div>
    );
  }

  return (
    <div className={stackStyles.stack}>
      <h1>Alertas</h1>
      {resolver.isError ? (
        <FormError
          message={
            isApiError(resolver.error)
              ? alertasErrorMessage(resolver.error)
              : 'Ocurrió un error inesperado. Intente de nuevo.'
          }
        />
      ) : null}
      <AlertasTable
        alertas={query.data?.data ?? []}
        aria-busy={query.isPlaceholderData}
        actorRol={usuario.rol}
        onResolve={(id) => resolver.mutate(id)}
      />
    </div>
  );
}

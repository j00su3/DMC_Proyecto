import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { isApiError } from '../api/errors.js';
import { FormError } from '../components/ui/FormError.js';
import { Pagination } from '../components/ui/Pagination.js';
import stackStyles from '../components/ui/screenStack.module.css';
import { DiscrepanciasTable } from '../features/reportes/DiscrepanciasTable.js';
import { reportesErrorMessage } from '../features/reportes/errorMessages.js';
import {
  PAGE_SIZE,
  discrepanciasQueryOptions,
} from '../features/reportes/queries.js';
import { useDiscrepancias } from '../features/reportes/useDiscrepancias.js';
import { encargadoLayout } from './encargadoLayout.js';

const discrepanciasSearchSchema = z.object({
  page: z.coerce
    .number()
    .int()
    .catch(1)
    .transform((n) => Math.max(1, n)),
});

/**
 * Discrepancias Globales report ("Discrepancias Globales Report"
 * requirement): `encargado`-only, `deposito` gets `403` from the server
 * (Phase 4). This route sits under `encargadoLayout`, exactly like
 * `usuarios.tsx` — same UX-convenience-only disclaimer applies: a `deposito`
 * session redirects away here before ever issuing the request, but that is
 * a UX affordance only, NOT the enforcement mechanism. The server's `403`
 * on `GET /api/reportes/discrepancias` is the real security boundary,
 * regardless of whether this guard ran — see `encargadoLayout.tsx`'s own
 * docblock for the canonical wording.
 */
export const reportesDiscrepanciasRoute = createRoute({
  getParentRoute: () => encargadoLayout,
  path: '/reportes/discrepancias',
  validateSearch: discrepanciasSearchSchema,
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: async ({ context, deps }) => {
    await context.queryClient
      .ensureQueryData(discrepanciasQueryOptions(deps.page))
      .catch(() => undefined);
  },
  component: DiscrepanciasScreen,
});

function DiscrepanciasScreen() {
  const { page } = reportesDiscrepanciasRoute.useSearch();
  const navigate = reportesDiscrepanciasRoute.useNavigate();
  const query = useDiscrepancias(page);

  if (query.isError) {
    const message = isApiError(query.error)
      ? reportesErrorMessage(query.error)
      : 'Ocurrió un error inesperado. Intente de nuevo.';
    return (
      <div className={stackStyles.stack}>
        <h1>Discrepancias globales</h1>
        <FormError message={message} />
      </div>
    );
  }

  const data = query.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className={stackStyles.stack}>
      <h1>Discrepancias globales</h1>
      <DiscrepanciasTable
        discrepancias={data?.data ?? []}
        aria-busy={query.isPlaceholderData}
      />
      <Pagination
        page={page}
        totalPages={totalPages}
        isBusy={query.isPlaceholderData}
        onPageChange={(nextPage) => navigate({ search: { page: nextPage } })}
      />
    </div>
  );
}

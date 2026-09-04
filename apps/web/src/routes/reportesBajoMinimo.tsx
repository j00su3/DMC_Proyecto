import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { isApiError } from '../api/errors.js';
import { FormError } from '../components/ui/FormError.js';
import { Pagination } from '../components/ui/Pagination.js';
import stackStyles from '../components/ui/screenStack.module.css';
import { BajoMinimoTable } from '../features/reportes/BajoMinimoTable.js';
import { reportesErrorMessage } from '../features/reportes/errorMessages.js';
import {
  PAGE_SIZE,
  bajoMinimoQueryOptions,
} from '../features/reportes/queries.js';
import { useBajoMinimo } from '../features/reportes/useBajoMinimo.js';
import { shellLayout } from './shellLayout.js';

const bajoMinimoSearchSchema = z.object({
  page: z.coerce
    .number()
    .int()
    .catch(1)
    .transform((n) => Math.max(1, n)),
});

/**
 * Bajo Mínimo report ("Bajo Mínimo Report" requirement): unfiltered by
 * role — under `shellLayout`, NOT `encargadoLayout`.
 */
export const reportesBajoMinimoRoute = createRoute({
  getParentRoute: () => shellLayout,
  path: '/reportes/bajo-minimo',
  validateSearch: bajoMinimoSearchSchema,
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: async ({ context, deps }) => {
    await context.queryClient
      .ensureQueryData(bajoMinimoQueryOptions(deps.page))
      .catch(() => undefined);
  },
  component: BajoMinimoScreen,
});

function BajoMinimoScreen() {
  const { page } = reportesBajoMinimoRoute.useSearch();
  const navigate = reportesBajoMinimoRoute.useNavigate();
  const query = useBajoMinimo(page);

  if (query.isError) {
    const message = isApiError(query.error)
      ? reportesErrorMessage(query.error)
      : 'Ocurrió un error inesperado. Intente de nuevo.';
    return (
      <div className={stackStyles.stack}>
        <h1>Bajo mínimo</h1>
        <FormError message={message} />
      </div>
    );
  }

  const data = query.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className={stackStyles.stack}>
      <h1>Bajo mínimo</h1>
      <BajoMinimoTable
        productos={data?.data ?? []}
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

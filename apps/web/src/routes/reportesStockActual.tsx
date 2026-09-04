import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { isApiError } from '../api/errors.js';
import { FormError } from '../components/ui/FormError.js';
import { Pagination } from '../components/ui/Pagination.js';
import stackStyles from '../components/ui/screenStack.module.css';
import { StockActualTable } from '../features/reportes/StockActualTable.js';
import { reportesErrorMessage } from '../features/reportes/errorMessages.js';
import {
  PAGE_SIZE,
  stockActualQueryOptions,
} from '../features/reportes/queries.js';
import { useStockActual } from '../features/reportes/useStockActual.js';
import { shellLayout } from './shellLayout.js';

/** Clamps rather than throws (`usuarios.tsx`'s D6 precedent). */
const stockActualSearchSchema = z.object({
  page: z.coerce
    .number()
    .int()
    .catch(1)
    .transform((n) => Math.max(1, n)),
});

/**
 * Stock Actual report ("Stock Actual Report" requirement): unfiltered,
 * identical for both roles — under `shellLayout`, NOT `encargadoLayout`
 * (`CLAUDE.md`'s "Route guards are for encargado-only subtrees").
 */
export const reportesStockActualRoute = createRoute({
  getParentRoute: () => shellLayout,
  path: '/reportes/stock-actual',
  validateSearch: stockActualSearchSchema,
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: async ({ context, deps }) => {
    // Swallowed deliberately (`productos.tsx:45-53` precedent).
    await context.queryClient
      .ensureQueryData(stockActualQueryOptions(deps.page))
      .catch(() => undefined);
  },
  component: StockActualScreen,
});

function StockActualScreen() {
  const { page } = reportesStockActualRoute.useSearch();
  const navigate = reportesStockActualRoute.useNavigate();
  const query = useStockActual(page);

  if (query.isError) {
    const message = isApiError(query.error)
      ? reportesErrorMessage(query.error)
      : 'Ocurrió un error inesperado. Intente de nuevo.';
    return (
      <div className={stackStyles.stack}>
        <h1>Stock actual</h1>
        <FormError message={message} />
      </div>
    );
  }

  const data = query.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className={stackStyles.stack}>
      <h1>Stock actual</h1>
      <StockActualTable
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

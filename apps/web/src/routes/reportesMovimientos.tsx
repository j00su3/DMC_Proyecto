import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { isApiError } from '../api/errors.js';
import { FormError } from '../components/ui/FormError.js';
import { Pagination } from '../components/ui/Pagination.js';
import stackStyles from '../components/ui/screenStack.module.css';
import { MovimientosPeriodoTable } from '../features/reportes/MovimientosPeriodoTable.js';
import { reportesErrorMessage } from '../features/reportes/errorMessages.js';
import {
  PAGE_SIZE,
  movimientosPeriodoQueryOptions,
} from '../features/reportes/queries.js';
import { useMovimientosPeriodo } from '../features/reportes/useMovimientosPeriodo.js';
import { shellLayout } from './shellLayout.js';

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

/** `YYYY-MM-DD`, local calendar day — matches the server's `isoDateSchema`
 * (D5). No timezone conversion: `fechaHasta` is calendar-day inclusive on
 * both ends of the wire. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * Both roles get the SAME date-range control (proposal.md's ratified
 * scoping decision 2) — the server enforces deposito's row-level scope
 * (D3), this screen never filters by actor client-side. Defaults to the
 * last 30 days so the screen never opens with an empty, un-filled query.
 */
const movimientosSearchSchema = z.object({
  page: z.coerce
    .number()
    .int()
    .catch(1)
    .transform((n) => Math.max(1, n)),
  fechaDesde: isoDateSchema.catch(() => daysAgoIso(30)),
  fechaHasta: isoDateSchema.catch(() => todayIso()),
});

/**
 * Movimientos por Período report ("Movimientos — Encargado Scope" /
 * "Movimientos — Deposito Row-Level Scope" requirements). Under
 * `shellLayout`, NOT `encargadoLayout` — both roles can read this report;
 * the server derives the actor from the session and forces `usuarioId` for
 * `deposito` (D3), never from a client-supplied parameter.
 */
export const reportesMovimientosRoute = createRoute({
  getParentRoute: () => shellLayout,
  path: '/reportes/movimientos',
  validateSearch: movimientosSearchSchema,
  loaderDeps: ({ search }) => ({
    page: search.page,
    fechaDesde: search.fechaDesde,
    fechaHasta: search.fechaHasta,
  }),
  loader: async ({ context, deps }) => {
    // Swallowed deliberately (`productos.tsx:45-53` precedent): a malformed
    // range surfaces via `query.isError`, not the router's CatchBoundary.
    await context.queryClient
      .ensureQueryData(
        movimientosPeriodoQueryOptions(
          deps.page,
          deps.fechaDesde,
          deps.fechaHasta,
        ),
      )
      .catch(() => undefined);
  },
  component: MovimientosScreen,
});

function MovimientosScreen() {
  const { page, fechaDesde, fechaHasta } = reportesMovimientosRoute.useSearch();
  const navigate = reportesMovimientosRoute.useNavigate();
  const query = useMovimientosPeriodo(page, fechaDesde, fechaHasta);

  if (query.isError) {
    const message = isApiError(query.error)
      ? reportesErrorMessage(query.error)
      : 'Ocurrió un error inesperado. Intente de nuevo.';
    return (
      <div className={stackStyles.stack}>
        <h1>Movimientos por período</h1>
        <FormError message={message} />
      </div>
    );
  }

  const data = query.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className={stackStyles.stack}>
      <h1>Movimientos por período</h1>
      <MovimientosPeriodoTable
        movimientos={data?.data ?? []}
        aria-busy={query.isPlaceholderData}
        fechaDesde={fechaDesde}
        fechaHasta={fechaHasta}
        onFilterChange={(next) => navigate({ search: { page: 1, ...next } })}
      />
      <Pagination
        page={page}
        totalPages={totalPages}
        isBusy={query.isPlaceholderData}
        onPageChange={(nextPage) =>
          navigate({ search: { page: nextPage, fechaDesde, fechaHasta } })
        }
      />
    </div>
  );
}

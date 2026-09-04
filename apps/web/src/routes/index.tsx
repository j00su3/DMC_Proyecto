import { createRoute } from '@tanstack/react-router';
import { FormError } from '../components/ui/FormError.js';
import { KpiCard } from '../components/ui/KpiCard.js';
import { StatusChip } from '../components/ui/StatusChip.js';
import stackStyles from '../components/ui/screenStack.module.css';
import { ActividadRecienteList } from '../features/dashboard/ActividadRecienteList.js';
import { dashboardResumenQueryOptions } from '../features/dashboard/queries.js';
import { useDashboardResumen } from '../features/dashboard/useDashboardResumen.js';
import styles from './index.module.css';
import { shellLayout } from './shellLayout.js';

export const indexRoute = createRoute({
  getParentRoute: () => shellLayout,
  path: '/',
  loader: async ({ context }) => {
    // Swallowed deliberately (`reportesMovimientos.tsx`'s precedent): a
    // failed fetch surfaces via `query.isError`, not the router's
    // CatchBoundary.
    await context.queryClient
      .ensureQueryData(dashboardResumenQueryOptions())
      .catch(() => undefined);
  },
  component: PanelGeneral,
});

function PanelGeneral() {
  const query = useDashboardResumen();

  if (query.isError) {
    return (
      <div className={stackStyles.stack}>
        <h1>Panel general</h1>
        <FormError message="Ocurrió un error inesperado. Intente de nuevo." />
      </div>
    );
  }

  const resumen = query.data;
  const quiebres = resumen?.quiebres ?? 0;
  const stockBajo = resumen?.stockBajo ?? 0;
  const alertasActivas = resumen?.alertasActivas ?? 0;
  const actividadReciente = resumen?.actividadReciente ?? [];

  return (
    <div className={stackStyles.stack}>
      <h1>Panel general</h1>
      <div className={styles.grid}>
        <KpiCard
          label="Quiebres"
          variant={quiebres > 0 ? 'danger' : undefined}
          value={
            <span className={styles.chipRow}>
              <span>{quiebres}</span>
              <StatusChip
                variant={quiebres > 0 ? 'danger' : 'success'}
                label={quiebres > 0 ? 'Quiebre' : 'Sin quiebres'}
              />
            </span>
          }
        />
        <KpiCard
          label="Stock bajo"
          value={
            <span className={styles.chipRow}>
              <span>{stockBajo}</span>
              <StatusChip
                variant={stockBajo > 0 ? 'warning' : 'success'}
                label={stockBajo > 0 ? 'Bajo' : 'Stock ok'}
              />
            </span>
          }
        />
        <KpiCard
          label="Actividad reciente"
          value={<ActividadRecienteList movimientos={actividadReciente} />}
        />
        <KpiCard label="Alertas activas" value={alertasActivas} />
      </div>
    </div>
  );
}

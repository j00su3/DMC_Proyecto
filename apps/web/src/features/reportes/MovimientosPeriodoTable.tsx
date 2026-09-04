import {
  DataTable,
  type DataTableColumn,
} from '../../components/ui/DataTable.js';
import { TextField } from '../../components/ui/TextField.js';
import styles from './MovimientosPeriodoTable.module.css';

export type TipoMovimiento =
  | 'entrada'
  | 'salida'
  | 'ajuste'
  | 'venta'
  | 'anulacion';

export type MovimientoRow = {
  id: string;
  productoId: string;
  productoNombre: string;
  tipo: TipoMovimiento;
  cantidad: number;
  motivo: string | null;
  esDiscrepancia: boolean;
  esMerma: boolean;
  usuarioId: string;
  fecha: string;
  ventaId: string | null;
  stockResultante: number;
};

const TIPO_LABEL: Record<TipoMovimiento, string> = {
  entrada: 'Entrada',
  salida: 'Salida',
  ajuste: 'Ajuste',
  venta: 'Venta',
  anulacion: 'Anulación',
};

type MovimientosPeriodoTableProps = {
  movimientos: MovimientoRow[];
  'aria-busy'?: boolean;
  /** Calendar-day inclusive, `YYYY-MM-DD` — same shape the server's Zod
   * schema (D5) expects. Both roles get the same date-range control
   * (proposal.md's ratified scoping decision 2); the server enforces
   * deposito's row-level scope (D3), this component only surfaces the
   * shared filter. */
  fechaDesde: string;
  fechaHasta: string;
  /** Route owns the filter state and re-fetch (route-module boundary
   * convention, `ProveedoresTable.tsx`/`AlertasTable.tsx` precedent) — this
   * component only reports the requested next range. */
  onFilterChange: (next: { fechaDesde: string; fechaHasta: string }) => void;
};

function buildColumns(): DataTableColumn<MovimientoRow>[] {
  return [
    {
      key: 'producto',
      header: 'Producto',
      render: (row) => row.productoNombre,
    },
    { key: 'tipo', header: 'Tipo', render: (row) => TIPO_LABEL[row.tipo] },
    {
      key: 'cantidad',
      header: 'Cantidad',
      align: 'right',
      render: (row) => String(row.cantidad),
    },
    { key: 'fecha', header: 'Fecha', render: (row) => row.fecha },
    {
      key: 'stockResultante',
      header: 'Stock resultante',
      align: 'right',
      render: (row) => String(row.stockResultante),
    },
  ];
}

/**
 * Presentational table for the movimientos-por-período report. Includes the
 * date-range filter controls (`fechaDesde`/`fechaHasta`, task 5.2) — no
 * router import here (route-module boundary convention); the route owns
 * `?fechaDesde`/`?fechaHasta` state and re-fetches via `onFilterChange`.
 */
export function MovimientosPeriodoTable({
  movimientos,
  'aria-busy': ariaBusy,
  fechaDesde,
  fechaHasta,
  onFilterChange,
}: MovimientosPeriodoTableProps) {
  return (
    <div className={styles.list}>
      <div className={styles.filters}>
        <TextField
          id="movimientos-fecha-desde"
          label="Desde"
          type="date"
          value={fechaDesde}
          onChange={(event) =>
            onFilterChange({ fechaDesde: event.target.value, fechaHasta })
          }
        />
        <TextField
          id="movimientos-fecha-hasta"
          label="Hasta"
          type="date"
          value={fechaHasta}
          onChange={(event) =>
            onFilterChange({ fechaDesde, fechaHasta: event.target.value })
          }
        />
      </div>
      {movimientos.length === 0 ? (
        <p>No hay movimientos para el período seleccionado.</p>
      ) : (
        <DataTable
          columns={buildColumns()}
          rows={movimientos}
          rowKey={(row) => row.id}
          aria-busy={ariaBusy}
        />
      )}
    </div>
  );
}

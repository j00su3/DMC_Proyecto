import {
  DataTable,
  type DataTableColumn,
} from '../../components/ui/DataTable.js';
import { StatusChip } from '../../components/ui/StatusChip.js';

export type MovimientoRow = {
  id: string;
  tipo: 'entrada' | 'salida' | 'ajuste' | 'venta' | 'anulacion';
  cantidad: number;
  motivo: string | null;
  esMerma: boolean;
  stockResultante: number;
  usuarioId: string;
  fecha: string;
};

type MovimientosTableProps = {
  movimientos: MovimientoRow[];
  'aria-busy'?: boolean;
};

const TIPO_LABELS: Record<MovimientoRow['tipo'], string> = {
  entrada: 'Entrada',
  salida: 'Salida',
  ajuste: 'Ajuste',
  venta: 'Venta',
  anulacion: 'Anulación',
};

/** `toLocaleDateString` with a fixed locale, matching `format.ts`'s
 * precedent of never depending on the test runner's system locale. */
function formatFecha(fecha: string): string {
  return new Date(fecha).toLocaleDateString('es-AR');
}

const columns: DataTableColumn<MovimientoRow>[] = [
  {
    key: 'tipo',
    header: 'Tipo',
    render: (row) => (
      <>
        {TIPO_LABELS[row.tipo]}
        {row.esMerma ? <StatusChip variant="warning" label="Merma" /> : null}
      </>
    ),
  },
  {
    key: 'cantidad',
    header: 'Cantidad',
    align: 'right',
    render: (row) => String(row.cantidad),
  },
  {
    key: 'stockResultante',
    header: 'Stock resultante',
    align: 'right',
    render: (row) => String(row.stockResultante),
  },
  {
    key: 'motivo',
    header: 'Motivo',
    render: (row) => row.motivo ?? '—',
  },
  {
    key: 'fecha',
    header: 'Fecha',
    render: (row) => formatFecha(row.fecha),
  },
  {
    key: 'usuarioId',
    header: 'Usuario',
    render: (row) => row.usuarioId,
  },
];

/**
 * Presentational history table (S8, D4/D10). `esMerma` renders a
 * `StatusChip` badge beside the type label — the mechanism by which "a
 * merma row is visually distinguishable from an ordinary salida"
 * (movimientos-ui spec) is satisfied without a bespoke chip component,
 * reusing `ProductosTable.tsx`'s `StatusChip` precedent.
 */
export function MovimientosTable({
  movimientos,
  'aria-busy': ariaBusy,
}: MovimientosTableProps) {
  return (
    <DataTable
      columns={columns}
      rows={movimientos}
      rowKey={(row) => row.id}
      aria-busy={ariaBusy}
    />
  );
}

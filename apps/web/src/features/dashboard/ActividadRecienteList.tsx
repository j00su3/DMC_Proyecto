import {
  DataTable,
  type DataTableColumn,
} from '../../components/ui/DataTable.js';

export type TipoMovimiento =
  | 'entrada'
  | 'salida'
  | 'ajuste'
  | 'venta'
  | 'anulacion';

export type MovimientoRecienteRow = {
  id: string;
  productoId: string;
  productoNombre: string;
  tipo: TipoMovimiento;
  fecha: string;
  usuarioId: string;
};

const TIPO_LABEL: Record<TipoMovimiento, string> = {
  entrada: 'Entrada',
  salida: 'Salida',
  ajuste: 'Ajuste',
  venta: 'Venta',
  anulacion: 'Anulación',
};

/** Fixed locale — never depends on the test runner's system locale
 * (`features/usuarios/format.ts`'s precedent). */
const dateFormatter = new Intl.DateTimeFormat('es-AR');

function formatFecha(fecha: string): string {
  return dateFormatter.format(new Date(fecha));
}

const columns: DataTableColumn<MovimientoRecienteRow>[] = [
  { key: 'producto', header: 'Producto', render: (row) => row.productoNombre },
  { key: 'tipo', header: 'Tipo', render: (row) => TIPO_LABEL[row.tipo] },
  { key: 'fecha', header: 'Fecha', render: (row) => formatFecha(row.fecha) },
  { key: 'usuarioId', header: 'Usuario', render: (row) => row.usuarioId },
];

type ActividadRecienteListProps = {
  movimientos: MovimientoRecienteRow[];
};

/**
 * "Actividad reciente" card content (dashboard-ui spec, "Actividad Reciente
 * Shows Exactly The 10 Most Recent Movimientos"). `usuarioId` is shown raw,
 * not resolved to a nombre — matches `MovimientosPeriodoTable`'s existing
 * precedent (D3). Empty state matches `MovimientosPeriodoTable`'s exact
 * inline convention (no shared `EmptyState` component exists here).
 */
export function ActividadRecienteList({
  movimientos,
}: ActividadRecienteListProps) {
  if (movimientos.length === 0) {
    return <p>No hay movimientos recientes.</p>;
  }

  return (
    <DataTable columns={columns} rows={movimientos} rowKey={(row) => row.id} />
  );
}

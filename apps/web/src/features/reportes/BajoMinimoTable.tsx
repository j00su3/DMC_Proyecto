import { DataTable } from '../../components/ui/DataTable.js';
import {
  type ProductoReporteRow,
  buildStockActualColumns,
} from './StockActualTable.js';

type BajoMinimoTableProps = {
  productos: ProductoReporteRow[];
  'aria-busy'?: boolean;
};

/**
 * Presentational table for the bajo-mínimo report. Same row shape and
 * columns as `StockActualTable` (both reports return the same producto DTO)
 * — kept as its own component per task 5.1's file split, reusing the column
 * builder rather than duplicating it.
 */
export function BajoMinimoTable({
  productos,
  'aria-busy': ariaBusy,
}: BajoMinimoTableProps) {
  if (productos.length === 0) {
    return <p>No hay productos para mostrar.</p>;
  }

  return (
    <DataTable
      columns={buildStockActualColumns()}
      rows={productos}
      rowKey={(row) => row.id}
      aria-busy={ariaBusy}
    />
  );
}

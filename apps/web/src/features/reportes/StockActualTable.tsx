import {
  DataTable,
  type DataTableColumn,
} from '../../components/ui/DataTable.js';

/** Row shape shared by the stock-actual and bajo-mínimo reports — both call
 * `GET /api/reportes/stock-actual` / `/bajo-minimo`, which return the same
 * producto DTO shape. */
export type ProductoReporteRow = {
  id: string;
  nombre: string;
  sku: string;
  categoria: string | null;
  stockActual: number;
  stockMinimo: number | null;
  precio: string;
  proveedorId: string;
  activo: boolean;
  creadoEn: string;
};

type StockActualTableProps = {
  productos: ProductoReporteRow[];
  'aria-busy'?: boolean;
};

export function buildStockActualColumns(): DataTableColumn<ProductoReporteRow>[] {
  return [
    { key: 'nombre', header: 'Producto', render: (row) => row.nombre },
    { key: 'sku', header: 'SKU', render: (row) => row.sku },
    {
      key: 'categoria',
      header: 'Categoría',
      render: (row) => row.categoria ?? '—',
    },
    {
      key: 'stockActual',
      header: 'Stock actual',
      align: 'right',
      render: (row) => String(row.stockActual),
    },
    {
      key: 'stockMinimo',
      header: 'Stock mínimo',
      align: 'right',
      render: (row) =>
        row.stockMinimo === null ? '—' : String(row.stockMinimo),
    },
  ];
}

/**
 * Presentational table for the stock-actual report — mirrors
 * `ProveedoresTable.tsx`'s shape: `DataTable` + explicit empty state, no
 * router import (route-module boundary convention).
 */
export function StockActualTable({
  productos,
  'aria-busy': ariaBusy,
}: StockActualTableProps) {
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

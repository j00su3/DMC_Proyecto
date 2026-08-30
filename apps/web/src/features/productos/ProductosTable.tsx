import {
  DataTable,
  type DataTableColumn,
} from '../../components/ui/DataTable.js';

export type ProductoRow = {
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

type ProductosTableProps = {
  productos: ProductoRow[];
  'aria-busy'?: boolean;
};

const columns: DataTableColumn<ProductoRow>[] = [
  { key: 'nombre', header: 'Nombre', render: (row) => row.nombre },
  { key: 'sku', header: 'SKU', render: (row) => row.sku },
  {
    key: 'categoria',
    header: 'Categoría',
    render: (row) => row.categoria ?? '—',
  },
  {
    key: 'stockActual',
    header: 'Stock',
    align: 'right',
    render: (row) => String(row.stockActual),
  },
  {
    key: 'precio',
    header: 'Precio',
    align: 'right',
    render: (row) => row.precio,
  },
];

/**
 * Presentational, mirrors `UsuariosTable.tsx`'s route-module boundary.
 * Status chips and row actions land in S6b/S7b.
 */
export function ProductosTable({
  productos,
  'aria-busy': ariaBusy,
}: ProductosTableProps) {
  return (
    <DataTable
      columns={columns}
      rows={productos}
      rowKey={(row) => row.id}
      aria-busy={ariaBusy}
    />
  );
}

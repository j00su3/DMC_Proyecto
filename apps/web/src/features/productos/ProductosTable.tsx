import {
  DataTable,
  type DataTableColumn,
} from '../../components/ui/DataTable.js';
import { StatusChip } from '../../components/ui/StatusChip.js';
import { estadoStock } from './format.js';

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
  {
    key: 'estado',
    header: 'Estado',
    render: (row) => {
      const estado = estadoStock(row.stockActual, row.stockMinimo);
      if (estado === 'quiebre') {
        return <StatusChip variant="danger" label="Quiebre" />;
      }
      if (estado === 'bajo') {
        return <StatusChip variant="warning" label="Bajo" />;
      }
      return null;
    },
  },
];

/**
 * Presentational, mirrors `UsuariosTable.tsx`'s route-module boundary.
 * Row actions (deactivate/reactivate) land in S7b. Status is derived
 * client-side only (D9) — never a field read straight off the DTO.
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

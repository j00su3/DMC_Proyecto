import { Button } from '../../components/ui/Button.js';
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
  /**
   * `/inventario/$id` (detail/edit + the movimientos trigger and history,
   * D10) shipped fully built with zero entry point from this list — the
   * only way in was typing the URL by hand. This callback, not a `Link`
   * here, keeps the table presentational (route-module boundary below);
   * the route decides how to navigate.
   */
  onView?: (id: string) => void;
};

function buildColumns(
  onView: ProductosTableProps['onView'],
): DataTableColumn<ProductoRow>[] {
  return [
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
    {
      key: 'acciones',
      header: 'Acciones',
      render: (row) => (
        <Button variant="secondary" onClick={() => onView?.(row.id)}>
          Ver
        </Button>
      ),
    },
  ];
}

/**
 * Presentational, mirrors `UsuariosTable.tsx`'s route-module boundary — no
 * router import here, `onView` hands navigation back to the route. Other
 * row actions (deactivate/reactivate) live on the detail screen, not here.
 * Status is derived client-side only (D9) — never a field read straight
 * off the DTO.
 */
export function ProductosTable({
  productos,
  'aria-busy': ariaBusy,
  onView,
}: ProductosTableProps) {
  return (
    <DataTable
      columns={buildColumns(onView)}
      rows={productos}
      rowKey={(row) => row.id}
      aria-busy={ariaBusy}
    />
  );
}

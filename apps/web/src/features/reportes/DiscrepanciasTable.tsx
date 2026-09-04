import {
  DataTable,
  type DataTableColumn,
} from '../../components/ui/DataTable.js';
import { StatusChip } from '../../components/ui/StatusChip.js';

export type TipoAlerta =
  | 'stock_bajo'
  | 'quiebre'
  | 'discrepancia'
  | 'sugerencia_reposicion';
export type EstadoAlerta = 'activa' | 'vista' | 'resuelta';

export type DiscrepanciaRow = {
  id: string;
  productoId: string;
  productoNombre: string;
  tipo: TipoAlerta;
  estado: EstadoAlerta;
  movimientoId: string | null;
  creadaEn: string;
  resueltaEn: string | null;
  resueltaPor: string | null;
};

const ESTADO_LABEL: Record<EstadoAlerta, string> = {
  activa: 'Activa',
  vista: 'Vista',
  resuelta: 'Resuelta',
};

function buildColumns(): DataTableColumn<DiscrepanciaRow>[] {
  return [
    {
      key: 'producto',
      header: 'Producto',
      render: (row) => row.productoNombre,
    },
    {
      key: 'estado',
      header: 'Estado',
      render: (row) =>
        row.estado === 'activa' ? (
          <StatusChip variant="danger" label={ESTADO_LABEL[row.estado]} />
        ) : (
          <StatusChip variant="warning" label={ESTADO_LABEL[row.estado]} />
        ),
    },
    {
      key: 'resueltaEn',
      header: 'Resuelta en',
      render: (row) => (row.resueltaEn ? row.resueltaEn : '—'),
    },
    {
      key: 'resueltaPor',
      header: 'Resuelta por',
      render: (row) => row.resueltaPor ?? '—',
    },
  ];
}

/**
 * Presentational table for the discrepancias globales report (spec
 * "Encargado sees resolution state"): displays `estado`, `resueltaEn`,
 * `resueltaPor` per row. Encargado-only screen (route guard, task 5.4) — no
 * router import here (route-module boundary convention).
 */
export function DiscrepanciasTable({
  discrepancias,
  'aria-busy': ariaBusy,
}: {
  discrepancias: DiscrepanciaRow[];
  'aria-busy'?: boolean;
}) {
  if (discrepancias.length === 0) {
    return <p>No hay discrepancias para mostrar.</p>;
  }

  return (
    <DataTable
      columns={buildColumns()}
      rows={discrepancias}
      rowKey={(row) => row.id}
      aria-busy={ariaBusy}
    />
  );
}

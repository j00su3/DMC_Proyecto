import { Button } from '../../components/ui/Button.js';
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

export type AlertaRow = {
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

const TIPO_LABEL: Record<TipoAlerta, string> = {
  stock_bajo: 'Stock bajo',
  quiebre: 'Quiebre de stock',
  discrepancia: 'Discrepancia',
  sugerencia_reposicion: 'Sugerencia de reposición',
};

/**
 * Only `discrepancia` is manually resolvable server-side
 * (`alertNotManuallyResolvable()` — design.md's Interfaces/Contracts). The
 * resolve control is never offered for `stock_bajo`/`quiebre`/
 * `sugerencia_reposicion`, matching the server, not merely hiding a control
 * the server would refuse anyway.
 */
function isManuallyResolvable(tipo: TipoAlerta): boolean {
  return tipo === 'discrepancia';
}

type AlertasTableProps = {
  alertas: AlertaRow[];
  'aria-busy'?: boolean;
  /**
   * Gates the resolve control (PD-3, alertas-ui spec's "Manual Resolve
   * Control Restricted To Encargado" — UX affordance only, the route's
   * `config: { roles: ['encargado'] }` 403 is the real boundary). Undefined
   * hides the control, the same safe default `ProveedoresTable.tsx` uses.
   */
  actorRol?: 'encargado' | 'deposito';
  /**
   * Stays presentational — no router import here (route-module boundary,
   * `ProveedoresTable.tsx`/`ProductosTable.tsx` precedent). The route owns
   * the mutation via `useResolverAlerta`.
   */
  onResolve?: (id: string) => void;
};

function buildColumns(
  actorRol: AlertasTableProps['actorRol'],
  onResolve: AlertasTableProps['onResolve'],
): DataTableColumn<AlertaRow>[] {
  const canResolve = actorRol === 'encargado';

  const columns: DataTableColumn<AlertaRow>[] = [
    {
      key: 'producto',
      header: 'Producto',
      render: (row) => row.productoNombre,
    },
    {
      key: 'tipo',
      header: 'Tipo',
      render: (row) => TIPO_LABEL[row.tipo],
    },
    {
      key: 'estado',
      header: 'Estado',
      render: (row) =>
        row.estado === 'activa' ? (
          <StatusChip variant="danger" label="Activa" />
        ) : row.estado === 'vista' ? (
          <StatusChip variant="warning" label="Vista" />
        ) : (
          <StatusChip activo={false} />
        ),
    },
  ];

  if (canResolve) {
    columns.push({
      key: 'acciones',
      header: 'Acciones',
      render: (row) =>
        row.estado === 'activa' && isManuallyResolvable(row.tipo) ? (
          <Button variant="secondary" onClick={() => onResolve?.(row.id)}>
            Resolver
          </Button>
        ) : null,
    });
  }

  return columns;
}

/**
 * Presentational table for the alerts screen (design.md's Frontend table).
 * No router import — route owns navigation/mutations (route-module
 * boundary convention).
 */
export function AlertasTable({
  alertas,
  'aria-busy': ariaBusy,
  actorRol,
  onResolve,
}: AlertasTableProps) {
  if (alertas.length === 0) {
    return <p>No hay alertas para mostrar.</p>;
  }

  return (
    <DataTable
      columns={buildColumns(actorRol, onResolve)}
      rows={alertas}
      rowKey={(row) => row.id}
      aria-busy={ariaBusy}
    />
  );
}

import { useState } from 'react';
import { Button } from '../../components/ui/Button.js';
import buttonStyles from '../../components/ui/Button.module.css';
import {
  DataTable,
  type DataTableColumn,
} from '../../components/ui/DataTable.js';
import { StatusChip } from '../../components/ui/StatusChip.js';
import { TextField } from '../../components/ui/TextField.js';
import styles from './ProveedoresTable.module.css';

export type ProveedorRow = {
  id: string;
  nombre: string;
  contacto: string | null;
  activo: boolean;
  creadoEn: string;
};

type ProveedoresTableProps = {
  proveedores: ProveedorRow[];
  'aria-busy'?: boolean;
  /**
   * Route decides how to reflect the selection (D1 — `?selected=<uuid>`,
   * navigate `replace: true`). This stays presentational — no router import
   * here (route-module boundary, `ProductosTable.tsx`/`UsuariosTable.tsx`
   * precedent).
   */
  onSelect?: (id: string) => void;
  /**
   * Gates the "Crear proveedor nuevo" trigger (PD-5, D5's UX-affordance-only
   * pattern — the server's 403 remains the real boundary). Undefined hides
   * the trigger, the same safe default the rest of this feature uses.
   */
  actorRol?: 'encargado' | 'deposito';
  /**
   * Route owns the `isCreating` state (D6) — this only requests the
   * transition. Lives here, not in `ProveedorDetallePanel`, because PD-5
   * says literally "the master pane MUST offer" this action; the previous
   * placement inside the detail pane's placeholder made it unreachable once
   * any supplier was selected (verify-report.md WARNING).
   */
  onStartCreate?: () => void;
};

/**
 * Client-side substring match over nombre + contacto, case-insensitive,
 * null-safe on contacto (D4). Never reaches the server — the master list is
 * fetched once, unpaginated (PD-1), and this only narrows what's already
 * loaded.
 */
function matchesFilter(proveedor: ProveedorRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;

  const nombre = proveedor.nombre.toLowerCase();
  const contacto = (proveedor.contacto ?? '').toLowerCase();
  return nombre.includes(needle) || contacto.includes(needle);
}

function buildColumns(
  onSelect: ProveedoresTableProps['onSelect'],
): DataTableColumn<ProveedorRow>[] {
  return [
    { key: 'nombre', header: 'Nombre', render: (row) => row.nombre },
    {
      key: 'estado',
      header: 'Estado',
      render: (row) => <StatusChip activo={row.activo} />,
    },
    {
      key: 'acciones',
      header: 'Acciones',
      render: (row) => (
        <Button variant="secondary" onClick={() => onSelect?.(row.id)}>
          Ver
        </Button>
      ),
    },
  ];
}

/**
 * Presentational (route-module boundary, `ProductosTable.tsx`/
 * `UsuariosTable.tsx` precedent) — no router import, `onSelect` hands
 * navigation back to the route. Inactive suppliers are never filtered out:
 * PD-1 requires the full catalog, active and inactive, visible in one
 * unpaginated fetch.
 *
 * Also owns the "Crear proveedor nuevo" trigger (PD-5) — this is the actual
 * master pane, so the trigger renders here regardless of what the detail
 * pane shows, staying reachable even once a supplier is selected.
 */
export function ProveedoresTable({
  proveedores,
  'aria-busy': ariaBusy,
  onSelect,
  actorRol,
  onStartCreate,
}: ProveedoresTableProps) {
  const [q, setQ] = useState('');
  const filtered = proveedores.filter((proveedor) =>
    matchesFilter(proveedor, q),
  );
  const isDeposito = actorRol !== 'encargado';

  return (
    <div className={styles.list}>
      <TextField
        id="proveedores-search"
        label="Buscar por nombre o contacto"
        value={q}
        onChange={(event) => setQ(event.target.value)}
      />
      {isDeposito ? null : (
        <Button
          variant="primary"
          className={buttonStyles.compact}
          onClick={() => onStartCreate?.()}
        >
          Crear proveedor nuevo
        </Button>
      )}
      {filtered.length === 0 ? (
        <p>No se encontraron proveedores que coincidan con la búsqueda.</p>
      ) : (
        <DataTable
          columns={buildColumns(onSelect)}
          rows={filtered}
          rowKey={(row) => row.id}
          aria-busy={ariaBusy}
        />
      )}
    </div>
  );
}

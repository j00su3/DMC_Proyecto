import { Button } from '../../components/ui/Button.js';
import {
  DataTable,
  type DataTableColumn,
} from '../../components/ui/DataTable.js';
import { StatusChip } from '../../components/ui/StatusChip.js';
import styles from './UsuariosTable.module.css';
import { formatFecha } from './format.js';

type UsuarioRow = {
  id: string;
  nombre: string;
  email: string;
  rol: 'encargado' | 'deposito';
  activo: boolean;
  debeCambiarPassword: boolean;
  creadoEn: string;
};

type UsuariosTableProps = {
  usuarios: UsuarioRow[];
  'aria-busy'?: boolean;
  /**
   * The logged-in user's own id. When a row's id matches, its
   * deactivate/reactivate and password-reset controls render disabled with
   * a visible reason (D17, extended by the corrected spec) — a UI
   * affordance, not an authorization control: the server still permits
   * both operations aimed at yourself.
   */
  currentUserId?: string;
  onDeactivate?: (id: string) => void;
  onReactivate?: (id: string) => void;
  onPasswordReset?: (id: string) => void;
};

const SELF_ACTION_REASON =
  'No puede realizar esta acción sobre su propia cuenta: cerraría todas sus sesiones de inmediato.';

const ROL_LABEL: Record<UsuarioRow['rol'], string> = {
  encargado: 'Encargado',
  deposito: 'Depósito',
};

function buildColumns({
  currentUserId,
  onDeactivate,
  onReactivate,
  onPasswordReset,
}: Pick<
  UsuariosTableProps,
  'currentUserId' | 'onDeactivate' | 'onReactivate' | 'onPasswordReset'
>): DataTableColumn<UsuarioRow>[] {
  return [
    { key: 'nombre', header: 'Nombre', render: (row) => row.nombre },
    { key: 'email', header: 'Correo', render: (row) => row.email },
    { key: 'rol', header: 'Rol', render: (row) => ROL_LABEL[row.rol] },
    {
      key: 'estado',
      header: 'Estado',
      render: (row) => (
        <StatusChip
          activo={row.activo}
          debeCambiarPassword={row.debeCambiarPassword}
        />
      ),
    },
    {
      key: 'creadoEn',
      header: 'Creado',
      render: (row) => formatFecha(row.creadoEn),
    },
    {
      key: 'acciones',
      header: 'Acciones',
      render: (row) => {
        const isOwnRow = currentUserId === row.id;
        return (
          <div className={styles.actions}>
            <div className={styles.actionRow}>
              {row.activo ? (
                <Button
                  variant="secondary"
                  disabled={isOwnRow}
                  onClick={() => onDeactivate?.(row.id)}
                >
                  Desactivar
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  disabled={isOwnRow}
                  onClick={() => onReactivate?.(row.id)}
                >
                  Reactivar
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={isOwnRow}
                onClick={() => onPasswordReset?.(row.id)}
              >
                Restablecer contraseña
              </Button>
            </div>
            {isOwnRow ? (
              <span className={styles.reason}>{SELF_ACTION_REASON}</span>
            ) : null}
          </div>
        );
      },
    },
  ];
}

/**
 * Presentational — no router or react-query import (route-module boundary,
 * `LoginForm.tsx:17`'s precedent). Deactivated users are never filtered
 * out here: this change ships no search/filtering, so hiding them would
 * leave no way back into view (usuarios-ui / List Screen With Pagination
 * And Visible Deactivated Users).
 */
export function UsuariosTable({
  usuarios,
  'aria-busy': ariaBusy,
  currentUserId,
  onDeactivate,
  onReactivate,
  onPasswordReset,
}: UsuariosTableProps) {
  const columns = buildColumns({
    currentUserId,
    onDeactivate,
    onReactivate,
    onPasswordReset,
  });
  return (
    <DataTable
      columns={columns}
      rows={usuarios}
      rowKey={(row) => row.id}
      aria-busy={ariaBusy}
    />
  );
}

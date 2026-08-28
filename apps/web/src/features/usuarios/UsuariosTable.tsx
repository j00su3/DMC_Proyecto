import {
  DataTable,
  type DataTableColumn,
} from '../../components/ui/DataTable.js';
import { StatusChip } from '../../components/ui/StatusChip.js';
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
};

const ROL_LABEL: Record<UsuarioRow['rol'], string> = {
  encargado: 'Encargado',
  deposito: 'Depósito',
};

const columns: DataTableColumn<UsuarioRow>[] = [
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
];

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
}: UsuariosTableProps) {
  return (
    <DataTable
      columns={columns}
      rows={usuarios}
      rowKey={(row) => row.id}
      aria-busy={ariaBusy}
    />
  );
}

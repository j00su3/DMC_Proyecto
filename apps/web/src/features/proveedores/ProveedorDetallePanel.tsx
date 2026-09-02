import { Button } from '../../components/ui/Button.js';
import { StatusChip } from '../../components/ui/StatusChip.js';
import { ProveedorForm } from './ProveedorForm.js';
import { EMPTY_PROVEEDOR_FORM } from './schemas.js';
import type {
  ActualizarProveedorInput,
  CrearProveedorInput,
  ProveedorFormValues,
} from './schemas.js';

const ESTADO_LOCK_REASON =
  'Solo un encargado puede desactivar o reactivar un proveedor. El servidor rechaza esta acción para un usuario de depósito.';

type ProveedorDetalle = ProveedorFormValues & {
  activo: boolean;
  creadoEn: string;
};

type ProveedorDetallePanelProps = {
  /** Gates every write affordance (D5) — a UX affordance only; the server's 403 is the boundary. */
  actorRol: 'encargado' | 'deposito';
  /** `null` — nothing selected (placeholder). The route derives this from the already-fetched list (D3). */
  proveedor: ProveedorDetalle | null;
  /** D6: local `isCreating` state owned by the route, not a `?selected=nuevo` sentinel. */
  isCreating?: boolean;
  onStartCreate?: () => void;
  onCreate?: (input: CrearProveedorInput) => void;
  onUpdate?: (input: ActualizarProveedorInput) => void;
  onDeactivate?: () => void;
  onReactivate?: () => void;
  isCreatePending?: boolean;
  isUpdatePending?: boolean;
  isEstadoPending?: boolean;
};

/**
 * Presentational (route-module boundary, `productosDetalle.tsx` precedent,
 * bundled here as one component since Phase 2 ships no route yet). Pane
 * precedence mirrors D6: `isCreating` → create form; else `proveedor` →
 * detail (read-only for deposito, D5); else the empty placeholder, which is
 * also where the "Crear proveedor nuevo" trigger lives (PD-5), hidden for
 * deposito (D5's "+ Nuevo proveedor hidden for deposito" rule).
 */
export function ProveedorDetallePanel({
  actorRol,
  proveedor,
  isCreating,
  onStartCreate,
  onCreate,
  onUpdate,
  onDeactivate,
  onReactivate,
  isCreatePending,
  isUpdatePending,
  isEstadoPending,
}: ProveedorDetallePanelProps) {
  const isDeposito = actorRol === 'deposito';

  if (isCreating) {
    return (
      <div>
        <h2>Nuevo proveedor</h2>
        <ProveedorForm
          proveedor={EMPTY_PROVEEDOR_FORM}
          mode="create"
          onSubmit={(values) => onCreate?.(values)}
          isPending={isCreatePending}
        />
      </div>
    );
  }

  if (!proveedor) {
    return (
      <div>
        <p>Seleccione un proveedor de la lista para ver su detalle.</p>
        {isDeposito ? null : (
          <Button variant="primary" onClick={() => onStartCreate?.()}>
            Crear proveedor nuevo
          </Button>
        )}
      </div>
    );
  }

  return (
    <div>
      <h2>{proveedor.nombre}</h2>
      <StatusChip activo={proveedor.activo} />
      <p>Creado: {proveedor.creadoEn}</p>

      <ProveedorForm
        proveedor={{ nombre: proveedor.nombre, contacto: proveedor.contacto }}
        mode="edit"
        readonly={isDeposito}
        onSubmit={(values) => onUpdate?.(values)}
        isPending={isUpdatePending}
      />

      <div>
        {proveedor.activo ? (
          <Button
            variant="secondary"
            disabled={isDeposito}
            isPending={isEstadoPending}
            onClick={() => onDeactivate?.()}
          >
            Desactivar
          </Button>
        ) : (
          <Button
            variant="secondary"
            disabled={isDeposito}
            isPending={isEstadoPending}
            onClick={() => onReactivate?.()}
          >
            Reactivar
          </Button>
        )}
        {isDeposito ? (
          <p>
            <span aria-hidden="true">🔒</span> {ESTADO_LOCK_REASON}
          </p>
        ) : null}
      </div>
    </div>
  );
}

import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { isApiError } from '../api/errors.js';
import { FormError } from '../components/ui/FormError.js';
import { ProveedorDetallePanel } from '../features/proveedores/ProveedorDetallePanel.js';
import { ProveedoresTable } from '../features/proveedores/ProveedoresTable.js';
import { proveedoresErrorMessage } from '../features/proveedores/errorMessages.js';
import { proveedoresListQueryOptions } from '../features/proveedores/queries.js';
import { proveedorToFormValues } from '../features/proveedores/schemas.js';
import type {
  ActualizarProveedorInput,
  CrearProveedorInput,
} from '../features/proveedores/schemas.js';
import { useActualizarProveedor } from '../features/proveedores/useActualizarProveedor.js';
import { useCrearProveedor } from '../features/proveedores/useCrearProveedor.js';
import { useEstadoProveedor } from '../features/proveedores/useEstadoProveedor.js';
import { useProveedores } from '../features/proveedores/useProveedores.js';
import styles from './proveedores.module.css';
import { shellLayout } from './shellLayout.js';

/**
 * D1: single route, selection lives in `?selected=`. `.catch(undefined)`
 * keeps the never-throw idiom (`productos.tsx:24-31`) — a malformed id
 * normalises to "nothing selected" (ratified Open Question, design.md),
 * PD-2's not-found applies only to a well-formed uuid that fails to resolve.
 */
const proveedoresSearchSchema = z.object({
  selected: z.string().uuid().optional().catch(undefined),
});

/**
 * Screen for `supplier-management`/`proveedores-ui` (backlog #4.1). Under
 * `shellLayout`, NOT `encargadoLayout` — both roles read suppliers (D5),
 * only write controls are gated per component. One list query feeds both
 * panes (D3); the detail pane derives its record from that same list.
 */
export const proveedoresRoute = createRoute({
  getParentRoute: () => shellLayout,
  path: '/proveedores',
  validateSearch: proveedoresSearchSchema,
  loader: async ({ context }) => {
    // Swallowed deliberately (`productos.tsx:45-53` precedent): a thrown
    // loader error hits the router's generic CatchBoundary, not this screen.
    await context.queryClient
      .ensureQueryData(proveedoresListQueryOptions())
      .catch(() => undefined);
  },
  component: ProveedoresScreen,
});

function ProveedoresScreen() {
  const { selected } = proveedoresRoute.useSearch();
  const navigate = proveedoresRoute.useNavigate();
  const { usuario } = proveedoresRoute.useRouteContext();
  const [isCreating, setIsCreating] = useState(false);

  const query = useProveedores();
  const crear = useCrearProveedor();
  const actualizar = useActualizarProveedor(selected ?? '');
  const estado = useEstadoProveedor();

  const proveedores = query.data?.data ?? [];
  const proveedorDto = selected
    ? (proveedores.find((p) => p.id === selected) ?? null)
    : null;
  // `ProveedorDetallePanel`/`ProveedorForm` take editable string form values
  // (D3: `contacto: null` on the wire is never a third spelling of `''`, but
  // the reverse conversion for display uses the same rule as the create/edit
  // path, `proveedorToFormValues`).
  const proveedor = proveedorDto
    ? {
        ...proveedorToFormValues(proveedorDto),
        activo: proveedorDto.activo,
        creadoEn: proveedorDto.creadoEn,
      }
    : null;
  // Only decide "not found" once the list has actually loaded — otherwise a
  // still-loading fetch would flash the not-found state for a real id.
  const showNotFound =
    !isCreating &&
    selected !== undefined &&
    !proveedorDto &&
    query.data !== undefined;

  function handleSelect(id: string) {
    setIsCreating(false);
    navigate({ search: { selected: id }, replace: true });
  }

  function handleStartCreate() {
    setIsCreating(true);
  }

  function handleCreate(input: CrearProveedorInput) {
    crear.mutate(input, {
      onSuccess: (data) => {
        setIsCreating(false);
        // D2: `replace: true` — the pane is already mounted, only its
        // subject changes.
        navigate({ search: { selected: data.proveedor.id }, replace: true });
      },
    });
  }

  function handleUpdate(input: ActualizarProveedorInput) {
    actualizar.mutate(input);
  }

  const mutationError =
    crear.error ??
    actualizar.error ??
    estado.deactivate.error ??
    estado.reactivate.error;

  if (query.isError) {
    const message = isApiError(query.error)
      ? proveedoresErrorMessage(query.error)
      : 'Ocurrió un error inesperado. Intente de nuevo.';
    return (
      <div>
        <h1>Proveedores</h1>
        <FormError message={message} />
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <div className={styles.masterPane}>
        <h1>Proveedores</h1>
        {mutationError ? (
          <FormError
            message={
              isApiError(mutationError)
                ? proveedoresErrorMessage(mutationError)
                : 'Ocurrió un error inesperado. Intente de nuevo.'
            }
          />
        ) : null}
        <ProveedoresTable
          proveedores={proveedores}
          aria-busy={query.isPlaceholderData}
          onSelect={handleSelect}
          actorRol={usuario.rol}
          onStartCreate={handleStartCreate}
        />
      </div>
      <div className={styles.detailPane}>
        {showNotFound ? (
          <p>No se encontró el proveedor solicitado.</p>
        ) : (
          <ProveedorDetallePanel
            actorRol={usuario.rol}
            proveedor={proveedor}
            isCreating={isCreating}
            onCreate={handleCreate}
            onUpdate={handleUpdate}
            onDeactivate={() => selected && estado.deactivate.mutate(selected)}
            onReactivate={() => selected && estado.reactivate.mutate(selected)}
            isCreatePending={crear.isPending}
            isUpdatePending={actualizar.isPending}
            isEstadoPending={
              estado.deactivate.isPending || estado.reactivate.isPending
            }
          />
        )}
      </div>
    </div>
  );
}

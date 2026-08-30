import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { isApiError } from '../api/errors.js';
import { Button } from '../components/ui/Button.js';
import { FormError } from '../components/ui/FormError.js';
import { Pagination } from '../components/ui/Pagination.js';
import { StatusChip } from '../components/ui/StatusChip.js';
import {
  MovimientoModal,
  type MovimientoWireSubmission,
} from '../features/movimientos/MovimientoModal.js';
import { MovimientosTable } from '../features/movimientos/MovimientosTable.js';
import { movimientosErrorMessage } from '../features/movimientos/errorMessages.js';
import { PAGE_SIZE } from '../features/movimientos/queries.js';
import { useMovimientos } from '../features/movimientos/useMovimientos.js';
import { useRegistrarMovimiento } from '../features/movimientos/useRegistrarMovimiento.js';
import { ProductoForm } from '../features/productos/ProductoForm.js';
import { productosErrorMessage } from '../features/productos/errorMessages.js';
import { productoToFormValues } from '../features/productos/schemas.js';
import { useActualizarProducto } from '../features/productos/useActualizarProducto.js';
import { useEstadoProducto } from '../features/productos/useEstadoProducto.js';
import { useProducto } from '../features/productos/useProducto.js';
import { shellLayout } from './shellLayout.js';

const ESTADO_LOCK_REASON =
  'Solo un encargado puede desactivar o reactivar un producto. El servidor rechaza esta acción para un usuario de depósito.';

/**
 * Edit route (productos-ui / Create/Edit Form..., edit half; Deactivate/
 * Reactivate Controls; movimientos-ui / trigger + history, S8, D10). Under
 * `shellLayout`, NOT `encargadoLayout` (D9) — both roles edit products,
 * only `stock_minimo` and the deactivate/reactivate action are role-gated.
 * No initial-stock field: changing physical units is a movement, never an
 * update (ADR-0012 rule 1), so `ProductoForm`'s `mode="edit"` omits it
 * entirely, not disabled.
 *
 * The `Registrar movimiento` trigger and the movement history list (D10)
 * also live on this route, next to the deactivate/reactivate controls: the
 * modal needs `stockActual` for its live preview, which `useProducto(id)`
 * already holds here, and this is where every other product write already
 * lives. The trigger is HIDDEN, not disabled, for an inactive product — an
 * inactive product admits no new movements (ADR-0005), so offering the
 * control at all would be a promise the server refuses.
 */
export const productosDetalleRoute = createRoute({
  getParentRoute: () => shellLayout,
  path: '/inventario/$id',
  component: ProductosDetalleScreen,
});

function ProductosDetalleScreen() {
  const { id } = productosDetalleRoute.useParams();
  const { usuario } = productosDetalleRoute.useRouteContext();
  const query = useProducto(id);
  const actualizar = useActualizarProducto(id);
  const estado = useEstadoProducto();
  const isDeposito = usuario.rol === 'deposito';

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [movimientosPage, setMovimientosPage] = useState(1);
  const registrar = useRegistrarMovimiento(id);
  const movimientosQuery = useMovimientos(id, movimientosPage);

  // The three thin wrappers share one visible error/pending surface: only
  // one of them can ever be in flight at a time, since the modal is a
  // single form gated to one choice per open.
  const registrarError =
    registrar.entrada.error ?? registrar.salida.error ?? registrar.ajuste.error;
  const registrarServerError = registrarError
    ? isApiError(registrarError)
      ? movimientosErrorMessage(registrarError)
      : 'Ocurrió un error inesperado. Intente de nuevo.'
    : undefined;
  const isRegistrarPending =
    registrar.entrada.isPending ||
    registrar.salida.isPending ||
    registrar.ajuste.isPending;

  function handleSubmitMovimiento(submission: MovimientoWireSubmission) {
    const onSuccess = () => setIsModalOpen(false);
    if (submission.operacion === 'entrada') {
      registrar.entrada.mutate(submission.body, { onSuccess });
    } else if (submission.operacion === 'salida') {
      registrar.salida.mutate(submission.body, { onSuccess });
    } else {
      registrar.ajuste.mutate(submission.body, { onSuccess });
    }
  }

  if (query.isError) {
    const message = isApiError(query.error)
      ? productosErrorMessage(query.error)
      : 'Ocurrió un error inesperado. Intente de nuevo.';
    return (
      <div>
        <h1>Producto</h1>
        <FormError message={message} />
      </div>
    );
  }

  if (!query.data) {
    return <h1>Producto</h1>;
  }

  const { producto } = query.data;
  const estadoError = estado.deactivate.error ?? estado.reactivate.error;
  const movimientosData = movimientosQuery.data;
  const movimientosTotalPages = movimientosData
    ? Math.max(1, Math.ceil(movimientosData.total / PAGE_SIZE))
    : 1;

  return (
    <div>
      <h1>{producto.nombre}</h1>
      <StatusChip activo={producto.activo} />
      <p>Stock actual: {producto.stockActual}</p>

      {actualizar.isError ? (
        <FormError
          message={
            isApiError(actualizar.error)
              ? productosErrorMessage(actualizar.error)
              : 'Ocurrió un error inesperado. Intente de nuevo.'
          }
        />
      ) : null}
      {estadoError ? (
        <FormError
          message={
            isApiError(estadoError)
              ? productosErrorMessage(estadoError)
              : 'Ocurrió un error inesperado. Intente de nuevo.'
          }
        />
      ) : null}

      <ProductoForm
        producto={productoToFormValues(producto)}
        actorRol={usuario.rol}
        mode="edit"
        isPending={actualizar.isPending}
        onSubmit={(values) => actualizar.mutate(values)}
      />

      <div>
        {producto.activo ? (
          <Button
            variant="secondary"
            disabled={isDeposito}
            onClick={() => estado.deactivate.mutate(id)}
          >
            Desactivar
          </Button>
        ) : (
          <Button
            variant="secondary"
            disabled={isDeposito}
            onClick={() => estado.reactivate.mutate(id)}
          >
            Reactivar
          </Button>
        )}
        {isDeposito ? (
          <p>
            <span aria-hidden="true">🔒</span> {ESTADO_LOCK_REASON}
          </p>
        ) : null}
        {producto.activo ? (
          <Button variant="primary" onClick={() => setIsModalOpen(true)}>
            Registrar movimiento
          </Button>
        ) : null}
      </div>

      {isModalOpen ? (
        <MovimientoModal
          actorRol={usuario.rol}
          onClose={() => setIsModalOpen(false)}
          onSubmit={handleSubmitMovimiento}
          isPending={isRegistrarPending}
          stockActual={producto.stockActual}
          serverError={registrarServerError}
        />
      ) : null}

      <h2>Historial de movimientos</h2>
      <MovimientosTable
        movimientos={movimientosData?.data ?? []}
        aria-busy={movimientosQuery.isPlaceholderData}
      />
      <Pagination
        page={movimientosPage}
        totalPages={movimientosTotalPages}
        isBusy={movimientosQuery.isPlaceholderData}
        onPageChange={setMovimientosPage}
      />
    </div>
  );
}

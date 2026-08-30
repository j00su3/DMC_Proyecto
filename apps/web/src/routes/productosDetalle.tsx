import { createRoute } from '@tanstack/react-router';
import { isApiError } from '../api/errors.js';
import { Button } from '../components/ui/Button.js';
import { FormError } from '../components/ui/FormError.js';
import { StatusChip } from '../components/ui/StatusChip.js';
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
 * Reactivate Controls). Under `shellLayout`, NOT `encargadoLayout` (D9) —
 * both roles edit products, only `stock_minimo` and the deactivate/
 * reactivate action are role-gated. No initial-stock field: changing
 * physical units is a movement, never an update (ADR-0012 rule 1), so
 * `ProductoForm`'s `mode="edit"` omits it entirely, not disabled.
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

  return (
    <div>
      <h1>{producto.nombre}</h1>
      <StatusChip activo={producto.activo} />

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
      </div>
    </div>
  );
}

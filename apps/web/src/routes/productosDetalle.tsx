import { createRoute } from '@tanstack/react-router';
import { isApiError } from '../api/errors.js';
import { FormError } from '../components/ui/FormError.js';
import { StatusChip } from '../components/ui/StatusChip.js';
import { ProductoForm } from '../features/productos/ProductoForm.js';
import { productosErrorMessage } from '../features/productos/errorMessages.js';
import { productoToFormValues } from '../features/productos/schemas.js';
import { useActualizarProducto } from '../features/productos/useActualizarProducto.js';
import { useProducto } from '../features/productos/useProducto.js';
import { shellLayout } from './shellLayout.js';

/**
 * Edit route (productos-ui / Create/Edit Form..., edit half). Under
 * `shellLayout`, NOT `encargadoLayout` (D9) — both roles edit products,
 * only `stock_minimo` is role-gated. No initial-stock field: changing
 * physical units is a movement, never an update (ADR-0012 rule 1), so
 * `ProductoForm`'s `mode="edit"` omits it entirely, not disabled.
 * Deactivate/reactivate controls land in the next stacked slice
 * (line-budget split, see tasks.md Phase 13).
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

      <ProductoForm
        producto={productoToFormValues(producto)}
        actorRol={usuario.rol}
        mode="edit"
        isPending={actualizar.isPending}
        onSubmit={(values) => actualizar.mutate(values)}
      />
    </div>
  );
}

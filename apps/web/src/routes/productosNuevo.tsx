import { createRoute } from '@tanstack/react-router';
import { isApiError } from '../api/errors.js';
import { FormError } from '../components/ui/FormError.js';
import { ProductoForm } from '../features/productos/ProductoForm.js';
import { productosErrorMessage } from '../features/productos/errorMessages.js';
import { EMPTY_PRODUCTO_FORM } from '../features/productos/schemas.js';
import { useCrearProducto } from '../features/productos/useCrearProducto.js';
import { shellLayout } from './shellLayout.js';

/** Create route (productos-ui / Create/Edit Form..., create half). Under
 * `shellLayout`, NOT `encargadoLayout` — both roles create products (D9);
 * only `stock_minimo` is role-gated, per-field, inside `ProductoForm`. */
export const productosNuevoRoute = createRoute({
  getParentRoute: () => shellLayout,
  path: '/inventario/nuevo',
  component: ProductosNuevoScreen,
});

function ProductosNuevoScreen() {
  const navigate = productosNuevoRoute.useNavigate();
  const { usuario } = productosNuevoRoute.useRouteContext();
  const crear = useCrearProducto();

  return (
    <div>
      <h1>Nuevo producto</h1>

      {crear.error ? (
        <FormError
          message={
            isApiError(crear.error)
              ? productosErrorMessage(crear.error)
              : 'Ocurrió un error inesperado. Intente de nuevo.'
          }
        />
      ) : null}

      <ProductoForm
        producto={EMPTY_PRODUCTO_FORM}
        actorRol={usuario.rol}
        mode="create"
        isPending={crear.isPending}
        onSubmit={(values) =>
          crear.mutate(values, {
            onSuccess: () =>
              navigate({ to: '/inventario', search: { page: 1, q: '' } }),
          })
        }
      />
    </div>
  );
}

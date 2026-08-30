import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { FormError } from '../components/ui/FormError.js';
import { Pagination } from '../components/ui/Pagination.js';
import { ProductosTable } from '../features/productos/ProductosTable.js';
import {
  PAGE_SIZE,
  productosListQueryOptions,
} from '../features/productos/queries.js';
import { useProductos } from '../features/productos/useProductos.js';
import { shellLayout } from './shellLayout.js';

/**
 * Clamps rather than throws, same style as `routes/usuarios.tsx:24-30`
 * (`.catch()`, never throw): `?page` is one hand-edit away from a malformed
 * value, and a route that throws on it is a blank screen.
 */
const productosSearchSchema = z.object({
  page: z.coerce
    .number()
    .int()
    .catch(1)
    .transform((n) => Math.max(1, n)),
});

/**
 * List screen (productos-ui / Product List Is Open To Both Roles Under
 * shellLayout). Mounted directly under `shellLayout`, NOT `encargadoLayout`
 * — both `encargado` and `deposito` read products, per D9. Write controls
 * (create/edit/deactivate) gate per-component in later slices; the server's
 * 403 is the real boundary.
 */
export const productosListRoute = createRoute({
  getParentRoute: () => shellLayout,
  path: '/inventario',
  validateSearch: productosSearchSchema,
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: async ({ context, deps }) => {
    await context.queryClient.ensureQueryData(
      productosListQueryOptions(deps.page, ''),
    );
  },
  component: ProductosListScreen,
});

function ProductosListScreen() {
  const { page } = productosListRoute.useSearch();
  const navigate = productosListRoute.useNavigate();
  const query = useProductos(page, '');

  if (query.isError) {
    return (
      <div>
        <h1>Inventario</h1>
        <FormError message="Ocurrió un error inesperado. Intente de nuevo." />
      </div>
    );
  }

  const data = query.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div>
      <h1>Inventario</h1>
      <ProductosTable
        productos={data?.data ?? []}
        aria-busy={query.isPlaceholderData}
      />
      <Pagination
        page={page}
        totalPages={totalPages}
        isBusy={query.isPlaceholderData}
        onPageChange={(nextPage) => navigate({ search: { page: nextPage } })}
      />
    </div>
  );
}

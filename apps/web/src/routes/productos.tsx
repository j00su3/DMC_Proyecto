import { Link, createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { isApiError } from '../api/errors.js';
import buttonStyles from '../components/ui/Button.module.css';
import { FormError } from '../components/ui/FormError.js';
import { Pagination } from '../components/ui/Pagination.js';
import { TextField } from '../components/ui/TextField.js';
import { ProductosTable } from '../features/productos/ProductosTable.js';
import { productosErrorMessage } from '../features/productos/errorMessages.js';
import {
  PAGE_SIZE,
  productosListQueryOptions,
} from '../features/productos/queries.js';
import { useProductos } from '../features/productos/useProductos.js';
import { shellLayout } from './shellLayout.js';

/**
 * Clamps rather than throws, same style as `routes/usuarios.tsx:24-30`
 * (`.catch()`, never throw): `?page` is one hand-edit away from a malformed
 * value, and a route that throws on it is a blank screen. `q` is
 * bookmarkable (D9) — it lives here, not in component state, so the loader
 * participates in it.
 */
const productosSearchSchema = z.object({
  page: z.coerce
    .number()
    .int()
    .catch(1)
    .transform((n) => Math.max(1, n)),
  q: z.string().catch(''),
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
  loaderDeps: ({ search }) => ({ page: search.page, q: search.q }),
  loader: async ({ context, deps }) => {
    // Swallowed deliberately: a thrown loader error hits the router's
    // generic `CatchBoundary`, not this screen. The component's own
    // `useProductos` query re-reads the same now-errored cache entry and
    // surfaces it through `query.isError`, mapped by `productosErrorMessage`.
    await context.queryClient
      .ensureQueryData(productosListQueryOptions(deps.page, deps.q))
      .catch(() => undefined);
  },
  component: ProductosListScreen,
});

/**
 * `/inventario/nuevo` shipped fully built with zero entry point from this
 * list — same gap as `/usuarios/nuevo` (usuarios-ui), same fix.
 */
function NuevoProductoLink() {
  return (
    <Link
      to="/inventario/nuevo"
      className={`${buttonStyles.button} ${buttonStyles.primary}`}
    >
      Nuevo producto
    </Link>
  );
}

function ProductosListScreen() {
  const { page, q } = productosListRoute.useSearch();
  const navigate = productosListRoute.useNavigate();
  const query = useProductos(page, q);

  // Changing the search term resets page to 1 (D9) — otherwise a filtered
  // result of two pages is viewed at page 7 and renders empty.
  function handleSearchChange(nextQ: string) {
    navigate({ search: { page: 1, q: nextQ }, replace: true });
  }

  if (query.isError) {
    const message = isApiError(query.error)
      ? productosErrorMessage(query.error)
      : 'Ocurrió un error inesperado. Intente de nuevo.';
    return (
      <div>
        <h1>Inventario</h1>
        <NuevoProductoLink />
        <FormError message={message} />
      </div>
    );
  }

  const data = query.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div>
      <h1>Inventario</h1>
      <NuevoProductoLink />
      <TextField
        id="productos-search"
        label="Buscar por nombre o SKU"
        value={q}
        onChange={(event) => handleSearchChange(event.target.value)}
      />
      <ProductosTable
        productos={data?.data ?? []}
        aria-busy={query.isPlaceholderData}
        onView={(id) => navigate({ to: '/inventario/$id', params: { id } })}
      />
      <Pagination
        page={page}
        totalPages={totalPages}
        isBusy={query.isPlaceholderData}
        onPageChange={(nextPage) => navigate({ search: { page: nextPage, q } })}
      />
    </div>
  );
}

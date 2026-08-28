import { createRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { isApiError } from '../api/errors.js';
import { FormError } from '../components/ui/FormError.js';
import { Pagination } from '../components/ui/Pagination.js';
import { UsuariosTable } from '../features/usuarios/UsuariosTable.js';
import { usuariosErrorMessage } from '../features/usuarios/errorMessages.js';
import {
  PAGE_SIZE,
  usuariosListQueryOptions,
} from '../features/usuarios/queries.js';
import { useUsuarios } from '../features/usuarios/useUsuarios.js';
import { encargadoLayout } from './encargadoLayout.js';

/**
 * Clamps rather than throws (D6): `?page` is one hand-edit away, and a
 * route that throws on a malformed value is a blank screen. Only `page`
 * lives in the URL — `pageSize` is a module constant matched to the
 * server's default and has no picker in this change.
 */
const usuariosSearchSchema = z.object({
  page: z.coerce
    .number()
    .int()
    .catch(1)
    .transform((n) => Math.max(1, n)),
});

/**
 * List screen (usuarios-ui / List Screen With Pagination And Visible
 * Deactivated Users). No search or filter control ships in this change —
 * deactivated users stay visible, distinguished only by `StatusChip`.
 *
 * No approved `.dc.html` mockup exists for Usuarios (Design-Tokens-Only
 * Build requirement) — this screen is built from `docs/design.md`'s
 * documented tokens only, not an approved wireframe.
 *
 * The list computes no client-side guess about the last active encargado
 * (usuarios-ui / Last-Active-Encargado Guard Is Server-Authoritative): no
 * pre-disabled control, no heuristic, no count. `total` counts all users,
 * not active encargados, so any such guess would be wrong in both
 * directions — and even a correct one would race the server. The 409
 * reaction ships with the mutating actions in a later slice.
 */
export const usuariosListRoute = createRoute({
  getParentRoute: () => encargadoLayout,
  path: '/usuarios',
  validateSearch: usuariosSearchSchema,
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: async ({ context, deps }) => {
    // D11: out-of-range page detected and corrected only once the real,
    // settled response is in (never a client-side guess). Works because
    // `total` can only grow — no route in this change ever deletes a row —
    // so the surviving path is a typed/bookmarked `?page=` beyond the end.
    const data = await context.queryClient.ensureQueryData(
      usuariosListQueryOptions(deps.page),
    );
    if (data.data.length === 0 && data.total > 0 && deps.page > 1) {
      throw redirect({
        to: '/usuarios',
        search: { page: Math.ceil(data.total / PAGE_SIZE) },
        replace: true,
      });
    }
  },
  component: UsuariosListScreen,
});

function UsuariosListScreen() {
  const { page } = usuariosListRoute.useSearch();
  const navigate = usuariosListRoute.useNavigate();
  const query = useUsuarios(page);

  if (query.isError) {
    const message = isApiError(query.error)
      ? usuariosErrorMessage(query.error)
      : 'Ocurrió un error inesperado. Intente de nuevo.';
    return (
      <div>
        <h1>Usuarios</h1>
        <FormError message={message} />
      </div>
    );
  }

  const data = query.data;

  if (data && data.total === 0) {
    return (
      <div>
        <h1>Usuarios</h1>
        <p>No hay usuarios registrados.</p>
      </div>
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div>
      <h1>Usuarios</h1>
      <UsuariosTable
        usuarios={data?.data ?? []}
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

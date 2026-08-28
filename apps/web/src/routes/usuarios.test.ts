import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from './routeTree.js';

const encargadoUsuario = {
  id: '1',
  nombre: 'Ana',
  email: 'ana@test.com',
  rol: 'encargado' as const,
  debeCambiarPassword: false,
};

function buildAuthenticatedRouter(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const router = createRouter({ routeTree, context: { queryClient }, history });
  return router;
}

function stubFetchAsEncargado() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ usuario: encargadoUsuario }),
    }),
  );
}

/**
 * P2/P3 (design.md Testing Strategy) — route structure and resolution
 * exercised programmatically against the real, registered `routeTree`, the
 * same tree `app/router.test.tsx` renders through `RouterProvider`. No
 * rendering is needed here: `router.load()` resolves `beforeLoad` and
 * `validateSearch` for every matched route the same way navigation does.
 */
describe('usuarios routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves /usuarios/nuevo to the create route, not /usuarios/$id with id "nuevo" (D5)', async () => {
    stubFetchAsEncargado();
    const router = buildAuthenticatedRouter('/usuarios/nuevo');
    await router.load();

    expect(router.state.location.pathname).toBe('/usuarios/nuevo');
    const matchedIds = router.state.matches.map((match) => match.routeId);
    expect(matchedIds).toContain(
      '/authLayout/shellLayout/encargadoLayout/usuarios/nuevo',
    );
    expect(matchedIds).not.toContain(
      '/authLayout/shellLayout/encargadoLayout/usuarios/$id',
    );
  });

  it('clamps a non-numeric ?page to 1 without throwing (D6)', async () => {
    stubFetchAsEncargado();
    const router = buildAuthenticatedRouter('/usuarios?page=abc');
    await router.load();

    expect(router.state.location.pathname).toBe('/usuarios');
    const listMatch = router.state.matches.find(
      (match) =>
        match.routeId === '/authLayout/shellLayout/encargadoLayout/usuarios',
    );
    expect(listMatch?.search).toEqual({ page: 1 });
  });

  it('clamps a negative ?page to 1 without throwing (D6)', async () => {
    stubFetchAsEncargado();
    const router = buildAuthenticatedRouter('/usuarios?page=-4');
    await router.load();

    expect(router.state.location.pathname).toBe('/usuarios');
    const listMatch = router.state.matches.find(
      (match) =>
        match.routeId === '/authLayout/shellLayout/encargadoLayout/usuarios',
    );
    expect(listMatch?.search).toEqual({ page: 1 });
  });

  it('resolves /usuarios/:id to the detail route with the id in params', async () => {
    stubFetchAsEncargado();
    const router = buildAuthenticatedRouter('/usuarios/42');
    await router.load();

    expect(router.state.location.pathname).toBe('/usuarios/42');
    const matchedIds = router.state.matches.map((match) => match.routeId);
    expect(matchedIds).toContain(
      '/authLayout/shellLayout/encargadoLayout/usuarios/$id',
    );
  });
});

import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import styles from './AppShell.module.css';
import { NavItem } from './NavItem.js';

function buildTestRouter(initialPath: string, ui: React.ReactNode) {
  const rootRoute = createRootRoute({ component: () => ui });
  const usuariosRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/usuarios',
    component: () => null,
  });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => null,
  });
  const routeTree = rootRoute.addChildren([homeRoute, usuariosRoute]);
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  return createRouter({ routeTree, history });
}

/**
 * P3/P4 (design.md Testing Strategy) — active state must survive `?page`
 * changes (D2): the list route carries `?page`, so an active-state that
 * depends on default search-param matching would break on page 2+.
 */
describe('NavItem', () => {
  it('renders as an active link when the current route matches, ignoring search params', async () => {
    const router = buildTestRouter(
      '/usuarios?page=3',
      <NavItem label="Usuarios" to="/usuarios" />,
    );
    render(<RouterProvider router={router} />);

    const link = await screen.findByRole('link', { name: 'Usuarios' });
    expect(link.className).toContain(styles.navItemActive);
  });

  it('renders an inactive link through the same markup when the route does not match', async () => {
    const router = buildTestRouter(
      '/',
      <NavItem label="Usuarios" to="/usuarios" />,
    );
    render(<RouterProvider router={router} />);

    const link = await screen.findByRole('link', { name: 'Usuarios' });
    expect(link.className).not.toContain(styles.navItemActive);
  });

  it('renders a non-interactive marker through the same component/class when there is no destination', async () => {
    const router = buildTestRouter('/', <NavItem label="Inventario" />);
    render(<RouterProvider router={router} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    const marker = await screen.findByText('Inventario');
    expect(marker.parentElement?.className).toContain(styles.navItem);
  });

  it('renders the locked marker with a visible reason and never as a link', async () => {
    const router = buildTestRouter(
      '/',
      <NavItem
        label="Usuarios"
        to="/usuarios"
        locked
        reason="Disponible solo para encargados."
      />,
    );
    render(<RouterProvider router={router} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(await screen.findByText('Usuarios')).toBeInTheDocument();
    expect(await screen.findByText('🔒')).toBeInTheDocument();
    expect(
      screen.getByText('Disponible solo para encargados.'),
    ).toBeInTheDocument();
  });
});

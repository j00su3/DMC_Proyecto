import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cwd } from 'node:process';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppShell, type AppShellProps } from './AppShell.js';

const encargado = {
  id: '1',
  nombre: 'Ana Torres',
  email: 'ana@test.com',
  rol: 'encargado' as const,
  debeCambiarPassword: false,
};

const deposito = {
  id: '2',
  nombre: 'Beto Ruiz',
  email: 'beto@test.com',
  rol: 'deposito' as const,
  debeCambiarPassword: false,
};

/**
 * `AppShell` renders `NavItem`, which renders a TanStack `Link` — every
 * render needs router context, even though `AppShell` itself imports
 * neither the router nor react-query.
 */
function renderShell(props: AppShellProps) {
  const rootRoute = createRootRoute({
    component: () => <AppShell {...props} />,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(<RouterProvider router={router} />);
}

/**
 * Written against the pre-extraction `ShellPlaceholder` markup (docs/design.md's
 * D1) so it fails before `AppShell.tsx` exists — this is S1's RED test.
 */
describe('AppShell', () => {
  it("renders the user's initials, full name and role label", async () => {
    renderShell({
      usuario: encargado,
      onLogout: vi.fn(),
      isLoggingOut: false,
      children: <p>content</p>,
    });

    expect(await screen.findByText('AT')).toBeInTheDocument();
    expect(screen.getByText('Ana Torres')).toBeInTheDocument();
    expect(screen.getByText('Encargado · Admin')).toBeInTheDocument();
  });

  it('calls onLogout when the logout control is activated', async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    renderShell({
      usuario: encargado,
      onLogout,
      isLoggingOut: false,
      children: <p>content</p>,
    });

    await user.click(
      await screen.findByRole('button', { name: 'Cerrar sesión' }),
    );

    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('renders children inside <main>', async () => {
    renderShell({
      usuario: encargado,
      onLogout: vi.fn(),
      isLoggingOut: false,
      children: <p>Panel general content</p>,
    });

    const main = await screen.findByRole('main');
    expect(main).toHaveTextContent('Panel general content');
  });

  it('disables the logout control while logging out', async () => {
    renderShell({
      usuario: encargado,
      onLogout: vi.fn(),
      isLoggingOut: true,
      children: <p>content</p>,
    });

    expect(
      await screen.findByRole('button', { name: 'Cerrar sesión' }),
    ).toBeDisabled();
  });

  it('renders the Usuarios nav item as a link to /usuarios for an encargado session', async () => {
    renderShell({
      usuario: encargado,
      onLogout: vi.fn(),
      isLoggingOut: false,
      children: <p>content</p>,
    });

    expect(
      await screen.findByRole('link', { name: 'Usuarios' }),
    ).toHaveAttribute('href', '/usuarios');
  });

  it('renders the Usuarios nav item locked, with a visible reason, for a deposito session', async () => {
    renderShell({
      usuario: deposito,
      onLogout: vi.fn(),
      isLoggingOut: false,
      children: <p>content</p>,
    });

    // Two encargado-only entries lock for a deposito session as of backlog
    // #12 (Usuarios, Discrepancias globales) — `findAllByText` since both
    // render the same 🔒 marker.
    expect((await screen.findAllByText('🔒')).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.queryByRole('link', { name: /Usuarios/ }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['encargado', encargado],
    ['deposito', deposito],
  ])(
    'renders the Inventario nav item as a link to /inventario for a %s session — both roles read inventory',
    async (_label, usuario) => {
      renderShell({
        usuario,
        onLogout: vi.fn(),
        isLoggingOut: false,
        children: <p>content</p>,
      });

      expect(
        await screen.findByRole('link', { name: 'Inventario' }),
      ).toHaveAttribute('href', '/inventario');
    },
  );

  it.each([
    ['encargado', encargado],
    ['deposito', deposito],
  ])(
    'renders the Punto de venta nav item as a link to /pos for a %s session — both roles reach POST /api/ventas',
    async (_label, usuario) => {
      renderShell({
        usuario,
        onLogout: vi.fn(),
        isLoggingOut: false,
        children: <p>content</p>,
      });

      expect(
        await screen.findByRole('link', { name: 'Punto de venta' }),
      ).toHaveAttribute('href', '/pos');
    },
  );

  it.each([
    ['encargado', encargado],
    ['deposito', deposito],
  ])(
    'renders the Alertas nav item as a link to /alertas for a %s session — both roles read alerts',
    async (_label, usuario) => {
      renderShell({
        usuario,
        onLogout: vi.fn(),
        isLoggingOut: false,
        children: <p>content</p>,
      });

      expect(
        await screen.findByRole('link', { name: /Alertas/ }),
      ).toHaveAttribute('href', '/alertas');
    },
  );

  it('shows the open-alerts count as a badge next to the Alertas nav item', async () => {
    renderShell({
      usuario: encargado,
      onLogout: vi.fn(),
      isLoggingOut: false,
      alertasAbiertas: 4,
      children: <p>content</p>,
    });

    const link = await screen.findByRole('link', { name: /Alertas/ });
    expect(link).toHaveTextContent('4');
  });

  it('shows no badge when alertasAbiertas is zero (no open alerts to flag)', async () => {
    renderShell({
      usuario: encargado,
      onLogout: vi.fn(),
      isLoggingOut: false,
      alertasAbiertas: 0,
      children: <p>content</p>,
    });

    const link = await screen.findByRole('link', { name: /Alertas/ });
    expect(link).not.toHaveTextContent('0');
  });

  it('shows no badge when alertasAbiertas is not provided (still loading)', async () => {
    renderShell({
      usuario: encargado,
      onLogout: vi.fn(),
      isLoggingOut: false,
      children: <p>content</p>,
    });

    const link = await screen.findByRole('link', { name: 'Alertas' });
    expect(link).toBeInTheDocument();
  });

  it('gives the logout control a class the print stylesheet can target', async () => {
    renderShell({
      usuario: encargado,
      onLogout: vi.fn(),
      isLoggingOut: false,
      children: <p>content</p>,
    });

    const logout = await screen.findByRole('button', { name: 'Cerrar sesión' });
    expect(logout.className).not.toBe('');
  });
});

/**
 * recibo-ui / Printable Receipt Route (D6): jsdom never applies a CSS
 * Module's stylesheet (see `styles/tokens.test.ts`'s house rule), so this
 * pins the source directly — the sidebar and the logout control must be
 * print-hidden while `<main>`'s own content is untouched by the rule.
 */
describe('AppShell.module.css print chrome suppression (D6)', () => {
  const css = readFileSync(
    resolve(cwd(), 'src/components/ui/AppShell.module.css'),
    'utf8',
  );

  it('hides the sidebar when printing', () => {
    expect(css).toMatch(
      /@media print[\s\S]*\.sidebar[\s\S]*\{[\s\S]*display:\s*none/,
    );
  });

  it('hides the logout button when printing', () => {
    expect(css).toMatch(
      /@media print[\s\S]*\.logoutButton[\s\S]*\{[\s\S]*display:\s*none/,
    );
  });

  it('does not hide .main inside the print media query', () => {
    const printBlockMatch = css.match(/@media print\s*\{([\s\S]*)\n\}/);
    expect(printBlockMatch).not.toBeNull();
    expect(printBlockMatch?.[1]).not.toMatch(/\.main\b/);
  });
});

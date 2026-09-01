import type { ReactNode } from 'react';
import type { Usuario } from '../../api/session.js';
import styles from './AppShell.module.css';
import { NavItem } from './NavItem.js';

/**
 * Sidebar nav entries, labels verbatim from docs/design.md's "Sidebar"
 * table. "Usuarios", "Inventario" and, from here on, "Punto de venta" have
 * a shipped destination — `to="/inventario"` etc. would be a type error
 * against the registered router until those screens exist, so the
 * remaining four stay destination-less and render as inert markers through
 * the same `NavItem` component/class, never a bare `<span>` (app-layout
 * spec, "Sidebar Items Render As Navigation Links").
 */
const NAV_ITEMS: { label: string; to?: string }[] = [
  { label: 'Panel general' },
  { label: 'Inventario', to: '/inventario' },
  { label: 'Punto de venta', to: '/pos' },
  { label: 'Movimientos' },
  { label: 'Proveedores' },
  { label: 'Reportes' },
  { label: 'Usuarios', to: '/usuarios' },
];

/**
 * A `deposito` session cannot use any Usuarios route (the encargado-only
 * guard, D4). Per docs/design.md's "Permisos visibles" principle (D3), that
 * restriction is marked with 🔒 and a reason — never hidden without
 * explanation. Inventario carries no such restriction: both roles read
 * (and mostly write) products, so it is never `locked` regardless of role
 * (productos-ledger-base D9).
 */
const LOCKED_REASON = 'Disponible solo para encargados.';

const ROL_LABEL: Record<'encargado' | 'deposito', string> = {
  encargado: 'Encargado · Admin',
  deposito: 'Depósito · Depósito',
};

export interface AppShellProps {
  usuario: Usuario;
  onLogout: () => void;
  isLoggingOut: boolean;
  children: ReactNode;
}

/**
 * Presentational sidebar + content chrome, extracted verbatim from the
 * former `ShellPlaceholder` inline markup (app-layout spec, D1). Mounted
 * once by `shellLayout`'s container around `<Outlet/>`, so every screen —
 * starting with Usuarios — shares one persistent instance instead of each
 * rendering its own copy of the sidebar, user card, and logout control.
 */
export function AppShell({
  usuario,
  onLogout,
  isLoggingOut,
  children,
}: AppShellProps) {
  const initials = usuario.nombre
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brandMark} aria-hidden="true">
          it
        </div>
        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => (
            <NavItem
              key={item.label}
              label={item.label}
              to={item.to}
              locked={item.label === 'Usuarios' && usuario.rol !== 'encargado'}
              reason={LOCKED_REASON}
            />
          ))}
        </nav>
        <div className={styles.userCard}>
          <span className={styles.avatar} aria-hidden="true">
            {initials}
          </span>
          <div>
            <div className={styles.userName}>{usuario.nombre}</div>
            <div className={styles.userRole}>{ROL_LABEL[usuario.rol]}</div>
          </div>
        </div>
      </aside>
      <main className={styles.main}>
        {children}
        <button
          type="button"
          className={styles.logoutButton}
          onClick={onLogout}
          disabled={isLoggingOut}
        >
          Cerrar sesión
        </button>
      </main>
    </div>
  );
}

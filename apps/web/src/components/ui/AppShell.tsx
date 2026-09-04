import type { ReactNode } from 'react';
import type { Usuario } from '../../api/session.js';
import styles from './AppShell.module.css';
import { NavItem } from './NavItem.js';

/**
 * Sidebar nav entries, labels verbatim from docs/design.md's "Sidebar"
 * table. "Usuarios", "Inventario" and, from here on, "Punto de venta" have
 * a shipped destination — `to="/inventario"` etc. would be a type error
 * against the registered router until those screens exist, so the
 * remaining destination-less entries render as inert markers through
 * the same `NavItem` component/class, never a bare `<span>` (app-layout
 * spec, "Sidebar Items Render As Navigation Links"). "Alertas" (Motor de
 * Alertas, backlog #10) has no destination-less slot to reuse — it is a
 * new entry, not a placeholder promoted to a link.
 *
 * "Panel general" (backlog #13, `dashboard-ui`) now wires `to: '/'` — the
 * dashboard reuses the already-registered index route. Unlike the
 * encargado-only entries below, it is never `locked`: `dashboard-ui`'s
 * ratified scoping is unfiltered for both roles.
 *
 * The former single "Reportes" placeholder (no destination) is replaced
 * here by its four shipped screens (backlog #12) — one flat nav entry per
 * screen, matching this file's existing convention (no submenu support in
 * `NavItem`, same shape "Alertas" used when it shipped).
 */
const NAV_ITEMS: { label: string; to?: string }[] = [
  { label: 'Panel general', to: '/' },
  { label: 'Inventario', to: '/inventario' },
  { label: 'Punto de venta', to: '/pos' },
  { label: 'Alertas', to: '/alertas' },
  { label: 'Movimientos' },
  { label: 'Proveedores', to: '/proveedores' },
  { label: 'Stock actual', to: '/reportes/stock-actual' },
  { label: 'Bajo mínimo', to: '/reportes/bajo-minimo' },
  { label: 'Movimientos por período', to: '/reportes/movimientos' },
  { label: 'Discrepancias globales', to: '/reportes/discrepancias' },
  { label: 'Usuarios', to: '/usuarios' },
];

/**
 * A `deposito` session cannot use any Usuarios route (the encargado-only
 * guard, D4), nor the discrepancias globales report (backlog #12's
 * `encargadoLayout` route, spec's "Discrepancias Globales Report" — server
 * returns `403` regardless of this marker). Per docs/design.md's "Permisos
 * visibles" principle (D3), that restriction is marked with 🔒 and a
 * reason — never hidden without explanation. Inventario carries no such
 * restriction: both roles read (and mostly write) products, so it is never
 * `locked` regardless of role (productos-ledger-base D9). The other three
 * reports (stock actual, bajo mínimo, movimientos por período) are also
 * never locked — both roles can read them (D5).
 */
const LOCKED_REASON = 'Disponible solo para encargados.';
const ENCARGADO_ONLY_LABELS = new Set(['Usuarios', 'Discrepancias globales']);

const ROL_LABEL: Record<'encargado' | 'deposito', string> = {
  encargado: 'Encargado · Admin',
  deposito: 'Depósito · Depósito',
};

export interface AppShellProps {
  usuario: Usuario;
  onLogout: () => void;
  isLoggingOut: boolean;
  children: ReactNode;
  /**
   * Motor de Alertas (backlog #10, PD-4): open-alert count for the Alertas
   * nav item's badge. `AppShell` stays presentational (props only) — the
   * data hook (`useConteoAlertas`) lives in `shellLayout`'s container, per
   * design.md's Frontend note.
   */
  alertasAbiertas?: number;
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
  alertasAbiertas,
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
              locked={
                ENCARGADO_ONLY_LABELS.has(item.label) &&
                usuario.rol !== 'encargado'
              }
              reason={LOCKED_REASON}
              badge={item.label === 'Alertas' ? alertasAbiertas : undefined}
            />
          ))}
        </nav>
        <div className={styles.userCard}>
          <div className={styles.userIdentity}>
            <span className={styles.avatar} aria-hidden="true">
              {initials}
            </span>
            <div>
              <div className={styles.userName}>{usuario.nombre}</div>
              <div className={styles.userRole}>{ROL_LABEL[usuario.rol]}</div>
            </div>
          </div>
          <button
            type="button"
            className={styles.logoutButton}
            onClick={onLogout}
            disabled={isLoggingOut}
          >
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}

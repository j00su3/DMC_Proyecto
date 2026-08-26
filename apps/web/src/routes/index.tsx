import { createRoute } from '@tanstack/react-router';
import { useLogout } from '../features/auth/useLogout.js';
import styles from './index.module.css';
import { shellLayout } from './shellLayout.js';

/** Sidebar nav labels, verbatim from docs/design.md's "Sidebar" table. */
const NAV_ITEMS = [
  'Panel general',
  'Inventario',
  'Punto de venta',
  'Movimientos',
  'Proveedores',
  'Reportes',
  'Usuarios',
];

const ROL_LABEL: Record<'encargado' | 'deposito', string> = {
  encargado: 'Encargado · Admin',
  deposito: 'Depósito · Depósito',
};

export const indexRoute = createRoute({
  getParentRoute: () => shellLayout,
  path: '/',
  component: ShellPlaceholder,
});

function ShellPlaceholder() {
  const usuario = indexRoute.useRouteContext().usuario;
  const logout = useLogout();

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
            <span key={item} className={styles.navItem}>
              {item}
            </span>
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
        <h1>Panel general</h1>
        <p>Placeholder shell — Phase 5A (S5a). Screens ship in later seams.</p>
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
        >
          Cerrar sesión
        </button>
      </main>
    </div>
  );
}

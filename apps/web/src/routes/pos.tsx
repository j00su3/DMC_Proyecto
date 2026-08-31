import { createRoute } from '@tanstack/react-router';
import { CarritoPanel } from '../features/pos/CarritoPanel.js';
import { CatalogoGrid } from '../features/pos/CatalogoGrid.js';
import { PagoPanel } from '../features/pos/PagoPanel.js';
import { useCarrito } from '../features/pos/useCarrito.js';
import styles from './pos.module.css';
import { shellLayout } from './shellLayout.js';

/**
 * pos-ui / Role Gate — POS Screen Reachable By Both Roles (spec.md L21-29).
 * Mounted directly under `shellLayout`, NOT `encargadoLayout` — `encargado`
 * and `deposito` both reach `POST /api/ventas` server-side (D-role gate on
 * `routes/ventas.ts`), so this route mirrors that boundary exactly
 * (CLAUDE.md: "Route guards are for encargado-only subtrees").
 *
 * Two-pane grid (design.md D-layout, `docs/design.md:93`): `1.2fr | 460px`.
 * The cart+payment column is fixed on the right so both panes stay visible
 * together while the cashier browses the catalog (spec.md's Fixed Two-Pane
 * Layout requirement).
 */
export const posRoute = createRoute({
  getParentRoute: () => shellLayout,
  path: '/pos',
  component: PosScreen,
});

function PosScreen() {
  const usuario = posRoute.useRouteContext().usuario;
  const carrito = useCarrito(usuario.id);

  return (
    <div className={styles.screen}>
      <CatalogoGrid
        bloqueoStock={carrito.bloqueoStock}
        onAgregar={carrito.agregar}
      />
      <div className={styles.derecha}>
        <CarritoPanel
          items={carrito.items}
          onActualizarCantidad={carrito.actualizarCantidad}
          onQuitar={carrito.quitar}
          onVaciar={carrito.vaciar}
        />
        <PagoPanel items={carrito.items} vaciarCarrito={carrito.vaciar} />
      </div>
    </div>
  );
}

import { Button } from '../../components/ui/Button.js';
import { aMonto, multiplicar, sumar } from '../../lib/dinero.js';
import styles from './CarritoPanel.module.css';
import type { CarritoLinea } from './carrito.js';

export interface CarritoPanelProps {
  items: CarritoLinea[];
  onActualizarCantidad: (productoId: string, cantidad: number) => void;
  onQuitar: (productoId: string) => void;
  onVaciar: () => void;
}

function subtotalDeLinea(linea: CarritoLinea): string {
  return aMonto(multiplicar(linea.precioSnapshot, linea.cantidad));
}

/**
 * Same-cents total the payment step (`PagoPanel.tsx`) reuses from the
 * identical `items` prop, so both panes always show the exact figure the
 * server will compute with the same `dinero` module (design.md D15).
 */
export function totalCarrito(items: CarritoLinea[]): string {
  return aMonto(
    sumar(
      items.map((linea) => multiplicar(linea.precioSnapshot, linea.cantidad)),
    ),
  );
}

/**
 * Fixed cart pane (design.md's `460px` grid column). Quantity is editable
 * inline; the reducer (`carrito.ts`'s `ACTUALIZAR_CANTIDAD`) is the only
 * place that decides whether an edit is accepted — this component only
 * forwards the raw input value, it never itself refuses a quantity.
 * PD-9's explicit "empty cart" action lives here, separate from the
 * confirm-sale success path that also clears the cart (`useConfirmarVenta`).
 */
export function CarritoPanel({
  items,
  onActualizarCantidad,
  onQuitar,
  onVaciar,
}: CarritoPanelProps) {
  const total = totalCarrito(items);

  return (
    <section className={styles.panel} aria-label="Carrito">
      <div className={styles.header}>
        <h2 className={styles.title}>Carrito</h2>
        <Button
          type="button"
          variant="secondary"
          onClick={onVaciar}
          disabled={items.length === 0}
        >
          Vaciar carrito
        </Button>
      </div>

      {items.length === 0 ? (
        <p className={styles.vacio}>El carrito está vacío</p>
      ) : (
        <ul className={styles.lineas}>
          {items.map((linea) => (
            <li key={linea.productoId} className={styles.linea}>
              <div className={styles.lineaInfo}>
                <p className={styles.lineaNombre}>{linea.nombre}</p>
                <p className={styles.lineaSubtotal}>
                  ${subtotalDeLinea(linea)}
                </p>
              </div>
              <div className={styles.lineaControles}>
                <label
                  className={styles.srOnly}
                  htmlFor={`cantidad-${linea.productoId}`}
                >
                  Cantidad de {linea.nombre}
                </label>
                <input
                  id={`cantidad-${linea.productoId}`}
                  type="number"
                  min={1}
                  className={styles.cantidadInput}
                  value={linea.cantidad}
                  onChange={(event) => {
                    const cantidad = Number(event.target.value);
                    if (Number.isInteger(cantidad) && cantidad >= 1) {
                      onActualizarCantidad(linea.productoId, cantidad);
                    }
                  }}
                />
                <button
                  type="button"
                  className={styles.quitarButton}
                  onClick={() => onQuitar(linea.productoId)}
                  aria-label={`Quitar ${linea.nombre}`}
                >
                  <span aria-hidden="true">✕</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.totalRow}>
        <span>Total</span>
        <span className={styles.totalMonto}>${total}</span>
      </div>
    </section>
  );
}

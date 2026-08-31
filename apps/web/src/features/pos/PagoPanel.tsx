import { useState } from 'react';
import { isApiError } from '../../api/errors.js';
import { Button } from '../../components/ui/Button.js';
import { FormError } from '../../components/ui/FormError.js';
import { aCentavos, aMonto, sumar } from '../../lib/dinero.js';
import { totalCarrito } from './CarritoPanel.js';
import styles from './PagoPanel.module.css';
import type { CarritoLinea } from './carrito.js';
import { posErrorMessage } from './errorMessages.js';
import type { MedioPago } from './schemas.js';
import { useConfirmarVenta } from './useConfirmarVenta.js';

const MEDIOS: { value: MedioPago; label: string }[] = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'qr', label: 'QR' },
];

interface PagoEntrada {
  medio: MedioPago;
  monto: string;
}

interface PriceChangedLinea {
  productoId: string;
  precioEsperado: string;
  precioActual: string;
}

/** Narrows `ApiError.details` for `PRICE_CHANGED` (D5/D6): `{ items: [{
 * productoId, precioEsperado, precioActual }] }`. Returns `undefined` on
 * any unexpected shape so a malformed payload degrades to the generic
 * banner (`posErrorMessage`) instead of crashing the payment step. */
function narrowPriceChangedItems(
  details: unknown,
): PriceChangedLinea[] | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const { items } = details as { items?: unknown };
  if (!Array.isArray(items)) return undefined;

  const narrowed = items.filter((item): item is PriceChangedLinea => {
    if (typeof item !== 'object' || item === null) return false;
    const { productoId, precioEsperado, precioActual } = item as Record<
      string,
      unknown
    >;
    return (
      typeof productoId === 'string' &&
      typeof precioEsperado === 'string' &&
      typeof precioActual === 'string'
    );
  });

  return narrowed.length > 0 ? narrowed : undefined;
}

export interface PagoPanelProps {
  items: CarritoLinea[];
  /** Injected by the caller (PR9's `pos.tsx`, per `useConfirmarVenta.ts`'s
   * docblock) — this component does not own cart state and never imports
   * `useCarrito` directly. */
  vaciarCarrito: () => void;
}

/**
 * Payment step: multi-payment entry (PD-1/PD-7 — at most one entry per
 * medio, a repeated medio is combined rather than appended), a
 * client-computed `vuelto` shown on the cash entry only (PD-2, using the
 * same `dinero` module the server uses so the figure always matches to the
 * cent), and the PD-6 mandatory re-confirmation flow on `PRICE_CHANGED`.
 *
 * `PRICE_CHANGED` never triggers an automatic retry: `reconfirmar` is the
 * ONLY path that resubmits after that error, and it exists solely as an
 * explicit control the cashier must click.
 */
export function PagoPanel({ items, vaciarCarrito }: PagoPanelProps) {
  const [medioSeleccionado, setMedioSeleccionado] =
    useState<MedioPago>('efectivo');
  const [montoInput, setMontoInput] = useState('');
  const [pagos, setPagos] = useState<PagoEntrada[]>([]);
  // D5: what the cashier last confirmed seeing, keyed by productoId. Empty
  // until PD-6's explicit re-confirmation adopts a server-reported
  // `precioActual` — the cart's own `precioSnapshot` is authoritative until
  // then.
  const [precioOverrides, setPrecioOverrides] = useState<
    Record<string, string>
  >({});

  const mutation = useConfirmarVenta(vaciarCarrito);

  const total = totalCarrito(items);
  const totalCentavos = aCentavos(total);

  const pagadoCentavos =
    pagos.length > 0 ? sumar(pagos.map((pago) => aCentavos(pago.monto))) : 0;
  const hayEfectivo = pagos.some((pago) => pago.medio === 'efectivo');
  const vuelto =
    hayEfectivo && pagadoCentavos > totalCentavos
      ? aMonto(pagadoCentavos - totalCentavos)
      : null;

  const error = mutation.error;
  const priceChangedItems =
    isApiError(error) && error.code === 'PRICE_CHANGED'
      ? narrowPriceChangedItems(error.details)
      : undefined;
  const bannerMessage =
    isApiError(error) && !priceChangedItems ? posErrorMessage(error) : null;

  function agregarPago() {
    if (montoInput.trim() === '') return;

    let montoCentavos: number;
    try {
      montoCentavos = aCentavos(montoInput);
    } catch {
      return;
    }
    if (montoCentavos <= 0) return;

    setPagos((prev) => {
      const existente = prev.find((pago) => pago.medio === medioSeleccionado);
      if (!existente) {
        return [...prev, { medio: medioSeleccionado, monto: montoInput }];
      }
      // PD-7: a second entry for an already-present medio is combined into
      // the existing one, never appended as a distinct entry.
      const combinado = aMonto(
        sumar([aCentavos(existente.monto), montoCentavos]),
      );
      return prev.map((pago) =>
        pago.medio === medioSeleccionado ? { ...pago, monto: combinado } : pago,
      );
    });
    setMontoInput('');
  }

  function quitarPago(medio: MedioPago) {
    setPagos((prev) => prev.filter((pago) => pago.medio !== medio));
  }

  function buildInput(overrides: Record<string, string>) {
    return {
      items: items.map((linea) => ({
        productoId: linea.productoId,
        cantidad: linea.cantidad,
        precioUnitarioEsperado:
          overrides[linea.productoId] ?? linea.precioSnapshot,
      })),
      pagos: pagos.map((pago) => ({ medio: pago.medio, monto: pago.monto })),
    };
  }

  function confirmar() {
    mutation.mutate(buildInput(precioOverrides));
  }

  function reconfirmar() {
    if (!priceChangedItems) return;
    const nextOverrides = { ...precioOverrides };
    for (const mismatch of priceChangedItems) {
      nextOverrides[mismatch.productoId] = mismatch.precioActual;
    }
    setPrecioOverrides(nextOverrides);
    mutation.mutate(buildInput(nextOverrides));
  }

  const puedeConfirmar =
    items.length > 0 && pagos.length > 0 && !priceChangedItems;

  return (
    <section className={styles.panel} aria-label="Pago">
      <h2 className={styles.title}>Pago</h2>

      <div
        className={styles.selector}
        role="radiogroup"
        aria-label="Medio de pago"
      >
        {MEDIOS.map((medio) => (
          <label key={medio.value} className={styles.medioOption}>
            <input
              type="radio"
              name="medio-pago"
              value={medio.value}
              checked={medioSeleccionado === medio.value}
              onChange={() => setMedioSeleccionado(medio.value)}
            />
            {medio.label}
          </label>
        ))}
      </div>

      <div className={styles.montoRow}>
        <label className={styles.srOnly} htmlFor="pago-monto">
          Monto
        </label>
        <input
          id="pago-monto"
          className={styles.montoInput}
          inputMode="decimal"
          placeholder="0.00"
          value={montoInput}
          onChange={(event) => setMontoInput(event.target.value)}
        />
        <Button type="button" variant="secondary" onClick={agregarPago}>
          Agregar pago
        </Button>
      </div>

      {pagos.length > 0 && (
        <ul className={styles.pagosLista}>
          {pagos.map((pago) => (
            <li key={pago.medio} className={styles.pagoLinea}>
              <span className={styles.pagoMedio}>
                {MEDIOS.find((medio) => medio.value === pago.medio)?.label ??
                  pago.medio}
              </span>
              <span className={styles.pagoMonto}>${pago.monto}</span>
              {pago.medio === 'efectivo' && vuelto !== null && (
                <span className={styles.vuelto}>Vuelto ${vuelto}</span>
              )}
              <button
                type="button"
                className={styles.quitarPagoButton}
                onClick={() => quitarPago(pago.medio)}
                aria-label={`Quitar pago con ${pago.medio}`}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.totalRow}>
        <span>Total a pagar</span>
        <span className={styles.totalMonto}>${total}</span>
      </div>

      {priceChangedItems && (
        <div className={styles.mismatchNotice} role="alert">
          <p className={styles.mismatchTitle}>
            Uno o más precios cambiaron. Revise antes de confirmar:
          </p>
          <ul className={styles.mismatchLista}>
            {priceChangedItems.map((mismatch) => {
              const linea = items.find(
                (item) => item.productoId === mismatch.productoId,
              );
              return (
                <li key={mismatch.productoId}>
                  {linea?.nombre ?? mismatch.productoId}: $
                  {mismatch.precioEsperado} → ${mismatch.precioActual}
                </li>
              );
            })}
          </ul>
          <Button
            type="button"
            variant="primary"
            onClick={reconfirmar}
            isPending={mutation.isPending}
          >
            Confirmar con los nuevos precios
          </Button>
        </div>
      )}

      {bannerMessage && <FormError message={bannerMessage} />}

      <Button
        type="button"
        variant="primary"
        onClick={confirmar}
        disabled={!puedeConfirmar}
        isPending={mutation.isPending}
      >
        Confirmar venta
      </Button>
    </section>
  );
}

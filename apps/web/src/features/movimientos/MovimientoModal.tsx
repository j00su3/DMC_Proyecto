import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { paths } from '../../api/schema.js';
import { Button } from '../../components/ui/Button.js';
import { FormError } from '../../components/ui/FormError.js';
import { Modal } from '../../components/ui/Modal.js';
import styles from './MovimientoModal.module.css';
import { type MovimientoFormValues, movimientoFormSchema } from './schemas.js';

type EntradaBody =
  paths['/api/productos/{id}/movimientos/entrada']['post']['requestBody']['content']['application/json'];
type SalidaBody =
  paths['/api/productos/{id}/movimientos/salida']['post']['requestBody']['content']['application/json'];
type AjusteBody =
  paths['/api/productos/{id}/movimientos/ajuste']['post']['requestBody']['content']['application/json'];

/** Discriminates which of `useRegistrarMovimiento`'s three wrappers the
 * caller (S8's route component) must invoke. */
export type MovimientoWireSubmission =
  | { operacion: 'entrada'; body: EntradaBody }
  | { operacion: 'salida'; body: SalidaBody }
  | { operacion: 'ajuste'; body: AjusteBody };

export interface MovimientoModalProps {
  /** Gates the "Ajuste" step-1 card (D9) — UX convenience only, see the
   * component docblock below. */
  actorRol: 'encargado' | 'deposito';
  onClose: () => void;
  onSubmit: (submission: MovimientoWireSubmission) => void;
  isPending?: boolean;
  /** Drives step 2's `Stock disponible`/`Stock resultante` preview (D9).
   * Optional so S7a's existing call sites keep compiling; S8's route wires
   * the real `producto.stockActual`. The preview is an affordance only —
   * the server's `INSUFFICIENT_STOCK` response is authoritative. */
  stockActual?: number;
  /** An already-mapped server error message (owned by the caller — see
   * `tasks.md`'s S7b ownership note). Rendered without closing the modal;
   * this component never calls `useRegistrarMovimiento` or maps error
   * codes itself, matching `ProductoForm.tsx`'s route-module boundary. */
  serverError?: string;
}

type Step = 1 | 2 | 3;

const STEP_LABELS: Record<Step, string> = {
  1: '1 · TIPO DE MOVIMIENTO',
  2: '2 · CANTIDAD',
  3: '3 · MOTIVO',
};

const AUDIT_NOTE =
  'Este movimiento queda registrado con su usuario y la fecha. No puede editarse ni eliminarse.';

const ELECCION_OPTIONS: Array<{
  value: MovimientoFormValues['eleccion'];
  label: string;
}> = [
  { value: 'entrada', label: 'Entrada' },
  { value: 'salida', label: 'Salida' },
  { value: 'merma', label: 'Salida por merma' },
  { value: 'ajuste', label: 'Ajuste' },
];

/**
 * Maps the four operator-facing `eleccion` choices onto the three wire
 * `tipo` values D7 defines: "Salida por merma" becomes the `salida`
 * operacion with `esMerma: true`; "Ajuste" carries no merma indicator at
 * all (the ajuste body has no `esMerma` field). Pure and exported so the
 * mapping is directly testable independent of the step UI — satisfies
 * movimientos-ui spec's "Step 1 Offers Four Operator-Facing Choices Mapped
 * To Three Wire Types" requirement.
 */
export function toWireSubmission(
  values: MovimientoFormValues,
): MovimientoWireSubmission {
  const cantidad = Number(values.cantidad);
  const motivo = values.motivo.length > 0 ? values.motivo : undefined;

  if (values.eleccion === 'entrada') {
    return { operacion: 'entrada', body: { cantidad, motivo } };
  }

  if (values.eleccion === 'salida' || values.eleccion === 'merma') {
    return {
      operacion: 'salida',
      body: { cantidad, esMerma: values.eleccion === 'merma', motivo },
    };
  }

  return {
    operacion: 'ajuste',
    body: {
      cantidad,
      direccion: values.direccion,
      esDiscrepancia: values.esDiscrepancia,
      motivo,
    },
  };
}

/**
 * D9 step 2's live "Stock resultante: N" preview, and D9 step 3's summary
 * line — both derive stock from the same delta rule D7 gives the service:
 * `entrada` adds, `salida`/`merma` subtract, `ajuste` follows `direccion`.
 * Pure and exported so the arithmetic is directly testable independent of
 * the step UI. An affordance only — the server's committed
 * `stockResultante` (from `aplicarDelta`) is authoritative, never this
 * client-side estimate.
 */
export function computeStockResultante(
  stockActual: number,
  eleccion: MovimientoFormValues['eleccion'] | undefined,
  cantidadRaw: string,
  direccion: MovimientoFormValues['direccion'],
): number {
  const parsed = Number(cantidadRaw);
  const magnitude = Number.isFinite(parsed) ? parsed : 0;

  if (eleccion === 'entrada') {
    return stockActual + magnitude;
  }
  if (eleccion === 'salida' || eleccion === 'merma') {
    return stockActual - magnitude;
  }
  if (eleccion === 'ajuste') {
    return direccion === 'restar'
      ? stockActual - magnitude
      : stockActual + magnitude;
  }
  return stockActual;
}

/** D9 step 3's read-only summary line, e.g. "Salida por merma · 3 unidades
 * · stock resultante 9". */
export function buildSummaryLine(
  eleccion: MovimientoFormValues['eleccion'],
  cantidadRaw: string,
  stockResultante: number,
): string {
  const label =
    ELECCION_OPTIONS.find((option) => option.value === eleccion)?.label ??
    eleccion;
  const cantidad = Number(cantidadRaw) || 0;
  return `${label} · ${cantidad} unidades · stock resultante ${stockResultante}`;
}

/** D8's client-side echo, restated for the step-3 label: `motivo` reads as
 * required only for `ajuste` and merma `salida`s. */
function requiresMotivo(eleccion: MovimientoFormValues['eleccion']): boolean {
  return eleccion === 'ajuste' || eleccion === 'merma';
}

/**
 * The 3-step movement-registration modal (D9), built on
 * `components/ui/Modal` with `closePolicy="casual"` — nothing here is a
 * one-time secret, so Escape and overlay dismissal stay enabled. One
 * `useForm` drives the whole modal (not one per step), with
 * `zodResolver(movimientoFormSchema)`, matching `ProductoForm.tsx`'s
 * precedent.
 *
 * **Steps 2-3 (S7b)** implement D9's full per-choice variant UI: a quantity
 * label/hint that varies by `eleccion`, the ajuste-only `Sumar/Restar`
 * segmented control and discrepancy checkbox, a live "Stock resultante"
 * preview, a conditionally-labelled motivo textarea, and a read-only
 * summary line. `serverError` is rendered without closing the modal — this
 * component never maps error codes or calls the mutation hook itself, per
 * the S7b ownership note in `tasks.md` (the `ProductoForm.tsx` precedent).
 *
 * Hiding/disabling the "Ajuste" card for a `deposito` actor is UX
 * convenience only, NOT the enforcement mechanism —
 * `apps/api/src/routes/movimientos.ts`'s `config: { roles: ['encargado'] }`
 * on the ajuste route is the actual boundary and returns `403 FORBIDDEN`
 * regardless of what this component shows or hides. A disabled card on the
 * client MUST NOT be documented, treated, or relied upon as access control
 * — see movimientos-ui/spec.md's "Ajuste Option Hidden For Deposito Is UX
 * Convenience, Not Access Control" requirement, and the same disclaimer in
 * `encargadoLayout.tsx`.
 */
export function MovimientoModal({
  actorRol,
  onClose,
  onSubmit,
  isPending = false,
  stockActual = 0,
  serverError,
}: MovimientoModalProps) {
  const [step, setStep] = useState<Step>(1);
  const isDeposito = actorRol === 'deposito';

  const {
    register,
    handleSubmit,
    trigger,
    watch,
    formState: { errors },
  } = useForm<MovimientoFormValues>({
    resolver: zodResolver(movimientoFormSchema),
    defaultValues: {
      cantidad: '',
      direccion: 'sumar',
      esDiscrepancia: false,
      motivo: '',
    },
  });

  const eleccion = watch('eleccion');
  const cantidad = watch('cantidad');
  const direccion = watch('direccion');
  const motivoRequired = eleccion ? requiresMotivo(eleccion) : false;
  const stockResultante = computeStockResultante(
    stockActual,
    eleccion,
    cantidad,
    direccion,
  );
  const summaryLine = eleccion
    ? buildSummaryLine(eleccion, cantidad, stockResultante)
    : '';

  async function goToStep3() {
    const valid = await trigger(['cantidad']);
    if (valid) {
      setStep(3);
    }
  }

  const submit = handleSubmit((values) => {
    onSubmit(toWireSubmission(values));
  });

  return (
    <Modal title="Registrar movimiento" closePolicy="casual" onClose={onClose}>
      <button
        type="button"
        className={styles.closeButton}
        onClick={onClose}
        aria-label="Cerrar"
      >
        <span aria-hidden="true">✕</span>
      </button>
      <div className={styles.divider} />
      <p className={styles.stepLabel}>{STEP_LABELS[step]}</p>

      {serverError && <FormError message={serverError} />}

      <form onSubmit={submit} noValidate>
        {step === 1 && (
          <fieldset className={styles.choices}>
            <legend className={styles.srOnly}>Tipo de movimiento</legend>
            {ELECCION_OPTIONS.map((option) => {
              const isAjuste = option.value === 'ajuste';
              const disabled = isAjuste && isDeposito;
              const cardClasses = [
                styles.card,
                disabled ? styles.cardDisabled : '',
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <label key={option.value} className={cardClasses}>
                  <input
                    type="radio"
                    value={option.value}
                    disabled={disabled}
                    {...register('eleccion')}
                  />
                  <span className={styles.cardLabel}>{option.label}</span>
                  {disabled && <span aria-hidden="true">🔒</span>}
                </label>
              );
            })}
          </fieldset>
        )}

        {step === 2 && (
          <div className={styles.stepBody}>
            {eleccion === 'entrada' && (
              <label
                htmlFor="movimiento-cantidad"
                className={styles.fieldLabel}
              >
                Cantidad a ingresar
              </label>
            )}

            {(eleccion === 'salida' || eleccion === 'merma') && (
              <label
                htmlFor="movimiento-cantidad"
                className={styles.fieldLabel}
              >
                Cantidad a retirar
              </label>
            )}

            {eleccion === 'ajuste' && (
              <>
                <div
                  className={styles.segmented}
                  role="radiogroup"
                  aria-label="Dirección del ajuste"
                >
                  <label className={styles.segmentedOption}>
                    <input
                      type="radio"
                      value="sumar"
                      {...register('direccion')}
                    />
                    Sumar
                  </label>
                  <label className={styles.segmentedOption}>
                    <input
                      type="radio"
                      value="restar"
                      {...register('direccion')}
                    />
                    Restar
                  </label>
                </div>
                <label
                  htmlFor="movimiento-cantidad"
                  className={styles.fieldLabel}
                >
                  Unidades
                </label>
              </>
            )}

            <input
              id="movimiento-cantidad"
              inputMode="numeric"
              aria-invalid={errors.cantidad ? true : undefined}
              {...register('cantidad')}
            />
            {errors.cantidad && (
              <span className={styles.error}>{errors.cantidad.message}</span>
            )}

            {(eleccion === 'salida' || eleccion === 'merma') && (
              <p className={styles.hint}>Stock disponible: {stockActual}</p>
            )}

            {eleccion === 'ajuste' && (
              <label className={styles.checkboxLabel}>
                <input type="checkbox" {...register('esDiscrepancia')} />
                Marcar como discrepancia de inventario
              </label>
            )}

            <p className={styles.hint}>Stock resultante: {stockResultante}</p>
          </div>
        )}

        {step === 3 && (
          <div className={styles.stepBody}>
            <label htmlFor="movimiento-motivo" className={styles.fieldLabel}>
              {motivoRequired ? 'Motivo' : 'Motivo (opcional)'}
            </label>
            <textarea
              id="movimiento-motivo"
              aria-invalid={errors.motivo ? true : undefined}
              {...register('motivo')}
            />
            {errors.motivo && (
              <span className={styles.error}>{errors.motivo.message}</span>
            )}
            <p className={styles.summary}>{summaryLine}</p>
          </div>
        )}

        <div className={styles.actions}>
          {step > 1 && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setStep((current) => (current === 3 ? 2 : 1))}
            >
              Atrás
            </Button>
          )}
          {step === 1 && (
            <Button
              type="button"
              variant="primary"
              disabled={!eleccion}
              onClick={() => setStep(2)}
            >
              Continuar
            </Button>
          )}
          {step === 2 && (
            <Button type="button" variant="primary" onClick={goToStep3}>
              Continuar
            </Button>
          )}
          {step === 3 && (
            <Button type="submit" variant="primary" isPending={isPending}>
              Registrar movimiento
            </Button>
          )}
        </div>
      </form>

      <p className={styles.auditNote}>{AUDIT_NOTE}</p>
    </Modal>
  );
}

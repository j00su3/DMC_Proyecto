import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Button } from '../../components/ui/Button.js';
import { FormError } from '../../components/ui/FormError.js';
import { Modal } from '../../components/ui/Modal.js';
import styles from './AnularVentaModal.module.css';
import {
  type AnularVentaFormValues,
  EMPTY_ANULAR_VENTA_FORM,
  anularVentaFormSchema,
} from './schemas.js';

export interface AnularVentaModalProps {
  onClose: () => void;
  onSubmit: (values: AnularVentaFormValues) => void;
  isPending?: boolean;
  /** An already-mapped server error message (owned by the caller, mirroring
   * `MovimientoModal`'s `serverError` ownership note — this component never
   * calls `useAnularVenta` or maps error codes itself). Rendered without
   * closing the modal. */
  serverError?: string;
}

const IRREVERSIBLE_NOTE =
  'Esta acción es irreversible: el stock de cada producto y los pagos registrados se revierten y la venta queda marcada como anulada.';

/**
 * Anulación modal (recibo-ui spec, "Anulación Entry Point On The Venta/
 * Receipt View"). One `useForm` with `mode: 'onChange'` so `formState.isValid`
 * drives the submit button's disabled state live, matching this spec's
 * "Submission without a reason is blocked client-side" scenario —
 * unlike `MovimientoModal`'s multi-step form, this is a single field, so
 * there is no step gating to reuse.
 *
 * No second "¿está seguro?" confirmation step beyond the typed mandatory
 * motivo (design.md's stated working assumption, `MovimientoModal`
 * precedent) — the irreversibility warning below is informational only,
 * not a second gate.
 */
export function AnularVentaModal({
  onClose,
  onSubmit,
  isPending = false,
  serverError,
}: AnularVentaModalProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<AnularVentaFormValues>({
    resolver: zodResolver(anularVentaFormSchema),
    mode: 'onChange',
    defaultValues: EMPTY_ANULAR_VENTA_FORM,
  });

  const submit = handleSubmit((values) => {
    onSubmit(values);
  });

  return (
    <Modal title="Anular venta" closePolicy="casual" onClose={onClose}>
      {serverError && <FormError message={serverError} />}

      <p className={styles.warning}>{IRREVERSIBLE_NOTE}</p>

      <form onSubmit={submit} noValidate>
        <div className={styles.body}>
          <label htmlFor="anular-venta-motivo" className={styles.fieldLabel}>
            Motivo
          </label>
          <textarea
            id="anular-venta-motivo"
            aria-invalid={errors.motivoAnulacion ? true : undefined}
            {...register('motivoAnulacion')}
          />
          {errors.motivoAnulacion && (
            <span className={styles.error}>
              {errors.motivoAnulacion.message}
            </span>
          )}
        </div>

        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!isValid}
            isPending={isPending}
          >
            Anular venta
          </Button>
        </div>
      </form>
    </Modal>
  );
}

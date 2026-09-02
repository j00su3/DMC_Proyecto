import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Button } from '../../components/ui/Button.js';
import { TextField } from '../../components/ui/TextField.js';
import styles from './ProveedorForm.module.css';
import {
  type ActualizarProveedorInput,
  type CrearProveedorInput,
  type ProveedorFormValues,
  proveedorFormSchema,
  toActualizarProveedorInput,
  toCrearProveedorInput,
} from './schemas.js';

/**
 * `onSubmit`'s value type tracks `M`, mirroring `ProductoForm.tsx`'s pattern:
 * `mode="edit"` narrows it to `ActualizarProveedorInput` (dirty-fields-only
 * patch, D18 precedent), the default `'create'` keeps `CrearProveedorInput`.
 */
type ProveedorFormProps<M extends 'create' | 'edit' = 'create'> = {
  proveedor: ProveedorFormValues;
  mode?: M;
  /**
   * D5: proveedores has ZERO deposito write routes
   * (`apps/api/src/routes/proveedores.ts:86-89`), so a deposito session never
   * sees per-field `disabled` inputs like `ProductoForm`'s `stock_minimo` —
   * it gets a `<dl>` display-only rendering instead. No inputs, no submit
   * button, at all.
   */
  readonly?: boolean;
  onSubmit: (
    values: M extends 'edit' ? ActualizarProveedorInput : CrearProveedorInput,
  ) => void;
  isPending?: boolean;
};

/** Read-only rendering for a deposito session (D5) — display-only, no `<input>`. */
function ProveedorDetails({ proveedor }: { proveedor: ProveedorFormValues }) {
  return (
    <dl className={styles.details}>
      <dt>Nombre</dt>
      <dd>{proveedor.nombre}</dd>
      <dt>Contacto</dt>
      <dd>{proveedor.contacto.trim() === '' ? '—' : proveedor.contacto}</dd>
    </dl>
  );
}

/** Presentational (route-module boundary, `ProductoForm.tsx`/`UsuarioForm.tsx` precedent). */
export function ProveedorForm<M extends 'create' | 'edit' = 'create'>({
  proveedor,
  mode,
  readonly,
  onSubmit,
  isPending,
}: ProveedorFormProps<M>) {
  const resolvedMode = mode ?? 'create';
  const {
    register,
    handleSubmit,
    formState: { errors, dirtyFields },
  } = useForm<ProveedorFormValues>({
    resolver: zodResolver(proveedorFormSchema),
    defaultValues: proveedor,
  });

  if (readonly) {
    return <ProveedorDetails proveedor={proveedor} />;
  }

  const submit = handleSubmit((values) => {
    if (resolvedMode === 'edit') {
      (onSubmit as (values: ActualizarProveedorInput) => void)(
        toActualizarProveedorInput(values, dirtyFields),
      );
    } else {
      (onSubmit as (values: CrearProveedorInput) => void)(
        toCrearProveedorInput(values),
      );
    }
  });

  return (
    <form onSubmit={submit} noValidate>
      <div className={styles.fields}>
        <TextField
          id="nombre"
          label="Nombre"
          error={errors.nombre?.message}
          {...register('nombre')}
        />
        <TextField
          id="contacto"
          label="Contacto"
          error={errors.contacto?.message}
          {...register('contacto')}
        />

        <Button type="submit" variant="primary" isPending={isPending}>
          {resolvedMode === 'edit' ? 'Guardar cambios' : 'Crear proveedor'}
        </Button>
      </div>
    </form>
  );
}

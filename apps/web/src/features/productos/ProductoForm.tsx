import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Button } from '../../components/ui/Button.js';
import { TextField } from '../../components/ui/TextField.js';
import styles from './ProductoForm.module.css';
import { ProveedorSelector } from './ProveedorSelector.js';
import {
  type ActualizarProductoInput,
  type CrearProductoInput,
  type ProductoFormValues,
  productoFormSchema,
  toActualizarProductoInput,
  toCrearProductoInput,
} from './schemas.js';

/**
 * `onSubmit`'s value type tracks `M`: `mode="edit"` narrows it to
 * `ActualizarProductoInput` (no `stockInicial`, ever — S7b), the default
 * `'create'` keeps `CrearProductoInput`. Avoids a second component per
 * instruction #3 ("extend, don't duplicate").
 */
type ProductoFormProps<M extends 'create' | 'edit' = 'create'> = {
  producto: ProductoFormValues;
  /** Gates `stock_minimo` (D6) — UX affordance only, server 403 is the boundary. */
  actorRol: 'encargado' | 'deposito';
  /** `'create'` (default): renders initial-stock. `'edit'` (S7b) omits it entirely. */
  mode?: M;
  onSubmit: (
    values: M extends 'edit' ? ActualizarProductoInput : CrearProductoInput,
  ) => void;
  isPending?: boolean;
};
const STOCK_MINIMO_LOCK_REASON =
  'Solo un encargado puede modificar el stock mínimo. El servidor rechaza este campo si lo envía un usuario de depósito.';

/** Presentational (route-module boundary, `UsuarioForm.tsx` precedent). */
export function ProductoForm<M extends 'create' | 'edit' = 'create'>({
  producto,
  actorRol,
  mode,
  onSubmit,
  isPending,
}: ProductoFormProps<M>) {
  const resolvedMode = mode ?? 'create';
  // `formState.errors` is what makes productoFormSchema's messages reachable.
  // Without it the resolver still blocks submit, but silently: the user gets a
  // button that does nothing and no field is marked invalid. `TextField` and
  // `ProveedorSelector` both already wire `error` to aria-invalid and
  // aria-describedby, so passing it is also what makes the form accessible.
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProductoFormValues>({
    resolver: zodResolver(productoFormSchema),
    defaultValues: producto,
  });

  const isDeposito = actorRol === 'deposito';

  const submit = handleSubmit((values) => {
    if (resolvedMode === 'edit') {
      (onSubmit as (values: ActualizarProductoInput) => void)(
        toActualizarProductoInput(values, actorRol),
      );
    } else {
      (onSubmit as (values: CrearProductoInput) => void)(
        toCrearProductoInput(values, actorRol),
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
          id="sku"
          label="SKU"
          error={errors.sku?.message}
          {...register('sku')}
        />
        <TextField
          id="categoria"
          label="Categoría"
          error={errors.categoria?.message}
          {...register('categoria')}
        />
        <TextField
          id="precio"
          label="Precio"
          error={errors.precio?.message}
          {...register('precio')}
        />
        <ProveedorSelector
          id="proveedorId"
          label="Proveedor"
          error={errors.proveedorId?.message}
          {...register('proveedorId')}
        />

        <div>
          <TextField
            id="stockMinimo"
            label="Stock mínimo"
            disabled={isDeposito}
            error={errors.stockMinimo?.message}
            {...register('stockMinimo')}
          />
          {isDeposito && (
            <div className={styles.lockNote}>
              <span aria-hidden="true">🔒</span> {STOCK_MINIMO_LOCK_REASON}
            </div>
          )}
        </div>

        {resolvedMode === 'create' && (
          <TextField
            id="stockInicial"
            label="Stock inicial"
            error={errors.stockInicial?.message}
            {...register('stockInicial')}
          />
        )}

        <Button type="submit" variant="primary" isPending={isPending}>
          {resolvedMode === 'edit' ? 'Guardar cambios' : 'Crear producto'}
        </Button>
      </div>
    </form>
  );
}

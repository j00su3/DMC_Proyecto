import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Button } from '../../components/ui/Button.js';
import { TextField } from '../../components/ui/TextField.js';
import { ProveedorSelector } from './ProveedorSelector.js';
import {
  type CrearProductoInput,
  type ProductoFormValues,
  productoFormSchema,
  toCrearProductoInput,
} from './schemas.js';

type ProductoFormProps = {
  producto: ProductoFormValues;
  /** Gates `stock_minimo` (D6) — UX affordance only, server 403 is the boundary. */
  actorRol: 'encargado' | 'deposito';
  /** `'create'` (default): renders initial-stock. S7b adds `'edit'` instead of duplicating this. */
  mode?: 'create' | 'edit';
  onSubmit: (values: CrearProductoInput) => void;
  isPending?: boolean;
};
const STOCK_MINIMO_LOCK_REASON =
  'Solo un encargado puede modificar el stock mínimo. El servidor rechaza este campo si lo envía un usuario de depósito.';

/** Presentational (route-module boundary, `UsuarioForm.tsx` precedent). */
export function ProductoForm({
  producto,
  actorRol,
  mode = 'create',
  onSubmit,
  isPending,
}: ProductoFormProps) {
  const { register, handleSubmit } = useForm<ProductoFormValues>({
    resolver: zodResolver(productoFormSchema),
    defaultValues: producto,
  });

  const isDeposito = actorRol === 'deposito';

  const submit = handleSubmit((values) => {
    onSubmit(toCrearProductoInput(values, actorRol));
  });

  return (
    <form onSubmit={submit} noValidate>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <TextField id="nombre" label="Nombre" {...register('nombre')} />
        <TextField id="sku" label="SKU" {...register('sku')} />
        <TextField
          id="categoria"
          label="Categoría"
          {...register('categoria')}
        />
        <TextField id="precio" label="Precio" {...register('precio')} />
        <ProveedorSelector
          id="proveedorId"
          label="Proveedor"
          {...register('proveedorId')}
        />

        <div>
          <TextField
            id="stockMinimo"
            label="Stock mínimo"
            disabled={isDeposito}
            {...register('stockMinimo')}
          />
          {isDeposito && (
            <div style={{ fontSize: 12 }}>
              <span aria-hidden="true">🔒</span> {STOCK_MINIMO_LOCK_REASON}
            </div>
          )}
        </div>

        {mode === 'create' && (
          <TextField
            id="stockInicial"
            label="Stock inicial"
            {...register('stockInicial')}
          />
        )}

        <Button type="submit" variant="primary" isPending={isPending}>
          Crear producto
        </Button>
      </div>
    </form>
  );
}

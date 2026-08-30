import type { SelectHTMLAttributes } from 'react';
import styles from './ProveedorSelector.module.css';
import { useProveedoresActivos } from './useProveedoresActivos.js';

type ProveedorSelectorProps = SelectHTMLAttributes<HTMLSelectElement> & {
  id: string;
  label: string;
  error?: string;
};

/**
 * productos-ui / Create/Edit Form's supplier selector — offers only
 * suppliers with `activo: true` (`useProveedoresActivos`). No dedicated
 * `<select>` primitive exists in `components/ui/` yet (instruction #5:
 * reuse existing primitives, or say so explicitly) — this is that
 * explicit exception, styled to match `UsuarioForm.tsx`'s inline `rol`
 * select rather than inventing a second unrelated shape.
 *
 * Presentational: no mutation, register()'s spread props (`name`, `onChange`,
 * `onBlur`, `ref`) land in `...rest`, mirroring `UsuarioForm.tsx`'s
 * `{...register('rol')}` usage on its own `<select>`.
 */
export function ProveedorSelector({
  id,
  label,
  error,
  ...rest
}: ProveedorSelectorProps) {
  const query = useProveedoresActivos();
  const proveedores = query.data ?? [];

  return (
    <div className={styles.wrapper}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <select
        id={id}
        className={styles.select}
        aria-invalid={error ? true : undefined}
        {...rest}
      >
        <option value="" disabled>
          {query.isPending
            ? 'Cargando proveedores…'
            : 'Seleccione un proveedor'}
        </option>
        {proveedores.map((proveedor) => (
          <option key={proveedor.id} value={proveedor.id}>
            {proveedor.nombre}
          </option>
        ))}
      </select>
      {error ? <span className={styles.error}>{error}</span> : null}
    </div>
  );
}

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Button } from '../../components/ui/Button.js';
import { TextField } from '../../components/ui/TextField.js';
import styles from './UsuarioForm.module.css';
import { type UsuarioFormInput, usuarioFormSchema } from './schemas.js';

type UsuarioFormProps = {
  usuario: UsuarioFormInput;
  /**
   * True when this form renders the logged-in user's own account (D17,
   * extended by the corrected spec to cover `rol`). The `rol` control is
   * disabled with a visible reason — never absent — while `nombre`/`email`
   * stay editable.
   */
  isOwnAccount: boolean;
  /** Receives only the dirty subset of the three fields (D18). */
  onSubmit: (patch: Partial<UsuarioFormInput>) => void;
  isPending?: boolean;
};

const ROL_OPTIONS: { value: UsuarioFormInput['rol']; label: string }[] = [
  { value: 'encargado', label: 'Encargado' },
  { value: 'deposito', label: 'Depósito' },
];

/**
 * Presentational — no router, no react-query, no `apiFetch` import
 * (route-module boundary, `LoginForm.tsx:17`'s precedent). "Guardar
 * cambios" stays disabled while nothing is dirty, and the submitted patch
 * is built from `formState.dirtyFields` (D18) so the request body always
 * matches what actually changed. Never renders or submits an `activo`
 * field — that stays exclusively the deactivate/reactivate actions' job.
 *
 * The self-lock reason wording must not claim server authority (D17): the
 * server still permits self-demotion, the screen simply declines to offer
 * it because it would redirect the actor out of `/usuarios` mid-flow.
 */
export function UsuarioForm({
  usuario,
  isOwnAccount,
  onSubmit,
  isPending,
}: UsuarioFormProps) {
  const {
    register,
    handleSubmit,
    formState: { dirtyFields, isDirty },
  } = useForm<UsuarioFormInput>({
    resolver: zodResolver(usuarioFormSchema),
    defaultValues: usuario,
  });

  const submit = handleSubmit((values) => {
    const patch: Partial<UsuarioFormInput> = {};
    if (dirtyFields.nombre) patch.nombre = values.nombre;
    if (dirtyFields.email) patch.email = values.email;
    if (dirtyFields.rol) patch.rol = values.rol;
    onSubmit(patch);
  });

  return (
    <form onSubmit={submit} noValidate>
      <div className={styles.fields}>
        <TextField id="nombre" label="Nombre" {...register('nombre')} />
        <TextField
          id="email"
          label="Correo"
          type="email"
          {...register('email')}
        />

        <div className={styles.wrapper}>
          <label htmlFor="rol" className={styles.label}>
            Rol
          </label>
          <select
            id="rol"
            className={styles.select}
            disabled={isOwnAccount}
            {...register('rol')}
          >
            {ROL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {isOwnAccount ? (
            <span className={styles.reason}>
              El sistema no permite cambiar su propio rol desde aquí: el
              servidor sí lo permitiría, pero cambiarlo lo sacaría de esta
              pantalla de inmediato.
            </span>
          ) : null}
        </div>

        <Button
          type="submit"
          variant="primary"
          disabled={!isDirty}
          isPending={isPending}
        >
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}

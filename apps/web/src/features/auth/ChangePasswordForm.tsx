import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { AuthCard } from '../../components/ui/AuthCard.js';
import { Button } from '../../components/ui/Button.js';
import { TextField } from '../../components/ui/TextField.js';
import styles from './ChangePasswordForm.module.css';
import {
  type ChangePasswordFormInput,
  type ChangePasswordInput,
  changePasswordFormSchema,
} from './schemas.js';

type ChangePasswordFormProps = {
  onSubmit: (values: ChangePasswordInput) => void;
  /**
   * Server `INVALID_CURRENT_PASSWORD` (400), bound to the currentPassword
   * field rather than a generic banner — the whole point of the distinct
   * code (design.md D5): it must not be confused with a global session
   * error and must not discard what the user typed.
   */
  currentPasswordError?: string;
  isPending?: boolean;
};

const NEW_PASSWORD_SAME_AS_CURRENT_MESSAGE =
  'La nueva contraseña no puede ser igual a la actual.';

/**
 * Presentational only — takes props/callbacks, imports neither the router
 * nor react-query nor `apiFetch` (design.md route-module boundary). Copy and
 * layout transcribed verbatim from `docs/design/CambiarPassword.dc.html`.
 */
export function ChangePasswordForm({
  onSubmit,
  currentPasswordError,
  isPending,
}: ChangePasswordFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ChangePasswordFormInput>({
    resolver: zodResolver(changePasswordFormSchema),
  });

  // confirmPassword is a client-side guard against a typo that would lock the
  // user out; the API body has two fields only, so it is dropped here rather
  // than relying on the server to strip it.
  const submit = handleSubmit(({ confirmPassword: _confirmation, ...body }) => {
    onSubmit(body satisfies ChangePasswordInput);
  });

  return (
    <AuthCard title="Cambie su contraseña">
      <form onSubmit={submit} noValidate>
        <div className={styles.fields}>
          <div className={styles.notice}>
            Su contraseña es temporal. Debe definir una nueva antes de usar el
            sistema.
          </div>

          <TextField
            id="currentPassword"
            label="Contraseña actual"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••••••"
            error={
              errors.currentPassword
                ? 'Ingrese su contraseña actual.'
                : currentPasswordError
            }
            {...register('currentPassword')}
          />

          <div>
            <TextField
              id="newPassword"
              label="Contraseña nueva"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••••••"
              error={
                errors.newPassword
                  ? errors.newPassword.message ===
                    NEW_PASSWORD_SAME_AS_CURRENT_MESSAGE
                    ? NEW_PASSWORD_SAME_AS_CURRENT_MESSAGE
                    : 'La contraseña nueva debe tener al menos 12 caracteres.'
                  : undefined
              }
              {...register('newPassword')}
            />
            <div className={styles.hint}>
              Mínimo 12 caracteres. No puede ser igual a la actual.
            </div>
          </div>

          <TextField
            id="confirmPassword"
            label="Repita la contraseña nueva"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••••••"
            error={
              errors.confirmPassword
                ? 'Las contraseñas no coinciden.'
                : undefined
            }
            {...register('confirmPassword')}
          />

          <Button type="submit" variant="primary" isPending={isPending}>
            Guardar contraseña
          </Button>
        </div>
      </form>

      <div className={styles.footer}>
        Al guardar, se cerrarán sus demás sesiones abiertas. Esta seguirá
        activa.
      </div>
    </AuthCard>
  );
}

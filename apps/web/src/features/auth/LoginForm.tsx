import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { AuthCard } from '../../components/ui/AuthCard.js';
import { Button } from '../../components/ui/Button.js';
import { FormError } from '../../components/ui/FormError.js';
import { TextField } from '../../components/ui/TextField.js';
import styles from './LoginForm.module.css';
import { type LoginInput, loginSchema } from './schemas.js';

type LoginFormProps = {
  onSubmit: (values: LoginInput) => void;
  errorMessage?: string;
  isPending?: boolean;
};

/**
 * Presentational only — takes props/callbacks, imports neither the router
 * nor react-query nor `apiFetch` (design.md route-module boundary). Copy and
 * layout transcribed verbatim from `docs/design/Main.dc.html` /
 * `LoginError.dc.html`.
 */
export function LoginForm({ onSubmit, errorMessage, isPending }: LoginFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  const submit = handleSubmit((values) => {
    onSubmit({ email: values.email.trim(), password: values.password.trim() });
  });

  return (
    <AuthCard
      title="InvenTienda"
      subtitle="Sistema de Gestión de Inventario"
      hint="Si olvidó su contraseña, solicítesela al encargado."
    >
      <form onSubmit={submit} noValidate>
        <div className={styles.fields}>
          {errorMessage ? <FormError message={errorMessage} /> : null}

          <TextField
            id="email"
            label="Correo electrónico"
            type="email"
            autoComplete="username"
            placeholder="usuario@tienda.com"
            error={
              errors.email
                ? 'Ingrese un correo electrónico válido.'
                : undefined
            }
            {...register('email')}
          />

          <TextField
            id="password"
            label="Contraseña"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••••••"
            error={errors.password ? 'Ingrese su contraseña.' : undefined}
            {...register('password')}
          />

          <Button type="submit" variant="primary" isPending={isPending}>
            Ingresar
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}

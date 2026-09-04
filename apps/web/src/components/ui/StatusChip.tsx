import styles from './StatusChip.module.css';

type StatusChipProps =
  | { activo: boolean; debeCambiarPassword?: boolean }
  | { variant: 'danger' | 'warning' | 'success'; label: string };

function variantClass(
  variant: 'danger' | 'warning' | 'success',
): string | undefined {
  if (variant === 'danger') return styles.danger;
  if (variant === 'warning') return styles.warning;
  return styles.success;
}

/**
 * 11px/700 pill per `docs/design.md:76-77` (Chips de estado). Two shapes:
 * the usuarios-specific `activo`/`debeCambiarPassword` pair (`Activo`
 * success, `Inactivo` neutral, `Debe cambiar contraseña` warning — the
 * password-change warning takes precedence, the more actionable signal),
 * and a generic `variant`/`label` pair reused by `productos-ledger-base`'s
 * derived stock chips (`quiebre` danger, `bajo` warning) and by
 * `dashboard-ui`'s KPI cards (`Quiebres`/`Stock bajo` reuse the same
 * danger/warning mapping, falling back to `success` when the count is
 * zero) so a second chip component is never built for the same pill
 * styling.
 */
export function StatusChip(props: StatusChipProps) {
  if ('variant' in props) {
    return (
      <span className={`${styles.chip} ${variantClass(props.variant)}`}>
        {props.label}
      </span>
    );
  }

  if (props.debeCambiarPassword) {
    return (
      <span className={`${styles.chip} ${styles.warning}`}>
        Debe cambiar contraseña
      </span>
    );
  }

  if (props.activo) {
    return <span className={`${styles.chip} ${styles.success}`}>Activo</span>;
  }

  return <span className={`${styles.chip} ${styles.neutral}`}>Inactivo</span>;
}

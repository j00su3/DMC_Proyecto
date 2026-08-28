import styles from './StatusChip.module.css';

type StatusChipProps = {
  activo: boolean;
  debeCambiarPassword?: boolean;
};

/**
 * 11px/700 pill per `docs/design.md:76-77` (Chips de estado): `Activo`
 * success, `Inactivo` neutral, `Debe cambiar contraseña` warning. The
 * password-change warning takes precedence over the active/inactive state
 * because it is the more actionable signal for an encargado reading the list.
 */
export function StatusChip({ activo, debeCambiarPassword }: StatusChipProps) {
  if (debeCambiarPassword) {
    return (
      <span className={`${styles.chip} ${styles.warning}`}>
        Debe cambiar contraseña
      </span>
    );
  }

  if (activo) {
    return <span className={`${styles.chip} ${styles.success}`}>Activo</span>;
  }

  return <span className={`${styles.chip} ${styles.neutral}`}>Inactivo</span>;
}

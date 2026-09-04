import type { ReactNode } from 'react';
import styles from './KpiCard.module.css';

export type KpiCardVariant = 'danger';

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  /** Estado crítico per `docs/design.md`'s "KPI cards" tokens — red
   * top border and red cifra. Omitted for the default (non-critical) look. */
  variant?: KpiCardVariant;
}

/**
 * Presentational KPI card (dashboard-ui, design D5): white card, 14px
 * radius, 12px/600 muted label, 28px/800 cifra. `dashboard-kpis`'s only
 * consumer so far is `routes/index.tsx`'s 4-card grid.
 */
export function KpiCard({ label, value, variant }: KpiCardProps) {
  const cardClassName =
    variant === 'danger' ? `${styles.card} ${styles.danger}` : styles.card;

  return (
    <div className={cardClassName}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{value}</div>
    </div>
  );
}

import type { ReactNode } from 'react';
import styles from './AuthCard.module.css';

type AuthCardProps = {
  title: string;
  subtitle?: string;
  hint?: string;
  children: ReactNode;
};

/**
 * Centered card shell shared by the login and change-password screens.
 * Presentational only — no router or network wiring.
 */
export function AuthCard({ title, subtitle, hint, children }: AuthCardProps) {
  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.header}>
          <div className={styles.brandMark} aria-hidden="true">
            it
          </div>
          <div className={styles.titles}>
            <div className={styles.title}>{title}</div>
            {subtitle ? (
              <div className={styles.subtitle}>{subtitle}</div>
            ) : null}
          </div>
        </div>
        {children}
      </div>
      {hint ? <div className={styles.hint}>{hint}</div> : null}
    </div>
  );
}

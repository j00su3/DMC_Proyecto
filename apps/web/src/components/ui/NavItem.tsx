import { Link } from '@tanstack/react-router';
import styles from './AppShell.module.css';

export interface NavItemProps {
  label: string;
  /** Omitted for sidebar entries with no shipped destination yet (D2). */
  to?: string;
  /**
   * Renders the locked marker instead of a Link, even when `to` is set
   * (D3): the destination exists, but this session's role does not get to
   * use it — the lock is the explanation, not a missing route.
   */
  locked?: boolean;
  /** Required alongside `locked`: docs/design.md's "Permisos visibles"
   * principle forbids marking a restriction without a visible reason. */
  reason?: string;
  /**
   * Motor de Alertas (backlog #10): open-alert count for the Alertas nav
   * item's badge. `undefined` (still loading) or `0` (nothing open) both
   * render no badge — only a genuinely positive count is worth flagging.
   */
  badge?: number;
}

/**
 * One sidebar entry, one component, one branch (D2): a `Link` when `to` is
 * set and unlocked, a non-interactive marker otherwise. `activeOptions`
 * explicitly ignores search params so the Usuarios item stays active across
 * `?page` changes.
 */
export function NavItem({
  label,
  to,
  locked = false,
  reason,
  badge,
}: NavItemProps) {
  if (to && !locked) {
    return (
      <Link
        to={to}
        className={styles.navItem}
        activeProps={{ className: styles.navItemActive }}
        activeOptions={{ includeSearch: false }}
      >
        {label}
        {badge !== undefined && badge > 0 && (
          <span className={styles.navItemBadge}>{badge}</span>
        )}
      </Link>
    );
  }

  return (
    <span
      className={
        locked ? `${styles.navItem} ${styles.navItemLocked}` : styles.navItem
      }
    >
      <span>{label}</span>
      {locked && <span aria-hidden="true">🔒</span>}
      {locked && reason && (
        <span className={styles.navItemReason}>{reason}</span>
      )}
    </span>
  );
}

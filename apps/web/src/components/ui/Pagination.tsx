import styles from './Pagination.module.css';

type PaginationProps = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  isBusy?: boolean;
};

/**
 * Compact footer pagination per `docs/design.md:73-74` (Tablas — "pie con
 * paginación, botones compactos, página activa azul"). All controls disable
 * while `isBusy` (D8): a double-click must not queue a page change against
 * data that has not arrived yet.
 */
export function Pagination({
  page,
  totalPages,
  onPageChange,
  isBusy = false,
}: PaginationProps) {
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <nav className={styles.footer} aria-label="Paginación">
      <button
        type="button"
        className={styles.control}
        onClick={() => onPageChange(page - 1)}
        disabled={isBusy || page <= 1}
      >
        Anterior
      </button>

      <div className={styles.pages}>
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            className={p === page ? styles.pageActive : styles.page}
            onClick={() => onPageChange(p)}
            disabled={isBusy}
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </button>
        ))}
      </div>

      <button
        type="button"
        className={styles.control}
        onClick={() => onPageChange(page + 1)}
        disabled={isBusy || page >= totalPages}
      >
        Siguiente
      </button>
    </nav>
  );
}

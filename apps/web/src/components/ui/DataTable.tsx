import type { ReactNode } from 'react';
import styles from './DataTable.module.css';

export type DataTableColumn<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
};

type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  'aria-busy'?: boolean;
};

/**
 * Generic presentational table primitive. No Usuarios-specific knowledge —
 * `UsuariosTable` (S4) supplies the columns. Tokens per `docs/design.md:73-74`
 * (Tablas): white card, 11px uppercase header, `#eef1f5` row dividers, `11px
 * 18px` row padding. No approved `.dc.html` mockup exists for Usuarios
 * (Req: Design-Tokens-Only Build) — this is built from documented tokens only.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  'aria-busy': ariaBusy,
}: DataTableProps<T>) {
  return (
    <div className={styles.card}>
      <table className={styles.table} aria-busy={ariaBusy}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={
                  column.align === 'right' ? styles.alignRight : undefined
                }
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={
                    column.align === 'right' ? styles.alignRight : undefined
                  }
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

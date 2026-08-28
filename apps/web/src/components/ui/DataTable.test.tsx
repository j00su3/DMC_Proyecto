import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cwd } from 'node:process';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable } from './DataTable.js';

type Row = { id: string; nombre: string };

const columns = [
  { key: 'nombre', header: 'Nombre', render: (row: Row) => row.nombre },
];

describe('DataTable', () => {
  it('renders column headers as <th scope="col">', () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(row) => row.id} />);

    const header = screen.getByRole('columnheader', { name: 'Nombre' });
    expect(header.tagName).toBe('TH');
    expect(header).toHaveAttribute('scope', 'col');
  });

  it('renders one row per item using the column render function', () => {
    const rows: Row[] = [
      { id: '1', nombre: 'Ana' },
      { id: '2', nombre: 'Beto' },
    ];

    render(
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} />,
    );

    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Beto')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2 rows
  });

  it('passes an aria-busy prop through to the table element when set', () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        aria-busy
      />,
    );

    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
  });

  it('carries the documented table tokens (docs/design.md:73-74) — white card, 11px uppercase header, #eef1f5 divider, 11px 18px row padding (P4/P5, no computed-style assertion per styles/tokens.test.ts:6-20)', () => {
    const css = readFileSync(
      resolve(cwd(), 'src/components/ui/DataTable.module.css'),
      'utf8',
    );

    expect(css).toMatch(/background:\s*#ffffff;/);
    expect(css).toMatch(
      /text-transform:\s*uppercase;[\s\S]*?font-size:\s*11px;/,
    );
    expect(css).toMatch(/border-top:\s*1px solid var\(--color-divider\);/);
    expect(css).toMatch(/padding:\s*11px 18px;/);
  });
});

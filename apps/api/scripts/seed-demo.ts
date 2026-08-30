import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { getDb } from '../src/db/pool.js';
import { productos, proveedores, usuarios } from '../src/db/schema.js';
import { createUnitOfWork } from '../src/db/uow.js';
import { buildRepos } from '../src/plugins/repos.js';
import { crearProducto } from '../src/productos/service.js';
import { createProveedor } from '../src/proveedores/service.js';

// Demo dataset for a live walkthrough. Human-invoked, never part of the API
// and never part of the automated suite.
//
// Every product is created through `crearProducto`, NOT through a direct
// INSERT. That is the whole point of this script: ADR-0003 says stock_actual
// never moves without its paired `movimientos` row, and that neither write
// survives if the other fails. A seed that inserted rows with stock directly
// would leave products whose stock came from nowhere — invisible today, and
// a contradiction the moment the movements screen (backlog #6) reads the
// ledger back.
//
// Re-running is safe: a supplier or product that already exists is skipped,
// never duplicated and never overwritten. Nothing is ever deleted.

export interface DemoProveedor {
  nombre: string;
  contacto: string;
}

export interface DemoProducto {
  nombre: string;
  sku: string;
  categoria: string;
  precio: string;
  proveedor: string;
  // null means "no threshold set" — the list screen shows no chip at all for
  // these, at any stock level. The dataset keeps two of them on purpose.
  stockMinimo: number | null;
  stockInicial: number;
}

// Invented names, and `.test` is a reserved TLD that can never resolve to a
// real business. Demo data must not read as a record of a real company.
export const DEMO_PROVEEDORES: DemoProveedor[] = [
  {
    nombre: 'Distribuidora del Sur',
    contacto: 'ventas@distribuidora-sur.test',
  },
  {
    nombre: 'Ferretería Mayorista Rivas',
    contacto: 'pedidos@rivas-mayorista.test',
  },
  { nombre: 'Insumos Belgrano', contacto: '+54 11 4555-0142' },
  { nombre: 'Papelera Central', contacto: 'contacto@papelera-central.test' },
];

// Deliberately spread across every derived state the list screen can render
// (`features/productos/format.ts`): two `quiebre`, three `bajo`, five `ok`,
// and two with no threshold and therefore no chip. A dataset that is all
// green demonstrates nothing — three quarters of the screen would be dead
// pixels during the walkthrough.
export const DEMO_PRODUCTOS: DemoProducto[] = [
  {
    nombre: 'Martillo carpintero 500g',
    sku: 'FER-001',
    categoria: 'Ferretería',
    precio: '15400.00',
    proveedor: 'Ferretería Mayorista Rivas',
    stockMinimo: 10,
    stockInicial: 42,
  },
  {
    nombre: 'Destornillador Phillips #2',
    sku: 'FER-002',
    categoria: 'Ferretería',
    precio: '4850.00',
    proveedor: 'Ferretería Mayorista Rivas',
    stockMinimo: 15,
    stockInicial: 8,
  },
  {
    nombre: 'Cinta métrica 5m',
    sku: 'FER-003',
    categoria: 'Ferretería',
    precio: '9200.00',
    proveedor: 'Ferretería Mayorista Rivas',
    stockMinimo: 6,
    stockInicial: 0,
  },
  {
    nombre: 'Taladro percutor 650W',
    sku: 'FER-004',
    categoria: 'Herramientas',
    precio: '128500.00',
    proveedor: 'Ferretería Mayorista Rivas',
    stockMinimo: 3,
    stockInicial: 5,
  },
  {
    nombre: 'Guantes de trabajo (par)',
    sku: 'INS-001',
    categoria: 'Seguridad',
    precio: '6300.00',
    proveedor: 'Insumos Belgrano',
    stockMinimo: 20,
    stockInicial: 18,
  },
  {
    nombre: 'Casco de seguridad',
    sku: 'INS-002',
    categoria: 'Seguridad',
    precio: '18900.00',
    proveedor: 'Insumos Belgrano',
    stockMinimo: null,
    stockInicial: 12,
  },
  {
    nombre: 'Cinta aisladora 20m',
    sku: 'INS-003',
    categoria: 'Electricidad',
    precio: '2750.00',
    proveedor: 'Insumos Belgrano',
    stockMinimo: 25,
    stockInicial: 60,
  },
  {
    nombre: 'Resma A4 75g',
    sku: 'PAP-001',
    categoria: 'Papelería',
    precio: '11200.00',
    proveedor: 'Papelera Central',
    stockMinimo: 30,
    stockInicial: 0,
  },
  {
    nombre: 'Cuaderno tapa dura 100 hojas',
    sku: 'PAP-002',
    categoria: 'Papelería',
    precio: '5400.00',
    proveedor: 'Papelera Central',
    stockMinimo: null,
    stockInicial: 45,
  },
  {
    nombre: 'Bolígrafo azul (caja x50)',
    sku: 'PAP-003',
    categoria: 'Papelería',
    precio: '13750.00',
    proveedor: 'Papelera Central',
    stockMinimo: 10,
    stockInicial: 22,
  },
  {
    nombre: 'Cable bipolar 2x1.5mm (rollo 100m)',
    sku: 'DIS-001',
    categoria: 'Electricidad',
    precio: '94300.00',
    proveedor: 'Distribuidora del Sur',
    stockMinimo: 5,
    stockInicial: 3,
  },
  {
    nombre: 'Lámpara LED 9W',
    sku: 'DIS-002',
    categoria: 'Electricidad',
    precio: '3100.00',
    proveedor: 'Distribuidora del Sur',
    stockMinimo: 40,
    stockInicial: 120,
  },
];

export interface SeedDemoResult {
  proveedoresCreados: string[];
  proveedoresOmitidos: string[];
  productosCreados: string[];
  productosOmitidos: string[];
}

// The seam that makes this script testable without a database, and the same
// port/adapter split the domain code uses. `buildSeedDemoDeps` is the only
// place that touches Drizzle.
export interface SeedDemoDeps {
  findEncargadoId(): Promise<string | undefined>;
  findProveedorIdByNombre(nombre: string): Promise<string | undefined>;
  findProductoIdBySku(sku: string): Promise<string | undefined>;
  crearProveedor(input: {
    nombre: string;
    contacto: string;
    actorId: string;
  }): Promise<{ id: string }>;
  crearProducto(
    input: DemoProducto & {
      proveedorId: string;
      actorId: string;
    },
  ): Promise<{ id: string }>;
}

export async function seedDemo(deps: SeedDemoDeps): Promise<SeedDemoResult> {
  const actorId = await deps.findEncargadoId();
  if (!actorId) {
    throw new Error(
      'No encargado user exists. Run `pnpm seed:encargado` first — every product and supplier is attributed to a real actor in the audit trail.',
    );
  }

  const result: SeedDemoResult = {
    proveedoresCreados: [],
    proveedoresOmitidos: [],
    productosCreados: [],
    productosOmitidos: [],
  };

  const proveedorIds = new Map<string, string>();
  for (const proveedor of DEMO_PROVEEDORES) {
    const existente = await deps.findProveedorIdByNombre(proveedor.nombre);
    if (existente) {
      proveedorIds.set(proveedor.nombre, existente);
      result.proveedoresOmitidos.push(proveedor.nombre);
      continue;
    }
    const creado = await deps.crearProveedor({ ...proveedor, actorId });
    proveedorIds.set(proveedor.nombre, creado.id);
    result.proveedoresCreados.push(proveedor.nombre);
  }

  for (const producto of DEMO_PRODUCTOS) {
    if (await deps.findProductoIdBySku(producto.sku)) {
      result.productosOmitidos.push(producto.sku);
      continue;
    }
    const proveedorId = proveedorIds.get(producto.proveedor);
    if (!proveedorId) {
      // Unreachable while the dataset test below passes; a broken invariant
      // rather than a condition worth handling at runtime.
      throw new Error(
        `seedDemo: no supplier id resolved for "${producto.proveedor}" (product ${producto.sku})`,
      );
    }
    await deps.crearProducto({ ...producto, proveedorId, actorId });
    result.productosCreados.push(producto.sku);
  }

  return result;
}

export function buildSeedDemoDeps(db: Db): SeedDemoDeps {
  const repos = buildRepos(db);
  const uow = createUnitOfWork(db);

  return {
    async findEncargadoId() {
      const rows = await db
        .select({ id: usuarios.id })
        .from(usuarios)
        .where(eq(usuarios.rol, 'encargado'))
        .limit(1);
      return rows[0]?.id;
    },

    // `lower(nombre) = lower($1)` written at the call site, per the rule the
    // proveedores port documents: case folding happens only in the database,
    // so there is deliberately no findByNombre method to fold in TypeScript.
    async findProveedorIdByNombre(nombre) {
      const rows = await db
        .select({ id: proveedores.id })
        .from(proveedores)
        .where(sql`lower(${proveedores.nombre}) = lower(${nombre})`)
        .limit(1);
      return rows[0]?.id;
    },

    // Same rule, from the productos port: no findBySku exists, so any SKU
    // selector must be written `where lower(sku) = lower($1)` here.
    async findProductoIdBySku(sku) {
      const rows = await db
        .select({ id: productos.id })
        .from(productos)
        .where(sql`lower(${productos.sku}) = lower(${sku})`)
        .limit(1);
      return rows[0]?.id;
    },

    crearProveedor: (input) => createProveedor(uow, input),

    crearProducto: (input) =>
      crearProducto(repos, uow, {
        nombre: input.nombre,
        sku: input.sku,
        categoria: input.categoria,
        stockMinimo: input.stockMinimo,
        precio: input.precio,
        proveedorId: input.proveedorId,
        stockInicial: input.stockInicial,
        actor: { id: input.actorId, rol: 'encargado' },
      }),
  };
}

// Without this the driver silently falls back to its own defaults (localhost,
// the OS username, no password) and the first query fails with a connection
// error that says nothing about the real cause. Naming the missing variable is
// the difference between a two-minute fix and a hunt.
export function requireDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set in this shell. Set it to the target database before running this script — it is not persisted between terminal sessions.',
    );
  }
  return url;
}

// Drizzle wraps a driver failure, so the useful part (authentication, host
// resolution, SSL) lives in `cause`, not in the top-level message. Printing
// only the message hides exactly the line that explains the failure.
export function formatError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    parts.push(current.message);
    current = current.cause;
  }
  return parts.length > 0 ? parts.join('\n  caused by: ') : String(error);
}

async function main() {
  requireDatabaseUrl(process.env);
  const result = await seedDemo(buildSeedDemoDeps(getDb()));

  console.log(
    `Suppliers: ${result.proveedoresCreados.length} created, ${result.proveedoresOmitidos.length} already present.`,
  );
  console.log(
    `Products:  ${result.productosCreados.length} created, ${result.productosOmitidos.length} already present.`,
  );
  if (result.productosCreados.length > 0) {
    console.log(`Created SKUs: ${result.productosCreados.join(', ')}`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(formatError(err));
      process.exit(1);
    });
}

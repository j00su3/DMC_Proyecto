import { z } from 'zod';

const PRECIO_RE = /^\d+(\.\d{1,2})?$/;
const optionalIntString = (message: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d+$/.test(v), message);

/** Form-only: raw strings off `<input>`/`<select>`; parsed once at submit. */
export const productoFormSchema = z.object({
  nombre: z.string().trim().min(1, 'Ingrese un nombre.'),
  sku: z.string().trim().min(1, 'Ingrese un SKU.'),
  categoria: z.string().trim(),
  stockMinimo: optionalIntString('Ingrese un stock mínimo válido.'),
  precio: z
    .string()
    .trim()
    .regex(PRECIO_RE, 'Ingrese un precio válido, ej. "10.00".'),
  proveedorId: z.string().trim().min(1, 'Seleccione un proveedor.'),
  stockInicial: optionalIntString('Ingrese un stock inicial válido.'),
});
export type ProductoFormValues = z.infer<typeof productoFormSchema>;
export const EMPTY_PRODUCTO_FORM: ProductoFormValues = {
  nombre: '',
  sku: '',
  categoria: '',
  stockMinimo: '',
  precio: '',
  proveedorId: '',
  stockInicial: '',
};
/** Client mirror of `crearProductoBody` (`apps/api/src/routes/productos.ts:61-72`),
 * a plain type (already validated client- and server-side). `stockMinimo`
 * omits entirely for `deposito` (D6 403s on mere key presence), never `null`. */
export type CrearProductoInput = {
  nombre: string;
  sku: string;
  categoria?: string | null;
  stockMinimo?: number | null;
  precio: string;
  proveedorId: string;
  stockInicial?: number;
};
/** Converts validated form strings into the wire body. Create-mode only (S7a). */
export function toCrearProductoInput(
  values: ProductoFormValues,
  actorRol: 'encargado' | 'deposito',
): CrearProductoInput {
  const input: CrearProductoInput = {
    nombre: values.nombre,
    sku: values.sku,
    categoria: values.categoria.trim() === '' ? null : values.categoria,
    precio: values.precio,
    proveedorId: values.proveedorId,
  };

  if (actorRol === 'encargado') {
    input.stockMinimo =
      values.stockMinimo.trim() === '' ? null : Number(values.stockMinimo);
  }

  if (values.stockInicial.trim() !== '') {
    input.stockInicial = Number(values.stockInicial);
  }

  return input;
}

/** Client mirror of `actualizarProductoBody` (`apps/api/src/routes/productos.ts:82-91`)
 * — no `stockInicial`, no `stockActual`, ever (S7b, edit path). Same key-presence
 * guard as `CrearProductoInput`: `stockMinimo` is omitted entirely for `deposito`. */
export type ActualizarProductoInput = {
  nombre: string;
  sku: string;
  categoria?: string | null;
  stockMinimo?: number | null;
  precio: string;
  proveedorId: string;
};

/** Converts validated form strings into the PATCH body. Edit-mode only (S7b). */
export function toActualizarProductoInput(
  values: ProductoFormValues,
  actorRol: 'encargado' | 'deposito',
): ActualizarProductoInput {
  const input: ActualizarProductoInput = {
    nombre: values.nombre,
    sku: values.sku,
    categoria: values.categoria.trim() === '' ? null : values.categoria,
    precio: values.precio,
    proveedorId: values.proveedorId,
  };

  if (actorRol === 'encargado') {
    input.stockMinimo =
      values.stockMinimo.trim() === '' ? null : Number(values.stockMinimo);
  }

  return input;
}

/** Existing product DTO (server shape) into editable form strings (S7b). */
export function productoToFormValues(producto: {
  nombre: string;
  sku: string;
  categoria: string | null;
  stockMinimo: number | null;
  precio: string;
  proveedorId: string;
}): ProductoFormValues {
  return {
    nombre: producto.nombre,
    sku: producto.sku,
    categoria: producto.categoria ?? '',
    stockMinimo:
      producto.stockMinimo === null ? '' : String(producto.stockMinimo),
    precio: producto.precio,
    proveedorId: producto.proveedorId,
    stockInicial: '',
  };
}

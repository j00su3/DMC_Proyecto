import { z } from 'zod';

/** Form-only: raw strings off `<input>`; parsed once at submit. */
export const proveedorFormSchema = z.object({
  nombre: z.string().trim().min(1, 'Ingrese un nombre.'),
  contacto: z.string().trim(),
});
export type ProveedorFormValues = z.infer<typeof proveedorFormSchema>;
export const EMPTY_PROVEEDOR_FORM: ProveedorFormValues = {
  nombre: '',
  contacto: '',
};

/** Client mirror of `crearProveedorBody` (`apps/api/src/routes/proveedores.ts:40-43`). */
export type CrearProveedorInput = {
  nombre: string;
  contacto?: string | null;
};

/**
 * Converts validated form strings into the create wire body. `contacto: ''`
 * is NOT a third spelling of null (`routes/proveedores.ts:46-47`) — an empty
 * or whitespace-only field maps to `null`, never an empty string.
 */
export function toCrearProveedorInput(
  values: ProveedorFormValues,
): CrearProveedorInput {
  return {
    nombre: values.nombre,
    contacto: values.contacto.trim() === '' ? null : values.contacto.trim(),
  };
}

/** Client mirror of `actualizarProveedorBody` (`apps/api/src/routes/proveedores.ts:52-60`). */
export type ActualizarProveedorInput = {
  nombre?: string;
  contacto?: string | null;
};

export type ProveedorDirtyFields = Partial<
  Record<keyof ProveedorFormValues, boolean>
>;

/**
 * Converts validated form strings into the PATCH body, carrying ONLY the
 * fields the user actually touched (the `productos`/`usuarios` D18
 * precedent). Same `'' -> null` rule as create for a dirty `contacto`.
 */
export function toActualizarProveedorInput(
  values: ProveedorFormValues,
  dirtyFields: ProveedorDirtyFields,
): ActualizarProveedorInput {
  const input: ActualizarProveedorInput = {};

  if (dirtyFields.nombre) input.nombre = values.nombre;
  if (dirtyFields.contacto) {
    input.contacto =
      values.contacto.trim() === '' ? null : values.contacto.trim();
  }

  return input;
}

/** Existing proveedor DTO (server shape) into editable form strings. */
export function proveedorToFormValues(proveedor: {
  nombre: string;
  contacto: string | null;
}): ProveedorFormValues {
  return {
    nombre: proveedor.nombre,
    contacto: proveedor.contacto ?? '',
  };
}

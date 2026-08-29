CREATE TYPE "public"."movimiento_tipo" AS ENUM('entrada', 'salida', 'ajuste', 'venta', 'anulacion');--> statement-breakpoint
CREATE TABLE "movimientos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"producto_id" uuid NOT NULL,
	"tipo" "movimiento_tipo" NOT NULL,
	"cantidad" integer NOT NULL,
	"motivo" text,
	"es_discrepancia" boolean DEFAULT false NOT NULL,
	"usuario_id" uuid NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"venta_id" uuid,
	"stock_resultante" integer NOT NULL,
	CONSTRAINT "movimientos_signo_tipo" CHECK ((
        ("movimientos"."tipo" = 'entrada'::movimiento_tipo AND "movimientos"."cantidad" > 0) OR
        ("movimientos"."tipo" IN ('salida'::movimiento_tipo, 'venta'::movimiento_tipo) AND "movimientos"."cantidad" < 0) OR
        ("movimientos"."tipo" = 'anulacion'::movimiento_tipo AND "movimientos"."cantidad" > 0) OR
        ("movimientos"."tipo" = 'ajuste'::movimiento_tipo)
      )),
	CONSTRAINT "movimientos_discrepancia_solo_ajuste" CHECK ("movimientos"."es_discrepancia" = false OR "movimientos"."tipo" = 'ajuste'::movimiento_tipo)
);
--> statement-breakpoint
CREATE TABLE "productos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"sku" text NOT NULL,
	"categoria" text,
	"stock_actual" integer DEFAULT 0 NOT NULL,
	"stock_minimo" integer,
	"precio" numeric(12, 2) NOT NULL,
	"proveedor_id" uuid NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_producto_id_productos_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "productos" ADD CONSTRAINT "productos_proveedor_id_proveedores_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "movimientos_producto_id_fecha_idx" ON "movimientos" USING btree ("producto_id","fecha");--> statement-breakpoint
CREATE UNIQUE INDEX "productos_sku_lower_unique" ON "productos" USING btree (lower("sku"));
CREATE TYPE "public"."medio_pago" AS ENUM('efectivo', 'tarjeta', 'transferencia', 'qr');--> statement-breakpoint
CREATE TYPE "public"."pago_estado" AS ENUM('registrado', 'revertido');--> statement-breakpoint
CREATE TYPE "public"."venta_estado" AS ENUM('confirmada', 'anulada');--> statement-breakpoint
CREATE SEQUENCE "public"."ventas_numero_correlativo_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "items_venta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venta_id" uuid NOT NULL,
	"producto_id" uuid NOT NULL,
	"cantidad" integer NOT NULL,
	"precio_unitario" numeric(12, 2) NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	CONSTRAINT "items_venta_subtotal_igual_precio_por_cantidad" CHECK ("items_venta"."subtotal" = "items_venta"."precio_unitario" * "items_venta"."cantidad")
);
--> statement-breakpoint
CREATE TABLE "pagos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venta_id" uuid NOT NULL,
	"medio" "medio_pago" NOT NULL,
	"monto" numeric(12, 2) NOT NULL,
	"vuelto" numeric(12, 2) DEFAULT '0' NOT NULL,
	"estado" "pago_estado" DEFAULT 'registrado' NOT NULL,
	CONSTRAINT "pagos_vuelto_solo_efectivo" CHECK ("pagos"."vuelto" = 0 OR "pagos"."medio" = 'efectivo'::medio_pago)
);
--> statement-breakpoint
CREATE TABLE "ventas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero_correlativo" integer DEFAULT nextval('ventas_numero_correlativo_seq') NOT NULL,
	"usuario_id" uuid NOT NULL,
	"estado" "venta_estado" DEFAULT 'confirmada' NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items_venta" ADD CONSTRAINT "items_venta_venta_id_ventas_id_fk" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items_venta" ADD CONSTRAINT "items_venta_producto_id_productos_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_venta_id_ventas_id_fk" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "items_venta_venta_id_producto_id_unique" ON "items_venta" USING btree ("venta_id","producto_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pagos_venta_id_medio_unique" ON "pagos" USING btree ("venta_id","medio");--> statement-breakpoint
CREATE UNIQUE INDEX "ventas_numero_correlativo_unique" ON "ventas" USING btree ("numero_correlativo");--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_venta_id_ventas_id_fk" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE restrict ON UPDATE no action;
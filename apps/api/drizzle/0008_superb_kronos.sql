CREATE TYPE "public"."alerta_estado" AS ENUM('activa', 'vista', 'resuelta');--> statement-breakpoint
CREATE TYPE "public"."alerta_tipo" AS ENUM('stock_bajo', 'quiebre', 'discrepancia', 'sugerencia_reposicion');--> statement-breakpoint
ALTER TYPE "public"."entidad_auditoria" ADD VALUE 'alertas';--> statement-breakpoint
CREATE TABLE "alertas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"producto_id" uuid NOT NULL,
	"movimiento_id" uuid,
	"tipo" "alerta_tipo" NOT NULL,
	"estado" "alerta_estado" DEFAULT 'activa' NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"resuelta_en" timestamp with time zone,
	"resuelta_por" uuid
);
--> statement-breakpoint
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_producto_id_productos_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_movimiento_id_movimientos_id_fk" FOREIGN KEY ("movimiento_id") REFERENCES "public"."movimientos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_resuelta_por_usuarios_id_fk" FOREIGN KEY ("resuelta_por") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alertas_producto_tipo_abierta_unique" ON "alertas" USING btree ("producto_id","tipo") WHERE "alertas"."estado" <> 'resuelta'::alerta_estado;
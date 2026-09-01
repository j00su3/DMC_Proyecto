ALTER TABLE "ventas" ADD COLUMN "anulada_por" uuid;--> statement-breakpoint
ALTER TABLE "ventas" ADD COLUMN "anulada_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ventas" ADD COLUMN "motivo_anulacion" text;--> statement-breakpoint
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_anulada_por_usuarios_id_fk" FOREIGN KEY ("anulada_por") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_anulacion_datos_solo_anulada" CHECK (("ventas"."anulada_por" is not null) = ("ventas"."estado" = 'anulada'::venta_estado)
        and ("ventas"."anulada_en" is not null) = ("ventas"."estado" = 'anulada'::venta_estado)
        and ("ventas"."motivo_anulacion" is not null) = ("ventas"."estado" = 'anulada'::venta_estado));
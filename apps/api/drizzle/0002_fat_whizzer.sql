CREATE TYPE "public"."accion_auditoria" AS ENUM('crear', 'actualizar', 'baja_logica', 'reactivar', 'cambiar_password');--> statement-breakpoint
CREATE TYPE "public"."entidad_auditoria" AS ENUM('usuarios', 'proveedores', 'productos');--> statement-breakpoint
CREATE TABLE "auditoria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entidad" "entidad_auditoria" NOT NULL,
	"entidad_id" uuid NOT NULL,
	"accion" "accion_auditoria" NOT NULL,
	"usuario_id" uuid NOT NULL,
	"datos_previos" jsonb,
	"datos_posteriores" jsonb NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auditoria_datos_previos_solo_en_crear" CHECK (("auditoria"."accion" = 'crear'::accion_auditoria) = ("auditoria"."datos_previos" is null))
);
--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auditoria_entidad_entidad_id_creado_en_idx" ON "auditoria" USING btree ("entidad","entidad_id","creado_en");--> statement-breakpoint
CREATE INDEX "auditoria_usuario_id_creado_en_idx" ON "auditoria" USING btree ("usuario_id","creado_en");
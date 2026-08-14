# ADR 0001: Arquitectura de componentes — Monolito API + SPA en monorepo

## Estado

Aceptado

## Contexto

El PRD describe una aplicación web multiusuario, con operación diaria desde el navegador, que debe
mostrar el inventario "en tiempo real" (stock actualizado al confirmar cada movimiento) y disparar
alertas de stock bajo dentro de 1 minuto desde que se cruza el umbral. Es un proyecto de una sola
persona, para un único local. Además, el PRD pide explícitamente "dejar la puerta abierta" a dos
evoluciones de etapa 2: la factura fiscal electrónica (dependencia externa fuerte) y el refresco
en vivo (push entre dispositivos).

Se necesita decidir cuántos componentes tiene el sistema y cómo se comunican.

## Decisión

El sistema se construye como **dos componentes en un monorepo liviano**: un **backend API** que
concentra toda la lógica de negocio, la persistencia y la evaluación de alertas, y un **frontend
SPA** que consume esa API por HTTP/JSON. El backend es un único proceso desplegable. Las alertas
por regla/umbral se evalúan **dentro de la misma transacción** que confirma cada movimiento, sin
un proceso adicional, lo que garantiza el objetivo de "< 1 minuto" por construcción.

## Alternativas consideradas

- **Framework full-stack integrado (SSR, un solo componente)** — máximo de simplicidad de deploy,
  pero mezcla UI y API en un mismo artefacto. Exponer la API a un tercero o incorporar la factura
  fiscal de etapa 2 obligaría a refactorizar la capa de presentación. La separación API/SPA evita
  ese costo futuro por un costo inicial bajo.
- **API + SPA + worker de alertas (tres componentes)** — un proceso separado (cron/cola) para
  evaluar alertas y sugerencias de reposición, más alineado con el motor de ML futuro. Se descartó
  porque en v1 las reglas por umbral se evalúan en línea sin problema, y agregar una pieza
  operativa extra (cola, worker, monitoreo) no se justifica para un local único.

## Consecuencias

- Un solo backend que desplegar, versionar y operar; la lógica de stock, ventas y alertas vive en
  un lugar coherente y transaccional.
- La separación limpia entre API y SPA deja preparada la incorporación de push en vivo y de la
  factura fiscal (etapa 2) sin rehacer el flujo.
- **Trade-off:** al evaluar las alertas dentro de la transacción del movimiento, el motor de
  alertas queda acoplado al camino de escritura. Si en el futuro el ML necesita cómputo pesado o
  asíncrono, habrá que extraer esa evaluación a un worker separado (ver [[0008-evaluador-de-alertas-detras-de-interfaz]],
  que mitiga el impacto detrás de una interfaz).
- **Trade-off:** dos componentes implican mantener un contrato entre ellos (ver
  [[0004-rest-json-openapi]]), a diferencia de un full-stack donde front y back comparten proceso.

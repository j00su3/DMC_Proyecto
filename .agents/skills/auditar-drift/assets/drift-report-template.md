# Drift Report: {Nombre del proyecto}

**Fecha:** {fecha}
**Comparado contra:** PRD.md{, TECH-DESIGN.md si estaba disponible} + {N} ADRs

## Resumen ejecutivo

{1 párrafo: cuántos puntos de comparación se revisaron, cuántos coinciden, cuántos hallazgos por
severidad, y la conclusión de una línea — el proyecto está alineado con lo prometido, o hay drift
real que requiere decisión.}

| Severidad | Cantidad |
|---|---|
| Crítico | {n} |
| Advertencia | {n} |
| Sugerencia | {n} |

## Hallazgos

### {ID} — {Título del hallazgo}

- **Severidad:** {Crítico | Advertencia | Sugerencia}
- **Tipo:** {Feature fantasma | Regla omitida | Decisión de arquitectura violada | Feature no documentada | Deuda técnica ligada a una promesa}
- **Prometido:** {cita textual de PRD.md o de la Decisión de la ADR correspondiente, con referencia}
- **Real:** {qué hace el código hoy, con archivo:línea, o su ausencia explícita}
- **Por qué importa:** {consecuencia concreta de dejarlo así}
- **Opciones:**
  - `CORREGIR CÓDIGO` — {qué cambiaría}
  - `ACTUALIZAR PRD/ADR` — {qué se documentaría en su lugar, y por qué sería justificado}

{Repetir por cada hallazgo.}

## Deuda técnica detectada

- {Workaround/TODO/hack ligado a una promesa — archivo:línea, riesgo concreto}

## Features no documentadas (drift inverso)

- {Qué existe en el código sin respaldo en PRD/ADR — archivo:línea, y si vale la pena documentarlo o eliminarlo}

## Próximos pasos

- {Acción concreta, priorizada — quién debería decidir cada `DESIGN/ADR CHANGE` o `PRODUCT CHANGE` pendiente}

# Design System — InvenTienda
Sistema de Gestión de Inventario para Tiendas · Dirección visual «SaaS modular» (elegida sobre las alternativas «Libro mayor» y «Sala de control»).

## Principios
- **Herramienta de trabajo densa pero amable**: mucha información por pantalla, densidad media, tarjetas suaves.
- **Acciones frecuentes en ≤ 3 clics**: acciones primarias siempre visibles en el encabezado de cada vista.
- **Todo auditable**: cada movimiento muestra fecha, usuario y motivo.
- **Permisos visibles**: lo que el rol no puede hacer se marca con 🔒, no se oculta sin explicación.
- Copy en tono **neutro formal (usted)**. Sin emojis decorativos (solo funcionales: 🔍 🔔 🔒).

## Color
| Token | Valor | Uso |
|---|---|---|
| Fondo app | `#eef1f5` | fondo general de pantallas |
| Sidebar | `#16233c` | navegación lateral, fondos oscuros (login) |
| Texto sidebar | `#aebad0` | ítems inactivos (blanco `#fff` el activo) |
| Acento primario | `#3b82f6` | botones primarios, nav activa, links, chips VENTA (con `#2456c8` sobre `#e8f0fe`) |
| Acento oscuro | `#2456c8` | hover de links, texto sobre azul claro |
| Texto | `#1e2733` | texto principal |
| Muted fuerte | `#69788c` | texto secundario |
| Muted suave | `#8794a5` | metadatos, placeholders |
| Borde | `#dde3ea` | bordes de inputs y botones secundarios |
| Divisor | `#eef1f5` | filas de tabla, separadores internos |
| Peligro | `#e04f3a` | quiebres de stock, alertas, eliminar (fondo `#fdecea`, borde `#f6d5cf`, fila `#fdf5f4`) |
| Advertencia | `#eba13c` / `#b7791a` | stock bajo, ajustes (fondo `#fdf3e3`, texto aviso `#8a5c12`) |
| Éxito | `#2f9e63` | entradas, vuelto, transacciones (fondo `#e6f6ec`) |

Gradiente de marca (solo logo): `linear-gradient(135deg, #3b82f6, #2456c8)`.

## Tipografía
- **Familia**: Public Sans (400–800), fallback `system-ui, sans-serif`.
- Título de vista: 17px / 800 · Título de tarjeta: 15px / 800
- Cuerpo: 14px · Tablas: 13–14px · Metadatos: 12px
- Encabezado de columna: 11px / 700, mayúsculas, `letter-spacing: .05em`, color `#8794a5`
- Cifras grandes (KPIs): 28px / 800 · Total POS: 28px / 800 · Vuelto: 22px / 800 verde

## Forma y elevación
- Radios: tarjetas **14px** · botones e inputs **10px** · modales **18px** · chips y filtros píldora **99px**.
- Sombra tarjeta: `0 1px 3px rgba(22,35,60,.07)` · botón primario: `0 2px 6px rgba(59,130,246,.35)` · modal: `0 18px 50px rgba(22,35,60,.4)`.
- Overlay de modal: `rgba(22,35,60,.55)`.

## Componentes
### Sidebar (210px)
Fondo `#16233c`. Logo arriba (marca 30×30, radio 8). Ítems 9px 12px, radio 8; activo fondo `#3b82f6` texto blanco. Abajo, tarjeta de usuario con avatar circular 30px (iniciales; azul encargado, verde depósito) sobre `rgba(255,255,255,.06)`.

Rótulos de navegación (tomados del Design System publicado, ver «Archivos»):

| Ítem | Backlog |
|---|---|
| Panel general | #13 |
| Inventario | #5 |
| Punto de venta | #7 |
| Movimientos | #6 |
| Proveedores | #4 |
| Reportes | #12 |
| Usuarios | #3 |

Tarjeta de usuario: iniciales en el avatar, nombre completo, y una línea de rol en 12px muted con el formato `Encargada · Admin`.

### Encabezado de vista (60px)
Título + subtítulo (12px muted) a la izquierda; búsqueda/filtros/acciones a la derecha. Botón primario siempre al extremo derecho.

### Botones
- **Primario**: fondo `#3b82f6`, blanco, 700, radio 10, sombra azul.
- **Secundario**: blanco, borde `#dde3ea`, texto `#334153` 600.
- **Outline de acción en fila** (Reponer): borde 1.5px `#3b82f6`, texto azul 700, radio 8.
- **Peligro**: variante secundaria con texto `#e04f3a` y borde `#f6d5cf`.
- Táctil (POS): padding generoso, mínimo 44px de alto.

### Inputs
Blanco, borde `#dde3ea`, radio 10 (búsquedas: píldora 99px), padding 9px 14px, placeholder `#8794a5`.

### Tablas
Dentro de tarjeta blanca. Encabezado en mayúsculas 11px; filas con divisor `#eef1f5`, padding 11px 18px. Números alineados a la derecha; cantidades con signo (−2, +50) en 700. Fila crítica con fondo `#fdf5f4`. Pie con paginación (botones compactos, página activa azul).

### Chips de estado
Píldora 11px/700. VENTA azul · AJUSTE ámbar · ENTRADA verde · ANULACIÓN rojo · quiebre rojo · bajo ámbar · neutro gris `#f1f4f8`/`#69788c`.

### KPI cards
Tarjeta blanca radio 14, label 12px muted 600, cifra 28px 800, detalle 12px. Estado crítico: `border-top: 3px solid #e04f3a` y cifra roja.

### Modal (3 pasos)
Radio 18, encabezado con divisor y botón ✕ circular gris. Pasos numerados con label mayúscula («1 · Tipo de movimiento»). Nota de auditoría al pie en 12px muted centrado.

### Estados vacíos
Tarjeta transparente con borde punteado `#dde3ea`, ícono, mensaje en 700 y sugerencia en 13px muted. Estado vacío ≠ error.

### Permisos
Candado 🔒 junto a lo restringido. Matriz de permisos: ✓ verde / ◐ ámbar (con condición) / ✕ rojo.

## Layout
- Ancho de referencia desktop: 1240px. Contenido con padding 24px, `gap` 14–16px entre bloques.
- POS: grilla `1.2fr | 460px` (catálogo | carrito fijo a la derecha).
- Vistas maestro-detalle (Proveedores): `340px | 1fr`.
- Objetivo responsive: colapsar sidebar a iconos en tablet; POS apilado en móvil (pendiente de diseño).

## Archivos

**Publicado y accesible:**
- Design System v1.0 (agosto 2026), versión renderizada de este documento con ejemplos
  de componentes vivos: <https://claude.ai/code/artifact/88cebdeb-b155-44e1-9544-347efcd7b639>

**Referenciados pero AUSENTES del repositorio** (verificado el 2026-08-25: cero coincidencias
de `*.dc.html` en todo el árbol, `node_modules` excluido):
- `Wireframes.dc.html` — wireframes aprobados (turno 1).
- `UI Dashboard.dc.html` — exploración de 3 direcciones; **1b elegida**.
- `UI Vistas.dc.html` — las 7 vistas restantes en la dirección elegida.

Ninguno de los tres está contenido en el artifact publicado; ese artifact es la referencia
de sistema, no las pantallas compuestas. Consecuencia práctica: **no existe maqueta aprobada
de login ni de cambio de contraseña**, porque esas dos pantallas nunca aparecieron en la
exploración visual (el Design System no las menciona). El cambio `app-shell-login`
(backlog #2.1) las construye a partir de los tokens de este documento. Si los tres archivos
aparecen, bajarlos a `docs/` y actualizar esta sección.

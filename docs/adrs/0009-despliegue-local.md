# ADR 0009: Despliegue e infraestructura — local en la máquina del desarrollador

## Estado

Reemplazado por [[0010-despliegue-tiers-gratuitos]] — el hito de producto (primer ciclo de conteo
real, condición de revisión agregada 2026-08-13, ver A11 de la Ronda 2 de
`REVISION-ADVERSARIAL.md`) llegó antes de mover el proyecto fuera de `localhost`, así que la
condición de revisión que este ADR dejó escrita se resolvió con el nuevo despliegue.

## Contexto

El proyecto lo desarrolla una sola persona y, por ahora, corre exclusivamente en su propia
máquina; la decisión de subirlo a un hosting (o exponerlo a otros dispositivos) queda pendiente
y se tomará más adelante, sin fecha fija. El PRD describe un sistema multiusuario con roles y
con operación diaria "desde el navegador", pero eso no obliga a resolver hosting en v1: mientras
no haya otros dispositivos ni usuarios reales fuera del propio desarrollador, el entorno de
ejecución puede ser enteramente local.

Aun así, dos riesgos no dependen de si el proyecto se sube o no: (1) toda la persistencia vive en
un único disco, sin redundancia, y (2) la sesión con cookie ([[0007-sesion-cookie-rbac-propio]])
asume implícitamente un contexto donde `Secure`/HTTPS eventualmente aplican. Ninguna de las dos
cosas se resuelve hoy, pero conviene dejar la condición de revisión explícita para no
"olvidarlas" el día que el contexto cambie.

## Decisión

**Despliegue local:** Postgres y el backend Node corren como procesos en la máquina del
desarrollador (Postgres vía Docker/Docker Compose, para poder versionar y mover el entorno más
adelante sin reinstalar nada a mano). No hay HTTPS ni dominio: el acceso es por `localhost`.

**Backup:** un script de `pg_dump` programado (Task Scheduler / cron si se usa WSL) que vuelca la
base **a una ubicación distinta del disco principal** (carpeta sincronizada a la nube, disco
externo, o similar) con una periodicidad razonable (diaria mientras haya datos de prueba/reales
cargados).

**Condición de revisión explícita:** esta decisión es válida **solo** mientras el despliegue siga
siendo de un único desarrollador en su propia máquina. Antes de cualquiera de estos dos eventos,
hay que revisar y actualizar este ADR:

- **Acceso desde otros dispositivos en red (LAN)** — ej. otra compu o celular del encargado en el
  mismo local: revisar si la cookie de sesión necesita ajuste (`Secure` exige HTTPS; sin HTTPS en
  LAN, mantenerla sin `Secure` es una decisión consciente, no un olvido).
- **Hosting fuera de la máquina local** (nube, VPS, PaaS): en ese momento la cookie pasa a
  requerir `Secure`+`SameSite`+HTTPS/TLS (ver [[0007-sesion-cookie-rbac-propio]]), y el backup
  deja de depender de un único disco físico.
- **Hito de producto — primer ciclo de conteo real de inventario:** los criterios de éxito del
  PRD (≥ 30 % menos discrepancias en 1–2 ciclos de conteo, validar la matriz de permisos con la
  operación real, calibrar alertas con datos reales) requieren usuarios reales operando el
  sistema — algo que el despliegue de una sola máquina excluye. Antes de iniciar el primer ciclo
  de conteo real (el hito que dispara esa medición), este ADR debe revisarse aunque no haya
  ocurrido ningún evento de infraestructura: si el sistema sigue siendo `localhost`-solo en ese
  momento, los criterios de éxito son inmedibles por construcción y hay que decidir despliegue o
  redefinir los criterios.

## Alternativas consideradas

- **Instalación nativa de Postgres (sin Docker)** — evita la dependencia de Docker Desktop y es
  más directa para un desarrollador que ya tiene Postgres instalado. Se descartó como decisión
  principal porque Docker deja el entorno reproducible y portable: el día que el proyecto se mueva
  a otra máquina o a un hosting, el mismo `docker-compose` sirve de punto de partida, en vez de
  documentar a mano los pasos de instalación nativa.
- **Hosting en la nube desde v1 (PaaS tipo Railway/Render)** — resolvería HTTPS y backup
  gestionado "de fábrica" y evitaría revisar esta decisión más adelante. Se descartó por ahora
  porque el proyecto todavía no tiene definido si va a subirse; introducir un costo mensual y una
  cuenta de proveedor antes de esa definición es prematuro para el estado actual del proyecto.

## Consecuencias

- Costo cero y fricción mínima mientras el proyecto está en desarrollo/decisión de futuro: no hay
  cuenta de proveedor, dominio ni certificado que mantener.
- El entorno queda reproducible (Docker) y fácil de mover el día que se decida desplegar en otro
  lado, sin haber pagado el costo de esa infraestructura antes de necesitarla.
- **Trade-off:** sin HTTPS, el sistema no es apto para exponerse fuera de `localhost` tal como
  está configurado hoy; usarlo desde otro dispositivo en LAN sin revisar la cookie de sesión sería
  una brecha de seguridad no evaluada.
- **Trade-off:** la integridad de los datos depende enteramente de que el backup programado se
  ejecute y se guarde fuera del disco principal; no hay redundancia de infraestructura como la que
  daría un proveedor gestionado. Si el script falla en silencio, no hay alerta que lo indique — es
  responsabilidad manual del desarrollador verificarlo periódicamente.

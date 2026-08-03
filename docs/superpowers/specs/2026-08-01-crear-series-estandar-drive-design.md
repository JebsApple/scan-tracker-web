# Crear series con formato estándar, guardadas en Drive

**Fecha:** 2026-08-01
**Rama:** `feature/crear-series-estandar-drive` (scan-tracker-web) + cambios en TL2EDIT
**Estado:** aprobado por el usuario, pendiente de plan de implementación

## Contexto

`scan-tracker-web` ya tiene un modal de "nueva serie" (`src/ui/modals.js`) con cuatro
modos: manual (solo capítulos, sin hoja), vincular una Google Sheet **existente**,
pegar CSV, o subir un archivo CSV. Ninguno de los cuatro crea el spreadsheet en
Drive: el modo "vincular hoja" asume que el usuario ya armó la hoja a mano con el
formato correcto.

Se estudiaron 6 hojas reales descargadas por el usuario
(`Lucky Mia`, `Protegeré con mi vida a estas dragonas`, `Quien es esa Idol` —
multi-pestaña—, `Registro coop` —multi-pestaña—, `Teto x egen`, `cuchillo del
shaman`). En 5 de 6, el header coincide exactamente con el contrato ya
hardcodeado en `src/services/etapas-service.js` (`ETAPAS`): pares
`(quién, listo)` para Traducción, Limpieza, Typeo, Corrección y Sube. La
excepción (`dragonas`) usa otros nombres de columna pero el mismo layout
posicional, ya soportado por `detectEtapaDefs` (autodetección al vincular).

TL2EDIT ya lee `users/{uid}.series` de Firestore en modo **solo lectura**
(`src/lib/scanTrackerCatalog.ts`, integración v4.6.3 / PR #90) para poblar
`CreateSeriesModal.tsx` con las series que el usuario ya tiene en Scan Tracker.
No existe hoy ninguna vía, en ninguno de los dos repos, para crear una serie
**nueva** con su spreadsheet en Drive.

## Decisiones ya tomadas con el usuario

1. **Etapas fijas**: siempre las 5 etapas estándar (Traducción, Limpieza,
   Typeo, Corrección, Sube). Sin personalización al crear.
2. **Reimplementar por stack**: sin paquete compartido entre scan-tracker-web
   (JS vanilla) y TL2EDIT (React/TS). Cada uno tiene su propia UI; la spec es
   el contrato que ambas implementaciones deben igualar.
3. **Picker de carpeta con estética propia** en scan-tracker-web (mismo
   comportamiento que `DriveFolderPicker.tsx` de TL2EDIT, maquetado con los
   estilos ya existentes de scan-tracker-web).
4. **Construir el spreadsheet vía Sheets API** (no copiar una plantilla
   externa) — autocontenido en el repo, sin dependencia de un archivo
   externo que se pueda perder o desconfigurar. **addTable** (Tables API de
   Sheets v4, abril 2025) permite crear columnas tipadas (`DROPDOWN`,
   `CHECKBOX`, `NUMBER`) con chips de color nativos desde cero por código,
   y funciona para cualquier cuenta sin 403.

## Formato estándar (contrato compartido)

Header fijo, fila 1, igual en ambos stacks:

```
Capítulos | Prioridad | TRADUCCIÓN | LISTO | LIMPIEZA | LISTO | TYPEO | LISTO | CORRECCIÓN | LISTO | SUBE | LISTO
```

- Las 5 columnas "LISTO" son checkbox real (columna `BOOLEAN` de la Table,
  ver "Plantilla" — no texto "TRUE"/"FALSE").
- Fila 1: negrita, congelada (heredado de la plantilla).
- Filas de capítulos (1..N, N elegido al crear, mismo input que ya tiene el
  modo "manual"): `Capítulos` = número como string, `Prioridad` = `"URGENTE"`
  por defecto (mismo default que `nuevoCap()` en `etapas-service.js`), el
  resto de columnas vacío.
- Nombre del archivo en Drive = nombre de la serie tal cual lo escribe el
  usuario, sin sanitizar más allá de lo que Drive hace por su cuenta.

Este layout debe coincidir byte a byte entre ambas implementaciones para que
`detectEtapaDefs` / `csvToChapters` (ya existentes, sin cambios) reconozcan la
hoja sin fricción al leerla después.

**Nota sobre casing**: los labels arriba van en mayúsculas (`TRADUCCIÓN`,
`TYPEO`, `CORRECCIÓN`) siguiendo el placeholder del modo "paste" ya existente
(`modals.js:323`), no el Title Case de la constante `ETAPAS` en
`etapas-service.js` ("Traducción", "Typeo", "Corrección"). Es una elección de
redacción, no una incompatibilidad: `detectEtapaDefs` nunca compara contra
texto fijo, la detección es 100% posicional (par who/done por columna). Se
deja explícito acá para que no se lea como contradicción entre el contrato
documentado y el código citado como referencia.

**Plantilla** (reemplaza la construcción desde cero — decisión #4 revertida
2026-08-02): en vez de armar el formato con `batchUpdate`, el spreadsheet
nuevo se crea copiando `TEMPLATE_SPREADSHEET_ID` con `Drive.files.copy`. La
plantilla es una copia de "Lucky Mia" (serie real del usuario,
`173Tw9XhFooh5NKcJrmkEBJlL1WvkK51WyvPaSxw9BdE`) guardada como
`1uPzjSfUF8laSepIYScyyCO5E9MxmwzYke-F5UQAvaII` en el mismo Drive. Lucky Mia
ya es una **Table** de Sheets con Prioridad y las 5 columnas "quién" tipadas
`DROPDOWN` (ver decisión #4). Un solo archivo, mismo ID hardcodeado en los
dos repos (mismo Drive, misma cuenta). **La plantilla debe conservar siempre
al menos 1 fila de datos formateada** — `insertDimension` con
`inheritFromBefore` (paso 4 más abajo) hereda de la fila anterior a la
inserción; si la plantilla quedara con 0 filas de datos, heredaría del
header en vez de una fila de datos real y se perdería el tipo de columna en
las filas agregadas.

**Creación del spreadsheet — orden de pasos preciso**:
1. `POST drive/v3/files/{TEMPLATE_SPREADSHEET_ID}/copy` con
   `{ name, parents: [folderId] }` → copia directo a la carpeta elegida, sin
   paso de mover aparte.
2. `GET spreadsheets/{id}?fields=sheets(properties,tables)` → leer `sheetId`
   y `title` reales de la copia (se preservan de la plantilla, pero no
   asumirlo), y la `Table` completa (`tableId`, `range`, `columnProperties`
   con el dropdown de cada columna). La plantilla tiene una sola Table de
   datos que arranca en columna A — filtrar por
   `table.range.startColumnIndex === 0` (Lucky Mia trae además una tablita
   suelta ajena a esto, en `O5:O8`).
3. `templateRows = table.range.endRowIndex - 1` (el rango de la Table
   incluye el header).
4. `batchUpdate`:
   - Si `chapterCount < templateRows`: `deleteDimension` sobre las filas
     sobrantes.
   - Si `chapterCount > templateRows`: `insertDimension` con
     `inheritFromBefore: true` — hereda formato/tipo/chip de la fila
     anterior.
   - `updateTable` con `fields: "columnProperties,range"`: reemplaza el
     `dataValidationRule.condition.values` de las columnas C, E, G, I, K
     (los "quién" de cada etapa) por **los aliases del usuario**, o por
     `["-"]` si el usuario todavía no tiene ningún alias configurado —
     nunca se deja filtrar el nombre de otra serie. El fieldmask
     `columnProperties` reemplaza el array **completo**, así que hay que
     reenviar también las columnas que no cambian (LISTO, Prioridad,
     Capítulos) tal cual vinieron en el paso 2. También actualiza
     `range.endRowIndex` a `chapterCount + 1` para que la Table cubra
     exactamente las filas reales.
   - **No usar `setDataValidation`** en ninguna columna de la Table — la API
     lo bloquea con 400 ("No se permite esta operación en celdas de columnas
     con tipo especificado") una vez que la celda pertenece a una columna
     tipada.
5. Escribir valores en el rango `'{title}'!A1:L{N+1}` (header + capítulos
   reales, pisa lo que haya traído la plantilla en esas celdas). Esto sigue
   siendo un `values.update` normal — no está restringido por la Table.

Ambas implementaciones (scan-tracker-web y TL2EDIT) deben seguir esta
secuencia exacta para no divergir en un detalle que solo aparece al integrar.

**Comportamiento distinto al legacy `setDataValidation`**: `TableColumnDataValidationRule`
no tiene campo `strict` — no se puede replicar el "dropdown editable, se
puede escribir cualquier nombre" que tenía el diseño original con
`setDataValidation`. El comportamiento real de un dropdown `DROPDOWN` de
Table frente a un valor fuera de la lista no está verificado contra Drive
real; falta confirmarlo en el checklist manual.

**Formato heredado de la plantilla** (ya no se arma por código): tabla con
banding + filtros, checkboxes reales en las columnas LISTO, dropdown de
Prioridad con 4 valores (`URGENTE`, `MODERADO`, `A TU TIEMPO`, `LISTO`) con
chip coloreado, columnas "quién" también con chip (columna `DROPDOWN`), fila
1 en negrita y congelada — todo viene con la copia de la Table, nada se
arma con `batchUpdate` desde cero.

**Apodo principal, no todos los alias** (agregado 2026-08-02, tras la
primera prueba real: precargar los ~7 alias de "Mis nombres" en cada columna
quién ensuciaba la hoja con nombres del usuario en todas las etapas). El
`names` que alimenta el dropdown de las columnas quién ya **no** es
`S.aliases` completo — es un único "apodo principal" que el usuario marca
con ★ en el modal "Mis nombres" (`modalAliases`, scan-tracker-web). Se
obtiene: en scan-tracker-web de `S.primaryAlias` (estado local, sincronizado
con `users/{uid}.primaryAlias` — mismo mecanismo push/pull que `aliases`,
adopta el remoto solo si el local está vacío); en TL2EDIT de
`getMyScanTrackerPrimaryAlias(uid)` tras `signInScanTrackerWithGoogle`. Si
el usuario no marcó ninguno, `names` queda vacío y la columna se precarga
con el placeholder `["-"]` (ver "Creación del spreadsheet" paso 4). El resto
de los nombres del equipo los agrega el propio usuario escribiéndolos en la
hoja a medida que hacen falta — `getMyScanTrackerAliases(uid)` (todos los
alias) sigue existiendo y se usa en otro lado (`useMyScanTrackerAliases` en
TL2EDIT, para detectar "cuál etapa es mía" al marcar progreso), pero ya no
alimenta la creación de series.

El contrato de **lectura** no cambia: `detectEtapaDefs`/`csvToChapters` leen
valores de celda, no la validación — los dropdowns y el banding no afectan
la detección posicional del header.

## scan-tracker-web (JS vanilla)

**Scopes OAuth** (`src/repositories/auth.js`): agregar
`https://www.googleapis.com/auth/drive.readonly` y
`https://www.googleapis.com/auth/drive.file` a la constante `SCOPES` existente
(hoy tiene `spreadsheets`, `userinfo.email`, `drive.metadata.readonly` y
`drive.appdata` — insuficiente para navegar carpetas reales y crear
archivos, aunque no está vacía como decía una versión anterior de esta spec).
Son scopes sensibles: los testers existentes (`TESTER_EMAILS` en
`firebase-config.js`) van a necesitar re-aceptar el consentimiento la próxima
vez que hagan login en el flujo **web**. Documentar esto en el `README.md`
del repo (no existe `CHANGELOG.md` en scan-tracker-web).

**Mobile (Android/Capacitor) queda fuera de alcance en esta rama.**
`src/repositories/auth-native.js` tiene su propia constante `SCOPES`,
independiente de `auth.js` (usa el flujo nativo de Credential Manager, no
GIS). No se toca en esta rama — la 5ª opción del modal ("crear en Drive") no
está disponible cuando la app corre embebida en Capacitor, o simplemente no
se valida ahí todavía. Si más adelante se quiere mobile, es un cambio
separado en `auth-native.js` con su propio re-consentimiento.

**Nuevo módulo `src/repositories/drive-sheets-create.js`**:
- `createSeriesSheet({ name, folderId, chapterCount })` → `Promise<{ id, url }>`.
  1. `POST https://sheets.googleapis.com/v4/spreadsheets` con
     `properties.title = name` para crear el spreadsheet vacío.
  2. `PUT .../values/A1:L{N+1}?valueInputOption=RAW` para escribir el header
     + las `chapterCount` filas de capítulos.
  3. `POST .../batchUpdate` con `setDataValidation` (tipo `BOOLEAN`) sobre las
     columnas D, F, H, J, L (las 5 "LISTO"), filas 2..N+1.
  4. `PATCH https://www.googleapis.com/drive/v3/files/{id}?addParents={folderId}&removeParents=root`
     para mover el archivo recién creado a la carpeta elegida.
  - `authedFetch` en `src/repositories/sheets-api.js:19` hoy es una función
    interna, no exportada. Se exporta (`export async function authedFetch`)
    para que `drive-sheets-create.js` la reuse en vez de duplicarla — toque
    de una línea en `sheets-api.js`, sin cambiar su comportamiento.

**Nuevo componente `src/ui/drive-folder-picker.js`**:
- Mismo comportamiento que `DriveFolderPicker.tsx` de TL2EDIT: navegar Mi
  unidad / Compartido conmigo, breadcrumbs, recordar última carpeta usada en
  `localStorage` (clave propia, ej. `scantracker-drive-create-last-folder`),
  botón "Crear aquí".
- Maquetado con las clases `.modal` ya existentes en `styles/components.css:73`
  y las variables de `styles/tokens.css` — no existe un `styles/modals.css`
  separado (el repo solo tiene `auth.css`, `base.css`, `components.css`,
  `tokens.css`). No se clonan clases de TL2EDIT.
- Listado de subcarpetas: `GET /drive/v3/files?q=mimeType='application/vnd.google-apps.folder' and '{parentId}' in parents`.

**Modal existente (`src/ui/modals.js`)**: agregar una 5ª fuente
(`src.value === "drive"`) junto a manual/gsheet/paste/file:
1. Abre `drive-folder-picker.js`.
2. Pide cantidad de capítulos inicial (mismo input que ya usa el modo
   "manual", `#snN`). El contenedor `#snNF` hoy solo se muestra con
   `src.value === "manual"` (`modals.js:330`); hay que sumar
   `|| src.value === "drive"` a esa condición para que el modo nuevo también
   lo muestre.
3. Al confirmar: llama `createSeriesSheet({ name, folderId, chapterCount,
   names: S.aliases })` (los aliases alimentan los dropdowns editables de las
   columnas quién — ver "Acabado visual"), setea `sr.sheetUrl` con la
   URL devuelta, y sigue el mismo camino que ya sigue el modo `gsheet`
   (`fetchSheet(sr)` → `checkDesignations(sr)` → luego `pushUserData()` si
   `sr.sheetUrl`).
4. Antes de crear: valida que no exista ya un `sheetUrl` repetido en
   `S.series` (mismo patrón que `app.js:55`, `localUrls`), aunque el caso es
   improbable porque el archivo se crea nuevo en cada llamada.

## TL2EDIT (React/TS)

**Reusa sin cambios de componente**: `src/components/DriveFolderPicker.tsx`
(ya tiene los scopes `drive.file` + `drive.readonly` vía
`src/hooks/useGoogleAuth.ts`) y el puente de sesión Firebase ya existente
(`signInScanTrackerWithGoogle` en `src/lib/scanTrackerCatalog.ts`).

El picker está diseñado para el flujo de **exportar** (pide un nombre de
archivo destino), no es un drop-in 100% silencioso para crear series:
- Acepta `initialFileName` (`DriveFolderPicker.tsx:53`, input en la línea
  171) — pasándole `initialFileName={seriesName}` cubre el caso de creación
  sin tocar el componente. El nombre de la serie queda confirmado dos veces
  (una en el paso 1 del modal, otra al abrir el picker), aceptable.
- El título "Guardar en Google Drive" y el botón "Carpeta de exports"
  (`ensureExportsFolder`, línea 108) están pensados para exports y quedan
  semánticamente raros en el flujo de crear una serie nueva. No son
  bloqueantes — si molestan en la revisión visual, la alternativa es una prop
  opcional para ocultar ese botón, lo cual sí sería un cambio al componente
  (dejar la decisión para cuando se vea corriendo).

**`createScanTrackerSeries` en `src/lib/scanTrackerSheet.ts`** (no es un
módulo aparte — vive junto al resto de las funciones de lectura/escritura de
la hoja):
- `createScanTrackerSeries({ name, folderId, chapterCount, accessToken, names }): Promise<{ id: string; url: string }>`
  — misma secuencia de pasos que `drive-sheets-create.js` en scan-tracker-web
  (ver "Creación del spreadsheet — orden de pasos preciso" más arriba), en
  TypeScript, con `fetch` propio siguiendo el estilo del resto del archivo.

**Nueva función de escritura en `src/lib/scanTrackerCatalog.ts`** (hoy es
100% lectura):
- `addSeriesToScanTrackerProfile(uid: string, series: ScanTrackerUserSeries): Promise<void>`
  — `setDoc(doc(db, 'users', uid), { series: arrayUnion(series) }, { merge: true })`.
  **No usar `updateDoc`**: lanza "document does not exist" si el usuario nunca
  inició sesión en scan-tracker-web (el doc `users/{uid}` lo crea recién
  `pushFirestoreState`/`saveFS` al guardar la primera serie/alias desde la
  web) — un tester que empiece por TL2EDIT no tendría ese doc todavía.
  `setDoc` con `merge: true` funciona en ambos casos. Permitido por
  `firestore.rules` (`request.auth.uid == userId`) gracias a la sesión ya
  puenteada con `signInScanTrackerWithGoogle`.

**`src/components/CreateSeriesModal.tsx`**: agregar una tercera opción junto a
"manual" y "desde tu perfil de Scan Tracker": **"Crear serie nueva en Scan
Tracker"**:
1. Pide nombre + cantidad de capítulos.
2. Abre `DriveFolderPicker`.
3. Llama `createScanTrackerSeries(...)` pasándole los aliases obtenidos con
   `getMyScanTrackerAliases(uid)` tras el signIn (alimentan los dropdowns
   editables de las columnas quién — ver "Acabado visual"), luego
   `addSeriesToScanTrackerProfile(uid, { name, sheetUrl })`.
4. Termina llamando al mismo callback `onCreateFromScanTracker({ seriesName,
   sheetUrl })` que ya usa el flujo existente — sin tocar el contrato hacia
   `App.tsx`.

**No es tiempo real**: `onUserData` existe en `src/repositories/user-data.js`
pero hoy no lo importa nadie — el único pull de Firestore en scan-tracker-web
es `loadUserData` dentro de `onAuthChange` (`app.js:52`), que corre una sola
vez al iniciar sesión. Una serie creada desde TL2EDIT queda escrita en
`users/{uid}.series`, pero si scan-tracker-web ya estaba abierto en ese
momento **no la va a mostrar hasta el próximo login o reload**. Conectar
`onUserData` para que sea reactivo es un cambio al modelo de sync general de
la app (qué pasa si llega un update remoto mientras el usuario edita algo
local) y queda fuera de alcance de esta rama — ver "Fuera de alcance".

## Manejo de errores

Aplica a ambas implementaciones:

- **403 por falta de scope/consentimiento** (tester viejo que no re-aceptó):
  mensaje explícito ("Necesitás volver a autorizar Google Drive") + disparar
  re-login, no un error genérico de red. En scan-tracker-web esto requiere un
  cambio puntual en `auth.js`: `getAccessToken()` cachea `currentToken` y solo
  lo renueva por expiración de tiempo (`auth.js:91-102`), nunca por scope
  insuficiente — un token vivo pero corto de permisos no se invalida solo.
  Hace falta exportar algo como `invalidateToken()` (pone `currentToken =
  null`) y que el handler del 403 la llame antes de pedir `requestToken()` de
  nuevo, para forzar la pantalla de consentimiento en vez de reintentar con el
  mismo token insuficiente.
- **Nombre de serie duplicado**: Drive lo permite (no es error de la API);
  scan-tracker-web valida contra `sheetUrl` duplicado en `S.series` antes de
  guardar (ver arriba). TL2EDIT no necesita esta validación porque
  `sheetUrl` es único por diseño (se genera nuevo en cada creación).
- **Falla a mitad de camino** (spreadsheet creado pero falla `addParents` o el
  registro en Firestore/`pushUserData`): **no hay rollback automático** (no se
  borra el archivo creado). Se muestra un toast/error con el link al
  spreadsheet huérfano y un mensaje indicando que quedó creado pero no
  vinculado, para que el usuario decida qué hacer. Se prefiere esto a un
  rollback que podría borrar algo que el usuario ya empezó a editar a mano.
- **Carpeta sin permiso de escritura** (ej. una carpeta de "Compartido
  conmigo" de solo lectura): la API devuelve 403 en `addParents`; mismo
  tratamiento que el caso de scope, con mensaje indicando que no hay permiso
  de escritura en esa carpeta puntual.

## Testing

- **scan-tracker-web**: sin suite de tests (`npm test` es un placeholder hoy).
  Se deja cubierto por un checklist de pruebas manuales que el usuario
  ejecuta él mismo (consistente con la preferencia ya registrada de no armar
  smoke tests de Playwright por cuenta propia).
- **TL2EDIT**: tiene Vitest + Testing Library. Se agregan:
  - Unit tests de `scanTrackerSheetCreate.ts` mockeando `fetch`.
  - Unit tests de `addSeriesToScanTrackerProfile` mockeando Firestore.
  - Test de componente para la nueva opción en `CreateSeriesModal.tsx`.
  - Sin Playwright nuevo — se deja un checklist manual para probar el flujo
    real contra Drive/Firestore (no mockeable de forma útil).

**Checklist manual (ambos repos, contra Drive/Firestore reales)**:
- Tester existente re-logueado tras el cambio de scopes ve la pantalla de
  consentimiento de Google (no queda pegado con el token viejo insuficiente).
- Crear serie eligiendo una carpeta anidada (no la raíz) y confirmar que el
  archivo aparece ahí, no en "Mi unidad".
- Crear serie desde TL2EDIT con una cuenta que nunca abrió scan-tracker-web
  (sin doc `users/{uid}` previo) — confirmar que `setDoc({merge:true})` no
  falla.
- Abrir la hoja creada y confirmar que las columnas "LISTO" son checkboxes
  clicables, no texto.
- Confirmar el formato de tabla heredado de la plantilla: bandas de filas,
  header destacado y botones de filtro en la fila 1.
- Confirmar que la columna Prioridad tiene dropdown editable (las 4 opciones,
  y se puede escribir otra) y que cada valor se ve como chip coloreado
  (URGENTE rojo, MODERADO ámbar, A TU TIEMPO gris, LISTO verde).
- **Punto crítico a verificar** (riesgo abierto sin confirmar, ver sección
  "Plantilla"): las columnas quién (C/E/G/I/K) tienen dropdown editable con
  los aliases del usuario como opciones (o `"-"` sin aliases), se puede
  escribir un nombre que no esté en la lista (`strict: false`), **y siguen
  mostrando chip coloreado después de que el código reemplazó la lista de la
  plantilla** — si el chip se pierde acá, hay que revisar la mitigación en
  "Plantilla".
- Confirmar que las filas de más allá de `chapterCount` (las que traía la
  plantilla) se borraron, y que si `chapterCount` es mayor a lo que trae la
  plantilla, las filas nuevas también tienen checkbox/dropdown/chip (no
  quedan en blanco sin formato).
- Vincular manualmente (modo "gsheet" existente) una hoja recién creada por
  este flujo y confirmar que `detectEtapaDefs` la reconoce sin ajustes.
- Elegir una carpeta de "Compartido conmigo" sin permiso de escritura y
  confirmar el mensaje de error (no un fallo silencioso).

## Fuera de alcance

- Mantenimiento de la plantilla maestra (`TEMPLATE_SPREADSHEET_ID`): si se
  necesita cambiar el header, agregar una etapa o limpiar los nombres que
  trae por defecto, es edición manual directa sobre ese archivo en Drive —
  no hay script ni comando que la regenere.
- Personalización de etapas al crear (nombres/cantidad distintos a los 5
  estándar).
- Paquete npm compartido entre los dos repos.
- Migración retroactiva de series ya creadas a mano al nuevo formato.
- Rollback automático de spreadsheets huérfanos ante fallas parciales.
- Mobile/Android (`auth-native.js`) — la 5ª opción de creación no está
  disponible corriendo en Capacitor en esta rama.
- Sync en tiempo real de `users/{uid}.series` en scan-tracker-web (conectar
  `onUserData`) — una serie creada desde TL2EDIT aparece recién en el
  próximo login/reload de scan-tracker-web, no al instante.

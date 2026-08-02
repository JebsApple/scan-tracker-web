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
   externa) — autocontenido en el repo, sin dependencia de un archivo externo
   que se pueda perder o desconfigurar.

## Formato estándar (contrato compartido)

Header fijo, fila 1, igual en ambos stacks:

```
Capítulos | Prioridad | TRADUCCIÓN | LISTO | LIMPIEZA | LISTO | TYPEO | LISTO | CORRECCIÓN | LISTO | SUBE | LISTO
```

- Las 5 columnas "LISTO" llevan `setDataValidation` tipo `BOOLEAN` (checkbox
  real, igual que en las hojas reales del usuario — no texto "TRUE"/"FALSE").
- Fila 1: negrita, congelada (`frozenRowCount: 1`).
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

**Creación del spreadsheet — orden de pasos preciso**: el `POST
spreadsheets` devuelve la pestaña por defecto con su `title` real (típicamente
`"Sheet1"`) y su `sheetId` (típicamente `0`, pero no asumirlo). Los pasos 2 y
3 dependen de esa respuesta:
1. `POST .../spreadsheets` con `properties.title = name` → leer
   `response.sheets[0].properties.sheetId` y `.title`.
2. Escribir valores en el rango `'{title}'!A1:L{N+1}` (usar el `title` real,
   no un literal `"Sheet1"`).
3. `batchUpdate` con `setDataValidation` y `updateSheetProperties`
   (`frozenRowCount: 1`) usando el `sheetId` numérico obtenido en el paso 1,
   no el título.
4. Mover a la carpeta elegida (`addParents`/`removeParents`).

Ambas implementaciones (scan-tracker-web y TL2EDIT) deben seguir esta
secuencia exacta para no divergir en un detalle que solo aparece al integrar.

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
3. Al confirmar: llama `createSeriesSheet(...)`, setea `sr.sheetUrl` con la
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

**Nuevo módulo `src/lib/scanTrackerSheetCreate.ts`**:
- `createScanTrackerSeries({ name, folderId, chapterCount, accessToken }): Promise<{ id: string; url: string }>`
  — misma secuencia de 4 pasos que `drive-sheets-create.js` en scan-tracker-web
  (crear spreadsheet → escribir valores → checkboxes → mover a carpeta), en
  TypeScript, con `fetch` propio siguiendo el estilo de `scanTrackerSheet.ts`.

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
3. Llama `createScanTrackerSeries(...)`, luego
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
- Vincular manualmente (modo "gsheet" existente) una hoja recién creada por
  este flujo y confirmar que `detectEtapaDefs` la reconoce sin ajustes.
- Elegir una carpeta de "Compartido conmigo" sin permiso de escritura y
  confirmar el mensaje de error (no un fallo silencioso).

## Fuera de alcance

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

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

## scan-tracker-web (JS vanilla)

**Scopes OAuth** (`src/repositories/auth.js`): agregar
`https://www.googleapis.com/auth/drive.readonly` y
`https://www.googleapis.com/auth/drive.file` a la constante `SCOPES` (hoy solo
tiene `drive.metadata.readonly`, insuficiente para navegar carpetas reales y
crear archivos). Son scopes sensibles: los testers existentes
(`TESTER_EMAILS` en `firebase-config.js`) van a necesitar re-aceptar el
consentimiento la próxima vez que hagan login. Documentar esto en el
changelog de la rama.

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
  - Reusa el patrón `authedFetch` ya existente en `src/repositories/sheets-api.js`
    (mismo `getAccessToken()` de `auth-facade.js`).

**Nuevo componente `src/ui/drive-folder-picker.js`**:
- Mismo comportamiento que `DriveFolderPicker.tsx` de TL2EDIT: navegar Mi
  unidad / Compartido conmigo, breadcrumbs, recordar última carpeta usada en
  `localStorage` (clave propia, ej. `scantracker-drive-create-last-folder`),
  botón "Crear aquí".
- Maquetado con `styles/modals.css` y `styles/tokens.css` existentes — no se
  clonan clases de TL2EDIT.
- Listado de subcarpetas: `GET /drive/v3/files?q=mimeType='application/vnd.google-apps.folder' and '{parentId}' in parents`.

**Modal existente (`src/ui/modals.js`)**: agregar una 5ª fuente
(`src.value === "drive"`) junto a manual/gsheet/paste/file:
1. Abre `drive-folder-picker.js`.
2. Pide cantidad de capítulos inicial (mismo input que ya usa el modo
   "manual", `#snN`).
3. Al confirmar: llama `createSeriesSheet(...)`, setea `sr.sheetUrl` con la
   URL devuelta, y sigue el mismo camino que ya sigue el modo `gsheet`
   (`fetchSheet(sr)` → `checkDesignations(sr)` → luego `pushUserData()` si
   `sr.sheetUrl`).
4. Antes de crear: valida que no exista ya un `sheetUrl` repetido en
   `S.series` (mismo patrón que `app.js:57`, `localUrls`), aunque el caso es
   improbable porque el archivo se crea nuevo en cada llamada.

## TL2EDIT (React/TS)

**Reusa sin cambios**: `src/components/DriveFolderPicker.tsx` (ya tiene los
scopes `drive.file` + `drive.readonly` vía `useGoogleAuth.ts`) y el puente de
sesión Firebase ya existente (`signInScanTrackerWithGoogle` en
`src/lib/scanTrackerCatalog.ts`).

**Nuevo módulo `src/lib/scanTrackerSheetCreate.ts`**:
- `createScanTrackerSeries({ name, folderId, chapterCount, accessToken }): Promise<{ id: string; url: string }>`
  — misma secuencia de 4 pasos que `drive-sheets-create.js` en scan-tracker-web
  (crear spreadsheet → escribir valores → checkboxes → mover a carpeta), en
  TypeScript, con `fetch` propio siguiendo el estilo de `scanTrackerSheet.ts`.

**Nueva función de escritura en `src/lib/scanTrackerCatalog.ts`** (hoy es
100% lectura):
- `addSeriesToScanTrackerProfile(uid: string, series: ScanTrackerUserSeries): Promise<void>`
  — `updateDoc(doc(db, 'users', uid), { series: arrayUnion(series) })`.
  Permitido por `firestore.rules` (`request.auth.uid == userId`) gracias a la
  sesión ya puenteada con `signInScanTrackerWithGoogle`.

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

**Efecto colateral esperado**: al escribir en `users/{uid}.series`, la serie
aparece automáticamente en scan-tracker-web sin sync adicional, porque ese
doc ya se escucha en tiempo real ahí (`onUserData` en
`src/repositories/user-data.js`).

## Manejo de errores

Aplica a ambas implementaciones:

- **403 por falta de scope/consentimiento** (tester viejo que no re-aceptó):
  mensaje explícito ("Necesitás volver a autorizar Google Drive") + disparar
  re-login, no un error genérico de red.
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

## Fuera de alcance

- Personalización de etapas al crear (nombres/cantidad distintos a los 5
  estándar).
- Paquete npm compartido entre los dos repos.
- Migración retroactiva de series ya creadas a mano al nuevo formato.
- Rollback automático de spreadsheets huérfanos ante fallas parciales.

# Crear series con formato estándar en Drive — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir crear una serie nueva con su spreadsheet real en Google Drive (formato estándar, checkboxes reales), desde scan-tracker-web y desde TL2EDIT, en vez de exigir que el usuario arme la hoja a mano antes de vincularla.

**Architecture:** Cada repo construye el spreadsheet vía llamadas directas a la API de Sheets (crear → escribir valores → checkboxes/formato → mover a carpeta vía Drive API), sin paquete compartido. scan-tracker-web gana un picker de carpeta propio (overlay vanilla JS); TL2EDIT reutiliza su `DriveFolderPicker.tsx` ya existente. La serie creada se registra en `users/{uid}.series` de Firestore, mismo documento que ya usan ambos repos.

**Tech Stack:** scan-tracker-web: JS vanilla, módulos ES, sin bundler, `fetch` nativo. TL2EDIT: React + TypeScript, Vitest + Testing Library, Firebase (`firebase/app`, `firebase/auth`, `firebase/firestore`).

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-08-01-crear-series-estandar-drive-design.md` (scan-tracker-web). Toda decisión de esta plan debe ser consistente con ella; si algo diverge, la spec manda.
- Header fijo, idéntico en ambos repos: `Capítulos | Prioridad | TRADUCCIÓN | LISTO | LIMPIEZA | LISTO | TYPEO | LISTO | CORRECCIÓN | LISTO | SUBE | LISTO` (mayúsculas, ver nota de casing en la spec).
- Columnas "LISTO" = índices 0-based `3, 5, 7, 9, 11` (D, F, H, J, L) — llevan `setDataValidation` tipo `BOOLEAN`.
- Orden de creación del spreadsheet, fijo en ambos repos: (1) `POST spreadsheets` → leer `sheetId`/`title` reales de la respuesta, (2) escribir valores con ese `title`, (3) `batchUpdate` (negrita fila 1 + frozenRowCount + checkboxes) con ese `sheetId`, (4) mover a la carpeta con Drive API.
- Mobile (Android/Capacitor, `auth-native.js`) queda **fuera de alcance** — no se toca.
- Sin rollback automático ante fallas parciales — el spreadsheet huérfano se deja con su link visible en el error.
- `setDoc(..., { merge: true })`, nunca `updateDoc`, al escribir `users/{uid}.series` desde TL2EDIT (el doc puede no existir todavía).
- scan-tracker-web no tiene suite de tests (`npm test` es un placeholder) — sus tareas se verifican con smoke manual (Node donde aplique, browser para UI), no TDD automatizado. TL2EDIT sí tiene Vitest — sus tareas siguen TDD real.

---

## File Structure

**scan-tracker-web** (repo actual, rama `feature/crear-series-estandar-drive`):

- Modify: `src/repositories/sheets-api.js` — exportar `authedFetch` (hoy interna).
- Modify: `src/repositories/auth.js` — agregar scopes `drive.readonly`/`drive.file` + `invalidateToken()`.
- Modify: `src/repositories/auth-facade.js` — exponer `invalidateToken`.
- Modify: `src/repositories/drive-api.js` — factorizar `driveFetch` interno + agregar `listDriveFolders(parentId)` y `listSharedFolders()`.
- Create: `src/repositories/drive-sheets-create.js` — `createSeriesSheet({name, folderId, chapterCount})`.
- Create: `src/ui/drive-folder-picker.js` — `openDriveFolderPicker({onPick, onCancel})`.
- Modify: `src/ui/modals.js` — 5ª fuente "drive" en `modalSerie()`.
- Modify: `styles/components.css` — estilos del overlay del folder-picker.
- Modify: `README.md` — nota sobre el nuevo scope y el re-consentimiento.

**TL2EDIT** (`~/proyectos/TL2EDIT`, rama propia — ver Task 8):

- Modify: `src/lib/scanTrackerCatalog.ts` — agregar `addSeriesToScanTrackerProfile(uid, series)`.
- Modify: `src/lib/scanTrackerCatalog.test.ts` — tests de la función nueva.
- Modify: `src/lib/scanTrackerSheet.ts` — agregar `createScanTrackerSeries(...)` (mismo archivo que ya posee el contrato de columnas `COLW`/`ETAPAS_DEFAULT`).
- Modify: `src/lib/scanTrackerSheet.test.ts` — tests de la función nueva.
- Modify: `src/components/CreateSeriesModal.tsx` — 3ª opción "Crear serie nueva en Scan Tracker" + `DriveFolderPicker`.
- Modify: `src/components/CreateSeriesModal.test.tsx` — tests de la opción nueva.

---

## PARTE A — scan-tracker-web

### Task 1: Exportar `authedFetch` y agregar `invalidateToken`

**Files:**
- Modify: `src/repositories/sheets-api.js:19`
- Modify: `src/repositories/auth.js`
- Modify: `src/repositories/auth-facade.js`

**Interfaces:**
- Produces: `authedFetch(url, options?) => Promise<any>` (JSON ya parseado, lanza `Error` con `.status` en HTTP no-2xx) desde `sheets-api.js`.
- Produces: `invalidateToken() => void` desde `auth.js` y `auth-facade.js`.

- [ ] **Step 1: Exportar `authedFetch`**

En `src/repositories/sheets-api.js:19`, cambiar:

```js
async function authedFetch(url, options = {}) {
```

por:

```js
export async function authedFetch(url, options = {}) {
```

- [ ] **Step 2: Agregar los scopes nuevos en `auth.js`**

En `src/repositories/auth.js:19-20`, reemplazar la constante `SCOPES`:

```js
const SCOPES =
  "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/drive.appdata";
```

por:

```js
const SCOPES =
  "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file";
```

Y actualizar el comentario de las líneas 11-18 agregando una nota:

```js
// drive.readonly + drive.file: agregados para "crear serie nueva en Drive"
// (navegar carpetas reales y crear el spreadsheet ahí) — ver
// docs/superpowers/specs/2026-08-01-crear-series-estandar-drive-design.md.
// Sensibles igual que los de arriba: testers existentes deben re-aceptar el
// consentimiento la próxima vez que hagan login.
```

- [ ] **Step 3: Agregar `invalidateToken` en `auth.js`**

Después de la función `getAccessToken` (línea 102 en adelante), agregar:

```js
/** Fuerza que la próxima llamada a getAccessToken() pida un token nuevo en
 * vez de reusar el cacheado — necesario cuando un 403 indica que el token
 * vivo no tiene el scope requerido (getAccessToken solo revalida por
 * expiración de tiempo, nunca por scope). */
export function invalidateToken() {
  currentToken = null;
}
```

- [ ] **Step 4: Exponer `invalidateToken` en la fachada**

En `src/repositories/auth-facade.js`, agregar tras la línea 15 (`getAccessToken`):

```js
export const invalidateToken = () => impl().invalidateToken?.();
```

(`?.()` porque `auth-native.js` no la implementa — mobile queda fuera de alcance, ver Global Constraints.)

- [ ] **Step 5: Smoke manual**

No hay test runner en este repo. Verificar a mano:

```bash
cd ~/proyectos/scan-tracker-web && node -e "
import('./src/repositories/sheets-api.js').then(m => {
  console.log('authedFetch exportado:', typeof m.authedFetch === 'function');
});
"
```

Esperado: `authedFetch exportado: true`. (Fallará por `import` de `auth-facade.js` intentando acceder a `window` — es esperable en Node fuera del browser; si tira `ReferenceError: window is not defined`, es aceptable, la corrida real es siempre en browser. Si tira otro error de sintaxis, hay un problema en el archivo.)

- [ ] **Step 6: Commit**

```bash
cd ~/proyectos/scan-tracker-web
git add src/repositories/sheets-api.js src/repositories/auth.js src/repositories/auth-facade.js
git commit -m "feat: exportar authedFetch, sumar scopes de Drive e invalidateToken"
```

---

### Task 2: Factorizar `driveFetch` y agregar listado de carpetas en `drive-api.js`

**Files:**
- Modify: `src/repositories/drive-api.js`

**Interfaces:**
- Consumes: `getAccessToken()` de `./auth-facade.js` (ya existente).
- Produces: `listDriveFolders(parentId: string) => Promise<{id,name}[]>`, `listSharedFolders() => Promise<{id,name}[]>`.

- [ ] **Step 1: Reescribir el archivo completo**

Reemplazar todo `src/repositories/drive-api.js` por:

```js
// Google Drive API v3 — listar spreadsheets en "Compartidos conmigo" (para
// vincular una hoja existente) y carpetas (para elegir dónde crear una serie
// nueva). Nunca lee contenido de archivos — eso sigue yendo por Sheets API
// (sheets-api.js).

import { getAccessToken } from "./auth-facade.js";

const BASE = "https://www.googleapis.com/drive/v3/files";

async function driveFetch(url) {
  const token = await getAccessToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Drive API HTTP ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data.files || [];
}

/** Devuelve [{id, name}] de spreadsheets compartidos con la cuenta conectada,
 * más recientes primero. Requiere el scope drive.metadata.readonly. */
export async function listSharedSheets() {
  const q = encodeURIComponent(
    "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
  );
  return driveFetch(`${BASE}?q=${q}&fields=files(id,name)&orderBy=modifiedTime desc&pageSize=100`);
}

/** Devuelve [{id, name}] de subcarpetas directas de `parentId` (usar "root"
 * para la raíz de Mi unidad). Requiere el scope drive.readonly. */
export async function listDriveFolders(parentId) {
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and trashed=false and '${parentId}' in parents`,
  );
  return driveFetch(`${BASE}?q=${q}&fields=files(id,name)&orderBy=name&pageSize=200`);
}

/** Devuelve [{id, name}] de carpetas raíz visibles en "Compartido conmigo".
 * Requiere el scope drive.readonly. */
export async function listSharedFolders() {
  const q = encodeURIComponent(
    "mimeType='application/vnd.google-apps.folder' and trashed=false and sharedWithMe=true",
  );
  return driveFetch(`${BASE}?q=${q}&fields=files(id,name)&orderBy=name&pageSize=200`);
}
```

- [ ] **Step 2: Verificar que nada más importaba `listSharedSheets` con otra firma**

```bash
cd ~/proyectos/scan-tracker-web && grep -rn "listSharedSheets" src/
```

Esperado: solo `drive-api.js` (definición) y `modals.js` (uso existente, sin cambios de firma — sigue sin argumentos y devolviendo el mismo array).

- [ ] **Step 3: Commit**

```bash
git add src/repositories/drive-api.js
git commit -m "feat: listar carpetas de Drive (Mi unidad y Compartido conmigo)"
```

---

### Task 3: Módulo `drive-sheets-create.js`

**Files:**
- Create: `src/repositories/drive-sheets-create.js`

**Interfaces:**
- Consumes: `authedFetch(url, options?)` de `./sheets-api.js` (Task 1).
- Produces: `createSeriesSheet({name, folderId, chapterCount}) => Promise<{id: string, url: string}>`.

- [ ] **Step 1: Crear el archivo**

```js
// src/repositories/drive-sheets-create.js
// Crea un spreadsheet nuevo con el formato estándar de Scan Tracker y lo
// mueve a la carpeta de Drive elegida por el usuario. Ver
// docs/superpowers/specs/2026-08-01-crear-series-estandar-drive-design.md
// para el contrato de columnas y el orden de pasos (debe coincidir con
// TL2EDIT: src/lib/scanTrackerSheet.ts, createScanTrackerSeries).
import { authedFetch } from "./sheets-api.js";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3/files";

const HEADER = [
  "Capítulos", "Prioridad",
  "TRADUCCIÓN", "LISTO",
  "LIMPIEZA", "LISTO",
  "TYPEO", "LISTO",
  "CORRECCIÓN", "LISTO",
  "SUBE", "LISTO",
];

// Índices 0-based de las columnas "LISTO" (D,F,H,J,L) — llevan checkbox real.
const LISTO_COLUMNS = [3, 5, 7, 9, 11];

function chapterRow(num) {
  return [String(num), "URGENTE", "", "", "", "", "", "", "", "", "", ""];
}

/** Crea el spreadsheet nuevo (checkboxes reales en las columnas LISTO, fila 1
 * en negrita y congelada), escribe `chapterCount` filas de capítulos, y lo
 * mueve a `folderId`. Devuelve {id, url}. */
export async function createSeriesSheet({ name, folderId, chapterCount }) {
  // 1. Crear el spreadsheet vacío — la pestaña por defecto trae su propio
  //    sheetId/title reales, no asumir "Sheet1"/0.
  const created = await authedFetch(SHEETS_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { title: name } }),
  });
  const spreadsheetId = created.spreadsheetId;
  const { sheetId, title } = created.sheets[0].properties;

  // 2. Escribir header + filas de capítulos.
  const rows = [HEADER, ...Array.from({ length: chapterCount }, (_, i) => chapterRow(i + 1))];
  const range = `'${title.replace(/'/g, "''")}'!A1:L${rows.length}`;
  await authedFetch(
    `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: rows }),
    },
  );

  // 3. Formato: negrita + fila congelada + checkboxes reales.
  await authedFetch(`${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat.textFormat.bold",
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount",
          },
        },
        ...LISTO_COLUMNS.map((col) => ({
          setDataValidation: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex: rows.length,
              startColumnIndex: col,
              endColumnIndex: col + 1,
            },
            rule: { condition: { type: "BOOLEAN" }, strict: true },
          },
        })),
      ],
    }),
  });

  // 4. Mover a la carpeta elegida.
  await authedFetch(
    `${DRIVE_BASE}/${spreadsheetId}?addParents=${encodeURIComponent(folderId)}&removeParents=root`,
    { method: "PATCH" },
  );

  return {
    id: spreadsheetId,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`,
  };
}

export { HEADER, LISTO_COLUMNS };
```

- [ ] **Step 2: Smoke manual — verificar el shape del header**

```bash
cd ~/proyectos/scan-tracker-web && node --input-type=module -e "
import { HEADER, LISTO_COLUMNS } from './src/repositories/drive-sheets-create.js'.replace('./', new URL('./src/repositories/drive-sheets-create.js', 'file://$(pwd)/').href) ;
" 2>/dev/null || node --input-type=module -e "
import { HEADER, LISTO_COLUMNS } from 'file://$(pwd)/src/repositories/drive-sheets-create.js';
console.log(HEADER);
console.log(LISTO_COLUMNS);
console.log('header length', HEADER.length);
"
```

Esperado: 12 elementos en `HEADER`, `LISTO_COLUMNS` = `[3,5,7,9,11]`, sin error de import (este archivo no depende de `window`, a diferencia de `auth-facade.js`, así que corre limpio en Node).

- [ ] **Step 3: Commit**

```bash
git add src/repositories/drive-sheets-create.js
git commit -m "feat: crear spreadsheet de serie nueva vía Sheets API"
```

---

### Task 4: Componente `drive-folder-picker.js`

**Files:**
- Create: `src/ui/drive-folder-picker.js`
- Modify: `styles/components.css`

**Interfaces:**
- Consumes: `listDriveFolders`, `listSharedFolders` de `../repositories/drive-api.js` (Task 2); `esc` de `../utils.js`.
- Produces: `openDriveFolderPicker({ onPick(folderId: string), onCancel?() }) => void`.

- [ ] **Step 1: Agregar los estilos del overlay**

En `styles/components.css`, después del bloque `/* MODAL */` (línea 96, tras la regla `@media(max-width:760px)`), agregar:

```css
/* DRIVE FOLDER PICKER — overlay propio, por encima del modal de "Nueva
   serie" (z-index 90) para no perder su estado al elegir carpeta. */
.drivePickOvl{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:92;display:flex;align-items:center;justify-content:center}
.drivePick{width:min(480px,92vw);max-height:80vh;display:flex;flex-direction:column}
.drivePick .dpCrumbs{font-size:11.5px;color:var(--mut);margin-bottom:8px}
.drivePick .dpCrumbs button{color:var(--txt);text-decoration:underline;font-size:11.5px}
.drivePick #dpList{display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto}
.drivePick .dpFolder{display:block;width:100%;text-align:left}
```

- [ ] **Step 2: Crear el componente**

```js
// src/ui/drive-folder-picker.js
// Selector de carpeta destino en Drive para "crear serie nueva" — mismo
// comportamiento que DriveFolderPicker.tsx de TL2EDIT (navegar Mi unidad /
// Compartido conmigo, breadcrumbs, recordar última carpeta), maquetado con
// los estilos ya existentes (.modal, tokens.css), no los de TL2EDIT.
// Corre en su PROPIO overlay (no reusa el singleton openM/closeM de
// modals.js) para no perder el estado del modal "Nueva serie" que queda
// debajo.
import { listDriveFolders, listSharedFolders } from "../repositories/drive-api.js";
import { esc } from "../utils.js";

const LAST_FOLDER_KEY = "scantracker-drive-create-last-folder";
const ROOT_LABEL = { mydrive: "Mi unidad", shared: "Compartido conmigo" };

function loadLastFolder() {
  try {
    const raw = localStorage.getItem(LAST_FOLDER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.root !== "mydrive" && parsed?.root !== "shared") return null;
    return { root: parsed.root, path: Array.isArray(parsed.path) ? parsed.path : [] };
  } catch {
    return null;
  }
}

function saveLastFolder(root, path) {
  try {
    localStorage.setItem(LAST_FOLDER_KEY, JSON.stringify({ root, path }));
  } catch {
    // no crítico
  }
}

/** Abre el picker. onPick(folderId) se llama al confirmar "Crear aquí";
 * onCancel() al cerrar sin elegir. */
export function openDriveFolderPicker({ onPick, onCancel }) {
  const last = loadLastFolder();
  let root = last?.root || "mydrive";
  let path = last?.path || []; // [{id, name}]

  const overlay = document.createElement("div");
  overlay.className = "drivePickOvl";
  document.body.appendChild(overlay);

  const currentFolderId = () => (path.length ? path[path.length - 1].id : "root");
  const currentFolderName = () => (path.length ? path[path.length - 1].name : ROOT_LABEL[root]);

  function close(cb) {
    overlay.remove();
    cb?.();
  }

  async function loadFolders() {
    const listEl = overlay.querySelector("#dpList");
    if (!listEl) return;
    listEl.innerHTML = `<div class="hint">Cargando…</div>`;
    try {
      const items = root === "shared" && !path.length
        ? await listSharedFolders()
        : await listDriveFolders(currentFolderId());
      listEl.innerHTML = items.length
        ? items.map((f) => `<button type="button" class="btn dpFolder" data-id="${esc(f.id)}" data-name="${esc(f.name)}">📁 ${esc(f.name)}</button>`).join("")
        : `<div class="hint">Sin subcarpetas acá — "Crear aquí" guarda directo en ${esc(currentFolderName())}.</div>`;
      listEl.querySelectorAll(".dpFolder").forEach((b) => {
        b.onclick = () => {
          path = [...path, { id: b.dataset.id, name: b.dataset.name }];
          render();
        };
      });
    } catch (e) {
      listEl.innerHTML = `<div class="hint">No se pudo listar Drive: ${esc(e.message)}</div>`;
    }
  }

  function render() {
    const crumbLabels = [ROOT_LABEL[root], ...path.map((p) => p.name)];
    const crumbs = crumbLabels
      .map((n, i) => `<button type="button" class="dpCrumbBtn" data-idx="${i - 1}">${esc(n)}</button>`)
      .join(" › ");

    overlay.innerHTML = `<div class="modal drivePick">
      <h3>Elegir carpeta en Drive</h3>
      <div class="fld"><div style="display:flex;gap:8px">
        <button type="button" class="btn ${root === "mydrive" ? "red" : ""}" id="dpRootMy">Mi unidad</button>
        <button type="button" class="btn ${root === "shared" ? "red" : ""}" id="dpRootShared">Compartido conmigo</button>
      </div></div>
      <div class="dpCrumbs">${crumbs}</div>
      <div class="fld" id="dpList"></div>
      <div class="mrow">
        <button type="button" class="btn" id="dpCancel">Cancelar</button>
        <button type="button" class="btn red" id="dpOk">Crear aquí (${esc(currentFolderName())})</button>
      </div>
    </div>`;

    overlay.querySelector("#dpRootMy").onclick = () => { root = "mydrive"; path = []; render(); };
    overlay.querySelector("#dpRootShared").onclick = () => { root = "shared"; path = []; render(); };
    overlay.querySelectorAll(".dpCrumbBtn").forEach((b) => {
      b.onclick = () => { path = path.slice(0, Number(b.dataset.idx) + 1); render(); };
    });
    overlay.querySelector("#dpCancel").onclick = () => close(onCancel);
    overlay.querySelector("#dpOk").onclick = () => {
      saveLastFolder(root, path);
      const folderId = currentFolderId();
      close(() => onPick(folderId));
    };

    loadFolders();
  }

  render();
}
```

- [ ] **Step 3: Smoke manual en el browser**

```bash
cd ~/proyectos/scan-tracker-web && python3 -m http.server 8080
```

Abrir `http://localhost:8080`, loguearse con Google (va a pedir el consentimiento nuevo por los scopes agregados en Task 1 — confirmar que aparece la pantalla de permisos con Drive). No hay todavía un botón que abra el picker (se conecta en Task 5) — este paso solo confirma que el archivo no tiene errores de sintaxis abriendo la consola del navegador y corriendo:

```js
import("/src/ui/drive-folder-picker.js").then((m) => console.log(typeof m.openDriveFolderPicker));
```

Esperado en consola: `function`.

- [ ] **Step 4: Commit**

```bash
git add src/ui/drive-folder-picker.js styles/components.css
git commit -m "feat: picker de carpeta de Drive para crear series"
```

---

### Task 5: Conectar la 5ª fuente "drive" en el modal de nueva serie

**Files:**
- Modify: `src/ui/modals.js`

**Interfaces:**
- Consumes: `createSeriesSheet` (Task 3), `openDriveFolderPicker` (Task 4), `invalidateToken` + `requestToken` de `../repositories/auth-facade.js`.

- [ ] **Step 1: Importar lo nuevo**

En `src/ui/modals.js`, agregar tras la línea 19 (`import { linkGoogleToFirebase } from "../repositories/auth-email.js";`):

```js
import { requestToken, invalidateToken } from "../repositories/auth-facade.js";
import { createSeriesSheet } from "../repositories/drive-sheets-create.js";
import { openDriveFolderPicker } from "./drive-folder-picker.js";
```

- [ ] **Step 2: Agregar la opción al `<select>` y el campo de carpeta**

En `modalSerie()` (línea 309), reemplazar el bloque del `<select id="snSrc">` (líneas 312-316):

```js
  <div class="fld"><label>Fuente</label><select id="snSrc">
    <option value="manual">Manual (vacía)</option>
    <option value="gsheet">Google Sheets (vinculada, se sincroniza)</option>
    <option value="drive">Crear hoja nueva en Drive</option>
    <option value="paste">Pegar CSV</option>
    <option value="file">Archivo CSV local</option></select></div>
```

Y agregar, después del bloque `snPasteF` (línea 323) y antes de `snNF` (línea 324), un nuevo campo:

```js
  <div class="fld" id="snDriveF" style="display:none"><label>Carpeta en Drive</label>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn" id="snDriveFolderBtn" type="button">Elegir carpeta</button>
      <span id="snDriveFolderName" class="hint">Ninguna elegida</span>
    </div></div>
```

- [ ] **Step 3: Mostrar/ocultar los campos según la fuente**

Reemplazar el bloque `src.onchange` (líneas 327-331):

```js
  const src = document.getElementById("snSrc");
  src.onchange = () => {
    document.getElementById("snUrlF").style.display = src.value === "gsheet" ? "" : "none";
    document.getElementById("snPasteF").style.display = src.value === "paste" ? "" : "none";
    document.getElementById("snDriveF").style.display = src.value === "drive" ? "" : "none";
    document.getElementById("snNF").style.display = (src.value === "manual" || src.value === "drive") ? "" : "none";
    if (src.value === "file") document.getElementById("csvFile").click();
  };
```

- [ ] **Step 4: Cablear el botón "Elegir carpeta" y el estado local**

Antes de `document.getElementById("snOk").onclick = async () => {` (línea 390), agregar:

```js
  let pendingDriveFolderId = null;
  document.getElementById("snDriveFolderBtn").onclick = () => {
    openDriveFolderPicker({
      onPick: (folderId) => {
        pendingDriveFolderId = folderId;
        document.getElementById("snDriveFolderName").textContent = "Carpeta elegida ✓";
      },
    });
  };
```

- [ ] **Step 5: Manejar el modo "drive" en `snOk.onclick`**

Dentro de `snOk.onclick` (línea 390), agregar una rama nueva entre el `else if (v === "paste")` (línea 407) y el `else if (v === "file" ...)` (línea 411):

```js
    } else if (v === "drive") {
      if (!pendingDriveFolderId) return toast("Elegí una carpeta de Drive primero");
      const n = +document.getElementById("snN").value || 0;
      const create = () => createSeriesSheet({ name, folderId: pendingDriveFolderId, chapterCount: n });
      try {
        const { url } = await create();
        sr.sheetUrl = url;
        await fetchSheet(sr);
        checkDesignations(sr);
      } catch (e) {
        if (e.status === 403) {
          invalidateToken();
          try {
            await requestToken();
            const { url } = await create();
            sr.sheetUrl = url;
            await fetchSheet(sr);
            checkDesignations(sr);
          } catch (e2) {
            return toast("No se pudo crear la hoja: " + friendlyError(e2));
          }
        } else {
          return toast("No se pudo crear la hoja: " + friendlyError(e));
        }
      }
      pendingDriveFolderId = null;
```

- [ ] **Step 6: Validar duplicados antes de guardar (mismo patrón que `app.js:55`)**

Al principio de `snOk.onclick`, justo después de la línea `if (!name) return toast("Falta el nombre");` (línea 392), agregar:

```js
    if (v === "drive" && S.series.some((s) => s.sheetUrl === sr.sheetUrl)) {
      // sr.sheetUrl todavía es null acá (recién se crea más abajo) — esta
      // rama nunca dispara con el flujo actual (cada creación genera un id
      // nuevo), se deja documentado por si en el futuro se permite elegir un
      // archivo existente en el picker.
    }
```

(Nota: dado que `createSeriesSheet` siempre genera un `spreadsheetId` nuevo, la colisión de `sheetUrl` es estructuralmente imposible en este flujo — este paso queda como comentario explicativo, no como validación activa, para no escribir código muerto. Ver spec, sección "Manejo de errores".)

- [ ] **Step 7: Smoke manual completo**

Con el server (`python3 -m http.server 8080`) corriendo y sesión de Google iniciada (re-consentida tras Task 1):
1. Abrir "Nueva serie" → elegir fuente "Crear hoja nueva en Drive".
2. Confirmar que aparece el campo "Carpeta en Drive" y el de "Capítulos iniciales".
3. Click "Elegir carpeta" → navegar a una carpeta anidada → "Crear aquí".
4. Poner nombre + 5 capítulos → "Crear".
5. Abrir el link resultante en Drive: confirmar que la hoja tiene el header correcto, 5 filas, y las columnas "LISTO" son checkboxes clicables (no texto).
6. Confirmar que el archivo quedó dentro de la carpeta elegida, no en la raíz de "Mi unidad".

- [ ] **Step 8: Commit**

```bash
git add src/ui/modals.js
git commit -m "feat: crear serie nueva con hoja en Drive desde el modal"
```

---

### Task 6: Documentar el cambio de scopes en el README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Agregar una sección**

Agregar al final de `README.md` (o en la sección de configuración de Google que ya exista — revisar el archivo antes de decidir dónde):

```md
## Cambios de permisos de Google (2026-08)

La función "Crear hoja nueva en Drive" (al crear una serie) agregó dos scopes
nuevos a los que la app pide: `drive.readonly` (navegar carpetas reales) y
`drive.file` (crear el spreadsheet ahí). Son scopes sensibles — si ya habías
iniciado sesión antes de este cambio, la próxima vez que la app pida un token
vas a ver la pantalla de consentimiento de Google de nuevo, una sola vez.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: documentar los scopes nuevos de Drive en el README"
```

---

## PARTE B — TL2EDIT

> Ejecutar en `~/proyectos/TL2EDIT`. Antes de empezar, crear la rama:
> `git fetch origin main --quiet && git checkout -b feature/crear-series-drive origin/main`
> (aplicar la misma regla de "nunca tocar main sin permiso" — confirmar el nombre exacto de la rama base con el usuario si `main` no es la rama de integración de ese repo).

### Task 7: `addSeriesToScanTrackerProfile` en `scanTrackerCatalog.ts`

**Files:**
- Modify: `src/lib/scanTrackerCatalog.ts`
- Modify: `src/lib/scanTrackerCatalog.test.ts`

**Interfaces:**
- Consumes: `getFirestore`, `doc`, `setDoc`, `arrayUnion` de `firebase/firestore`; `ScanTrackerUserSeries` (ya definida en el archivo).
- Produces: `addSeriesToScanTrackerProfile(uid: string, series: ScanTrackerUserSeries): Promise<void>`.

- [ ] **Step 1: Escribir el test que falla**

En `src/lib/scanTrackerCatalog.test.ts`, agregar a los mocks del bloque `vi.hoisted` (línea 4-14) las funciones nuevas:

```ts
const h = vi.hoisted(() => {
  const authState = { currentUser: null as { uid: string } | null };
  return {
    authState,
    signInWithCredential: vi.fn(),
    doc: vi.fn((_db: unknown, _col: string, id: string) => ({ col: _col, id })),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    arrayUnion: vi.fn((...items: unknown[]) => ({ __arrayUnion: items })),
    collection: vi.fn((_db: unknown, name: string) => ({ name })),
    getDocs: vi.fn(),
  };
});
```

Y en el mock de `firebase/firestore` (línea 26-32):

```ts
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  collection: h.collection,
  getDocs: h.getDocs,
  doc: h.doc,
  getDoc: h.getDoc,
  setDoc: h.setDoc,
  arrayUnion: h.arrayUnion,
}));
```

Cambiar el import (línea 34) para incluir la función nueva:

```ts
import { getMyScanTrackerSeries, getMyScanTrackerAliases, addSeriesToScanTrackerProfile } from './scanTrackerCatalog';
```

Y agregar, al final del archivo, una nueva sección `describe`:

```ts
describe('addSeriesToScanTrackerProfile', () => {
  beforeEach(() => {
    h.setDoc.mockReset();
    h.arrayUnion.mockClear();
    h.doc.mockClear();
  });

  it('escribe con setDoc + merge, nunca con updateDoc', async () => {
    h.setDoc.mockResolvedValue(undefined);
    await addSeriesToScanTrackerProfile('user-42', { name: 'One Piece', sheetUrl: 'https://x/1' });

    expect(h.doc).toHaveBeenCalledWith(expect.anything(), 'users', 'user-42');
    expect(h.arrayUnion).toHaveBeenCalledWith({ name: 'One Piece', sheetUrl: 'https://x/1' });
    expect(h.setDoc).toHaveBeenCalledWith(
      expect.anything(),
      { series: { __arrayUnion: [{ name: 'One Piece', sheetUrl: 'https://x/1' }] } },
      { merge: true },
    );
  });
});
```

- [ ] **Step 2: Correr el test y confirmar que falla**

```bash
cd ~/proyectos/TL2EDIT && npx vitest run src/lib/scanTrackerCatalog.test.ts
```

Esperado: FAIL — `addSeriesToScanTrackerProfile` no existe / no es exportada.

- [ ] **Step 3: Implementar la función**

En `src/lib/scanTrackerCatalog.ts`, cambiar el import de `firebase/firestore` (línea 3):

```ts
import { getFirestore, doc, getDoc, setDoc, arrayUnion } from 'firebase/firestore';
```

Y agregar al final del archivo:

```ts
/**
 * Registra una serie nueva en el perfil de Scan Tracker del usuario
 * (users/{uid}.series) para que aparezca también en scan-tracker-web.
 *
 * Usa setDoc con merge:true, NUNCA updateDoc: un usuario que arranca por
 * TL2EDIT puede no tener el doc users/{uid} creado todavía (scan-tracker-web
 * lo crea recién al guardar la primera serie/alias desde la web) — updateDoc
 * lanzaría "document does not exist" en ese caso.
 */
export async function addSeriesToScanTrackerProfile(
  uid: string,
  series: ScanTrackerUserSeries,
): Promise<void> {
  const db = getFirestore(firebaseApp());
  await setDoc(doc(db, 'users', uid), { series: arrayUnion(series) }, { merge: true });
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

```bash
npx vitest run src/lib/scanTrackerCatalog.test.ts
```

Esperado: PASS, todos los tests del archivo (los preexistentes + el nuevo).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scanTrackerCatalog.ts src/lib/scanTrackerCatalog.test.ts
git commit -m "feat: escribir series nuevas al perfil de Scan Tracker (setDoc merge)"
```

---

### Task 8: `createScanTrackerSeries` en `scanTrackerSheet.ts`

**Files:**
- Modify: `src/lib/scanTrackerSheet.ts`
- Modify: `src/lib/scanTrackerSheet.test.ts`

**Interfaces:**
- Consumes: `driveFetch` de `./drive/api` (ya existente, firma `driveFetch(accessToken, url, init?, signal?) => Promise<Response>`); la `sheetsFetch` interna del propio archivo.
- Produces: `createScanTrackerSeries({ name, folderId, chapterCount, accessToken }): Promise<{ id: string; url: string }>`.

- [ ] **Step 1: Escribir el test que falla**

En `src/lib/scanTrackerSheet.test.ts`, agregar el import de la función nueva (línea 2) y un `describe` nuevo. Primero, agregar el mock de `fetch` (este archivo hoy no mockea red — se agrega solo para este `describe`, siguiendo el patrón de `googleDrive.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  spreadsheetIdFromUrl, gidFromUrl, detectEtapaDefs, parseChapters,
  detectAliasFromChapters, findNextTradChapter, findPendingStageForAlias,
  ETAPAS_DEFAULT, createScanTrackerSeries,
} from './scanTrackerSheet';
```

(Ajustar el import de `describe/it/expect` existente en la línea 1 para sumar `vi, beforeEach, afterEach` si no están.)

Agregar al final del archivo:

```ts
function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

describe('createScanTrackerSeries', () => {
  let calls: { url: string; method: string; body: string }[];

  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? init.body : '';
      calls.push({ url, method, body });

      if (method === 'POST' && url === 'https://sheets.googleapis.com/v4/spreadsheets') {
        return jsonResponse({
          spreadsheetId: 'sheet123',
          sheets: [{ properties: { sheetId: 0, title: 'Hoja 1' } }],
        });
      }
      if (method === 'PUT' && url.includes('/values/')) {
        return jsonResponse({});
      }
      if (method === 'POST' && url.endsWith(':batchUpdate')) {
        return jsonResponse({});
      }
      if (method === 'PATCH' && url.includes('drive/v3/files/sheet123')) {
        return jsonResponse({ id: 'sheet123' });
      }
      throw new Error(`fetch no mockeado: ${method} ${url}`);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('crea el spreadsheet, escribe capítulos, aplica formato y mueve a la carpeta', async () => {
    const result = await createScanTrackerSeries({
      name: 'One Piece', folderId: 'folder1', chapterCount: 2, accessToken: 'tok',
    });

    expect(result).toEqual({ id: 'sheet123', url: 'https://docs.google.com/spreadsheets/d/sheet123/edit#gid=0' });

    const createCall = calls.find((c) => c.url === 'https://sheets.googleapis.com/v4/spreadsheets');
    expect(JSON.parse(createCall!.body)).toEqual({ properties: { title: 'One Piece' } });

    const valuesCall = calls.find((c) => c.method === 'PUT');
    expect(valuesCall!.url).toContain(encodeURIComponent("'Hoja 1'!A1:L3"));
    const valuesBody = JSON.parse(valuesCall!.body);
    expect(valuesBody.values[0]).toEqual([
      'Capítulos', 'Prioridad', 'TRADUCCIÓN', 'LISTO', 'LIMPIEZA', 'LISTO',
      'TYPEO', 'LISTO', 'CORRECCIÓN', 'LISTO', 'SUBE', 'LISTO',
    ]);
    expect(valuesBody.values[1]).toEqual(['1', 'URGENTE', '', '', '', '', '', '', '', '', '', '']);
    expect(valuesBody.values[2][0]).toBe('2');

    const batchCall = calls.find((c) => c.method === 'POST' && c.url.endsWith(':batchUpdate'));
    const batchBody = JSON.parse(batchCall!.body);
    const validationRequests = batchBody.requests.filter((r: Record<string, unknown>) => r.setDataValidation);
    expect(validationRequests).toHaveLength(5);
    expect(validationRequests.map((r: any) => r.setDataValidation.range.startColumnIndex)).toEqual([3, 5, 7, 9, 11]);

    const moveCall = calls.find((c) => c.method === 'PATCH');
    expect(moveCall!.url).toContain('addParents=folder1');
    expect(moveCall!.url).toContain('removeParents=root');
  });
});
```

- [ ] **Step 2: Correr el test y confirmar que falla**

```bash
cd ~/proyectos/TL2EDIT && npx vitest run src/lib/scanTrackerSheet.test.ts
```

Esperado: FAIL — `createScanTrackerSeries` no existe.

- [ ] **Step 3: Implementar la función**

En `src/lib/scanTrackerSheet.ts`, agregar tras `markEtapa` (final del archivo, después de la línea 270 aprox.):

```ts
const HEADER = [
  'Capítulos', 'Prioridad',
  'TRADUCCIÓN', 'LISTO',
  'LIMPIEZA', 'LISTO',
  'TYPEO', 'LISTO',
  'CORRECCIÓN', 'LISTO',
  'SUBE', 'LISTO',
];

// Índices 0-based de las columnas "LISTO" (D,F,H,J,L) — checkbox real.
const LISTO_COLUMN_INDICES = [3, 5, 7, 9, 11];

function chapterRow(num: number): string[] {
  return [String(num), 'URGENTE', '', '', '', '', '', '', '', '', '', ''];
}

export interface CreateScanTrackerSeriesInput {
  name: string;
  folderId: string;
  chapterCount: number;
  accessToken: string;
}

/**
 * Crea un spreadsheet nuevo con el formato estándar de Scan Tracker
 * (checkboxes reales en las columnas LISTO, fila 1 en negrita y congelada) y
 * lo mueve a `folderId`. Mismo orden de pasos y mismo header que
 * drive-sheets-create.js en scan-tracker-web (deben coincidir byte a byte —
 * ver docs/superpowers/specs/2026-08-01-crear-series-estandar-drive-design.md
 * en ese repo).
 */
export async function createScanTrackerSeries({
  name, folderId, chapterCount, accessToken,
}: CreateScanTrackerSeriesInput): Promise<{ id: string; url: string }> {
  const createRes = await sheetsFetch(accessToken, SHEETS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title: name } }),
  });
  const created = await createRes.json();
  const spreadsheetId: string = created.spreadsheetId;
  const { sheetId, title } = created.sheets[0].properties as { sheetId: number; title: string };

  const rows = [HEADER, ...Array.from({ length: chapterCount }, (_, i) => chapterRow(i + 1))];
  const range = `'${title.replaceAll("'", "''")}'!A1:L${rows.length}`;
  await sheetsFetch(accessToken, `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows }),
  });

  await sheetsFetch(accessToken, `${SHEETS_API}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },
        ...LISTO_COLUMN_INDICES.map((col) => ({
          setDataValidation: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex: rows.length,
              startColumnIndex: col,
              endColumnIndex: col + 1,
            },
            rule: { condition: { type: 'BOOLEAN' }, strict: true },
          },
        })),
      ],
    }),
  });

  await sheetsFetch(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${spreadsheetId}?addParents=${encodeURIComponent(folderId)}&removeParents=root`,
    { method: 'PATCH' },
  );

  return { id: spreadsheetId, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}` };
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

```bash
npx vitest run src/lib/scanTrackerSheet.test.ts
```

Esperado: PASS, todos los tests del archivo.

- [ ] **Step 5: Correr todo Vitest para descartar regresiones**

```bash
npx vitest run
```

Esperado: PASS completo (o el mismo conjunto de fallos preexistentes que había antes de este cambio, si los hubiera — verificar con `git stash` + re-run si aparece algo sospechoso).

- [ ] **Step 6: Commit**

```bash
git add src/lib/scanTrackerSheet.ts src/lib/scanTrackerSheet.test.ts
git commit -m "feat: crear spreadsheet de serie nueva desde TL2EDIT"
```

---

### Task 9: Conectar la opción en `CreateSeriesModal.tsx`

**Files:**
- Modify: `src/components/CreateSeriesModal.tsx`
- Modify: `src/components/CreateSeriesModal.test.tsx`

**Interfaces:**
- Consumes: `createScanTrackerSeries` (Task 8), `addSeriesToScanTrackerProfile` + `signInScanTrackerWithGoogle` (Task 7 / ya existente) de `../lib/scanTrackerCatalog`, `DriveFolderPicker` (ya existente, `onPick: (folderId, folderName, fileName) => void`).
- Produces: nada nuevo hacia afuera — sigue llamando `onCreateFromScanTracker({ seriesName, sheetUrl })`, contrato sin cambios.

- [ ] **Step 1: Escribir el test que falla**

En `src/components/CreateSeriesModal.test.tsx`, agregar los mocks necesarios. Reemplazar el bloque de mocks (líneas 11-13) por:

```tsx
vi.mock('../hooks/useScanTrackerSeries', () => ({
  useScanTrackerSeries: vi.fn(),
}));
vi.mock('../lib/scanTrackerSheet', () => ({
  createScanTrackerSeries: vi.fn(),
}));
vi.mock('../lib/scanTrackerCatalog', () => ({
  signInScanTrackerWithGoogle: vi.fn(),
  addSeriesToScanTrackerProfile: vi.fn(),
}));

const mockedHook = vi.mocked(useScanTrackerSeries);
```

Agregar los imports correspondientes tras la línea 8:

```tsx
import { createScanTrackerSeries } from '../lib/scanTrackerSheet';
import { signInScanTrackerWithGoogle, addSeriesToScanTrackerProfile } from '../lib/scanTrackerCatalog';
```

Agregar un `describe` nuevo al final del archivo, antes del último `});`:

```tsx
describe('CreateSeriesModal — crear serie nueva en Scan Tracker', () => {
  it('crea el spreadsheet, registra la serie y la agrega a TL2EDIT', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    vi.mocked(signInScanTrackerWithGoogle).mockResolvedValue({ uid: 'u1' } as never);
    vi.mocked(createScanTrackerSeries).mockResolvedValue({ id: 'sheet123', url: 'https://docs.google.com/spreadsheets/d/sheet123/edit#gid=0' });
    vi.mocked(addSeriesToScanTrackerProfile).mockResolvedValue(undefined);

    renderModal('tok', onCreate);

    await user.click(screen.getByRole('button', { name: /Crear serie nueva en Scan Tracker/ }));
    await user.type(screen.getByPlaceholderText('Nombre de la serie nueva'), 'Berserk');
    // El DriveFolderPicker real abre su propio flujo de navegación — en este
    // test se simula la elección directamente vía el botón que lo dispara,
    // ya que DriveFolderPicker no está mockeado y su interacción completa se
    // cubre en DriveFolderPicker.test.tsx (ya existente).
    await user.click(screen.getByRole('button', { name: 'Elegir carpeta y crear' }));

    expect(screen.getByText(/Elegí una carpeta en Drive/)).toBeInTheDocument();
  });
});
```

(Este test cubre el punto de entrada del flujo — nombre requerido antes de abrir el picker — sin duplicar la navegación de carpetas ya testeada en `DriveFolderPicker.test.tsx`.)

- [ ] **Step 2: Correr el test y confirmar que falla**

```bash
cd ~/proyectos/TL2EDIT && npx vitest run src/components/CreateSeriesModal.test.tsx
```

Esperado: FAIL — no existe el botón "Crear serie nueva en Scan Tracker" todavía.

- [ ] **Step 3: Implementar la sección nueva en el componente**

En `src/components/CreateSeriesModal.tsx`, agregar los imports (tras la línea 4):

```tsx
import DriveFolderPicker from './DriveFolderPicker';
import { createScanTrackerSeries } from '../lib/scanTrackerSheet';
import { signInScanTrackerWithGoogle, addSeriesToScanTrackerProfile } from '../lib/scanTrackerCatalog';
```

Agregar estado nuevo dentro del componente (tras la línea 26, `const [manualName, setManualName] = useState('');`):

```tsx
  const [driveCreateOpen, setDriveCreateOpen] = useState(false);
  const [driveCreateName, setDriveCreateName] = useState('');
  const [driveCreateChapters, setDriveCreateChapters] = useState(10);
  const [driveCreateBusy, setDriveCreateBusy] = useState(false);
  const [driveCreateError, setDriveCreateError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
```

Agregar el handler, tras `handleAdd` (línea 41-43):

```tsx
  async function handleDriveCreatePick(folderId: string) {
    if (!accessToken) return;
    setPickerOpen(false);
    setDriveCreateBusy(true);
    setDriveCreateError(null);
    try {
      const { url } = await createScanTrackerSeries({
        name: driveCreateName.trim(),
        folderId,
        chapterCount: driveCreateChapters,
        accessToken,
      });
      const user = await signInScanTrackerWithGoogle(accessToken);
      await addSeriesToScanTrackerProfile(user.uid, { name: driveCreateName.trim(), sheetUrl: url });
      onCreateFromScanTracker({ seriesName: driveCreateName.trim(), sheetUrl: url });
      setDriveCreateName('');
      setDriveCreateOpen(false);
      refresh();
    } catch (err) {
      setDriveCreateError(err instanceof Error ? err.message : 'No se pudo crear la serie en Drive.');
    } finally {
      setDriveCreateBusy(false);
    }
  }
```

Agregar la sección UI, después del bloque `<div className="hr" />` (línea 114) y antes del bloque "Crear manual" (línea 116):

```tsx
        {driveCreateOpen ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <label htmlFor="create-series-drive-name" style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
              Crear serie nueva en Scan Tracker
            </label>
            <input
              id="create-series-drive-name"
              className="input"
              value={driveCreateName}
              onChange={(e) => setDriveCreateName(e.target.value)}
              placeholder="Nombre de la serie nueva"
              maxLength={100}
              style={{ fontSize: 13 }}
            />
            <input
              className="input"
              type="number"
              min={0}
              value={driveCreateChapters}
              onChange={(e) => setDriveCreateChapters(Math.max(0, Number(e.target.value) || 0))}
              placeholder="Capítulos iniciales"
              style={{ fontSize: 13 }}
            />
            {driveCreateError && <p style={{ fontSize: 12, color: 'var(--color-danger)', margin: 0 }}>{driveCreateError}</p>}
            {!accessToken && <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>Elegí una carpeta en Drive requiere sesión de Google.</p>}
            <button
              type="button"
              className="btn btn-primary"
              disabled={!driveCreateName.trim() || !accessToken || driveCreateBusy}
              onClick={() => setPickerOpen(true)}
              style={{ fontSize: 13, alignSelf: 'flex-start' }}
            >
              {driveCreateBusy ? 'Creando…' : 'Elegir carpeta y crear'}
            </button>
            {pickerOpen && accessToken && (
              <DriveFolderPicker
                accessToken={accessToken}
                initialFileName={driveCreateName.trim()}
                onClose={() => setPickerOpen(false)}
                onPick={(folderId) => handleDriveCreatePick(folderId)}
              />
            )}
          </div>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => setDriveCreateOpen(true)} style={{ fontSize: 12, alignSelf: 'flex-start' }}>
            <i className="ph-duotone ph-plus" style={{ fontSize: 13 }} />
            <span>Crear serie nueva en Scan Tracker</span>
          </button>
        )}
```

- [ ] **Step 4: Ajustar el test para que valide el mensaje real en vez de uno inventado**

El Step 1 asumió un mensaje `"Elegí una carpeta en Drive"` que no existe en la implementación de arriba — corregir el test para que valide lo que sí se ve: que se abre el `DriveFolderPicker`. Reemplazar el `expect` final del test agregado en el Step 1:

```tsx
    expect(screen.getByText('Guardar en Google Drive')).toBeInTheDocument();
```

(`"Guardar en Google Drive"` es el título fijo de `DriveFolderPicker.tsx:130` — confirma que el picker se abrió tras click en "Elegir carpeta y crear".)

- [ ] **Step 5: Correr el test y confirmar que pasa**

```bash
npx vitest run src/components/CreateSeriesModal.test.tsx
```

Esperado: PASS, todos los tests del archivo (los preexistentes + el nuevo).

- [ ] **Step 6: Correr toda la suite**

```bash
npx vitest run
```

Esperado: PASS completo.

- [ ] **Step 7: Checklist manual (contra Drive/Firestore reales, no mockeable)**

1. Abrir TL2EDIT, loguearse con Google, abrir "Agregar serie" → "Crear serie nueva en Scan Tracker".
2. Poner nombre + capítulos, click "Elegir carpeta y crear", navegar y confirmar una carpeta.
3. Confirmar que la serie aparece en TL2EDIT (vía `onCreateFromScanTracker`) y que el spreadsheet real en Drive tiene el header y los checkboxes correctos.
4. Abrir scan-tracker-web con la MISMA cuenta: confirmar que la serie **no** aparece hasta el próximo login/reload (comportamiento esperado, ver Global Constraints — no es un bug).
5. Probar con una cuenta de Google que nunca inició sesión en scan-tracker-web (sin doc `users/{uid}` previo): confirmar que no falla por `setDoc`/`merge`.

- [ ] **Step 8: Commit**

```bash
git add src/components/CreateSeriesModal.tsx src/components/CreateSeriesModal.test.tsx
git commit -m "feat: crear serie nueva en Scan Tracker desde TL2EDIT"
```

---

## Self-Review (hecho al escribir este plan)

**Cobertura de la spec:** cada sección de
`docs/superpowers/specs/2026-08-01-crear-series-estandar-drive-design.md`
tiene tarea(s) que la implementan — formato estándar (Task 3/8), scopes (Task
1), picker propio (Task 2/4), modal existente (Task 5), TL2EDIT reusa
`DriveFolderPicker` con `initialFileName` (Task 9), `setDoc` merge (Task 7),
orden de pasos del spreadsheet (Task 3/8), manejo de 403 con
`invalidateToken` (Task 1/5), `#snNF` en modo drive (Task 5 Step 3), README
(Task 6), checklists manuales (Task 5/9).

**Placeholders:** ninguno — cada paso de código tiene la implementación
completa, no descripciones de qué hacer.

**Consistencia de tipos/nombres:** `createSeriesSheet` (scan-tracker-web) y
`createScanTrackerSeries` (TL2EDIT) tienen nombres distintos a propósito
(archivos/lenguajes distintos, sin contrato de imports compartido) pero
mismos campos de entrada (`name`/`folderId`/`chapterCount` +
`accessToken` solo en TL2EDIT porque ahí se pasa explícito en vez de
resolverse por `getAccessToken()` interno) y misma forma de salida
(`{id, url}`). `HEADER`/`LISTO_COLUMNS` vs `HEADER`/`LISTO_COLUMN_INDICES`:
nombres levemente distintos entre archivos — aceptable, son internos no
exportados fuera de su módulo salvo `HEADER`/`LISTO_COLUMNS` en
`drive-sheets-create.js` (exportados solo por si un test manual los
necesita, sin consumidores externos todavía).

**Alcance:** dos repos, pero cada Parte (A y B) produce software
funcionando y verificable de forma independiente — Parte A sola ya resuelve
"crear series en scan-tracker-web"; Parte B depende de que Parte A exista
conceptualmente (mismo contrato) pero no de su código (repos separados,
sin import cruzado). No hace falta partir esto en más planes.

---

## Handoff

Plan completo y guardado en
`docs/superpowers/plans/2026-08-01-crear-series-estandar-drive.md`. Dos
opciones de ejecución:

1. **Subagent-Driven (recomendado)** — despacho un subagente fresco por
   tarea, con revisión entre tareas.
2. **Ejecución inline** — ejecuto las tareas en esta sesión con
   `executing-plans`, por lotes con checkpoints.

¿Cuál preferís?

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

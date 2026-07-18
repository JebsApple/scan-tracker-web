// appDataFolder de Google Drive — carpeta oculta y privada de esta app
// dentro del Drive del propio usuario, no visible en su Drive normal ni
// accesible por otras apps. Es la forma "sin backend" de sincronizar config
// chica entre dispositivos usando la infra de Google en vez de un servidor
// propio: mismo espíritu que gviz para lectura pública, pero para escritura
// de datos propios de la app atados a la cuenta.
import { getAccessToken } from "./auth-facade.js";

const FILE_NAME = "scantracker-sync.json";
const BASE = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3/files";

async function authedFetch(url, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Drive API HTTP ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

async function findSyncFileId() {
  const q = encodeURIComponent(`name='${FILE_NAME}'`);
  const res = await authedFetch(`${BASE}?spaces=appDataFolder&q=${q}&fields=files(id)`);
  const data = await res.json();
  return data.files?.[0]?.id || null;
}

/** Sube el estado a sincronizar (reemplaza el archivo entero). */
export async function uploadSyncData(data) {
  const body = JSON.stringify(data);
  const fileId = await findSyncFileId();
  if (fileId) {
    await authedFetch(`${UPLOAD_BASE}/${fileId}?uploadType=media`, { method: "PATCH", body });
    return;
  }
  const metadata = { name: FILE_NAME, parents: ["appDataFolder"] };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", new Blob([body], { type: "application/json" }));
  await authedFetch(`${UPLOAD_BASE}?uploadType=multipart`, { method: "POST", body: form });
}

/** Devuelve el último estado sincronizado, o null si nunca se subió nada
 * desde ningún dispositivo (primera vez con esta cuenta). */
export async function downloadSyncData() {
  const fileId = await findSyncFileId();
  if (!fileId) return null;
  const res = await authedFetch(`${BASE}/${fileId}?alt=media`);
  return res.json();
}

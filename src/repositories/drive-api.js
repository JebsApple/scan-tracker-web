// Google Drive API v3 — solo para listar spreadsheets en "Compartidos
// conmigo" (nombre + id), así el usuario elige de un desplegable en vez de
// ir a buscar la URL a Drive y pegarla a mano. Nunca lee contenido de
// archivos — eso sigue yendo por Sheets API (sheets-api.js).

import { getAccessToken } from "./auth-facade.js";

const BASE = "https://www.googleapis.com/drive/v3/files";

/** Devuelve [{id, name}] de spreadsheets compartidos con la cuenta conectada,
 * más recientes primero. Requiere el scope drive.metadata.readonly. */
export async function listSharedSheets() {
  const token = await getAccessToken();
  const q = encodeURIComponent(
    "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
  );
  const url = `${BASE}?q=${q}&fields=files(id,name)&orderBy=modifiedTime desc&pageSize=100`;
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

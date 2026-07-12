// Google Sheets API v4 REST — puerto directo de GoogleService.java
// (readSheet/writeCell/appendRow/deleteRow) sin backend: fetch nativo
// desde el browser usando el access_token de auth.js.

import { getAccessToken } from "./auth.js";

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

function idFromUrl(url) {
  const m = url.match(/\/d\/([\w-]+)/);
  return m ? m[1] : null;
}

function gidFromUrl(url) {
  const m = url.match(/[#&?]gid=(\d+)/);
  return m ? Number(m[1]) : null;
}

async function authedFetch(url, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sheets API HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Devuelve {id, gid, title, rows:[[...]]} — misma forma que la versión Java. */
export async function readSheet(url) {
  const id = idFromUrl(url);
  if (!id) throw new Error("URL inválida");
  const gid = gidFromUrl(url);

  const meta = await authedFetch(`${BASE}/${id}?fields=sheets.properties`);
  const sheets = meta.sheets || [];
  const props =
    gid == null
      ? sheets[0]?.properties
      : sheets.find((s) => s.properties.sheetId === gid)?.properties;
  if (!props) throw new Error("Pestaña (gid) no encontrada");

  const title = props.title;
  const range = `'${title.replace(/'/g, "''")}'!A1:L1000`;
  const vr = await authedFetch(`${BASE}/${id}/values/${encodeURIComponent(range)}`);
  const rows = (vr.values || []).map((r) => r.map((c) => String(c ?? "")));

  return { id, gid: props.sheetId, title, rows };
}

/** Escribe una celda (ej. cell = "D5"). */
export async function writeCell(url, sheetTitle, cell, value) {
  const id = idFromUrl(url);
  const range = `'${sheetTitle.replace(/'/g, "''")}'!${cell}`;
  await authedFetch(
    `${BASE}/${id}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: [[value]] }),
    },
  );
}

/** Agrega una fila al final. Devuelve el número de fila escrita. */
export async function appendRow(url, sheetTitle, values) {
  const id = idFromUrl(url);
  const range = `'${sheetTitle.replace(/'/g, "''")}'!A:L`;
  const resp = await authedFetch(
    `${BASE}/${id}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: [values] }),
    },
  );
  const updated = resp.updates?.updatedRange;
  const m = updated?.match(/[A-Z]+(\d+)/);
  return m ? Number(m[1]) : -1;
}

/** Borra una fila completa (rowIndex es 1-based, como en la hoja). */
export async function deleteRow(url, gid, rowIndex) {
  const id = idFromUrl(url);
  const body = {
    requests: [
      {
        deleteDimension: {
          range: {
            sheetId: Number(gid),
            dimension: "ROWS",
            startIndex: rowIndex - 1,
            endIndex: rowIndex,
          },
        },
      },
    ],
  };
  await authedFetch(`${BASE}/${id}:batchUpdate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

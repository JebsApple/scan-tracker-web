// Envoltorio fino sobre sheets-api.js + drive-api.js + el fallback público
// (gviz). Esta es la única capa que sabe de HTTP/Google APIs — nada por
// encima de acá debe construir URLs ni llamar fetch() directamente.
import { readSheet, writeCell, appendRow, deleteRow, listSheetTabs } from "./sheets-api.js";
import { listSharedSheets } from "./drive-api.js";

export { readSheet, writeCell, appendRow, deleteRow, listSheetTabs, listSharedSheets };

function gvizUrl(url) {
  const m = url.match(/\/d\/([\w-]+)/);
  if (!m) return null;
  const g = url.match(/[#&?]gid=(\d+)/);
  return `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv${g ? `&gid=${g[1]}` : ""}`;
}

/** Lectura pública sin login (gviz CSV). Solo funciona con hojas públicas;
 * hojas privadas requieren sesión de Google (readSheet arriba). */
export async function fetchPublicCsv(url) {
  const u = gvizUrl(url);
  if (!u) throw new Error("URL inválida");
  const res = await fetch(u);
  if (!res.ok) {
    const err = new Error("HTTP " + res.status);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

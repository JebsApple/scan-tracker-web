import { S, save, logEvent, esMio } from "../state/store.js";
import { readSheet, writeCell, appendRow, deleteRow, fetchPublicCsv } from "../repositories/sheets-repository.js";
import { isSignedIn } from "../repositories/auth-facade.js";
import { csvToChapters, etapasDe } from "./etapas-service.js";
import { parseCSV, friendlyError, norm } from "../utils.js";
import { toast } from "../ui/toast.js";

async function apiFetchSheet(sr) {
  const data = await readSheet(sr.sheetUrl);
  sr._ssId = data.id;
  sr._gid = data.gid;
  sr._title = data.title;
  const rows = data.rows.map((r) => r.map((c) => String(c ?? "")));
  const { chapters: chs, etapaDefs } = csvToChapters(rows, true);
  if (chs.length) {
    sr.chapters = chs;
    sr.etapaDefs = etapaDefs;
  }
  sr.api = true;
  sr.lastSync = new Date().toLocaleTimeString();
}

// COLW mapea claves internas (siempre POSICIONALES, ver etapas-service.js)
// a letras de columna fijas C-L — no cambia aunque el nombre real de la
// etapa sea distinto en esa hoja.
export const COLW = { trad: ["C", "D"], limp: ["E", "F"], typ: ["G", "H"], corr: ["I", "J"], sube: ["K", "L"] };

// Las tres push* devuelven true si el cambio quedó reflejado en la hoja y
// false si se perdió. El llamador muta el estado local antes (para que la UI
// responda al toque) y revierte con ese false — si no, la pantalla queda
// mintiendo hasta el próximo sync. Una serie sin hoja vinculada devuelve true:
// no hay nada que escribir, no es un fallo.
export async function pushCell(sr, ch, col, val) {
  if (!sr?.api || !ch.srcRow) return true;
  try {
    await writeCell(sr.sheetUrl, sr._title, col + ch.srcRow, String(val));
    return true;
  } catch (e) {
    const msg = friendlyError(e);
    logEvent("Escritura fallida", `${sr.name} cap ${ch.num}: ${msg}`);
    toast("No se pudo escribir: " + msg);
    return false;
  }
}

export async function pushNewRow(sr, ch) {
  if (!sr?.api) return true;
  try {
    const row = await appendRow(sr.sheetUrl, sr._title, [ch.num, ch.prio, ...etapasDe(sr).flatMap(() => ["", false])]);
    if (row > 0) {
      ch.srcRow = row;
      save();
    }
    return true;
  } catch (e) {
    const msg = friendlyError(e);
    logEvent("Fila no agregada", `${sr.name} cap ${ch.num}: ${msg}`);
    toast("No se pudo agregar fila: " + msg);
    return false;
  }
}

export async function pushDelRow(sr, ch) {
  if (!sr?.api || !ch.srcRow) return true;
  try {
    await deleteRow(sr.sheetUrl, sr._gid, ch.srcRow);
    sr.chapters.forEach((c) => {
      if (c.srcRow > ch.srcRow) c.srcRow--;
    });
    save();
    return true;
  } catch (e) {
    const msg = friendlyError(e);
    logEvent("Fila no borrada", `${sr.name} cap ${ch.num}: ${msg}`);
    toast("No se pudo borrar fila: " + msg);
    return false;
  }
}

export async function fetchSheet(sr) {
  if (isSignedIn()) {
    try {
      await apiFetchSheet(sr);
      return;
    } catch (e) {
      if (sr.api) throw e;
    }
  }
  sr.api = false;
  const text = await fetchPublicCsv(sr.sheetUrl);
  const { chapters: chs, etapaDefs } = csvToChapters(parseCSV(text));
  if (chs.length) {
    sr.chapters = chs;
    sr.etapaDefs = etapaDefs;
  }
  sr.lastSync = new Date().toLocaleTimeString();
}

/* ============ NOTIFICACIONES DE DESIGNACIÓN ============ */
export function notifyDesignation(serieName, capNum, etapaLabel) {
  const title = "Te asignaron un capítulo";
  const body = `${serieName} — Cap. ${capNum} (${etapaLabel})`;
  if (!("Notification" in window)) {
    toast(`${title}: ${body}`);
    return;
  }
  if (Notification.permission === "granted") {
    new Notification(title, { body });
    return;
  }
  if (Notification.permission === "denied") {
    toast(`${title}: ${body}`);
    return;
  }
  Notification.requestPermission()
    .then((perm) => {
      if (perm === "granted") new Notification(title, { body });
      else toast(`${title}: ${body}`);
    })
    .catch(() => toast(`${title}: ${body}`));
}

// Compara el estado actual de who-por-etapa contra el snapshot guardado en S.
// Solo notifica cuando mi alias aparece donde antes NO estaba (no en la primera carga,
// ya que sin snapshot previo solo se establece la línea base).
export function checkDesignations(sr) {
  const prev = S.whoSnapshot[sr.id];
  const cur = {};
  sr.chapters.forEach((c) => etapasDe(sr).forEach(([k]) => (cur[`${c.num}|${k}`] = norm(c[k].who))));
  if (prev) {
    Object.keys(cur).forEach((key) => {
      const wasMine = esMio(prev[key] || "");
      const isMine = esMio(cur[key]);
      if (!wasMine && isMine) {
        const [num, etk] = key.split("|");
        const etLabel = (etapasDe(sr).find(([k]) => k === etk) || [])[1] || etk;
        notifyDesignation(sr.name, num, etLabel);
      }
    });
  }
  S.whoSnapshot[sr.id] = cur;
}

export async function syncAll(manual) {
  const linked = S.series.filter((s) => s.sheetUrl);
  if (!linked.length) {
    if (manual) toast("Ninguna serie vinculada a Google Sheets");
    return;
  }
  let ok = 0, err = 0, lastErr = "";
  for (const sr of linked) {
    try {
      await fetchSheet(sr);
      checkDesignations(sr);
      ok++;
    } catch (e) {
      err++;
      lastErr = friendlyError(e);
      logEvent("Sync fallido", `${sr.name}: ${lastErr}`);
    }
  }
  save();
  toast(`Sync: ${ok} ok${err ? `, ${err} con error (${lastErr})` : ""}`);
}

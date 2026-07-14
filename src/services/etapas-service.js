import { uid } from "../utils.js";

// ETAPAS es el contrato POR DEFECTO (series manuales/CSV sin encabezado
// detectable). Series sincronizadas con Sheets pueden tener su propio
// sr.etapaDefs (mismo formato [key,label]) autodetectado del encabezado real
// de esa hoja — no todos los equipos usan las mismas 5 etapas. Las claves
// internas (trad/limp/typ/corr/sube) son siempre POSICIONALES (1ra etapa del
// sheet, 2da, etc), no atadas al nombre real de la etapa — por eso COLW
// (sync-service.js) sigue funcionando sin cambios aunque el nombre real sea otro.
export const ETAPAS = [
  ["trad", "Traducción"],
  ["limp", "Limpieza"],
  ["typ", "Typeo"],
  ["corr", "Corrección"],
  ["sube", "Sube"],
];
export const ETAPA_KEYS = ETAPAS.map(([k]) => k);
export const etapasDe = (sr) => (sr && sr.etapaDefs) || ETAPAS;

// Detecta pares (who,done) desde la fila de encabezado real de un Sheet.
// Columnas 0/1 son Capítulo/Prioridad, desde la 2 en adelante se asume
// alternancia who,done por cada etapa — funciona con 4, 5, o cualquier
// cantidad de etapas mientras respeten ese patrón.
export function detectEtapaDefs(headerRow) {
  const defs = [];
  for (let i = 2, k = 0; i + 1 < headerRow.length + 1 && k < ETAPA_KEYS.length; i += 2, k++) {
    const label = String(headerRow[i] || "").trim();
    if (!label) break;
    defs.push([ETAPA_KEYS[k], label]);
  }
  return defs.length ? defs : ETAPAS;
}

// Devuelve {chapters, etapaDefs} — etapaDefs autodetectado del encabezado
// real de la hoja (ver detectEtapaDefs), o el contrato por defecto (ETAPAS)
// si no se encontró encabezado (CSV pegado sin fila de título, por ejemplo).
export function csvToChapters(rows, track) {
  let start = 0, headerRow = null;
  for (let i = 0; i < Math.min(rows.length, 3); i++) {
    if (rows[i].some((c) => /^cap/i.test(String(c).trim()))) {
      headerRow = rows[i];
      start = i + 1;
      break;
    }
  }
  const etapaDefs = headerRow ? detectEtapaDefs(headerRow) : ETAPAS;
  const chs = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] || !String(r[0]).trim()) continue;
    const T = (v) => String(v || "").trim().toUpperCase() === "TRUE";
    const ch = {
      id: uid(),
      num: String(r[0]).trim(),
      prio: String(r[1] || "").trim().toUpperCase(),
      srcRow: track ? i + 1 : null,
    };
    etapaDefs.forEach(([key], idx) => {
      const whoCol = 2 + idx * 2, doneCol = 3 + idx * 2;
      ch[key] = { who: (r[whoCol] || "").trim(), done: T(r[doneCol]) };
    });
    chs.push(ch);
  }
  return { chapters: chs, etapaDefs };
}

export function nuevoCap(num, sr) {
  const ch = { id: uid(), num, prio: "URGENTE" };
  etapasDe(sr).forEach(([k]) => {
    ch[k] = { who: "", done: false };
  });
  return ch;
}

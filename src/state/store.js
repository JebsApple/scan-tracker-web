// S es la ÚNICA fuente de verdad del estado global — el resto de los
// módulos la importan, ninguno debe mantener su propia copia.
import { isMyAlias } from "../utils.js";

const STORAGE_KEY = "scantracker";

function defaults() {
  return {
    aliases: [],
    series: [],
    sel: null,
    filters: { prio: "", estado: "", busca: "", etapa: "", orden: "" },
    whoSnapshot: {},
    historial: [],
    startedAt: {},
    log: [],
  };
}

export function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (e) {
    return null;
  }
}

function migrate(s) {
  s.filters = s.filters || {};
  s.filters.etapa = s.filters.etapa || "";
  s.filters.orden = s.filters.orden || "";
  s.whoSnapshot = s.whoSnapshot || {};
  s.historial = s.historial || [];
  s.startedAt = s.startedAt || {};
  s.log = s.log || [];
  delete s.clientId; // limpiar restos de versiones viejas que sí lo guardaban
  delete s.debug; // reemplazado por el log persistente (logEvent/modalLog)
  return s;
}

export let S = migrate(load() || defaults());

// Otros módulos (hoy solo state/history.js) se suscriben acá para reaccionar
// a cada save() sin que este archivo tenga que conocerlos (evita el ciclo de
// imports store↔history).
const saveListeners = [];
export function onSave(fn) {
  saveListeners.push(fn);
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(S));
  } catch (e) {}
}

export function save() {
  persist();
  saveListeners.forEach((fn) => fn());
}

// Usado por undo/redo para reemplazar S completo por un snapshot restaurado.
export function setState(newS) {
  S = newS;
  persist();
}

export const esMio = (n) => isMyAlias(n, S.aliases);

/** Registra un fallo de sync/API en S.log — reemplaza el scantrackerDebug()
 * temporal, ahora es un log real inspeccionable/exportable desde la UI en
 * vez de tener que abrir devtools. */
export function logEvent(tipo, detalle) {
  S.log.unshift({ fecha: new Date().toISOString(), tipo, detalle });
  if (S.log.length > 200) S.log.length = 200;
  save();
}

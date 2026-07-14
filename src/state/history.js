// Snapshot completo de S en cada save() — solo en memoria (no persiste al
// recargar la página, es intencional, evita hinchar localStorage). No revierte
// cambios ya escritos en Google Sheets, solo el estado local.
import { S, setState, save, onSave } from "./store.js";
import { fetchSheet, checkDesignations } from "../services/sync-service.js";
import { toast } from "../ui/toast.js";

const MAX_HISTORY = 50;
let history = [JSON.stringify(S)];
let historyIndex = 0;

export function pushHistory() {
  const snap = JSON.stringify(S);
  if (history[historyIndex] === snap) return;
  history = history.slice(0, historyIndex + 1);
  history.push(snap);
  if (history.length > MAX_HISTORY) history.shift();
  else historyIndex++;
  historyIndex = history.length - 1;
}
onSave(pushHistory);

export const canUndo = () => historyIndex > 0;
export const canRedo = () => historyIndex < history.length - 1;

// Deshacer/rehacer NUNCA debe dejar sr.srcRow (fila real en el Sheet)
// desalineado con lo que hay escrito de verdad — si eso pasa, la próxima
// escritura (pushCell) apunta a la fila equivocada y corrompe datos de otra
// persona. Por eso, tras cualquier undo/redo, toda serie vinculada a Sheets
// se re-sincroniza desde la fuente real en vez de confiar en el snapshot: el
// undo revierte cosas puramente locales (alias, ocultos, filtros, historial)
// con certeza; para capítulos de una serie con Sheets, gana siempre el dato
// remoto real, nunca el snapshot.
async function resyncLinkedSeries() {
  for (const sr of S.series.filter((s) => s.sheetUrl)) {
    try {
      await fetchSheet(sr);
      checkDesignations(sr);
    } catch (e) {
      /* sin conexión: se queda con lo último conocido */
    }
  }
  save();
}

export async function undo(render) {
  if (historyIndex <= 0) return toast("Nada para deshacer");
  historyIndex--;
  setState(JSON.parse(history[historyIndex]));
  render();
  toast("Deshecho — re-sincronizando series con Sheets...");
  await resyncLinkedSeries();
  render();
}

export async function redo(render) {
  if (historyIndex >= history.length - 1) return toast("Nada para rehacer");
  historyIndex++;
  setState(JSON.parse(history[historyIndex]));
  render();
  toast("Rehecho — re-sincronizando series con Sheets...");
  await resyncLinkedSeries();
  render();
}

import { initAuth, trySilentLogin, DEFAULT_CLIENT_ID } from "./repositories/auth.js";
import { S, save, onSave } from "./state/store.js";
import { undo, redo } from "./state/history.js";
import { isNative, requestBackgroundPermissions, pushMobileConfig } from "./mobile/capacitor-bridge.js";
import { syncAll } from "./services/sync-service.js";
import { etapasDe } from "./services/etapas-service.js";
import { render, wireRenderEvents } from "./ui/render.js";
import { toast } from "./ui/toast.js";
import {
  modalAliases,
  modalDashboard,
  modalHistorial,
  modalGoogle,
  modalSerie,
  modalMisPendientes,
  paintG,
  refreshGoogleSession,
} from "./ui/modals.js";

try {
  initAuth(DEFAULT_CLIENT_ID);
} catch (e) {}

// Reintento silencioso: si ya diste consentimiento antes, no hace falta
// tocar "Iniciar sesión" de nuevo en cada recarga. Falla en silencio si el
// navegador bloquea el intento o ya no hay sesión activa en Google.
trySilentLogin()
  .then(async () => {
    await refreshGoogleSession();
    await syncAll(false);
    render();
  })
  .catch(() => {});

setInterval(() => syncAll(false).then(render), 5 * 60 * 1000); // auto-sync cada 5 min

wireRenderEvents();

document.getElementById("fMine").onclick = modalMisPendientes;
document.getElementById("bCfg").onclick = modalAliases;
document.getElementById("bDash").onclick = modalDashboard;
document.getElementById("bHist").onclick = modalHistorial;
document.getElementById("bGoogle").onclick = modalGoogle;
document.getElementById("bAddSerie").onclick = modalSerie;
document.getElementById("bSync").onclick = () => syncAll(true).then(render);
document.getElementById("bUndo").onclick = () => undo(render);
document.getElementById("bRedo").onclick = () => redo(render);

document.getElementById("bExport").onclick = () => {
  const sr = S.series.find((x) => x.id === S.sel);
  if (!sr) return toast("Selecciona una serie");
  const etapaDefs = etapasDe(sr);
  let csv = "Capítulos,Prioridad," + etapaDefs.flatMap(([, label]) => [label, "LISTO"]).join(",") + "\n";
  sr.chapters.forEach((c) => {
    csv +=
      [c.num, c.prio, ...etapaDefs.flatMap(([k]) => [c[k].who, c[k].done ? "TRUE" : "FALSE"])]
        .map((v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v))
        .join(",") + "\n";
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = sr.name.replace(/[^\w-]+/g, "_") + ".csv";
  a.click();
};

render();
paintG();
if (!S.aliases.length && !S.series.length) setTimeout(modalAliases, 400);

// Solo hace algo dentro de la app Android empaquetada (window.Capacitor no
// existe en el browser normal). El chequeo en background solo puede leer
// Sheets públicos (gviz) — no hay forma de reautenticar OAuth sin pantalla.
if (isNative()) {
  requestBackgroundPermissions();
  const syncMobileConfig = () => pushMobileConfig(S.series.filter((s) => s.sheetUrl).map((s) => s.sheetUrl), S.aliases);
  onSave(syncMobileConfig);
  syncMobileConfig();
}

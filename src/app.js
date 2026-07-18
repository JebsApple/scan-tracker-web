import { initAuth, trySilentLogin, isSignedIn, DEFAULT_CLIENT_ID } from "./repositories/auth-facade.js";
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
  connectGoogle,
} from "./ui/modals.js";
import { isChileno, toggleChileno } from "./chileno.js";
import { toast } from "./ui/toast.js";

try {
  await initAuth(DEFAULT_CLIENT_ID);
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
// Un solo toque para conectar cuando no hay sesión — antes había que abrir
// un modal y tocar OTRO botón adentro para lo mismo. Ya con sesión, el botón
// abre el modal (ver cuenta / cerrar sesión), que sí amerita un paso extra.
document.getElementById("bGoogle").onclick = () => (isSignedIn() ? modalGoogle() : connectGoogle());
document.getElementById("bAddSerie").onclick = modalSerie;
document.getElementById("bSync").onclick = () => syncAll(true).then(render);
document.getElementById("bUndo").onclick = () => undo(render);
document.getElementById("bRedo").onclick = () => redo(render);

// Togglers de mobile (ocultos por CSS en desktop, ver styles/components.css
// breakpoint 700px): drawer de series, panel de filtros, menú "más".
function toggle(el, force) {
  const open = force ?? !el.classList.contains("open");
  el.classList.toggle("open", open);
  return open;
}
const drawer = document.getElementById("side");
const backdrop = document.getElementById("drawerBackdrop");
const filtersPanel = document.getElementById("filtersPanel");
const morePanel = document.getElementById("morePanel");
function closeAllPanels() {
  drawer.classList.remove("open");
  backdrop.classList.remove("open");
  filtersPanel.classList.remove("open");
  morePanel.classList.remove("open");
}
document.getElementById("bDrawer").onclick = () => {
  const open = toggle(drawer);
  toggle(backdrop, open);
};
backdrop.onclick = closeAllPanels;
document.getElementById("bFiltersToggle").onclick = (e) => {
  e.stopPropagation();
  const open = toggle(filtersPanel);
  morePanel.classList.remove("open");
  if (open) toggle(backdrop, false); // el panel de filtros cierra solo (afuera), no necesita backdrop
};
document.getElementById("bMoreToggle").onclick = (e) => {
  e.stopPropagation();
  toggle(morePanel);
  filtersPanel.classList.remove("open");
};
document.addEventListener("click", (e) => {
  if (!filtersPanel.contains(e.target) && e.target.id !== "bFiltersToggle") filtersPanel.classList.remove("open");
  if (!morePanel.contains(e.target) && e.target.id !== "bMoreToggle") morePanel.classList.remove("open");
});
document.getElementById("serieList").addEventListener("click", (e) => {
  if (e.target.closest("[data-sel]")) closeAllPanels();
});
document.getElementById("morePanel").addEventListener("click", () => morePanel.classList.remove("open"));

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

// Easter egg: triple-click en el logo activa modo chileno
document.getElementById("logo").addEventListener("click", () => {
  const on = toggleChileno();
  document.body.classList.toggle("chileno", on);
  toast(on ? "Modo chileno activado po 🇨🇱" : "Modo chileno desactivado nojada");
  render();
});

render();
paintG();
if (isChileno()) document.body.classList.add("chileno");
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

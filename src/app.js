import { initAuth, trySilentLogin, isSignedIn, DEFAULT_CLIENT_ID } from "./repositories/auth-facade.js";
import { S, save, onSave } from "./state/store.js";
import { uid } from "./utils.js";
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
  modalDiscord,
  paintG,
  refreshGoogleSession,
  connectGoogle,
} from "./ui/modals.js";
import { discordConfigurado } from "./repositories/discord-config.js";
import { consumeDiscordRedirect, refreshDiscordRoles, isDiscordSignedIn } from "./repositories/discord-auth.js";
import { sincronizarSeriesDeDiscord } from "./services/discord-series-service.js";
import { pullCloudState, pullFirestoreState, pushFirestoreState } from "./services/cloud-sync-service.js";
import { onAuthChange, getCurrentUser, linkGoogleToFirebase } from "./repositories/auth-email.js";
import { loadUserData, saveUserData } from "./repositories/user-data.js";
import { showLoginScreen, hideLoginScreen } from "./ui/login-screen.js";
import { TESTER_EMAILS } from "./repositories/firebase-config.js";

// ── Discord: capturar la vuelta del redirect ANTES de pintar nada ──
// El token viene en el fragmento de la URL; consumeDiscordRedirect lo guarda y
// deja la URL limpia para que no quede a la vista ni en el historial.
if (discordConfigurado()) {
  try {
    await consumeDiscordRedirect();
  } catch (e) {
    toast("No se pudo conectar Discord: " + (e?.message || "error"));
  }
}

// ── Auth: login screen + Firebase Auth listener ────────────────────
showLoginScreen();

try {
  await initAuth(DEFAULT_CLIENT_ID);
} catch (e) {}

// Firebase Auth (email/password) — se ejecuta cuando cambia el estado.
let fbUserReady = false;
onAuthChange(async (user) => {
  if (user && user.emailVerified) {
    const userData = await loadUserData(user.uid);
    if (userData) {
      // Merge Firestore → S (misma lógica que pullCloudState pero con datos del doc)
      const localUrls = new Set(S.series.filter((s) => s.sheetUrl).map((s) => s.sheetUrl));
      (userData.series || []).forEach((rs) => {
        if (!rs.sheetUrl || localUrls.has(rs.sheetUrl)) return;
        S.series.push({ id: uid(), name: rs.name, sheetUrl: rs.sheetUrl, chapters: [], ocultos: {} });
        localUrls.add(rs.sheetUrl);
      });
      const localAN = new Set(S.aliases.map((a) => a.trim().toLowerCase()));
      (userData.aliases || []).forEach((a) => {
        const n = a.trim().toLowerCase();
        if (n && !localAN.has(n)) { S.aliases.push(a); localAN.add(n); }
      });
      save();
    }
    hideLoginScreen();
    fbUserReady = true;
    await descubrirSeriesDeDiscord();
    await syncAll(false);
    render();
  } else if (user && !user.emailVerified) {
    // Mostrará el overlay de verificación (ya manejado por login-screen.js)
  }
});

// GIS silent login (para testers con Google OAuth)
trySilentLogin()
  .then(async (token) => {
    await linkGoogleToFirebase(token);
    await refreshGoogleSession();
    await pullCloudState();
    await descubrirSeriesDeDiscord();
    await syncAll(false);
    render();
    if (!fbUserReady) hideLoginScreen();
  })
  .catch(() => {});

// Refresca los roles (pueden haber cambiado en Discord) y agrega las series
// del catálogo que correspondan. Silencioso si Discord no está configurado o
// el usuario no lo conectó.
async function descubrirSeriesDeDiscord() {
  if (!discordConfigurado() || !isDiscordSignedIn()) return;
  try {
    await refreshDiscordRoles();
    const n = await sincronizarSeriesDeDiscord();
    if (n) toast(`${n} serie(s) agregadas desde tus roles de Discord`);
  } catch (e) {
    toast("No se pudieron traer las series de Discord: " + (e?.message || "error"));
  }
}

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
if (discordConfigurado()) {
  const bd = document.getElementById("bDiscord");
  bd.style.display = "";
  bd.onclick = modalDiscord;
}
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

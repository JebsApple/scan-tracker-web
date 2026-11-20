import { S, save, esMio } from "../state/store.js";
import {
  initAuth,
  requestToken,
  isSignedIn,
  signOut as gSignOut,
  fetchEmail,
  DEFAULT_CLIENT_ID,
} from "../repositories/auth-facade.js";
import { listSheetTabs, listSharedSheets } from "../repositories/sheets-repository.js";
import { fetchSheet, checkDesignations, syncAll } from "../services/sync-service.js";
import { pullCloudState, pushCloudState, pushUserData } from "../services/cloud-sync-service.js";
import { etapasDe, csvToChapters, nuevoCap } from "../services/etapas-service.js";
import { esOculto, capCompleto, esperandoGlobal, cargaPorPersona } from "../services/stats-service.js";
import { PRIOS, prioClass } from "../services/filters-service.js";
import { esc, uid, fmtDur, friendlyError, parseCSV } from "../utils.js";
import { icon } from "./icons.js";
import { toast } from "./toast.js";
import { selSerie, render } from "./render.js";
import { registrarSerie, listSeriesCatalog } from "../repositories/series-repository.js";
import { discordConfigurado } from "../repositories/discord-config.js";
import { getDiscordSession, discordLogin, discordLogout, misRolesDiscord } from "../repositories/discord-auth.js";
import { getCurrentUser, linkGoogleToFirebase } from "../repositories/auth-email.js";

const ovl = document.getElementById("ovl"), modal = document.getElementById("modal");
export function openM(html) {
  modal.innerHTML = html;
  ovl.classList.add("show");
  // El drawer de series (mobile) tiene z-index mayor que el modal — si queda
  // abierto por detrás confunde. Un modal reemplaza cualquier panel mobile
  // abierto, nunca conviven los dos.
  document.getElementById("side")?.classList.remove("open");
  document.getElementById("drawerBackdrop")?.classList.remove("open");
  document.getElementById("filtersPanel")?.classList.remove("open");
  document.getElementById("morePanel")?.classList.remove("open");
}
export function closeM() {
  ovl.classList.remove("show");
}
ovl.onclick = (e) => {
  if (e.target === ovl) closeM();
};

/** Confirmación propia en vez de confirm() nativo del sistema — un dialog
 * del OS entrena al usuario a tocar "OK" por reflejo; un botón rojo con
 * copy explícito dentro de la misma UI de la app pide una decisión real. */
export function confirmModal({ title, body, confirmLabel = "Eliminar", onConfirm }) {
  openM(`<h3>${esc(title)}</h3>
  <div class="fld"><div class="hint">${body}</div></div>
  <div class="mrow"><button class="btn" id="confirmCancel">Cancelar</button><button class="btn red" id="confirmOk">${esc(confirmLabel)}</button></div>`);
  document.getElementById("confirmCancel").onclick = closeM;
  document.getElementById("confirmOk").onclick = () => {
    closeM();
    onConfirm();
  };
}

let gMail = "";
export function paintG() {
  const b = document.getElementById("bGoogle");
  if (!b) return;
  if (isSignedIn()) {
    b.innerHTML = "● " + esc(gMail || "Google");
    b.style.borderColor = "var(--ok)";
  } else {
    b.innerHTML = `${icon("log-in")} Conectar Google`;
    b.style.borderColor = "";
  }
}
export async function refreshGoogleSession() {
  gMail = await fetchEmail();
  paintG();
}

/** Login real — separado de modalGoogle() para que el botón de la topbar lo
 * dispare directo en un solo toque cuando no hay sesión, en vez de forzar
 * abrir un modal que a su vez tiene otro botón adentro para lo mismo. */
export async function connectGoogle() {
  try {
    await initAuth(DEFAULT_CLIENT_ID);
    const token = await requestToken();
    // Una sola conexión de Google abre las dos sesiones: la de Sheets y la de
    // Firebase (que es la que necesitan las reglas de Firestore).
    await linkGoogleToFirebase(token);
    await refreshGoogleSession();
    toast("Sesión iniciada");
    const added = await pullCloudState();
    if (added) toast(`${added} serie(s) traídas de otro dispositivo`);
    syncAll(false).then(render);
    render();
    return true;
  } catch (e) {
    toast("Error: " + e.message);
    return false;
  }
}

export function modalAliases() {
  openM(`<h3>Mis nombres</h3>
  <div class="fld"><label>Alias con los que apareces en las hojas</label>
  <div style="display:flex;gap:8px"><input id="aliasIn" placeholder="ingresa tu alias"><button class="btn red" id="aliasAdd">Agregar</button></div>
  <div class="hint">Puedes pegar varios separados por coma. Se usan para el filtro "Mis tareas" (no distingue mayúsculas).</div>
  <div class="tagrow" id="aliasTags"></div></div>
  <div class="mrow"><button class="btn" id="aliasClose">Cerrar</button></div>`);
  const draw = () => {
    document.getElementById("aliasTags").innerHTML = S.aliases
      .map((a, i) => `<span class="tag">${esc(a)}<button data-i="${i}" class="delAliasBtn">${icon("x")}</button></span>`)
      .join("");
  };
  document.getElementById("aliasClose").onclick = closeM;
  document.getElementById("aliasTags").onclick = (e) => {
    const b = e.target.closest(".delAliasBtn");
    if (!b) return;
    S.aliases.splice(Number(b.dataset.i), 1);
    save();
    draw();
    render();
    pushUserData();
  };
  document.getElementById("aliasAdd").onclick = () => {
    const v = document.getElementById("aliasIn").value;
    v.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((a) => {
        if (!esMio(a)) S.aliases.push(a);
      });
    document.getElementById("aliasIn").value = "";
    pushUserData();
    save();
    draw();
    render();
  };
  draw();
}

export function modalGoogle() {
  openM(`<h3>Cuenta de Google</h3>
  <div class="fld"><label>Estado</label><div id="gSt" style="font-size:14px;color:var(--mut)"></div></div>
  <div class="mrow">
    <button class="btn" id="gOutB" style="display:none">Cerrar sesión</button>
    <button class="btn" id="gClose">Cerrar</button>
    <button class="btn red" id="gInB">${icon("log-in")} Iniciar sesión con Google</button>
  </div>`);
  const st = () => {
    document.getElementById("gSt").innerHTML = isSignedIn()
      ? `<span style="color:var(--ok)">● Conectado</span> ${esc(gMail)}`
      : "Sin sesión";
    document.getElementById("gOutB").style.display = isSignedIn() ? "" : "none";
    document.getElementById("gInB").style.display = isSignedIn() ? "none" : "";
  };
  document.getElementById("gClose").onclick = closeM;
  document.getElementById("gInB").onclick = async () => {
    const b = document.getElementById("gInB");
    b.textContent = "Conectando con Google...";
    b.disabled = true;
    await connectGoogle();
    st();
    b.innerHTML = `${icon("log-in")} Iniciar sesión con Google`;
    b.disabled = false;
  };
  document.getElementById("gOutB").onclick = () => {
    gSignOut();
    gMail = "";
    paintG();
    st();
    toast("Sesión cerrada");
  };
  st();
}

export function modalDashboard() {
  const totalSeries = S.series.length;
  let totalCaps = 0, totalDone = 0, totalUrg = 0;
  const rows = S.series
    .map((sr) => {
      const caps = sr.chapters.length;
      const done = sr.chapters.filter((c) => capCompleto(sr, c)).length;
      const urg = sr.chapters.filter((c) => c.prio === "URGENTE" && !capCompleto(sr, c)).length;
      totalCaps += caps;
      totalDone += done;
      totalUrg += urg;
      return `<tr><td>${esc(sr.name)}</td><td>${done}/${caps}</td><td>${caps ? Math.round((done / caps) * 100) : 0}%</td>
      <td>${urg ? `<span style="color:#ff6b69;font-weight:700">${urg}</span>` : "—"}</td></tr>`;
    })
    .join("");

  const cuellos = [...esperandoGlobal(S.series)].sort((a, b) => b[1] - a[1]);
  const cuellosRows = cuellos.map(([label, n]) => `<tr><td>${esc(label)}</td><td>${n}</td></tr>`).join("");

  const carga = [...cargaPorPersona(S.series)].sort((a, b) => b[1] - a[1]);
  const cargaRows = carga.map(([who, n]) => `<tr><td>${esc(who)}</td><td>${n}</td></tr>`).join("");

  openM(`<h3>Dashboard</h3>
  <div class="dashGrid">
    <div class="dashCard"><div class="n">${totalSeries}</div><div class="l">Series activas</div></div>
    <div class="dashCard"><div class="n">${totalDone}/${totalCaps}</div><div class="l">Capítulos completos</div></div>
    <div class="dashCard warn"><div class="n">${totalCaps ? Math.round((totalDone / totalCaps) * 100) : 0}%</div><div class="l">Progreso general</div></div>
    <div class="dashCard urg"><div class="n">${totalUrg}</div><div class="l">Urgentes pendientes</div></div>
  </div>
  <table class="dashTbl"><thead><tr><th>Serie</th><th>Completos</th><th>Progreso</th><th>Urgentes</th></tr></thead>
  <tbody>${rows || `<tr><td colspan="4" style="color:var(--mut)">Sin series aún.</td></tr>`}</tbody></table>

  <h3 style="margin-top:18px;font-size:15px">Cuellos de botella</h3>
  <div class="fld"><div class="hint">Etapas donde más capítulos están esperando, sumado en TODAS las series — dice dónde se traba el equipo en general.</div></div>
  <table class="dashTbl"><thead><tr><th>Etapa</th><th>Cap. esperando</th></tr></thead>
  <tbody>${cuellosRows || `<tr><td colspan="2" style="color:var(--mut)">Sin cuellos de botella detectados.</td></tr>`}</tbody></table>

  <h3 style="margin-top:18px;font-size:15px">Carga por persona</h3>
  <div class="fld"><div class="hint">Asignaciones incompletas por persona en TODAS las series (excluye capítulos ocultos).</div></div>
  <table class="dashTbl"><thead><tr><th>Persona</th><th>Pendientes</th></tr></thead>
  <tbody>${cargaRows || `<tr><td colspan="2" style="color:var(--mut)">Sin asignaciones pendientes.</td></tr>`}</tbody></table>

  <div class="mrow">
    <button class="btn" id="dashLog" style="margin-right:auto;color:var(--mut)">Registro de errores${S.log.length ? ` (${S.log.length})` : ""}</button>
    <button class="btn" id="dashClose">Cerrar</button>
  </div>`);
  document.getElementById("dashClose").onclick = closeM;
  document.getElementById("dashLog").onclick = modalLog;
}

function modalLog() {
  const rows = S.log
    .slice(0, 100)
    .map((l) => {
      const f = new Date(l.fecha);
      return `<tr><td>${f.toLocaleDateString()} ${f.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
      <td>${esc(l.tipo)}</td><td>${esc(l.detalle)}</td></tr>`;
    })
    .join("");
  openM(`<h3>Registro de errores</h3>
  <div class="fld"><div class="hint">Últimos fallos de sincronización o escritura a Google Sheets, más recientes primero.</div></div>
  <table class="dashTbl"><thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th></tr></thead>
  <tbody>${rows || `<tr><td colspan="3" style="color:var(--mut)">Sin errores registrados.</td></tr>`}</tbody></table>
  <div class="mrow">
    <button class="btn" id="logClear" style="margin-right:auto;color:var(--mut)">Limpiar</button>
    <button class="btn" id="logExport">Exportar</button>
    <button class="btn" id="logClose">Cerrar</button>
  </div>`);
  document.getElementById("logClose").onclick = closeM;
  document.getElementById("logClear").onclick = () => {
    S.log = [];
    save();
    closeM();
    toast("Registro limpiado");
  };
  document.getElementById("logExport").onclick = () => {
    const txt = S.log.map((l) => `${l.fecha}\t${l.tipo}\t${l.detalle}`).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain" }));
    a.download = "scantracker-log.txt";
    a.click();
  };
}

export function modalHistorial() {
  const rows = S.historial
    .slice(0, 100)
    .map((h) => {
      const f = new Date(h.fecha);
      return `<tr><td>${f.toLocaleDateString()} ${f.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
      <td>${esc(h.serie)}</td><td>${esc(h.cap)}</td><td>${esc(h.etapa)}</td><td>${fmtDur(h.durMs)}</td></tr>`;
    })
    .join("");
  openM(`<h3>Mi historial</h3>
  <div class="fld"><div class="hint">Capítulos que completaste, más recientes primero. "Duración" es desde que se te asignó hasta que marcaste listo.</div></div>
  <table class="dashTbl"><thead><tr><th>Fecha</th><th>Serie</th><th>Cap</th><th>Etapa</th><th>Duración</th></tr></thead>
  <tbody>${rows || `<tr><td colspan="5" style="color:var(--mut)">Todavía no completaste nada.</td></tr>`}</tbody></table>
  <div class="mrow"><button class="btn" id="histClose">Cerrar</button></div>`);
  document.getElementById("histClose").onclick = closeM;
}

// Cruza TODAS las series (no solo la abierta) y junta los capítulos donde
// tengo alguna etapa asignada e incompleta — antes había que abrir cada
// pestaña de serie para verlo, uno por uno.
export function modalMisPendientes() {
  const items = [];
  S.series.forEach((sr) => {
    sr.chapters.forEach((c) => {
      if (esOculto(sr, c)) return;
      etapasDe(sr).forEach(([k, label]) => {
        if (esMio(c[k].who) && !c[k].done) items.push({ serieId: sr.id, serieName: sr.name, cap: c.num, etapa: label, prio: c.prio });
      });
    });
  });
  const rank = (p) => {
    const i = PRIOS.indexOf(p);
    return i < 0 ? PRIOS.length : i;
  };
  items.sort((a, b) => rank(a.prio) - rank(b.prio));
  const rows = items
    .map(
      (it) => `<tr><td>${esc(it.serieName)}</td><td class="cap">${esc(it.cap)}</td><td>${esc(it.etapa)}</td>
    <td><span class="prio ${prioClass(it.prio)}">${esc(it.prio || "—")}</span></td>
    <td><button class="btn" data-jumpserie="${it.serieId}">Ir</button></td></tr>`,
    )
    .join("");
  openM(`<h3>Mis pendientes</h3>
  <div class="fld"><div class="hint">Capítulos de TODAS tus series donde tienes una etapa asignada e incompleta.</div></div>
  <table class="dashTbl"><thead><tr><th>Serie</th><th>Cap</th><th>Etapa</th><th>Prioridad</th><th></th></tr></thead>
  <tbody>${rows || `<tr><td colspan="5" style="color:var(--mut)">Sin pendientes — al día.</td></tr>`}</tbody></table>
  <div class="mrow"><button class="btn" id="pendClose">Cerrar</button></div>`);
  document.getElementById("pendClose").onclick = closeM;
  modal.querySelectorAll("[data-jumpserie]").forEach((b) => (b.onclick = () => {
    selSerie(b.dataset.jumpserie);
    closeM();
  }));
}

let pendingFileCSV = null;

export function modalSerie() {
  openM(`<h3>Nueva serie</h3>
  <div class="fld"><label>Nombre</label><input id="snName" placeholder="Nombre de la serie"></div>
  <div class="fld"><label>Fuente</label><select id="snSrc">
    <option value="manual">Manual (vacía)</option>
    <option value="gsheet">Google Sheets (vinculada, se sincroniza)</option>
    <option value="paste">Pegar CSV</option>
    <option value="file">Archivo CSV local</option></select></div>
  <div class="fld" id="snUrlF" style="display:none"><label>URL de la hoja</label>
    <div style="display:flex;gap:8px"><button class="btn" id="snDriveBtn" type="button">Elegir de "Compartidos conmigo"</button></div>
    <select id="snDriveSel" style="display:none;margin-top:8px"></select>
    <div style="display:flex;gap:8px;margin-top:8px"><input id="snUrl" placeholder="...o pegue la URL directamente"><button class="btn" id="snTabsBtn" type="button">Elegir pestaña</button></div>
    <select id="snTabsSel" style="display:none;margin-top:8px"></select>
    <div class="hint">Con sesión de Google iniciada funciona con hojas <b>privadas</b> (las que tu cuenta puede ver) y los cambios se escriben de vuelta. Sin sesión, la hoja debe ser pública y agregar #gid= a mano si no es la primera pestaña. Se re-sincroniza cada 5 min y con ${icon("refresh-cw")}.</div></div>
  <div class="fld" id="snRoleF" style="display:none"><label>Rol de Discord (opcional)</label>
    <input id="snRole" placeholder="ID del rol que trabaja esta serie">
    <input id="snRoleName" placeholder="Nombre del rol (para reconocerlo después)" style="margin-top:8px">
    <div class="hint">Si lo llenas, la serie queda en el catálogo compartido: todos los que tengan ese rol en Discord la ven aparecer sola, sin pegar la URL. El acceso a la hoja lo sigue dando Google — recuerda compartirla con ellos.</div></div>
  <div class="fld" id="snPasteF" style="display:none"><label>CSV (con encabezado Capítulos,Prioridad,TRADUCCIÓN,LISTO,...)</label><textarea id="snPaste"></textarea></div>
  <div class="fld" id="snNF"><label>Capítulos iniciales</label><input id="snN" type="number" value="10" min="0"></div>
  <div class="mrow"><button class="btn" id="snCancel">Cancelar</button><button class="btn red" id="snOk">Crear</button></div>`);
  const src = document.getElementById("snSrc");
  src.onchange = () => {
    document.getElementById("snUrlF").style.display = src.value === "gsheet" ? "" : "none";
    document.getElementById("snRoleF").style.display =
      src.value === "gsheet" && discordConfigurado() ? "" : "none";
    document.getElementById("snPasteF").style.display = src.value === "paste" ? "" : "none";
    document.getElementById("snNF").style.display = src.value === "manual" ? "" : "none";
    if (src.value === "file") document.getElementById("csvFile").click();
  };
  document.getElementById("snCancel").onclick = closeM;
  document.getElementById("snDriveBtn").onclick = async () => {
    if (!isSignedIn()) return toast("Inicie sesión con Google primero (botón 'Conectar Google')");
    const btn = document.getElementById("snDriveBtn");
    btn.textContent = "Cargando...";
    btn.disabled = true;
    try {
      const files = await listSharedSheets();
      const sel = document.getElementById("snDriveSel");
      sel.innerHTML = `<option value="">— Seleccione una hoja —</option>` + files.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join("");
      sel.style.display = "";
      sel.onchange = () => {
        if (!sel.value) return;
        document.getElementById("snUrl").value = `https://docs.google.com/spreadsheets/d/${sel.value}/edit`;
        document.getElementById("snTabsSel").style.display = "none";
      };
      if (!files.length) toast("No se encontraron Sheets en 'Compartidos conmigo'");
    } catch (e) {
      toast("No se pudo listar Drive: " + friendlyError(e));
    }
    btn.textContent = "Elegir de \"Compartidos conmigo\"";
    btn.disabled = false;
  };
  document.getElementById("snTabsBtn").onclick = async () => {
    const url = document.getElementById("snUrl").value.trim();
    if (!url) return toast("Pegue la URL de la hoja primero");
    if (!isSignedIn()) return toast("Inicie sesión con Google para listar las pestañas de una hoja privada");
    const btn = document.getElementById("snTabsBtn");
    btn.textContent = "Cargando...";
    btn.disabled = true;
    try {
      const tabs = await listSheetTabs(url);
      const sel = document.getElementById("snTabsSel");
      sel.innerHTML = tabs.map((t) => `<option value="${t.gid}">${esc(t.title)}</option>`).join("");
      sel.style.display = "";
      sel.onchange = () => {
        const base = url.split("#")[0];
        document.getElementById("snUrl").value = `${base}#gid=${sel.value}`;
      };
      if (tabs.length) sel.onchange();
    } catch (e) {
      toast("No se pudieron listar las pestañas: " + friendlyError(e));
    }
    btn.textContent = "Elegir pestaña";
    btn.disabled = false;
  };
  document.getElementById("csvFile").onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      pendingFileCSV = rd.result;
      toast("Archivo cargado: " + f.name);
    };
    rd.readAsText(f);
    e.target.value = "";
  };
  document.getElementById("snOk").onclick = async () => {
    const name = document.getElementById("snName").value.trim();
    if (!name) return toast("Falta el nombre");
    const v = src.value;
    if (v === "file" && !pendingFileCSV) return toast("Seleccione un archivo CSV primero");
    const sr = { id: uid(), name, sheetUrl: null, chapters: [], ocultos: {} };
    if (v === "manual") {
      const n = +document.getElementById("snN").value || 0;
      for (let i = 1; i <= n; i++) sr.chapters.push(nuevoCap(String(i), sr));
    } else if (v === "gsheet") {
      sr.sheetUrl = document.getElementById("snUrl").value.trim();
      try {
        await fetchSheet(sr);
        checkDesignations(sr);
      } catch (e) {
        toast("No se pudo leer la hoja: " + friendlyError(e));
      }
    } else if (v === "paste") {
      const r = csvToChapters(parseCSV(document.getElementById("snPaste").value));
      sr.chapters = r.chapters;
      sr.etapaDefs = r.etapaDefs;
    } else if (v === "file" && pendingFileCSV) {
      const r = csvToChapters(parseCSV(pendingFileCSV));
      sr.chapters = r.chapters;
      sr.etapaDefs = r.etapaDefs;
      pendingFileCSV = null;
    }
    // Registrar en el catálogo compartido para que la vean todos los del rol.
    // Si falla, la serie igual queda creada localmente — no se pierde trabajo.
    const roleId = document.getElementById("snRole")?.value.trim();
    if (v === "gsheet" && roleId && sr.sheetUrl) {
      try {
        sr.catalogId = await registrarSerie({
          name,
          sheetUrl: sr.sheetUrl,
          discordRoleId: roleId,
          roleName: document.getElementById("snRoleName")?.value.trim() || "",
          uid: getCurrentUser()?.uid || "",
        });
        toast("Serie publicada en el catálogo del scan");
      } catch (e) {
        toast("Serie creada, pero no se pudo publicar: " + friendlyError(e));
      }
    }

    S.series.push(sr);
    S.sel = sr.id;
    save();
    render();
    closeM();
    if (sr.sheetUrl) pushUserData();
  };
}

export function modalDiscord() {
  const s = getDiscordSession();
  if (!s) {
    openM(`<h3>Conectar Discord</h3>
    <div class="fld"><div class="hint">Al conectar tu cuenta de Discord, las series de los roles que tengas en el servidor del scan aparecen solas en tu lista — sin ir a buscar la URL de la hoja a Drive.<br><br>Solo se leen tu nombre y tus roles. La app no puede escribir nada en Discord ni ver tus mensajes.</div></div>
    <div class="mrow"><button class="btn" id="dcCancel">Cancelar</button><button class="btn red" id="dcIn">Conectar Discord</button></div>`);
    document.getElementById("dcCancel").onclick = closeM;
    document.getElementById("dcIn").onclick = discordLogin;
    return;
  }
  openM(`<h3>Discord</h3>
  <div class="fld"><label>Cuenta</label><div class="hint">${esc(s.user.name)}</div></div>
  <div class="fld"><label>Roles en el servidor</label><div class="hint">${s.roles.length} rol(es). Las series que te correspondan se agregan al sincronizar.</div></div>
  <div class="fld"><label>Catálogo del scan</label>
    <div class="hint">Qué hoja corresponde a qué rol. "Mío" marca los roles que tienes tú.</div>
    <div id="dcCat" style="margin-top:10px;font-size:12.5px;color:var(--mut)">Cargando…</div></div>
  <div class="mrow"><button class="btn" id="dcOut" style="margin-right:auto;color:var(--mut)">Desconectar</button><button class="btn" id="dcClose">Cerrar</button></div>`);
  document.getElementById("dcClose").onclick = closeM;

  // El catálogo se pinta aparte porque viene de Firestore — el modal no espera
  // por la red para abrirse.
  listSeriesCatalog()
    .then((cat) => {
      const el = document.getElementById("dcCat");
      if (!el) return; // el usuario cerró el modal mientras cargaba
      const mios = new Set(misRolesDiscord());
      el.innerHTML = cat.length
        ? `<table class="dashTbl"><thead><tr><th>Serie</th><th>Rol</th><th></th></tr></thead><tbody>${cat
            .map(
              (c) => `<tr><td>${esc(c.name)}</td>
              <td>${esc(c.roleName || "—")}<br><span style="font-size:11px;opacity:.6">${esc(c.discordRoleId)}</span></td>
              <td>${mios.has(c.discordRoleId) ? `<span style="color:var(--ok)">Mío</span>` : ""}</td></tr>`,
            )
            .join("")}</tbody></table>`
        : "Todavía no hay series publicadas en el catálogo.";
    })
    .catch((e) => {
      const el = document.getElementById("dcCat");
      if (el) el.textContent = "No se pudo leer el catálogo: " + friendlyError(e);
    });
  document.getElementById("dcOut").onclick = () => {
    discordLogout();
    closeM();
    toast("Discord desconectado");
    render();
  };
}

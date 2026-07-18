// Runner de Background Runner (Capacitor) — corre en un motor JS aislado,
// SIN acceso a localStorage/DOM/módulos ES del resto de la app. Solo tiene
// los globals que documenta el plugin: CapacitorKV, CapacitorNotifications,
// fetch, addEventListener. Sin estado entre llamadas — cualquier dato
// persistente vive en CapacitorKV.
//
// Solo monitorea Sheets PÚBLICOS (gviz, sin login) — este contexto no puede
// abrir el popup de OAuth de Google, así que no hay forma de leer un Sheet
// privado desde acá.

// Consume el caracter en posición i estando dentro de comillas.
// Devuelve la posición del último caracter consumido.
function csvQuoted(txt, i, st) {
  const c = txt[i];
  if (c !== '"') { st.cur += c; return i; }
  if (txt[i + 1] === '"') { st.cur += '"'; return i + 1; }
  st.q = false;
  return i;
}

// Consume el caracter en posición i fuera de comillas.
// Devuelve la posición del último caracter consumido.
function csvBare(txt, i, st, rows) {
  const c = txt[i];
  if (c === '"') { st.q = true; return i; }
  if (c === ',') { st.row.push(st.cur); st.cur = ""; return i; }
  if (c === '\n' || c === '\r') {
    const skip = c === '\r' && txt[i + 1] === '\n' ? 1 : 0;
    st.row.push(st.cur); rows.push(st.row); st.row = []; st.cur = "";
    return i + skip;
  }
  st.cur += c;
  return i;
}

function parseCSV(txt) {
  const rows = [];
  const st = { row: [], cur: "", q: false };
  let i = 0;
  while (i < txt.length) {
    i = (st.q ? csvQuoted(txt, i, st) : csvBare(txt, i, st, rows)) + 1;
  }
  if (st.cur || st.row.length) { st.row.push(st.cur); rows.push(st.row); }
  return rows;
}

function detectEtapaDefs(headerRow) {
  const defs = [];
  for (let i = 2, k = 0; i + 1 < headerRow.length + 1 && k < 5; i += 2, k++) {
    const label = String(headerRow[i] || "").trim();
    if (!label) break;
    defs.push(label);
  }
  return defs;
}

// Devuelve {num, who, done}[] aplanado — una entrada por celda who/done,
// suficiente para detectar designaciones sin reconstruir el modelo completo.
function parseSheet(rows) {
  let start = 0, headerRow = null;
  for (let i = 0; i < Math.min(rows.length, 3); i++) {
    if (rows[i].some((c) => /^cap/i.test(String(c).trim()))) { headerRow = rows[i]; start = i + 1; break; }
  }
  if (!headerRow) return [];
  const etapaDefs = detectEtapaDefs(headerRow);
  const out = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] || !String(r[0]).trim()) continue;
    const num = String(r[0]).trim();
    etapaDefs.forEach((label, idx) => {
      const whoCol = 2 + idx * 2, doneCol = 3 + idx * 2;
      const who = String(r[whoCol] || "").trim();
      const done = String(r[doneCol] || "").trim().toUpperCase() === "TRUE";
      if (who) out.push({ num: num, etapa: label, who: who, done: done });
    });
  }
  return out;
}

function gvizUrl(url) {
  const m = url.match(/\/d\/([\w-]+)/);
  if (!m) return null;
  const g = url.match(/[#&?]gid=(\d+)/);
  return "https://docs.google.com/spreadsheets/d/" + m[1] + "/gviz/tq?tqx=out:csv" + (g ? "&gid=" + g[1] : "");
}

function loadConfig() {
  const raw = CapacitorKV.get("mobileMonitorConfig").value;
  if (!raw) return { sheets: [], aliases: [] };
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.warn("mobileMonitorConfig corrupto, se ignora:", e);
    return { sheets: [], aliases: [] };
  }
}

function esMio(who, aliases) {
  const n = who.trim().toLowerCase();
  return aliases.some(function (a) { return a.trim().toLowerCase() === n; });
}

async function checkOneSheet(sheetUrl, aliases, notifyIdRef) {
  const u = gvizUrl(sheetUrl);
  if (!u) return;
  const res = await fetch(u);
  if (!res.ok) return; // hoja no pública o URL inválida — se ignora en silencio, es un chequeo periódico
  const text = await res.text();
  const cur = parseSheet(parseCSV(text));

  const snapKey = "snapshot:" + sheetUrl;
  const prevRaw = CapacitorKV.get(snapKey).value;
  const prev = prevRaw ? JSON.parse(prevRaw) : null;

  if (prev) {
    const prevMap = {};
    prev.forEach(function (e) { prevMap[e.num + "|" + e.etapa] = e.who; });
    cur.forEach(function (e) {
      const key = e.num + "|" + e.etapa;
      const wasMine = prevMap[key] ? esMio(prevMap[key], aliases) : false;
      const isMine = esMio(e.who, aliases);
      if (!wasMine && isMine && !e.done) {
        notifyIdRef.n++;
        CapacitorNotifications.schedule([{
          id: notifyIdRef.n,
          title: "Te asignaron un capítulo",
          body: "Cap. " + e.num + " — " + e.etapa,
          scheduleAt: new Date(),
        }]);
      }
    });
  }
  CapacitorKV.set(snapKey, JSON.stringify(cur));
}

addEventListener("checkDesignations", async (resolve, reject) => {
  try {
    const config = loadConfig();
    if (!config.sheets.length || !config.aliases.length) { resolve(); return; }
    const idCounterRaw = CapacitorKV.get("notifIdCounter").value;
    const notifyIdRef = { n: idCounterRaw ? Number.parseInt(idCounterRaw, 10) : 0 };
    for (const sheetUrl of config.sheets) {
      await checkOneSheet(sheetUrl, config.aliases, notifyIdRef);
    }
    CapacitorKV.set("notifIdCounter", String(notifyIdRef.n));
    resolve();
  } catch (e) {
    reject(e);
  }
});

// Dispatchado desde la app en foreground (App.tsx-equivalent en app.js) cada
// vez que el usuario guarda sus alias o series con Sheet público — así el
// chequeo en background sabe qué monitorear sin tener acceso al S de la app.
addEventListener("updateConfig", (resolve, reject, args) => {
  try {
    CapacitorKV.set("mobileMonitorConfig", JSON.stringify({
      sheets: args?.sheets || [],
      aliases: args?.aliases || [],
    }));
    resolve();
  } catch (e) {
    reject(e);
  }
});

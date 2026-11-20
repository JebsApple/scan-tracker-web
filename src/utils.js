// Utilidades puras compartidas — sin estado, sin DOM, sin HTTP.

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export const uid = () => Math.random().toString(36).slice(2, 9);

export const norm = (s) => (s || "").trim().toLowerCase();

export const isMyAlias = (n, aliases) => n && aliases.some((a) => norm(a) === norm(n));

export function fmtDur(ms) {
  if (ms == null) return "—";
  const h = Math.round(ms / 3600000);
  if (h < 1) return "<1h";
  if (h < 24) return h + "h";
  return Math.round(h / 24) + "d";
}

// Traduce errores de red/API a mensajes accionables. gvizUrl (fetch nativo)
// no trae `.status` estructurado, se extrae del prefijo "HTTP <code>".
export function friendlyError(e) {
  const status = e?.status ?? Number((String(e?.message || "").match(/HTTP (\d+)/) || [])[1]);
  if (status === 401) return "Sesión de Google vencida — reconecta en 'Conectar Google'";
  if (status === 403) return "Sin permiso para esta hoja — pídele al líder de la serie que le dé acceso a tu cuenta de Google";
  if (status === 404) return "Hoja no encontrada — revisa la URL (¿la borraron o cambiaron el gid?)";
  if (status === 429) return "Límite de solicitudes de Google alcanzado — espera un minuto y reintenta";
  if (!navigator.onLine) return "Sin conexión a internet";
  return e?.message || "Error desconocido";
}

export function parseCSV(txt) {
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) {
      if (c == '"') {
        if (txt[i + 1] == '"') { cur += '"'; i++; }
        else q = false;
      } else cur += c;
    } else {
      if (c == '"') q = true;
      else if (c == ',') { row.push(cur); cur = ""; }
      else if (c == '\n' || c == '\r') {
        if (c == '\r' && txt[i + 1] == '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = "";
      } else cur += c;
    }
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

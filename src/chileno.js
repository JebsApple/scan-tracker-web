// Easter egg: Modo Chileno — toca el logo para activar/desactivar.
// Reemplaza texto de la UI por español chileno post-render.
// Basado en research de modismos chilenos reales (cachai, weá, po, etc.)

const KEY = "chileno";

// [regex, reemplazo] — cada regex matchea un text node específico del DOM.
// No usar $ en botones porque los text nodes tienen espacio antes del ícono.
const MAP = [
  // ── Top bar ──
  [/Mis tareas/g, "Mis tareas po"],
  [/Exportar/g, "Exportar la wea"],
  [/Conectar Google/g, "Conectar con el Google"],

  // ── Sidebar ──
  [/Sin series\. Agrega una con \+ Serie\./g, "No hay na' po. Dale con + Serie."],

  // ── Empty state ──
  [/Selecciona o crea una serie para empezar\./g, "Elije o crea una serie pa' empezar po."],
  [/Selecciona una serie/g, "Elije una serie po"],

  // ── Table ──
  [/Nada que mostrar con estos filtros\./g, "No hay na' con estos filtros po."],

  // ── Filters (select options — text nodes exactos) ──
  [/Orden: Nº capítulo/g, "Orden: nº de weás"],
  [/Orden: urgencia/g, "Orden: la weá más urgente"],
  [/Toda prioridad/g, "Toda la priori'"],
  [/Toda etapa/g, "Todas las weá"],

  // ── Dashboard ──
  [/Series activas/g, "Series activas po"],
  [/Capítulos completos/g, "Caps. listos po"],
  [/Progreso general/g, "El progreso general"],
  [/Urgentes pendientes/g, "Urgentes pa'tras po"],
  [/Cuellos de botella/g, "Los que frena al equipo"],
  [/Carga por persona/g, "La carga de cada uno"],
  [/Sin series aún\./g, "No hay series po."],
  [/Sin cuellos de botella detectados\./g, "No se traba na', todo fluido."],
  [/Sin asignaciones pendientes\./g, "Nadie tiene na' pendiente."],
  [/Sin errores registrados\./g, "Cero errores po, todo bien."],

  // ── Modal confirm ──
  [/Registrar errores/g, "Registro de errores"],
  [/Exportar la wea/g, "Exportar la wea"],

  // ── Auth ──
  [/Sesión iniciada/g, "Ya te conectaste po"],
  [/Sesión cerrada/g, "Te desconectaste no'á"],
  [/Iniciar sesión con Google/g, "Entrar con el Google"],
  [/Conectando con Google\.\.\./g, "Conectando con el Google po..."],

  // ── Drive ──
  [/Compartidos conmigo/g, "Los que me compartieron"],
  [/No se encontraron Sheets en 'Compartidos conmigo'/g, "No encontré na' en Drive po."],

  // ── History ──
  [/Todavía no completaste nada\./g, "Aún no completai nada po."],
  [/Sin pendientes — al día\./g, "Todo al día po, sin pendientes."],

  // ── Modal new serie ──
  [/Nombre de la serie/g, "Nombre de la serie"],
  [/Manual \(vacía\)/g, "A mano (vacía)"],
  [/Pegar CSV/g, "Pegar un CSV"],
  [/Archivo CSV local/g, "CSV del compu"],
  [/Capítulos iniciales/g, "Cuántos capítulos"],

  // ── Modal aliases ──
  [/Alias con los que apareces en las hojas/g, "Los nicks con los que te encuentran"],

  // ── Tooltips (title attrs — se procesan aparte en chilenize()) ──
  [/Click para cambiar/g, "Toca pa' cambiar"],
  [/Ocultar capítulo \(sin raw todavía, no contar como pendiente\)/g, "Esconder la weá (no cuenta como pendiente)"],
  [/Mostrar capítulo \(contarlo de nuevo como pendiente\)/g, "Mostrar la weá (vuelve a contar)"],
  [/Eliminar capítulo/g, "Eliminar el capítulo"],
  [/Recargar hojas vinculadas de Google/g, "Recargar las hojas del Google"],
];

export function isChileno() {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function toggleChileno() {
  const next = !isChileno();
  try { localStorage.setItem(KEY, next ? "1" : "0"); } catch {}
  return next;
}

// WeakMap guarda el texto original de cada text node antes de chilenizar.
// Así, en render() subsiguiente, se restaura el original y se re-aplica limpio
// (evita "po po", "nojada nojada", etc.). Cuando se desactiva el modo,
// restaura los originales y no reaplica.
const origMap = new WeakMap();

function applyMap(str) {
  let t = str;
  for (const [re, rep] of MAP) {
    re.lastIndex = 0;
    t = t.replace(re, rep);
  }
  return t;
}

/** Reemplaza texto visible en los contenedores principales por chileno.
 *  Se llama al final de render(). Para #top/#side (estáticos, no se
 *  reconstruyen) guarda el texto original en el primer paso y lo restaura
 *  antes de re-aplicar, haciendo la función idempotente. */
export function chilenize() {
  const on = isChileno();

  for (const sel of ["#top", "#side", "#content", ".modal"]) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) {
      const n = tw.currentNode;
      if (origMap.has(n)) n.textContent = origMap.get(n);
      origMap.set(n, n.textContent);
      if (!on) continue;
      const t = applyMap(n.textContent);
      if (t !== n.textContent) n.textContent = t;
    }
  }

  // Placeholders
  document.querySelectorAll("[placeholder]").forEach((el) => {
    if (on) {
      if (!origMap.has(el)) origMap.set(el, el.placeholder);
      el.placeholder = applyMap(origMap.get(el));
    } else if (origMap.has(el)) {
      el.placeholder = origMap.get(el);
    }
  });

  // title attributes (tooltips) — solo en #content y .modal
  for (const sel of ["#content", ".modal"]) {
    const el = document.querySelector(sel);
    if (!el) continue;
    el.querySelectorAll("[title]").forEach((node) => {
      if (on) {
        if (!origMap.has(node)) origMap.set(node, node.title);
        node.title = applyMap(origMap.get(node));
      } else if (origMap.has(node)) {
        node.title = origMap.get(node);
      }
    });
  }
}

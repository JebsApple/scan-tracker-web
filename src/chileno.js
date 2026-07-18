// Easter egg: Modo Chileno — triple-click en el logo para activar.
// Reemplaza texto de la UI por español chileno post-render.

const KEY = "chileno";

// [regex, reemplazo] — solo aplica sobre texto renderizado, no sobre
// strings ya chilenizados (render() reemplaza innerHTML cada vez, así que
// no hay acumulación).
const MAP = [
  // Top bar & sidebar
  [/Mis tareas/g, "Mis tareas po"],
  [/Sincronizar$/g, "Sincronizar po"],
  [/Dashboard/g, "Tablero weón"],
  [/Mi historial/g, "Mi historial po"],
  [/Mis nombres/g, "Mis nombres po"],
  [/Exportar/g, "Exportar po"],
  [/Conectar Google/g, "Conectar Google po"],
  // Sidebar
  [/Sin series\. Agrega una con \+ Serie\./g, "Sin series po. Agrega una con + Serie nojada."],
  // Empty state
  [/Selecciona o crea una serie para empezar\./g, "Elije o crea una serie pa' empezar po."],
  [/Selecciona una serie/g, "Elije una serie po"],
  // Table
  [/Nada que mostrar con estos filtros\./g, "Nada que mostrar po con estos filtros."],
  // Dashboard
  [/Series activas/g, "Series activas po"],
  [/Capítulos completos/g, "Capítulos listos po"],
  [/Progreso general/g, "Progreso general po"],
  [/Urgentes pendientes/g, "Urgentes pendientes po"],
  [/Cuellos de botella/g, "Cuellos de botella weón"],
  [/Carga por persona/g, "Carga por persona po"],
  [/Sin cuellos de botella detectados\./g, "Sin cuellos de botella detectados po."],
  [/Sin asignaciones pendientes\./g, "Sin asignaciones pendientes po."],
  [/Sin errores registrados\./g, "Sin errores registrados po."],
  // Modal buttons
  [/Cancelar$/g, "Cancelar nojada"],
  // Auth
  [/Sesión iniciada/g, "Sesión iniciada po"],
  [/Sesión cerrada/g, "Sesión cerrada po"],
  [/Iniciar sesión con Google/g, "Iniciar sesión con Google po"],
  [/Conectando con Google\.\.\./g, "Conectando con Google po..."],
  // Drive
  [/Compartidos conmigo/g, "Compartidos conmigo po"],
  // History
  [/Todavía no completaste nada\./g, "Todavía no completaste nada po."],
  [/Sin pendientes — al día\./g, "Sin pendientes — al día po."],
  // Modals
  [/Alias con los que apareces en las hojas/g, "Alias con los que apareces en las hojas po"],
  [/Crear$/g, "Crear po"],
  [/Agregar$/g, "Agregar po"],
];

export function isChileno() {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function toggleChileno() {
  const next = !isChileno();
  try { localStorage.setItem(KEY, next ? "1" : "0"); } catch {}
  return next;
}

/** Reemplaza texto visible en los contenedores principales por chileno.
 *  Se llama al final de render() — render() reemplaza innerHTML cada vez,
 *  así que el DOM siempre está limpio y no hay riesgo de acumulación. */
export function chilenize() {
  if (!isChileno()) return;

  const walk = (root) => {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) {
      const n = tw.currentNode;
      let t = n.textContent;
      for (const [re, rep] of MAP) {
        re.lastIndex = 0;
        t = t.replace(re, rep);
      }
      if (t !== n.textContent) n.textContent = t;
    }
  };

  for (const sel of ["#top", "#side", "#content", ".modal"]) {
    const el = document.querySelector(sel);
    if (el) walk(el);
  }

  // Placeholders
  document.querySelectorAll("[placeholder]").forEach((el) => {
    let p = el.placeholder;
    for (const [re, rep] of MAP) {
      re.lastIndex = 0;
      p = p.replace(re, rep);
    }
    if (p !== el.placeholder) el.placeholder = p;
  });
}

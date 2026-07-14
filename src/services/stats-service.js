import { esMio } from "../state/store.js";
import { etapasDe } from "./etapas-service.js";

// Capítulos "ocultos" (ej. sin raw todavía, plantilla a futuro): se marcan
// por número de capítulo en sr.ocultos, NO en el capítulo mismo — el objeto
// capítulo se recrea con un id nuevo en cada sync, el número de capítulo es
// lo único estable entre syncs.
export const esOculto = (sr, c) => !!(sr.ocultos && sr.ocultos[c.num]);

export function toggleOculto(sr, num) {
  sr.ocultos = sr.ocultos || {};
  sr.ocultos[num] = !sr.ocultos[num];
}

export function progreso(sr) {
  let tot = 0, done = 0;
  sr.chapters.forEach((c) => {
    if (esOculto(sr, c)) return;
    etapasDe(sr).forEach(([k]) => {
      tot++;
      if (c[k].done) done++;
    });
  });
  return tot ? Math.round((done / tot) * 100) : 0;
}

export function misPend(sr) {
  let n = 0;
  sr.chapters.forEach((c) => {
    if (esOculto(sr, c)) return;
    etapasDe(sr).forEach(([k]) => {
      if (esMio(c[k].who) && !c[k].done) n++;
    });
  });
  return n;
}

export function capCompleto(sr, c) {
  return etapasDe(sr).every(([k]) => c[k].done);
}

// Urgentes que todavía me competen: si ya terminé TODAS mis etapas
// asignadas en un capítulo, dejar de contarlo como urgente para mí aunque
// el capítulo siga incompleto por otras personas (eso ya lo cubre esperando()).
export function urgentesParaMi(sr) {
  return sr.chapters.filter((c) => {
    if (esOculto(sr, c) || c.prio !== "URGENTE" || capCompleto(sr, c)) return false;
    const misEtapas = etapasDe(sr).filter(([k]) => esMio(c[k].who));
    if (misEtapas.length && misEtapas.every(([k]) => c[k].done)) return false;
    return true;
  }).length;
}

// Capítulos donde ya terminé mi etapa pero el capítulo sigue esperando otra —
// agrupados por cuál es la próxima etapa incompleta (el "cuello de botella").
// Las claves del resultado son [key,label] real de esa serie, no fijas,
// porque distintas hojas pueden nombrar sus etapas distinto.
export function esperando(sr) {
  const counts = new Map();
  sr.chapters.forEach((c) => {
    if (esOculto(sr, c) || capCompleto(sr, c)) return;
    if (!etapasDe(sr).some(([k]) => esMio(c[k].who) && c[k].done)) return;
    const next = etapasDe(sr).find(([k]) => !c[k].done);
    if (next) counts.set(next[1], (counts.get(next[1]) || 0) + 1);
  });
  return counts;
}

// Igual que esperando(), pero agregado sobre TODAS las series — para el
// Dashboard: muestra dónde se traba el equipo en general, no serie por serie.
export function esperandoGlobal(series) {
  const counts = new Map();
  series.forEach((sr) => {
    esperando(sr).forEach((n, label) => counts.set(label, (counts.get(label) || 0) + n));
  });
  return counts;
}

// Asignaciones incompletas por persona en TODAS las series (no solo mis
// alias — todo el equipo). Da visión de carga que hoy no existe en ningún
// lado de la app.
export function cargaPorPersona(series) {
  const counts = new Map();
  series.forEach((sr) => {
    sr.chapters.forEach((c) => {
      if (esOculto(sr, c)) return;
      etapasDe(sr).forEach(([k]) => {
        const who = (c[k].who || "").trim();
        if (who && !c[k].done) counts.set(who, (counts.get(who) || 0) + 1);
      });
    });
  });
  return counts;
}

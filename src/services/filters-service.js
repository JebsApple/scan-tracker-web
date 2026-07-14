import { norm } from "../utils.js";
import { etapasDe } from "./etapas-service.js";
import { capCompleto } from "./stats-service.js";

export const PRIOS = ["URGENTE", "MODERADO", "A TU TIEMPO"];
export const prioClass = (p) => (p === "URGENTE" ? "URGENTE" : p === "MODERADO" ? "MODERADO" : "ATU");

export function etapasVisibles(sr, filters) {
  return filters.etapa ? etapasDe(sr).filter(([k]) => k === filters.etapa) : etapasDe(sr);
}

export function filtrarCapitulos(sr, etapas, filters) {
  let chs = sr.chapters.filter((c) => {
    if (filters.prio && c.prio !== filters.prio) return false;
    if (filters.estado === "pend" && capCompleto(sr, c)) return false;
    if (filters.estado === "done" && !capCompleto(sr, c)) return false;
    const b = norm(filters.busca);
    if (b && !etapas.some(([k]) => norm(c[k].who).includes(b))) return false;
    return true;
  });
  if (filters.orden === "urgencia") {
    const rank = (p) => PRIOS.indexOf(p);
    chs = [...chs].sort((a, b) => rank(a.prio) - rank(b.prio));
  }
  return chs;
}

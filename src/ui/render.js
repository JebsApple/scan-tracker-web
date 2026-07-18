import { S, save, esMio } from "../state/store.js";
import { canUndo, canRedo } from "../state/history.js";
import { etapasDe, nuevoCap } from "../services/etapas-service.js";
import {
  esOculto,
  toggleOculto as toggleOcultoStat,
  progreso,
  misPend,
  capCompleto,
  urgentesParaMi,
  esperando,
} from "../services/stats-service.js";
import { PRIOS, prioClass, etapasVisibles, filtrarCapitulos } from "../services/filters-service.js";
import { pushCell, pushNewRow, pushDelRow, COLW } from "../services/sync-service.js";
import { esc } from "../utils.js";
import { icon } from "./icons.js";
import { confirmModal } from "./modals.js";
import { pushUserData } from "../services/cloud-sync-service.js";
import { isSignedIn } from "../repositories/auth-facade.js";
import { chilenize } from "../chileno.js";

export function render() {
  // sidebar
  const sl = document.getElementById("serieList");
  sl.innerHTML =
    S.series
      .map((sr) => {
        const p = progreso(sr), mp = misPend(sr);
        const urg = urgentesParaMi(sr);
        const esp = esperando(sr);
        const espBadges = [...esp.entries()]
          .map(
            ([label, n]) =>
              `<span class="e" title="${n} capítulo(s) donde terminaste tu parte, esperando ${esc(label.toLowerCase())}">E.${esc(label)} ${n}</span>`,
          )
          .join("");
        return `<div class="serie ${S.sel === sr.id ? "sel" : ""}" data-sel="${sr.id}">
      <div class="nm"><span>${esc(sr.name)}</span><span>${p}%</span></div>
      <div class="pbar"><i style="width:${p}%"></i></div>
      <div class="mt">${urg ? `<span class="u">${icon("alert-triangle")} ${urg} urgentes</span>` : ""}${mp ? `<span class="m">${mp} mías</span>` : ""}${espBadges}${sr.sheetUrl ? `<span title="Vinculada a Google Sheets">${icon("cloud")} ${sr.lastSync || ""}</span>` : ""}</div>
    </div>`;
      })
      .join("") || `<div style="padding:14px;color:var(--mut);font-size:12.5px">Sin series. Agrega una con + Serie.</div>`;

  const sr = S.series.find((x) => x.id === S.sel);
  document.getElementById("fPrio").value = S.filters.prio;
  document.getElementById("fEstado").value = S.filters.estado;
  // Las opciones de etapa dependen de la serie seleccionada — distintas hojas
  // pueden tener distinta cantidad/nombre de etapas.
  const fEtapaEl = document.getElementById("fEtapa");
  fEtapaEl.innerHTML =
    `<option value="">Toda etapa</option>` +
    etapasDe(sr)
      .map(([k, label]) => `<option value="${k}">${esc(label)}</option>`)
      .join("");
  fEtapaEl.value = S.filters.etapa;
  document.getElementById("fOrden").value = S.filters.orden;

  const ct = document.getElementById("content");
  if (!sr) {
    ct.innerHTML = `<div id="empty"><div class="big">Scan<span style="color:var(--red)">Tracker</span></div><div>Selecciona o crea una serie para empezar.</div></div>`;
    paintUndoRedo();
    chilenize();
    return;
  }

  const etapas = etapasVisibles(sr, S.filters);
  const chs = filtrarCapitulos(sr, etapas, S.filters);

  const head = `<div id="serieHead">
    <h2>${esc(sr.name)}</h2>
    <span class="stats">${sr.chapters.length} caps · ${progreso(sr)}% · ${sr.chapters.filter((c) => capCompleto(sr, c)).length} completos</span>
    <div class="sp"></div>
    <button class="btn" data-addcap="${sr.id}">+ Capítulo</button>
    <button class="btn" data-delserie="${sr.id}" style="color:var(--mut)">Eliminar serie</button>
  </div>`;

  const rows = chs
    .map((c) => {
      const mine = etapas.some(([k]) => esMio(c[k].who) && !c[k].done);
      const cells = etapas
        .map(([k]) => {
          const st = c[k], me = esMio(st.who);
          return `<td><div class="stage">
        <button class="ck ${st.done ? "done" : me ? "pend-me" : ""}" title="${st.done ? "Listo" : "Pendiente"}" data-tg="${sr.id}|${c.id}|${k}">${st.done ? icon("check") : ""}</button>
        <input type="text" class="${me ? "me" : ""}" value="${esc(st.who)}" placeholder="—" data-who="${sr.id}|${c.id}|${k}">
      </div></td>`;
        })
        .join("");
      const oculto = esOculto(sr, c);
      const rowClasses = [];
      if (mine) rowClasses.push("mine");
      if (c.prio === "URGENTE" && !capCompleto(sr, c)) rowClasses.push("urgent");
      if (oculto) rowClasses.push("hidden-cap");
      return `<tr class="${rowClasses.join(" ")}">
      <td class="cap">${esc(c.num)}</td>
      <td><span class="prio ${prioClass(c.prio)}" title="Click para cambiar" data-cycleprio="${sr.id}|${c.id}">${esc(c.prio || "—")}</span></td>
      ${cells}
      <td class="del">
        <button title="${oculto ? "Mostrar capítulo (contarlo de nuevo como pendiente)" : "Ocultar capítulo (sin raw todavía, no contar como pendiente)"}" data-toggleocult="${sr.id}|${c.num}">${oculto ? icon("eye-off") : icon("eye")}</button>
        <button title="Eliminar capítulo" data-delcap="${sr.id}|${c.id}">${icon("x")}</button>
      </td>
    </tr>`;
    })
    .join("");

  const tblWrap = ct.querySelector("#tblWrap");
  const scrollPos = tblWrap ? tblWrap.scrollTop : 0;
  ct.innerHTML =
    head +
    `<div id="tblWrap"><table><thead><tr>
    <th>Cap</th><th>Prioridad</th>${etapas.map((e) => `<th>${e[1]}</th>`).join("")}<th></th>
  </tr></thead><tbody>${rows || `<tr><td colspan="${etapas.length + 3}" style="color:var(--mut);padding:20px">Nada que mostrar con estos filtros.</td></tr>`}</tbody></table></div>`;
  const newTblWrap = ct.querySelector("#tblWrap");
  if (newTblWrap) newTblWrap.scrollTop = scrollPos;

  paintUndoRedo();
  chilenize();
}

function paintUndoRedo() {
  const bu = document.getElementById("bUndo"), br = document.getElementById("bRedo");
  if (!bu || !br) return;
  bu.disabled = !canUndo();
  br.disabled = !canRedo();
}

/* ============ ACCIONES (delegadas — sin globals inline) ============ */
export function selSerie(id) {
  S.sel = id;
  save();
  render();
}

function tg(s, c, k) {
  const sr = S.series.find((x) => x.id === s), ch = sr.chapters.find((x) => x.id === c);
  ch[k].done = !ch[k].done;
  const startKey = `${sr.id}|${ch.num}|${k}`;
  if (ch[k].done && esMio(ch[k].who)) {
    const t0 = S.startedAt[startKey];
    S.historial.unshift({
      fecha: new Date().toISOString(),
      serie: sr.name,
      cap: ch.num,
      etapa: (etapasDe(sr).find(([kk]) => kk === k) || [])[1] || k,
      durMs: t0 ? Date.now() - t0 : null,
    });
    delete S.startedAt[startKey];
  } else if (!ch[k].done) {
    delete S.startedAt[startKey];
  }
  save();
  render();
  pushCell(sr, ch, COLW[k][1], ch[k].done ? "TRUE" : "FALSE");
}

function setWho(s, c, k, v) {
  const sr = S.series.find((x) => x.id === s), ch = sr.chapters.find((x) => x.id === c);
  const startKey = `${sr.id}|${ch.num}|${k}`;
  const wasMine = esMio(ch[k].who);
  ch[k].who = v.trim();
  if (!wasMine && esMio(ch[k].who) && !ch[k].done) S.startedAt[startKey] = Date.now();
  save();
  render();
  pushCell(sr, ch, COLW[k][0], ch[k].who);
}

function cyclePrio(s, c) {
  const sr = S.series.find((x) => x.id === s), ch = sr.chapters.find((x) => x.id === c);
  ch.prio = PRIOS[(PRIOS.indexOf(ch.prio) + 1) % PRIOS.length];
  save();
  render();
  pushCell(sr, ch, "B", ch.prio);
}

function addCap(s) {
  const sr = S.series.find((x) => x.id === s);
  const last = sr.chapters.length ? sr.chapters[sr.chapters.length - 1].num : "0";
  const n = isNaN(+last) ? String(sr.chapters.length + 1) : String(+last + 1);
  const ch = nuevoCap(n, sr);
  sr.chapters.push(ch);
  save();
  render();
  pushNewRow(sr, ch);
}

function delCap(s, c) {
  const sr = S.series.find((x) => x.id === s);
  const ch = sr.chapters.find((x) => x.id === c);
  confirmModal({
    title: "Eliminar capítulo",
    body: `¿Eliminar el capítulo ${esc(ch.num)}?` + (sr.api ? " También se borra la fila en la hoja de Google." : ""),
    onConfirm: () => {
      sr.chapters = sr.chapters.filter((x) => x.id !== c);
      save();
      render();
      pushDelRow(sr, ch);
    },
  });
}

function delSerie(s) {
  const sr = S.series.find((x) => x.id === s);
  confirmModal({
    title: "Eliminar serie",
    body: `Se deja de trackear "${esc(sr.name)}" acá — el Sheet vinculado no se toca, los datos siguen ahí. Podés volver a agregarla pegando la URL de nuevo.`,
    onConfirm: () => {
      S.series = S.series.filter((x) => x.id !== s);
      if (S.sel === s) S.sel = S.series[0]?.id || null;
      save();
      render();
      if (sr.sheetUrl) pushUserData();
    },
  });
}

function toggleOculto(s, num) {
  const sr = S.series.find((x) => x.id === s);
  toggleOcultoStat(sr, num);
  save();
  render();
}

export function wireRenderEvents() {
  document.getElementById("serieList").addEventListener("click", (e) => {
    const el = e.target.closest("[data-sel]");
    if (el) selSerie(el.dataset.sel);
  });
  document.getElementById("content").addEventListener("click", (e) => {
    let el = e.target.closest("[data-tg]");
    if (el) {
      const [s, c, k] = el.dataset.tg.split("|");
      return tg(s, c, k);
    }
    el = e.target.closest("[data-cycleprio]");
    if (el) {
      const [s, c] = el.dataset.cycleprio.split("|");
      return cyclePrio(s, c);
    }
    el = e.target.closest("[data-delcap]");
    if (el) {
      const [s, c] = el.dataset.delcap.split("|");
      return delCap(s, c);
    }
    el = e.target.closest("[data-toggleocult]");
    if (el) {
      const [s, num] = el.dataset.toggleocult.split("|");
      return toggleOculto(s, num);
    }
    el = e.target.closest("[data-addcap]");
    if (el) return addCap(el.dataset.addcap);
    el = e.target.closest("[data-delserie]");
    if (el) return delSerie(el.dataset.delserie);
  });
  document.getElementById("content").addEventListener("change", (e) => {
    const el = e.target.closest("[data-who]");
    if (!el) return;
    const [s, c, k] = el.dataset.who.split("|");
    setWho(s, c, k, el.value);
  });
  document.getElementById("fPrio").onchange = (e) => {
    S.filters.prio = e.target.value;
    save();
    render();
  };
  document.getElementById("fEstado").onchange = (e) => {
    S.filters.estado = e.target.value;
    save();
    render();
  };
  document.getElementById("fEtapa").onchange = (e) => {
    S.filters.etapa = e.target.value;
    save();
    render();
  };
  document.getElementById("fOrden").onchange = (e) => {
    S.filters.orden = e.target.value;
    save();
    render();
  };
  document.getElementById("fBusca").oninput = (e) => {
    S.filters.busca = e.target.value;
    render();
  };
}

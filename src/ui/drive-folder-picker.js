// src/ui/drive-folder-picker.js
// Selector de carpeta destino en Drive para "crear serie nueva" — mismo
// comportamiento que DriveFolderPicker.tsx de TL2EDIT (navegar Mi unidad /
// Compartido conmigo, breadcrumbs, recordar última carpeta), maquetado con
// los estilos ya existentes (.modal, tokens.css), no los de TL2EDIT.
// Corre en su PROPIO overlay (no reusa el singleton openM/closeM de
// modals.js) para no perder el estado del modal "Nueva serie" que queda
// debajo.
import { listDriveFolders, listSharedFolders } from "../repositories/drive-api.js";
import { esc } from "../utils.js";

const LAST_FOLDER_KEY = "scantracker-drive-create-last-folder";
const ROOT_LABEL = { mydrive: "Mi unidad", shared: "Compartido conmigo" };

function loadLastFolder() {
  try {
    const raw = localStorage.getItem(LAST_FOLDER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.root !== "mydrive" && parsed?.root !== "shared") return null;
    return { root: parsed.root, path: Array.isArray(parsed.path) ? parsed.path : [] };
  } catch {
    return null;
  }
}

function saveLastFolder(root, path) {
  try {
    localStorage.setItem(LAST_FOLDER_KEY, JSON.stringify({ root, path }));
  } catch {
    // no crítico
  }
}

/** Abre el picker. onPick(folderId) se llama al confirmar "Crear aquí";
 * onCancel() al cerrar sin elegir. */
export function openDriveFolderPicker({ onPick, onCancel }) {
  const last = loadLastFolder();
  let root = last?.root || "mydrive";
  let path = last?.path || []; // [{id, name}]

  const overlay = document.createElement("div");
  overlay.className = "drivePickOvl";
  document.body.appendChild(overlay);

  const currentFolderId = () => (path.length ? path[path.length - 1].id : "root");
  const currentFolderName = () => (path.length ? path[path.length - 1].name : ROOT_LABEL[root]);

  function close(cb) {
    overlay.remove();
    cb?.();
  }

  async function loadFolders() {
    const listEl = overlay.querySelector("#dpList");
    if (!listEl) return;
    listEl.innerHTML = `<div class="hint">Cargando…</div>`;
    try {
      const items = root === "shared" && !path.length
        ? await listSharedFolders()
        : await listDriveFolders(currentFolderId());
      listEl.innerHTML = items.length
        ? items.map((f) => `<button type="button" class="btn dpFolder" data-id="${esc(f.id)}" data-name="${esc(f.name)}">📁 ${esc(f.name)}</button>`).join("")
        : `<div class="hint">Sin subcarpetas acá — "Crear aquí" guarda directo en ${esc(currentFolderName())}.</div>`;
      listEl.querySelectorAll(".dpFolder").forEach((b) => {
        b.onclick = () => {
          path = [...path, { id: b.dataset.id, name: b.dataset.name }];
          render();
        };
      });
    } catch (e) {
      listEl.innerHTML = `<div class="hint">No se pudo listar Drive: ${esc(e.message)}</div>`;
    }
  }

  function render() {
    const crumbLabels = [ROOT_LABEL[root], ...path.map((p) => p.name)];
    const crumbs = crumbLabels
      .map((n, i) => `<button type="button" class="dpCrumbBtn" data-idx="${i - 1}">${esc(n)}</button>`)
      .join(" › ");

    overlay.innerHTML = `<div class="modal drivePick">
      <h3>Elegir carpeta en Drive</h3>
      <div class="fld"><div style="display:flex;gap:8px">
        <button type="button" class="btn ${root === "mydrive" ? "red" : ""}" id="dpRootMy">Mi unidad</button>
        <button type="button" class="btn ${root === "shared" ? "red" : ""}" id="dpRootShared">Compartido conmigo</button>
      </div></div>
      <div class="dpCrumbs">${crumbs}</div>
      <div class="fld" id="dpList"></div>
      <div class="mrow">
        <button type="button" class="btn" id="dpCancel">Cancelar</button>
        <button type="button" class="btn red" id="dpOk">Crear aquí (${esc(currentFolderName())})</button>
      </div>
    </div>`;

    overlay.querySelector("#dpRootMy").onclick = () => { root = "mydrive"; path = []; render(); };
    overlay.querySelector("#dpRootShared").onclick = () => { root = "shared"; path = []; render(); };
    overlay.querySelectorAll(".dpCrumbBtn").forEach((b) => {
      b.onclick = () => { path = path.slice(0, Number(b.dataset.idx) + 1); render(); };
    });
    overlay.querySelector("#dpCancel").onclick = () => close(onCancel);
    overlay.querySelector("#dpOk").onclick = () => {
      saveLastFolder(root, path);
      const folderId = currentFolderId();
      close(() => onPick(folderId));
    };

    loadFolders();
  }

  render();
}

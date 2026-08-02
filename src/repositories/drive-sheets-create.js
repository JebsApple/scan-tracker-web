// src/repositories/drive-sheets-create.js
// Crea el spreadsheet de una serie de Scan Tracker COPANDO la plantilla del
// dueño (TEMPLATE_SPREADSHEET_ID, copia de "Lucky Mia" sin datos de
// capítulos) con Drive.files.copy, en vez de armarlo desde cero con addTable:
// la plantilla ya trae el formato real de producción (Table de Sheets con
// chips/colores/banding). El flujo ajusta el alto de la Table al
// `chapterCount` pedido, actualiza los dropdowns de "quién" con los aliases,
// escribe header + `chapterCount` filas y devuelve {id, url}. El dueño es el
// único usuario de este Drive, así que el copy siempre tiene permisos. Ver
// docs/superpowers/specs/2026-08-01-crear-series-estandar-drive-design.md
// para el contrato de columnas y el orden de pasos (debe coincidir con
// TL2EDIT: src/lib/scanTrackerSheet.ts, createScanTrackerSeries).
import { authedFetch } from "./sheets-api.js";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3/files";

// Plantilla de serie: copia de "Lucky Mia" (serie real del dueño) sin datos
// de capítulos, en su Drive personal — el dueño es el único usuario, así que
// Drive.files.copy siempre tiene permiso. Mismo ID que en TL2EDIT
// src/lib/scanTrackerSheet.ts (un solo Drive, misma cuenta). OJO al editar la
// plantilla: su Table debe conservar al menos 1 fila de datos formateada
// (templateRows) para que insert/deleteDimension hereden/recorten el formato.
const TEMPLATE_SPREADSHEET_ID = "1uPzjSfUF8laSepIYScyyCO5E9MxmwzYke-F5UQAvaII";

const HEADER = [
  "Capítulos", "Prioridad",
  "TRADUCCIÓN", "LISTO",
  "LIMPIEZA", "LISTO",
  "TYPEO", "LISTO",
  "CORRECCIÓN", "LISTO",
  "SUBE", "LISTO",
];

// Índices 0-based de las columnas "quién" (C,E,G,I,K) — columna DROPDOWN de
// la Table.
const WHO_COLUMNS = [2, 4, 6, 8, 10];

// Índices 0-based de las columnas "LISTO" (D,F,H,J,L) — checkbox real.
const LISTO_COLUMNS = [3, 5, 7, 9, 11];

// Opciones del dropdown de Prioridad (columna B) — mismas que
// filters-service.js PRIOS (sin el "LISTO" de filtros, que es un estado de
// filtrado, no una prioridad de hoja). Documentan el contrato: la plantilla
// ya trae estos valores aplicados en su Table.
const PRIORITY_VALUES = ["URGENTE", "MODERADO", "A TU TIEMPO"];

function chapterRow(num) {
  return [String(num), "URGENTE", "", "", "", "", "", "", "", "", "", ""];
}

/** Valida que `chapterCount` sea un entero en [1, 2000] — la hoja se ajusta a
 * ese alto (templateRows de la plantilla), así que 0 (hoja sin capítulos) no
 * tiene sentido en este flujo. */
function validateChapterCount(chapterCount) {
  if (!Number.isInteger(chapterCount) || chapterCount < 1 || chapterCount > 2000) {
    throw new Error("La cantidad de capítulos debe ser un número entero entre 1 y 2000.");
  }
}

/** Crea el spreadsheet de una serie copiando la plantilla del dueño directo a
 * `folderId`, ajusta la Table al `chapterCount` pedido (insert/delete de
 * filas + dropdowns de "quién" con `names`), escribe header + filas y
 * devuelve {id, url}. */
export async function createSeriesSheet({ name, folderId, chapterCount, names = [] }) {
  validateChapterCount(chapterCount);

  // 1. Copiar la plantilla directo a la carpeta elegida: el copy nace con
  //    `parents: [folderId]`, así que no hace falta PATCH de move.
  const copied = await authedFetch(`${DRIVE_BASE}/${TEMPLATE_SPREADSHEET_ID}/copy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, parents: [folderId] }),
  });
  const spreadsheetId = copied.id;

  // 2..5. Leer metadata de la copia, ajustar dimensiones + dropdowns de la
  //    Table y escribir header + filas. Todo lo posterior al copy va en
  //    try/catch: si algo falla, se borra la hoja recién copiada (best-effort)
  //    para no dejar huérfanos en Drive.
  try {
    // 2. Metadata real de la copia (sheetId/title de la pestaña y la Table de
    //    datos en la columna A — la plantilla puede tener tablitas sueltas
    //    ajenas, se ignoran).
    const meta = await authedFetch(`${SHEETS_BASE}/${spreadsheetId}?fields=sheets(properties,tables)`);
    const sheet = meta.sheets?.[0];
    const sheetProps = sheet?.properties;
    if (!sheetProps || sheetProps.sheetId == null || !sheetProps.title) {
      throw new Error("Google no devolvió la pestaña inicial del spreadsheet.");
    }
    const { sheetId, title } = sheetProps;
    const table = (sheet.tables || []).find((t) => t.range?.startColumnIndex === 0);
    if (!table) {
      throw new Error("La plantilla no tiene la Table esperada en la columna A.");
    }
    // Filas de datos que trae la plantilla (el rango de la Table incluye el
    // header). La plantilla conserva >= 1 fila formateada.
    const templateRows = table.range.endRowIndex - 1;

    // 3. Ajustar dimensiones (insert/delete) + reemplazar los dropdowns de
    //    "quién" de la Table, en un solo batchUpdate.
    const requests = [];
    if (chapterCount < templateRows) {
      requests.push({
        deleteDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: chapterCount + 1, endIndex: templateRows + 1 },
        },
      });
    } else if (chapterCount > templateRows) {
      requests.push({
        insertDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: templateRows + 1, endIndex: chapterCount + 1 },
          inheritFromBefore: true,
        },
      });
    }
    const whoListValues = names.map((n) => String(n).trim()).filter(Boolean);
    if (!whoListValues.length) whoListValues.push("-");
    requests.push({
      updateTable: {
        table: {
          tableId: table.tableId,
          columnProperties: table.columnProperties.map((col) =>
            WHO_COLUMNS.includes(col.columnIndex)
              ? { ...col, dataValidationRule: { condition: { type: "ONE_OF_LIST", values: whoListValues.map((n) => ({ userEnteredValue: n })) } } }
              : col,
          ),
          range: { ...table.range, endRowIndex: chapterCount + 1 },
        },
        fields: "columnProperties,range",
      },
    });
    await authedFetch(`${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    });

    // 4. Escribir header + filas de capítulos reales (RAW: texto literal,
    //    nunca fórmula).
    const rows = [HEADER, ...Array.from({ length: chapterCount }, (_, i) => chapterRow(i + 1))];
    const range = `'${title.replace(/'/g, "''")}'!A1:L${rows.length}`;
    await authedFetch(
      `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: rows }),
      },
    );

    return {
      id: spreadsheetId,
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`,
    };
  } catch (err) {
    // 5. Limpieza best-effort: la hoja recién copiada no debe quedar
    //    huérfana en Drive si falló algún paso posterior al copy.
    try {
      await authedFetch(`${DRIVE_BASE}/${spreadsheetId}`, { method: "DELETE" });
    } catch {
      // el DELETE es best-effort — se relanza el error original igual.
    }
    throw err;
  }
}

export { HEADER, WHO_COLUMNS, TEMPLATE_SPREADSHEET_ID };

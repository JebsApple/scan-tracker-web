// src/repositories/drive-sheets-create.js
// Crea un spreadsheet nuevo para una serie de Scan Tracker: la hoja arranca
// con una Table nativa de Sheets ("Capítulos", disponible en la API v4 —
// developers.google.com/workspace/sheets/api/guides/tables) con las 12
// columnas del contrato (A=num, B=prio, C/D..K/L = 5 etapas who/done),
// dropdowns de alias en las columnas quién y checkboxes reales en las LISTO,
// escribe header + `chapterCount` filas y devuelve {id, url}. Ver
// docs/superpowers/specs/2026-08-01-crear-series-estandar-drive-design.md
// para el contrato de columnas y el orden de pasos (debe coincidir con
// TL2EDIT: src/lib/scanTrackerSheet.ts, createScanTrackerSeries).
//
// Por qué crear con addTable en vez de copiar una plantilla: el chip de
// color que se ve en las hojas reales del usuario es el renderizado nativo
// de las columnas `DROPDOWN` de una Table de Sheets, y esa estructura sí se
// arma desde cero por API con `batchUpdate` + `addTable`. Copiar una
// plantilla compartida fallaba con 403 para cuentas que no fueran del dueño
// — Drive.files.copy exige permisos sobre el archivo fuente. Crear la Table
// por código funciona para cualquier cuenta, y el banding de la Table + el
// color de los chips de los dropdowns los asigna Sheets automáticamente.
import { authedFetch } from "./sheets-api.js";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3/files";

// Header fijo, fila 1 — contrato compartido (12 columnas: número, prioridad
// y 5 etapas pares who/done). El layout posicional es lo que detectan
// detectEtapaDefs/csvToChapters al leer la hoja después.
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

// Índices 0-based de las columnas "LISTO" (D,F,H,J,L) — checkbox real
// (columnType BOOLEAN de la Table).
const LISTO_COLUMNS = new Set([3, 5, 7, 9, 11]);

// Opciones del dropdown de Prioridad (columna B). Cuatro valores, incluido
// "LISTO" — el estado final de la columna en la hoja (el "LISTO" de filtros
// en filters-service.js es un estado de filtrado aparte, no una prioridad).
const PRIORITY_VALUES = ["URGENTE", "MODERADO", "A TU TIEMPO", "LISTO"];

function chapterRow(num) {
  return [String(num), "URGENTE", "", "", "", "", "", "", "", "", "", ""];
}

/** Valida que `chapterCount` sea un entero en [1, 2000] — la Table armada
 * con addTable cubre `chapterCount + 1` filas, así que 0 (hoja sin
 * capítulos) no tiene sentido en este flujo. */
function validateChapterCount(chapterCount) {
  if (!Number.isInteger(chapterCount) || chapterCount < 1 || chapterCount > 2000) {
    throw new Error("La cantidad de capítulos debe ser un número entero entre 1 y 2000.");
  }
}

/** Crea el spreadsheet nuevo desde cero con una Table nativa de Sheets
 * (columnas tipadas: DOUBLE en Capítulos, DROPDOWN en Prioridad y en las
 * columnas quién, BOOLEAN en las LISTO), congela la fila 1 y la pone en
 * negrita, escribe el header + `chapterCount` filas de capítulos y devuelve
 * {id, url}. `folderId` queda en la firma por compatibilidad con el caller
 * (src/ui/modals.js): el spreadsheet nace en la raíz de Mi unidad del
 * usuario que lo crea y el flujo aprobado no lo mueve. */
export async function createSeriesSheet({ name, folderId, chapterCount, names = [] }) {
  validateChapterCount(chapterCount);

  // 1. Crear el spreadsheet vacío; leer sheetId/title reales de la pestaña
  //    inicial (no asumir "Sheet1" ni gid 0).
  const created = await authedFetch(SHEETS_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { title: name } }),
  });
  const spreadsheetId = created.spreadsheetId;
  const sheetProps = created.sheets?.[0]?.properties;
  if (sheetProps?.sheetId == null || !sheetProps?.title) {
    throw new Error("Google no devolvió la pestaña inicial del spreadsheet.");
  }
  const { sheetId, title } = sheetProps;

  // 2..3. Table + fila congelada + header en negrita (un solo batchUpdate)
  //    y escribir los valores. Todo lo posterior a la creación va en
  //    try/catch: si algo falla, se borra la hoja recién creada
  //    (best-effort) para no dejar huérfanos en Drive.
  try {
    const cleanNames = names.map((n) => String(n).trim()).filter(Boolean);
    const whoListValues = cleanNames.length ? cleanNames : ["-"];

    // Columnas de la Table, en orden — coinciden con HEADER y con el layout
    // posicional que ya detectan detectEtapaDefs/csvToChapters al leer.
    const columnProperties = Array.from({ length: 12 }, (_, columnIndex) => {
      if (columnIndex === 0) {
        // Columna A: número de capítulo. Enum válido del API es DOUBLE (la
        // Table lo trata como numérico), no "NUMBER".
        return { columnIndex, columnName: HEADER[0], columnType: "DOUBLE" };
      }
      if (columnIndex === 1) {
        // Columna B: prioridad, dropdown de 4 valores.
        return {
          columnIndex,
          columnName: HEADER[1],
          columnType: "DROPDOWN",
          dataValidationRule: {
            condition: { type: "ONE_OF_LIST", values: PRIORITY_VALUES.map((v) => ({ userEnteredValue: v })) },
          },
        };
      }
      if (LISTO_COLUMNS.has(columnIndex)) {
        // Columnas LISTO: checkbox real. Enum válido es BOOLEAN, no
        // "CHECKBOX".
        return { columnIndex, columnName: "LISTO", columnType: "BOOLEAN" };
      }
      // Columnas quién (WHO_COLUMNS): dropdown con los aliases del usuario.
      return {
        columnIndex,
        columnName: HEADER[columnIndex],
        columnType: "DROPDOWN",
        dataValidationRule: {
          condition: { type: "ONE_OF_LIST", values: whoListValues.map((n) => ({ userEnteredValue: n })) },
        },
      };
    });

    // 2. Un solo batchUpdate, en este orden: addTable (Table nativa de
    //    Sheets) → congelar la fila 1 → header en negrita.
    await authedFetch(`${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            addTable: {
              table: {
                name: "Capítulos",
                tableId: "capitulos",
                range: {
                  sheetId,
                  startColumnIndex: 0,
                  endColumnIndex: 12,
                  startRowIndex: 0,
                  endRowIndex: chapterCount + 1,
                },
                columnProperties,
              },
            },
          },
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: "gridProperties.frozenRowCount",
            },
          },
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: 12,
              },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: "userEnteredFormat.textFormat.bold",
            },
          },
        ],
      }),
    });

    // 3. Escribir header + filas de capítulos reales (RAW: texto literal,
    //    nunca fórmula).
    const rows = [HEADER, ...Array.from({ length: chapterCount }, (_, i) => chapterRow(i + 1))];
    const range = `'${title.replaceAll("'", "''")}'!A1:L${rows.length}`;
    await authedFetch(
      `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: rows }),
      },
    );

    // 4. Mover a la carpeta elegida (el spreadsheet nace en la raíz de Mi
    //    unidad al crearse por API).
    await authedFetch(
      `${DRIVE_BASE}/${spreadsheetId}?addParents=${encodeURIComponent(folderId)}&removeParents=root`,
      { method: "PATCH" },
    );

    return {
      id: spreadsheetId,
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`,
    };
  } catch (err) {
    // 4. Limpieza best-effort: la hoja recién creada no debe quedar
    //    huérfana en Drive si falló algún paso posterior a la creación.
    try {
      await authedFetch(`${DRIVE_BASE}/${spreadsheetId}`, { method: "DELETE" });
    } catch {
      // el DELETE es best-effort — se relanza el error original igual.
    }
    throw err;
  }
}

export { HEADER, WHO_COLUMNS };

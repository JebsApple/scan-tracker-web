// src/repositories/drive-sheets-create.js
// Crea un spreadsheet nuevo con el formato estándar de Scan Tracker y lo
// mueve a la carpeta de Drive elegida por el usuario. Ver
// docs/superpowers/specs/2026-08-01-crear-series-estandar-drive-design.md
// para el contrato de columnas y el orden de pasos (debe coincidir con
// TL2EDIT: src/lib/scanTrackerSheet.ts, createScanTrackerSeries).
import { authedFetch } from "./sheets-api.js";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3/files";

const HEADER = [
  "Capítulos", "Prioridad",
  "TRADUCCIÓN", "LISTO",
  "LIMPIEZA", "LISTO",
  "TYPEO", "LISTO",
  "CORRECCIÓN", "LISTO",
  "SUBE", "LISTO",
];

// Índices 0-based de las columnas "LISTO" (D,F,H,J,L) — llevan checkbox real.
const LISTO_COLUMNS = [3, 5, 7, 9, 11];

function chapterRow(num) {
  return [String(num), "URGENTE", "", "", "", "", "", "", "", "", "", ""];
}

/** Crea el spreadsheet nuevo (checkboxes reales en las columnas LISTO, fila 1
 * en negrita y congelada), escribe `chapterCount` filas de capítulos, y lo
 * mueve a `folderId`. Devuelve {id, url}. */
export async function createSeriesSheet({ name, folderId, chapterCount }) {
  // 1. Crear el spreadsheet vacío — la pestaña por defecto trae su propio
  //    sheetId/title reales, no asumir "Sheet1"/0.
  const created = await authedFetch(SHEETS_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { title: name } }),
  });
  const spreadsheetId = created.spreadsheetId;
  const { sheetId, title } = created.sheets[0].properties;

  // 2. Escribir header + filas de capítulos.
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

  // 3. Formato: negrita + fila congelada + checkboxes reales.
  await authedFetch(`${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat.textFormat.bold",
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount",
          },
        },
        ...LISTO_COLUMNS.map((col) => ({
          setDataValidation: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex: rows.length,
              startColumnIndex: col,
              endColumnIndex: col + 1,
            },
            rule: { condition: { type: "BOOLEAN" }, strict: true },
          },
        })),
      ],
    }),
  });

  // 4. Mover a la carpeta elegida.
  await authedFetch(
    `${DRIVE_BASE}/${spreadsheetId}?addParents=${encodeURIComponent(folderId)}&removeParents=root`,
    { method: "PATCH" },
  );

  return {
    id: spreadsheetId,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`,
  };
}

export { HEADER, LISTO_COLUMNS };

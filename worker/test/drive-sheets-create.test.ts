// Tests de src/repositories/drive-sheets-create.js (la app web) — vitest
// corre desde worker/ con acceso al repo raíz (ver vitest.config.ts). El
// módulo sheets-api.js se mockea completo: no hay red real, authedFetch es
// una función que devuelve respuestas secuenciales según la URL.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authedFetch } = vi.hoisted(() => ({ authedFetch: vi.fn() }));
vi.mock('../../src/repositories/sheets-api.js', () => ({ authedFetch }));

import {
  createSeriesSheet,
  HEADER,
  WHO_COLUMNS,
  TEMPLATE_SPREADSHEET_ID,
} from '../../src/repositories/drive-sheets-create.js';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';

// ColumnProperties de la Table de la plantilla: las columnas "quién" traen un
// dropdown viejo (que el updateTable debe reemplazar), el resto sin validación.
const templateColumns = Array.from({ length: 12 }, (_, columnIndex) => ({
  columnIndex,
  columnName: `col${columnIndex}`,
  columnType: WHO_COLUMNS.includes(columnIndex) ? 'DROPDOWN' : 'DOUBLE',
  ...(WHO_COLUMNS.includes(columnIndex)
    ? { dataValidationRule: { condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'viejo' }] } } }
    : {}),
}));

/** authedFetch "fake" que replica las respuestas de la API según la URL:
 * copy (POST drive) → metadata (properties+tables) → batchUpdate → values.
 * `templateRows` = filas de datos que trae la plantilla; `failOn` permite
 * hacer fallar un paso puntual. */
function stubApi({
  failOn,
  title = 'Sheet1',
  templateRows = 3,
  noTable = false,
  spreadsheetId = 'SHEET1',
} = {}) {
  authedFetch.mockImplementation((url, options = {}) => {
    const u = String(url);
    if (failOn && failOn(u, options)) return Promise.reject(new Error(`falló: ${u}`));
    // 1. copy de la plantilla a la carpeta → id de la copia.
    if (u.includes('drive/v3/files') && u.includes('/copy') && options.method === 'POST') {
      return Promise.resolve({ id: spreadsheetId, name: JSON.parse(options.body).name });
    }
    // 2. metadata de la copia (properties + tables).
    if (u.includes('sheets(properties,tables)')) {
      return Promise.resolve({
        sheets: [
          {
            properties: { sheetId: 0, title },
            tables: noTable
              ? []
              : [
                  {
                    tableId: 'template-table',
                    range: {
                      sheetId: 0,
                      startRowIndex: 0,
                      endRowIndex: templateRows + 1,
                      startColumnIndex: 0,
                      endColumnIndex: 12,
                    },
                    columnProperties: templateColumns,
                  },
                ],
          },
        ],
      });
    }
    // 3. batchUpdate (dimensiones + updateTable).
    if (u.includes(':batchUpdate')) return Promise.resolve({ replies: [{ updateTable: {} }] });
    // 4. values.
    if (u.includes('/values/')) return Promise.resolve({ updates: { updatedRange: `'${title}'!A1:L11` } });
    return Promise.resolve({});
  });
}

beforeEach(() => {
  authedFetch.mockReset();
  stubApi();
});

describe('createSeriesSheet', () => {
  it('exporta el contrato compartido HEADER, WHO_COLUMNS y TEMPLATE_SPREADSHEET_ID', () => {
    expect(HEADER).toEqual([
      'Capítulos', 'Prioridad',
      'TRADUCCIÓN', 'LISTO',
      'LIMPIEZA', 'LISTO',
      'TYPEO', 'LISTO',
      'CORRECCIÓN', 'LISTO',
      'SUBE', 'LISTO',
    ]);
    expect(WHO_COLUMNS).toEqual([2, 4, 6, 8, 10]);
    expect(TEMPLATE_SPREADSHEET_ID).toBe('1uPzjSfUF8laSepIYScyyCO5E9MxmwzYke-F5UQAvaII');
  });

  it('happy path: copy → metadata → insertDimension + updateTable → values → {id, url}', async () => {
    const result = await createSeriesSheet({
      name: 'Mi serie',
      folderId: 'FOLDER1',
      chapterCount: 10, // > templateRows(3) → insertDimension
      names: ['Mati', 'Pau'],
    });

    expect(result).toEqual({
      id: 'SHEET1',
      url: 'https://docs.google.com/spreadsheets/d/SHEET1/edit#gid=0',
    });

    // 1. copy: POST al template con name y parents (nace en la carpeta).
    const copyCall = authedFetch.mock.calls.find(
      ([u, o]) => String(u).includes('drive/v3/files') && o.method === 'POST',
    );
    expect(copyCall).toBeTruthy();
    expect(String(copyCall[0])).toContain(`${DRIVE}/${TEMPLATE_SPREADSHEET_ID}/copy`);
    expect(JSON.parse(copyCall[1].body)).toEqual({ name: 'Mi serie', parents: ['FOLDER1'] });

    // 2. metadata de la copia leída con properties+tables.
    const metaCall = authedFetch.mock.calls.find(([u]) => String(u).includes('sheets(properties,tables)'));
    expect(metaCall).toBeTruthy();
    expect(String(metaCall[0])).toContain(`/spreadsheets/SHEET1?fields=sheets(properties,tables)`);

    // 3. batchUpdate: insertDimension de las filas faltantes + updateTable.
    const batchCall = authedFetch.mock.calls.find(([u]) => String(u).includes(':batchUpdate'));
    const requests = JSON.parse(batchCall[1].body).requests;
    const insert = requests.find((r) => r.insertDimension).insertDimension;
    expect(insert).toEqual({
      range: { sheetId: 0, dimension: 'ROWS', startIndex: 4, endIndex: 11 },
      inheritFromBefore: true,
    });

    const update = requests.find((r) => r.updateTable).updateTable;
    expect(update.fields).toBe('columnProperties,range');
    expect(update.table.tableId).toBe('template-table');
    expect(update.table.range).toEqual({
      sheetId: 0,
      startRowIndex: 0,
      endRowIndex: 11,
      startColumnIndex: 0,
      endColumnIndex: 12,
    });
    // Columnas quién: dropdown reemplazado por los aliases.
    for (const i of WHO_COLUMNS) {
      const col = update.table.columnProperties.find((c) => c.columnIndex === i);
      expect(col).toMatchObject({ columnIndex: i, columnName: `col${i}`, columnType: 'DROPDOWN' });
      expect(col.dataValidationRule.condition.type).toBe('ONE_OF_LIST');
      expect(col.dataValidationRule.condition.values.map((v) => v.userEnteredValue)).toEqual(['Mati', 'Pau']);
    }
    // Columnas no-quién: intactas (sin dataValidationRule nueva).
    for (let i = 0; i < 12; i++) {
      if (WHO_COLUMNS.includes(i)) continue;
      expect(update.table.columnProperties.find((c) => c.columnIndex === i)).toEqual(templateColumns[i]);
    }

    // 4. values: header + 10 filas, RAW.
    const valuesCall = authedFetch.mock.calls.find(([u]) => String(u).includes('/values/'));
    expect(String(valuesCall[0])).toContain(encodeURIComponent(`'Sheet1'!A1:L11`));
    expect(String(valuesCall[0])).toContain('valueInputOption=RAW');
    const values = JSON.parse(valuesCall[1].body).values;
    expect(values).toHaveLength(11);
    expect(values[0]).toEqual(HEADER);
    expect(values[1][0]).toBe('1');
    expect(values[10][0]).toBe('10');

    // Sin PATCH de move: el copy ya nace en la carpeta.
    expect(authedFetch.mock.calls.some(([u, o]) => String(u).includes('drive/v3/files') && o.method === 'PATCH')).toBe(false);
  });

  it('chapterCount < templateRows → deleteDimension (no insert) y updateTable recorta', async () => {
    await createSeriesSheet({ name: 'X', folderId: 'F', chapterCount: 2, names: [] }); // templateRows = 3

    const batchCall = authedFetch.mock.calls.find(([u]) => String(u).includes(':batchUpdate'));
    const requests = JSON.parse(batchCall[1].body).requests;
    expect(requests.some((r) => r.insertDimension)).toBe(false);
    expect(requests.find((r) => r.deleteDimension).deleteDimension).toEqual({
      range: { sheetId: 0, dimension: 'ROWS', startIndex: 3, endIndex: 4 },
    });
    expect(requests.find((r) => r.updateTable).updateTable.table.range.endRowIndex).toBe(3);
  });

  it('chapterCount == templateRows → solo updateTable, sin insert ni delete', async () => {
    await createSeriesSheet({ name: 'X', folderId: 'F', chapterCount: 3, names: [] }); // templateRows = 3

    const batchCall = authedFetch.mock.calls.find(([u]) => String(u).includes(':batchUpdate'));
    const requests = JSON.parse(batchCall[1].body).requests;
    expect(requests).toHaveLength(1);
    expect(requests[0].updateTable).toBeTruthy();
  });

  it('sin aliases, los dropdowns de "quién" se precargan con "-"', async () => {
    await createSeriesSheet({ name: 'X', folderId: 'F', chapterCount: 10, names: [] });
    const batchCall = authedFetch.mock.calls.find(([u]) => String(u).includes(':batchUpdate'));
    const cols = JSON.parse(batchCall[1].body).requests.find((r) => r.updateTable).updateTable.table.columnProperties;
    const who = cols.find((c) => c.columnIndex === 2).dataValidationRule.condition.values.map((v) => v.userEnteredValue);
    expect(who).toEqual(['-']);
  });

  it('escapa comillas simples del title en el rango de values', async () => {
    authedFetch.mockReset();
    stubApi({ title: "Hoja d'prueba" });
    await createSeriesSheet({ name: 'X', folderId: 'F', chapterCount: 1 });
    const valuesCall = authedFetch.mock.calls.find(([u]) => String(u).includes('/values/'));
    expect(String(valuesCall[0])).toContain(encodeURIComponent("'Hoja d''prueba'!A1:L2"));
  });

  it('valida chapterCount: 0, 2001 y no entero lanzan error claro sin llamar a la API', async () => {
    authedFetch.mockReset();
    for (const bad of [0, -1, 2001, 2.5, 'abc', null]) {
      await expect(createSeriesSheet({ name: 'X', folderId: 'F', chapterCount: bad })).rejects.toThrow(
        'entre 1 y 2000',
      );
    }
    expect(authedFetch).not.toHaveBeenCalled();
  });

  it('si falla values → DELETE best-effort de la copia y se relanza el error original', async () => {
    authedFetch.mockReset();
    stubApi({ failOn: (u) => String(u).includes('/values/') });

    await expect(createSeriesSheet({ name: 'X', folderId: 'F', chapterCount: 3 })).rejects.toThrow('falló');

    const deleteCall = authedFetch.mock.calls.find(
      ([u, o]) => String(u).includes(`${DRIVE}/SHEET1`) && o.method === 'DELETE',
    );
    expect(deleteCall).toBeTruthy();
  });

  it('si falla el batchUpdate → DELETE best-effort también', async () => {
    authedFetch.mockReset();
    stubApi({ failOn: (u) => String(u).includes(':batchUpdate') });

    await expect(createSeriesSheet({ name: 'X', folderId: 'F', chapterCount: 3 })).rejects.toThrow('falló');

    const deleteCall = authedFetch.mock.calls.find(
      ([u, o]) => String(u).includes(`${DRIVE}/SHEET1`) && o.method === 'DELETE',
    );
    expect(deleteCall).toBeTruthy();
  });

  it('si el DELETE de limpieza falla, igual se relanza el error original', async () => {
    authedFetch.mockReset();
    stubApi({
      failOn: (u, o) => String(u).includes('/values/') || o.method === 'DELETE',
    });

    await expect(createSeriesSheet({ name: 'X', folderId: 'F', chapterCount: 3 })).rejects.toThrow('falló');
  });

  it('sin Table en la columna A → error claro + DELETE best-effort de la copia', async () => {
    authedFetch.mockReset();
    stubApi({ noTable: true });

    await expect(createSeriesSheet({ name: 'X', folderId: 'F', chapterCount: 3 })).rejects.toThrow(
      'no tiene la Table esperada en la columna A',
    );

    const deleteCall = authedFetch.mock.calls.find(
      ([u, o]) => String(u).includes(`${DRIVE}/SHEET1`) && o.method === 'DELETE',
    );
    expect(deleteCall).toBeTruthy();
  });
});

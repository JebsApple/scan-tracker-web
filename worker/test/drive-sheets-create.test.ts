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
} from '../../src/repositories/drive-sheets-create.js';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';

/** authedFetch "fake" que replica las respuestas de la API según la URL:
 * POST create (spreadsheets) → batchUpdate → PUT values. `failOn` permite
 * hacer fallar un paso puntual. */
function stubApi({
  failOn,
  title = 'Sheet1',
  sheetId = 0,
  spreadsheetId = 'SHEET1',
  noSheet = false,
} = {}) {
  authedFetch.mockImplementation((url, options = {}) => {
    const u = String(url);
    if (failOn && failOn(u, options)) return Promise.reject(new Error(`falló: ${u}`));
    // 1. POST create del spreadsheet vacío → spreadsheetId + pestaña inicial.
    if (u === SHEETS && options.method === 'POST') {
      return Promise.resolve({
        spreadsheetId,
        sheets: noSheet
          ? []
          : [{ properties: { sheetId, title } }],
      });
    }
    // 2. batchUpdate (addTable + updateSheetProperties + repeatCell).
    if (u.includes(':batchUpdate')) return Promise.resolve({ replies: [{ addTable: {} }] });
    // 3. values (PUT).
    if (u.includes('/values/')) return Promise.resolve({ updates: { updatedRange: `'${title}'!A1:L11` } });
    return Promise.resolve({});
  });
}

beforeEach(() => {
  authedFetch.mockReset();
  stubApi();
});

describe('createSeriesSheet', () => {
  it('exporta el contrato compartido HEADER y WHO_COLUMNS', () => {
    expect(HEADER).toEqual([
      'Capítulos', 'Prioridad',
      'TRADUCCIÓN', 'LISTO',
      'EDICIÓN', 'LISTO',
      'CALIDAD', 'LISTO',
      'REDACCIÓN', 'LISTO',
      'SUBE', 'LISTO',
    ]);
    expect(WHO_COLUMNS).toEqual([2, 4, 6, 8, 10]);
  });

  it('happy path: create → batchUpdate (addTable, frozen, negrita) → values → {id, url}', async () => {
    const result = await createSeriesSheet({
      name: 'Mi serie',
      folderId: 'FOLDER1',
      chapterCount: 10,
      names: ['Mati', 'Pau'],
    });

    expect(result).toEqual({
      id: 'SHEET1',
      url: 'https://docs.google.com/spreadsheets/d/SHEET1/edit#gid=0',
    });

    // 1. create: POST al spreadsheet vacío con el title del nombre de la serie.
    const createCall = authedFetch.mock.calls[0];
    expect(createCall[0]).toBe(SHEETS);
    expect(createCall[1].method).toBe('POST');
    expect(JSON.parse(createCall[1].body)).toEqual({ properties: { title: 'Mi serie' } });

    // 2. batchUpdate: un solo request con addTable → frozen → negrita, en orden.
    const batchCall = authedFetch.mock.calls.find(([u]) => String(u).includes(':batchUpdate'));
    expect(String(batchCall[0])).toBe(`${SHEETS}/SHEET1:batchUpdate`);
    const requests = JSON.parse(batchCall[1].body).requests;
    expect(requests).toHaveLength(3);

    // 2a. addTable: Table "Capítulos" con 12 columnProperties tipadas.
    const addTable = requests[0].addTable.table;
    expect(addTable.name).toBe('Capítulos');
    expect(addTable.tableId).toBe('capitulos');
    expect(addTable.range).toEqual({
      sheetId: 0,
      startColumnIndex: 0,
      endColumnIndex: 12,
      startRowIndex: 0,
      endRowIndex: 11, // chapterCount + 1
    });
    expect(addTable.columnProperties).toHaveLength(12);

    // col 0: DOUBLE (enum válido, no "NUMBER").
    expect(addTable.columnProperties[0]).toEqual({ columnIndex: 0, columnName: 'Capítulos', columnType: 'DOUBLE' });
    // col 1: DROPDOWN de prioridad con los 4 valores (incluido LISTO).
    expect(addTable.columnProperties[1]).toMatchObject({
      columnIndex: 1,
      columnName: 'Prioridad',
      columnType: 'DROPDOWN',
    });
    expect(addTable.columnProperties[1].dataValidationRule.condition.type).toBe('ONE_OF_LIST');
    expect(addTable.columnProperties[1].dataValidationRule.condition.values.map((v) => v.userEnteredValue)).toEqual([
      'URGENTE', 'MODERADO', 'A TU TIEMPO', 'LISTO',
    ]);
    // columnas quién: DROPDOWN con los aliases.
    for (const i of WHO_COLUMNS) {
      const col = addTable.columnProperties.find((c) => c.columnIndex === i);
      expect(col).toMatchObject({ columnIndex: i, columnName: HEADER[i], columnType: 'DROPDOWN' });
      expect(col.dataValidationRule.condition.type).toBe('ONE_OF_LIST');
      expect(col.dataValidationRule.condition.values.map((v) => v.userEnteredValue)).toEqual(['Mati', 'Pau']);
    }
    // columnas LISTO: BOOLEAN (enum válido, no "CHECKBOX").
    for (const i of [3, 5, 7, 9, 11]) {
      expect(addTable.columnProperties.find((c) => c.columnIndex === i)).toEqual({
        columnIndex: i,
        columnName: 'LISTO',
        columnType: 'BOOLEAN',
      });
    }

    // 2b. updateSheetProperties: fila 1 congelada.
    expect(requests[1]).toEqual({
      updateSheetProperties: {
        properties: { sheetId: 0, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    });

    // 2c. repeatCell: header (fila 1, columnas A..L) en negrita.
    expect(requests[2]).toEqual({
      repeatCell: {
        range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 12 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
      },
    });

    // 3. values: header + 10 filas, RAW.
    const valuesCall = authedFetch.mock.calls.find(([u]) => String(u).includes('/values/'));
    expect(String(valuesCall[0])).toContain(encodeURIComponent(`'Sheet1'!A1:L11`));
    expect(String(valuesCall[0])).toContain('valueInputOption=RAW');
    const values = JSON.parse(valuesCall[1].body).values;
    expect(values).toHaveLength(11);
    expect(values[0]).toEqual(HEADER);
    expect(values[1][0]).toBe('1');
    expect(values[10][0]).toBe('10');

    // Sin PATCH de move: el spreadsheet se crea desde cero, no se copia ni se mueve.
    expect(authedFetch.mock.calls.some(([u, o]) => String(u).includes('drive/v3/files') && o.method === 'PATCH')).toBe(false);
    expect(authedFetch.mock.calls.some(([u, o]) => String(u).includes('/copy'))).toBe(false);
  });

  it('sin aliases, los dropdowns de "quién" se precargan con "-"', async () => {
    await createSeriesSheet({ name: 'X', folderId: 'F', chapterCount: 10, names: [] });
    const batchCall = authedFetch.mock.calls.find(([u]) => String(u).includes(':batchUpdate'));
    const cols = JSON.parse(batchCall[1].body).requests[0].addTable.table.columnProperties;
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

  it('sin pestaña inicial en la respuesta del create → error claro', async () => {
    authedFetch.mockReset();
    stubApi({ noSheet: true });
    await expect(createSeriesSheet({ name: 'X', folderId: 'F', chapterCount: 3 })).rejects.toThrow(
      'no devolvió la pestaña inicial',
    );
  });

  it('si falla values → DELETE best-effort de la hoja nueva y se relanza el error original', async () => {
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
});

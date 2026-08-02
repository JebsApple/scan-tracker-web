// Tests de src/repositories/drive-sheets-create.js (la app web) — vitest
// corre desde worker/ con acceso al repo raíz (ver vitest.config.ts). El
// módulo sheets-api.js se mockea completo: no hay red real, authedFetch es
// una función que devuelve respuestas secuenciales según la URL.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authedFetch } = vi.hoisted(() => ({ authedFetch: vi.fn() }));
vi.mock('../../src/repositories/sheets-api.js', () => ({ authedFetch }));

import { createSeriesSheet, HEADER, WHO_COLUMNS } from '../../src/repositories/drive-sheets-create.js';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

/** authedFetch "fake" que replica las respuestas de la API según la URL. */
function stubApi({ failOn }: { failOn?: (url: string) => boolean } = {}) {
  authedFetch.mockImplementation((url, options) => {
    const u = String(url);
    if (failOn && failOn(u)) return Promise.reject(new Error(`falló: ${u}`));
    if (u === SHEETS && options.method === 'POST') {
      return Promise.resolve({
        spreadsheetId: 'SHEET1',
        sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
      });
    }
    if (u.includes(':batchUpdate')) return Promise.resolve({ replies: [{ addTable: {} }] });
    if (u.includes('/values/')) return Promise.resolve({ updates: { updatedRange: "'Sheet1'!A1:L11" } });
    if (u.includes('drive/v3/files') && options.method === 'PATCH') return Promise.resolve({ id: 'SHEET1' });
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
      'LIMPIEZA', 'LISTO',
      'TYPEO', 'LISTO',
      'CORRECCIÓN', 'LISTO',
      'SUBE', 'LISTO',
    ]);
    expect(WHO_COLUMNS).toEqual([2, 4, 6, 8, 10]);
  });

  it('happy path: create → batchUpdate(addTable + congelar fila) → values → PATCH a la carpeta', async () => {
    const result = await createSeriesSheet({
      name: 'Mi serie',
      folderId: 'FOLDER1',
      chapterCount: 10,
      names: ['Mati', 'Pau'],
    });

    expect(result.id).toBe('SHEET1');
    expect(result.url).toContain('SHEET1');

    // 1. create: POST a /spreadsheets con el title.
    const createCall = authedFetch.mock.calls.find(([u, o]) => u === SHEETS && o.method === 'POST');
    expect(createCall).toBeTruthy();
    expect(JSON.parse(createCall[1].body).properties.title).toBe('Mi serie');

    // 2. batchUpdate: addTable con las 12 columnas del contrato.
    const batchCall = authedFetch.mock.calls.find(([u]) => String(u).includes(':batchUpdate'));
    const requests = JSON.parse(batchCall[1].body).requests;
    const addTable = requests.find((r) => r.addTable).addTable;
    expect(addTable.table.name).toBe('Capítulos');
    expect(addTable.table.tableId).toBe('capitulos');
    expect(addTable.table.range).toEqual({ sheetId: 0, startColumnIndex: 0, endColumnIndex: 12, startRowIndex: 0, endRowIndex: 11 });

    const cols = addTable.table.columnProperties;
    expect(cols).toHaveLength(12);
    expect(cols[0]).toMatchObject({ columnIndex: 0, columnName: 'Capítulos', columnType: 'DOUBLE' });
    expect(cols[1]).toMatchObject({ columnIndex: 1, columnName: 'Prioridad', columnType: 'DROPDOWN' });
    expect(cols[1].dataValidationRule.condition.values.map((v) => v.userEnteredValue)).toEqual(['URGENTE', 'MODERADO', 'A TU TIEMPO']);
    // LISTO = checkbox real.
    [3, 5, 7, 9, 11].forEach((i) => {
      expect(cols[i]).toMatchObject({ columnIndex: i, columnName: 'LISTO', columnType: 'BOOLEAN' });
    });
    // Columnas quién = DROPDOWN con los aliases del usuario.
    [2, 4, 6, 8, 10].forEach((i) => {
      expect(cols[i]).toMatchObject({ columnIndex: i, columnType: 'DROPDOWN' });
      expect(cols[i].dataValidationRule.condition.values.map((v) => v.userEnteredValue)).toEqual(['Mati', 'Pau']);
    });
    // updateSheetProperties: fila 1 congelada.
    expect(requests.some((r) => r.updateSheetProperties?.properties?.gridProperties?.frozenRowCount === 1)).toBe(true);

    // 3. values: header + 10 filas, RAW.
    const valuesCall = authedFetch.mock.calls.find(([u]) => String(u).includes('/values/'));
    expect(String(valuesCall[0])).toContain('Sheet1');
    expect(String(valuesCall[0])).toContain('valueInputOption=RAW');
    const values = JSON.parse(valuesCall[1].body).values;
    expect(values).toHaveLength(11);
    expect(values[0]).toEqual(HEADER);
    expect(values[1][0]).toBe('1');
    expect(values[10][0]).toBe('10');

    // 4. PATCH de move con addParents/removeParents.
    const moveCall = authedFetch.mock.calls.find(([u, o]) => String(u).includes('drive/v3/files') && o.method === 'PATCH');
    expect(String(moveCall[0])).toContain('addParents=FOLDER1');
    expect(String(moveCall[0])).toContain('removeParents=root');
  });

  it('sin aliases, las columnas quién se precargan con "-"', async () => {
    await createSeriesSheet({ name: 'X', folderId: 'F', chapterCount: 2, names: [] });
    const batchCall = authedFetch.mock.calls.find(([u]) => String(u).includes(':batchUpdate'));
    const cols = JSON.parse(batchCall[1].body).requests.find((r) => r.addTable).addTable.table.columnProperties;
    const who = cols[2].dataValidationRule.condition.values.map((v) => v.userEnteredValue);
    expect(who).toEqual(['-']);
  });

  it('escapa comillas simples del title en el rango', async () => {
    authedFetch.mockReset();
    authedFetch.mockImplementation((url, options) => {
      const u = String(url);
      if (u === SHEETS && options.method === 'POST') {
        return Promise.resolve({
          spreadsheetId: 'SHEET1',
          sheets: [{ properties: { sheetId: 0, title: "Hoja d'prueba" } }],
        });
      }
      if (u.includes(':batchUpdate')) return Promise.resolve({});
      if (u.includes('/values/')) return Promise.resolve({});
      if (u.includes('drive/v3/files') && options.method === 'PATCH') return Promise.resolve({});
      return Promise.resolve({});
    });
    await createSeriesSheet({ name: 'X', folderId: 'F', chapterCount: 1 });
    const valuesCall = authedFetch.mock.calls.find(([u]) => String(u).includes('/values/'));
    expect(String(valuesCall[0])).toContain("Hoja%20d%27%27prueba".replace('%27%27', encodeURIComponent("''")));
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

  it('si falla values → DELETE best-effort de la hoja y se relanza el error original', async () => {
    authedFetch.mockReset();
    authedFetch.mockImplementation((url, options) => {
      const u = String(url);
      if (u === SHEETS && options.method === 'POST') {
        return Promise.resolve({
          spreadsheetId: 'SHEET2',
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        });
      }
      if (u.includes(':batchUpdate')) return Promise.resolve({});
      if (u.includes('/values/')) return Promise.reject(new Error('vals falló'));
      return Promise.resolve({});
    });

    await expect(createSeriesSheet({ name: 'X', folderId: 'F', chapterCount: 3 })).rejects.toThrow('vals falló');

    const deleteCall = authedFetch.mock.calls.find(
      ([u, o]) => String(u).includes('drive/v3/files/SHEET2') && o.method === 'DELETE',
    );
    expect(deleteCall).toBeTruthy();
  });

  it('si falla el batchUpdate → DELETE best-effort también', async () => {
    authedFetch.mockReset();
    authedFetch.mockImplementation((url, options) => {
      const u = String(url);
      if (u === SHEETS && options.method === 'POST') {
        return Promise.resolve({
          spreadsheetId: 'SHEET3',
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        });
      }
      if (u.includes(':batchUpdate')) return Promise.reject(new Error('batch falló'));
      return Promise.resolve({});
    });

    await expect(createSeriesSheet({ name: 'X', folderId: 'F', chapterCount: 3 })).rejects.toThrow('batch falló');
    const deleteCall = authedFetch.mock.calls.find(
      ([u, o]) => String(u).includes('drive/v3/files/SHEET3') && o.method === 'DELETE',
    );
    expect(deleteCall).toBeTruthy();
  });

  it('si el DELETE de limpieza falla, igual se relanza el error original', async () => {
    authedFetch.mockReset();
    authedFetch.mockImplementation((url, options) => {
      const u = String(url);
      if (u === SHEETS && options.method === 'POST') {
        return Promise.resolve({
          spreadsheetId: 'SHEET4',
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        });
      }
      if (u.includes(':batchUpdate')) return Promise.resolve({});
      if (u.includes('/values/')) return Promise.reject(new Error('vals falló'));
      if (options.method === 'DELETE') return Promise.reject(new Error('delete falló'));
      return Promise.resolve({});
    });

    await expect(createSeriesSheet({ name: 'X', folderId: 'F', chapterCount: 3 })).rejects.toThrow('vals falló');
  });
});

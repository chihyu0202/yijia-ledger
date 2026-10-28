// 模擬的 Apps Script 環境（試算表、指令碼屬性、雲端硬碟、觸發器…），供 tests/*.test.js 共用。
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');

function makeSheet(name) {
  const s = { name, cells: [], maxRows: 1000, maxCols: 26 };
  const get = (r, c) => (s.cells[r - 1] && s.cells[r - 1][c - 1] !== undefined ? s.cells[r - 1][c - 1] : '');
  const set = (r, c, v) => { (s.cells[r - 1] = s.cells[r - 1] || [])[c - 1] = v; };
  const range = (r, c, nr = 1, nc = 1) => {
    if (r + nr - 1 > s.maxRows) throw new Error('range out of bounds');
    const self = {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => get(r + i, c + j))),
      setValues: (vals) => { if (vals.length !== nr || vals[0].length !== nc) throw new Error('size mismatch'); vals.forEach((row, i) => row.forEach((v, j) => set(r + i, c + j, v))); return self; },
      setFontWeight: () => self,
      setNumberFormat: () => self,
      insertCheckboxes: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (get(r + i, c + j) === '') set(r + i, c + j, false); return self; },
      clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (s.cells[r + i - 1]) s.cells[r + i - 1][c + j - 1] = ''; return self; },
      clearDataValidations: () => self,
    };
    return self;
  };
  return {
    _s: s,
    getName: () => name,
    getRange: range,
    getMaxColumns: () => s.maxCols,
    getMaxRows: () => s.maxRows,
    insertColumnsAfter: (_, n) => { s.maxCols += n; },
    insertRowsAfter: (_, n) => { s.maxRows += n; },
    deleteRow: (r) => { s.cells.splice(r - 1, 1); },
    setFrozenRows() {},
    getLastRow: () => s.cells.reduce((m, row, i) => (row && row.some((v) => v !== '' && v !== undefined) ? i + 1 : m), 0),
    getLastColumn: () => s.cells.reduce((m, row) => Math.max(m, row ? row.length : 0), 0),
    getDataRange() { return range(1, 1, this.getLastRow(), this.getLastColumn()); },
  };
}

function makeSS(id) {
  let sheets = [makeSheet('工作表1')];
  return {
    getId: () => id, getUrl: () => 'https://example.com/' + id,
    setSpreadsheetTimeZone() {}, getSpreadsheetTimeZone: () => 'Asia/Taipei',
    getSheetByName: (n) => sheets.find((s) => s.getName() === n) || null,
    insertSheet: (n) => { const s = makeSheet(n); sheets.push(s); return s; },
    getSheets: () => sheets.slice(),
    deleteSheet: (s) => { sheets = sheets.filter((x) => x !== s); },
  };
}

// 台北時間 = UTC+8（無夏令時間）
function formatDate(d, tz, pattern) {
  const t = new Date(d.getTime() + 8 * 3600 * 1000).toISOString();
  return pattern
    .replace("'T'", 'T')
    .replace('yyyy', t.slice(0, 4)).replace('MM', t.slice(5, 7)).replace('dd', t.slice(8, 10))
    .replace('HH', t.slice(11, 13)).replace('mm', t.slice(14, 16)).replace('ss', t.slice(17, 19))
    .replace('XXX', '+08:00');
}

function makeEnv(dir = path.join(__dirname, '..', 'backend')) {
  const store = {}; const spreadsheets = {}; const logs = [];
  const tokens = {}; // 假的 tokeninfo：id_token → 回應內容
  let n = 0;
  const drive = makeDrive(spreadsheets);
  const triggers = [];
  const ctx = {
    DriveApp: drive.DriveApp,
    MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
    ScriptApp: {
      WeekDay: { SUNDAY: 'SUNDAY' },
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: (fn) => {
        const t = { fn, getHandlerFunction: () => fn };
        const b = { timeBased: () => b, onWeekDay: (d) => { t.day = d; return b; }, atHour: (h) => { t.hour = h; return b; }, inTimezone: (z) => { t.tz = z; return b; }, create: () => { triggers.push(t); return t; } };
        return b;
      },
    },
    console: { log: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(String(m)) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in store ? store[k] : null),
      getProperties: () => Object.assign({}, store),
      setProperty: (k, v) => { store[k] = String(v); },
      deleteProperty: (k) => { delete store[k]; },
    }) },
    SpreadsheetApp: {
      create: () => { const id = 'ss' + (++n); spreadsheets[id] = makeSS(id); return spreadsheets[id]; },
      openById: (id) => { if (!spreadsheets[id]) throw new Error('not found'); return spreadsheets[id]; },
      flush() {},
    },
    Utilities: {
      formatDate,
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
    },
    UrlFetchApp: { fetch: (url) => {
      const tok = decodeURIComponent(url.split('id_token=')[1]);
      const info = tokens[tok];
      return { getResponseCode: () => (info ? 200 : 400), getContentText: () => JSON.stringify(info || { error: 'invalid_token' }) };
    } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }) },
  };
  vm.createContext(ctx);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort();
  vm.runInContext(files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n') +
    '\nthis.__api = { setup, checkSetup, parseInitialMembers_, handle_, doPost, readTable_, backupSpreadsheet, installBackupTrigger };', ctx);
  return { ctx, store, spreadsheets, logs, tokens, drive, triggers, api: ctx.__api };
}


// 雲端硬碟：資料夾、檔案（含垃圾桶狀態）。試算表本身也當成一個檔案
function makeDrive(spreadsheets) {
  const folders = []; const files = []; let seq = 0;
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  function makeFolder(name) {
    const f = { id: 'fd' + (++seq), name, trashed: false,
      getId: () => f.id, getName: () => f.name, isTrashed: () => f.trashed, setTrashed: (v) => { f.trashed = v; },
      getFilesByType: (mime) => iter(files.filter((x) => x.parent === f && x.mime === mime)) };
    folders.push(f); return f;
  }
  function makeFile(name, parent, mime) {
    const f = { id: 'fl' + (++seq), name, parent, mime, trashed: false, created: new Date(Date.now() + seq * 1000),
      getId: () => f.id, getName: () => f.name, isTrashed: () => f.trashed, setTrashed: (v) => { f.trashed = v; },
      getDateCreated: () => f.created,
      makeCopy: (newName, folder) => makeFile(newName, folder, mime) };
    files.push(f); return f;
  }
  return {
    folders, files,
    DriveApp: {
      getFileById: (id) => { if (!spreadsheets[id]) throw new Error('not found'); return files.find((x) => x.id === id) || Object.assign(makeFile('一家帳資料', null, 'application/vnd.google-apps.spreadsheet'), { id }); },
      getFolderById: (id) => { const f = folders.find((x) => x.id === id); if (!f) throw new Error('not found'); return f; },
      getFoldersByName: (name) => iter(folders.filter((x) => x.name === name)),
      createFolder: makeFolder,
    },
    makeFolder, makeFile,
  };
}

module.exports = { makeEnv, formatDate, makeSheet };

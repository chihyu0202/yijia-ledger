// 以模擬的 Apps Script 環境執行 setup()，確認建表、種子資料、重跑不重複、錯誤訊息。
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const dir = process.argv[2] || path.join(__dirname, '..', 'backend');

function makeSheet(name) {
  const s = { name, cells: [], maxRows: 1000, maxCols: 26, frozen: 0 };
  const get = (r, c) => (s.cells[r - 1] && s.cells[r - 1][c - 1] !== undefined ? s.cells[r - 1][c - 1] : '');
  const set = (r, c, v) => { (s.cells[r - 1] = s.cells[r - 1] || [])[c - 1] = v; };
  const range = (r, c, nr, nc) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => get(r + i, c + j))),
    setValues: (vals) => { if (vals.length !== nr || vals[0].length !== nc) throw new Error('size mismatch'); vals.forEach((row, i) => row.forEach((v, j) => set(r + i, c + j, v))); return range(r, c, nr, nc); },
    setFontWeight: () => range(r, c, nr, nc),
    setNumberFormat: () => range(r, c, nr, nc),
    // 真實 Google 試算表：空白儲存格插入勾選框後值變成 FALSE，會被 getLastRow 當成有資料
    insertCheckboxes: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (get(r + i, c + j) === '') set(r + i, c + j, false); return range(r, c, nr, nc); },
    clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (s.cells[r + i - 1]) s.cells[r + i - 1][c + j - 1] = ''; return range(r, c, nr, nc); },
    clearDataValidations: () => range(r, c, nr, nc),
  });
  return {
    _s: s,
    getName: () => name,
    getRange: range,
    getMaxColumns: () => s.maxCols,
    getMaxRows: () => s.maxRows,
    insertColumnsAfter: (_, n) => { s.maxCols += n; },
    setFrozenRows: (n) => { s.frozen = n; },
    getLastRow: () => s.cells.reduce((m, row, i) => (row && row.some((v) => v !== '' && v !== undefined) ? i + 1 : m), 0),
    getLastColumn: () => s.cells.reduce((m, row) => Math.max(m, row ? row.length : 0), 0),
    getDataRange() { const lr = this.getLastRow(); const lc = this.getLastColumn(); return range(1, 1, lr, lc); },
  };
}

function makeSS(id) {
  let sheets = [makeSheet('工作表1')];
  return {
    _sheets: () => sheets,
    getId: () => id, getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id,
    setSpreadsheetTimeZone() {}, getSpreadsheetTimeZone: () => 'Asia/Taipei',
    getSheetByName: (n) => sheets.find((s) => s.getName() === n) || null,
    insertSheet: (n) => { const s = makeSheet(n); sheets.push(s); return s; },
    getSheets: () => sheets.slice(),
    deleteSheet: (s) => { sheets = sheets.filter((x) => x !== s); },
  };
}

function makeEnv() {
  const store = {}; const spreadsheets = {}; const logs = [];
  let n = 0;
  const ctx = {
    console: { log: (m) => logs.push(m) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in store ? store[k] : null),
      setProperty: (k, v) => { store[k] = String(v); },
      deleteProperty: (k) => { delete store[k]; },
    }) },
    SpreadsheetApp: {
      create: () => { const id = 'ss' + (++n); spreadsheets[id] = makeSS(id); return spreadsheets[id]; },
      openById: (id) => { if (!spreadsheets[id]) throw new Error('not found'); return spreadsheets[id]; },
      flush() {},
    },
    Utilities: {
      formatDate: () => '2026-10-28T21:00:00+08:00',
      getUuid: () => require('crypto').randomUUID(),
    },
  };
  vm.createContext(ctx);
  const code = ['Util.gs', 'Setup.gs'].map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  vm.runInContext(code + '\nthis.__api = { setup, checkSetup, parseInitialMembers_ };', ctx);
  return { ctx, store, spreadsheets, logs, api: ctx.__api };
}

let pass = 0, fail = 0;
function check(label, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL: ' + label); } }
function throws(label, fn, re) { try { fn(); fail++; console.log('FAIL (no throw): ' + label); } catch (e) { if (re.test(e.message)) pass++; else { fail++; console.log('FAIL (msg): ' + label + ' → ' + e.message); } } }

// 1. 沒有 INITIAL_MEMBERS → 清楚錯誤
{
  const env = makeEnv();
  throws('missing INITIAL_MEMBERS', () => env.api.setup(), /INITIAL_MEMBERS/);
  const s0 = env.spreadsheets[env.store.SPREADSHEET_ID];
  check('no categories seeded on member error', s0.getSheetByName('Categories').getLastRow() === 1);
}

// 2. 正常流程
const members = JSON.stringify([
  { name: 'Gloria', email: 'Gloria.Test@gmail.com', role: 'admin' },
  { name: 'Yao', email: 'yao.test@gmail.com', role: 'admin' },
  { name: '小珠寶' },
]);
const env = makeEnv();
env.store.INITIAL_MEMBERS = members;
// 第一次執行會在成員步驟前就建好表；先前測試 1 已證明錯誤，這裡直接成功
env.api.setup();
const ss = env.spreadsheets[env.store.SPREADSHEET_ID];
check('spreadsheet id saved', !!ss);
check('default sheet removed', !ss.getSheetByName('工作表1'));
check('3 sheets', ss.getSheets().length === 3);
const exp = ss.getSheetByName('Expenses');
check('expenses header', exp.getRange(1, 1, 1, 12).getValues()[0].join() === 'expense_id,expense_date,amount,item,scope,category_id,category_name,created_by,created_at,updated_at,note,status');
check('expenses empty', exp.getLastRow() === 1);
const cats = ss.getSheetByName('Categories');
check('7 categories', cats.getLastRow() === 8);
check('category row', JSON.stringify(cats.getRange(2, 1, 1, 6).getValues()[0]) === JSON.stringify(['cat_food', '餐飲', 10, true, '2026-10-28T21:00:00+08:00', '2026-10-28T21:00:00+08:00']));
const mem = ss.getSheetByName('Members');
check('3 members', mem.getLastRow() === 4);
const m1 = mem.getRange(2, 1, 1, 9).getValues()[0];
check('member id format', /^m_[0-9a-f]{8}$/.test(m1[0]));
check('email lowercased', m1[2] === 'gloria.test@gmail.com');
const m3 = mem.getRange(4, 1, 1, 9).getValues()[0];
check('no-login member', m3[1] === '小珠寶' && m3[2] === '' && m3[3] === 'member' && m3[4] === 30 && m3[5] === true);
check('INITIAL_MEMBERS removed', !('INITIAL_MEMBERS' in env.store));
check('visibility default', env.store.PERSONAL_VISIBILITY === 'full');

// 3. 重跑不重複
env.api.setup();
check('rerun no dup categories', cats.getLastRow() === 8);
check('rerun no dup members', mem.getLastRow() === 4);
check('rerun same spreadsheet', Object.keys(env.spreadsheets).length === 1);

// 4. 標題被改 → 擋下
cats._s.cells[0][1] = '名稱';
throws('header mismatch', () => env.api.setup(), /標題列與預期不同/);
cats._s.cells[0][1] = 'category_name';

// 5. checkSetup 不出錯且遮罩 email
env.api.checkSetup();
check('checkSetup masks email', env.logs.some((l) => l.includes('gl***@gmail.com')) && !env.logs.some((l) => l.includes('gloria.test@gmail.com')));

// 6. 成員驗證
const p = env.api.parseInitialMembers_;
throws('bad json', () => p('[{“name”:“A”}]'), /全形引號/);
throws('admin without email', () => p('[{"name":"A","role":"admin"}]'), /管理員必須有 email/);
throws('no admin', () => p('[{"name":"A","email":"a@b.co"}]'), /至少需要一位 admin/);
throws('dup email', () => p('[{"name":"A","email":"a@b.co","role":"admin"},{"name":"B","email":"A@b.co"}]'), /重複/);
throws('bad role', () => p('[{"name":"A","email":"a@b.co","role":"boss"}]'), /role/);
throws('bad email', () => p('[{"name":"A","email":"abc","role":"admin"}]'), /email 格式/);

// 7. 修復舊版留下的狀態：表已建好，但 is_active 欄 2–1000 列都是 FALSE 勾選框、沒有資料
{
  const e2 = makeEnv();
  e2.store.INITIAL_MEMBERS = members;
  e2.api.setup();
  const s2 = e2.spreadsheets[e2.store.SPREADSHEET_ID];
  for (const name of ['Categories', 'Members']) {
    const sh = s2.getSheetByName(name);
    sh._s.cells = [sh._s.cells[0]];
    for (let r = 2; r <= 1000; r++) (sh._s.cells[r - 1] = [])[name === 'Categories' ? 3 : 5] = false;
  }
  e2.store.INITIAL_MEMBERS = members;
  check('broken state looks non-empty', s2.getSheetByName('Categories').getLastRow() === 1000);
  e2.logs.length = 0;
  e2.api.setup();
  check('repair seeds categories', e2.logs.some((l) => l.includes('新增分類 7 筆、新增成員 3 位')));
  check('repair cleans tail rows', s2.getSheetByName('Categories').getLastRow() === 8 && s2.getSheetByName('Members').getLastRow() === 4);
  e2.logs.length = 0;
  e2.api.checkSetup();
  check('checkSetup counts', e2.logs.some((l) => l === '✔ Categories：資料 7 列') && e2.logs.some((l) => l === '✔ Members：資料 3 列'));
}

console.log(`passed ${pass}, failed ${fail}`);
process.exit(fail ? 1 : 0);

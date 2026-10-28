/**
 * 一家帳 — 共用設定與工具
 * 第二階段：工作表定義、時間與 ID 產生、讀取設定
 * 第三階段：錯誤、鎖、資料表讀寫
 */

const APP = {
  TZ: 'Asia/Taipei',
  SPREADSHEET_NAME: '一家帳資料',
};

/** Script Properties 的鍵名（設定值都放這裡，不寫進程式碼） */
const PROP = {
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  GOOGLE_CLIENT_ID: 'GOOGLE_CLIENT_ID',
  INITIAL_MEMBERS: 'INITIAL_MEMBERS',
  PERSONAL_VISIBILITY: 'PERSONAL_VISIBILITY',
};

const VISIBILITY_VALUES = ['full', 'summary', 'private'];

/** 三張工作表的欄位（順序即試算表欄位順序，請勿任意調整） */
const SHEET_DEFS = {
  Expenses: [
    'expense_id', 'expense_date', 'amount', 'item', 'scope', 'category_id',
    'category_name', 'created_by', 'created_at', 'updated_at', 'note', 'status',
  ],
  Categories: [
    'category_id', 'category_name', 'sort_order', 'is_active', 'created_at', 'updated_at',
  ],
  Members: [
    'member_id', 'display_name', 'email', 'role', 'sort_order', 'is_active',
    'category_order', 'created_at', 'updated_at',
  ],
};

/** 一律存成純文字的欄位，避免試算表自動把日期、ID 轉成別的格式 */
const TEXT_COLUMNS = {
  Expenses: [
    'expense_id', 'expense_date', 'item', 'scope', 'category_id', 'category_name',
    'created_by', 'created_at', 'updated_at', 'note', 'status',
  ],
  Categories: ['category_id', 'category_name', 'created_at', 'updated_at'],
  Members: [
    'member_id', 'display_name', 'email', 'role', 'category_order', 'created_at', 'updated_at',
  ],
};

/** 勾選框欄位 */
const CHECKBOX_COLUMNS = {
  Expenses: [],
  Categories: ['is_active'],
  Members: ['is_active'],
};

/** 目前時間，ISO 8601，台北時區，例如 2026-10-28T21:05:00+08:00 */
function nowIso_() {
  return Utilities.formatDate(new Date(), APP.TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** 產生短 ID，例如 newId_('m_') → m_3f9a1c2b */
function newId_(prefix) {
  return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

function props_() {
  return PropertiesService.getScriptProperties();
}

function getSpreadsheet_() {
  const id = props_().getProperty(PROP.SPREADSHEET_ID);
  if (!id) throw new Error('尚未設定 SPREADSHEET_ID，請先執行 setup()。');
  return SpreadsheetApp.openById(id);
}

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('找不到工作表「' + name + '」，請重新執行 setup()。');
  return sheet;
}

function isValidEmail_(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** 把 email 中間遮住，避免在執行記錄中完整顯示 */
function maskEmail_(email) {
  if (!email) return '（無）';
  const at = email.indexOf('@');
  if (at <= 2) return '***' + email.slice(at);
  return email.slice(0, 2) + '***' + email.slice(at);
}

/* ---------- 第三階段：錯誤、鎖、資料表讀寫 ---------- */

/** 給使用者看的錯誤；message 為中文 */
function fail_(code, message) {
  const e = new Error(message);
  e.appCode = code;
  return e;
}

/** 所有寫入都包在 Script Lock 內 */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function todayStr_() {
  return Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd');
}

function isTrue_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

/** 金額轉成「分」再加總，避免浮點誤差 */
function toCents_(amount) {
  return Math.round(Number(amount) * 100);
}

/** 把一列值轉成物件；順手修正被試算表自動轉型的值（日期、勾選框） */
function rowToObj_(name, values) {
  const obj = {};
  SHEET_DEFS[name].forEach(function (h, i) {
    let v = values[i];
    if (v instanceof Date) {
      v = Utilities.formatDate(v, APP.TZ, h === 'expense_date' ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ssXXX");
    }
    if (CHECKBOX_COLUMNS[name].indexOf(h) >= 0) v = isTrue_(v);
    else if (TEXT_COLUMNS[name].indexOf(h) >= 0) v = v === null || v === undefined ? '' : String(v);
    obj[h] = v;
  });
  return obj;
}

/** 讀取整張表；每筆附 _row（試算表列號），只在後端內部使用 */
function readTable_(name) {
  const sheet = getSheet_(name);
  const n = countDataRows_(sheet);
  const values = n ? sheet.getRange(2, 1, n, SHEET_DEFS[name].length).getValues() : [];
  const rows = [];
  values.forEach(function (v, i) {
    if (v[0] === '' || v[0] === null) return;
    const obj = rowToObj_(name, v);
    obj._row = i + 2;
    rows.push(obj);
  });
  return { sheet: sheet, rows: rows };
}

function writeRow_(sheet, name, rowNum, obj) {
  const values = SHEET_DEFS[name].map(function (h) {
    return obj[h] === undefined || obj[h] === null ? '' : obj[h];
  });
  sheet.getRange(rowNum, 1, 1, values.length).setValues([values]);
}

/** 在最後一筆資料下一列寫入；先套文字格式再寫值，最後加勾選框 */
function appendRow_(sheet, name, obj) {
  const headers = SHEET_DEFS[name];
  const row = lastIdRow_(sheet) + 1;
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
  TEXT_COLUMNS[name].forEach(function (col) {
    sheet.getRange(row, headers.indexOf(col) + 1).setNumberFormat('@');
  });
  writeRow_(sheet, name, row, obj);
  applyCheckboxes_(sheet, name, row, 1);
  return row;
}

/** 去掉內部欄位（_row） */
function publicObj_(obj) {
  const out = {};
  Object.keys(obj).forEach(function (k) {
    if (k.charAt(0) !== '_') out[k] = obj[k];
  });
  return out;
}

function requireString_(v, label, maxLen, allowEmpty) {
  const s = v === null || v === undefined ? '' : String(v).trim();
  if (!s && !allowEmpty) throw fail_('VALIDATION', label + '為必填。');
  if (s.length > maxLen) throw fail_('VALIDATION', label + '最多 ' + maxLen + ' 字。');
  return s;
}

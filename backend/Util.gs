/**
 * 一家帳 — 共用設定與工具
 * 第二階段：工作表定義、時間與 ID 產生、讀取設定
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

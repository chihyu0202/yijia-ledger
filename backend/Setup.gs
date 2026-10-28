/**
 * 一家帳 — 初始化
 *
 * setup()      建立（或補齊）試算表、三張工作表、初始分類與成員。可重複執行，不會產生重複資料。
 * checkSetup() 檢查目前狀態，結果顯示在「執行記錄」。
 */

const DEFAULT_CATEGORIES = [
  ['cat_food', '餐飲', 10],
  ['cat_transport', '交通', 20],
  ['cat_home', '居家生活', 30],
  ['cat_baby', '育兒', 40],
  ['cat_medical', '醫療', 50],
  ['cat_fun', '娛樂', 60],
  ['cat_other', '其他', 70],
];

function setup() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = props_();
    const ss = getOrCreateSpreadsheet_(props);
    ss.setSpreadsheetTimeZone(APP.TZ);

    Object.keys(SHEET_DEFS).forEach(function (name) {
      ensureSheet_(ss, name);
    });
    removeBlankDefaultSheets_(ss);

    // 先檢查成員設定，有錯就整個停下，避免只建好一半的資料
    const pendingMembers = countDataRows_(ss.getSheetByName('Members')) > 0 ? null : loadInitialMembers_(props);

    const catAdded = seedCategories_(ss);
    const memAdded = pendingMembers ? seedMembers_(ss, props, pendingMembers) : 0;

    if (!props.getProperty(PROP.PERSONAL_VISIBILITY)) {
      props.setProperty(PROP.PERSONAL_VISIBILITY, 'full');
    }
    SpreadsheetApp.flush();

    console.log('✔ setup 完成');
    console.log('試算表：' + ss.getUrl());
    console.log('新增分類 ' + catAdded + ' 筆、新增成員 ' + memAdded + ' 位（0 表示先前已建立，未重複新增）');
  } finally {
    lock.releaseLock();
  }
}

function checkSetup() {
  const props = props_();
  const ss = getSpreadsheet_();
  console.log('試算表：' + ss.getUrl());
  console.log('時區：' + ss.getSpreadsheetTimeZone());

  Object.keys(SHEET_DEFS).forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    console.log((sheet ? '✔ ' : '✘ ') + name + (sheet ? '：資料 ' + countDataRows_(sheet) + ' 列' : '：不存在'));
  });

  const cats = readRows_(ss.getSheetByName('Categories'));
  console.log('分類：' + cats.map(function (c) { return c.category_name + (c.is_active ? '' : '（停用）'); }).join('、'));

  const members = readRows_(ss.getSheetByName('Members'));
  members.forEach(function (m) {
    console.log('成員：' + m.display_name + ' · ' + m.role + ' · ' + (m.email ? '可登入 ' + maskEmail_(m.email) : '不能登入'));
  });

  const clientId = props.getProperty(PROP.GOOGLE_CLIENT_ID);
  console.log((clientId ? '✔ ' : '✘ ') + 'GOOGLE_CLIENT_ID' + (clientId ? '' : '：尚未設定（第二階段步驟 G）'));
  console.log('PERSONAL_VISIBILITY：' + (props.getProperty(PROP.PERSONAL_VISIBILITY) || '（未設定）'));
}

/* ---------- 以下為內部函式 ---------- */

function getOrCreateSpreadsheet_(props) {
  const id = props.getProperty(PROP.SPREADSHEET_ID);
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      throw new Error('SPREADSHEET_ID 無法開啟（' + e.message + '）。若試算表已刪除，請刪除這個指令碼屬性後重新執行 setup()。');
    }
  }
  const ss = SpreadsheetApp.create(APP.SPREADSHEET_NAME);
  props.setProperty(PROP.SPREADSHEET_ID, ss.getId());
  return ss;
}

function ensureSheet_(ss, name) {
  const headers = SHEET_DEFS[name];
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);

  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }

  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const isEmpty = current.every(function (v) { return v === ''; });
  if (isEmpty) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    const mismatch = headers.filter(function (h, i) { return current[i] !== h; });
    if (mismatch.length) {
      throw new Error('工作表「' + name + '」的標題列與預期不同（' + mismatch.join(', ') +
        '）。請把標題列改回原樣，或刪除此工作表後重新執行 setup()。');
    }
  }

  // 清掉最後一筆資料之後的殘留內容（例如舊版程式在空白列留下的勾選框）
  const lastId = lastIdRow_(sheet);
  const tail = sheet.getMaxRows() - lastId;
  if (tail > 0) {
    sheet.getRange(lastId + 1, 1, tail, headers.length).clearContent().clearDataValidations();
  }

  const dataRows = sheet.getMaxRows() - 1;
  if (dataRows > 0) {
    TEXT_COLUMNS[name].forEach(function (col) {
      sheet.getRange(2, headers.indexOf(col) + 1, dataRows, 1).setNumberFormat('@');
    });
  }
  return sheet;
}

/** 只在真正有資料的列加上勾選框（空白列加勾選框會被當成有資料） */
function applyCheckboxes_(sheet, name, startRow, numRows) {
  const headers = SHEET_DEFS[name];
  CHECKBOX_COLUMNS[name].forEach(function (col) {
    sheet.getRange(startRow, headers.indexOf(col) + 1, numRows, 1).insertCheckboxes();
  });
}

/** 第一欄（ID）有值的最後一列列號；沒有資料時回傳 1（標題列） */
function lastIdRow_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return 1;
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (ids[i][0] !== '' && ids[i][0] !== null) return i + 2;
  }
  return 1;
}

/** 以 ID 欄判斷的資料列數 */
function countDataRows_(sheet) {
  return lastIdRow_(sheet) - 1;
}

/** 刪除新試算表自帶的空白工作表（例如「工作表1」） */
function removeBlankDefaultSheets_(ss) {
  ss.getSheets().forEach(function (sheet) {
    const name = sheet.getName();
    if (SHEET_DEFS[name]) return;
    if (sheet.getLastRow() === 0 && sheet.getLastColumn() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(sheet);
    }
  });
}

function seedCategories_(ss) {
  const sheet = ss.getSheetByName('Categories');
  if (countDataRows_(sheet) > 0) return 0;
  const now = nowIso_();
  const rows = DEFAULT_CATEGORIES.map(function (c) {
    return [c[0], c[1], c[2], true, now, now];
  });
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  applyCheckboxes_(sheet, 'Categories', 2, rows.length);
  return rows.length;
}

/**
 * 依 Script Properties 的 INITIAL_MEMBERS 建立成員。
 * 格式：[{"name":"Gloria","email":"xxx@gmail.com","role":"admin"},{"name":"小珠寶"}]
 * 成功後會刪除 INITIAL_MEMBERS，之後以 Members 工作表為準。
 */
function loadInitialMembers_(props) {
  const raw = props.getProperty(PROP.INITIAL_MEMBERS);
  if (!raw) {
    throw new Error('尚未設定 INITIAL_MEMBERS。請到「專案設定 › 指令碼屬性」新增（格式見 README 步驟 D），再重新執行 setup()。');
  }
  return parseInitialMembers_(raw);
}

function seedMembers_(ss, props, members) {
  const sheet = ss.getSheetByName('Members');
  if (countDataRows_(sheet) > 0) return 0;

  const now = nowIso_();
  const rows = members.map(function (m, i) {
    return [newId_('m_'), m.name, m.email, m.role, (i + 1) * 10, true, '', now, now];
  });
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  applyCheckboxes_(sheet, 'Members', 2, rows.length);
  props.deleteProperty(PROP.INITIAL_MEMBERS);
  return rows.length;
}

function parseInitialMembers_(raw) {
  let list;
  try {
    list = JSON.parse(raw);
  } catch (e) {
    throw new Error('INITIAL_MEMBERS 不是有效的 JSON（' + e.message + '）。常見原因：使用了全形引號 “ ” 或少了逗號。');
  }
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('INITIAL_MEMBERS 必須是至少一位成員的陣列。');
  }

  const seen = {};
  const result = list.map(function (m, i) {
    const label = '第 ' + (i + 1) + ' 位成員';
    const name = String((m && m.name) || '').trim();
    const email = String((m && m.email) || '').trim().toLowerCase();
    const role = String((m && m.role) || 'member').trim().toLowerCase();

    if (!name || name.length > 20) throw new Error(label + '：name 必填，最多 20 字。');
    if (email && !isValidEmail_(email)) throw new Error(label + '：email 格式不正確。');
    if (role !== 'admin' && role !== 'member') throw new Error(label + '：role 只能是 admin 或 member。');
    if (role === 'admin' && !email) throw new Error(label + '：管理員必須有 email 才能登入。');
    if (email) {
      if (seen[email]) throw new Error(label + '：email 與其他成員重複。');
      seen[email] = true;
    }
    return { name: name, email: email, role: role };
  });

  if (!result.some(function (m) { return m.role === 'admin'; })) {
    throw new Error('INITIAL_MEMBERS 至少需要一位 admin。');
  }
  return result;
}

/** 讀取整張工作表為物件陣列（標題列當鍵） */
function readRows_(sheet) {
  if (!sheet || countDataRows_(sheet) === 0) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return values.filter(function (row) { return row[0] !== '' && row[0] !== null; }).map(function (row) {
    const obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}
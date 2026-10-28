/**
 * 一家帳 — 開支
 *
 * expenses.list   month(yyyy-MM)、可選 scope、category_id；含統計（依可見度過濾）
 * expenses.create 以 expense_id 冪等；「複製」也走這裡
 * expenses.update 帶讀到的 updated_at，不同回 CONFLICT
 * expenses.void   軟刪除（status = void）
 */

const MAX_AMOUNT = 10000000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 這筆開支對 ctx.member 的可見程度：
 * 'detail' 看得到明細、可修改；'summary' 只算進統計；'hidden' 完全不回傳
 */
function expenseAccess_(ctx, e) {
  if (e.scope === 'shared') return 'detail';
  if (e.created_by === ctx.member.member_id || e.scope === ctx.member.member_id) return 'detail';
  const owner = ctx.members.filter(function (m) { return m.member_id === e.scope; })[0];
  if (owner && !owner.email) return 'detail';
  if (ctx.visibility === 'full') return 'detail';
  if (ctx.visibility === 'summary') return 'summary';
  return 'hidden';
}

function expensePublic_(e) {
  const out = publicObj_(e);
  out.amount = Number(e.amount);
  return out;
}

function sortExpenses_(list) {
  return list.sort(function (a, b) {
    if (a.expense_date !== b.expense_date) return a.expense_date < b.expense_date ? 1 : -1;
    return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
  });
}

/** 依可見度與篩選條件取出 active 的開支：{ detail: [...], counted: [...] }；counted 用於統計 */
function visibleExpenses_(ctx, match) {
  const detail = [];
  const counted = [];
  readTable_('Expenses').rows.forEach(function (e) {
    if (e.status !== 'active' || !match(e)) return;
    const access = expenseAccess_(ctx, e);
    if (access === 'hidden') return;
    counted.push(e);
    if (access === 'detail') detail.push(e);
  });
  return { detail: detail, counted: counted };
}

function expensesList_(ctx, p) {
  const month = String(p.month || todayStr_().slice(0, 7));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw fail_('VALIDATION', '月份格式錯誤。');
  const scope = p.scope ? String(p.scope) : '';
  const categoryId = p.category_id ? String(p.category_id) : '';

  const r = visibleExpenses_(ctx, function (e) {
    return e.expense_date.slice(0, 7) === month &&
      (!scope || e.scope === scope) &&
      (!categoryId || e.category_id === categoryId);
  });
  return {
    month: month,
    items: sortExpenses_(r.detail).map(expensePublic_),
    stats: summarize_(r.counted),
  };
}

function expensesCreate_(ctx, p) {
  const id = String(p.expense_id || '').toLowerCase();
  if (!UUID_RE.test(id)) throw fail_('VALIDATION', '紀錄編號格式錯誤，請重新開啟表單。');

  return withLock_(function () {
    const table = readTable_('Expenses');
    const existing = table.rows.filter(function (e) { return e.expense_id === id; })[0];
    if (existing) return expensePublic_(existing);

    const fields = validateExpense_(p, null);
    const now = nowIso_();
    const e = Object.assign({ expense_id: id }, fields, {
      created_by: ctx.member.member_id,
      created_at: now,
      updated_at: now,
      status: 'active',
    });
    appendRow_(table.sheet, 'Expenses', e);
    return expensePublic_(e);
  });
}

function expensesUpdate_(ctx, p) {
  return withLock_(function () {
    const table = readTable_('Expenses');
    const current = findEditableExpense_(ctx, table, p.expense_id);
    if (String(p.updated_at || '') !== current.updated_at) {
      throw fail_('CONFLICT', '資料已變更，請重新整理。');
    }
    const updated = Object.assign({}, current, validateExpense_(p, current), { updated_at: nowIso_() });
    writeRow_(table.sheet, 'Expenses', current._row, updated);
    return expensePublic_(updated);
  });
}

function expensesVoid_(ctx, p) {
  return withLock_(function () {
    const table = readTable_('Expenses');
    const current = findEditableExpense_(ctx, table, p.expense_id);
    const updated = Object.assign({}, current, { status: 'void', updated_at: nowIso_() });
    writeRow_(table.sheet, 'Expenses', current._row, updated);
    return expensePublic_(updated);
  });
}

/** 找到 active、且呼叫者看得到明細的紀錄；看不到的一律當作不存在 */
function findEditableExpense_(ctx, table, expenseId) {
  const id = String(expenseId || '').toLowerCase();
  const e = table.rows.filter(function (r) { return r.expense_id === id; })[0];
  if (!e || expenseAccess_(ctx, e) !== 'detail') throw fail_('NOT_FOUND', '找不到這筆紀錄，請重新整理。');
  if (e.status !== 'active') throw fail_('CONFLICT', '這筆紀錄已作廢，請重新整理。');
  return e;
}

/** yyyy-MM-dd 且是真實存在的日期（擋掉 2026-02-30） */
function isValidDate_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/**
 * 檢查使用者可填的欄位，回傳要寫入的值。
 * current 為修改前的紀錄（新增時為 null）：歸屬成員或分類沒變時，即使已停用也允許保留。
 */
function validateExpense_(p, current) {
  const date = String(p.expense_date || '');
  if (!isValidDate_(date)) throw fail_('VALIDATION', '日期格式錯誤。');

  const amountStr = String(p.amount === undefined || p.amount === null ? '' : p.amount).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(amountStr)) throw fail_('VALIDATION', '金額必須是數字，最多 2 位小數。');
  const amount = Number(amountStr);
  if (!(amount > 0)) throw fail_('VALIDATION', '金額必須大於 0。');
  if (amount > MAX_AMOUNT) throw fail_('VALIDATION', '金額不可超過 10,000,000。');

  const item = requireString_(p.item, '項目', 50);
  const note = requireString_(p.note, '備註', 200, true);

  const scope = String(p.scope || '');
  if (scope !== 'shared' && !(current && current.scope === scope)) {
    const member = readTable_('Members').rows.filter(function (m) { return m.member_id === scope; })[0];
    if (!member || !member.is_active) throw fail_('VALIDATION', '請重新選擇歸屬。');
  }

  const categoryId = String(p.category_id || '');
  let categoryName;
  if (current && current.category_id === categoryId) {
    categoryName = current.category_name;
  } else {
    const cat = readTable_('Categories').rows.filter(function (c) { return c.category_id === categoryId; })[0];
    if (!cat || !cat.is_active) throw fail_('VALIDATION', '請重新選擇分類。');
    categoryName = cat.category_name;
  }

  return {
    expense_date: date,
    amount: amount,
    item: item,
    scope: scope,
    category_id: categoryId,
    category_name: categoryName,
    note: note,
  };
}

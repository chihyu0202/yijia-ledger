/**
 * 一家帳 — 在 Apps Script 編輯器執行的測試
 *
 * testBackend()       以第一位啟用中的管理員身分，跑一輪 API（新增、重送、修改、衝突、統計、作廢）。
 *                     測試紀錄與暫時 session 結束後會刪除，不會留在試算表。
 * testLoginRejectsBadToken() 確認對外連線權限正常，且假的 id_token 會被拒絕。
 */

function testBackend() {
  const results = [];
  const check = function (label, cond) {
    results.push(cond);
    console.log((cond ? '✔ ' : '✘ ') + label);
  };

  const admin = readTable_('Members').rows.filter(function (m) {
    return m.is_active && m.role === 'admin' && m.email;
  })[0];
  if (!admin) throw new Error('找不到啟用中的管理員。');

  // 直接建立暫時 session（略過 Google 登入），測完刪除
  const session = 'test' + Utilities.getUuid().replace(/-/g, '');
  const sessKey = SESSION_PREFIX + sha256Hex_(session);
  props_().setProperty(sessKey, JSON.stringify({ member_id: admin.member_id, expires_at: Date.now() + 600000 }));
  const call = function (action, payload) {
    return handle_({ action: action, session: session, payload: payload || {} });
  };
  const expenseId = Utilities.getUuid();

  try {
    const me = call('me');
    check('me：' + (me.ok ? me.data.member.display_name + '，可見度 ' + me.data.visibility : JSON.stringify(me.error)), me.ok);
    const cat = me.ok && me.data.categories[0];
    check('有啟用中的分類', !!cat);

    check('未登入會被拒絕', handle_({ action: 'me', session: 'nope' }).error.code === 'UNAUTHORIZED');
    check('members.list', call('members.list').ok);
    check('categories.list', call('categories.list').ok);

    const today = todayStr_();
    const input = {
      expense_id: expenseId, expense_date: today, amount: 123.45, item: '【測試】請忽略',
      scope: 'shared', category_id: cat.category_id, note: '',
    };
    const c1 = call('expenses.create', input);
    check('新增', c1.ok && c1.data.amount === 123.45 && c1.data.created_by === admin.member_id);
    const c2 = call('expenses.create', Object.assign({}, input, { amount: 999 }));
    check('重送不重複新增', c2.ok && c2.data.amount === 123.45 &&
      readTable_('Expenses').rows.filter(function (e) { return e.expense_id === expenseId; }).length === 1);

    const bad = call('expenses.create', Object.assign({}, input, { expense_id: Utilities.getUuid(), amount: 1.234 }));
    check('金額 3 位小數被拒絕', !bad.ok && bad.error.code === 'VALIDATION');

    const list = call('expenses.list', { month: today.slice(0, 7) });
    check('月列表含測試紀錄', list.ok && list.data.items.some(function (e) { return e.expense_id === expenseId; }));

    const conflict = call('expenses.update', Object.assign({}, input, { updated_at: '2000-01-01T00:00:00+08:00' }));
    check('過期的 updated_at 回 CONFLICT', !conflict.ok && conflict.error.code === 'CONFLICT');

    const u = call('expenses.update', Object.assign({}, input, { amount: 200, updated_at: c1.data.updated_at }));
    check('修改', u.ok && u.data.amount === 200);

    const year = call('stats.year', { year: today.slice(0, 4) });
    check('年統計：全年 ' + (year.ok ? year.data.total : '?') + '，月平均 ' + (year.ok ? year.data.monthly_avg : '?'),
      year.ok && year.data.months.length === 12);

    const v = call('expenses.void', { expense_id: expenseId });
    check('作廢', v.ok && v.data.status === 'void');
    const list2 = call('expenses.list', { month: today.slice(0, 7) });
    check('作廢後不在列表', list2.ok && !list2.data.items.some(function (e) { return e.expense_id === expenseId; }));
  } finally {
    props_().deleteProperty(sessKey);
    withLock_(function () {
      const table = readTable_('Expenses');
      const row = table.rows.filter(function (e) { return e.expense_id === expenseId; })[0];
      if (row) table.sheet.deleteRow(row._row);
    });
  }

  const failed = results.filter(function (r) { return !r; }).length;
  console.log(failed ? '✘ 有 ' + failed + ' 項失敗' : '✔ 全部通過（測試紀錄已刪除）');
}

function testLoginRejectsBadToken() {
  const r = handle_({ action: 'auth.login', payload: { id_token: 'not-a-real-token', nonce: 'x' } });
  console.log(JSON.stringify(r));
  console.log(!r.ok && r.error.code === 'UNAUTHORIZED' ? '✔ 假 token 被拒絕，對外連線正常' : '✘ 結果不如預期');
}

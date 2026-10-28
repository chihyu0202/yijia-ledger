/**
 * 一家帳 — Web App 入口
 *
 * 前端以 POST（Content-Type: text/plain）送出 JSON：
 *   { "action": "...", "session": "...", "payload": { ... } }
 * 回應：{ ok: true, data } 或 { ok: false, error: { code, message } }
 */

/** action → 處理函式。public 表示不需要 session */
function routes_() {
  return {
    'auth.login': { fn: authLogin_, public: true },
    'auth.logout': { fn: authLogout_, public: true },
    'me': { fn: me_ },
    'expenses.list': { fn: expensesList_ },
    'expenses.create': { fn: expensesCreate_ },
    'expenses.update': { fn: expensesUpdate_ },
    'expenses.void': { fn: expensesVoid_ },
    'stats.year': { fn: statsYear_ },
    'categories.list': { fn: categoriesList_ },
    'categories.save': { fn: categoriesSave_ },
    'categories.reorder': { fn: categoriesReorder_ },
    'members.list': { fn: membersList_ },
    'members.save': { fn: membersSave_ },
    'members.reorder': { fn: membersReorder_ },
  };
}

function doPost(e) {
  let req = null;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '');
  } catch (err) {
    req = null;
  }
  return jsonOut_(handle_(req));
}

/** 直接打開網址時用來確認部署成功 */
function doGet() {
  return jsonOut_({ ok: true, data: { app: '一家帳' } });
}

function handle_(req) {
  try {
    if (!req || typeof req !== 'object' || typeof req.action !== 'string') {
      throw fail_('BAD_REQUEST', '請求格式錯誤。');
    }
    const route = routes_()[req.action];
    if (!route) throw fail_('BAD_REQUEST', '不支援的操作：' + req.action);

    const payload = req.payload && typeof req.payload === 'object' ? req.payload : {};
    const data = route.public
      ? route.fn(payload, req.session)
      : route.fn(requireSession_(req.session), payload);
    return { ok: true, data: data === undefined ? null : data };
  } catch (err) {
    if (err && err.appCode) {
      return { ok: false, error: { code: err.appCode, message: err.message } };
    }
    console.error((err && err.stack) || err);
    return { ok: false, error: { code: 'INTERNAL', message: '系統發生錯誤，請稍後再試。' } };
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

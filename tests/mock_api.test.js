// 以模擬的 Apps Script 環境測第三階段 API：登入、權限、開支、分類、成員、統計。
// 執行：node tests/mock_api.test.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');
const dir = process.argv[2] || path.join(__dirname, '..', 'backend');

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

function makeEnv() {
  const store = {}; const spreadsheets = {}; const logs = [];
  const tokens = {}; // 假的 tokeninfo：id_token → 回應內容
  let n = 0;
  const ctx = {
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
    '\nthis.__api = { setup, handle_, doPost, readTable_ };', ctx);
  return { ctx, store, spreadsheets, logs, tokens, api: ctx.__api };
}

let pass = 0, fail = 0;
function check(label, cond) { if (cond) pass++; else { fail++; console.log('FAIL: ' + label); } }
function errCode(label, res, code) { check(label + ' → ' + code + (res.ok ? '（實際成功）' : '（實際 ' + res.error.code + '）'), !res.ok && res.error.code === code); }

// ---------- 準備 ----------
const env = makeEnv();
const { api, store, tokens } = env;
store.INITIAL_MEMBERS = JSON.stringify([
  { name: 'Gloria', email: 'gloria@example.com', role: 'admin' },
  { name: 'Yao', email: 'yao@example.com', role: 'admin' },
  { name: '小珠寶' },
]);
store.GOOGLE_CLIENT_ID = 'client-1.apps.googleusercontent.com';
api.setup();
const ss = env.spreadsheets[store.SPREADSHEET_ID];
const exSheet = ss.getSheetByName('Expenses');
const call = (action, session, payload) => api.handle_({ action, session, payload: payload || {} });
const exp = Math.floor(Date.now() / 1000) + 3600;
function googleToken(email, overrides) {
  const t = 'tok-' + crypto.randomUUID();
  tokens[t] = Object.assign({ aud: store.GOOGLE_CLIENT_ID, iss: 'https://accounts.google.com', exp: String(exp), email, email_verified: 'true', nonce: 'n1' }, overrides);
  return t;
}
function login(email) { const r = call('auth.login', null, { id_token: googleToken(email.toUpperCase()), nonce: 'n1' }); return r.ok ? r.data.session : null; }
const today = formatDate(new Date(), '', 'yyyy-MM-dd');
const month = today.slice(0, 7);

// ---------- 登入 ----------
errCode('假 token', call('auth.login', null, { id_token: 'bad', nonce: 'n1' }), 'UNAUTHORIZED');
errCode('aud 不符', call('auth.login', null, { id_token: googleToken('gloria@example.com', { aud: 'other' }), nonce: 'n1' }), 'UNAUTHORIZED');
errCode('iss 不符', call('auth.login', null, { id_token: googleToken('gloria@example.com', { iss: 'evil.com' }), nonce: 'n1' }), 'UNAUTHORIZED');
errCode('已過期', call('auth.login', null, { id_token: googleToken('gloria@example.com', { exp: '1000' }), nonce: 'n1' }), 'UNAUTHORIZED');
errCode('email 未驗證', call('auth.login', null, { id_token: googleToken('gloria@example.com', { email_verified: 'false' }), nonce: 'n1' }), 'UNAUTHORIZED');
errCode('nonce 不符', call('auth.login', null, { id_token: googleToken('gloria@example.com'), nonce: 'n2' }), 'UNAUTHORIZED');
errCode('缺 nonce', call('auth.login', null, { id_token: googleToken('gloria@example.com') }), 'BAD_REQUEST');
errCode('非成員', call('auth.login', null, { id_token: googleToken('stranger@example.com'), nonce: 'n1' }), 'FORBIDDEN');

store.sess_expired = JSON.stringify({ member_id: 'x', expires_at: 1 });
const gSess = login('gloria@example.com');
const ySess = login('yao@example.com');
check('登入成功（email 不分大小寫）', !!gSess && !!ySess);
check('過期 session 已清除', !('sess_expired' in store));
check('只存雜湊，不存 session 原文', !Object.keys(store).some((k) => k.includes(gSess)) && !Object.values(store).some((v) => v.includes(gSess)));
const sessVal = JSON.parse(store[Object.keys(store).find((k) => k.startsWith('sess_'))]);
check('session 30 天', Math.abs(sessVal.expires_at - Date.now() - 30 * 86400000) < 5000);

errCode('沒帶 session', call('me', null), 'UNAUTHORIZED');
errCode('錯的 session', call('me', 'abc'), 'UNAUTHORIZED');
errCode('未知 action', call('nope', gSess), 'BAD_REQUEST');
check('doPost 壞 JSON', JSON.parse(api.doPost({ postData: { contents: '{bad' } }).content).error.code === 'BAD_REQUEST');
check('doPost 正常', JSON.parse(api.doPost({ postData: { contents: JSON.stringify({ action: 'me', session: gSess }) } }).content).ok);

// ---------- me ----------
const me = call('me', gSess).data;
check('me 成員', me.member.display_name === 'Gloria' && me.member.role === 'admin' && me.visibility === 'full');
check('me 7 個分類依預設順序', me.categories.map((c) => c.category_name).join() === '餐飲,交通,居家生活,育兒,醫療,娛樂,其他');
check('me 成員清單不含 email', me.members.length === 3 && me.members.every((m) => !('email' in m)) && me.members[2].can_login === false);
const [G, Y, K] = me.members.map((m) => m.member_id);

// ---------- 新增 ----------
function newExpense(o) {
  return Object.assign({ expense_id: crypto.randomUUID(), expense_date: today, amount: 100, item: '午餐', scope: 'shared', category_id: 'cat_food', note: '' }, o);
}
const e1 = newExpense({ amount: '123.45' });
const r1 = call('expenses.create', gSess, e1);
check('新增成功', r1.ok && r1.data.amount === 123.45 && r1.data.created_by === G && r1.data.category_name === '餐飲' && r1.data.status === 'active');
check('新增寫在第 2 列', exSheet.getRange(2, 1, 1, 1).getValues()[0][0] === e1.expense_id);
const r1b = call('expenses.create', gSess, Object.assign({}, e1, { amount: 1 }));
check('重送回傳原紀錄、不重複', r1b.ok && r1b.data.amount === 123.45 && exSheet.getLastRow() === 2);

errCode('金額 0', call('expenses.create', gSess, newExpense({ amount: 0 })), 'VALIDATION');
errCode('金額負數', call('expenses.create', gSess, newExpense({ amount: -5 })), 'VALIDATION');
errCode('金額 3 位小數', call('expenses.create', gSess, newExpense({ amount: 1.234 })), 'VALIDATION');
errCode('金額超過上限', call('expenses.create', gSess, newExpense({ amount: 10000000.01 })), 'VALIDATION');
check('金額剛好上限', call('expenses.create', gSess, newExpense({ amount: 10000000 })).ok);
errCode('項目空白', call('expenses.create', gSess, newExpense({ item: '  ' })), 'VALIDATION');
errCode('項目 51 字', call('expenses.create', gSess, newExpense({ item: 'x'.repeat(51) })), 'VALIDATION');
errCode('備註 201 字', call('expenses.create', gSess, newExpense({ note: 'x'.repeat(201) })), 'VALIDATION');
errCode('不存在的日期', call('expenses.create', gSess, newExpense({ expense_date: '2026-02-30' })), 'VALIDATION');
errCode('未知歸屬', call('expenses.create', gSess, newExpense({ scope: 'm_nobody' })), 'VALIDATION');
errCode('未知分類', call('expenses.create', gSess, newExpense({ category_id: 'cat_x' })), 'VALIDATION');
errCode('ID 格式錯', call('expenses.create', gSess, newExpense({ expense_id: '123' })), 'VALIDATION');

// 清掉上限測試那筆，後面統計比較好算
api.readTable_('Expenses').rows.filter((e) => e.amount === 10000000).forEach((e) => call('expenses.void', gSess, { expense_id: e.expense_id }));

// ---------- 修改 / 衝突 ----------
errCode('updated_at 不同 → 衝突', call('expenses.update', ySess, Object.assign({}, e1, { updated_at: 'old' })), 'CONFLICT');
const u1 = call('expenses.update', ySess, Object.assign({}, e1, { amount: 200, category_id: 'cat_transport', updated_at: r1.data.updated_at }));
check('Yao 可改家庭開支、分類快照更新', u1.ok && u1.data.amount === 200 && u1.data.category_name === '交通' && u1.data.created_by === G);

// 分類停用後：沒換分類可以保留；新增不能用
call('categories.save', gSess, { category_id: 'cat_transport', category_name: '交通', is_active: false });
const u2 = call('expenses.update', gSess, Object.assign({}, e1, { amount: 210, category_id: 'cat_transport', updated_at: u1.data.updated_at }));
check('停用分類：原紀錄可保留該分類', u2.ok && u2.data.category_name === '交通');
errCode('停用分類：新增不可用', call('expenses.create', gSess, newExpense({ category_id: 'cat_transport' })), 'VALIDATION');
call('categories.save', gSess, { category_id: 'cat_transport', category_name: '交通', is_active: true });

// ---------- 可見度 ----------
const gPersonal = newExpense({ scope: G, amount: 50, item: 'G 私人', category_id: 'cat_fun' });
const kidByG = newExpense({ scope: K, amount: 30, item: '小珠寶', category_id: 'cat_baby' });
const gByY = newExpense({ scope: G, amount: 7, item: 'Y 幫 G 記', category_id: 'cat_other' });
call('expenses.create', gSess, gPersonal);
call('expenses.create', gSess, kidByG);
call('expenses.create', ySess, gByY);
const ids = (r) => r.data.items.map((e) => e.item).sort().join();

let ly = call('expenses.list', ySess, { month });
check('full：Yao 看得到全部', ids(ly) === ['G 私人', 'Y 幫 G 記', '午餐', '小珠寶'].sort().join() && ly.data.stats.total === 297);

store.PERSONAL_VISIBILITY = 'summary';
ly = call('expenses.list', ySess, { month });
check('summary：明細不含 G 私人', !ids(ly).includes('G 私人') && ids(ly).includes('Y 幫 G 記') && ids(ly).includes('小珠寶'));
check('summary：統計仍含 G 私人', ly.data.stats.total === 297 && ly.data.stats.by_category.some((c) => c.category_id === 'cat_fun' && c.amount === 50));
errCode('summary：不能改別人的個人開支', call('expenses.update', ySess, Object.assign({}, gPersonal, { updated_at: 'x' })), 'NOT_FOUND');
errCode('summary：不能作廢別人的個人開支', call('expenses.void', ySess, { expense_id: gPersonal.expense_id }), 'NOT_FOUND');

store.PERSONAL_VISIBILITY = 'private';
ly = call('expenses.list', ySess, { month });
check('private：明細與統計都不含 G 私人', !ids(ly).includes('G 私人') && ly.data.stats.total === 247);
check('private：自己建立的、無 email 成員的看得到', ids(ly).includes('Y 幫 G 記') && ids(ly).includes('小珠寶'));
const yYear = call('stats.year', ySess, { year: today.slice(0, 4) });
check('private：年統計也排除', yYear.ok && yYear.data.total === 247);
const lg = call('expenses.list', gSess, { month });
check('private：本人看得到自己的', ids(lg).includes('G 私人') && lg.data.stats.total === 297);
store.PERSONAL_VISIBILITY = 'bogus';
errCode('可見度設定錯誤', call('expenses.list', ySess, { month }), 'CONFIG');
store.PERSONAL_VISIBILITY = 'full';

// ---------- 篩選、統計 ----------
const lf = call('expenses.list', gSess, { month, scope: G });
check('依歸屬篩選', ids(lf) === ['G 私人', 'Y 幫 G 記'].sort().join() && lf.data.stats.total === 57);
const lc = call('expenses.list', gSess, { month, category_id: 'cat_baby' });
check('依分類篩選', ids(lc) === '小珠寶');
errCode('月份格式錯', call('expenses.list', gSess, { month: '2026-13' }), 'VALIDATION');
const oldDay = newExpense({ expense_date: today.slice(0, 4) + '-01-01', amount: 0.1 });
const oldDay2 = newExpense({ expense_date: today.slice(0, 4) + '-01-02', amount: 0.2 });
call('expenses.create', gSess, oldDay);
call('expenses.create', gSess, oldDay2);
const ys = call('stats.year', gSess, { year: today.slice(0, 4) }).data;
const mIdx = Number(today.slice(5, 7)) - 1;
check('年統計 12 個月、無浮點誤差', ys.months.length === 12 && (mIdx === 0 ? ys.months[0] === 297.3 : ys.months[0] === 0.3 && ys.months[mIdx] === 297));
check('年統計總額', ys.total === 297.3);
check('月平均（今年除到本月）', ys.monthly_avg === Math.round(29730 / (mIdx + 1)) / 100);
check('各歸屬', ys.by_scope.find((s) => s.scope === 'shared').amount === 210.3);
const yc = call('stats.year', gSess, { year: today.slice(0, 4), category_id: 'cat_baby' }).data;
check('年統計指定分類', yc.total === 30 && yc.months[mIdx] === 30);
const past = call('stats.year', gSess, { year: '2000' }).data;
check('沒資料的年份', past.total === 0 && past.monthly_avg === 0);
const sorted = call('expenses.list', gSess, { month: today.slice(0, 7) }).data.items;
check('列表日期新到舊', sorted.every((e, i) => i === 0 || sorted[i - 1].expense_date >= e.expense_date));

// ---------- 作廢 ----------
const before = call('expenses.list', gSess, { month }).data.items.find((e) => e.expense_id === kidByG.expense_id);
const v1 = call('expenses.void', ySess, { expense_id: kidByG.expense_id });
check('作廢', v1.ok && v1.data.status === 'void');
check('作廢後不在列表、統計扣除', !ids(call('expenses.list', gSess, { month })).includes('小珠寶') && call('expenses.list', gSess, { month }).data.stats.total === 267);
errCode('作廢後不能修改', call('expenses.update', gSess, Object.assign({}, kidByG, { updated_at: before.updated_at })), 'CONFLICT');

// ---------- 分類 ----------
const nc = call('categories.save', ySess, { category_name: '寵物' });
check('新增分類', nc.ok && nc.data.sort_order === 80 && nc.data.is_active === true && /^cat_/.test(nc.data.category_id));
check('分類列有勾選框', ss.getSheetByName('Categories').getRange(9, 4, 1, 1).getValues()[0][0] === true);
errCode('同名分類', call('categories.save', gSess, { category_name: '寵物' }), 'VALIDATION');
errCode('分類名稱空白', call('categories.save', gSess, { category_name: '' }), 'VALIDATION');
check('改名', call('categories.save', gSess, { category_id: nc.data.category_id, category_name: '毛孩' }).data.category_name === '毛孩');
const ro = call('categories.reorder', gSess, { order: [nc.data.category_id, 'cat_other'] });
check('個人排序', ro.ok && ro.data[0].category_name === '毛孩' && ro.data[1].category_name === '其他' && ro.data[2].category_name === '餐飲');
check('個人排序不影響 Yao', call('me', ySess).data.categories[0].category_name === '餐飲');
check('Gloria 的 me 依個人排序', call('me', gSess).data.categories[0].category_name === '毛孩');
errCode('排序含未知 ID', call('categories.reorder', gSess, { order: ['cat_zzz'] }), 'VALIDATION');
check('改名後統計用新名稱', (() => {
  call('expenses.create', gSess, newExpense({ category_id: nc.data.category_id, amount: 1 }));
  call('categories.save', gSess, { category_id: nc.data.category_id, category_name: '寵物' });
  return call('expenses.list', gSess, { month }).data.stats.by_category.some((c) => c.category_name === '寵物');
})());
const allCats = call('categories.list', gSess).data;
allCats.slice(1).forEach((c) => call('categories.save', gSess, { category_id: c.category_id, category_name: c.category_name, is_active: false }));
errCode('不能停用最後一個分類', call('categories.save', gSess, { category_id: allCats[0].category_id, category_name: allCats[0].category_name, is_active: false }), 'VALIDATION');
check('categories.list 含停用', call('categories.list', gSess).data.filter((c) => !c.is_active).length === allCats.length - 1);
allCats.forEach((c) => call('categories.save', gSess, { category_id: c.category_id, category_name: c.category_name, is_active: true }));

// ---------- 成員 ----------
const nm = call('members.save', gSess, { display_name: 'Kid', email: 'KID@example.com', role: 'member' });
check('新增成員', nm.ok && nm.data.email === 'kid@example.com' && nm.data.sort_order === 40 && nm.data.is_active);
errCode('email 重複', call('members.save', gSess, { display_name: 'X', email: 'yao@example.com', role: 'member' }), 'VALIDATION');
errCode('admin 沒 email', call('members.save', gSess, { display_name: 'X', role: 'admin' }), 'VALIDATION');
errCode('email 格式', call('members.save', gSess, { display_name: 'X', email: 'abc', role: 'member' }), 'VALIDATION');
const kSess = login('kid@example.com');
check('新成員可登入', !!kSess);
errCode('一般成員不能管理成員', call('members.save', kSess, { display_name: 'Z', role: 'member' }), 'FORBIDDEN');
errCode('一般成員不能排序成員', call('members.reorder', kSess, { order: [] }), 'FORBIDDEN');
check('一般成員的成員清單不含 email', call('members.list', kSess).data.every((m) => !('email' in m)));
check('admin 的成員清單含 email', call('members.list', gSess).data.some((m) => m.email === 'yao@example.com'));

const mr = call('members.reorder', gSess, { order: [K, Y, G, nm.data.member_id] });
check('成員排序', mr.ok && mr.data.map((m) => m.display_name).join() === '小珠寶,Yao,Gloria,Kid');
errCode('成員排序缺人', call('members.reorder', gSess, { order: [K, Y, G] }), 'VALIDATION');

check('停用 Kid', call('members.save', gSess, { member_id: nm.data.member_id, display_name: 'Kid', email: 'kid@example.com', role: 'member', is_active: false }).ok);
errCode('停用後 session 失效', call('me', kSess), 'UNAUTHORIZED');
errCode('停用後不能登入', call('auth.login', null, { id_token: googleToken('kid@example.com'), nonce: 'n1' }), 'FORBIDDEN');
errCode('停用成員不能當新歸屬', call('expenses.create', gSess, newExpense({ scope: nm.data.member_id })), 'VALIDATION');

check('停用 Yao（還有 Gloria）', call('members.save', gSess, { member_id: Y, display_name: 'Yao', email: 'yao@example.com', role: 'admin', is_active: false }).ok);
errCode('不能停用最後一位 admin', call('members.save', gSess, { member_id: G, display_name: 'Gloria', email: 'gloria@example.com', role: 'admin', is_active: false }), 'VALIDATION');
errCode('不能把最後一位 admin 降級', call('members.save', gSess, { member_id: G, display_name: 'Gloria', email: 'gloria@example.com', role: 'member' }), 'VALIDATION');
errCode('找不到成員', call('members.save', gSess, { member_id: 'm_zzz', display_name: 'X', role: 'member' }), 'NOT_FOUND');
check('成員列有勾選框', ss.getSheetByName('Members').getRange(5, 6, 1, 1).getValues()[0][0] === false);

// ---------- 登出、錯誤處理 ----------
call('auth.logout', null, {}); // 沒帶 session 也不出錯
check('登出', call('auth.logout', gSess, {}).ok);
errCode('登出後 session 失效', call('me', gSess), 'UNAUTHORIZED');
const s2 = login('gloria@example.com');
env.ctx.readTable_ = () => { throw new Error('boom'); };
const internal = call('me', s2);
check('非預期錯誤回 INTERNAL 中文訊息', !internal.ok && internal.error.code === 'INTERNAL' && /系統發生錯誤/.test(internal.error.message));

console.log(`passed ${pass}, failed ${fail}`);
process.exit(fail ? 1 : 0);

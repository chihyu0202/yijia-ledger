'use strict';

/*
 * 一家帳 — 前端
 * 第四階段：分頁、Google 登入、新增／修改／複製、紀錄、首頁統計、設定（分類、成員）
 * 第五階段：Service Worker（只快取介面檔）
 * 第七階段：畫面資料暫存與預先載入（只在記憶體）
 */

const SESSION_KEY = 'yj_session';
const OAUTH_KEY = 'yj_oauth'; // 登入途中暫存 { nonce, state }；iOS 主畫面模式可能換瀏覽環境，故用 localStorage
const MAX_AMOUNT = 10000000;
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

const state = {
  session: null,
  me: null,           // me 的回應；me.categories 為啟用中、依個人排序
  categories: [],     // 全部分類（含停用），依個人排序
  form: null,         // { mode: 'create'|'edit'|'copy', expenseId, scope, categoryId, original }
  saving: false,
  home: null,         // { mode: 'month'|'year', month, year, categoryId }
  records: null,      // { month, scope, categoryId, items }
  seq: { home: 0, records: 0, settings: 0 }, // 只採用最後一次請求的結果
  busy: false,        // 設定頁寫入中，避免連點
};

const $ = (id) => document.getElementById(id);

/* ---------- 工具 ---------- */

/** 建立元素；文字一律當純文字放入，不用 innerHTML */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  Object.entries(props || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === false) return;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  });
  children.flat().forEach((c) => {
    if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  });
  return el;
}

/** 台北時間的今天 yyyy-MM-dd */
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

function monthLabel(ym) {
  return ym.slice(0, 4) + ' 年 ' + Number(ym.slice(5, 7)) + ' 月';
}

/** 2026-10-28 → 10/28（三） */
function dateLabel(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return m + '/' + d + '（' + WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + '）';
}

const moneyFmt = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 });
function money(n) {
  return '$' + moneyFmt.format(n);
}

function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2000);
}

function memberById(id) {
  return state.me.members.find((m) => m.member_id === id);
}

function scopeName(scope) {
  if (scope === 'shared') return '家庭開支';
  const m = memberById(scope);
  return m ? m.display_name : '（未知成員）';
}

function categoryName(id) {
  const c = state.categories.find((x) => x.category_id === id);
  return c ? c.category_name : '';
}

function loadingBox() {
  return h('p', { class: 'muted' }, '載入中…');
}

function errorBox(msg, retry) {
  return h('div', { class: 'card' },
    h('p', { class: 'error-text' }, msg),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: retry }, '重試'));
}

/* ---------- API ---------- */

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function api(action, payload) {
  let body;
  try {
    const res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // 避開 CORS 預檢
      body: JSON.stringify({ action, session: state.session, payload: payload || {} }),
    });
    body = await res.json();
  } catch (e) {
    throw new ApiError('NETWORK', '無法連線，請檢查網路後再試。');
  }
  if (!body.ok) {
    if (body.error.code === 'UNAUTHORIZED' && state.session) {
      clearSession();
      closeSheet();
      showLogin(body.error.message);
    }
    throw new ApiError(body.error.code, body.error.message);
  }
  return body.data;
}

/* ---------- 畫面資料暫存 ---------- */

// 已載入過的畫面資料（只在記憶體，關掉 App 就清除）。
// 再次進入同一畫面時先顯示暫存，同時向後端取最新；資料有變才重畫。
const viewCache = new Map();

function cacheKey(action, payload) {
  const clean = Object.keys(payload || {}).sort().filter((k) => payload[k] !== '' && payload[k] !== undefined)
    .map((k) => [k, payload[k]]);
  return action + JSON.stringify(clean);
}

/** 資料有異動（新增、修改、作廢、設定）後清掉暫存，並在背景先抓這個月的資料 */
function invalidateCache(month) {
  viewCache.clear();
  prefetch('expenses.list', { month: month || today().slice(0, 7) });
}

function prefetch(action, payload) {
  api(action, payload).then((data) => viewCache.set(cacheKey(action, payload), data)).catch(() => {});
}

/**
 * 載入某個分頁的內容：view 為 home／records／settings。
 * fetchFn 回傳資料；render(data) 畫出畫面；retry 為失敗時「重試」要做的事。
 */
async function loadView(view, key, fetchFn, render, retry) {
  const seq = ++state.seq[view];
  const box = $(view + '-body');
  const hit = viewCache.get(key);
  if (hit) render(hit);
  else box.replaceChildren(loadingBox());
  try {
    const data = await fetchFn();
    if (seq !== state.seq[view]) return;
    viewCache.set(key, data);
    if (!hit || JSON.stringify(hit) !== JSON.stringify(data)) render(data);
  } catch (e) {
    if (seq !== state.seq[view]) return;
    if (hit) toast('無法更新：' + e.message);
    else box.replaceChildren(errorBox(e.message, retry));
  }
}

/* ---------- 登入 ---------- */

function saveSession(session) {
  state.session = session;
  localStorage.setItem(SESSION_KEY, session);
}

function clearSession() {
  state.session = null;
  state.me = null;
  viewCache.clear();
  localStorage.removeItem(SESSION_KEY);
}

/** 顯示登入畫面；action 為按鈕要做的事（預設前往 Google 登入），null 表示不顯示按鈕 */
function showLogin(msg, action) {
  $('app').hidden = true;
  $('login').hidden = false;
  $('login-msg').textContent = msg || '';
  const btn = $('login-btn');
  btn.disabled = false;
  btn.hidden = action === null;
  btn.textContent = action === enterApp ? '重新載入' : '使用 Google 登入';
  btn.onclick = action || startLogin;
}

/** redirect_uri 必須和 OAuth 用戶端設定完全一致（結尾有 /，不含 index.html） */
function redirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

async function startLogin() {
  $('login-btn').disabled = true;
  $('login-msg').textContent = '前往 Google…';
  try {
    const cfg = await api('auth.config');
    const oauth = { nonce: randomHex(16), state: randomHex(16) };
    localStorage.setItem(OAUTH_KEY, JSON.stringify(oauth));
    const params = new URLSearchParams({
      client_id: cfg.client_id,
      redirect_uri: redirectUri(),
      response_type: 'id_token',
      scope: 'openid email',
      nonce: oauth.nonce,
      state: oauth.state,
      prompt: 'select_account',
    });
    location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + params);
  } catch (e) {
    showLogin(e.message);
  }
}

/** Google 導回時 id_token 在 # 片段；有處理回傳 true */
async function handleRedirect() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (!p.has('id_token') && !p.has('error')) return false;

  history.replaceState(null, '', location.pathname + location.search); // 不讓 token 留在網址
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(OAUTH_KEY));
  } catch (e) {
    saved = null;
  }
  localStorage.removeItem(OAUTH_KEY);

  if (p.has('error')) {
    showLogin('已取消登入。');
  } else if (!saved || p.get('state') !== saved.state) {
    showLogin('登入逾時，請再試一次。');
  } else {
    showLogin('登入中…', null);
    try {
      const data = await api('auth.login', { id_token: p.get('id_token'), nonce: saved.nonce });
      saveSession(data.session);
      await enterApp();
    } catch (e) {
      showLogin(e.message);
    }
  }
  return true;
}

async function enterApp() {
  showLogin('載入中…', null);
  try {
    const [me, categories] = await Promise.all([api('me'), api('categories.list')]);
    state.me = me;
    state.categories = categories;
  } catch (e) {
    if (e.code !== 'UNAUTHORIZED') showLogin(e.message, enterApp);
    return;
  }
  const now = today();
  state.home = { mode: 'month', month: now.slice(0, 7), year: now.slice(0, 4), categoryId: '' };
  state.records = { month: now.slice(0, 7), scope: '', categoryId: '', items: [] };
  $('login').hidden = true;
  $('app').hidden = false;
  $('me-name').textContent = state.me.member.display_name;
  openForm('create');
  showTab('home'); // 首頁本月資料與「紀錄」預設畫面是同一份，看完首頁切到紀錄不用再等
  fetchSettings().then((data) => viewCache.set('settings', data)).catch(() => {});
}

async function logout() {
  try {
    await api('auth.logout');
  } catch (e) {
    // 登出失敗也照樣清掉本機 session
  }
  clearSession();
  showLogin('已登出。');
}

/* ---------- 分頁 ---------- */

function showTab(name) {
  document.querySelectorAll('.tab').forEach((el) => { el.hidden = el.id !== 'tab-' + name; });
  document.querySelectorAll('.tabbar button').forEach((b) => {
    if (b.dataset.tab === name) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  if (name === 'home') loadHome();
  if (name === 'records') loadRecords();
  if (name === 'settings') loadSettings();
}

/* ---------- 底部面板 ---------- */

function openSheet(...children) {
  $('sheet-body').replaceChildren(...children);
  $('sheet').hidden = false;
}

function closeSheet() {
  $('sheet').hidden = true;
  $('sheet-body').replaceChildren();
}

/* ---------- 共用篩選元件 ---------- */

function periodNav(label, onPrev, onNext) {
  return h('div', { class: 'period' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': '上一個', onclick: onPrev }, '‹'),
    h('strong', null, label),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': '下一個', onclick: onNext }, '›'));
}

function select(label, options, value, onchange) {
  return h('select', { class: 'select', 'aria-label': label, onchange: (ev) => onchange(ev.target.value) },
    options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
}

function categoryOptions() {
  return [{ value: '', label: '全部分類' }].concat(state.categories.map((c) => ({
    value: c.category_id, label: c.category_name + (c.is_active ? '' : '（停用）'),
  })));
}

function scopeOptions() {
  return [{ value: '', label: '全部歸屬' }, { value: 'shared', label: '家庭開支' }].concat(
    state.me.members.map((m) => ({ value: m.member_id, label: m.display_name + (m.is_active ? '' : '（停用）') })));
}

function barRows(rows, onclick) {
  const max = Math.max(0, ...rows.map((r) => r.amount));
  return rows.map((r) => h(onclick ? 'button' : 'div', {
    class: 'bar-row', type: onclick ? 'button' : null, onclick: onclick ? () => onclick(r) : null,
  },
  h('span', { class: 'bar-label' }, r.label),
  h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: 'width:' + (max ? (r.amount / max) * 100 : 0) + '%' })),
  h('span', { class: 'bar-amount' }, money(r.amount))));
}

function scopeRows(byScope) {
  return byScope.map((s) => ({ label: scopeName(s.scope), amount: s.amount }));
}

function categoryRows(byCategory) {
  return byCategory.map((c) => ({ label: c.category_name, amount: c.amount }));
}

/* ---------- 首頁：統計 ---------- */

function renderHomeControls() {
  const H = state.home;
  const isMonth = H.mode === 'month';
  const setMode = (mode) => { H.mode = mode; renderHomeControls(); loadHome(); };
  const shift = (d) => {
    if (isMonth) H.month = shiftMonth(H.month, d);
    else H.year = String(Number(H.year) + d);
    renderHomeControls();
    loadHome();
  };
  $('home-controls').replaceChildren(
    h('div', { class: 'segmented' },
      h('button', { type: 'button', 'aria-pressed': String(isMonth), onclick: () => setMode('month') }, '月'),
      h('button', { type: 'button', 'aria-pressed': String(!isMonth), onclick: () => setMode('year') }, '年')),
    periodNav(isMonth ? monthLabel(H.month) : H.year + ' 年', () => shift(-1), () => shift(1)),
    select('分類', categoryOptions(), H.categoryId, (v) => { H.categoryId = v; loadHome(); }));
}

function loadHome() {
  const H = state.home;
  renderHomeControls();
  const isMonth = H.mode === 'month';
  const action = isMonth ? 'expenses.list' : 'stats.year';
  const payload = isMonth ? { month: H.month, category_id: H.categoryId } : { year: H.year, category_id: H.categoryId };
  return loadView('home', cacheKey(action, payload), () => api(action, payload),
    (data) => $('home-body').replaceChildren(...(isMonth ? homeMonth(data.stats) : homeYear(data))), loadHome);
}

function homeMonth(stats) {
  const H = state.home;
  const out = [h('div', { class: 'total-card' },
    h('p', { class: 'label' }, (H.categoryId ? categoryName(H.categoryId) + ' · ' : '') + '本月支出'),
    h('div', { class: 'big' }, money(stats.total)),
    h('div', { class: 'sub' }, stats.count + ' 筆'))];
  if (!stats.count) return out.concat(h('p', { class: 'muted' }, '這個月還沒有紀錄。'));
  out.push(h('h3', { class: 'section-title' }, '各歸屬'), ...barRows(scopeRows(stats.by_scope)));
  if (!H.categoryId) out.push(h('h3', { class: 'section-title' }, '各分類'), ...barRows(categoryRows(stats.by_category)));
  out.push(h('button', { class: 'btn btn-secondary btn-block mt', type: 'button',
    onclick: () => openRecords(H.month, H.categoryId) }, '查看明細'));
  return out;
}

function homeYear(data) {
  const H = state.home;
  const out = [h('div', { class: 'total-card' },
    h('p', { class: 'label' }, (H.categoryId ? categoryName(H.categoryId) + ' · ' : '') + '全年支出'),
    h('div', { class: 'big' }, money(data.total)),
    h('div', { class: 'sub' }, '月平均 ' + money(data.monthly_avg)))];
  const months = data.months.map((amount, i) => ({ label: (i + 1) + ' 月', amount, month: data.year + '-' + String(i + 1).padStart(2, '0') }));
  out.push(h('h3', { class: 'section-title' }, '各月（點選看明細）'),
    ...barRows(months, (r) => openRecords(r.month, H.categoryId)));
  if (data.by_scope.length) out.push(h('h3', { class: 'section-title' }, '各歸屬'), ...barRows(scopeRows(data.by_scope)));
  if (!H.categoryId && data.by_category.length) {
    out.push(h('h3', { class: 'section-title' }, '各分類'), ...barRows(categoryRows(data.by_category)));
  }
  return out;
}

/* ---------- 紀錄 ---------- */

function openRecords(month, categoryId) {
  state.records.month = month;
  state.records.scope = '';
  state.records.categoryId = categoryId || '';
  showTab('records');
}

function renderRecordsControls() {
  const R = state.records;
  const shift = (d) => { R.month = shiftMonth(R.month, d); loadRecords(); };
  $('records-controls').replaceChildren(
    periodNav(monthLabel(R.month), () => shift(-1), () => shift(1)),
    h('div', { class: 'filters' },
      select('歸屬', scopeOptions(), R.scope, (v) => { R.scope = v; loadRecords(); }),
      select('分類', categoryOptions(), R.categoryId, (v) => { R.categoryId = v; loadRecords(); })));
}

function loadRecords() {
  const R = state.records;
  renderRecordsControls();
  const payload = { month: R.month, scope: R.scope, category_id: R.categoryId };
  return loadView('records', cacheKey('expenses.list', payload), () => api('expenses.list', payload),
    (data) => { R.items = data.items; renderRecords(); }, loadRecords);
}

function renderRecords() {
  const items = state.records.items;
  if (!items.length) {
    $('records-body').replaceChildren(h('p', { class: 'muted' }, '沒有符合條件的紀錄。'));
    return;
  }
  const sumCents = items.reduce((s, e) => s + Math.round(e.amount * 100), 0);
  const out = [h('p', { class: 'list-summary' }, items.length + ' 筆，合計 ' + money(sumCents / 100))];
  let lastDate = '';
  items.forEach((e) => {
    if (e.expense_date !== lastDate) {
      lastDate = e.expense_date;
      out.push(h('div', { class: 'date-head' }, dateLabel(e.expense_date)));
    }
    out.push(h('button', { class: 'rec', type: 'button', onclick: () => openRecordSheet(e) },
      h('span', { class: 'rec-main' },
        h('div', { class: 'rec-item' }, e.item),
        h('div', { class: 'rec-sub' }, [e.category_name, scopeName(e.scope), e.note].filter(Boolean).join(' · '))),
      h('span', { class: 'rec-amount' }, money(e.amount))));
  });
  $('records-body').replaceChildren(...out);
}

function openRecordSheet(e) {
  const creator = memberById(e.created_by);
  openSheet(
    h('h3', null, e.item),
    h('div', { class: 'big' }, money(e.amount)),
    h('dl', { class: 'detail' },
      h('dt', null, '日期'), h('dd', null, dateLabel(e.expense_date)),
      h('dt', null, '歸屬'), h('dd', null, scopeName(e.scope)),
      h('dt', null, '分類'), h('dd', null, e.category_name),
      h('dt', null, '備註'), h('dd', null, e.note || '—'),
      h('dt', null, '記錄者'), h('dd', null, creator ? creator.display_name : '—')),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => { closeSheet(); openForm('edit', e); showTab('add'); } }, '修改'),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => { closeSheet(); openForm('copy', e); showTab('add'); } }, '複製'),
    h('button', { class: 'btn btn-danger btn-block', type: 'button', onclick: () => voidRecord(e) }, '作廢'),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, '關閉'));
}

async function voidRecord(e) {
  if (!navigator.onLine) {
    toast('目前離線，無法作廢');
    return;
  }
  if (!confirm('確定要作廢「' + e.item + ' ' + money(e.amount) + '」嗎？')) return;
  try {
    await api('expenses.void', { expense_id: e.expense_id });
    invalidateCache(e.expense_date.slice(0, 7));
    closeSheet();
    toast('已作廢');
    loadRecords();
  } catch (err) {
    toast(err.message);
  }
}

/* ---------- 新增／修改／複製表單 ---------- */

function chip(value, label, checked) {
  return h('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(checked), 'data-value': value }, label);
}

function renderChips() {
  const f = state.form;
  const scopes = [{ value: 'shared', label: '家庭開支' }].concat(
    state.me.members.filter((m) => m.is_active).map((m) => ({ value: m.member_id, label: m.display_name })));
  // 修改時，原歸屬成員或原分類已停用仍可保留
  if (f.mode === 'edit' && f.scope && !scopes.some((s) => s.value === f.scope)) {
    scopes.push({ value: f.scope, label: scopeName(f.scope) + '（停用）' });
  }
  const cats = state.me.categories.map((c) => ({ value: c.category_id, label: c.category_name }));
  if (f.mode === 'edit' && f.categoryId && !cats.some((c) => c.value === f.categoryId)) {
    cats.push({ value: f.categoryId, label: f.original.category_name + '（停用）' });
  }
  $('f-scope').replaceChildren(...scopes.map((s) => chip(s.value, s.label, s.value === f.scope)));
  $('f-category').replaceChildren(...cats.map((c) => chip(c.value, c.label, c.value === f.categoryId)));
}

/**
 * mode：create 新表單、edit 修改 rec、copy 以 rec 為底新增（日期改今天）。
 * 每次開新表單產生新的 expense_id；儲存失敗重送時沿用同一個，後端不會重複新增。
 */
function openForm(mode, rec) {
  const isActiveScope = (s) => s === 'shared' || state.me.members.some((m) => m.member_id === s && m.is_active);
  const isActiveCat = (id) => state.me.categories.some((c) => c.category_id === id);
  const f = { mode, expenseId: crypto.randomUUID(), scope: 'shared', categoryId: '', original: rec || null };
  const notes = [];

  if (mode === 'edit') {
    f.expenseId = rec.expense_id;
    f.scope = rec.scope;
    f.categoryId = rec.category_id;
  } else if (mode === 'copy') {
    f.scope = isActiveScope(rec.scope) ? rec.scope : '';
    f.categoryId = isActiveCat(rec.category_id) ? rec.category_id : '';
    if (!f.scope) notes.push('原歸屬成員已停用，請重新選擇歸屬。');
    if (!f.categoryId) notes.push('原分類已停用，請重新選擇分類。');
  }
  state.form = f;

  $('form-title').textContent = { create: '新增', edit: '修改', copy: '複製' }[mode];
  $('f-amount').value = rec ? String(rec.amount) : '';
  $('f-item').value = rec ? rec.item : '';
  $('f-date').value = mode === 'edit' ? rec.expense_date : today();
  $('f-note').value = rec ? rec.note : '';
  $('form-error').textContent = notes.join(' ');
  $('cancel-btn').hidden = mode === 'create';
  renderChips();
}

/** 檢查欄位；有錯回傳 null 並顯示訊息 */
function readForm() {
  const err = (msg) => { $('form-error').textContent = msg; return null; };
  const amount = $('f-amount').value.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || !(Number(amount) > 0)) return err('請輸入金額（大於 0，最多 2 位小數）。');
  if (Number(amount) > MAX_AMOUNT) return err('金額不可超過 10,000,000。');
  const item = $('f-item').value.trim();
  if (!item) return err('請輸入項目。');
  if (!state.form.scope) return err('請選擇歸屬。');
  if (!state.form.categoryId) return err('請選擇分類。');
  const date = $('f-date').value;
  if (!date) return err('請選擇日期。');
  $('form-error').textContent = '';
  return {
    expense_id: state.form.expenseId,
    amount,
    item,
    scope: state.form.scope,
    category_id: state.form.categoryId,
    expense_date: date,
    note: $('f-note').value.trim(),
  };
}

async function onSubmit(ev) {
  ev.preventDefault();
  if (state.saving) return;
  if (!navigator.onLine) {
    $('form-error').textContent = '目前離線，無法儲存。';
    return;
  }
  const payload = readForm();
  if (!payload) return;

  const mode = state.form.mode;
  state.saving = true;
  updateSaveButton();
  try {
    if (mode === 'edit') {
      payload.updated_at = state.form.original.updated_at;
      await api('expenses.update', payload);
      invalidateCache(payload.expense_date.slice(0, 7));
      toast('已更新');
    } else {
      await api('expenses.create', payload);
      invalidateCache(payload.expense_date.slice(0, 7));
      toast('已儲存');
    }
    openForm('create');
    if (mode !== 'create') showTab('records');
  } catch (e) {
    $('form-error').textContent = e.message;
  } finally {
    state.saving = false;
    updateSaveButton();
  }
}

function updateSaveButton() {
  const btn = $('save-btn');
  btn.disabled = state.saving || !navigator.onLine;
  btn.textContent = state.saving ? '儲存中…' : '儲存';
}

function updateOnline() {
  $('offline').hidden = navigator.onLine;
  updateSaveButton();
}

/* ---------- 設定：分類、成員 ---------- */

async function fetchSettings() {
  const [categories, members, me] = await Promise.all([api('categories.list'), api('members.list'), api('me')]);
  return { categories, members, me };
}

function loadSettings() {
  return loadView('settings', 'settings', fetchSettings, (data) => {
    state.categories = data.categories;
    state.me = data.me; // 順便更新新增表單的選項（其他人可能改過分類、成員）
    if (state.form.mode === 'create') renderChips();
    renderSettings(data.members);
  }, loadSettings);
}

/** 設定頁的排序：執行後重新整理設定頁（含 me）；失敗顯示訊息 */
async function settingsAction(fn) {
  if (state.busy) return;
  if (!navigator.onLine) {
    toast('目前離線，無法儲存');
    return;
  }
  state.busy = true;
  try {
    await fn();
    viewCache.clear();
    await loadSettings();
  } catch (e) {
    toast(e.message);
  } finally {
    state.busy = false;
  }
}

function moveButtons(list, i, onMove) {
  return [
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': '上移', disabled: i === 0, onclick: () => onMove(i, -1) }, '↑'),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': '下移', disabled: i === list.length - 1, onclick: () => onMove(i, 1) }, '↓'),
  ];
}

function swapped(ids, i, d) {
  const out = ids.slice();
  [out[i], out[i + d]] = [out[i + d], out[i]];
  return out;
}

function renderSettings(members) {
  const isAdmin = state.me.member.role === 'admin';
  const cats = state.categories;

  const catCard = h('div', { class: 'card' },
    h('h3', null, '分類'),
    h('p', { class: 'muted' }, '新增、改名、停用全家共用；排序只影響你自己。'),
    cats.map((c, i) => h('div', { class: 'row' },
      h('div', { class: 'row-main' }, c.category_name, c.is_active ? null : h('span', { class: 'badge' }, '停用')),
      moveButtons(cats, i, (idx, d) => settingsAction(() =>
        api('categories.reorder', { order: swapped(cats.map((x) => x.category_id), idx, d) }))),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': '編輯', onclick: () => editCategory(c) }, '✎'))),
    h('button', { class: 'btn btn-secondary btn-block mt', type: 'button', onclick: () => editCategory(null) }, '新增分類'));

  const memCard = h('div', { class: 'card' },
    h('h3', null, '成員'),
    isAdmin ? null : h('p', { class: 'muted' }, '只有管理員可以管理成員。'),
    members.map((m, i) => h('div', { class: 'row' },
      h('div', { class: 'row-main' },
        h('div', null, m.display_name, m.is_active ? null : h('span', { class: 'badge' }, '停用')),
        h('div', { class: 'row-sub' }, (m.role === 'admin' ? '管理員' : '成員') + ' · ' +
          (isAdmin ? (m.email || '不能登入') : (m.can_login ? '可登入' : '不能登入')))),
      isAdmin ? moveButtons(members, i, (idx, d) => settingsAction(() =>
        api('members.reorder', { order: swapped(members.map((x) => x.member_id), idx, d) }))) : null,
      isAdmin ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': '編輯', onclick: () => editMember(m) }, '✎') : null)),
    isAdmin ? h('button', { class: 'btn btn-secondary btn-block mt', type: 'button', onclick: () => editMember(null) }, '新增成員') : null);

  $('settings-body').replaceChildren(catCard, memCard);
}

function sheetError() {
  return h('p', { class: 'form-error', role: 'alert' });
}

/** 面板內的儲存：成功關閉面板，失敗把訊息顯示在面板內 */
async function saveFromSheet(errEl, fn, doneMsg) {
  if (!navigator.onLine) {
    errEl.textContent = '目前離線，無法儲存。';
    return;
  }
  try {
    await fn();
  } catch (e) {
    errEl.textContent = e.message;
    return;
  }
  closeSheet();
  toast(doneMsg);
  viewCache.clear();
  await loadSettings();
}

function editCategory(c) {
  const name = h('input', { maxlength: '20', value: c ? c.category_name : '', autocomplete: 'off' });
  const active = h('input', { type: 'checkbox', checked: c ? c.is_active : true });
  const err = sheetError();
  openSheet(
    h('h3', null, c ? '編輯分類' : '新增分類'),
    h('label', { class: 'field mt' }, h('span', { class: 'label' }, '名稱'), name),
    c ? h('label', { class: 'check' }, active, '啟用（停用後新增時不會出現，舊紀錄不受影響）') : null,
    err,
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => saveFromSheet(err, () =>
      api('categories.save', { category_id: c ? c.category_id : undefined, category_name: name.value, is_active: active.checked }),
    '已儲存') }, '儲存'),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, '取消'));
}

function editMember(m) {
  const name = h('input', { maxlength: '20', value: m ? m.display_name : '', autocomplete: 'off' });
  const email = h('input', { type: 'email', maxlength: '100', value: m ? m.email : '', autocomplete: 'off', placeholder: '留空＝不能登入' });
  const role = select('角色', [{ value: 'member', label: '成員' }, { value: 'admin', label: '管理員' }], m ? m.role : 'member', () => {});
  const active = h('input', { type: 'checkbox', checked: m ? m.is_active : true });
  const err = sheetError();
  openSheet(
    h('h3', null, m ? '編輯成員' : '新增成員'),
    h('label', { class: 'field mt' }, h('span', { class: 'label' }, '名稱'), name),
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Google 帳號 email'), email),
    h('label', { class: 'field' }, h('span', { class: 'label' }, '角色'), role),
    m ? h('label', { class: 'check' }, active, '啟用（停用後不能登入，舊紀錄保留）') : null,
    err,
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => saveFromSheet(err, () =>
      api('members.save', {
        member_id: m ? m.member_id : undefined, display_name: name.value, email: email.value,
        role: role.value, is_active: active.checked,
      }), '已儲存') }, '儲存'),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: closeSheet }, '取消'));
}

/* ---------- 啟動 ---------- */

function bindEvents() {
  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.addEventListener('click', () => {
      // 從底部「新增」進入一律是新表單；修改／複製只從紀錄進入
      if (b.dataset.tab === 'add' && state.form && state.form.mode !== 'create') openForm('create');
      showTab(b.dataset.tab);
    });
  });
  $('f-scope').addEventListener('click', (ev) => {
    const b = ev.target.closest('.chip');
    if (!b) return;
    state.form.scope = b.dataset.value;
    renderChips();
  });
  $('f-category').addEventListener('click', (ev) => {
    const b = ev.target.closest('.chip');
    if (!b) return;
    state.form.categoryId = b.dataset.value;
    renderChips();
  });
  $('expense-form').addEventListener('submit', onSubmit);
  $('cancel-btn').addEventListener('click', () => { openForm('create'); showTab('records'); });
  $('logout-btn').addEventListener('click', logout);
  $('sheet').addEventListener('click', (ev) => { if (ev.target === $('sheet')) closeSheet(); });
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
}

async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  bindEvents();
  updateOnline();
  if (await handleRedirect()) return;
  state.session = localStorage.getItem(SESSION_KEY);
  if (state.session) await enterApp();
  else showLogin('');
}

init();

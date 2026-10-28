'use strict';

/*
 * 一家帳 — 前端
 * 第四階段 A：分頁骨架、Google 登入、新增開支
 */

const SESSION_KEY = 'yj_session';
const OAUTH_KEY = 'yj_oauth'; // 登入途中暫存 { nonce, state }；iOS 主畫面模式可能換瀏覽環境，故用 localStorage
const MAX_AMOUNT = 10000000;

const state = {
  session: null,
  me: null,
  form: null, // { expenseId, scope, categoryId }
  saving: false,
};

const $ = (id) => document.getElementById(id);

/* ---------- 工具 ---------- */

/** 台北時間的今天 yyyy-MM-dd */
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
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
      showLogin(body.error.message);
    }
    throw new ApiError(body.error.code, body.error.message);
  }
  return body.data;
}

/* ---------- 登入 ---------- */

function saveSession(session) {
  state.session = session;
  localStorage.setItem(SESSION_KEY, session);
}

function clearSession() {
  state.session = null;
  state.me = null;
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
    state.me = await api('me');
  } catch (e) {
    if (e.code !== 'UNAUTHORIZED') showLogin(e.message, enterApp);
    return;
  }
  $('login').hidden = true;
  $('app').hidden = false;
  $('me-name').textContent = state.me.member.display_name;
  resetForm();
  showTab('home');
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
}

/* ---------- 新增表單 ---------- */

function chip(value, label, checked) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', String(checked));
  b.dataset.value = value;
  b.textContent = label;
  return b;
}

function renderChips() {
  const scopes = [{ value: 'shared', label: '家庭開支' }].concat(
    state.me.members.filter((m) => m.is_active).map((m) => ({ value: m.member_id, label: m.display_name })));
  $('f-scope').replaceChildren(...scopes.map((s) => chip(s.value, s.label, s.value === state.form.scope)));
  $('f-category').replaceChildren(...state.me.categories.map((c) =>
    chip(c.category_id, c.category_name, c.category_id === state.form.categoryId)));
}

/** 每次開新表單產生新的 expense_id；儲存失敗重送時沿用同一個，後端不會重複新增 */
function resetForm() {
  state.form = { expenseId: crypto.randomUUID(), scope: 'shared', categoryId: '' };
  $('f-amount').value = '';
  $('f-item').value = '';
  $('f-date').value = today();
  $('f-note').value = '';
  $('form-error').textContent = '';
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

  state.saving = true;
  updateSaveButton();
  try {
    await api('expenses.create', payload);
    toast('已儲存');
    resetForm();
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

/* ---------- 啟動 ---------- */

function bindEvents() {
  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.addEventListener('click', () => showTab(b.dataset.tab));
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
  $('logout-btn').addEventListener('click', logout);
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
}

async function init() {
  bindEvents();
  updateOnline();
  if (await handleRedirect()) return;
  state.session = localStorage.getItem(SESSION_KEY);
  if (state.session) await enterApp();
  else showLogin('');
}

init();

/**
 * 一家帳 — 登入與 session
 *
 * auth.login：前端取得 Google id_token 後呼叫，驗證通過發 session（30 天）。
 * session 本身只交給前端；後端只存 SHA-256 雜湊：Script Property sess_<hash> = {member_id, expires_at}
 */

const SESSION_DAYS = 30;
const SESSION_PREFIX = 'sess_';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

function authLogin_(payload) {
  const idToken = String(payload.id_token || '');
  const nonce = String(payload.nonce || '');
  if (!idToken || !nonce) throw fail_('BAD_REQUEST', '登入資料不完整，請重新登入。');

  const email = verifyIdToken_(idToken, nonce);
  const member = readTable_('Members').rows.filter(function (m) {
    return m.is_active && m.email && m.email.toLowerCase() === email;
  })[0];
  if (!member) throw fail_('FORBIDDEN', '這個 Google 帳號沒有使用權限，請聯絡管理員。');

  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  withLock_(function () {
    cleanupSessions_();
    props_().setProperty(SESSION_PREFIX + sha256Hex_(token),
      JSON.stringify({ member_id: member.member_id, expires_at: expiresAt }));
  });
  return {
    session: token,
    expires_at: Utilities.formatDate(new Date(expiresAt), APP.TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"),
  };
}

function authLogout_(payload, session) {
  if (session) props_().deleteProperty(SESSION_PREFIX + sha256Hex_(String(session)));
  return null;
}

/** 回傳通過驗證的 email（小寫）；失敗一律回同一個訊息，原因只寫在執行記錄 */
function verifyIdToken_(idToken, nonce) {
  const clientId = props_().getProperty(PROP.GOOGLE_CLIENT_ID);
  if (!clientId) throw fail_('CONFIG', '後端尚未設定 GOOGLE_CLIENT_ID。');

  const res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true });
  let info = {};
  try {
    info = JSON.parse(res.getContentText());
  } catch (e) {
    info = {};
  }

  let reason = '';
  if (res.getResponseCode() !== 200) reason = 'tokeninfo ' + res.getResponseCode();
  else if (info.aud !== clientId) reason = 'aud';
  else if (GOOGLE_ISSUERS.indexOf(info.iss) < 0) reason = 'iss';
  else if (!(Number(info.exp) * 1000 > Date.now())) reason = 'exp';
  else if (String(info.email_verified) !== 'true') reason = 'email_verified';
  else if (info.nonce !== nonce) reason = 'nonce';
  else if (!info.email) reason = 'email';

  if (reason) {
    console.warn('id_token 驗證失敗：' + reason);
    throw fail_('UNAUTHORIZED', 'Google 登入驗證失敗，請重新登入。');
  }
  return String(info.email).toLowerCase();
}

/** 驗證 session，回傳這次請求的 ctx：{ member, members, visibility } */
function requireSession_(session) {
  if (!session || typeof session !== 'string') throw fail_('UNAUTHORIZED', '請先登入。');
  const props = props_();
  const key = SESSION_PREFIX + sha256Hex_(session);
  const raw = props.getProperty(key);
  let sess = null;
  try {
    sess = raw ? JSON.parse(raw) : null;
  } catch (e) {
    sess = null;
  }
  if (!sess || !(sess.expires_at > Date.now())) {
    if (raw) props.deleteProperty(key);
    throw fail_('UNAUTHORIZED', '登入已過期，請重新登入。');
  }

  const members = readTable_('Members').rows;
  const member = members.filter(function (m) { return m.member_id === sess.member_id; })[0];
  if (!member || !member.is_active || !member.email) {
    props.deleteProperty(key);
    throw fail_('UNAUTHORIZED', '帳號已停用，請聯絡管理員。');
  }
  return { member: member, members: members, visibility: getVisibility_() };
}

function getVisibility_() {
  const v = props_().getProperty(PROP.PERSONAL_VISIBILITY) || 'full';
  if (VISIBILITY_VALUES.indexOf(v) < 0) {
    throw fail_('CONFIG', 'PERSONAL_VISIBILITY 設定錯誤，只能是 full、summary 或 private。');
  }
  return v;
}

/** 清除過期或格式錯誤的 session */
function cleanupSessions_() {
  const props = props_();
  const all = props.getProperties();
  const now = Date.now();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(SESSION_PREFIX) !== 0) return;
    let s = null;
    try {
      s = JSON.parse(all[k]);
    } catch (e) {
      s = null;
    }
    if (!s || !(s.expires_at > now)) props.deleteProperty(k);
  });
}

function sha256Hex_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

/** me：目前成員、可見度設定、成員清單、依個人排序的啟用分類 */
function me_(ctx) {
  const m = ctx.member;
  return {
    member: { member_id: m.member_id, display_name: m.display_name, role: m.role, email: m.email },
    visibility: ctx.visibility,
    members: sortBySortOrder_(ctx.members).map(memberPublic_),
    categories: sortedCategories_(m, readTable_('Categories').rows).filter(function (c) { return c.is_active; }),
  };
}

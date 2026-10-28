/**
 * 一家帳 — 成員
 *
 * members.list    所有成員（含停用）；admin 另外看得到 email
 * members.save    新增或修改（僅 admin）；成員只停用不刪除；不可讓有效 admin 變成 0 位
 * members.reorder 調整顯示順序（僅 admin）
 */

function sortBySortOrder_(rows) {
  return rows.slice().sort(function (a, b) { return Number(a.sort_order) - Number(b.sort_order); });
}

function memberPublic_(m) {
  return {
    member_id: m.member_id,
    display_name: m.display_name,
    role: m.role,
    sort_order: Number(m.sort_order),
    is_active: m.is_active,
    can_login: !!m.email,
  };
}

function memberAdmin_(m) {
  const out = memberPublic_(m);
  out.email = m.email;
  return out;
}

function requireAdmin_(ctx) {
  if (ctx.member.role !== 'admin') throw fail_('FORBIDDEN', '只有管理員可以管理成員。');
}

function membersList_(ctx) {
  const toClient = ctx.member.role === 'admin' ? memberAdmin_ : memberPublic_;
  return sortBySortOrder_(ctx.members).map(toClient);
}

function membersSave_(ctx, p) {
  requireAdmin_(ctx);
  const name = requireString_(p.display_name, '名稱', 20);
  const email = requireString_(p.email, 'email', 100, true).toLowerCase();
  const role = String(p.role || 'member');
  if (email && !isValidEmail_(email)) throw fail_('VALIDATION', 'email 格式不正確。');
  if (role !== 'admin' && role !== 'member') throw fail_('VALIDATION', '角色只能是管理員或成員。');
  if (role === 'admin' && !email) throw fail_('VALIDATION', '管理員必須有 email 才能登入。');
  if (p.is_active !== undefined && typeof p.is_active !== 'boolean') throw fail_('VALIDATION', '啟用狀態格式錯誤。');

  return withLock_(function () {
    const table = readTable_('Members');
    const rows = table.rows;
    const now = nowIso_();
    let target;

    if (p.member_id) {
      target = rows.filter(function (m) { return m.member_id === p.member_id; })[0];
      if (!target) throw fail_('NOT_FOUND', '找不到這位成員，請重新整理。');
    } else {
      target = {
        member_id: newId_('m_'),
        sort_order: rows.reduce(function (max, m) { return Math.max(max, Number(m.sort_order) || 0); }, 0) + 10,
        is_active: true,
        category_order: '',
        created_at: now,
      };
    }

    if (email && rows.some(function (m) { return m.member_id !== target.member_id && m.email.toLowerCase() === email; })) {
      throw fail_('VALIDATION', '這個 email 已被其他成員使用。');
    }

    const updated = Object.assign({}, target, {
      display_name: name,
      email: email,
      role: role,
      is_active: p.is_active === undefined ? target.is_active : p.is_active,
      updated_at: now,
    });

    const admins = rows.filter(function (m) { return m.member_id !== updated.member_id; }).concat([updated])
      .filter(function (m) { return m.is_active && m.role === 'admin' && m.email; });
    if (admins.length === 0) throw fail_('VALIDATION', '至少要保留一位啟用中的管理員。');

    if (p.member_id) writeRow_(table.sheet, 'Members', target._row, updated);
    else appendRow_(table.sheet, 'Members', updated);
    return memberAdmin_(updated);
  });
}

function membersReorder_(ctx, p) {
  requireAdmin_(ctx);
  return withLock_(function () {
    const table = readTable_('Members');
    const order = checkPermutation_(p.order, table.rows.map(function (m) { return m.member_id; }), '成員');
    const now = nowIso_();
    table.rows.forEach(function (m) {
      const sortOrder = (order.indexOf(m.member_id) + 1) * 10;
      if (Number(m.sort_order) === sortOrder) return;
      m.sort_order = sortOrder;
      m.updated_at = now;
      writeRow_(table.sheet, 'Members', m._row, m);
    });
    return sortBySortOrder_(table.rows).map(memberAdmin_);
  });
}

/** order 必須剛好包含 allIds 每一個且不重複 */
function checkPermutation_(order, allIds, label) {
  if (!Array.isArray(order) || order.length !== allIds.length) {
    throw fail_('VALIDATION', label + '順序資料不完整，請重新整理。');
  }
  const seen = {};
  order.forEach(function (id) {
    if (allIds.indexOf(id) < 0 || seen[id]) throw fail_('VALIDATION', label + '順序資料不正確，請重新整理。');
    seen[id] = true;
  });
  return order;
}

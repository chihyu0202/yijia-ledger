/**
 * 一家帳 — 分類
 *
 * categories.list    全部分類（含停用），依呼叫者的個人排序
 * categories.save    新增、改名、停用／啟用（全家共用）
 * categories.reorder 只存呼叫者自己的順序（Members.category_order）
 */

function categoryPublic_(c) {
  return {
    category_id: c.category_id,
    category_name: c.category_name,
    sort_order: Number(c.sort_order),
    is_active: c.is_active,
  };
}

/** 先依個人順序；不在個人順序內的（例如之後新增的）接在後面，依預設 sort_order */
function sortedCategories_(member, cats) {
  let order = [];
  try {
    order = member.category_order ? JSON.parse(member.category_order) : [];
  } catch (e) {
    order = [];
  }
  if (!Array.isArray(order)) order = [];
  const rank = function (c) {
    const i = order.indexOf(c.category_id);
    return i >= 0 ? i : order.length + Number(c.sort_order);
  };
  return cats.slice().sort(function (a, b) { return rank(a) - rank(b); }).map(categoryPublic_);
}

function categoriesList_(ctx) {
  return sortedCategories_(ctx.member, readTable_('Categories').rows);
}

function categoriesSave_(ctx, p) {
  const name = requireString_(p.category_name, '分類名稱', 20);
  if (p.is_active !== undefined && typeof p.is_active !== 'boolean') throw fail_('VALIDATION', '啟用狀態格式錯誤。');

  return withLock_(function () {
    const table = readTable_('Categories');
    const rows = table.rows;
    const now = nowIso_();
    let target;

    if (p.category_id) {
      target = rows.filter(function (c) { return c.category_id === p.category_id; })[0];
      if (!target) throw fail_('NOT_FOUND', '找不到這個分類，請重新整理。');
    } else {
      target = {
        category_id: newId_('cat_'),
        sort_order: rows.reduce(function (max, c) { return Math.max(max, Number(c.sort_order) || 0); }, 0) + 10,
        is_active: true,
        created_at: now,
      };
    }

    if (rows.some(function (c) { return c.category_id !== target.category_id && c.category_name.trim() === name; })) {
      throw fail_('VALIDATION', '已經有同名的分類「' + name + '」。');
    }

    const updated = Object.assign({}, target, {
      category_name: name,
      is_active: p.is_active === undefined ? target.is_active : p.is_active,
      updated_at: now,
    });

    const active = rows.filter(function (c) { return c.category_id !== updated.category_id; }).concat([updated])
      .filter(function (c) { return c.is_active; });
    if (active.length === 0) throw fail_('VALIDATION', '至少要保留一個啟用中的分類。');

    if (p.category_id) writeRow_(table.sheet, 'Categories', target._row, updated);
    else appendRow_(table.sheet, 'Categories', updated);
    return categoryPublic_(updated);
  });
}

/** order：分類 ID 陣列；可以只含部分分類，其餘依預設順序接在後面 */
function categoriesReorder_(ctx, p) {
  const cats = readTable_('Categories').rows;
  const ids = cats.map(function (c) { return c.category_id; });
  if (!Array.isArray(p.order)) throw fail_('VALIDATION', '分類順序資料不正確，請重新整理。');
  const seen = {};
  p.order.forEach(function (id) {
    if (ids.indexOf(id) < 0 || seen[id]) throw fail_('VALIDATION', '分類順序資料不正確，請重新整理。');
    seen[id] = true;
  });

  return withLock_(function () {
    const table = readTable_('Members');
    const me = table.rows.filter(function (m) { return m.member_id === ctx.member.member_id; })[0];
    me.category_order = JSON.stringify(p.order);
    me.updated_at = nowIso_();
    writeRow_(table.sheet, 'Members', me._row, me);
    return sortedCategories_(me, cats);
  });
}

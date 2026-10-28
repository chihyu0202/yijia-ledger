/**
 * 一家帳 — 統計
 *
 * summarize_   月統計與年統計共用：總額、各歸屬、各分類（金額以「分」加總）
 * stats.year   year、可選 category_id：全年總額、月平均、12 個月小計、各歸屬、各分類
 * 可見度過濾都在 visibleExpenses_（Expenses.gs）；void 不列入。
 */

function summarize_(list) {
  const names = {};
  readTable_('Categories').rows.forEach(function (c) { names[c.category_id] = c.category_name; });

  let total = 0;
  const byScope = {};
  const byCat = {};
  list.forEach(function (e) {
    const cents = toCents_(e.amount);
    total += cents;
    byScope[e.scope] = (byScope[e.scope] || 0) + cents;
    if (!byCat[e.category_id]) {
      byCat[e.category_id] = { category_id: e.category_id, category_name: names[e.category_id] || e.category_name, cents: 0 };
    }
    byCat[e.category_id].cents += cents;
  });

  return {
    total: total / 100,
    count: list.length,
    by_scope: Object.keys(byScope).map(function (s) { return { scope: s, amount: byScope[s] / 100 }; })
      .sort(function (a, b) { return b.amount - a.amount; }),
    by_category: Object.keys(byCat).map(function (k) {
      return { category_id: k, category_name: byCat[k].category_name, amount: byCat[k].cents / 100 };
    }).sort(function (a, b) { return b.amount - a.amount; }),
  };
}

function statsYear_(ctx, p) {
  const today = todayStr_();
  const year = String(p.year || today.slice(0, 4));
  if (!/^\d{4}$/.test(year)) throw fail_('VALIDATION', '年份格式錯誤。');
  const categoryId = p.category_id ? String(p.category_id) : '';

  const counted = visibleExpenses_(ctx, function (e) {
    return e.expense_date.slice(0, 4) === year && (!categoryId || e.category_id === categoryId);
  }).counted;

  const months = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  counted.forEach(function (e) {
    months[Number(e.expense_date.slice(5, 7)) - 1] += toCents_(e.amount);
  });

  // 今年只除到本月；過去（或未來）的年份除以 12
  const divisor = year === today.slice(0, 4) ? Number(today.slice(5, 7)) : 12;
  const s = summarize_(counted);
  return {
    year: year,
    category_id: categoryId,
    total: s.total,
    monthly_avg: Math.round(toCents_(s.total) / divisor) / 100,
    months: months.map(function (c) { return c / 100; }),
    by_scope: s.by_scope,
    by_category: s.by_category,
  };
}

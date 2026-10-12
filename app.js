(() => {
  'use strict';

  const tg = window.Telegram && window.Telegram.WebApp;
  const CONFIG = window.DOMBUKH_CONFIG || {};
  const DEMO = !(tg && tg.initData);

  const EXPENSE = 'Витрата';
  const INCOME = 'Дохід';
  const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
  const MONTHS_SHORT = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
  const MONTHS_GEN = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
  const WEEKDAYS = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота'];
  const PALETTE = ['#4C8DF6', '#F2994A', '#2FB57A', '#EB5757', '#9B6BF2', '#2DB3D9', '#F2C14A', '#E26FB0', '#6C7BEA', '#8BC34A', '#A0A4AB'];
  const USER_COLORS = ['#4C8DF6', '#E26FB0', '#F2994A', '#2FB57A'];
  const FALLBACK = { [EXPENSE]: 'Інше', [INCOME]: 'Інші доходи' };

  const state = {
    me: null,
    users: [],
    currency: '₴',
    categories: [],
    ops: [],
    month: monthKey(new Date()),
    tab: 'overview',
    filterCat: null,
    sheet: null,
  };

  const $ = sel => document.querySelector(sel);
  const view = $('#view');

  // ───────── Утиліти ─────────

  function pad(n) { return String(n).padStart(2, '0'); }
  function monthKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function dateKey(d) { return monthKey(d) + '-' + pad(d.getDate()); }
  function shiftMonth(key, delta) {
    const [y, m] = key.split('-').map(Number);
    return monthKey(new Date(y, m - 1 + delta, 1));
  }
  function monthName(key, withYear) {
    const [y, m] = key.split('-').map(Number);
    return MONTHS[m - 1] + (withYear || y !== new Date().getFullYear() ? ' ' + y : '');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const nf = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 });
  function money(n) { return nf.format(Math.round(n * 100) / 100) + ' ' + state.currency; }
  function moneyShort(n) {
    if (n >= 1e6) return nf.format(Math.round(n / 1e5) / 10) + 'м';
    if (n >= 1e4) return nf.format(Math.round(n / 1e3)) + 'к';
    return nf.format(Math.round(n));
  }
  function sum(list) { return list.reduce((s, o) => s + o.amount, 0); }

  function catMeta(name) {
    const i = state.categories.findIndex(c => c.name === name);
    const c = state.categories[i];
    return { emoji: (c && c.emoji) || '•', color: PALETTE[(i < 0 ? PALETTE.length - 1 : i) % PALETTE.length] };
  }
  function userColor(name) {
    const i = state.users.indexOf(name);
    return USER_COLORS[(i < 0 ? 0 : i) % USER_COLORS.length];
  }

  function opsOf(month) { return state.ops.filter(o => o.month === month); }
  function totals(ops) {
    let exp = 0, inc = 0;
    ops.forEach(o => { if (o.type === INCOME) inc += o.amount; else exp += o.amount; });
    return { exp, inc, bal: inc - exp };
  }
  function groupSum(ops, keyFn) {
    const m = new Map();
    ops.forEach(o => m.set(keyFn(o), (m.get(keyFn(o)) || 0) + o.amount));
    return [...m].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
  }
  function byCategory(ops, type) { return groupSum(ops.filter(o => o.type === (type || EXPENSE)), o => o.category); }

  function haptic(kind) {
    try {
      if (!tg || !tg.HapticFeedback) return;
      if (kind === 'light') tg.HapticFeedback.impactOccurred('light');
      else tg.HapticFeedback.notificationOccurred(kind);
    } catch (e) { /* старі клієнти */ }
  }

  let toastTimer;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  function confirmBox(text) {
    return new Promise(resolve => {
      if (tg && tg.showConfirm && !DEMO) tg.showConfirm(text, resolve);
      else resolve(window.confirm(text));
    });
  }

  // ───────── API ─────────

  async function api(action, payload) {
    if (DEMO) return Demo.call(action, payload || {});
    const res = await fetch(CONFIG.apiUrl, {
      method: 'POST',
      body: JSON.stringify(Object.assign({ action, initData: tg.initData }, payload)),
    });
    const data = await res.json();
    if (!data.ok) {
      const err = new Error(data.error || 'error');
      err.data = data;
      throw err;
    }
    return data;
  }

  // ───────── Рендер ─────────

  function render() {
    renderHeader();
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === state.tab));
    const views = { overview: viewOverview, history: viewHistory, compare: viewCompare, people: viewPeople };
    view.innerHTML = views[state.tab]();
  }

  function renderHeader() {
    $('#month-label').innerHTML = esc(monthName(state.month)) + (DEMO ? '<span class="demo-badge">ДЕМО</span>' : '');
    const t = totals(opsOf(state.month));
    $('#top-sub').textContent = t.exp || t.inc ? 'витрачено ' + money(t.exp) : '';
    $('[data-action="month-next"]').disabled = state.month >= monthKey(new Date());
  }

  function donut(items, total) {
    let offset = 0;
    const gap = items.length > 1 ? 0.6 : 0;
    const arcs = items.map(it => {
      const len = (it.total / total) * 100;
      const dash = Math.max(len - gap, 0.01);
      const circle = '<circle cx="21" cy="21" r="15.915" fill="none" stroke="' + it.color + '" stroke-width="5.2" ' +
        'stroke-dasharray="' + dash.toFixed(3) + ' ' + (100 - dash).toFixed(3) + '" stroke-dashoffset="' + (-offset).toFixed(3) + '" pathLength="100"/>';
      offset += len;
      return circle;
    }).join('');
    return '<svg viewBox="0 0 42 42"><circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--soft)" stroke-width="5.2"/>' + arcs + '</svg>';
  }

  function opRow(o, opts) {
    const meta = catMeta(o.category);
    const sign = o.type === INCOME ? '+' : '−';
    const sub = [o.comment, opts && opts.showDate ? shortDate(o.date) : '', state.users.length > 1 ? o.who : '']
      .filter(Boolean).map(esc).join(' · ');
    return '<button class="row' + (o.pending ? ' pending' : '') + '" data-action="edit" data-id="' + esc(o.id) + '">' +
      '<span class="ico" style="background:' + meta.color + '22">' + meta.emoji + '</span>' +
      '<span class="row-main"><div class="row-title">' + esc(o.category) + '</div><div class="row-sub">' + (sub || '&nbsp;') + '</div></span>' +
      '<span class="row-end"><b class="' + (o.type === INCOME ? 'pos' : '') + '">' + sign + money(o.amount) + '</b></span>' +
      '</button>';
  }

  function shortDate(iso) {
    const [, m, d] = iso.split('-').map(Number);
    return d + ' ' + MONTHS_GEN[m - 1];
  }

  function dayTitle(iso) {
    const today = dateKey(new Date());
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (iso === today) return 'Сьогодні';
    if (iso === dateKey(y)) return 'Вчора';
    const [yy, mm, dd] = iso.split('-').map(Number);
    return dd + ' ' + MONTHS_GEN[mm - 1] + ', ' + WEEKDAYS[new Date(yy, mm - 1, dd).getDay()];
  }

  function sortOps(list) {
    return list.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  function emptyState(text) {
    return '<div class="card empty"><div class="big">🪙</div>' + text + '</div>';
  }

  // Огляд
  function viewOverview() {
    const ops = opsOf(state.month);
    const t = totals(ops);
    // Для поточного місяця порівнюємо з тим самим періодом минулого (1-ше … сьогоднішнє число).
    const isCurrent = state.month === monthKey(new Date());
    const today = new Date().getDate();
    const prev = totals(opsOf(shiftMonth(state.month, -1)).filter(o => !isCurrent || Number(o.date.slice(8)) <= today));
    let chip = '';
    if (prev.exp > 0 && t.exp > 0) {
      const d = Math.round((t.exp - prev.exp) / prev.exp * 100);
      const when = isCurrent ? 'ніж за ці ж дні минулого місяця' : 'ніж минулого місяця';
      chip = d === 0 ? '<span class="chip">стільки ж, ' + when + '</span>'
        : '<span class="chip ' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '▲ на ' : '▼ на ') + Math.abs(d) + '% ' + (d > 0 ? 'більше' : 'менше') + ', ' + when + '</span>';
    }

    let html = '<section class="card hero">' +
      '<div class="hero-label">Витрачено</div>' +
      '<div class="hero-amount">' + money(t.exp) + '</div>' + chip +
      '<div class="hero-row">' +
      '<div><span>Доходи</span><b class="pos">+' + money(t.inc) + '</b></div>' +
      '<div><span>Залишок</span><b class="' + (t.bal < 0 ? 'neg' : '') + '">' + money(t.bal) + '</b></div>' +
      '</div></section>';

    const cats = byCategory(ops).map(c => Object.assign(c, catMeta(c.name)));
    if (!cats.length) {
      html += emptyState('Цього місяця ще немає витрат.<br>Натисніть <b>＋</b> або напишіть боту <b>кава 85</b>.');
    } else {
      html += '<section class="card"><h2>Категорії</h2>' +
        '<div class="donut-wrap">' + donut(cats, t.exp) +
        '<div class="donut-center"><b>' + moneyShort(t.exp) + '</b><span>' + cats.length + ' катег.</span></div></div>' +
        '<div class="rows">' + cats.map(c => {
          const pct = Math.round(c.total / t.exp * 100);
          return '<button class="row" data-action="filter-cat" data-cat="' + esc(c.name) + '">' +
            '<span class="ico" style="background:' + c.color + '22">' + c.emoji + '</span>' +
            '<span class="row-main"><div class="row-title">' + esc(c.name) + '</div>' +
            '<div class="bar"><i style="width:' + Math.max(pct, 2) + '%;background:' + c.color + '"></i></div></span>' +
            '<span class="row-end"><b>' + money(c.total) + '</b><span>' + pct + '%</span></span></button>';
        }).join('') + '</div></section>';
    }

    const recent = sortOps(ops).slice(0, 5);
    if (recent.length) {
      html += '<section class="card list"><h2 style="margin-top:12px">Останні<button class="link" data-tab-go="history">Усі →</button></h2>' +
        '<div class="rows">' + recent.map(o => opRow(o, { showDate: true })).join('') + '</div></section>';
    }
    return html;
  }

  // Історія
  function viewHistory() {
    let ops = opsOf(state.month);
    let html = '';
    if (state.filterCat) {
      ops = ops.filter(o => o.category === state.filterCat);
      const m = catMeta(state.filterCat);
      html += '<div class="filter"><span>' + m.emoji + ' ' + esc(state.filterCat) + ' · ' + money(sum(ops)) + '</span>' +
        '<button data-action="clear-filter">✕</button></div>';
    }
    if (!ops.length) return html + emptyState('Тут поки порожньо.');

    const days = new Map();
    sortOps(ops).forEach(o => { if (!days.has(o.date)) days.set(o.date, []); days.get(o.date).push(o); });
    days.forEach((list, day) => {
      const spent = sum(list.filter(o => o.type === EXPENSE));
      html += '<div class="day-head"><span>' + dayTitle(day) + '</span><span>' + (spent ? '−' + money(spent) : '') + '</span></div>' +
        '<section class="card list"><div class="rows">' + list.map(o => opRow(o)).join('') + '</div></section>';
    });
    return html;
  }

  // Порівняння
  function viewCompare() {
    const N = 6;
    const months = [];
    for (let i = N - 1; i >= 0; i--) months.push(shiftMonth(state.month, -i));
    const data = months.map(m => Object.assign({ m }, totals(opsOf(m))));
    const max = Math.max(1, ...data.map(d => Math.max(d.exp, d.inc)));

    let html = '<section class="card"><h2>Останні ' + N + ' місяців</h2><div class="bars">' +
      data.map(d => {
        const mi = Number(d.m.slice(5)) - 1;
        return '<button class="bar-col' + (d.m === state.month ? ' active' : '') + '" data-action="set-month" data-month="' + d.m + '">' +
          '<div class="bar-pair">' +
          '<i style="height:' + (d.exp / max * 100) + '%;background:var(--red)" title="' + money(d.exp) + '"></i>' +
          '<i style="height:' + (d.inc / max * 100) + '%;background:var(--green)" title="' + money(d.inc) + '"></i>' +
          '</div><span>' + MONTHS_SHORT[mi] + '</span></button>';
      }).join('') + '</div>' +
      '<div class="legend"><span><i style="background:var(--red)"></i>Витрати</span><span><i style="background:var(--green)"></i>Доходи</span></div></section>';

    const withData = data.filter(d => d.exp > 0);
    const avg = withData.length ? Math.round(sum(withData.map(d => ({ amount: d.exp }))) / withData.length) : 0;
    const cur = data[data.length - 1];
    const saved = sum(data.map(d => ({ amount: d.bal })));
    html += '<section class="card"><h2>Підсумки</h2><div class="stats">' +
      '<div class="stat"><span>Середні витрати / міс</span><b>' + money(avg) + '</b></div>' +
      '<div class="stat"><span>Цей місяць vs середнє</span><b class="' + (avg && cur.exp > avg ? 'neg' : 'pos') + '">' +
      (avg ? (cur.exp >= avg ? '+' : '−') + money(Math.abs(cur.exp - avg)) : '—') + '</b></div>' +
      '<div class="stat"><span>Заощаджено за ' + N + ' міс</span><b class="' + (saved < 0 ? 'neg' : 'pos') + '">' + money(saved) + '</b></div>' +
      '<div class="stat"><span>Норма заощаджень</span><b>' + (cur.inc ? Math.round(cur.bal / cur.inc * 100) + '%' : '—') + '</b></div>' +
      '</div></section>';

    const prevKey = shiftMonth(state.month, -1);
    const curCats = byCategory(opsOf(state.month));
    const prevCats = byCategory(opsOf(prevKey));
    const names = [...new Set([...curCats, ...prevCats].map(c => c.name))];
    const rows = names.map(name => {
      const a = (curCats.find(c => c.name === name) || { total: 0 }).total;
      const b = (prevCats.find(c => c.name === name) || { total: 0 }).total;
      return { name, a, b, d: a - b };
    }).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));

    html += '<section class="card"><h2>' + esc(MONTHS[Number(state.month.slice(5)) - 1]) + ' vs ' + esc(MONTHS[Number(prevKey.slice(5)) - 1].toLowerCase()) + '</h2>';
    if (!rows.length) {
      html += '<div class="empty">Немає даних для порівняння</div>';
    } else {
      html += rows.map(r => {
        const m = catMeta(r.name);
        const cls = r.d > 0 ? 'neg' : r.d < 0 ? 'pos' : 'muted';
        const pct = r.b ? Math.round(r.d / r.b * 100) : null;
        return '<div class="cmp-row"><span>' + m.emoji + ' ' + esc(r.name) + '<br><span class="muted">' + money(r.b) + ' → ' + money(r.a) + '</span></span>' +
          '<span></span><span class="delta ' + cls + '">' + (r.d > 0 ? '+' : r.d < 0 ? '−' : '') + moneyShort(Math.abs(r.d)) +
          (pct !== null && r.d ? '<br><span class="muted">' + (pct > 0 ? '+' : '') + pct + '%</span>' : '') + '</span></div>';
      }).join('');
    }
    return html + '</section>';
  }

  // Хто скільки
  function viewPeople() {
    const ops = opsOf(state.month).filter(o => o.type === EXPENSE);
    const total = sum(ops);
    const people = state.users.map(name => {
      const mine = ops.filter(o => o.who === name);
      return { name, total: sum(mine), count: mine.length, top: byCategory(mine)[0] };
    }).sort((a, b) => b.total - a.total);

    if (!total) return emptyState('Цього місяця ще немає витрат.');

    let html = '<section class="card"><h2>Хто скільки витратив</h2>' +
      '<div class="split">' + people.map(p => '<i style="width:' + (p.total / total * 100) + '%;background:' + userColor(p.name) + '"></i>').join('') + '</div>' +
      '<div class="rows">' + people.map(p =>
        '<div class="row"><span class="avatar" style="background:' + userColor(p.name) + '">' + esc(p.name.slice(0, 1).toUpperCase()) + '</span>' +
        '<span class="row-main"><div class="row-title">' + esc(p.name) + (state.me && p.name === state.me.name ? ' (ви)' : '') + '</div>' +
        '<div class="row-sub">' + p.count + ' операцій' + (p.top ? ' · найбільше: ' + catMeta(p.top.name).emoji + ' ' + esc(p.top.name) : '') + '</div></span>' +
        '<span class="row-end"><b>' + money(p.total) + '</b><span>' + Math.round(p.total / total * 100) + '%</span></span></div>'
      ).join('') + '</div></section>';

    const cats = byCategory(ops);
    html += '<section class="card"><h2>По категоріях</h2><div class="rows">' + cats.map(c => {
      const m = catMeta(c.name);
      const parts = people.map(p => {
        const v = sum(ops.filter(o => o.who === p.name && o.category === c.name));
        return v ? '<i style="width:' + (v / c.total * 100) + '%;background:' + userColor(p.name) + '"></i>' : '';
      }).join('');
      return '<div class="row"><span class="ico" style="background:' + m.color + '22">' + m.emoji + '</span>' +
        '<span class="row-main"><div class="row-title">' + esc(c.name) + '</div><div class="split" style="height:6px;margin:6px 0 0">' + parts + '</div></span>' +
        '<span class="row-end"><b>' + money(c.total) + '</b></span></div>';
    }).join('') + '</div></section>';
    return html;
  }

  // ───────── Шторка додавання / редагування ─────────

  function openSheet(op) {
    const defDate = state.month === monthKey(new Date()) ? dateKey(new Date()) : state.month + '-01';
    state.sheet = op
      ? { id: op.id, isEdit: true, type: op.type, amount: String(op.amount).replace('.', ','), category: op.category, comment: op.comment, date: op.date }
      : { type: EXPENSE, amount: '', category: null, comment: '', date: defDate };
    renderSheet();
    $('#sheet').hidden = false;
    $('#sheet-backdrop').hidden = false;
    if (tg && tg.BackButton) tg.BackButton.show();
    if (!op) setTimeout(() => { const i = $('#f-amount'); if (i) i.focus(); }, 280);
  }

  function closeSheet() {
    state.sheet = null;
    $('#sheet').hidden = true;
    $('#sheet-backdrop').hidden = true;
    if (tg && tg.BackButton) tg.BackButton.hide();
  }

  function renderSheet() {
    const s = state.sheet;
    const cats = state.categories.filter(c => c.type === s.type);
    $('#sheet').innerHTML =
      '<div class="grabber"></div>' +
      '<div class="sheet-title"><h3>' + (s.isEdit ? 'Редагування' : 'Нова операція') + '</h3><button data-action="close-sheet">Закрити</button></div>' +
      '<div class="seg"><button data-action="set-type" data-type="' + EXPENSE + '" class="' + (s.type === EXPENSE ? 'on' : '') + '">Витрата</button>' +
      '<button data-action="set-type" data-type="' + INCOME + '" class="' + (s.type === INCOME ? 'on' : '') + '">Дохід</button></div>' +
      '<label class="amount-field" id="amount-wrap"><input id="f-amount" inputmode="decimal" placeholder="0" autocomplete="off" value="' + esc(s.amount) + '"><span>' + esc(state.currency) + '</span></label>' +
      '<div class="cat-grid">' + cats.map(c =>
        '<button class="cat-chip' + (s.category === c.name ? ' on' : '') + '" data-action="pick-cat" data-cat="' + esc(c.name) + '"><span class="e">' + (c.emoji || '•') + '</span>' + esc(c.name) + '</button>'
      ).join('') + '</div>' +
      '<label class="field"><input id="f-comment" placeholder="Коментар (необовʼязково)" maxlength="200" value="' + esc(s.comment) + '"></label>' +
      '<label class="field"><input id="f-date" type="date" value="' + esc(s.date) + '"></label>' +
      '<button class="btn" data-action="save">' + (s.isEdit ? 'Зберегти' : 'Додати') + '</button>' +
      (s.isEdit ? '<button class="btn danger" data-action="delete">Видалити</button>' : '');
  }

  function readSheetInputs() {
    const s = state.sheet;
    if (!s) return;
    s.amount = $('#f-amount').value;
    s.comment = $('#f-comment').value;
    s.date = $('#f-date').value || s.date;
  }

  async function saveSheet() {
    readSheetInputs();
    const s = state.sheet;
    const amount = parseFloat(String(s.amount).replace(/\s/g, '').replace(',', '.'));
    if (!(amount > 0)) {
      const w = $('#amount-wrap');
      w.classList.remove('bad'); void w.offsetWidth; w.classList.add('bad');
      haptic('error');
      return;
    }
    const op = { id: s.id, type: s.type, amount, category: s.category || FALLBACK[s.type], comment: s.comment.trim(), date: s.date };
    closeSheet();
    haptic('success');
    state.month = op.date.slice(0, 7);

    if (s.isEdit) {
      const idx = state.ops.findIndex(o => o.id === op.id);
      const old = state.ops[idx];
      state.ops[idx] = Object.assign({}, old, op, { month: state.month, pending: true });
      render();
      try {
        const r = await api('update', { op });
        replaceOp(op.id, r.op);
      } catch (e) {
        replaceOp(op.id, old);
        toast('Не вдалося зберегти 😕');
      }
    } else {
      const tmp = Object.assign({}, op, { id: 'tmp' + Date.now(), month: state.month, who: state.me.name, pending: true });
      state.ops.push(tmp);
      render();
      try {
        const r = await api('add', { op });
        replaceOp(tmp.id, r.op);
        toast('Додано: ' + catMeta(r.op.category).emoji + ' ' + money(r.op.amount));
      } catch (e) {
        state.ops = state.ops.filter(o => o.id !== tmp.id);
        render();
        toast('Не вдалося додати 😕');
      }
    }
  }

  function replaceOp(id, op) {
    const idx = state.ops.findIndex(o => o.id === id);
    if (idx >= 0) state.ops[idx] = op;
    render();
  }

  async function deleteFromSheet() {
    const id = state.sheet.id;
    if (!(await confirmBox('Видалити цю операцію?'))) return;
    const old = state.ops.find(o => o.id === id);
    closeSheet();
    state.ops = state.ops.filter(o => o.id !== id);
    render();
    haptic('warning');
    try {
      await api('delete', { id });
      toast('Видалено');
    } catch (e) {
      state.ops.push(old);
      render();
      toast('Не вдалося видалити 😕');
    }
  }

  // ───────── Події ─────────

  document.addEventListener('click', e => {
    const tabBtn = e.target.closest('[data-tab], [data-tab-go]');
    if (tabBtn) {
      state.tab = tabBtn.dataset.tab || tabBtn.dataset.tabGo;
      if (tabBtn.dataset.tab) state.filterCat = null;
      haptic('light');
      render();
      window.scrollTo(0, 0);
      return;
    }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (a === 'month-prev' || a === 'month-next') {
      state.month = shiftMonth(state.month, a === 'month-prev' ? -1 : 1);
      haptic('light');
      render();
    } else if (a === 'set-month') {
      state.month = el.dataset.month;
      render();
    } else if (a === 'add') {
      openSheet(null);
    } else if (a === 'edit') {
      const op = state.ops.find(o => o.id === el.dataset.id);
      if (op && !op.pending) openSheet(op);
    } else if (a === 'filter-cat') {
      state.filterCat = el.dataset.cat;
      state.tab = 'history';
      render();
      window.scrollTo(0, 0);
    } else if (a === 'clear-filter') {
      state.filterCat = null;
      render();
    } else if (a === 'close-sheet') {
      closeSheet();
    } else if (a === 'set-type') {
      readSheetInputs();
      if (state.sheet.type !== el.dataset.type) {
        state.sheet.type = el.dataset.type;
        state.sheet.category = null;
        renderSheet();
      }
    } else if (a === 'pick-cat') {
      readSheetInputs();
      state.sheet.category = el.dataset.cat;
      haptic('light');
      renderSheet();
    } else if (a === 'save') {
      saveSheet();
    } else if (a === 'delete') {
      deleteFromSheet();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && state.sheet && e.target.tagName === 'INPUT') {
      e.preventDefault();
      saveSheet();
    }
  });

  // ───────── Старт ─────────

  function fatal(html) {
    document.querySelector('.tabbar').hidden = true;
    document.querySelector('.top').hidden = true;
    view.innerHTML = '<div class="fatal">' + html + '</div>';
  }

  async function start() {
    if (tg) {
      tg.ready();
      tg.expand();
      try { tg.setHeaderColor('secondary_bg_color'); tg.setBackgroundColor('secondary_bg_color'); } catch (e) { /* ок */ }
      try { if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) { /* ок */ }
      if (tg.BackButton) tg.BackButton.onClick(closeSheet);
    }
    if (!DEMO && !CONFIG.apiUrl) {
      return fatal('<div class="big">⚙️</div><p>Не вказано <code>apiUrl</code> у <b>config.js</b>.</p>');
    }

    view.innerHTML = '<div class="skeleton"></div><div class="skeleton" style="height:260px"></div>';
    try {
      const data = await api('init');
      state.me = data.me;
      state.users = data.users;
      state.currency = data.currency || '₴';
      state.categories = data.categories;
      state.ops = data.ops;
      render();
    } catch (e) {
      if (e.data && e.data.error === 'forbidden') {
        fatal('<div class="big">⛔️</div><p>Немає доступу.</p><p>Ваш Telegram ID: <code>' + esc(e.data.userId) + '</code><br>Додайте його в ALLOWED_USERS.</p>');
      } else if (e.data && e.data.error === 'unauthorized') {
        fatal('<div class="big">🔒</div><p>Сесія застаріла. Закрийте й відкрийте додаток знову.</p>');
      } else {
        fatal('<div class="big">😕</div><p>Не вдалося завантажити дані.</p><p style="color:var(--hint)">' + esc(e.message) + '</p>');
      }
    }
  }

  // ───────── Демо-режим (поза Telegram) ─────────

  const Demo = (() => {
    const users = ['Влад', 'Оля'];
    const categories = [
      [EXPENSE, 'Продукти', '🛒'], [EXPENSE, 'Кафе', '☕'], [EXPENSE, 'Транспорт', '🚕'], [EXPENSE, 'Житло', '🏠'],
      [EXPENSE, 'Зв’язок', '📱'], [EXPENSE, 'Здоров’я', '💊'], [EXPENSE, 'Одяг', '👕'], [EXPENSE, 'Розваги', '🎬'],
      [EXPENSE, 'Дім', '🧴'], [EXPENSE, 'Подарунки', '🎁'], [EXPENSE, 'Інше', '📦'],
      [INCOME, 'Зарплата', '💼'], [INCOME, 'Підробіток', '💻'], [INCOME, 'Інші доходи', '💰'],
    ].map(([type, name, emoji]) => ({ type, name, emoji, keywords: [] }));

    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const pick = arr => arr[Math.floor(rnd() * arr.length)];
    const between = (a, b) => Math.round((a + rnd() * (b - a)) / 5) * 5;

    const plan = [
      ['Продукти', 12, 150, 1400, ['Сільпо', 'АТБ', 'Novus', 'ринок', '']],
      ['Кафе', 8, 70, 650, ['кава', 'обід', 'піца', 'суші', '']],
      ['Транспорт', 7, 90, 400, ['таксі', 'Bolt', 'бензин', 'метро']],
      ['Зв’язок', 2, 200, 350, ['інтернет', 'мобільний']],
      ['Здоров’я', 2, 150, 900, ['аптека', 'вітаміни']],
      ['Розваги', 3, 150, 700, ['кіно', 'Netflix', 'концерт']],
      ['Одяг', 1, 600, 3200, ['кросівки', 'куртка', '']],
      ['Дім', 2, 200, 1500, ['побутова хімія', 'Епіцентр']],
      ['Подарунки', 1, 300, 1500, ['квіти', 'подарунок']],
    ];

    function generate() {
      const ops = [];
      const now = new Date();
      let n = 0;
      for (let back = 6; back >= 0; back--) {
        const first = new Date(now.getFullYear(), now.getMonth() - back, 1);
        const lastDay = back === 0 ? now.getDate() : new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
        const mk = monthKey(first);
        const add = (type, category, amount, comment, day, who) => {
          if (day > lastDay) return;
          ops.push({ id: 'd' + (n++), type, category, amount, comment, date: mk + '-' + pad(day), month: mk, who });
        };
        add(INCOME, 'Зарплата', 52000, 'зарплата', 5, users[0]);
        add(INCOME, 'Зарплата', 41000, 'зарплата', 10, users[1]);
        if (rnd() > 0.5) add(INCOME, 'Підробіток', between(4000, 12000), 'фріланс', 1 + Math.floor(rnd() * 27), users[0]);
        add(EXPENSE, 'Житло', 18000, 'оренда', 1, users[0]);
        add(EXPENSE, 'Житло', between(1800, 3600), 'комуналка', 15, users[1]);
        plan.forEach(([cat, count, min, max, comments]) => {
          const k = Math.max(0, count + Math.round((rnd() - 0.5) * count * 0.6));
          for (let i = 0; i < k; i++) add(EXPENSE, cat, between(min, max), pick(comments), 1 + Math.floor(rnd() * 28), pick(users));
        });
      }
      return ops;
    }

    let ops = null;
    const delay = v => new Promise(r => setTimeout(() => r(v), 250));

    return {
      call(action, p) {
        if (!ops) ops = generate();
        if (action === 'init') {
          return delay({ ok: true, me: { id: 0, name: users[0] }, users, currency: '₴', categories, ops: ops.slice() });
        }
        if (action === 'add') {
          const op = Object.assign({}, p.op, { id: 'd' + Date.now(), month: p.op.date.slice(0, 7), who: users[0] });
          ops.push(op);
          return delay({ ok: true, op });
        }
        if (action === 'update') {
          const i = ops.findIndex(o => o.id === p.op.id);
          ops[i] = Object.assign({}, ops[i], p.op, { month: p.op.date.slice(0, 7) });
          return delay({ ok: true, op: ops[i] });
        }
        if (action === 'delete') {
          ops = ops.filter(o => o.id !== p.id);
          return delay({ ok: true });
        }
        return delay({ ok: false, error: 'unknown action' });
      },
    };
  })();

  start();
})();

/* =========================================================
   CHEMICALS VIEW: weekly stocktake, order list, usage trends.
   Order rules copy the ST26 Chemicals sheet (bring stock back up to the minimum,
   with the +1 buffer on the lines that have it) and add a look-ahead on usage.
   ========================================================= */
(function () {
  'use strict';
  const App = window.App, F = App.F, esc = App.esc;
  const SUP_ORDER = ['Sopura', 'Ecolab', 'Nalco'];
  const SUP_COL = { Sopura: '#FDAA63', Ecolab: '#47D7AC', Nalco: '#7566A0' };
  let sel = null;

  const isPct = c => c.unit === 'tank%';
  const fromInput = (c, v) => v === null ? null : (isPct(c) ? v / 100 : v);
  const disp = (c, v) => v === null || v === undefined || isNaN(v) ? '–' : isPct(c) ? Math.round(v * 100) + '%' : (+v.toFixed(2)).toString();
  const unit = c => isPct(c) ? '%' : '';

  function lastCount(id, S) {
    const hit = S.stocktakes.filter(s => s.counts && s.counts[id] !== undefined && s.counts[id] !== '').sort((a, b) => a.date < b.date ? 1 : -1)[0];
    return hit ? { count: parseFloat(hit.counts[id]), date: hit.date } : null;
  }

  function render(el) {
    const S = App.state, today = App.todayISO(), sups = App.suppliers();
    const chems = App.chemicals().filter(c => c.active);
    const info = {};
    chems.forEach(c => {
      const u = F.chemUsage(c.id, S.stocktakes);
      info[c.id] = { usage: u.usage, points: u.points, weekly: F.avgWeekly(u.usage, 4), last: lastCount(c.id, S) };
    });
    el._ctx = { chems, info, sups, today };

    let h = `<section class="card" data-acc="apricot"><div class="card__h"><div><h2>Weekly chemical stocktake</h2>
      <p class="sub">Count what's on hand, and note anything delivered since the last count so usage is worked out correctly. The order list updates as you type. Orders follow the ST26 rule: top back up to minimum stock, plus a look-ahead if usage means you'd dip below minimum before the next delivery.</p></div>
      <div class="row"><label class="field">Stocktake date<input type="date" id="stDate" value="${today}"></label>
      <button class="btn" id="fillLast" type="button">Fill with last counts</button><button class="btn btn--primary" id="saveStock" type="button">Save stocktake</button></div></div>
      <div class="tscroll"><table id="stTable"><thead><tr><th>Chemical</th><th class="num">Min</th><th class="num">Last count</th><th class="num">This week</th><th class="num">Delivered since</th><th class="num">Order</th></tr></thead><tbody>`;
    SUP_ORDER.forEach(sn => {
      const rows = chems.filter(c => c.supplier === sn); if (!rows.length) return;
      h += `<tr class="grp"><td colspan="6"><span class="swatch" style="background:${SUP_COL[sn]}"></span> ${sn}<small>${esc((sups[sn] || {}).rule || '')}</small></td></tr>`;
      rows.forEach(c => {
        const L = info[c.id].last;
        h += `<tr data-id="${c.id}"><td><div class="chem-name">${esc(c.name)}${c.notes && c.notes.length ? ` <span class="chip chip--warn" title="${esc(c.notes.join(' '))}">Check units</span>` : ''}</div><div class="chem-desc">${esc(c.description || '')}</div></td>
          <td class="num">${disp(c, c.min)}</td>
          <td class="num">${L ? disp(c, L.count) + `<div class="faint" style="font-size:11px">${App.fmtS(L.date)}</div>` : disp(c, c.seedCount) + '<div class="faint" style="font-size:11px">from ST26</div>'}</td>
          <td class="num"><input type="number" inputmode="decimal" step="any" min="0" data-k="count" aria-label="${esc(c.name)} count${unit(c) ? ' in %' : ''}" placeholder="${disp(c, L ? L.count : c.seedCount).replace('%', '')}">${unit(c)}</td>
          <td class="num"><input type="number" inputmode="decimal" step="any" min="0" data-k="recv" aria-label="${esc(c.name)} delivered since last count" placeholder="0"></td>
          <td class="num" data-cell="order">–</td></tr>`;
      });
    });
    h += `</tbody></table></div><p class="faint" style="font-size:12px;margin:10px 0 0">Leave a row blank to skip it this week. Bulk water-treatment tanks (ACID700, ALKS500) are counted as % full.</p></section>`;
    h += `<section class="card" data-acc="mint"><div class="card__h"><div><h2>This week's order</h2><p class="sub" id="orderSub"></p></div><button class="btn" id="copyOrder" type="button">Copy order list</button></div><div id="orders"></div></section>`;
    h += trendsCard(chems, info);
    h += historyCard(S);
    el.innerHTML = h;
    bind(el);
    recalc(el);
    drawDetail(el);
  }

  /* ---------- live calculation ---------- */
  function current(c, info, row) {
    const typed = row ? fromInput(c, App.num(App.$('[data-k=count]', row).value)) : null;
    if (typed !== null) return { count: typed, typed: true };
    const L = info.last; if (L && App.daysAgo(L.date) <= 10) return { count: L.count, typed: false };
    return { count: null, typed: false };
  }
  function recalc(el) {
    const { chems, info, sups, today } = el._ctx, byS = {};
    let counted = 0;
    chems.forEach(c => {
      const row = App.$('tr[data-id="' + c.id + '"]', el), cur = current(c, info[c.id], row);
      const cell = App.$('[data-cell=order]', row);
      if (cur.count === null) { cell.innerHTML = '<span class="faint">–</span>'; return; }
      counted++;
      const rec = F.chemRecommend(c, cur.count, info[c.id].weekly, sups[c.supplier], today);
      if (rec.qty > 0) {
        const lbl = isPct(c) ? 'Refill' : rec.qty;
        cell.innerHTML = `<span class="order-qty">${lbl}</span><div><span class="chip ${rec.reason === 'trend' ? 'chip--warn' : 'chip--bad'}">${rec.reason === 'trend' ? 'Running down' : 'Below min'}</span></div>`;
        (byS[c.supplier] = byS[c.supplier] || []).push({ c, rec, cur });
      } else cell.innerHTML = `<span class="chip chip--ok">OK</span>${info[c.id].weekly ? `<div class="faint" style="font-size:11px">${info[c.id].weekly > 0 && cur.count ? (cur.count / info[c.id].weekly).toFixed(1) + ' wks cover' : ''}</div>` : ''}`;
    });
    el._orders = byS;
    App.$('#orderSub', el).textContent = counted ? counted + ' of ' + chems.length + ' chemicals counted' + (counted < chems.length ? '. Items not counted are left off.' : '.') : 'Enter this week\'s counts above to build the order.';
    let h = '', any = false;
    SUP_ORDER.forEach(sn => {
      const items = byS[sn]; if (!items) return; any = true;
      const sp = items[0].rec;
      h += `<div class="order-block"><h4><span><span class="swatch" style="background:${SUP_COL[sn]}"></span> ${sn}</span>
        <span class="chip chip--info">${sp.orderBy === today ? 'Order today' : 'Order by ' + App.fmtD(sp.orderBy)} · arrives ${App.fmtD(sp.delivery)}</span></h4><ul>`;
      items.forEach(({ c, rec }) => { h += `<li><span>${esc(c.name)}${c.description ? ` <span class="faint">· ${esc(c.description)}</span>` : ''}</span><b>${isPct(c) ? 'Refill bulk tank' : rec.qty}</b></li>`; });
      h += '</ul></div>';
    });
    App.$('#orders', el).innerHTML = any ? h : `<div class="empty">${counted ? 'Nothing to order. Everything counted is at or above minimum stock.' : 'No counts yet.'}</div>`;
  }

  function orderText(el) {
    const { today } = el._ctx; let t = 'Chemical order, week of ' + App.fmtD(today) + '\n';
    SUP_ORDER.forEach(sn => { const items = el._orders[sn]; if (!items) return;
      t += '\n' + sn + ' (order by ' + App.fmtD(items[0].rec.orderBy) + ', arrives ' + App.fmtD(items[0].rec.delivery) + ')\n';
      items.forEach(({ c, rec }) => { t += '- ' + c.name + ': ' + (isPct(c) ? 'refill bulk tank' : rec.qty) + '\n'; }); });
    return t;
  }

  /* ---------- trends ---------- */
  function trendsCard(chems, info) {
    const withData = chems.filter(c => info[c.id].usage.length);
    if (!withData.length) return `<section class="card" data-acc="purple"><div class="card__h"><div><h2>Usage trends</h2><p class="sub">Save at least two weekly stocktakes and each chemical's weekly use, weeks of cover and trend will appear here.</p></div></div><div class="empty">No usage history yet. Your first stocktake sets the baseline.</div></section>`;
    if (!sel || !withData.find(c => c.id === sel)) sel = withData[0].id;
    let h = `<section class="card" data-acc="purple"><div class="card__h"><div><h2>Usage trends</h2><p class="sub">Use = last count + delivered − this count, spread over the days between counts. Pick a chemical to see its stock and weekly use.</p></div></div>
      <div class="grid2" id="detail"><div><div class="strong" id="dTitle" style="margin-bottom:4px"></div><div id="dStock" class="ch"></div><div class="legend"><span><i style="background:#7566A0"></i>Stock on hand</span><span><i style="background:#e0801f"></i>Minimum</span></div></div>
      <div><div class="strong" style="margin-bottom:4px">Used per week</div><div id="dUse" class="ch"></div></div></div><div class="trend-grid">`;
    withData.forEach(c => {
      const I = info[c.id], u = I.usage, wk = I.weekly, vals = u.slice(-8).map(x => x.perWeek);
      let arrow = '';
      if (u.length >= 3) { const r = F.avgWeekly(u.slice(-2), 2), p = F.avgWeekly(u.slice(0, -2), 4); if (p > 0 && r !== null) { const ch = (r - p) / p; arrow = ch > .15 ? '<span class="chip chip--warn">Rising</span>' : ch < -.15 ? '<span class="chip chip--ok">Falling</span>' : '<span class="chip chip--n">Steady</span>'; } }
      const L = I.last, cover = L && wk > 0 ? (L.count / wk).toFixed(1) + ' weeks of stock' : '';
      h += `<button type="button" class="tcard" data-sel="${c.id}" aria-pressed="${c.id === sel}"><b>${esc(c.name)}</b><div class="big">${disp(c, wk)}${isPct(c) ? '' : ''}<small class="muted" style="font-size:12px;font-weight:500"> / week</small></div>${Charts.spark(vals, SUP_COL[c.supplier], 150, 30)}<div class="muted" style="font-size:12px;margin-top:4px">${cover} ${arrow}</div></button>`;
    });
    return h + '</div></section>';
  }
  function drawDetail(el) {
    const box = App.$('#dStock', el); if (!box) return;
    const { chems, info } = el._ctx, c = chems.find(x => x.id === sel); if (!c) return;
    App.$('#dTitle', el).textContent = c.name + (isPct(c) ? ' (% full)' : '');
    const I = info[c.id], k = isPct(c) ? 100 : 1;
    App.redraws.push(() => {
      Charts.line(App.$('#dStock', el), {
        dates: I.points.map(p => p.date), height: 210, yFmt: v => +v.toFixed(1), label: c.name + ' stock',
        series: [{ values: I.points.map(p => p.count * k), color: '#7566A0', area: true, dots: true }],
        hlines: [{ y: c.min * k, color: '#e0801f', textColor: '#9a4d09', label: 'min ' + disp(c, c.min), dash: '4 4' }],
        tip: i => `<b>${App.fmtD(I.points[i].date)}</b><br>Stock ${disp(c, I.points[i].count)}`
      });
      Charts.bars(App.$('#dUse', el), { labels: I.usage.map(u => App.fmtS(u.date)), height: 210, yFmt: v => +v.toFixed(1), label: c.name + ' weekly use',
        series: [{ name: 'Used per week', color: SUP_COL[c.supplier], values: I.usage.map(u => u.perWeek * k) }] });
    });
  }

  function historyCard(S) {
    const list = S.stocktakes.slice().sort((a, b) => a.date < b.date ? 1 : -1);
    if (!list.length) return '';
    return `<section class="card" data-acc="ink"><div class="card__h"><div><h2>Stocktake history</h2></div></div><div class="tscroll"><table><thead><tr><th>Date</th><th class="num">Chemicals counted</th><th class="num">Deliveries noted</th><th></th></tr></thead><tbody>${list.slice(0, 26).map(s => `<tr><td>${App.fmtD(s.date)}</td><td class="num">${Object.keys(s.counts).length}</td><td class="num">${Object.values(s.received || {}).filter(v => v > 0).length}</td><td class="num"><button class="btn btn--sm btn--danger" data-delst="${s.id}">Delete</button></td></tr>`).join('')}</tbody></table></div></section>`;
  }

  /* ---------- events ---------- */
  function bind(el) {
    const S = App.state;
    App.$$('#stTable input', el).forEach(i => i.addEventListener('input', () => recalc(el)));
    App.$('#fillLast', el).addEventListener('click', () => {
      el._ctx.chems.forEach(c => { const row = App.$('tr[data-id="' + c.id + '"]', el), inp = App.$('[data-k=count]', row); if (inp.value === '') { const L = el._ctx.info[c.id].last, v = L ? L.count : c.seedCount; inp.value = isPct(c) ? Math.round(v * 100) : +v.toFixed(2); } });
      recalc(el);
    });
    App.$('#saveStock', el).addEventListener('click', () => {
      const date = App.$('#stDate', el).value || el._ctx.today, counts = {}, received = {};
      el._ctx.chems.forEach(c => { const row = App.$('tr[data-id="' + c.id + '"]', el), v = fromInput(c, App.num(App.$('[data-k=count]', row).value)), r = App.num(App.$('[data-k=recv]', row).value);
        if (v !== null) { counts[c.id] = v; if (r) received[c.id] = isPct(c) ? r / 100 : r; } });
      if (!Object.keys(counts).length) return App.toast('Enter at least one count first');
      const existing = S.stocktakes.find(s => s.date === date);
      if (existing) { Object.assign(existing.counts, counts); existing.received = Object.assign(existing.received || {}, received); }
      else S.stocktakes.push({ id: App.uid(), date, counts, received });
      App.save(); App.toast('Stocktake saved for ' + App.fmtD(date)); App.render();
    });
    App.$('#copyOrder', el).addEventListener('click', async () => {
      const t = orderText(el);
      try { await navigator.clipboard.writeText(t); App.toast('Order list copied'); } catch (e) { App.toast('Copy blocked by the browser'); }
    });
    App.$$('[data-sel]', el).forEach(b => b.addEventListener('click', () => { sel = b.dataset.sel; App.render(); }));
    App.$$('[data-delst]', el).forEach(b => b.addEventListener('click', () => { if (!confirm('Delete this stocktake?')) return; S.stocktakes = S.stocktakes.filter(s => s.id !== b.dataset.delst); App.save(); App.render(); }));
  }

  App.views.chem = { render };
})();

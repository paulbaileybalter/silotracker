/* =========================================================
   GRAIN VIEW: silo board, delivery plan, usage trends, bookings, history.
   ========================================================= */
(function () {
  'use strict';
  const App = window.App, F = App.F, C = Charts, esc = App.esc;
  const COL = { silo1: '#7566A0', pool: '#47D7AC', silo4: '#FDAA63' };
  const SILOS = [
    { id: 'silo1', name: 'Silo 1', feeds: 'Pale malt to the DME brewhouse', grain: 'pale', group: 'silo1' },
    { id: 'silo2', name: 'Silo 2', feeds: 'Pale malt, fills Silo 3', grain: 'pale', group: 'pool' },
    { id: 'silo3', name: 'Silo 3', feeds: 'Pale malt to the Krones brewhouse', grain: 'pale', group: 'pool' },
    { id: 'silo4', name: 'Silo 4', feeds: 'Wheat malt to the Krones brewhouse', grain: 'wheat', group: 'silo4' }
  ];
  let usageMode = 'day', readSource = null;

  /* ---------- silo drawing ---------- */
  function siloSVG(s, kg, uncKg) {
    const top = 10, bodyH = 150, perT = bodyH / 30, y0 = top + bodyH;
    const has = kg !== null && kg !== undefined;
    const T = has ? Math.max(0, Math.min(30, kg / 1000)) : 0;
    const hi = has ? Math.min(30, T + uncKg / 1000) : 0, lo = has ? Math.max(0, T - uncKg / 1000) : 0;
    const fillCls = s.grain === 'wheat' ? 'grain-wheat' : 'grain-pale';
    const capY = y0 - perT * 28;
    let g = `<svg viewBox="0 0 130 215" role="img" aria-label="${s.name}: ${has ? App.t(kg) + ' tonnes (estimate)' : 'no reading'}">`;
    g += `<defs><clipPath id="cp-${s.id}"><rect x="15" y="${top}" width="90" height="${bodyH}" rx="9"/></clipPath>
      <linearGradient id="gPale" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD637"/><stop offset="1" stop-color="#F1EB9C"/></linearGradient>
      <linearGradient id="gWheat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FDAA63"/><stop offset="1" stop-color="#FFD0A3"/></linearGradient></defs>`;
    if (has && T > 0) g += `<polygon points="15,${y0} 105,${y0} 72,205 48,205" class="${fillCls}"/>`;
    g += `<g clip-path="url(#cp-${s.id})"><rect class="tank-body" x="15" y="${top}" width="90" height="${bodyH}" style="stroke:none"/>`;
    if (has) g += `<rect class="${fillCls} fill-anim" x="15" y="${(y0 - perT * T).toFixed(1)}" width="90" height="${(perT * T).toFixed(1)}"/>`;
    [10, 20].forEach(t => { g += `<line class="tank-grid" x1="15" x2="105" y1="${y0 - perT * t}" y2="${y0 - perT * t}"/>`; });
    if (has && uncKg > 0) g += `<rect class="range-band" x="15" y="${(y0 - perT * hi).toFixed(1)}" width="90" height="${Math.max(1, perT * (hi - lo)).toFixed(1)}"/>
      <line x1="15" x2="105" y1="${(y0 - perT * T).toFixed(1)}" y2="${(y0 - perT * T).toFixed(1)}" stroke="#14161a" stroke-width="2"/>`;
    g += `</g><path class="tank-body" d="M15 ${y0} V${top + 9} a9 9 0 0 1 9 -9 H96 a9 9 0 0 1 9 9 V${y0} L72 205 H48 Z" style="fill:none"/>`;
    g += `<line class="tank-cap" x1="15" x2="105" y1="${capY}" y2="${capY}"/><text x="109" y="${capY + 4}" font-size="10" fill="#55585F" font-weight="600">28 t</text>`;
    g += `<text x="10" y="${y0 - perT * 10 + 3}" font-size="9" fill="#8a8d93" text-anchor="end">10</text><text x="10" y="${y0 - perT * 20 + 3}" font-size="9" fill="#8a8d93" text-anchor="end">20</text>`;
    return g + '</svg>';
  }

  /* ---------- main render ---------- */
  function render(el) {
    const S = App.state, data = App.data(), today = App.todayISO(), st = App.settings();
    const P = F.planAll(S, data, today), rd = P.reading;
    if (!readSource) readSource = (rd && rd.source) || 'estimate';
    const unc = (src) => (src === 'radar' ? st.radarUncertaintyKg : st.uncertaintyKg);
    const age = rd ? App.daysAgo(rd.date) : null;

    let h = notices(P, data, today, age);

    /* --- silo board --- */
    h += `<section class="card" data-acc="mint"><div class="card__h"><div><h2>Silo levels</h2>
      <p class="sub">These are estimates from the sight glasses and knocking on the shell, so every figure carries a range (±${App.t(unc(readSource))} t per silo). Enter your best guess in tonnes. When the radars go in, switch the source to Radar and the ranges tighten.</p></div>
      <div class="row"><label class="field">Estimate date<input type="date" id="rdDate" value="${today}"></label>
      <div class="field">Source<div class="seg" id="srcSeg"><button type="button" data-src="estimate" aria-pressed="${readSource === 'estimate'}">Estimate</button><button type="button" data-src="radar" aria-pressed="${readSource === 'radar'}">Radar</button></div></div></div></div>
      <div class="board">`;
    SILOS.forEach(s => {
      const kg = rd ? rd[s.id] : null;
      h += `<div class="silo">${siloSVG(s, kg === undefined ? null : kg, unc(rd ? rd.source : readSource))}
        <div class="silo__name">${s.name}</div><div class="silo__feeds">${s.feeds}</div>
        <div class="silo__big">${kg === null || kg === undefined ? '–' : App.t(kg)}<small> t</small></div>
        <div class="silo__rng">${rd ? 'about ' + App.t(Math.max(0, kg - unc(rd.source))) + ' to ' + App.t(kg + unc(rd.source)) + ' t' : 'no estimate yet'}</div>
        <label class="field" style="align-items:center">New estimate (t)<input type="number" inputmode="decimal" step="0.5" min="0" max="30" id="in-${s.id}" placeholder="${rd ? App.t(rd[s.id]) : 'e.g. 15'}"></label></div>`;
    });
    h += `</div><div class="row" style="margin-top:16px;justify-content:space-between"><div class="board-flow"><span>Silo 1 → DME brewhouse</span><span>Silo 2 → Silo 3 → Krones brewhouse</span><span>Silo 4 (wheat) → Krones brewhouse</span></div>
      <button class="btn btn--primary" id="saveRead" type="button">Save estimates</button></div>
      ${rd ? `<p class="faint" style="margin:10px 0 0;font-size:12px">Last saved: ${App.fmtD(rd.date)} (${rd.source === 'radar' ? 'radar' : 'hand estimate'})${age > 0 ? ', ' + age + ' day' + (age > 1 ? 's' : '') + ' ago' : ', today'}. Leave a box blank to keep its last value.</p>` : ''}</section>`;

    /* --- plan --- */
    if (rd) {
      h += `<section class="card" data-acc="apricot"><div class="card__h"><div><h2>When to order grain</h2>
        <p class="sub">Built from the ST26 brewing schedule and recipes. Pale malt: ${days(st.paleDays)}, booked at least ${st.paleNoticeDays * 24} hours ahead, ${App.t(st.paleDelivery)} t loads. Wheat malt: ${days(st.wheatDays)}, booked at least ${st.wheatNoticeDays} days ahead, ${App.t(st.wheatDelivery)} t loads. Silos are treated as holding ${App.t(st.cap)} t.</p></div></div>`;
      F.GROUP_ORDER.forEach(g => { h += planRow(g, P, today, st); });
      h += '</section>';
    } else {
      h += `<div class="empty">Save your first silo estimates above to see delivery dates and forecasts.</div>`;
    }

    /* --- usage --- */
    if (rd) h += usageCard(P, today, data);

    /* --- bookings --- */
    h += bookingsCard(P, today, st);

    /* --- history --- */
    if (S.readings.length) h += historyCard(S);

    el.innerHTML = h;
    bind(el, P, today, st);
    if (rd) chartsFor(el, P, today, st);
  }
  const days = a => { const N = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; return a.length === 1 ? N[a[0]] + ' only' : N[a[0]] + ' to ' + N[a[a.length - 1]]; };

  function notices(P, data, today, age) {
    let h = '';
    const dates = data.schedule.dates, last = dates[dates.length - 1];
    if (last < today) h += `<div class="note note--bad"><b>The ST26 schedule has run out.</b> It ends on ${App.fmtD(last)}. Use "Update from ST26" (top right) so forecasts use your current brewing schedule.</div>`;
    else if (F.diffDays(today, last) < 10) h += `<div class="note note--info">ST26 schedule covers up to <b>${App.fmtD(last)}</b>. After that, use is estimated from the average of the scheduled days (shaded on the charts).</div>`;
    if (age !== null && age > 7) h += `<div class="note"><b>Your last silo estimate is ${age} days old.</b> Forecasts get less reliable the longer it's been. Save a fresh estimate.</div>`;
    const sh = Object.keys(P.U ? P.U.assumptions : {}).length; // assumptions listed in usage card
    return h;
  }

  function planRow(g, P, today, st) {
    const pr = P.groups[g], M = F.GROUPS[g], r0 = pr.recs[0], unc = pr.uncKg;
    let chip;
    if (!r0) chip = ['ok', 'No delivery needed in the next ' + Math.round(st.horizonDays / 7) + ' weeks'];
    else if (r0.type === 'none') chip = ['bad', 'No delivery day available inside the forecast'];
    else if (r0.type === 'late') chip = ['bad', 'Running low before the earliest delivery'];
    else {
      const od = F.diffDays(today, r0.orderBy);
      chip = [r0.type === 'ok' && od > 1 ? 'ok' : 'warn', od <= 0 ? 'Order today' : od === 1 ? 'Order tomorrow' : 'Order by ' + App.fmtD(r0.orderBy)];
    }
    let h = `<div class="plan"><div><h3><span class="swatch" style="background:${COL[g]}"></span>${M.name}<span class="chip chip--${chip[0]}">${esc(chip[1])}</span></h3>
      <div class="sub" style="margin-top:4px">${M.feeds} · now about ${App.tt(pr.currentKg)} (±${App.t(unc)} t)</div>`;
    const w = pr.runoutWindow;
    const firstRec = pr.recs[0] && pr.recs[0].date;
    const noDel = F.diffDays(today, pr.endISO);
    const dry = pr.proj.find(r => F.ms(r.date) >= F.ms(today) && (r.pre + 0) < 0);
    if (!r0) {
      const lowest = pr.proj.filter(r => F.ms(r.date) >= F.ms(today)).reduce((m, r) => Math.min(m, r.pre), Infinity);
      h += `<p class="muted" style="font-size:13px">Lowest forecast level is about ${App.tt(Math.max(0, lowest))} over the next ${noDel} days.</p>`;
    }
    pr.recs.slice(0, 3).forEach(r => { h += recCard(r, P, today, st); });
    if (pr.recs.length > 3) h += `<p class="faint" style="font-size:12px;margin:8px 0 0">${pr.recs.length - 3} more deliveries follow in the chart, based on average use.</p>`;
    const booked = pr.deliveries.filter(d => d.kind === 'booked');
    if (booked.length) h += `<p class="muted" style="font-size:12.5px;margin:10px 0 0">Already booked and counted: ${booked.map(d => App.fmtD(d.date) + ' (' + App.t(d.qty) + ' t)').join(', ')}.</p>`;
    h += `</div><div><div class="ch" data-chart="${g}"></div><div class="legend"><span><i style="background:${COL[g]}"></i>Best guess</span><span><i style="background:#bdbfc4"></i>Low / high end of estimate</span><span><i style="background:#14161a"></i>Working limit</span></div></div></div>`;
    return h;
  }

  function recCard(r, P, today, st) {
    if (r.type === 'none') return `<div class="del del--bad"><div class="del__d">No delivery day found</div><div class="del__m">Nothing fits inside the forecast window. Check Settings.</div></div>`;
    const cls = r.type === 'ok' ? 'ok' : r.type === 'late' ? 'bad' : 'warn';
    const od = F.diffDays(today, r.orderBy);
    const beyond = r.date > P.U.last;
    let main = '', bullets = [];
    if (r.type === 'ok') main = `Lands at about ${App.tt(r.preBest)}, which leaves room for the full ${App.t(r.qty)} t load.`;
    if (r.type === 'reserve') main = `No delivery day lands between your ${App.t(r.reserve)} t reserve and the level where ${App.t(r.qty)} t fits. This is the least bad day: it lands at about ${App.tt(r.preBest)}.`;
    if (r.type === 'overflow') main = `The silo will still hold about ${App.tt(r.preBest)}, so only about ${App.tt(r.fitsKg)} of the ${App.t(r.qty)} t load fits. Ask the supplier about a part load.`;
    if (r.type === 'late') main = `Too late to avoid running low. This is the earliest possible delivery, and the best guess has ${App.tt(r.shortKg)} too little by then${r.runout ? ' (empty around ' + App.fmtD(r.runout) + ')' : ''}.`;
    if (r.lowRisk) bullets.push('If the silo is at the low end of your estimate, it could run out before this delivery. Check the sight glass before relying on the date.');
    if (r.fitRisk && r.type !== 'overflow') bullets.push(`If the silo is fuller than it looks, the ${App.t(r.qty)} t load may not fit (it fits when the silo holds ${App.t(r.maxPre)} t or less). Check the sight glass the day before.`);
    if (beyond) bullets.push('This date is past the ST26 schedule, so it relies on average use.');
    return `<div class="del del--${cls}"><div class="del__d">${App.fmtD(r.date)} · ${App.t(r.qty)} t</div>
      <div class="del__m"><b>${od <= 0 ? 'Order today' : 'Order by ' + App.fmtD(r.orderBy)}</b> (${F.groupNotice(r.group, st) >= 7 ? F.groupNotice(r.group, st) + ' days' : F.groupNotice(r.group, st) * 24 + ' hours'} notice)</div>
      <div style="font-size:13px;margin-top:6px">${esc(main)}</div>${bullets.length ? '<ul>' + bullets.map(b => '<li>' + esc(b) + '</li>').join('') + '</ul>' : ''}</div>`;
  }

  /* ---------- charts for plan rows ---------- */
  function chartsFor(el, P, today, st) {
    F.GROUP_ORDER.forEach(g => {
      const box = App.$('[data-chart="' + g + '"]', el); if (!box) return;
      App.redraws.push(() => {
        const pr = P.groups[g], rows = pr.proj.filter(r => F.ms(r.date) >= F.ms(today));
        if (!rows.length) return;
        const dates = rows.map(r => r.date), best = rows.map(r => Math.max(0, r.pre + r.delivered));
        const unc = pr.uncKg, lo = best.map(v => Math.max(0, v - unc)), hi = best.map(v => v + unc);
        const markers = [];
        pr.deliveries.forEach(d => { const i = dates.indexOf(d.date); if (i < 0) return;
          const color = d.kind === 'booked' ? '#7566A0' : d.type === 'ok' ? '#0d6a4d' : d.type === 'late' ? '#d2493c' : '#e0801f';
          markers.push({ i, y: best[i], color, title: (d.kind === 'booked' ? 'Booked: ' : 'Suggested: ') + App.fmtD(d.date) + ', ' + App.t(d.qty) + ' t' }); });
        const firstEst = rows.findIndex(r => !r.scheduled);
        C.line(box, {
          dates, height: 235, yMax: Math.ceil(Math.max(pr.cap, ...hi) * 1.04 / 4000) * 4000, yFmt: v => App.t(v), label: F.GROUPS[g].name + ' forecast level in tonnes',
          series: [{ values: hi, color: '#c9cbd0', dash: '3 4' }, { values: lo, color: '#c9cbd0', dash: '3 4' }, { values: best, color: COL[g], area: true }],
          hlines: [{ y: pr.cap, color: '#14161a', label: 'working limit ' + App.t(pr.cap) + ' t' }, { y: pr.reserve, color: '#e0801f', textColor: '#9a4d09', label: 'reserve ' + App.t(pr.reserve) + ' t', dash: '2 4' }],
          markers, todayIndex: 0,
          bands: firstEst >= 0 ? [{ from: firstEst, to: dates.length - 1, label: 'Estimate: past the ST26 schedule' }] : [],
          tip: i => { const r = rows[i]; return `<b>${App.fmtD(r.date)}</b><br>Best guess ${App.t(best[i])} t<br>Range ${App.t(lo[i])} to ${App.t(hi[i])} t<br>Use that day ${App.t(r.use)} t${r.scheduled ? '' : ' (est.)'}${r.delivered ? '<br><b>+ ' + App.t(r.delivered) + ' t delivery</b>' : ''}`; }
        });
      });
    });
    const ub = App.$('#usageChart', el);
    if (ub) App.redraws.push(() => drawUsage(ub, P, today));
  }

  /* ---------- usage trends ---------- */
  function usageCard(P, today, data) {
    const U = P.U, st = P.st, a = U.assumptions;
    const stats = F.GROUP_ORDER.map(g => {
      const per = U.avg[g], cur = P.groups[g].currentKg;
      return `<div class="tcard" style="cursor:default"><b><span class="swatch" style="background:${COL[g]}"></span> ${F.GROUPS[g].name}</b><div class="big">${App.t(per * 7)} t<small class="muted" style="font-size:12px;font-weight:500"> / week</small></div>
        <div class="muted" style="font-size:12px">${App.t(per)} t a day on average · ${per > 0 ? 'about ' + Math.round(cur / per) + ' days of grain at the best guess' : 'no scheduled use'}</div></div>`;
    }).join('');
    let ah = '';
    const keys = Object.keys(a);
    if (keys.length) ah = `<details style="margin-top:14px"><summary class="muted" style="cursor:pointer;font-weight:600">Brews in the schedule that need checking (${keys.length})</summary><ul style="font-size:13px;margin:8px 0 0">` +
      keys.map(k => `<li><b>${esc(k)}</b> × ${a[k].brews}: ${a[k].how === 'none' ? 'no silo recipe found in ST26, counted as 0 kg.' : 'no recipe for this brewhouse, using the other brewhouse\'s recipe (' + a[k].kgPerBrew + ' kg pale malt per brew).'}</li>`).join('') + '</ul></details>';
    return `<section class="card" data-acc="purple"><div class="card__h"><div><h2>Grain use trends</h2>
      <p class="sub">Silo grain per brew comes from the ST26 recipes, multiplied by the brews on the schedule (Silo 1 ← DME brews, Silos 2 + 3 and Silo 4 ← Krones brews). Hatched bars are estimates beyond the schedule.</p></div>
      <div class="seg" id="usageSeg"><button type="button" data-m="day" aria-pressed="${usageMode === 'day'}">By day</button><button type="button" data-m="week" aria-pressed="${usageMode === 'week'}">By week</button></div></div>
      <div id="usageChart" class="ch"></div>
      <div class="legend">${F.GROUP_ORDER.map(g => `<span><i style="background:${COL[g]}"></i>${F.GROUPS[g].name} (tonnes)</span>`).join('')}</div>
      <div class="trend-grid" style="margin-top:18px">${stats}</div>${ah}</section>`;
  }
  function drawUsage(el, P, today) {
    const U = P.U, G = F.GROUP_ORDER; let labels = [], series;
    if (usageMode === 'day') {
      const first = U.first || today, last = U.last || today;
      const ds = F.eachDay(first, last);
      labels = ds.map(d => App.fmtS(d));
      series = G.map(g => ({ name: F.GROUPS[g].name, color: COL[g], values: ds.map(d => U.usage(d, g) / 1000) }));
    } else {
      const mon = F.addDays(today, -((F.dow(today) + 6) % 7)), weeks = [];
      for (let w = 0; w < 8; w++) weeks.push(F.addDays(mon, w * 7));
      labels = weeks.map(d => App.fmtS(d));
      series = G.map(g => ({ name: F.GROUPS[g].name, color: COL[g],
        values: weeks.map(w => F.eachDay(w, F.addDays(w, 6)).reduce((s, d) => s + U.usage(d, g), 0) / 1000),
        est: weeks.map(w => F.eachDay(w, F.addDays(w, 6)).some(d => !U.isScheduled(d))) }));
    }
    Charts.bars(el, { labels, series, height: 240, yFmt: v => (+v.toFixed(1)) + ' t', label: 'Scheduled grain use in tonnes' });
  }

  /* ---------- bookings ---------- */
  function bookingsCard(P, today, st) {
    const S = App.state, list = S.deliveries.slice().sort((a, b) => a.date < b.date ? -1 : 1);
    let rows = list.map(d => {
      const M = F.GROUPS[d.group], okDay = F.groupDays(d.group, st).includes(F.dow(d.date));
      return `<tr><td><span class="swatch" style="background:${COL[d.group]}"></span> ${M.name}</td><td>${App.fmtD(d.date)}</td><td class="num">${App.t(d.qty)} t</td>
        <td>${d.status === 'received' ? '<span class="chip chip--n">Received</span>' : '<span class="chip chip--info">Booked</span>'}${okDay ? '' : ' <span class="chip chip--warn">Not a usual delivery day</span>'}</td>
        <td class="num">${d.status === 'received' ? '' : `<button class="btn btn--sm" data-recv="${d.id}">Mark received</button> `}<button class="btn btn--sm btn--danger" data-deldel="${d.id}">Remove</button></td></tr>`;
    }).join('');
    const nextDay = g => { const n = F.groupNotice(g, st); let d = F.addDays(today, n); while (!F.groupDays(g, st).includes(F.dow(d))) d = F.addDays(d, 1); return d; };
    return `<section class="card" data-acc="sky"><div class="card__h"><div><h2>Booked deliveries</h2>
      <p class="sub">Add a delivery once you've booked it. It's counted in every forecast so the plan stops asking for the same truck twice. Mark it received after it arrives, then save fresh silo estimates (the estimate should include the delivered grain).</p></div></div>
      ${list.length ? `<div class="tscroll"><table><thead><tr><th>Silo</th><th>Delivery date</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">No deliveries booked yet.</div>'}
      <div class="row" style="margin-top:14px;align-items:flex-end"><label class="field">Goes to<select id="bkGroup"><option value="silo1">Silo 1 (pale)</option><option value="pool" selected>Silos 2 + 3 (pale)</option><option value="silo4">Silo 4 (wheat)</option></select></label>
      <label class="field">Delivery date<input type="date" id="bkDate" value="${nextDay('pool')}"></label>
      <label class="field">Amount (t)<input type="number" step="0.5" id="bkQty" value="${App.t(st.paleDelivery)}" style="width:90px"></label>
      <button class="btn btn--primary" id="bkAdd" type="button">Add booked delivery</button></div></section>`;
  }

  function historyCard(S) {
    const rs = S.readings.slice().sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : (b.savedAt || '') < (a.savedAt || '') ? -1 : 1);
    return `<section class="card" data-acc="ink"><div class="card__h"><div><h2>Estimate history</h2><p class="sub">Every saved set of silo estimates. Comparing these with the forecast over time will show how far the estimates drift, and gives a baseline for the radars.</p></div></div>
      <div class="tscroll"><table><thead><tr><th>Date</th><th class="num">Silo 1</th><th class="num">Silo 2</th><th class="num">Silo 3</th><th class="num">Silo 4</th><th>Source</th><th></th></tr></thead><tbody>
      ${rs.slice(0, 20).map(r => `<tr><td>${App.fmtD(r.date)}</td>${['silo1', 'silo2', 'silo3', 'silo4'].map(k => `<td class="num">${App.t(r[k])} t</td>`).join('')}<td>${r.source === 'radar' ? 'Radar' : 'Estimate'}</td><td class="num"><button class="btn btn--sm btn--danger" data-delread="${r.id}">Delete</button></td></tr>`).join('')}
      </tbody></table></div></section>`;
  }

  /* ---------- events ---------- */
  function bind(el, P, today, st) {
    const S = App.state;
    App.$$('#srcSeg button', el).forEach(b => b.addEventListener('click', () => { readSource = b.dataset.src; render(el); App.drawCharts(); }));
    App.$$('#usageSeg button', el).forEach(b => b.addEventListener('click', () => { usageMode = b.dataset.m; App.$$('#usageSeg button', el).forEach(x => x.setAttribute('aria-pressed', x === b)); const ub = App.$('#usageChart', el); drawUsage(ub, P, today); }));
    const save = App.$('#saveRead', el);
    if (save) save.addEventListener('click', () => {
      const prev = P.reading, rec = { id: App.uid(), date: App.$('#rdDate', el).value || today, source: readSource, savedAt: new Date().toISOString() };
      for (const s of SILOS) {
        const raw = App.$('#in-' + s.id, el).value, v = App.num(raw);
        if (v === null) { if (prev) rec[s.id] = prev[s.id]; else return App.toast('Enter an estimate for ' + s.name + ' (use 0 if empty)'); }
        else { if (v < 0 || v > 30) return App.toast(s.name + ': enter between 0 and 30 tonnes'); rec[s.id] = Math.round(v * 1000); }
      }
      S.readings = S.readings.filter(r => r.date !== rec.date); S.readings.push(rec);
      App.save(); App.toast('Estimates saved'); App.render();
    });
    App.$$('[data-delread]', el).forEach(b => b.addEventListener('click', () => { if (!confirm('Delete this set of estimates?')) return; S.readings = S.readings.filter(r => r.id !== b.dataset.delread); App.save(); App.render(); }));
    const grp = App.$('#bkGroup', el);
    if (grp) {
      const nextDay = g => { const n = F.groupNotice(g, st); let d = F.addDays(today, n); while (!F.groupDays(g, st).includes(F.dow(d))) d = F.addDays(d, 1); return d; };
      grp.addEventListener('change', () => { App.$('#bkQty', el).value = App.t(F.groupDelivery(grp.value, st)); App.$('#bkDate', el).value = nextDay(grp.value); });
      App.$('#bkAdd', el).addEventListener('click', () => {
        const date = App.$('#bkDate', el).value, q = App.num(App.$('#bkQty', el).value);
        if (!date || !q || q <= 0) return App.toast('Enter a date and an amount');
        S.deliveries.push({ id: App.uid(), group: grp.value, date, qty: Math.round(q * 1000), status: 'booked' });
        App.save(); App.toast('Delivery added'); App.render();
      });
    }
    App.$$('[data-recv]', el).forEach(b => b.addEventListener('click', () => { const d = S.deliveries.find(x => x.id === b.dataset.recv); d.status = 'received'; App.save(); App.toast('Marked received. Save new silo estimates to include it.'); App.render(); }));
    App.$$('[data-deldel]', el).forEach(b => b.addEventListener('click', () => { S.deliveries = S.deliveries.filter(x => x.id !== b.dataset.deldel); App.save(); App.render(); }));
  }

  App.views.grain = { render };
})();

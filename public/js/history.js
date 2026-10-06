/* =========================================================
   SILO HISTORY: every silo estimate on record (from ST26 and entered here),
   plotted with deliveries, plus a table and CSV download.
   ========================================================= */
(function () {
  'use strict';
  const App = window.App, F = App.F, C = Charts, esc = App.esc;
  const GCOL = { silo1: '#7566A0', pool: '#47D7AC', silo4: '#FDAA63' };
  const SCOL = { silo1: '#7566A0', silo2: '#5BB7D6', silo3: '#47D7AC', silo4: '#FDAA63' };
  const SNAME = { silo1: 'Silo 1', silo2: 'Silo 2', silo3: 'Silo 3', silo4: 'Silo 4' };
  const RANGES = { '4w': ['4 weeks', 28], '12w': ['12 weeks', 84], '6m': ['6 months', 182], all: ['All time', null] };
  let range = '12w', mode = 'group', showFc = true, shown = 30;

  /* ---------- one merged list of estimates ---------- */
  // Older stock tools only fill in days the current ST26 doesn't cover: where both have a day, ST26 wins.
  function merged(data) {
    const baseDates = new Set((data.history || []).map(h => h.date)), baseDel = new Set((data.deliveryLog || []).map(d => d.group + '|' + d.date));
    const addH = [], addD = [], stats = [];
    App.archives().forEach(a => {
      let nh = 0, nd = 0;
      (a.history || []).forEach(h => { if (!baseDates.has(h.date)) { baseDates.add(h.date); addH.push(h); nh++; } });
      (a.deliveryLog || []).forEach(d => { const k = d.group + '|' + d.date; if (!baseDel.has(k)) { baseDel.add(k); addD.push(d); nd++; } });
      const hs = (a.history || []).map(h => h.date).sort();
      stats.push({ source: a.source, total: (a.history || []).length, deliveries: (a.deliveryLog || []).length, from: hs[0], to: hs[hs.length - 1], nh, nd });
    });
    return { history: (data.history || []).concat(addH), deliveryLog: (data.deliveryLog || []).concat(addD), stats };
  }

  // ST26 history first, then estimates typed on this site (these win on the same day, per silo).
  function records(M) {
    const map = {};
    (M.history || []).forEach(h => {
      const pool = h.silo2 === null && h.silo3 === null ? null : (h.silo2 || 0) + (h.silo3 || 0);   // a blank counts as 0 when the other silo has an estimate, as in ST26's TOTAL VOLUME
      map[h.date] = { date: h.date, silo1: h.silo1, silo2: h.silo2, silo3: h.silo3, silo4: h.silo4, pool, src: { silo1: h.from || 'ST26', silo2: h.from || 'ST26', silo3: h.from || 'ST26', silo4: h.from || 'ST26' } };
    });
    App.state.readings.filter(r => r.from !== 'st26').forEach(r => {
      const ids = r.entered || ['silo1', 'silo2', 'silo3', 'silo4'];
      const m = map[r.date] = map[r.date] || { date: r.date, silo1: null, silo2: null, silo3: null, silo4: null, pool: null, src: {} };
      const tag = r.source === 'radar' ? 'Radar' : 'Entered here';
      ids.forEach(id => { m[id] = r[id]; m.src[id] = tag; });
      if (ids.includes('silo2') || ids.includes('silo3')) m.pool = (r.silo2 || 0) + (r.silo3 || 0);
    });
    return Object.values(map).sort((a, b) => a.date < b.date ? -1 : 1);
  }
  const groupVal = (r, g) => g === 'pool' ? r.pool : r[g];
  const groupSrc = (r, g) => g === 'pool' ? (r.src.silo3 || r.src.silo2) : r.src[g];
  function interp(arr) {   // fill gaps between readings in a straight line (for tooltips and marker positions)
    const out = arr.slice(); let prev = -1;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === null) continue;
      if (prev >= 0 && i - prev > 1) for (let k = prev + 1; k < i; k++) out[k] = arr[prev] + (arr[i] - arr[prev]) * (k - prev) / (i - prev);
      prev = i;
    }
    return out;
  }
  function nearest(arr, i) {   // value of the closest estimate, so a delivery dot always sits on the line
    for (let k = 0; k < arr.length; k++) { if (arr[i - k] !== undefined && arr[i - k] !== null) return arr[i - k]; if (arr[i + k] !== undefined && arr[i + k] !== null) return arr[i + k]; }
    return null;
  }
  const tn = kg => kg === null || kg === undefined ? '–' : App.t(kg);

  /* ---------- render ---------- */
  function render(el) {
    const S = App.state, data = App.data(), today = App.todayISO(), st = App.settings();
    const M = merged(data), recs = records(M), P = F.planAll(S, data, today);
    const first = recs.length ? recs[0].date : today;
    let start = RANGES[range][1] ? F.addDays(today, -RANGES[range][1]) : first;
    if (F.ms(start) < F.ms(first)) start = first;
    const fcDays = showFc && mode === 'group' && P.reading ? Math.min(42, st.horizonDays) : 0;
    const days = F.eachDay(start, F.addDays(today, fcDays)), dayIdx = {}; days.forEach((d, i) => { dayIdx[d] = i; });
    const log = M.deliveryLog.filter(d => d.date >= start && d.date < today);

    let h = `<section class="card" data-acc="purple"><div class="card__h"><div><h2>Silo quantities over time</h2>
      <p class="sub">Every silo estimate on record: ${M.history.length} sets from ST26${M.stats.length ? ' and older stock tools' : ''} (${recs.length ? App.fmtS(first) + ' ' + first.slice(0, 4) : 'none'} onwards) plus anything entered on this site. These are hand estimates (about ±${App.t(st.uncertaintyKg)} t), so small ups and downs are normal. Radar readings will appear as solid dots once fitted. Black dots mark deliveries.</p></div>
      <div class="row"><div class="seg" id="hRange">${Object.keys(RANGES).map(k => `<button type="button" data-r="${k}" aria-pressed="${range === k}">${RANGES[k][0]}</button>`).join('')}</div>
      <div class="seg" id="hMode"><button type="button" data-m="group" aria-pressed="${mode === 'group'}">By supply group</button><button type="button" data-m="silo" aria-pressed="${mode === 'silo'}">Each silo</button></div></div></div>
      <div class="row" style="margin-bottom:6px;justify-content:space-between"><label style="display:inline-flex;gap:7px;align-items:center;font-weight:600;font-size:13px;${mode === 'group' ? '' : 'opacity:.45'}"><input type="checkbox" id="hFc" ${showFc ? 'checked' : ''} ${mode === 'group' ? '' : 'disabled'}> Show the forecast from today</label>
      <div class="row"><button class="btn btn--sm" id="hEnter" type="button">Enter an estimate</button><button class="btn btn--sm" id="hCsv" type="button">Download CSV</button></div></div>`;

    if (!recs.length) return void (el.innerHTML = h + '<div class="empty">No estimates yet. Upload ST26 or enter silo estimates on the Grain tab.</div></section>');

    /* stats for the chosen range */
    h += '<div class="trend-grid" style="margin:10px 0 18px">';
    F.GROUP_ORDER.forEach(g => {
      const pts = recs.filter(r => r.date >= start && groupVal(r, g) !== null && groupVal(r, g) !== undefined);
      const dl = log.filter(d => d.group === g), vals = pts.map(r => groupVal(r, g)), last = pts[pts.length - 1];
      h += `<div class="tcard" style="cursor:default"><b><span class="swatch" style="background:${GCOL[g]}"></span> ${F.GROUPS[g].name}</b>
        <div class="big">${last ? App.t(groupVal(last, g)) : '–'}<small class="muted" style="font-size:12px;font-weight:500"> t${last ? ', ' + App.fmtS(last.date) : ''}</small></div>
        <div class="muted" style="font-size:12px">${vals.length ? 'Low ' + App.t(Math.min(...vals)) + ' t · High ' + App.t(Math.max(...vals)) + ' t' : 'No estimates in this range'}<br>${dl.length} deliver${dl.length === 1 ? 'y' : 'ies'}, ${App.t(dl.reduce((s, d) => s + d.qty, 0))} t</div></div>`;
    });
    h += '</div>';

    if (mode === 'group') {
      F.GROUP_ORDER.forEach(g => { h += `<div style="margin-top:6px"><h3 style="font-size:15px;display:flex;gap:8px;align-items:center"><span class="swatch" style="background:${GCOL[g]}"></span>${F.GROUPS[g].name}<span class="muted" style="font-weight:500;font-size:12.5px">${F.GROUPS[g].feeds}</span></h3><div class="ch" data-h="${g}"></div></div>`; });
      h += `<div class="legend"><span><i style="background:#14161a"></i>Delivery</span><span><i style="background:#7566A0"></i>Booked delivery</span><span><i style="background:#0d6a4d"></i>Suggested delivery</span><span>Hollow dot = hand estimate · solid dot = radar · dashed line = forecast</span></div>`;
    } else {
      h += `<div class="ch" data-h="silos"></div><div class="legend">${['silo1', 'silo2', 'silo3', 'silo4'].map(k => `<span><i style="background:${SCOL[k]}"></i>${SNAME[k]}</span>`).join('')}<span>Hollow dot = hand estimate · solid dot = radar · gaps between dots are straight lines</span></div>`;
    }
    h += '</section>';

    /* table */
    const rows = recs.slice().reverse().slice(0, shown);
    h += `<section class="card" data-acc="ink"><div class="card__h"><div><h2>Every estimate</h2><p class="sub">Newest first, in tonnes. A dash means that silo wasn't estimated that day. Silos 2 + 3 is the sum of the two (a blank counts as empty when the other has an estimate).</p></div></div>
      <div class="tscroll"><table><thead><tr><th>Date</th><th class="num">Silo 1</th><th class="num">Silo 2</th><th class="num">Silo 3</th><th class="num">Silo 4</th><th class="num">Silos 2 + 3</th><th>Source</th></tr></thead><tbody>
      ${rows.map(r => { const srcs = [...new Set(Object.values(r.src))]; return `<tr><td>${App.fmtD(r.date)} <span class="faint">${r.date.slice(0, 4)}</span></td>${['silo1', 'silo2', 'silo3', 'silo4', 'pool'].map(k => `<td class="num">${tn(r[k])}</td>`).join('')}<td>${srcs.map(x => `<span class="chip ${x === 'Radar' ? 'chip--ok' : x === 'Entered here' ? 'chip--info' : 'chip--n'}">${esc(x)}</span>`).join(' ')}</td></tr>`; }).join('')}
      </tbody></table></div>${recs.length > shown ? `<div style="margin-top:12px"><button class="btn btn--sm" id="hMore" type="button">Show 30 more (${recs.length - shown} left)</button></div>` : ''}</section>`;
    h += `<section class="card" data-acc="sky"><div class="card__h"><div><h2>Older stock tools</h2>
      <p class="sub">Add an older stock tool workbook (any file with a Bulk Demand sheet) to push the history further back. The current ST26 always wins on days both cover. Earliest estimate on record: <b>${App.fmtD(first)} ${first.slice(0, 4)}</b>.</p></div><button class="btn" id="hArch" type="button">Add an older stock tool</button></div>
      ${M.stats.length ? M.stats.map(a => { const up = (App.state.archives || []).some(x => x.source === a.source);
        return `<div class="del" style="margin-top:8px"><div class="row" style="justify-content:space-between"><div><b>${esc(a.source)}</b> <span class="muted">${a.total} estimate sets, ${a.deliveries} deliveries, ${App.fmtS(a.from)} ${a.from.slice(0, 4)} to ${App.fmtS(a.to)} ${a.to.slice(0, 4)}</span></div>${up ? `<button class="btn btn--sm btn--danger" data-rmarch="${esc(a.source)}" type="button">Remove</button>` : '<span class="chip chip--n">Bundled with the site</span>'}</div>
        <div class="del__m">${a.nh || a.nd ? `Added ${a.nh} estimate set${a.nh === 1 ? '' : 's'} and ${a.nd} deliver${a.nd === 1 ? 'y' : 'ies'} that the current ST26 doesn't have.` : 'Nothing new: every day in this file is already covered by the current ST26.'}</div></div>`; }).join('') : '<div class="empty" style="margin-top:6px">No older stock tools added yet.</div>'}</section>`;
    el.innerHTML = h;

    /* delivery lookups */
    const delByDate = {};
    const addDel = (g, date, qty, tag) => { (delByDate[date] = delByDate[date] || []).push(`${tag} ${F.GROUPS[g].name} ${App.t(qty)} t`); };
    log.forEach(d => addDel(d.group, d.date, d.qty, 'Delivered:'));

    /* charts */
    if (mode === 'group') F.GROUP_ORDER.forEach(g => {
      const box = App.$('[data-h="' + g + '"]', el);
      App.redraws.push(() => {
        const cap = F.groupCap(g, st), actual = days.map(() => null), solid = days.map(() => false);
        recs.forEach(r => { const v = groupVal(r, g), i = dayIdx[r.date]; if (v !== null && v !== undefined && i !== undefined) { actual[i] = v; solid[i] = groupSrc(r, g) === 'Radar'; } });
        const lin = interp(actual), fc = days.map(() => null), pr = P.groups[g];
        if (fcDays && pr) pr.proj.forEach(r => { const i = dayIdx[r.date]; if (r.date >= today && i !== undefined) fc[i] = Math.max(0, r.pre + r.delivered); });
        const markers = [], dbd = {};
        log.filter(d => d.group === g).forEach(d => { const i = dayIdx[d.date]; if (i === undefined) return; const y0 = lin[i] !== null ? lin[i] : nearest(actual, i); if (y0 === null) return; markers.push({ i, y: y0, color: '#14161a', r: 4, title: 'Delivered ' + App.fmtD(d.date) + ': ' + App.t(d.qty) + ' t' + (d.po ? ' (' + d.po + ')' : '') }); (dbd[d.date] = dbd[d.date] || []).push('Delivered ' + App.t(d.qty) + ' t' + (d.po ? ' · ' + d.po : '')); });
        if (fcDays && pr) pr.deliveries.filter(d => d.date >= today).forEach(d => { const i = dayIdx[d.date]; if (i === undefined) return;
          const color = d.kind === 'booked' ? '#7566A0' : '#0d6a4d';
          markers.push({ i, y: fc[i] !== null ? fc[i] : 0, color, r: 4, title: (d.kind === 'booked' ? 'Booked ' : 'Suggested ') + App.fmtD(d.date) + ': ' + App.t(d.qty) + ' t' });
          (dbd[d.date] = dbd[d.date] || []).push((d.kind === 'booked' ? 'Booked ' : 'Suggested ') + App.t(d.qty) + ' t'); });
        const top = Math.max(cap, ...actual.filter(v => v !== null), ...fc.filter(v => v !== null));
        C.line(box, {
          dates: days, height: 215, yMax: Math.ceil(top * 1.04 / 4000) * 4000, yFmt: v => App.t(v), label: F.GROUPS[g].name + ' quantity over time in tonnes',
          series: [{ values: actual, color: GCOL[g], connect: true, dots: true, solid, area: true, dotR: days.length > 150 ? 2.5 : 3.5 }, { values: fc, color: GCOL[g], dash: '5 4', connect: true }],
          hlines: [{ y: cap, color: '#14161a', label: 'working limit ' + App.t(cap) + ' t' }],
          markers, todayIndex: dayIdx[today],
          bands: fcDays ? [{ from: dayIdx[today], to: days.length - 1, label: 'Forecast' }] : [],
          tip: i => { const d = days[i], rec = actual[i] !== null, v = rec ? actual[i] : lin[i];
            return `<b>${App.fmtD(d)} ${d.slice(0, 4)}</b><br>${v === null || v === undefined ? (fc[i] !== null ? '' : 'No estimates yet') : rec ? 'Estimate <b>' + App.t(v) + ' t</b>' : '≈ ' + App.t(v) + ' t (between estimates)'}${fc[i] !== null && d > today ? 'Forecast ' + App.t(fc[i]) + ' t' : ''}${dbd[d] ? '<br>' + dbd[d].join('<br>') : ''}`; }
        });
      });
    });
    else {
      const box = App.$('[data-h="silos"]', el);
      App.redraws.push(() => {
        const keys = ['silo1', 'silo2', 'silo3', 'silo4'], ser = {}, sol = {};
        keys.forEach(k => { ser[k] = days.map(() => null); sol[k] = days.map(() => false); });
        recs.forEach(r => { const i = dayIdx[r.date]; if (i === undefined) return; keys.forEach(k => { if (r[k] !== null && r[k] !== undefined) { ser[k][i] = r[k]; sol[k][i] = r.src[k] === 'Radar'; } }); });
        const lin = {}; keys.forEach(k => { lin[k] = interp(ser[k]); });
        C.line(box, {
          dates: days, height: 300, yMax: 32000, yFmt: v => App.t(v), label: 'Each silo quantity over time in tonnes',
          series: keys.map(k => ({ values: ser[k], color: SCOL[k], connect: true, dots: true, solid: sol[k], dotR: days.length > 150 ? 2.5 : 3.5 })),
          hlines: [{ y: st.cap, color: '#14161a', label: 'working limit ' + App.t(st.cap) + ' t' }], todayIndex: dayIdx[today],
          tip: i => `<b>${App.fmtD(days[i])} ${days[i].slice(0, 4)}</b>` + keys.map(k => { const v = ser[k][i] !== null ? ser[k][i] : lin[k][i]; return `<br>${SNAME[k]}: ${v === null || v === undefined ? '–' : (ser[k][i] !== null ? '<b>' + App.t(v) + ' t</b>' : '≈ ' + App.t(v) + ' t')}`; }).join('')
        });
      });
    }

    /* events */
    App.$$('#hRange button', el).forEach(b => b.addEventListener('click', () => { range = b.dataset.r; App.render(); }));
    App.$$('#hMode button', el).forEach(b => b.addEventListener('click', () => { mode = b.dataset.m; App.render(); }));
    const fcBox = App.$('#hFc', el); if (fcBox) fcBox.addEventListener('change', () => { showFc = fcBox.checked; App.render(); });
    App.$('#hArch', el).addEventListener('click', () => App.$('#archiveFile').click());
    App.$$('[data-rmarch]', el).forEach(b => b.addEventListener('click', () => { if (!confirm('Remove ' + b.dataset.rmarch + ' from the history?')) return; App.state.archives = App.state.archives.filter(x => x.source !== b.dataset.rmarch); App.save(); App.render(); }));
    const more = App.$('#hMore', el); if (more) more.addEventListener('click', () => { shown += 30; App.render(); });
    App.$('#hEnter', el).addEventListener('click', () => { App.setTab('grain'); setTimeout(() => { const b = App.$('.board'); if (b) b.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 80); });
    App.$('#hCsv', el).addEventListener('click', () => {
      const lines = ['date,silo1_kg,silo2_kg,silo3_kg,silo4_kg,silos2and3_kg,source'];
      recs.forEach(r => lines.push([r.date, ...['silo1', 'silo2', 'silo3', 'silo4', 'pool'].map(k => r[k] === null || r[k] === undefined ? '' : r[k]), [...new Set(Object.values(r.src))].join('+')].join(',')));
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
      a.download = 'silo-quantities-' + today + '.csv'; a.click(); URL.revokeObjectURL(a.href);
    });
  }

  App.views.history = { render };
})();

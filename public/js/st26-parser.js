/* =========================================================
   ST26 parser: turns the ST_26 workbook into a small JSON object.
   Works in the browser (SheetJS from cdnjs) and in Node (npm "xlsx").
   Only two sheets are read: "Bulk Demand" (schedule, silo estimates, deliveries) and
   "Recipes 1" (silo grain per brew). Nothing else in the workbook is touched.
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ST26Parser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SHEETS = ['Bulk Demand', 'Recipes 1'];
  const CODE_ALIASES = { EAZY: 'EAZY HAZY' };   // schedule name -> recipe name
  const HISTORY_DAYS = 70;                      // keep this much schedule history before the latest estimate (for trends)

  /* ---------- cell helpers (0-based column / row) ---------- */
  function serialToISO(serial) { return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000).toISOString().slice(0, 10); }
  function colName(n) { let s = ''; n += 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  const cell = (ws, c, r) => ws[colName(c) + (r + 1)];
  const val = (ws, c, r) => { const x = cell(ws, c, r); return x ? x.v : undefined; };
  const str = (ws, c, r) => { const v = val(ws, c, r); return v === undefined || v === null ? '' : String(v).trim(); };
  function rangeOf(ws) {
    const m = (ws['!ref'] || 'A1:A1').match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    const toNum = s => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    return { maxC: toNum(m[3]), maxR: parseInt(m[4], 10) - 1 };
  }
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

  /* ---------- Recipes: silo grain per brew (kg) ---------- */
  function parseRecipes(ws) {
    const range = rangeOf(ws), out = {};
    for (let r = 1; r <= range.maxR; r++) {
      const sku = str(ws, 4, r), sys = str(ws, 5, r), ing = str(ws, 6, r), w = val(ws, 7, r);
      if (!sku) continue;
      const system = /dme/i.test(sys) ? 'DME' : /krones/i.test(sys) ? 'Krones' : null;
      if (!system) continue;
      const code = sku.replace(/\s*(DME|KRONES\d*)\s*$/i, '').trim().toUpperCase();
      out[code] = out[code] || {};
      out[code][system] = out[code][system] || { pale: 0, wheat: 0 };   // registered even if it uses no silo grain (e.g. CPT uses Maris Otter)
      if (typeof w !== 'number') continue;
      if (/pale malt silo/i.test(ing)) out[code][system].pale += w;
      if (/wheat malt silo/i.test(ing)) out[code][system].wheat += w;    // bulk wheat only; bagged wheat never touches Silo 4
    }
    return out;
  }

  /* ---------- Bulk Demand: schedule, estimates, deliveries ---------- */
  function findRow(ws, label, maxR, after) {
    const want = norm(label);
    for (let r = after || 0; r <= maxR; r++) if (norm(str(ws, 0, r)) === want) return r;
    return -1;
  }
  function parseBulk(ws) {
    const range = rangeOf(ws);
    const maxLabelRow = Math.min(range.maxR, 150);
    const rows = {
      s1: findRow(ws, 'SILO 1 VOLUME', maxLabelRow), s1Refill: findRow(ws, 'Silo 1 DME Refill', maxLabelRow),
      s2: findRow(ws, 'SILO 2 ADJUSTED VOLUME', maxLabelRow), s3: findRow(ws, 'SILO 3 ADJUSTED VOLUME', maxLabelRow),
      poolRefill: findRow(ws, 'Silo 2+3 KRONES', maxLabelRow), s4: findRow(ws, 'SILO 4 VOLUME', maxLabelRow),
      s4Refill: findRow(ws, 'Silo 4 Wheat Krones Refill', maxLabelRow)
    };
    Object.keys(rows).forEach(k => { if (rows[k] < 0) throw new Error('Could not find the "' + k + '" line in column A of the Bulk Demand sheet. Has a row label been renamed?'); });
    const poPale = findRow(ws, 'expected volume', maxLabelRow, rows.poolRefill + 1);
    const poWheat = findRow(ws, 'expected volume', maxLabelRow, rows.s4Refill + 1);

    // date columns on row 1 (serials for 2023-2064; the sheet also holds placeholder cells that read as 1900)
    const dateCols = [];
    for (let c = 0; c <= range.maxC; c++) { const v = val(ws, c, 0); if (typeof v === 'number' && v > 45000 && v < 60000) dateCols.push({ c, date: serialToISO(v) }); }
    if (!dateCols.length) throw new Error('No dates found on row 1 of the Bulk Demand sheet.');
    dateCols.forEach((d, i) => { d.end = i + 1 < dateCols.length ? dateCols[i + 1].c - 1 : d.c + 2; });

    const numIn = (d, r) => { for (let c = d.c; c <= d.end; c++) { const v = val(ws, c, r); if (typeof v === 'number') return v; } return null; };
    const textIn = (d, r) => { if (r < 0) return ''; for (let c = d.c; c <= d.end; c++) { const t = str(ws, c, r); if (t) return t; } return ''; };

    // silo estimates by date
    const est = {}; // est[date] = { s1, s2, s3, s4 } (null if blank)
    dateCols.forEach(d => {
      const e = { s1: numIn(d, rows.s1), s2: numIn(d, rows.s2), s3: numIn(d, rows.s3), s4: numIn(d, rows.s4) };
      if (e.s1 !== null || e.s2 !== null || e.s3 !== null || e.s4 !== null) est[d.date] = e;
    });
    const estDates = Object.keys(est).sort();
    if (!estDates.length) throw new Error('No silo estimates found on the Bulk Demand sheet.');
    const latestFor = key => { for (let i = estDates.length - 1; i >= 0; i--) if (est[estDates[i]][key] !== null) return estDates[i]; return null; };

    const levels = {}, notes = [];
    const d1 = latestFor('s1'), d4 = latestFor('s4');
    const d23 = estDates.slice().reverse().find(d => est[d].s2 !== null || est[d].s3 !== null);
    if (d1) levels.silo1 = { kg: est[d1].s1, date: d1 };
    if (d4) levels.silo4 = { kg: est[d4].s4, date: d4 };
    if (d23) {
      const e = est[d23]; levels.pool = { silo2: e.s2 === null ? 0 : e.s2, silo3: e.s3 === null ? 0 : e.s3, date: d23 };
      if (e.s2 === null) notes.push('Silo 2 was blank on ' + d23 + ' while Silo 3 had an estimate, so Silo 2 is treated as empty.');
      if (e.s3 === null) notes.push('Silo 3 was blank on ' + d23 + ' while Silo 2 had an estimate, so Silo 3 is treated as empty.');
    }
    if (!levels.silo1 || !levels.silo4 || !levels.pool) throw new Error('Could not find an estimate for every silo on the Bulk Demand sheet.');
    const asOf = { silo1: levels.silo1.date, pool: levels.pool.date, silo4: levels.silo4.date };
    const latestDate = [asOf.silo1, asOf.pool, asOf.silo4].sort().pop();

    // every refill ever typed (for the history tab), and the ones still to come (dated after that group's estimate)
    const deliveryLog = [], deliveries = [];
    dateCols.forEach(d => {
      [['silo1', rows.s1Refill, poPale], ['pool', rows.poolRefill, poPale], ['silo4', rows.s4Refill, poWheat]].forEach(([g, r, pr]) => {
        const q = numIn(d, r);
        if (!(q && q > 0)) return;
        const item = { group: g, date: d.date, qty: Math.round(q), po: textIn(d, pr) };
        deliveryLog.push(item);
        if (d.date > asOf[g]) deliveries.push(item);
      });
    });
    const history = estDates.map(d => ({ date: d, silo1: est[d].s1, silo2: est[d].s2, silo3: est[d].s3, silo4: est[d].s4 }));

    // schedule: brew entries per day, from (latest estimate - 70 days) to the last day that has any brew
    const DME_ROWS = [2, 3, 4, 5], KRONES_ROWS = [7, 8, 9, 10, 11];   // sheet rows 3-6 and 8-12
    const from = addDays(latestDate, -HISTORY_DAYS), brews = [], skipped = [];
    let lastBrew = null;
    dateCols.filter(d => d.date >= from).forEach(d => {
      [['DME', DME_ROWS], ['Krones', KRONES_ROWS]].forEach(([system, rr]) => rr.forEach(r => {
        for (let c = d.c; c <= d.end; c++) {
          const t = str(ws, c, r); if (!t) continue;
          const m = t.match(/^([A-Za-z ]+?)\s*[xX]\s*(\d+)$/);
          if (m) { brews.push({ date: d.date, system, code: m[1].trim().toUpperCase(), brews: parseInt(m[2], 10) }); if (!lastBrew || d.date > lastBrew) lastBrew = d.date; }
          else if (!/^(FV|CCFV|YPP|CIP|DRY|STARTER|TOPUP|TOP UP)/i.test(t) && !/^\d+$/.test(t)) skipped.push({ date: d.date, system, text: t });
        }
      }));
    });
    if (!lastBrew) throw new Error('No brews found in the schedule rows of the Bulk Demand sheet.');
    const dates = dateCols.map(d => d.date).filter(d => d >= from && d <= lastBrew);
    return { levels, asOf, latestDate, notes, deliveries, history, deliveryLog, schedule: { dates, brews, skipped, lastBrew } };
  }

  function parseWorkbook(wb, sourceName) {
    const need = n => { if (!wb.Sheets[n]) throw new Error('Sheet "' + n + '" not found in the workbook.'); return wb.Sheets[n]; };
    const recipes = parseRecipes(need('Recipes 1'));
    const bulk = parseBulk(need('Bulk Demand'));
    const unmapped = {};
    bulk.schedule.brews.forEach(b => {
      const rec = recipes[CODE_ALIASES[b.code] || b.code];
      if (!(rec && rec[b.system])) { const k = b.code + ' @ ' + b.system; unmapped[k] = (unmapped[k] || 0) + b.brews; }
    });
    return { builtAt: new Date().toISOString(), source: sourceName || 'ST_26.xlsx', aliases: CODE_ALIASES, recipes, unmapped, ...bulk };
  }
  // An older stock tool: only the silo estimate history and the refill log are wanted from it.
  function parseArchive(wb, sourceName) {
    if (!wb.Sheets['Bulk Demand']) throw new Error('This workbook has no "Bulk Demand" sheet, so it does not look like a stock tool.');
    const b = parseBulk(wb.Sheets['Bulk Demand']);
    const label = String(sourceName || 'Older stock tool').replace(/\.xls[xm]$/i, '');
    return { source: label, history: b.history.map(h => Object.assign({ from: label }, h)), deliveryLog: b.deliveryLog.map(d => Object.assign({ from: label }, d)) };
  }
  return { SHEETS, parseWorkbook, parseArchive };
});

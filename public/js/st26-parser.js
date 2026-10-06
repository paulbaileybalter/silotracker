/* =========================================================
   ST26 parser: turns the ST_26 workbook into a small JSON file.
   Works in the browser (SheetJS from cdnjs) and in Node (npm "xlsx").
   Only three sheets are read: Demand Summary, Recipes 1, Chemicals.
   Nothing else in the workbook is touched or published.
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ST26Parser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SHEETS = ['Demand Summary', 'Recipes 1', 'Chemicals'];

  // Brew codes in the schedule that are named differently in the recipe list
  const CODE_ALIASES = { EAZY: 'EAZY HAZY' };

  // Supplier rules taken from the notes at the bottom of the Chemicals sheet
  const SUPPLIERS = {
    Sopura: {
      label: 'Sopura',
      rule: 'Delivers Tuesday and Friday. Order by Thursday AM for Tuesday, by Tuesday for Friday.',
      mode: 'cutoff', cutoffs: [{ orderDow: 4, deliverDow: 2, weekOffset: 1 }, { orderDow: 2, deliverDow: 5, weekOffset: 0 }]
    },
    Ecolab: {
      label: 'Ecolab',
      rule: 'Order Friday for the following Friday delivery.',
      mode: 'cutoff', cutoffs: [{ orderDow: 5, deliverDow: 5, weekOffset: 1 }]
    },
    Nalco: {
      label: 'Nalco',
      rule: 'Delivery two weeks after the PO is raised. Order bulk refills at about 30% (caustic) or 45% (acid).',
      mode: 'leadDays', leadDays: 14
    }
  };

  function serialToISO(serial) {
    const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  function colName(n) { // 0-based -> A, B, ... AA
    let s = ''; n += 1;
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  function cell(ws, c, r) { return ws[colName(c) + (r + 1)]; }
  function val(ws, c, r) { const x = cell(ws, c, r); return x ? x.v : undefined; }
  function str(ws, c, r) { const v = val(ws, c, r); return v === undefined || v === null ? '' : String(v).trim(); }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  function rangeOf(ws) {
    const ref = ws['!ref'] || 'A1:A1';
    const m = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    const toNum = s => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    return { maxC: toNum(m[3]), maxR: parseInt(m[4], 10) - 1 };
  }

  /* ---------- Recipes: silo grain per brew (kg) ---------- */
  function parseRecipes(ws) {
    const range = rangeOf(ws);
    const out = {};   // out[CODE][SYSTEM] = { pale, wheat }
    for (let r = 1; r <= range.maxR; r++) {
      const sku = str(ws, 4, r), sys = str(ws, 5, r), ing = str(ws, 6, r), w = val(ws, 7, r);
      if (!sku) continue;
      const sysName = /dme/i.test(sys) ? 'DME' : /krones/i.test(sys) ? 'Krones' : null;
      if (sysName) {   // every recipe that exists is registered, even if it uses no silo grain (e.g. CPT uses Maris Otter)
        const c0 = sku.replace(/\s*(DME|KRONES\d*)\s*$/i, '').trim().toUpperCase();
        out[c0] = out[c0] || {};
        out[c0][sysName] = out[c0][sysName] || { pale: 0, wheat: 0 };
      }
      if (typeof w !== 'number') continue;
      const isPale = /pale malt silo/i.test(ing);
      const isWheat = /wheat malt silo/i.test(ing);   // bulk wheat only; bagged wheat never touches Silo 4
      if (!isPale && !isWheat) continue;
      const system = /dme/i.test(sys) ? 'DME' : /krones/i.test(sys) ? 'Krones' : null;
      if (!system) continue;
      const code = sku.replace(/\s*(DME|KRONES\d*)\s*$/i, '').trim().toUpperCase();
      out[code] = out[code] || {};
      out[code][system] = out[code][system] || { pale: 0, wheat: 0 };
      if (isPale) out[code][system].pale += w;
      if (isWheat) out[code][system].wheat += w;
    }
    return out;
  }

  /* ---------- Schedule: brews per day ---------- */
  const DME_ROWS = [2, 3, 4, 5];         // sheet rows 3-6
  const KRONES_ROWS = [7, 8, 9, 10, 11]; // sheet rows 8-12
  function parseSchedule(ws) {
    const range = rangeOf(ws);
    const dateCols = [];
    for (let c = 11; c <= range.maxC; c++) {          // from column L onwards
      const v = val(ws, c, 0);
      if (typeof v === 'number' && v > 45000 && v < 60000) dateCols.push({ c, date: serialToISO(v) });
    }
    const brews = [], skipped = [];
    dateCols.forEach((d, i) => {
      const end = i + 1 < dateCols.length ? dateCols[i + 1].c - 1 : d.c + 2;
      [['DME', DME_ROWS], ['Krones', KRONES_ROWS]].forEach(([system, rows]) => {
        rows.forEach(r => {
          for (let c = d.c; c <= end; c++) {
            const t = str(ws, c, r);
            if (!t) continue;
            const m = t.match(/^([A-Za-z ]+?)\s*[xX]\s*(\d+)$/);
            if (m) brews.push({ date: d.date, system, code: m[1].trim().toUpperCase(), brews: parseInt(m[2], 10) });
            else if (!/^(FV|CCFV|YPP|CIP|DRY|STARTER|TOPUP|TOP UP)/i.test(t) && !/^\d+$/.test(t)) skipped.push({ date: d.date, system, text: t });
          }
        });
      });
    });
    return { dates: dateCols.map(d => d.date), brews, skipped };
  }

  /* ---------- Chemicals ---------- */
  function parseChemicals(ws) {
    const list = [];
    for (let r = 1; r < 22; r++) {
      const a = str(ws, 0, r), b = str(ws, 1, r), c = str(ws, 2, r), desc = str(ws, 4, r);
      const minRaw = val(ws, 5, r), countRaw = val(ws, 6, r);
      if (minRaw === undefined && countRaw === undefined) continue;
      const discontinued = /discontinued/i.test(a);
      const name = c || b || (discontinued ? '' : a);
      if (!name) continue;
      const supplier = c ? 'Ecolab' : b ? 'Nalco' : 'Sopura';
      const min = parseFloat(minRaw), count = parseFloat(countRaw);
      const f = String((cell(ws, 7, r) || {}).f || '').replace(/\s/g, '');
      let rule = 'topup';
      if (/\+1\)?$/.test(f)) rule = 'topup+1';
      else if (/<F\d+,1,0\)/i.test(f)) rule = 'one';
      const fraction = supplier === 'Nalco' && min > 0 && min < 1;
      const notes = [];
      if (rule === 'one' && count > 5 * Math.max(min, 1)) notes.push('Min stock and count look like different units in ST26. Check before relying on this line.');
      list.push({
        id: slug(name), name, description: desc, supplier, min: isNaN(min) ? 0 : min,
        seedCount: isNaN(count) ? 0 : count, rule, unit: fraction ? 'tank%' : 'units',
        storage: str(ws, 8, r), discontinued, notes
      });
    }
    return list;
  }

  function parseWorkbook(wb, sourceName) {
    const need = n => { if (!wb.Sheets[n]) throw new Error('Sheet "' + n + '" not found in the workbook.'); return wb.Sheets[n]; };
    const recipes = parseRecipes(need('Recipes 1'));
    const schedule = parseSchedule(need('Demand Summary'));
    const chemicals = parseChemicals(need('Chemicals'));
    const unmapped = {};
    schedule.brews.forEach(b => {
      const code = CODE_ALIASES[b.code] || b.code;
      const rec = recipes[code];
      if (!(rec && rec[b.system])) { const k = b.code + ' @ ' + b.system; unmapped[k] = (unmapped[k] || 0) + b.brews; }
    });
    return {
      builtAt: new Date().toISOString(), source: sourceName || 'ST_26.xlsx',
      aliases: CODE_ALIASES, recipes, schedule, chemicals, suppliers: SUPPLIERS, unmapped
    };
  }

  return { SHEETS, parseWorkbook, SUPPLIERS };
});

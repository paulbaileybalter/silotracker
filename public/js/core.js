/* =========================================================
   CORE: state, saving/sync, ST26 data, helpers shared by all views.
   ========================================================= */
window.App = (function () {
  'use strict';
  const F = Forecast;
  const KEY = 'balter-silo-tracker-v1';
  const App = { F, views: {}, redraws: [] };

  /* ---------- helpers ---------- */
  App.todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  App.t = kg => (kg / 1000).toFixed(1).replace(/\.0$/, '');                       // 24000 -> "24"
  App.tt = kg => App.t(kg) + ' t';
  App.esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  App.uid = () => Math.random().toString(36).slice(2, 9);
  App.$ = (sel, el) => (el || document).querySelector(sel);
  App.$$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  App.num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
  App.toast = msg => { const t = App.$('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(App._tt); App._tt = setTimeout(() => t.classList.remove('show'), 2600); };
  App.fmtD = Charts.fmtLong; App.fmtS = Charts.fmtShort;
  App.daysAgo = d => F.diffDays(d, App.todayISO());

  /* ---------- state ---------- */
  const blank = () => ({ v: 1, updatedAt: 0, readings: [], deliveries: [], settings: {}, st26: null, seeded: false, lastImport: null });
  const clean = s => { const o = Object.assign(blank(), s); delete o.stocktakes; delete o.chem; return o; };   // chemical entries from the earlier version are dropped
  App.state = blank();
  function loadLocal() { try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v === 1) App.state = clean(s); } catch (e) { /* first run */ } }

  /* ---------- sync ---------- */
  let remoteOk = null, saveTimer = null;
  function setSync(kind, text) { const d = App.$('#syncDot'); if (!d) return; d.className = 'dot ' + kind; App.$('#syncText').textContent = text; }
  App.save = function () {
    App.state.updatedAt = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(App.state)); } catch (e) { setSync('err', 'Could not save on this device'); return; }
    if (remoteOk === false) { setSync('', 'Saved on this device only'); return; }
    setSync('busy', 'Saving…'); clearTimeout(saveTimer); saveTimer = setTimeout(pushRemote, 700);
  };
  async function pushRemote() {
    try {
      const r = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(App.state), credentials: 'same-origin' });
      if (r.status === 404 || r.status === 501) { remoteOk = false; setSync('', 'Saved on this device only'); return; }
      if (r.status === 409) { await pullRemote(true); return; }
      if (!r.ok) throw new Error(r.status);
      remoteOk = true; setSync('ok', 'Saved · synced');
    } catch (e) { setSync('err', 'Saved here · sync failed'); }
  }
  async function pullRemote(force) {
    try {
      const r = await fetch('/api/state', { credentials: 'same-origin', cache: 'no-store' });
      if (r.status === 404 || r.status === 501) { remoteOk = false; setSync('', 'Saved on this device only'); return false; }
      if (!r.ok) throw new Error(r.status);
      remoteOk = true;
      const j = await r.json();
      if (j && j.state && (force || j.state.updatedAt > App.state.updatedAt)) {
        App.state = clean(j.state);
        localStorage.setItem(KEY, JSON.stringify(App.state));
        setSync('ok', 'Saved · synced'); return true;
      }
      setSync('ok', 'Saved · synced');
      if (j && !j.state && App.state.updatedAt) pushRemote();
    } catch (e) { setSync('err', 'Offline · using this device'); }
    return false;
  }
  App.syncNow = async function () { const changed = await pullRemote(false); if (changed) App.render(); App.toast(changed ? 'Updated from another device' : 'Already up to date'); };

  /* ---------- ST26 data ---------- */
  let bundled = null;
  App.data = function () {
    const s = App.state.st26;
    const d = s && bundled && s.builtAt > bundled.builtAt ? s : (s && !bundled ? s : bundled);
    return d;
  };
  App.settings = () => F.mergeSettings(App.state.settings);

  async function loadBundled() {
    const r = await fetch('data/st26.json', { cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok) throw new Error('Could not load data/st26.json (' + r.status + ')');
    bundled = await r.json();
  }

  /* ---------- importing an updated ST_26.xlsx (parsed in the browser, never uploaded) ---------- */
  function loadXLSX() {
    return new Promise((res, rej) => {
      if (window.XLSX) return res();
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = res; s.onerror = () => rej(new Error('Could not load the spreadsheet reader. Check your connection.'));
      document.head.appendChild(s);
    });
  }
  // Put the estimates and deliveries from a parsed ST26 into the site's own records.
  App.applyST26 = function (out) {
    const S = App.state, L = out.levels, date = out.latestDate;
    S.readings = S.readings.filter(x => x.date !== date);
    S.readings.push({ id: App.uid(), date, silo1: L.silo1.kg, silo2: L.pool.silo2, silo3: L.pool.silo3, silo4: L.silo4.kg,
      source: 'estimate', from: 'st26', asOf: out.asOf, savedAt: new Date().toISOString() });
    // ST26 is the master for deliveries: replace earlier ST26 deliveries, and drop hand-entered ones it now covers
    S.deliveries = S.deliveries.filter(d => d.source !== 'st26' && !out.deliveries.some(n => n.group === d.group && n.date === d.date));
    out.deliveries.forEach(n => S.deliveries.push({ id: App.uid(), group: n.group, date: n.date, qty: n.qty, po: n.po || '', source: 'st26', status: 'booked' }));
    S.seeded = true;
    S.lastImport = { at: new Date().toISOString(), file: out.source, estimatesDate: date, deliveries: out.deliveries.length, scheduleTo: out.schedule.lastBrew, notes: out.notes || [] };
  };
  App.importST26 = async function (file) {
    if (!file) return;
    if (!/\.xls[xm]$/i.test(file.name)) return App.toast('Choose the ST26 Excel file (.xlsx)');
    App.toast('Reading ' + file.name + '. This takes a few seconds…');
    try {
      await loadXLSX();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', sheets: ST26Parser.SHEETS, cellFormula: false });
      const out = ST26Parser.parseWorkbook(wb, file.name);
      App.state.st26 = out; App.applyST26(out); App.save(); App.render();
      App.toast('ST26 loaded: estimates as of ' + App.fmtS(out.latestDate) + ', ' + out.deliveries.length + ' deliveries, schedule to ' + App.fmtS(out.schedule.lastBrew));
    } catch (e) { App.toast('Upload failed: ' + e.message); console.error(e); }
  };

  /* ---------- tabs / render ---------- */
  let tab = 'grain';
  App.render = function () {
    App.redraws = [];
    ['grain', 'history', 'settings'].forEach(t => {
      const sec = App.$('#tab-' + t), on = t === tab;
      sec.hidden = !on; App.$('[data-tab="' + t + '"]').setAttribute('aria-selected', on);
    });
    if (!App.data()) return;
    const v = App.views[tab]; if (v) v.render(App.$('#tab-' + tab));
    App.drawCharts();
  };
  App.drawCharts = () => App.redraws.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  App.setTab = t => { tab = t; location.hash = t; App.render(); window.scrollTo({ top: 0 }); };

  App.init = async function () {
    loadLocal();
    const h = location.hash.replace('#', ''); if (['grain', 'history', 'settings'].includes(h)) tab = h;
    App.$$('.tab').forEach(b => b.addEventListener('click', () => App.setTab(b.dataset.tab)));
    window.addEventListener('hashchange', () => { const x = location.hash.replace('#', ''); if (['grain', 'history', 'settings'].includes(x) && x !== tab) { tab = x; App.render(); } });
    App.$('#syncNow').addEventListener('click', App.syncNow);
    App.$('#importBtn').addEventListener('click', () => App.$('#importFile').click());
    App.$('#importFile').addEventListener('change', e => { App.importST26(e.target.files[0]); e.target.value = ''; });
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(App.drawCharts, 150); });
    setSync('busy', 'Loading…');
    try { await loadBundled(); } catch (e) { App.$('#tab-grain').innerHTML = '<div class="note note--bad">' + App.esc(e.message) + '</div>'; return; }
    await pullRemote(false);
    if (remoteOk === false) setSync('', 'Saved on this device only');
    if (!App.state.seeded && !App.state.readings.length && bundled && bundled.levels) { App.applyST26(bundled); App.save(); }   // first visit: start from the ST26 that shipped with the site
    App.render();
  };
  return App;
})();

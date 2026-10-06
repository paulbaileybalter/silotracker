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
  const blank = () => ({ v: 1, updatedAt: 0, readings: [], deliveries: [], stocktakes: [], settings: {}, chem: {}, st26: null });
  App.state = blank();
  function loadLocal() { try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v === 1) App.state = Object.assign(blank(), s); } catch (e) { /* first run */ } }

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
        App.state = Object.assign(blank(), j.state);
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
  App.chemicals = function () {         // ST26 list + the user's own edits
    const d = App.data(); if (!d) return [];
    return d.chemicals.map(c => {
      const o = App.state.chem[c.id] || {};
      return Object.assign({}, c, { min: o.min !== undefined ? o.min : c.min, supplier: o.supplier || c.supplier, active: o.active !== undefined ? o.active : !c.discontinued });
    });
  };
  App.suppliers = () => { const d = App.data(); return d ? d.suppliers : {}; };
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
  App.importST26 = async function (file) {
    if (!file) return;
    App.toast('Reading ' + file.name + '…');
    try {
      await loadXLSX();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', sheets: ST26Parser.SHEETS, cellFormula: true });
      const out = ST26Parser.parseWorkbook(wb, file.name);
      if (!out.schedule.dates.length) throw new Error('No schedule dates found on the Demand Summary sheet.');
      if (!out.chemicals.length) throw new Error('No chemicals found on the Chemicals sheet.');
      App.state.st26 = out; App.save(); App.render();
      App.toast('ST26 updated: ' + out.schedule.dates.length + ' schedule days, ' + out.chemicals.length + ' chemicals');
    } catch (e) { App.toast('Import failed: ' + e.message); console.error(e); }
  };

  /* ---------- tabs / render ---------- */
  let tab = 'grain';
  App.render = function () {
    App.redraws = [];
    ['grain', 'chem', 'settings'].forEach(t => {
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
    const h = location.hash.replace('#', ''); if (['grain', 'chem', 'settings'].includes(h)) tab = h;
    App.$$('.tab').forEach(b => b.addEventListener('click', () => App.setTab(b.dataset.tab)));
    window.addEventListener('hashchange', () => { const x = location.hash.replace('#', ''); if (['grain', 'chem', 'settings'].includes(x) && x !== tab) { tab = x; App.render(); } });
    App.$('#syncNow').addEventListener('click', App.syncNow);
    App.$('#importBtn').addEventListener('click', () => App.$('#importFile').click());
    App.$('#importFile').addEventListener('change', e => { App.importST26(e.target.files[0]); e.target.value = ''; });
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(App.drawCharts, 150); });
    setSync('busy', 'Loading…');
    try { await loadBundled(); } catch (e) { App.$('#tab-grain').innerHTML = '<div class="note note--bad">' + App.esc(e.message) + '</div>'; return; }
    await pullRemote(false);
    if (remoteOk === false) setSync('', 'Saved on this device only');
    App.render();
  };
  return App;
})();

/* =========================================================
   SETTINGS VIEW: silo rules, chemical minimums, ST26 data, backups.
   ========================================================= */
(function () {
  'use strict';
  const App = window.App, F = App.F, esc = App.esc;
  const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function dayBoxes(name, sel) {
    return [1, 2, 3, 4, 5, 6, 0].map(d => `<label style="display:inline-flex;gap:4px;align-items:center;margin-right:10px;font-weight:500"><input type="checkbox" data-days="${name}" value="${d}" ${sel.includes(d) ? 'checked' : ''}>${DN[d]}</label>`).join('');
  }

  function render(el) {
    const st = App.settings(), d = App.data(), sups = App.suppliers(), chems = App.chemicals();
    const t = kg => App.t(kg);
    let h = `<section class="card" data-acc="mint"><div class="card__h"><div><h2>Silo and delivery rules</h2><p class="sub">These drive every grain forecast. Tonnes unless stated.</p></div><button class="btn btn--primary" id="saveSet" type="button">Save settings</button></div>
      <div class="grid2">
        <label class="field">Working capacity per silo (t)<input type="number" step="0.5" data-s="cap" value="${t(st.cap)}"></label>
        <label class="field">Pale malt delivery size (t)<input type="number" step="0.5" data-s="paleDelivery" value="${t(st.paleDelivery)}"></label>
        <label class="field">Wheat malt delivery size (t)<input type="number" step="0.5" data-s="wheatDelivery" value="${t(st.wheatDelivery)}"></label>
        <label class="field">Pale malt notice (hours)<input type="number" step="1" data-s="paleNoticeHours" value="${st.paleNoticeDays * 24}"></label>
        <label class="field">Wheat malt notice (days)<input type="number" step="1" data-s="wheatNoticeDays" value="${st.wheatNoticeDays}"></label>
        <label class="field">Reserve: Silo 1 (t)<input type="number" step="0.5" data-r="silo1" value="${t(st.reserve.silo1)}"></label>
        <label class="field">Reserve: Silos 2 + 3 (t)<input type="number" step="0.5" data-r="pool" value="${t(st.reserve.pool)}"></label>
        <label class="field">Reserve: Silo 4 (t)<input type="number" step="0.5" data-r="silo4" value="${t(st.reserve.silo4)}"></label>
        <label class="field">Hand estimate error, ± per silo (t)<input type="number" step="0.5" data-s="uncertaintyKg" value="${t(st.uncertaintyKg)}"></label>
        <label class="field">Radar error, ± per silo (t)<input type="number" step="0.1" data-s="radarUncertaintyKg" value="${t(st.radarUncertaintyKg)}"></label>
        <label class="field">Forecast length (days)<input type="number" step="7" data-s="horizonDays" value="${st.horizonDays}"></label>
        <label class="field">Use beyond schedule (% of schedule average)<input type="number" step="5" data-s="unscheduledFactor" value="${Math.round(st.unscheduledFactor * 100)}"></label>
      </div>
      <div style="margin-top:14px"><div class="strong" style="font-size:12.5px;margin-bottom:4px">Pale malt delivery days</div>${dayBoxes('pale', st.paleDays)}</div>
      <div style="margin-top:10px"><div class="strong" style="font-size:12.5px;margin-bottom:4px">Wheat malt delivery days</div>${dayBoxes('wheat', st.wheatDays)}</div>
      <p class="faint" style="font-size:12px;margin:12px 0 0">The reserve is the lowest level you're comfortable letting a silo reach before a truck arrives. Silos hold 30 t physically but are treated as ${t(st.cap)} t.</p></section>`;

    h += `<section class="card" data-acc="purple"><div class="card__h"><div><h2>Chemical minimums and suppliers</h2><p class="sub">Starts from the ST26 Chemicals sheet. Changes here are kept on top of ST26, so re-importing the workbook won't undo them.</p></div></div>
      <div class="tscroll"><table><thead><tr><th>Chemical</th><th>Supplier</th><th class="num">Min stock</th><th>In stocktake</th></tr></thead><tbody>${chems.map(c => `<tr data-cid="${c.id}"><td><div class="chem-name">${esc(c.name)}</div><div class="chem-desc">${esc(c.description || '')}${c.discontinued ? ' · marked discontinued in ST26' : ''}</div></td>
        <td><select data-c="supplier">${Object.keys(sups).map(s => `<option ${s === c.supplier ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td class="num"><input type="number" step="any" data-c="min" value="${c.unit === 'tank%' ? Math.round(c.min * 100) : c.min}" style="width:80px">${c.unit === 'tank%' ? ' %' : ''}</td>
        <td><label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" data-c="active" ${c.active ? 'checked' : ''}> Include</label></td></tr>`).join('')}</tbody></table></div></section>`;

    const dates = d.schedule.dates, un = Object.keys(d.unmapped || {});
    h += `<section class="card" data-acc="sky"><div class="card__h"><div><h2>ST26 data</h2><p class="sub">The site reads three sheets from ST26: the brewing schedule (Demand Summary), recipes (Recipes 1) and chemicals (Chemicals). Nothing else from the workbook is used or stored.</p></div>
      <button class="btn btn--primary" id="importBtn2" type="button">Import updated ST_26.xlsx</button></div>
      <div class="grid2"><div class="tcard" style="cursor:default"><b>Source file</b><div>${esc(d.source)}</div><div class="faint" style="font-size:12px">Read ${new Date(d.builtAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}${App.state.st26 && d === App.state.st26 ? ' (imported in the browser)' : ' (bundled with the site)'}</div></div>
      <div class="tcard" style="cursor:default"><b>Schedule covers</b><div>${App.fmtD(dates[0])} to ${App.fmtD(dates[dates.length - 1])}</div><div class="faint" style="font-size:12px">${d.schedule.brews.length} brew entries</div></div>
      <div class="tcard" style="cursor:default"><b>Recipes with silo grain</b><div>${Object.keys(d.recipes).length} brands</div><div class="faint" style="font-size:12px">${un.length ? un.length + ' scheduled brews have no recipe' : 'All scheduled brews matched'}</div></div></div>
      <p class="faint" style="font-size:12px;margin:12px 0 0">Importing runs in your browser; the workbook isn't uploaded anywhere. The new data is saved with your entries and synced to your other devices.</p>
      <div class="row" style="margin-top:12px">${App.state.st26 ? '<button class="btn" id="resetSt" type="button">Go back to the bundled ST26 data</button>' : ''}</div></section>`;

    h += `<section class="card" data-acc="ink"><div class="card__h"><div><h2>Backup</h2><p class="sub">Your silo estimates, bookings, stocktakes and settings, as a file.</p></div></div>
      <div class="row"><button class="btn" id="exportBtn" type="button">Download backup</button><button class="btn" id="restoreBtn" type="button">Restore from backup</button><input type="file" id="restoreFile" accept=".json,application/json" hidden>
      <button class="btn btn--danger" id="wipeBtn" type="button">Clear all entries</button></div></section>`;
    el.innerHTML = h;
    bind(el);
  }

  function bind(el) {
    const S = App.state;
    App.$('#importBtn2', el).addEventListener('click', () => App.$('#importFile').click());
    App.$('#saveSet', el).addEventListener('click', () => {
      const s = {}, num = (k, sel) => { const v = App.num(App.$(sel, el).value); return v; };
      const g = k => App.num(App.$('[data-s="' + k + '"]', el).value);
      const vals = { cap: g('cap'), paleDelivery: g('paleDelivery'), wheatDelivery: g('wheatDelivery'), uncertaintyKg: g('uncertaintyKg'), radarUncertaintyKg: g('radarUncertaintyKg') };
      for (const k in vals) { if (vals[k] === null || vals[k] < 0) return App.toast('Check the number in "' + k + '"'); s[k] = Math.round(vals[k] * 1000); }
      const ph = g('paleNoticeHours'), wd = g('wheatNoticeDays'), hz = g('horizonDays'), uf = g('unscheduledFactor');
      if ([ph, wd, hz, uf].some(v => v === null || v < 0) || hz < 7) return App.toast('Check the notice, forecast length and use percentage');
      s.paleNoticeDays = Math.ceil(ph / 24); s.wheatNoticeDays = Math.round(wd); s.horizonDays = Math.round(hz); s.unscheduledFactor = uf / 100;
      s.reserve = {}; ['silo1', 'pool', 'silo4'].forEach(k => { const v = App.num(App.$('[data-r="' + k + '"]', el).value); s.reserve[k] = Math.round((v || 0) * 1000); });
      s.paleDays = App.$$('[data-days=pale]:checked', el).map(x => +x.value); s.wheatDays = App.$$('[data-days=wheat]:checked', el).map(x => +x.value);
      if (!s.paleDays.length || !s.wheatDays.length) return App.toast('Pick at least one delivery day for each grain');
      S.settings = s; App.save(); App.toast('Settings saved');
    });
    App.$$('tr[data-cid]', el).forEach(row => {
      const id = row.dataset.cid, chem = App.chemicals().find(c => c.id === id);
      App.$$('[data-c]', row).forEach(inp => inp.addEventListener('change', () => {
        const o = S.chem[id] = S.chem[id] || {}, k = inp.dataset.c;
        if (k === 'min') { const v = App.num(inp.value); if (v === null || v < 0) return App.toast('Enter a number'); o.min = chem.unit === 'tank%' ? v / 100 : v; }
        if (k === 'supplier') o.supplier = inp.value;
        if (k === 'active') o.active = inp.checked;
        App.save(); App.toast('Saved');
      }));
    });
    const rs = App.$('#resetSt', el); if (rs) rs.addEventListener('click', () => { if (!confirm('Discard the imported data and use the bundled ST26 data?')) return; S.st26 = null; App.save(); App.render(); });
    App.$('#exportBtn', el).addEventListener('click', () => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }));
      a.download = 'balter-silo-backup-' + App.todayISO() + '.json'; a.click(); URL.revokeObjectURL(a.href);
    });
    App.$('#restoreBtn', el).addEventListener('click', () => App.$('#restoreFile', el).click());
    App.$('#restoreFile', el).addEventListener('change', async e => {
      try { const j = JSON.parse(await e.target.files[0].text()); if (j.v !== 1) throw new Error('Not a backup from this site'); if (!confirm('Replace everything on this site with the backup?')) return; App.state = Object.assign(App.state, j); App.save(); App.render(); App.toast('Backup restored'); }
      catch (err) { App.toast('Restore failed: ' + err.message); }
    });
    App.$('#wipeBtn', el).addEventListener('click', () => {
      if (!confirm('Delete all silo estimates, bookings, stocktakes and settings? This cannot be undone.')) return;
      Object.assign(S, { readings: [], deliveries: [], stocktakes: [], settings: {}, chem: {}, st26: null }); App.save(); App.render(); App.toast('Cleared');
    });
  }
  App.views.settings = { render };
})();

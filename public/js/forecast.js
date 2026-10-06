/* =========================================================
   Forecast + ordering logic (pure functions, no DOM).
   Dates are ISO strings (YYYY-MM-DD) handled in UTC so time zones never shift a day.
   All grain weights are kilograms.
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Forecast = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- date helpers ---------- */
  const DAY = 86400000;
  const ms = iso => Date.parse(iso + 'T00:00:00Z');
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const addDays = (d, n) => iso(ms(d) + n * DAY);
  const diffDays = (a, b) => Math.round((ms(b) - ms(a)) / DAY);   // b - a
  const dow = d => new Date(ms(d)).getUTCDay();                    // 0 = Sunday
  const eachDay = (from, to) => { const out = []; for (let d = from; ms(d) <= ms(to); d = addDays(d, 1)) out.push(d); return out; };

  /* ---------- settings ---------- */
  const DEFAULT_SETTINGS = {
    cap: 28000,                // working capacity per silo (physical max is 30 t)
    paleDelivery: 24000,
    wheatDelivery: 26000,
    paleNoticeDays: 3,         // 72 hours
    wheatNoticeDays: 7,
    paleDays: [2, 3, 4, 5],    // Tue-Fri
    wheatDays: [4],            // Thursday only
    reserve: { silo1: 1000, pool: 2000, silo4: 1000 },   // soft minimum level (kg) before a delivery should land
    horizonDays: 56,
    unscheduledFactor: 1,      // multiplier on the average daily use beyond the schedule
    uncertaintyKg: 3000,       // +/- error on a hand estimate (sight glass + knocking the shell), per silo
    radarUncertaintyKg: 300,   // +/- error once radar level sensors are fitted
    planBasis: 'cautious'      // 'cautious' plans on the LOW end of the estimate, 'best' on the best guess
  };

  const GROUPS = {
    silo1: { id: 'silo1', name: 'Silo 1', feeds: 'DME brewhouse', grain: 'pale', system: 'DME', silos: ['silo1'] },
    pool:  { id: 'pool',  name: 'Silos 2 + 3', feeds: 'Krones brewhouse', grain: 'pale', system: 'Krones', silos: ['silo2', 'silo3'] },
    silo4: { id: 'silo4', name: 'Silo 4', feeds: 'Krones brewhouse', grain: 'wheat', system: 'Krones', silos: ['silo4'] }
  };
  const GROUP_ORDER = ['silo1', 'pool', 'silo4'];

  function mergeSettings(s) {
    const m = Object.assign({}, DEFAULT_SETTINGS, s || {});
    m.reserve = Object.assign({}, DEFAULT_SETTINGS.reserve, (s && s.reserve) || {});
    return m;
  }
  const groupCap = (g, st) => st.cap * GROUPS[g].silos.length;
  const groupDelivery = (g, st) => GROUPS[g].grain === 'wheat' ? st.wheatDelivery : st.paleDelivery;
  const groupNotice = (g, st) => GROUPS[g].grain === 'wheat' ? st.wheatNoticeDays : st.paleNoticeDays;
  const groupDays = (g, st) => GROUPS[g].grain === 'wheat' ? st.wheatDays : st.paleDays;

  /* ---------- daily grain use from the ST26 schedule ---------- */
  function recipeFor(data, code, system) {
    const key = (data.aliases && data.aliases[code]) || code;
    const rec = data.recipes[key];
    if (!rec) return { pale: 0, wheat: 0, how: 'none' };
    if (rec[system]) return Object.assign({ how: 'exact' }, rec[system]);
    const other = system === 'DME' ? 'Krones' : 'DME';
    if (rec[other]) return Object.assign({ how: 'borrowed' }, rec[other]);   // brewed on the other kit than the recipe list expects
    return { pale: 0, wheat: 0, how: 'none' };
  }

  function buildUsage(data, st) {
    const byDate = {};
    (data.schedule.dates || []).forEach(d => { byDate[d] = { silo1: 0, pool: 0, silo4: 0 }; });
    const assumptions = {};
    (data.schedule.brews || []).forEach(b => {
      const r = recipeFor(data, b.code, b.system);
      if (r.how !== 'exact') { const k = b.code + ' on ' + b.system; assumptions[k] = { how: r.how, brews: ((assumptions[k] || {}).brews || 0) + b.brews, kgPerBrew: r.pale }; }
      const day = byDate[b.date]; if (!day) return;
      if (b.system === 'DME') day.silo1 += b.brews * r.pale;
      else { day.pool += b.brews * r.pale; day.silo4 += b.brews * r.wheat; }
    });
    const dates = (data.schedule.dates || []).slice().sort();
    const recent = dates.slice(-28);                       // baseline for days past the schedule = the latest 4 weeks of it
    const avg = { silo1: 0, pool: 0, silo4: 0 };
    if (recent.length) GROUP_ORDER.forEach(g => { avg[g] = recent.reduce((s, d) => s + byDate[d][g], 0) / recent.length; });
    const first = dates[0], last = dates[dates.length - 1];
    function usage(date, g) {
      if (byDate[date]) return byDate[date][g];
      return avg[g] * st.unscheduledFactor;                        // beyond the schedule: use the average of scheduled days
    }
    const isScheduled = date => !!byDate[date];
    return { usage, isScheduled, avg, first, last, byDate, assumptions };
  }

  /* ---------- projection ---------- */
  // Level is the start-of-day level BEFORE that day's delivery lands (so "pre" is what a truck would find).
  function project(g, readingKg, readingISO, endISO, deliveries, U) {
    const rows = []; let level = readingKg;
    const dels = {};
    deliveries.forEach(d => { if (d.group === g && ms(d.date) >= ms(readingISO)) dels[d.date] = (dels[d.date] || []).concat(d); });
    eachDay(readingISO, endISO).forEach(date => {
      const pre = level;
      const arriving = (dels[date] || []).reduce((s, d) => s + d.qty, 0);
      level += arriving;
      const use = U.usage(date, g);
      const end = level - use;
      rows.push({ date, pre, delivered: arriving, use, end, scheduled: U.isScheduled(date) });
      level = end;
    });
    return rows;
  }

  /* ---------- delivery planning ---------- */
  function plan(opts) {
    const { g, readingKg, readingISO, todayISO, booked, U, st } = opts;
    const unc = opts.uncKg || 0, offset = 0;   // the plan is built on the best guess; uncertainty is reported as risk flags
    const cap = groupCap(g, st), qty = groupDelivery(g, st), notice = groupNotice(g, st), days = groupDays(g, st);
    const reserve = st.reserve[g];
    const endISO = addDays(todayISO, st.horizonDays);
    const earliest = addDays(todayISO, notice);
    const deliveries = booked.filter(d => d.group === g).map(d => Object.assign({ kind: 'booked' }, d));
    const recs = [];
    let searchFrom = todayISO;

    for (let iter = 0; iter < 8; iter++) {
      const proj = project(g, readingKg + offset, readingISO, endISO, deliveries, U);
      const rowOf = {}; proj.forEach(r => { rowOf[r.date] = r; });
      const breach = proj.find(r => ms(r.date) >= ms(searchFrom) && r.pre < reserve);
      if (!breach) break;
      const runout = proj.find(r => ms(r.date) >= ms(todayISO) && r.pre < 0);
      const cands = eachDay(maxD(earliest, addDays(searchFrom, 0)), endISO).filter(d => days.indexOf(dow(d)) >= 0 && rowOf[d]);
      const info = c => ({ date: c, pre: rowOf[c].pre });
      const feasible = cands.map(info).filter(x => x.pre >= 0);
      const fits = x => x.pre + qty <= cap + 1;
      let pick = null, type = null;
      const ideal = feasible.filter(x => x.pre >= reserve && fits(x)).pop();
      if (ideal) { pick = ideal; type = 'ok'; }
      else {
        const dip = feasible.filter(fits)[0];
        if (dip) { pick = dip; type = 'reserve'; }
        else if (feasible.length) { pick = feasible[feasible.length - 1]; type = 'overflow'; }
        else if (cands.length) { pick = info(cands[0]); type = 'late'; }
      }
      if (!pick) { recs.push({ group: g, type: 'none', breach: breach.date, qty, cap, reserve }); break; }
      let orderBy = addDays(pick.date, -notice);
      while (dow(orderBy) === 0 || dow(orderBy) === 6) orderBy = addDays(orderBy, -1);   // nobody takes orders at the weekend: go back to Friday
      const rec = {
        group: g, kind: 'recommended', type, date: pick.date, qty, pre: pick.pre,
        orderBy, breach: breach.date,
        runout: runout ? runout.date : null,
        maxPre: cap - qty, cap, reserve,
        fitsKg: Math.max(0, Math.min(qty, cap - pick.pre)),
        shortKg: pick.pre < 0 ? -pick.pre : 0,
        preBest: pick.pre,                          // best-guess level when the truck arrives
        fitRisk: pick.pre + unc + qty > cap + 1,    // could the silo be fuller than it looks, so the load won't fit?
        lowRisk: false                              // filled in below once the run-out window is known
      };
      recs.push(rec); deliveries.push(rec);
      searchFrom = addDays(pick.date, 1);
    }
    const proj = project(g, readingKg + offset, readingISO, endISO, deliveries, U);
    // Run-out window: earliest (low estimate) to latest (high estimate), given deliveries already in the plan
    const firstEmpty = kg => { const r = project(g, kg, readingISO, endISO, deliveries, U).find(x => ms(x.date) >= ms(todayISO) && x.pre < 0); return r ? r.date : null; };
    const runoutWindow = { early: firstEmpty(readingKg - unc), best: firstEmpty(readingKg), late: firstEmpty(readingKg + unc) };
    recs.forEach(r => { if (r.date) r.lowRisk = !!(runoutWindow.early && ms(runoutWindow.early) < ms(r.date)); });   // empty before the truck if the silo is at the low end
    return { group: g, recs, proj, deliveries, cap, reserve, qty, notice, earliest, endISO, uncKg: unc, runoutWindow };
  }
  const maxD = (a, b) => ms(a) >= ms(b) ? a : b;

  function planAll(state, data, todayISO) {
    const st = mergeSettings(state.settings);
    const U = buildUsage(data, st);
    const reading = latestReading(state);
    const out = { st, U, reading, groups: {} };
    if (!reading) return out;
    GROUP_ORDER.forEach(g => {
      const kg = GROUPS[g].silos.reduce((s, k) => s + (reading[k] || 0), 0);
      const per = reading.source === 'radar' ? st.radarUncertaintyKg : st.uncertaintyKg;
      const asOf = (reading.asOf && reading.asOf[g]) || reading.date;   // ST26 estimates can be dated per silo
      out.groups[g] = plan({
        g, readingKg: kg, readingISO: asOf, todayISO, U, st, uncKg: per * Math.sqrt(GROUPS[g].silos.length),
        booked: (state.deliveries || []).filter(d => d.status !== 'received')
      });
      out.groups[g].currentKg = kg; out.groups[g].asOf = asOf;
    });
    return out;
  }
  function latestReading(state) {
    const r = (state.readings || []).slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.savedAt || '') < (b.savedAt || '') ? -1 : 1);
    return r.length ? r[r.length - 1] : null;
  }

  return {
    DEFAULT_SETTINGS, GROUPS, GROUP_ORDER, mergeSettings, groupCap, groupDelivery, groupNotice, groupDays,
    ms, iso, addDays, diffDays, dow, eachDay,
    buildUsage, project, plan, planAll, latestReading
  };
});

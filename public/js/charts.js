/* =========================================================
   Tiny SVG chart helpers (line, bar, sparkline). No dependencies.
   Charts are drawn at the container's pixel width and redrawn on resize.
   ========================================================= */
(function (root) {
  'use strict';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const parts = d => { const [y, m, dd] = d.split('-').map(Number); return { y, m, d: dd, dow: new Date(Date.UTC(y, m - 1, dd)).getUTCDay() }; };
  const fmtShort = d => { const p = parts(d); return p.d + ' ' + MON[p.m - 1]; };
  const fmtLong = d => { const p = parts(d); return DOW[p.dow] + ' ' + p.d + ' ' + MON[p.m - 1]; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  function ticks(max, count) { const out = []; for (let i = 0; i <= count; i++) out.push(max * i / count); return out; }

  function frame(el, h) {
    const W = Math.max(280, Math.floor(el.clientWidth || 600));
    return { W, H: h, m: { t: 14, r: 14, b: 28, l: W < 480 ? 38 : 46 } };
  }

  /* ---------- LINE ---------- */
  function line(el, o) {
    const f = frame(el, o.height || 230), { W, H, m } = f;
    const n = o.dates.length; if (!n) { el.innerHTML = ''; return; }
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    let ymax = o.yMax;
    if (!ymax) { let mx = 0; o.series.forEach(s => s.values.forEach(v => { if (v !== null && v > mx) mx = v; })); (o.hlines || []).forEach(h => { if (h.y > mx) mx = h.y; }); ymax = niceMax(mx * 1.05); }
    const ymin = o.yMin !== undefined ? o.yMin : 0;
    const X = i => m.l + (n === 1 ? iw / 2 : iw * i / (n - 1));
    const Y = v => m.t + ih - ih * (Math.max(ymin, Math.min(ymax, v)) - ymin) / (ymax - ymin);
    const fy = o.yFmt || (v => v);
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || 'chart')}">`;
    ticks(ymax - ymin, 4).forEach(t => {
      const y = Y(ymin + t);
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" class="ch-grid"/><text x="${m.l - 8}" y="${y + 4}" text-anchor="end" class="ch-axis">${esc(fy(ymin + t))}</text>`;
    });
    const step = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(iw / 64))));
    for (let i = 0; i < n; i += step) s += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" class="ch-axis">${fmtShort(o.dates[i])}</text>`;
    (o.bands || []).forEach(b => {   // shaded regions e.g. "estimate beyond schedule"
      const x1 = X(b.from), x2 = X(b.to);
      s += `<rect x="${x1}" y="${m.t}" width="${Math.max(0, x2 - x1)}" height="${ih}" class="ch-band"/>`;
      if (b.label) s += `<text x="${x1 + 6}" y="${m.t + 12}" class="ch-bandlabel">${esc(b.label)}</text>`;
    });
    (o.hlines || []).forEach(h => {
      const y = Y(h.y);
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="${h.color || '#000'}" stroke-width="1.5" stroke-dasharray="${h.dash || '5 4'}"/>`;
      if (h.label) s += `<text x="${W - m.r - 4}" y="${y - 5}" text-anchor="end" class="ch-hlabel" fill="${h.textColor || h.color || '#000'}">${esc(h.label)}</text>`;
    });
    o.series.forEach(se => {
      let d = ''; let started = false;
      se.values.forEach((v, i) => { if (v === null || v === undefined) { started = false; return; } d += (started ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); started = true; });
      if (se.area) {
        const first = se.values.findIndex(v => v !== null), last = se.values.length - 1 - [...se.values].reverse().findIndex(v => v !== null);
        if (first >= 0) s += `<path d="${d} L${X(last).toFixed(1)} ${Y(ymin)} L${X(first).toFixed(1)} ${Y(ymin)} Z" fill="${se.color}" opacity=".14"/>`;
      }
      s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"${se.dash ? ` stroke-dasharray="${se.dash}"` : ''}/>`;
      if (se.dots) se.values.forEach((v, i) => { if (v !== null) s += `<circle cx="${X(i)}" cy="${Y(v)}" r="4" fill="#fff" stroke="${se.color}" stroke-width="2.5"/>`; });
    });
    (o.markers || []).forEach(mk => {
      const x = X(mk.i), y = Y(mk.y);
      s += `<g><line x1="${x}" x2="${x}" y1="${y}" y2="${m.t + ih}" stroke="${mk.color}" stroke-width="1.5" stroke-dasharray="2 3"/><circle cx="${x}" cy="${y}" r="6" fill="${mk.color}" stroke="#fff" stroke-width="2"/><title>${esc(mk.title || '')}</title></g>`;
    });
    if (o.todayIndex !== undefined && o.todayIndex >= 0) { const x = X(o.todayIndex); s += `<line x1="${x}" x2="${x}" y1="${m.t}" y2="${m.t + ih}" class="ch-today"/><text x="${x + 4}" y="${m.t + ih - 5}" class="ch-bandlabel">Today</text>`; }
    s += `<line class="ch-hover" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" style="display:none"/><rect class="ch-hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/></svg><div class="ch-tip" hidden></div>`;
    el.classList.add('ch'); el.innerHTML = s;
    hover(el, n, i => X(i), o.tip, m.l, iw);
  }
  function hover(el, n, X, tipFn, left, iw) {
    if (!tipFn) return;
    const svg = el.querySelector('svg'), hit = el.querySelector('.ch-hit'), vl = el.querySelector('.ch-hover'), tip = el.querySelector('.ch-tip');
    function move(ev) {
      const r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) - left;
      const i = Math.max(0, Math.min(n - 1, Math.round(x / iw * (n - 1))));
      vl.setAttribute('x1', X(i)); vl.setAttribute('x2', X(i)); vl.style.display = '';
      tip.hidden = false; tip.innerHTML = tipFn(i);
      const tw = tip.offsetWidth, px = X(i) + 12 + tw > el.clientWidth ? X(i) - tw - 12 : X(i) + 12;
      tip.style.left = Math.max(0, px) + 'px';
    }
    hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { vl.style.display = 'none'; tip.hidden = true; });
  }

  /* ---------- BARS (grouped or stacked) ---------- */
  function bars(el, o) {
    const f = frame(el, o.height || 230), { W, H, m } = f;
    const n = o.labels.length; if (!n) { el.innerHTML = ''; return; }
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    let mx = 0;
    for (let i = 0; i < n; i++) {
      const vals = o.series.map(s => s.values[i] || 0);
      mx = Math.max(mx, o.stacked ? vals.reduce((a, b) => a + b, 0) : Math.max(...vals));
    }
    const ymax = niceMax(mx * 1.08 || 1), fy = o.yFmt || (v => v);
    const Y = v => m.t + ih - ih * v / ymax, band = iw / n;
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || 'chart')}"><defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fff"/><rect width="3" height="6" fill="rgba(0,0,0,.22)"/></pattern></defs>`;
    ticks(ymax, 4).forEach(t => { const y = Y(t); s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" class="ch-grid"/><text x="${m.l - 8}" y="${y + 4}" text-anchor="end" class="ch-axis">${esc(fy(t))}</text>`; });
    const step = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(iw / 58))));
    const gw = Math.min(band * 0.78, 54), sw = o.stacked ? gw : gw / o.series.length;
    for (let i = 0; i < n; i++) {
      const cx = m.l + band * (i + .5); let acc = 0;
      o.series.forEach((se, k) => {
        const v = se.values[i] || 0, est = se.est && se.est[i];
        const h = ih * v / ymax, x = o.stacked ? cx - gw / 2 : cx - gw / 2 + k * sw;
        const y = o.stacked ? Y(acc + v) : Y(v);
        if (v > 0) {
          s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(sw - (o.stacked ? 0 : 1.5)).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${se.color}"${est ? ' opacity=".55"' : ''}><title>${esc(se.name + ' · ' + o.labels[i] + ': ' + fy(v) + (est ? ' (estimate)' : ''))}</title></rect>`;
          if (est) s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(sw - (o.stacked ? 0 : 1.5)).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="url(#hatch)" opacity=".5" pointer-events="none"/>`;
        }
        acc += v;
      });
      if (i % step === 0) s += `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="ch-axis">${esc(o.labels[i])}</text>`;
    }
    s += '</svg>';
    el.classList.add('ch'); el.innerHTML = s;
  }

  /* ---------- SPARKBARS ---------- */
  function spark(values, color, w, h) {
    w = w || 120; h = h || 34;
    if (!values.length) return '';
    const mx = Math.max(...values, 0.0001), bw = w / values.length;
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">` + values.map((v, i) => {
      const bh = Math.max(v > 0 ? 2 : 0, (h - 2) * v / mx);
      return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(2, bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="${color}"/>`;
    }).join('') + '</svg>';
  }

  root.Charts = { line, bars, spark, fmtShort, fmtLong, esc };
})(window);

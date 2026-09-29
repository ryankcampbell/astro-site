/* Astro — interactive figures for study sets.

   A question or card names a built-in kind and gives settings; no code lives in the study set
   (deploy.py rejects scripts), so every interactive is one of these, reviewed once:

     lightpulse  light travels from A to B; a sped-up clock shows the light-travel time
     orbit       a planet traces its 2πr circle; a counter shows the fraction of a year
     shrink      drag the shrink (powers of ten); Scaled Size and Scaled Dist. update
     logline     drag a cursor along a power-of-ten line; labelled events for reference

   Settings may hold {param} placeholders; study.js fills them before mounting, so numbers can be
   strings like "1,200" — num() reads them.  Colours come from the page's CSS variables, read at
   every frame, so night mode just works.
*/
(function () {
'use strict';

const num = x => typeof x === 'number' ? x : parseFloat(String(x).replace(/,/g, '').replace(/\s*[x×]\s*10\^?/i, 'e'));
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
const h = (t, c, html) => { const e = document.createElement(t); if (c) e.className = c; if (html != null) e.innerHTML = html; return e; };
function sci(x, sig = 3) {
  if (!isFinite(x) || x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e >= -2 && e < 5) return (+x.toPrecision(sig)).toLocaleString('en-US');
  const m = +(x / Math.pow(10, e)).toFixed(sig - 1);
  const sup = String(e).replace(/-/g, '⁻').replace(/\d/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);
  return `${m}×10${sup}`;
}
function dur(s) {
  const a = Math.abs(s);
  if (a < 120) return `${sci(s)} s`;
  if (a < 7200) return `${sci(s / 60)} min`;
  if (a < 172800) return `${sci(s / 3600)} hr`;
  if (a < 3.15e7 * 2) return `${sci(s / 86400)} days`;
  return `${sci(s / 3.15e7)} yr`;
}
function len(m) {
  const a = Math.abs(m);
  if (a < 0.01) return `${sci(m * 1000)} mm`;
  if (a < 1) return `${sci(m * 100)} cm`;
  if (a < 1000) return `${sci(m)} m`;
  return `${sci(m / 1000)} km`;
}

/** Retina canvas that fills its box's width at a fixed aspect. */
function canvas(root, aspect) {
  const cv = h('canvas', 'ix-cv'); root.appendChild(cv);
  const ctx = cv.getContext('2d');
  function size() {
    const w = Math.max(240, cv.clientWidth || root.clientWidth || 360), dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(w * aspect * dpr);
    cv.style.height = (w * aspect) + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { W: w, H: w * aspect };
  }
  return { cv, ctx, size };
}
function controls(root) { const c = h('div', 'ix-ctl'); root.appendChild(c); return c; }
function button(parent, label, fn) { const b = h('button', 'ix-btn', label); b.type = 'button'; b.onclick = fn; parent.appendChild(b); return b; }
function text(ctx, s, x, y, o = {}) {
  ctx.font = `${o.weight || 500} ${o.size || 12}px system-ui,-apple-system,sans-serif`;
  ctx.fillStyle = o.color || css('--ink'); ctx.textAlign = o.align || 'center'; ctx.textBaseline = o.base || 'middle';
  ctx.fillText(s, x, y);
}
function dot(ctx, x, y, r, color, glow) {
  ctx.save(); if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); ctx.restore();
}
/** requestAnimationFrame loop that stops when the element leaves the page. */
function loop(root, step) {
  let raf = 0, last = 0;
  const f = t => { if (!root.isConnected) return; const dt = last ? Math.min(0.05, (t - last) / 1000) : 0; last = t; step(dt); raf = requestAnimationFrame(f); };
  raf = requestAnimationFrame(f);
  return () => cancelAnimationFrame(raf);
}

const KINDS = {
  /* { from:{label,color}, to:{label,color}, distance_m | distance_au | distance_km | distance_ly | time_s,
       label, show_time:true, round_trip:false, seconds:4 } */
  lightpulse(root, s) {
    // distance in m, AU (1.5e11 m), km or ly (9.46e15 m); or give time_s directly (e.g. an echo time)
    const D = s.distance_m != null ? num(s.distance_m) : s.distance_au != null ? num(s.distance_au) * 1.5e11
            : s.distance_km != null ? num(s.distance_km) * 1e3 : s.distance_ly != null ? num(s.distance_ly) * 9.46e15 : 0;
    const c = num(s.speed || 3e8), T = s.time_s != null ? num(s.time_s) : D / c * (s.round_trip ? 2 : 1);
    const { ctx, size } = canvas(root, 0.32);
    const ctl = controls(root);
    const read = h('span', 'ix-read'); ctl.appendChild(read);
    let p = 0, playing = false;
    const play = button(ctl, '▶ Send light', () => { if (p >= 1) p = 0; playing = !playing; play.textContent = playing ? '⏸ Pause' : '▶ Send light'; });
    ctl.insertBefore(play, read);
    const anim = num(s.seconds || 4);
    loop(root, dt => {
      if (playing) { p = Math.min(1, p + dt / anim); if (p >= 1) { playing = false; play.textContent = '↺ Again'; } }
      const { W, H } = size(); const y = H * 0.48, x0 = 38, x1 = W - 38;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = css('--ink-4'); ctx.setLineDash([3, 5]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.setLineDash([]);
      dot(ctx, x0, y, 13, (s.from && s.from.color) || '#f59e0b', 12);
      dot(ctx, x1, y, 9, (s.to && s.to.color) || '#3b82f6');
      text(ctx, (s.from && s.from.label) || 'A', x0, y + 26, { size: 12 });
      text(ctx, (s.to && s.to.label) || 'B', x1, y + 24, { size: 12 });
      if (s.label) text(ctx, s.label, (x0 + x1) / 2, y - 26, { size: 12, color: css('--ink-3') });
      const q = s.round_trip ? (p < .5 ? p * 2 : 2 - p * 2) : p;
      if (p > 0 && p < 1) dot(ctx, x0 + (x1 - x0) * q, y, 5, '#818cf8', 16);
      text(ctx, 'not to scale · animation sped up', W - 6, H - 8, { size: 9.5, color: css('--ink-4'), align: 'right' });
      read.textContent = s.show_time === false ? (p >= 1 ? 'Arrived.' : '') : `light-travel time: ${dur(T * p)}`;
    });
  },

  /* { color, r_label, period_label, center_color, center_label } */
  orbit(root, s) {
    const { ctx, size } = canvas(root, 0.5);
    const ctl = controls(root);
    const read = h('span', 'ix-read');
    let f = 0, playing = false;
    const play = button(ctl, '▶ Orbit', () => { if (f >= 1) f = 0; playing = !playing; play.textContent = playing ? '⏸ Pause' : '▶ Orbit'; });
    ctl.appendChild(read);
    loop(root, dt => {
      if (playing) { f = Math.min(1, f + dt / 5); if (f >= 1) { playing = false; play.textContent = '↺ Again'; } }
      const { W, H } = size(); const cx = W * 0.36, cy = H / 2, R = H * 0.38;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = css('--ink-4'); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.stroke();
      ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * f); ctx.stroke();
      ctx.strokeStyle = css('--ink-3'); ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R, cy); ctx.stroke(); ctx.setLineDash([]);
      text(ctx, s.r_label || 'r', cx + R / 2, cy - 10, { size: 12, color: css('--ink-2') });
      dot(ctx, cx, cy, 11, s.center_color || '#f59e0b', 12);
      if (s.center_label) text(ctx, s.center_label, cx, cy + 22, { size: 11, color: css('--ink-3') });
      const a = -Math.PI / 2 + 2 * Math.PI * f;
      dot(ctx, cx + R * Math.cos(a), cy + R * Math.sin(a), 7, s.color || '#3b82f6');
      const tx = W * 0.66;
      text(ctx, 'distance = 2πr', tx, cy - 28, { size: 13, align: 'left', color: css('--ink') });
      text(ctx, `time = ${s.period_label || '1 year'}`, tx, cy - 6, { size: 13, align: 'left', color: css('--ink') });
      text(ctx, 'v = d / t', tx, cy + 22, { size: 13, align: 'left', weight: 700, color: '#6366f1' });
      read.textContent = `${Math.round(f * 100)}% of one orbit`;
    });
  },

  /* { shrink:5e9, min:8, max:11, objects:[{label, size_m, dist_m, color}] } */
  shrink(root, s) {
    const lo = num(s.min == null ? 8 : s.min), hi = num(s.max == null ? 11 : s.max);
    const ctl = h('div', 'ix-shrink');
    const lab = h('div', 'ix-read');
    const inp = h('input', 'ix-range'); inp.type = 'range'; inp.min = lo; inp.max = hi; inp.step = 0.05;
    inp.value = Math.log10(num(s.shrink || 5e9));
    ctl.append(lab, inp); root.appendChild(ctl);
    const tbl = h('table', 'ix-tbl', '<thead><tr><th>Object</th><th>Scaled Size</th><th>Scaled Dist.</th></tr></thead><tbody></tbody>');
    root.appendChild(tbl);
    const body = tbl.querySelector('tbody');
    const draw = () => {
      const k = Math.pow(10, +inp.value);
      lab.innerHTML = `shrink: <b>${sci(k, 2)}</b> times`;
      body.innerHTML = '';
      (s.objects || []).forEach(o => {
        const tr = h('tr', '', `<td><span class="ix-sw" style="background:${o.color || '#94a3b8'}"></span>${o.label}</td>` +
          `<td>${o.size_m ? len(num(o.size_m) / k) : '—'}</td><td>${o.dist_m ? len(num(o.dist_m) / k) : '—'}</td>`);
        body.appendChild(tr);
      });
    };
    inp.oninput = draw; draw();
  },

  /* { min:-1, max:18, unit:"yr", events:[{label, value}] } */
  logline(root, s) {
    const lo = num(s.min), hi = num(s.max), ev = (s.events || []).map(e => ({ ...e, v: num(e.value) }));
    const { cv, ctx, size } = canvas(root, 0.3);
    const read = h('div', 'ix-read', 'Drag along the line.'); root.appendChild(read);
    let cur = (lo + hi) / 2, drag = false;
    const X = (e, W) => 20 + (W - 40) * (e - lo) / (hi - lo);
    const pick = ev2 => { const r = cv.getBoundingClientRect(); const W = r.width; cur = lo + (hi - lo) * Math.max(0, Math.min(1, (ev2.clientX - r.left - 20) / (W - 40))); };
    cv.style.touchAction = 'none'; cv.style.cursor = 'ew-resize';
    cv.addEventListener('pointerdown', e => { drag = true; pick(e); cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => { if (drag) pick(e); });
    cv.addEventListener('pointerup', () => { drag = false; });
    loop(root, () => {
      const { W, H } = size(); const y = H * 0.76;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = css('--ink-3'); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(W - 20, y); ctx.stroke();
      const step = (hi - lo) > 12 ? 2 : 1;
      for (let e = Math.ceil(lo); e <= hi; e++) {
        const x = X(e, W); ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.stroke();
        if (e % step === 0) text(ctx, `10${String(e).replace(/-/g, '⁻').replace(/\d/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d])}`, x, y + 16, { size: 10, color: css('--ink-3') });
      }
      // greedy stacking: each label takes the lowest row where it does not touch the one before
      ctx.font = '500 10.5px system-ui,-apple-system,sans-serif';
      const rows = [];
      ev.slice().sort((a, b) => a.v - b.v).forEach(e => {
        const x = X(Math.log10(e.v), W), w = ctx.measureText(e.label).width + 8;
        const cx = Math.max(w / 2 + 2, Math.min(W - w / 2 - 2, x));
        let r = 0; while (rows[r] != null && rows[r] > cx - w / 2) r++;
        rows[r] = cx + w / 2;
        const yy = y - 16 - r * 15;
        ctx.strokeStyle = css('--ink-4'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, yy + 6); ctx.stroke();
        dot(ctx, x, y, 3.5, '#6366f1');
        text(ctx, e.label, cx, yy, { size: 10.5, color: css('--ink-2') });
      });
      const xc = X(cur, W);
      ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(xc, y - 10); ctx.lineTo(xc, y + 10); ctx.stroke();
      dot(ctx, xc, y, 6, '#f59e0b', 8);
      read.innerHTML = `≈ <b>${sci(Math.pow(10, cur), 2)}</b> ${s.unit || ''}`;
    });
  },
};

function mount(el, spec) {
  if (!spec || !KINDS[spec.kind]) return false;
  const box = h('div', 'ix'); el.appendChild(box);
  if (spec.title) box.appendChild(h('div', 'ix-title', spec.title));
  try { KINDS[spec.kind](box, spec); } catch (e) { box.textContent = ''; return false; }
  return true;
}

window.Interactives = { mount, kinds: Object.keys(KINDS) };
})();

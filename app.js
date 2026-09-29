/* Astronomy — the student app.  Data: index.json, written by astro_app/deploy.py.
   Design: astro_app/PLAN.md §4.

   A unit is a list of class days (from the live unit schedule).  A day holds any number of
   items (pages, apps, sims, HW, lab handouts, review packets) plus, for a lesson, its study
   set (Flashcards, Practice).  Featured worlds (Moon, Mars, Jupiter…) also have their own
   view, because students use them all year.

   Routes (hash, so every view is a deep link):
     #u1                 unit 1, current day
     #u1/d10[/<item>]    class day 10; item id, or "cards" / "practice"
     #u1/schedule        the unit's schedule table and PDF
     #f[/<world>[/<item>]]  featured worlds
*/
(function () {
'use strict';

const $ = s => document.querySelector(s);
const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const pad = n => String(n).padStart(2, '0');
const todayISO = (() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();
const docURL = d => `${d.file}?h=${d.hash.slice(0, 12)}`;
const KIND = { page: 'Page', app: 'App', sim: 'Sim', hw: 'HW', handout: 'Handout', lab: 'Lab', review: 'Review', schedule: 'Schedule' };
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const S = { data: null, route: null, frames: new Map(), frameCtx: '', sets: new Map(), fromCache: false };

/* ── load ──────────────────────────────────────────────────────────── */

async function load() {
  try {
    const res = await fetch('index.json', { cache: 'no-store' });
    S.fromCache = res.headers.get('X-From-Cache') === '1';
    S.data = await res.json();
  } catch (e) {
    $('#bootmsg').textContent = 'Could not load. Check your connection and reload.';
    return;
  }
  S.fp = fingerprint(S.data);
  document.body.classList.add('ready');
  buildSearch();
  window.addEventListener('hashchange', route);
  route();
  renderNet();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdates(); });
  window.addEventListener('online', renderNet); window.addEventListener('offline', renderNet);
}

function fingerprint(j) {
  const out = [];
  (function walk(o) {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') { if (o.file && o.hash) out.push(o.file + o.hash); Object.values(o).forEach(walk); }
  })(j);
  return out.sort().join('|') + (j.units || []).map(u => (u.rows || []).map(r => r.n + r.title).join()).join();
}
async function checkForUpdates() {
  try {
    const j = await (await fetch('index.json', { cache: 'no-store' })).json();
    if (fingerprint(j) !== S.fp) toast('New material has been posted.', 'Reload', () => location.reload());
  } catch (e) {}
}
function renderNet() {
  const off = !navigator.onLine || S.fromCache;
  $('#netpill').classList.toggle('off', off);
  $('#nettext').textContent = off ? 'Offline' : 'Up to date';
}
function toast(msg, btn, fn) {
  $('#toastmsg').textContent = msg;
  $('#toastbtn').textContent = btn || '';
  $('#toastbtn').hidden = !btn;
  $('#toastbtn').onclick = fn || null;
  $('#toast').classList.add('show');
  if (!btn) setTimeout(() => $('#toast').classList.remove('show'), 2500);
}

/* ── model helpers ─────────────────────────────────────────────────── */

const units = () => S.data.units || [];
const unitOf = n => units().find(u => u.unit === n);
const liveUnits = () => units().filter(u => u.live);
function currentRow(u) {
  const rows = u.rows || [];
  let best = rows[0];
  for (const r of rows) if (r.date <= todayISO) best = r;
  return best;
}
function defaultUnit() {
  const live = liveUnits();
  for (const u of live) { const r = u.rows; if (r.length && r[0].date <= todayISO && r[r.length - 1].date >= todayISO) return u; }
  const future = live.find(u => u.rows.length && u.rows[0].date > todayISO);
  return future || live[live.length - 1] || units()[0];
}
function rowItems(r) {
  const ORDER = { page: 0, app: 1, sim: 2, handout: 3, lab: 4, review: 5, hw: 6 };
  const out = (r.items || []).slice().sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9));
  if (r.study) {
    if (r.study.cards) out.push({ id: 'cards', kind: 'cards', title: 'Flashcards', count: r.study.cards, study: r.study });
    if (r.study.questions) out.push({ id: 'practice', kind: 'practice', title: 'Practice', count: r.study.questions, study: r.study });
  }
  return out;
}
function fmtDate(iso, dow) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${dow ? dow + ' ' : ''}${m}/${d}`;
}
function rowTitle(r) {
  return r.code ? `§${r.code} · ${r.title}` : r.title;
}

/* ── routing ───────────────────────────────────────────────────────── */

function parseHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  const p = h.split('/').filter(Boolean);
  if (p[0] === 'f') return { type: 'featured', world: p[1] || null, item: p[2] || null };
  if (p[0] === 'obs') return { type: 'obs' };
  const um = /^u(\d)$/.exec(p[0] || '');
  if (um) {
    const n = +um[1];
    if (p[1] === 'schedule') return { type: 'schedule', unit: n };
    if (p[1] === 'study') return { type: 'study', unit: n, sel: (p[2] || '').split(',').filter(Boolean), mode: p[3] || null };
    const dm = /^d(\d+)$/.exec(p[1] || '');
    if (dm) return { type: 'day', unit: n, n: +dm[1], item: p[2] || null };
    return { type: 'unit', unit: n };
  }
  return { type: 'home' };
}
function go(h) { if (location.hash !== h) location.hash = h; else route(); }

function route() {
  let r = parseHash();
  if (r.type === 'home') {
    const u = defaultUnit();
    if (!u) return;
    r = { type: 'unit', unit: u.unit };
  }
  if (r.type === 'unit') {
    const u = unitOf(r.unit);
    if (u && u.live && u.rows.length && !isPhone()) {
      const row = currentRow(u);
      history.replaceState(null, '', `#u${u.unit}/d${row.n}`);
      r = { type: 'day', unit: u.unit, n: row.n, item: null };
    }
  }
  S.route = r;
  renderUnits();
  renderRail();
  renderReader();
  document.body.classList.toggle('reading', r.type === 'day' || r.type === 'schedule' || r.type === 'study' || r.type === 'obs' || (r.type === 'featured' && !!r.world));
  $('#backbtn').hidden = !(isPhone() && document.body.classList.contains('reading'));
}
const isPhone = () => window.matchMedia('(max-width:760px)').matches;

/* ── rail ──────────────────────────────────────────────────────────── */

function renderUnits() {
  const box = $('#units'); box.innerHTML = '';
  const cur = S.route.type === 'featured' ? 'f' : S.route.type === 'obs' ? defaultUnit().unit : S.route.unit;
  units().forEach(u => {
    const b = el('button', 'utab' + (u.unit === cur ? ' on' : '') + (u.live ? '' : ' soon'), `U${u.unit}`);
    b.title = u.live ? u.title : `${u.title}: schedule coming`;
    b.setAttribute('role', 'tab');
    b.onclick = () => go(`#u${u.unit}`);
    box.appendChild(b);
  });
  if ((S.data.featured || []).length) {
    const f = el('button', 'utab feat' + (cur === 'f' ? ' on' : ''), '★ Featured');
    f.onclick = () => go('#f');
    box.appendChild(f);
  }
}

function renderRail() {
  const body = $('#railbody'); body.innerHTML = '';
  const r = S.route;
  if (r.type === 'featured') {
    body.appendChild(el('div', 'rsec', 'Featured worlds'));
    (S.data.featured || []).forEach(f => {
      const b = el('button', 'drow' + (r.world === f.key ? ' on' : ''),
        `<div class="ddate" style="font-size:18px">${esc(f.glyph || '★')}</div><div class="dmeta"><div class="dtitle">${esc(f.title)}</div>` +
        `<div class="dsub">${esc(f.blurb || '')}</div></div>`);
      b.onclick = () => go(`#f/${f.key}`);
      body.appendChild(b);
    });
    renderSave(null);
    return;
  }
  const u = unitOf(r.type === 'obs' ? defaultUnit().unit : r.unit);
  if (!u) return;
  renderEvents(body);
  if (!u.live) {
    body.appendChild(el('div', 'inner emptyday', `<b>${esc(u.title)}</b>The schedule for this unit is not posted yet.<br><br>` +
      `<a href="#f">See the featured worlds →</a>`));
    renderSave(null);
    return;
  }
  const head = el('button', 'drow' + (r.type === 'schedule' ? ' on' : ''),
    `<div class="ddate">📅</div><div class="dmeta"><div class="dtitle">${esc(u.title)}</div><div class="dsub">Unit schedule</div></div>`);
  head.onclick = () => go(`#u${u.unit}/schedule`);
  body.appendChild(head);
  if ((S.data.events || []).length) {
    const ob = el('button', 'drow' + (r.type === 'obs' ? ' on' : ''),
      `<div class="ddate">🔭</div><div class="dmeta"><div class="dtitle">Observing</div><div class="dsub">Where and when we look up next</div></div>`);
    ob.onclick = () => go('#obs');
    body.appendChild(ob);
  }
  if (u.rows.some(x => x.study)) {
    const sp = el('button', 'drow' + (r.type === 'study' ? ' on' : ''),
      `<div class="ddate">🧠</div><div class="dmeta"><div class="dtitle">Study &amp; quiz prep</div><div class="dsub">Pick days; flashcards and practice</div></div>`);
    sp.onclick = () => go(`#u${u.unit}/study`);
    body.appendChild(sp);
  }
  body.appendChild(el('div', 'rsec', 'Class days'));
  let nowPlaced = false;
  u.rows.forEach(row => {
    if (!nowPlaced && row.date >= todayISO) {
      nowPlaced = true;
      if (row.date !== todayISO && row !== u.rows[0]) body.appendChild(el('div', 'nowline', 'Today'));
    }
    const items = rowItems(row);
    const tags = [];
    if (row.date === todayISO) tags.push('<span class="tag today">Today</span>');
    if (row.kind === 'featured') tags.push('<span class="tag feat">★ Featured</span>');
    (row.labels || []).forEach(l => { if (l.kind === 'lab' || l.kind === 'quiz' || l.kind === 'test') tags.push(`<span class="tag ${l.kind}">${esc(l.text.split(':')[0])}</span>`); });
    if (items.length) tags.push(`<span>${items.length} item${items.length > 1 ? 's' : ''}</span>`);
    const on = r.type === 'day' && r.unit === u.unit && r.n === row.n;
    const b = el('button', 'drow' + (on ? ' on' : '') + (items.length ? '' : ' empty') + (row.date === todayISO ? ' today' : ''),
      `<div class="ddate">${esc(fmtDate(row.date))}<i>${esc(row.dow)}</i></div>` +
      `<div class="dmeta"><div class="dtitle">${row.code ? `<span class="dcode">§${esc(row.code)}</span>` : ''}${esc(row.title)}</div>` +
      `<div class="dsub">${tags.join('')}</div></div>`);
    b.onclick = () => go(`#u${u.unit}/d${row.n}`);
    body.appendChild(b);
    if (on) setTimeout(() => b.scrollIntoView({ block: 'nearest' }), 0);
  });
  renderSave(u);
}

const placeOf = e => (S.data.places || {})[e.place] || (e.place ? { name: e.place } : null);
const upcoming = () => (S.data.events || []).filter(e => e.date >= todayISO).sort((a, b) => a.date < b.date ? -1 : 1);
function whenText(e) {
  const d = new Date(e.date + 'T12:00:00');
  const days = Math.round((d - new Date(todayISO + 'T12:00:00')) / 864e5);
  const rel = days === 0 ? 'Tonight' : days === 1 ? 'Tomorrow' : days < 7 ? d.toLocaleDateString('en-US', { weekday: 'long' }) : '';
  return { d, days, label: `${rel ? rel + ', ' : ''}${d.toLocaleDateString('en-US', { weekday: rel ? undefined : 'short', month: 'short', day: 'numeric' })}` };
}
function renderEvents(body) {
  upcoming().slice(0, 2).forEach(e => {
    const w = whenText(e);
    if (w.days > 21) return;
    const pl = placeOf(e);
    const c = el('button', 'evcard', `<b>🔭 ${esc(e.title)}</b>${esc(w.label)}${e.time ? ' · ' + esc(e.time) : ''}` +
      `${pl ? `<div>${esc(pl.name)}${e.place_tbc ? ' (to be confirmed)' : ''}</div>` : ''}` +
      `<div class="evmore">${e.optional ? 'Optional · ' : ''}Details →</div>`);
    c.onclick = () => go('#obs');
    body.appendChild(c);
  });
}

/* ── observing: #obs is the link to send students ─────────────────── */

function renderObs() {
  $('#dochead').innerHTML = `<div class="dh-kicker">Portland · observing with the class</div><h1 class="dh-title">🔭 Observing</h1>`;
  clearStage('obs');
  showPane('obs', p => {
    p.innerHTML = '';
    const inner = el('div', 'inner');
    const up = upcoming();
    if (!up.length) inner.appendChild(el('div', 'emptyday', '<b>No observing session is scheduled right now.</b>Check back soon.'));
    up.forEach((e, k) => {
      const w = whenText(e), pl = placeOf(e);
      const c = el('div', 'obcard' + (k === 0 ? ' next' : ''));
      c.innerHTML =
        `<div class="ob-when">${k === 0 ? '<span class="tag today">Next</span>' : ''}${e.optional ? '<span class="tag">Optional</span>' : ''}` +
        `<span>${esc(w.label)}${e.time ? ' · ' + esc(e.time) : ''}</span></div>` +
        `<h2 class="ob-title">${esc(e.title)}</h2>` +
        (pl ? `<div class="ob-place"><b>${esc(pl.name)}</b>${pl.area ? ', ' + esc(pl.area) : ''}` +
              `${e.place_tbc ? ' <span class="tag quiz">to be confirmed</span>' : ''}` +
              `${pl.map ? ` · <a href="${esc(pl.map)}" target="_blank" rel="noopener">Map ↗</a>` : ''}` +
              `${pl.note ? `<div class="ob-note">${esc(pl.note)}</div>` : ''}</div>` : '') +
        ((e.sky || []).length ? `<div class="ob-h">What's up</div><ul>${e.sky.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '') +
        ((e.bring || []).length ? `<div class="ob-h">Bring</div><ul>${e.bring.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '') +
        (e.note ? `<p class="ob-note">${esc(e.note)}</p>` : '') +
        (e.link ? `<p><a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.link_label || 'More details ↗')}</a></p>` : '');
      inner.appendChild(c);
    });
    const places = Object.values(S.data.places || {});
    if (places.length) {
      inner.appendChild(el('div', 'ob-h', 'Where we usually go'));
      const g = el('div', 'fgrid');
      places.forEach(pl => g.appendChild(el('div', 'fcard', `<h3>${esc(pl.name)}</h3><p>${esc(pl.area || '')}</p><p>${esc(pl.note || '')}</p>` +
        (pl.map ? `<a href="${esc(pl.map)}" target="_blank" rel="noopener">Map ↗</a>` : ''))));
      inner.appendChild(g);
    }
    p.appendChild(inner);
  });
}

/* ── offline save (per unit) ───────────────────────────────────────── */

function unitFiles(u) {
  const out = [];
  if (u.schedule) out.push(u.schedule);
  u.rows.forEach(r => { (r.items || []).forEach(i => out.push(i)); if (r.study) out.push(r.study); });
  const seen = new Set();
  return out.filter(f => !seen.has(f.file) && seen.add(f.file));
}
async function renderSave(u) {
  const btn = $('#savebtn');
  if (!u || !('caches' in window)) { btn.hidden = true; return; }
  btn.hidden = false;
  const files = unitFiles(u);
  const bytes = files.reduce((s, f) => s + (f.bytes || 0), 0);
  const mb = (bytes / 1048576).toFixed(0);
  let have = 0;
  try { const c = await caches.open('astro-docs-v1'); for (const f of files) if (await c.match(docURL(f))) have++; } catch (e) {}
  btn.textContent = have === files.length && files.length ? `✓ Unit ${u.unit} saved for offline` : `Save Unit ${u.unit} for offline (${mb} MB)`;
  btn.onclick = async () => {
    let k = 0;
    for (const f of files) {
      btn.textContent = `Saving… ${++k}/${files.length}`;
      try { await fetch(docURL(f)); } catch (e) {}
    }
    renderSave(u);
  };
}

/* ── reader ────────────────────────────────────────────────────────── */

function clearStage(ctx) {
  if (S.frameCtx === ctx) return;
  S.frameCtx = ctx;
  S.frames.clear();
  $('#stage').innerHTML = '';
}

function renderReader() {
  const r = S.route;
  const head = $('#dochead'), chips = $('#chips');
  head.innerHTML = ''; chips.innerHTML = '';
  if (r.type === 'featured') return r.world ? renderWorld(r) : renderFeaturedGrid();
  if (r.type === 'obs') return renderObs();
  const u = unitOf(r.unit);
  if (!u) return;
  if (r.type === 'schedule') return renderSchedule(u);
  if (r.type === 'study') return renderStudy(u, r);
  if (r.type === 'unit') { clearStage('unit' + u.unit); return; }
  const row = (u.rows || []).find(x => x.n === r.n);
  if (!row) { go(`#u${u.unit}`); return; }
  const kicker = [`${fmtDate(row.date, row.dow)}`, `Unit ${u.unit}`];
  const tags = (row.labels || []).map(l => `<span class="tag ${l.kind}">${esc(l.text)}</span>`).join('');
  head.innerHTML = `<div class="dh-kicker">${esc(kicker.join(' · '))}${row.date === todayISO ? '<span class="tag today">Today</span>' : ''}${row.kind === 'featured' ? '<span class="tag feat">★ Featured</span>' : ''}${tags}</div>` +
    `<h1 class="dh-title">${esc(rowTitle(row))}</h1>`;
  const items = rowItems(row);
  const prep = prepCodes(u, row);
  if (prep.length) items.push({ id: 'prepare', kind: 'prepare', title: 'Prepare', count: prep.length });
  const ctx = `u${u.unit}/d${row.n}`;
  clearStage(ctx);
  if (!items.length) {
    showPane('empty', p => { p.innerHTML = `<div class="emptyday"><b>Nothing posted for this day yet.</b>` +
      `${row.note ? esc(row.note) : 'Check back later.'}</div>`; });
    return;
  }
  const pick = items.find(i => i.id === r.item) || items.find(i => i.kind === 'page') || items[0];
  items.forEach(it => chips.appendChild(chip(it, it === pick, () =>
    it.kind === 'prepare' ? go(`#u${u.unit}/study/${prep.join(',')}`) : go(`#${ctx}/${it.id}`))));
  openItem(pick.kind === 'prepare' ? items[0] : pick, ctx);
}

/** Lesson codes with study sets that an assessment row covers: since the previous
    quiz or test in the unit; a review or test day covers the whole unit. */
function prepCodes(u, row) {
  if (!['quiz', 'review', 'test'].includes(row.kind) && !(row.labels || []).some(l => l.kind === 'quiz' || l.kind === 'test')) return [];
  const whole = row.kind === 'review' || row.kind === 'test' || (row.labels || []).some(l => l.kind === 'test');
  const idx = u.rows.indexOf(row);
  let start = 0;
  if (!whole) for (let k = idx - 1; k >= 0; k--) {
    const x = u.rows[k];
    if ((x.labels || []).some(l => l.kind === 'quiz' || l.kind === 'test')) { start = k + 1; break; }
  }
  return u.rows.slice(start, idx).filter(x => x.study).map(x => x.code);
}

function chip(it, on, fn) {
  const lab = it.kind === 'prepare' ? `🧠 Prepare <small>${it.count} day${it.count > 1 ? 's' : ''}</small>`
    : it.kind === 'cards' || it.kind === 'practice' ? `${esc(it.title)} <small>${it.count}</small>`
    : `<small>${esc(KIND[it.kind] || it.kind)}</small> ${esc(it.kind === 'hw' ? it.title.replace(/^HW\s*/, '') : it.title)}`;
  const b = el('button', 'chip' + (on ? ' on' : ''), lab);
  b.setAttribute('role', 'tab');
  b.onclick = fn;
  return b;
}

function openItem(it, ctx, anchor) {
  if (it.kind === 'cards' || it.kind === 'practice') {
    return showPane(it.kind, async p => {
      p.innerHTML = '<div class="st-wrap" style="color:var(--ink-3)">Loading…</div>';
      const set = await loadSet(it.study);
      if (!set) { p.innerHTML = '<div class="emptyday"><b>Could not load this study set.</b>Try again when you are online.</div>'; return; }
      const ctxs = { openCards: () => go(`#${ctx}/cards`), openPractice: () => go(`#${ctx}/practice`) };
      (it.kind === 'cards' ? window.Study.flashcards : window.Study.practice)(p, set, ctxs);
    });
  }
  const stage = $('#stage');
  stage.querySelectorAll('.pane').forEach(p => p.classList.remove('on'));
  let f = S.frames.get(it.file);
  if (!f) {
    f = el('iframe');
    f.title = it.title;
    f.src = docURL(it) + (anchor ? '#' + anchor : '');
    f.setAttribute('allow', 'fullscreen');
    f.setAttribute('allowfullscreen', '');
    S.frames.set(it.file, f);
    stage.appendChild(f);
  } else if (anchor) {
    f.src = docURL(it) + '#' + anchor;
  }
  stage.querySelectorAll('iframe').forEach(x => x.classList.toggle('on', x === f));
  let out = stage.querySelector('.openout');
  if (!out) { out = el('a', 'openout'); out.target = '_blank'; out.rel = 'noopener'; stage.appendChild(out); }
  out.href = docURL(it);
  out.textContent = it.file.endsWith('.pdf') ? 'Open PDF ↗' : 'Open full screen ↗';
  out.hidden = false;
}

function showPane(name, fill) {
  const stage = $('#stage');
  stage.querySelectorAll('iframe').forEach(x => x.classList.remove('on'));
  const out = stage.querySelector('.openout'); if (out) out.hidden = true;
  stage.querySelectorAll('.pane').forEach(p => p.classList.remove('on'));
  let p = stage.querySelector(`.pane[data-name="${name}"]`);
  if (!p) { p = el('div', 'pane'); p.dataset.name = name; stage.appendChild(p); }
  p.classList.add('on');
  p.scrollTop = 0;
  fill(p);
}

async function loadSet(st) {
  if (S.sets.has(st.file)) return S.sets.get(st.file);
  try {
    const j = await (await fetch(docURL(st))).json();
    S.sets.set(st.file, j);
    return j;
  } catch (e) { return null; }
}

/* ── featured ──────────────────────────────────────────────────────── */

function rowByKey(key) {
  for (const u of units()) for (const r of u.rows || []) if ((r.keys || []).includes(key)) return { u, r };
  return null;
}
function renderFeaturedGrid() {
  clearStage('featured');
  showPane('fgrid', p => {
    p.innerHTML = '';
    const inner = el('div', 'inner');
    inner.appendChild(el('h2', 'pane-h', 'Featured worlds'));
    inner.appendChild(el('p', 'pane-sub', 'One world per unit, moving outward. Each has an app to explore and a page of its most interesting things.'));
    const grid = el('div', 'fgrid');
    (S.data.featured || []).forEach(f => {
      const c = el('div', 'fcard', `<h3><span class="fglyph">${esc(f.glyph || '★')}</span>${esc(f.title)}</h3><p>${esc(f.blurb || '')}</p>`);
      const its = el('div', 'fitems');
      f.items.forEach(it => its.appendChild(chip(it, false, () => go(`#f/${f.key}/${it.id}`))));
      if (!f.items.length) its.innerHTML = '<span style="color:var(--ink-4);font-size:12px">Coming soon</span>';
      c.appendChild(its);
      const when = (f.rows || []).map(rowByKey).filter(Boolean);
      if (when.length) {
        const w = el('p', '', 'In class: ' + when.map(x => `<a href="#u${x.u.unit}/d${x.r.n}">${esc(fmtDate(x.r.date, x.r.dow))}</a>`).join(', '));
        w.style.margin = '10px 0 0'; c.appendChild(w);
      }
      grid.appendChild(c);
    });
    inner.appendChild(grid);
    p.appendChild(inner);
  });
}
function renderWorld(r) {
  const f = (S.data.featured || []).find(x => x.key === r.world);
  if (!f) { go('#f'); return; }
  $('#dochead').innerHTML = `<div class="dh-kicker"><span class="tag feat">★ Featured</span>${esc(f.blurb || '')}</div><h1 class="dh-title">${esc(f.glyph || '')} ${esc(f.title)}</h1>`;
  const ctx = `f/${f.key}`;
  clearStage(ctx);
  if (!f.items.length) { showPane('empty', p => { p.innerHTML = '<div class="emptyday"><b>Coming soon.</b></div>'; }); return; }
  const pick = f.items.find(i => i.id === r.item) || f.items.find(i => i.kind === 'app') || f.items[0];
  f.items.forEach(it => $('#chips').appendChild(chip(it, it === pick, () => go(`#${ctx}/${it.id}`))));
  openItem(pick, ctx);
}

/* ── study & quiz prep: mix study sets from chosen days ─────────────── */

function renderStudy(u, r) {
  const days = u.rows.filter(x => x.study);
  const chosen = new Set(r.sel && r.sel.length ? r.sel.filter(x => x !== '-') : days.filter(x => x.date <= todayISO).map(x => x.code));
  $('#dochead').innerHTML = `<div class="dh-kicker">Unit ${u.unit} · flashcards and practice from the days you pick</div><h1 class="dh-title">Study &amp; quiz prep</h1>`;
  const ctx = `u${u.unit}/study`;
  clearStage(ctx + '/' + [...chosen].join(','));
  const url = mode => `#u${u.unit}/study/${[...chosen].join(',') || '-'}${mode ? '/' + mode : ''}`;
  [{ id: '', t: 'Choose days' }, { id: 'cards', t: 'Flashcards' }, { id: 'practice', t: 'Practice' }].forEach(t => {
    const b = el('button', 'chip' + ((r.mode || '') === t.id ? ' on' : ''), esc(t.t));
    b.disabled = t.id && !chosen.size;
    b.onclick = () => go(url(t.id));
    $('#chips').appendChild(b);
  });
  if (r.mode === 'cards' || r.mode === 'practice') {
    return showPane('mix-' + r.mode, async p => {
      p.innerHTML = '<div class="st-wrap" style="color:var(--ink-3)">Loading…</div>';
      const sets = (await Promise.all(days.filter(x => chosen.has(x.code)).map(x => loadSet(x.study)))).filter(Boolean);
      if (!sets.length) { p.innerHTML = '<div class="emptyday"><b>Could not load these study sets.</b>Try again when you are online.</div>'; return; }
      const mixed = { code: sets.map(x => x.code).join('+'),
        title: sets.length === 1 ? sets[0].title : 'Mixed: ' + sets.map(x => '§' + x.code).join(', '),
        cards: sets.flatMap(x => x.cards || []), questions: sets.flatMap(x => x.questions || []) };
      const c = { openCards: () => go(url('cards')), openPractice: () => go(url('practice')), size: sets.length > 1 ? 10 : 8 };
      (r.mode === 'cards' ? window.Study.flashcards : window.Study.practice)(p, mixed, c);
    });
  }
  showPane('pick', p => {
    p.innerHTML = '';
    const inner = el('div', 'inner');
    inner.appendChild(el('h2', 'pane-h', 'Pick the days to study'));
    inner.appendChild(el('p', 'pane-sub', 'Getting ready for a quiz? Tick the days it covers. Flashcards and practice then draw from all of them.'));
    const list = el('div', 'pick-list');
    days.forEach(x => {
      const lab = el('label', 'pick-row' + (x.date > todayISO ? ' later' : ''),
        `<input type="checkbox" ${chosen.has(x.code) ? 'checked' : ''}><span class="pick-date">${esc(fmtDate(x.date, x.dow))}</span>` +
        `<span class="pick-title"><b>§${esc(x.code)}</b> ${esc(x.title)}</span><span class="pick-n">${x.study.cards} cards · ${x.study.questions} questions</span>`);
      lab.querySelector('input').onchange = e => { e.target.checked ? chosen.add(x.code) : chosen.delete(x.code); history.replaceState(null, '', url('')); sum(); };
      list.appendChild(lab);
    });
    inner.appendChild(list);
    const quick = el('div', 'pick-quick');
    const mk = (t, fn) => { const b = el('button', 'st-link', t); b.onclick = () => { fn(); go(url('')); }; quick.appendChild(b); };
    mk('Everything so far', () => { chosen.clear(); days.filter(x => x.date <= todayISO).forEach(x => chosen.add(x.code)); });
    mk('Whole unit', () => { chosen.clear(); days.forEach(x => chosen.add(x.code)); });
    mk('None', () => chosen.clear());
    inner.appendChild(quick);
    const act = el('div', 'st-actions');
    const bc = el('button', 'btn-2'), bp = el('button', 'btn-1');
    bc.onclick = () => go(url('cards')); bp.onclick = () => go(url('practice'));
    act.append(bc, bp);
    inner.appendChild(act);
    function sum() {
      const pick = days.filter(x => chosen.has(x.code));
      const nc = pick.reduce((a, x) => a + x.study.cards, 0), nq = pick.reduce((a, x) => a + x.study.questions, 0);
      bc.textContent = `Flashcards (${nc})`; bp.textContent = `Practice (${nq} questions)`;
      bc.disabled = !nc; bp.disabled = !nq;
      $('#chips').querySelectorAll('.chip').forEach((c, k) => { if (k) c.disabled = !pick.length; });
    }
    sum();
    p.appendChild(inner);
  });
}

/* ── schedule ──────────────────────────────────────────────────────── */

function renderSchedule(u) {
  $('#dochead').innerHTML = `<div class="dh-kicker">Unit ${u.unit} · ${u.rows.length} class days</div><h1 class="dh-title">${esc(u.title)}</h1>`;
  const ctx = `u${u.unit}/schedule`;
  clearStage(ctx);
  const tabs = [{ id: 'table', title: 'Day by day' }];
  if (u.schedule) tabs.push({ ...u.schedule, id: 'pdf', title: 'Printable schedule' });
  const want = parseHash().item || 'table';
  tabs.forEach(t => {
    const b = el('button', 'chip' + (t.id === want ? ' on' : ''), esc(t.title));
    b.onclick = () => { $('#chips').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b)); t.id === 'pdf' ? openItem(t, ctx) : table(); };
    $('#chips').appendChild(b);
  });
  function table() {
    showPane('table', p => {
      p.innerHTML = '';
      const inner = el('div', 'inner');
      const t = el('table', 'stable', '<thead><tr><th>Date</th><th>Lesson</th><th>Topic</th><th>Lab · Assessment · HW</th></tr></thead>');
      const tb = el('tbody');
      u.rows.forEach(row => {
        const tr = el('tr', 'link' + (row.date === todayISO ? ' today' : ''),
          `<td style="white-space:nowrap">${esc(fmtDate(row.date, row.dow))}</td><td>${row.code ? '§' + esc(row.code) : row.kind === 'featured' ? '★' : ''}</td>` +
          `<td>${esc(row.title)}</td><td>${(row.labels || []).map(l => `<span class="tag ${l.kind}">${esc(l.text)}</span>`).join(' ')}</td>`);
        tr.onclick = () => go(`#u${u.unit}/d${row.n}`);
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      inner.appendChild(t);
      p.appendChild(inner);
    });
  }
  const pdf = tabs.find(t => t.id === 'pdf');
  if (want === 'pdf' && pdf) openItem(pdf, ctx); else table();
}

/* ── search ────────────────────────────────────────────────────────── */

let INDEX = [];
function buildSearch() {
  INDEX = [];
  units().forEach(u => (u.rows || []).forEach(r => {
    const base = `#u${u.unit}/d${r.n}`;
    INDEX.push({ t: rowTitle(r), s: `${fmtDate(r.date, r.dow)} · Unit ${u.unit}`, h: base,
                 k: [r.title, r.code, ...(r.labels || []).map(l => l.text)].join(' ') });
    (r.items || []).forEach(it => {
      INDEX.push({ t: it.title, s: `${KIND[it.kind] || it.kind} · ${fmtDate(r.date)} §${r.code || ''}`.replace(/ §$/, ''), h: `${base}/${it.id}`, k: it.title });
      (it.sections || []).forEach(sec => INDEX.push({ t: sec.text, s: it.title, h: `${base}/${it.id}`, a: sec.id, it, k: sec.text }));
    });
    if (r.study) INDEX.push({ t: `Practice: ${r.study.title}`, s: `§${r.code} · flashcards and practice`, h: `${base}/practice`, k: 'practice flashcards quiz ' + r.study.title });
  }));
  (S.data.featured || []).forEach(f => {
    INDEX.push({ t: f.title, s: 'Featured world', h: `#f/${f.key}`, k: f.title + ' ' + (f.blurb || '') });
    f.items.forEach(it => {
      INDEX.push({ t: it.title, s: `${KIND[it.kind]} · ${f.title}`, h: `#f/${f.key}/${it.id}`, k: it.title });
      (it.sections || []).forEach(sec => INDEX.push({ t: sec.text, s: it.title, h: `#f/${f.key}/${it.id}`, a: sec.id, it, k: sec.text }));
    });
  });
  const inp = $('#search'), box = $('#results');
  let sel = 0, hits = [];
  inp.oninput = () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) { box.classList.remove('open'); return; }
    const words = q.split(/\s+/);
    hits = INDEX.filter(x => words.every(w => (x.t + ' ' + x.k + ' ' + x.s).toLowerCase().includes(w))).slice(0, 12);
    sel = 0; draw();
  };
  function draw() {
    box.innerHTML = hits.length ? '' : '<div class="res"><span>No matches</span></div>';
    hits.forEach((x, i) => {
      const b = el('button', 'res' + (i === sel ? ' on' : ''), `<b>${esc(x.t)}</b><span>${esc(x.s)}</span>`);
      b.onmousedown = e => { e.preventDefault(); pick(x); };
      box.appendChild(b);
    });
    box.classList.add('open');
  }
  function pick(x) {
    box.classList.remove('open'); inp.value = ''; inp.blur();
    go(x.h);
    if (x.a && x.it) setTimeout(() => openItem(x.it, S.frameCtx, x.a), 50);
  }
  inp.onkeydown = e => {
    if (e.key === 'ArrowDown') { sel = Math.min(hits.length - 1, sel + 1); draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    if (e.key === 'Enter' && hits[sel]) pick(hits[sel]);
    if (e.key === 'Escape') { inp.value = ''; box.classList.remove('open'); inp.blur(); }
  };
  inp.onblur = () => setTimeout(() => box.classList.remove('open'), 150);
}

/* ── chrome ────────────────────────────────────────────────────────── */

document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== $('#search') && !/input|textarea/i.test(document.activeElement.tagName)) {
    e.preventDefault(); $('#search').focus();
  }
});
$('#backbtn').onclick = () => {
  const r = S.route;
  if (r.type === 'featured') go('#f');
  else { document.body.classList.remove('reading'); $('#backbtn').hidden = true; history.replaceState(null, '', `#u${r.unit}`); }
};
$('#themebtn').onclick = () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  store.set('astro.theme', dark ? 'dark' : 'light');
};
$('#brand').onclick = e => { e.preventDefault(); go(''); history.replaceState(null, '', location.pathname); route(); };

load();
})();

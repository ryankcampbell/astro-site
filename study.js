/* Astro — study sets: flashcards and practice.

   One study set per lesson code (Days/…/study/<code>.json), published to s/<code>.json.
   Format: astro_app/PLAN.md §5.  Look: milagro's practice, results and flashcard pages,
   re-created in plain CSS (style.css, "study" section) so it works offline.

   Progress lives only in this browser (localStorage), keyed on the permanent ids:
     astro.fc.<card id>  {box 1..5, seen}        Leitner boxes for flashcards
     astro.q.<q id>      {right, wrong, last}     practice history
   Every read and write is wrapped: private windows can refuse storage.
*/
(function () {
'use strict';

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const h = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const TAGS = { CON: 'Memorize the constant', EQ: 'Memorize the equation', DEF: 'Know the definition',
               EX: 'Worked example', OUT: 'Outline the topic', DIAG: 'Diagram' };

function math(el) {
  if (window.renderMathInElement) {
    try {
      window.renderMathInElement(el, { delimiters: [{ left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false }], throwOnError: false });
    } catch (e) {}
  }
}

/* ── numbers ─────────────────────────────────────────────────────────── */

function decimals(step) { const s = String(step); return s.includes('.') ? s.split('.')[1].length : 0; }
function pickParams(ps) {
  const v = {};
  for (const k in ps || {}) {
    const p = ps[k], step = p.step || 1, n = Math.round((p.max - p.min) / step);
    v[k] = +(p.min + step * Math.floor(Math.random() * (n + 1))).toFixed(decimals(step));
  }
  return v;
}
function fmtParam(x, step) {
  const d = decimals(step || 1);
  return x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
/** 3 significant figures, in the course's style: plain for ordinary sizes, a×10^b otherwise. */
function sig3(x) {
  if (!isFinite(x)) return String(x);
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e >= -2 && e < 6) {
    const r = +x.toPrecision(3);
    return r.toLocaleString('en-US', { maximumFractionDigits: Math.max(0, 2 - e), useGrouping: false });
  }
  const m = (x / Math.pow(10, e)).toFixed(2).replace(/\.?0+$/, '');
  return `${m}\\times10^{${e}}`;
}
function evalAnswer(expr, vals) {
  return Function(...Object.keys(vals), 'return (' + expr + ')')(...Object.values(vals));
}
/** Substitute only real param names and {answer}; LaTeX braces like 10^{8} are left alone. */
function fill(s, q, vals, ans) {
  let out = String(s || '');
  for (const k in vals) out = out.split('{' + k + '}').join(fmtParam(vals[k], q.params[k].step));
  if (ans != null) {
    // {answer} may sit in text or inside $…$; a×10^b needs math mode either way
    const parts = out.split('{answer}');
    out = parts[0];
    for (let k = 1; k < parts.length; k++) {
      const inMath = (out.match(/(?<!\\)\$/g) || []).length % 2 === 1;
      out += (inMath ? sig3(ans) : `$${sig3(ans)}$`) + parts[k];
    }
  }
  return out;
}
/** Accept 4.5e12, 4.5 x 10^12, 4.5×10^12, 4.5*10^12, 4,500, 10^5. */
function parseNum(s) {
  s = String(s).trim().replace(/,/g, '').replace(/\s+/g, '').replace(/[−–]/g, '-');
  if (!s) return NaN;
  let m = s.match(/^([-+]?\d*\.?\d+)(?:[x×*·]10\^?\{?([-+]?\d+)\}?)$/i);
  if (m) return parseFloat(m[1]) * Math.pow(10, parseInt(m[2], 10));
  m = s.match(/^10\^\{?([-+]?\d+)\}?$/);
  if (m) return Math.pow(10, parseInt(m[1], 10));
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return parseFloat(s);
  return NaN;
}

/* ── figures ──────────────────────────────────────────────────────────
   A question or card may carry an inline SVG ("figure", and for cards "figure_back").
   Params are filled like the stem, so a figure can redraw for each attempt.  Lines and text use
   currentColor, so figures follow the page's ink in day and night mode. */
function figHTML(svg, q, vals) {
  if (!svg || !/^\s*<svg[\s>]/.test(svg)) return '';
  return `<div class="fig">${q ? fill(svg, q, vals) : svg}</div>`;
}

function mountIx(el, spec, q, vals) {
  if (!spec || !window.Interactives) return;
  let s = spec;
  if (q) { try { s = JSON.parse(fill(JSON.stringify(spec), q, vals)); } catch (e) { return; } }
  window.Interactives.mount(el, s);
}

/* ── flashcards ──────────────────────────────────────────────────────── */

function flashcards(mount, set, ctx) {
  mount.innerHTML = '';
  const wrap = h('div', 'st-wrap');
  mount.appendChild(wrap);
  const cards = set.cards || [];
  if (!cards.length) { wrap.innerHTML = '<p class="st-empty">No flashcards in this set yet.</p>'; return; }
  const boxOf = c => store.get('astro.fc.' + c.id, { box: 1 }).box;
  let deck, i, flipped, again;

  function start(onlyAgain) {
    const src = onlyAgain ? cards.filter(c => again.has(c.id)) : cards;
    // lowest box first (the ones you know least), shuffled within a box
    deck = shuffle(src).sort((a, b) => boxOf(a) - boxOf(b));
    i = 0; flipped = false; again = new Set();
    draw();
  }

  function draw() {
    wrap.innerHTML = '';
    wrap.appendChild(h('div', 'st-head', `<div><h2>Flashcards</h2><p>${esc(set.title)} · ${cards.length} cards</p></div>`));
    const shuf = h('button', 'st-link', '<span aria-hidden="true">⇄</span> Shuffle');
    shuf.onclick = () => { deck = shuffle(deck); i = 0; flipped = false; draw(); };
    const prn = h('button', 'st-link', '<span aria-hidden="true">⎙</span> Print cards');
    prn.title = 'Double-sided: 8 cards a sheet; print "flip on long edge"';
    prn.onclick = () => printCards(set);
    const tools = h('div', 'st-tools'); tools.append(shuf, prn);
    wrap.querySelector('.st-head').appendChild(tools);

    if (i >= deck.length) return done();
    const c = deck[i];
    wrap.appendChild(h('div', 'st-count', `<span>Card ${i + 1} of ${deck.length}</span>` +
      `<span class="st-chip" title="${esc(TAGS[c.tag] || '')}">${esc(c.tag)} · ${esc(TAGS[c.tag] || '')}</span>`));
    const bar = h('div', 'st-bar', '<div></div>');
    bar.firstChild.style.width = (100 * i / deck.length) + '%';
    wrap.appendChild(bar);

    const scene = h('div', 'fc-scene');
    const card = h('button', 'fc-card' + (flipped ? ' flipped' : ''));
    card.type = 'button';
    card.setAttribute('aria-pressed', String(flipped));
    card.innerHTML =
      `<div class="fc-side fc-front"><span class="fc-face">${c.tag === 'EX' || c.tag === 'OUT' || c.tag === 'DIAG' ? 'Try it' : 'Front'}</span>` +
      `${figHTML(c.figure)}<div class="fc-content">${c.front}</div><span class="fc-hint">Tap or press Space to flip</span></div>` +
      `<div class="fc-side fc-back"><span class="fc-face">Back</span>${figHTML(c.figure_back)}<div class="fc-content">${c.back}</div>` +
      `<span class="fc-hint">Tap to flip back</span></div>`;
    card.onclick = () => { flipped = !flipped; card.classList.toggle('flipped', flipped); card.setAttribute('aria-pressed', String(flipped)); rate.classList.toggle('show', flipped);
      if (ix && flipped && ix.hidden) { ix.hidden = false; if (!ix.firstChild) mountIx(ix, c.interactive); } };
    scene.appendChild(card);
    wrap.appendChild(scene);
    math(card);
    let ix = null;
    if (c.interactive) {     // below the card (a <button> cannot hold controls); shown once flipped
      ix = h('div', 'fc-ix'); ix.hidden = !flipped && c.interactive.when !== 'before';
      wrap.appendChild(ix);
      if (!ix.hidden) mountIx(ix, c.interactive);
    }

    const nav = h('div', 'st-actions');
    const prev = h('button', 'btn-2', '← Prev'); prev.disabled = i === 0;
    prev.onclick = () => { i--; flipped = false; draw(); };
    const rate = h('div', 'fc-rate' + (flipped ? ' show' : ''));
    const bAgain = h('button', 'btn-again', 'Again');
    const bGot = h('button', 'btn-ok', 'Got it');
    const mark = up => {
      const r = store.get('astro.fc.' + c.id, { box: 1, seen: 0 });
      r.box = up ? Math.min(5, (r.box || 1) + 1) : 1; r.seen = (r.seen || 0) + 1;
      store.set('astro.fc.' + c.id, r);
      if (up) again.delete(c.id); else again.add(c.id);
      i++; flipped = false; draw();
    };
    bAgain.onclick = () => mark(false);
    bGot.onclick = () => mark(true);
    rate.append(bAgain, bGot);
    nav.append(prev, rate);
    wrap.appendChild(nav);
    card.focus({ preventScroll: true });
  }

  function done() {
    const n = again.size;
    const box = h('div', 'st-card st-done');
    box.innerHTML = `<div class="st-big">End of the deck</div>` +
      `<p>${deck.length - n} got it${n ? `, <b>${n}</b> to see again` : ''}.</p>`;
    const row = h('div', 'st-actions');
    if (n) { const b = h('button', 'btn-1', `Study the ${n} again`); b.onclick = () => start(true); row.appendChild(b); }
    const all = h('button', n ? 'btn-2' : 'btn-1', 'Whole deck again'); all.onclick = () => start(false);
    row.appendChild(all);
    if (ctx && ctx.openPractice && (set.questions || []).length) {
      const p = h('button', 'btn-2', 'Practice questions →'); p.onclick = ctx.openPractice; row.appendChild(p);
    }
    box.appendChild(row);
    wrap.appendChild(box);
  }

  again = new Set();
  wrap.tabIndex = -1;
  wrap.addEventListener('keydown', e => {
    if (e.key === ' ' && e.target.classList.contains('fc-card')) return;   // the button flips itself
    if (e.key === 'ArrowRight' && i < deck.length) { i++; flipped = false; draw(); }
    if (e.key === 'ArrowLeft' && i > 0) { i--; flipped = false; draw(); }
  });
  start(false);
}

/* ── printable duplex cards ──────────────────────────────────────────
   US Letter, 0.5 in page margins, fixed inch geometry: 2 columns × 4 rows of 3.75 × 2.45 in
   cards filling the 7.5 in wide printable area (see style.css for why not zero margins).  Sheets alternate FRONTS, BACKS.  On the backs page each row's
   columns are swapped, which is exactly what a long-edge duplex flip does to a portrait sheet,
   so every back lands behind its own front.  Dashed cut lines; corner ticks for checking. */
function printCards(set) {
  const cards = set.cards || [];
  const PER = 8, COLS = 2;
  let root = document.getElementById('printroot');
  if (root) root.remove();
  root = h('div'); root.id = 'printroot';
  const sheet = (list, back) => {
    const pg = h('div', 'pr-page' + (back ? ' back' : ''));
    list.forEach((c, k) => {
      const row = Math.floor(k / COLS), col = k % COLS;
      const x = back ? COLS - 1 - col : col;
      const cell = h('div', 'pr-card' + (back ? ' pr-back' : ''));
      cell.style.left = (3.75 * x) + 'in';
      cell.style.top = (2.45 * row) + 'in';
      cell.innerHTML = back
        ? `${figHTML(c.figure_back)}<div class="pr-content">${c.back}</div><div class="pr-foot">${esc(set.code || '')}</div>`
        : `<div class="pr-tag">${esc(c.tag)}${TAGS[c.tag] ? ' · ' + esc(TAGS[c.tag]) : ''}</div>${figHTML(c.figure)}<div class="pr-content">${c.front}</div><div class="pr-foot">${esc(set.title || '')} · ${esc(set.code || '')}</div>`;
      pg.appendChild(cell);
    });
    pg.appendChild(h('div', 'pr-note', back ? 'Backs' : `Fronts · print double-sided, <b>flip on long edge</b>, scale 100%, headers and footers off`));
    return pg;
  };
  for (let k = 0; k < cards.length; k += PER) {
    const chunk = cards.slice(k, k + PER);
    root.append(sheet(chunk, false), sheet(chunk, true));
  }
  document.body.appendChild(root);
  math(root);
  document.body.classList.add('printing-cards');
  const done = () => { document.body.classList.remove('printing-cards'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 60);
}

/* ── practice ────────────────────────────────────────────────────────── */

function practice(mount, set, ctx) {
  mount.innerHTML = '';
  const wrap = h('div', 'st-wrap');
  mount.appendChild(wrap);
  const all = set.questions || [];
  if (!all.length) { wrap.innerHTML = '<p class="st-empty">No practice questions in this set yet.</p>'; return; }
  const cardName = {};
  (set.cards || []).forEach(c => { cardName[c.id] = c.front.replace(/\$[^$]*\$/g, m => m).replace(/^Work an example:\s*/i, ''); });
  const SET_SIZE = (ctx && ctx.size) || 8;
  let run, i, attempts;

  function choose(onlyIds) {
    if (onlyIds) return all.filter(q => onlyIds.includes(q.id));
    // never-right first, then least recently seen; shuffled within ties
    const score = q => { const r = store.get('astro.q.' + q.id, null); return r ? (r.right ? 2 : 1) * 1e13 + (r.last || 0) : 0; };
    return shuffle(all).sort((a, b) => score(a) - score(b)).slice(0, SET_SIZE).sort(() => Math.random() - .5);
  }
  function start(onlyIds) {
    run = choose(onlyIds).map(q => { const vals = pickParams(q.params); return { q, vals }; });
    i = 0; attempts = [];
    draw();
  }

  function header() {
    const hd = h('div', 'st-head', `<div><h2>Practice</h2><p>${esc(set.title)} · try as many as you like; nothing is graded</p></div>`);
    if (ctx && ctx.openCards && (set.cards || []).length) {
      const b = h('button', 'st-link', 'Flashcards'); b.onclick = ctx.openCards; hd.appendChild(b);
    }
    return hd;
  }

  function draw() {
    wrap.innerHTML = '';
    wrap.appendChild(header());
    if (i >= run.length) return results();
    const { q, vals } = run[i];
    const ans = (q.format === 'numeric' || q.format === 'slider') ? evalAnswer(q.answer, vals) : null;
    const art = h('article', 'st-card q-card');
    art.dataset.qid = q.id; art.dataset.vals = JSON.stringify(vals);   // for tests and "this seems wrong" reports
    const skill = (q.skills || [])[0];
    art.appendChild(h('div', 'q-top', `<span>Question ${i + 1} of ${run.length}</span>` +
      (skill ? `<span class="st-chip">${esc(cardName[skill] || skill)}</span>` : '')));
    const bar = h('div', 'st-bar', '<div></div>'); bar.firstChild.style.width = (100 * i / run.length) + '%';
    art.appendChild(bar);
    const grid = h('div', 'q-grid' + (q.figure ? ' two' : ''));
    const left = h('div', 'q-left');
    left.appendChild(h('div', 'q-stem', fill(q.stem, q, vals)));
    if (q.figure) left.appendChild(h('div', 'q-fig', figHTML(q.figure, q, vals)));
    if (q.interactive && q.interactive.when !== 'after') { const d = h('div', 'q-fig'); left.appendChild(d); mountIx(d, q.interactive, q, vals); }
    const right = h('div', 'q-right');
    grid.append(left, right);
    art.appendChild(grid);
    const fb = h('div', 'q-feedback'); fb.hidden = true;
    art.appendChild(fb);
    const foot = h('div', 'q-foot');
    const check = h('button', 'btn-1', 'Check'); check.disabled = true;
    const next = h('button', 'btn-1', i + 1 < run.length ? 'Next →' : 'See results'); next.hidden = true;
    if (i + 1 >= run.length) next.className = 'btn-ok';
    foot.append(h('span', 'q-note', q.type ? esc(q.type) : ''), h('span', 'q-btns'));
    foot.lastChild.append(check, next);
    art.appendChild(foot);
    wrap.appendChild(art);

    const W = WIDGETS[q.format];
    const w = W(right, q, vals, ans, ok => { check.disabled = !ok; });
    check.onclick = () => {
      const res = w.check();
      w.lock();
      const r = store.get('astro.q.' + q.id, { right: 0, wrong: 0 });
      r[res.correct ? 'right' : 'wrong']++; r.last = Date.now();
      store.set('astro.q.' + q.id, r);
      attempts.push({ q, vals, correct: res.correct, shown: res.shown, stem: fill(q.stem, q, vals) });
      fb.hidden = false;
      fb.innerHTML = `<div class="q-verdict ${res.correct ? 'ok' : 'no'}">${res.correct ? '✓ Correct' : '✗ Not quite'}</div>` +
        (res.shown ? `<div class="q-shown">${res.shown}</div>` : '') +
        `<div class="q-exlabel">Explanation</div><div class="q-explain">${fill(q.explain, q, vals, ans)}</div>`;
      math(fb);
      if (q.interactive && q.interactive.when === 'after') {
        fb.appendChild(h('div', 'q-exlabel', 'Watch it'));
        const d = h('div', 'q-fig'); fb.appendChild(d); mountIx(d, q.interactive, q, vals);
      }
      check.hidden = true; next.hidden = false; next.focus({ preventScroll: true });
    };
    next.onclick = () => { i++; draw(); };
    math(art);
  }

  function results() {
    const right = attempts.filter(a => a.correct).length, n = attempts.length;
    const pct = n ? Math.round(100 * right / n) : 0;
    const top = h('div', 'st-card st-done');
    top.innerHTML = `<div class="st-big">You got ${right}/${n} <small>(${pct}%)</small></div>` +
      `<p>By skill below. Open one to see each question again.</p>`;
    wrap.appendChild(top);
    const bySkill = new Map();
    attempts.forEach(a => {
      const k = (a.q.skills || ['other'])[0];
      if (!bySkill.has(k)) bySkill.set(k, []);
      bySkill.get(k).push(a);
    });
    const ul = h('ul', 'res-list');
    for (const [k, as] of bySkill) {
      const r = as.filter(a => a.correct).length, p = Math.round(100 * r / as.length);
      const band = p >= 70 ? 'ok' : p >= 40 ? 'mid' : 'no';
      const li = h('li', 'st-card res-item');
      const det = h('details');
      det.innerHTML = `<summary><div><div class="res-name">${esc(cardName[k] || k)}</div>` +
        `<div class="res-slug">${as.length} question${as.length > 1 ? 's' : ''}</div></div>` +
        `<div class="res-score ${band}">${r}/${as.length}<small>${p}%</small></div></summary>`;
      const inner = h('div', 'res-attempts');
      as.forEach(a => {
        inner.appendChild(h('div', 'res-att',
          `<div class="res-att-top"><span>${esc(a.q.type || '')}</span>` +
          `<span class="${a.correct ? 'ok' : 'no'}">${a.correct ? '✓ Correct' : '✗ Not quite'}</span></div>` +
          `${a.q.figure ? `<div class="q-fig small">${figHTML(a.q.figure, a.q, a.vals)}</div>` : ''}<div class="q-stem small">${a.stem}</div>${a.shown ? `<div class="q-shown">${a.shown}</div>` : ''}`));
      });
      det.appendChild(inner);
      li.appendChild(det);
      ul.appendChild(li);
    }
    wrap.appendChild(ul);
    math(wrap);
    const row = h('div', 'st-actions');
    const missed = attempts.filter(a => !a.correct).map(a => a.q.id);
    if (missed.length) { const b = h('button', 'btn-1', `Try the ${missed.length} missed again`); b.onclick = () => start(missed); row.appendChild(b); }
    const again = h('button', missed.length ? 'btn-2' : 'btn-1', 'Another set'); again.onclick = () => start(null);
    row.appendChild(again);
    wrap.appendChild(row);
  }

  start(null);
}

/* ── widgets: each returns {check() -> {correct, shown}, lock()} ─────── */

const WIDGETS = {
  mc(root, q, vals, ans, ready) {
    root.appendChild(h('p', 'q-prompt', 'Choose one'));
    const list = h('div', 'mc-list');
    list.setAttribute('role', 'radiogroup');
    let pick = -1;
    const rows = q.choices.map((c, k) => {
      const b = h('button', 'mc-row', `<span class="mc-letter">${LETTERS[k]}</span><span class="mc-text">${fill(c, q, vals)}</span>`);
      b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
      b.onclick = () => { pick = k; rows.forEach((r, j) => { r.classList.toggle('on', j === k); r.setAttribute('aria-checked', String(j === k)); }); ready(true); };
      list.appendChild(b); return b;
    });
    root.appendChild(list);
    return {
      check() {
        rows[q.answer].classList.add('right');
        if (pick !== q.answer) rows[pick].classList.add('wrong');
        return { correct: pick === q.answer, shown: '' };
      },
      lock() { rows.forEach(r => { r.disabled = true; }); },
    };
  },

  numeric(root, q, vals, ans, ready) {
    root.appendChild(h('p', 'q-prompt', 'Your answer'));
    const row = h('div', 'num-row');
    const inp = h('input', 'num-in'); inp.type = 'text'; inp.inputMode = 'decimal'; inp.autocomplete = 'off';
    inp.placeholder = 'e.g. 4.5e12 or 4.5 x 10^12';
    row.append(inp, h('span', 'num-units', esc(q.units || '')));
    root.appendChild(row);
    const echo = h('div', 'num-echo'); root.appendChild(echo);
    root.appendChild(h('p', 'num-help', 'Scientific notation: type <b>3e8</b> or <b>3 x 10^8</b>.'));
    inp.oninput = () => {
      const v = parseNum(inp.value);
      ready(isFinite(v));
      echo.innerHTML = isFinite(v) && inp.value.trim() ? `reads as $${sig3(v)}$ ${esc(q.units || '')}` : (inp.value.trim() ? 'not a number yet' : '');
      math(echo);
    };
    inp.onkeydown = e => { if (e.key === 'Enter') { const b = root.closest('.q-card').querySelector('.q-btns .btn-1:not([hidden])'); if (b && !b.disabled) b.click(); } };
    setTimeout(() => inp.focus({ preventScroll: true }), 30);
    return {
      check() {
        const v = parseNum(inp.value), tol = q.tol == null ? 0.03 : q.tol;
        const ok = isFinite(v) && Math.abs(v - ans) <= tol * Math.abs(ans);
        inp.classList.add(ok ? 'right' : 'wrong');
        return { correct: ok, shown: `Answer: $${sig3(ans)}$ ${esc(q.units || '')}` };
      },
      lock() { inp.disabled = true; },
    };
  },

  order(root, q, vals, ans, ready) {
    root.appendChild(h('p', 'q-prompt', 'Drag into order (or use the arrows)'));
    const list = h('ol', 'ord-list');
    let order = shuffle(q.items.map((t, k) => k));
    if (order.every((v, k) => v === k)) order.reverse();
    let locked = false;
    function render() {
      list.innerHTML = '';
      order.forEach((k, pos) => {
        const li = h('li', 'ord-row', `<span class="ord-grip" aria-hidden="true">⋮⋮</span><span class="ord-text">${fill(q.items[k], q, vals)}</span>` +
          `<span class="ord-btns"><button type="button" aria-label="Move up">↑</button><button type="button" aria-label="Move down">↓</button></span>`);
        li.dataset.k = k;
        const [up, dn] = li.querySelectorAll('.ord-btns button');
        up.disabled = locked || pos === 0; dn.disabled = locked || pos === order.length - 1;
        up.onclick = () => { move(pos, pos - 1); };
        dn.onclick = () => { move(pos, pos + 1); };
        li.addEventListener('pointerdown', e => drag(e, li, pos));
        list.appendChild(li);
      });
      math(list);
    }
    function move(a, b) { const [x] = order.splice(a, 1); order.splice(b, 0, x); render(); }
    // Window-level listeners and an order array: pointer capture is lost when a row
    // moves in the DOM (the §1.3 sorter bug), so the row is never re-parented mid-drag.
    function drag(e, li, pos) {
      if (locked || e.target.closest('button')) return;
      e.preventDefault();
      const rows = [...list.children], rects = rows.map(r => r.getBoundingClientRect());
      const y0 = e.clientY, hgt = rects[pos].height + 6;
      li.classList.add('dragging');
      let target = pos;
      const mv = ev => {
        const dy = ev.clientY - y0;
        li.style.transform = `translateY(${dy}px)`;
        target = Math.max(0, Math.min(order.length - 1, pos + Math.round(dy / hgt)));
        rows.forEach((r, j) => {
          if (j === pos) return;
          const shift = (j > pos && j <= target) ? -hgt : (j < pos && j >= target) ? hgt : 0;
          r.style.transform = shift ? `translateY(${shift}px)` : '';
        });
      };
      const up = () => {
        window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        rows.forEach(r => { r.style.transform = ''; });
        li.classList.remove('dragging');
        if (target !== pos) move(pos, target);
      };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    }
    root.appendChild(list);
    render();
    ready(true);
    return {
      check() {
        const ok = order.every((k, j) => k === j);
        [...list.children].forEach((li, j) => li.classList.add(order[j] === j ? 'right' : 'wrong'));
        return { correct: ok, shown: ok ? '' : 'Correct order: ' + q.items.map((t, k) => `${k + 1}. ${fill(t, q, vals)}`).join(' &nbsp; ') };
      },
      lock() { locked = true; render(); [...list.children].forEach((li, j) => li.classList.add(order[j] === j ? 'right' : 'wrong')); },
    };
  },

  slider(root, q, vals, ans, ready) {
    root.appendChild(h('p', 'q-prompt', 'Slide to the power of ten'));
    const lo = q.min, hi = q.max;
    const box = h('div', 'sl-box');
    const read = h('div', 'sl-read');
    const inp = h('input', 'sl-in'); inp.type = 'range'; inp.min = lo; inp.max = hi; inp.step = 0.1;
    inp.value = ((lo + hi) / 2).toFixed(1);
    const ticks = h('div', 'sl-ticks');
    for (let e = lo; e <= hi; e++) {
      if ((hi - lo) > 12 && e % 2) continue;
      const t = h('span', '', `10<sup>${e}</sup>`); t.style.left = (100 * (e - lo) / (hi - lo)) + '%'; ticks.appendChild(t);
    }
    const mark = h('div', 'sl-mark'); mark.hidden = true;
    box.append(read, inp, ticks, mark);
    root.appendChild(box);
    const show = () => {
      const x = +inp.value, e = Math.floor(x), m = Math.pow(10, x - e);
      read.innerHTML = `$\\approx ${m.toFixed(1)}\\times10^{${e}}$ <span>${esc(q.units || '')}</span>`;
      math(read);
    };
    inp.oninput = () => { show(); ready(true); };
    show(); ready(true);
    return {
      check() {
        const x = +inp.value, t = Math.log10(Math.abs(ans)), tol = q.tol_dex == null ? 0.5 : q.tol_dex;
        const ok = Math.abs(x - t) <= tol;
        mark.hidden = false; mark.style.left = (100 * (t - lo) / (hi - lo)) + '%';
        box.classList.add(ok ? 'right' : 'wrong');
        return { correct: ok, shown: `Answer: $${sig3(ans)}$ ${esc(q.units || '')} (about $10^{${Math.round(t)}}$)` };
      },
      lock() { inp.disabled = true; },
    };
  },
};

window.Study = { flashcards, practice, printCards, _test: { parseNum, sig3, fill, pickParams, evalAnswer } };
})();

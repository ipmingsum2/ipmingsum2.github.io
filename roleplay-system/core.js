// Shared front-end helpers: SVG icons, API client, formatting, modal/toast, bar chart.
'use strict';

// Every icon is an inline SVG (24×24, stroked).
const ICONS = {
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.7 5.7l12.6 12.6"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  chart: '<path d="M3 21h18M6 21V11M11 21V5M16 21v-8M21 21V9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  rank: '<path d="m17 11-5-5-5 5M17 18l-5-5-5 5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.700 12.300 9.300-9.300M17 6l3 3M14 9l2 2"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.070 0l3-3a5 5 0 0 0-7.070-7.070l-1.500 1.500"/><path d="M14 11a5 5 0 0 0-7.070 0l-3 3a5 5 0 0 0 7.070 7.070l1.500-1.500"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.640-6.360L21 8"/><path d="M21 3v5h-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.300-4.300"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  edit: '<path d="M12 20h9"/><path d="M16.500 3.500a2.120 2.120 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.300 21a1.940 1.940 0 0 0 3.400 0"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z"/><path d="M4 21a2 2 0 0 0 2 2h14v-4"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  google: '<path d="M20 12h-8M20 12a8 8 0 1 1-2.340-5.660"/>',
  discord: '<path d="M8.500 6.500C10.800 6 13.200 6 15.500 6.500L17 4.500l3 1.500c1.500 3.200 2 6.500 1.500 10-1.500 1.200-3 2-4.500 2.500l-1.200-2.200c-2.500.700-5.100.700-7.600 0L7 18.500c-1.500-.500-3-1.300-4.500-2.500C2 12.500 2.500 9.200 4 6l3-1.500z"/><circle cx="9" cy="12" r="1.300"/><circle cx="15" cy="12" r="1.300"/>',
  swap: '<path d="M16 3l4 4-4 4M20 7H8M8 21l-4-4 4-4M4 17h12"/>',
  thumb: '<path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><path d="M7 10l4-8a3 3 0 0 1 3 3v4h5.500a2 2 0 0 1 2 2.300l-1.300 8A2 2 0 0 1 18.200 21H7"/>',
  clipboard: '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4V2h6v2M9 11h6M9 15h4"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h2l6 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M16 8.500a4.500 4.500 0 0 1 0 7M19 6a8 8 0 0 1 0 12"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  pin: '<path d="M12 17v5M9 3h6l-1 6 3 4H7l3-4z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.930 4.930l1.410 1.410M17.660 17.660l1.410 1.410M2 12h2M20 12h2M6.340 17.660l-1.410 1.410M19.070 4.930l-1.410 1.410"/>',
  moon: '<path d="M21 12.790A9 9 0 1 1 11.210 3 7 7 0 0 0 21 12.790z"/>',
  sparkle: '<path d="M12 3l1.900 5.100L19 10l-5.100 1.900L12 17l-1.900-5.100L5 10l5.100-1.900z"/><path d="M19 15l.800 2.200L22 18l-2.200.800L19 21l-.800-2.200L16 18l2.200-.800z"/>',
  roblox: '<path d="M6.500 3 21 6.500 17.500 21 3 17.500z"/><path d="m10.600 10 3.400.800-.800 3.400-3.400-.800z"/>',
};
const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const API_URL = String(window.RP_CONFIG?.API_URL || '').replace(/\/+$/, '');
/** Address Roblox scripts use (a pages.dev relay — Roblox refuses workers.dev). */
const ROBLOX_API_URL = String(window.RP_CONFIG?.ROBLOX_API_URL || API_URL).replace(/\/+$/, '');

// ---------- formatting ----------
const fmtDur = (sec) => { const m = Math.round((sec || 0) / 60); const h = Math.floor(m / 60); return h ? `${h}h ${m % 60}m` : `${m}m`; };
const fmtHours = (sec) => { const h = (sec || 0) / 3600; return h >= 100 ? Math.round(h).toLocaleString() : h.toFixed(1); };
const fmtDate = (ts) => new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const fmtTime = (ts) => new Date(ts * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDay = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const ago = (ts) => { const s = Date.now() / 1000 - ts; if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
// All activity is bucketed in UTC days; weeks start on Monday.
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (day, n) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekStart = (day) => addDays(day, -((new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7));

// ---------- API ----------
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};
/** `opts.public` sends the public (Discord) token instead of the dashboard session. */
async function api(path, opts = {}) {
  const headers = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.public) { const t = store.get('rp_ptoken'); if (t) headers['x-public-token'] = t; }
  else if (opts.access) { const t = store.get('rp_access'); if (t) headers['x-access-token'] = t; }
  else { const t = store.get('rp_token'); if (t) headers.authorization = `Bearer ${t}`; }
  let res;
  try {
    res = await fetch(API_URL + path, { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch { throw new Error('Could not reach the API. Check API_URL in config.js and that the Worker is deployed.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return data;
}

// ---------- theme ----------
// Each page sets data-theme from storage in <head>; with no choice the system setting applies.
const currentTheme = () => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
/** Switches theme with a soft cross-fade (no instant light/dark flash). */
function setTheme(t) {
  const html = document.documentElement;
  const apply = () => { html.dataset.theme = t; store.set('rp_theme', t); document.dispatchEvent(new CustomEvent('rp:theme', { detail: t })); };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return apply();
  // Chromium/Safari: blend the old and new page as one image. Others: transition every color.
  if (document.startViewTransition) { document.startViewTransition(apply); return; }
  html.classList.add('theme-fade');
  apply();
  clearTimeout(setTheme.timer);
  setTheme.timer = setTimeout(() => html.classList.remove('theme-fade'), 600);
}
const themeButton = (cls = '') => `<button class="btn ghost icon sm theme-btn ${cls}" data-theme-toggle aria-label="Switch between light and dark mode" title="Light / dark mode">${icon('sun', 'sun')}${icon('moon', 'moon')}</button>`;
document.addEventListener('click', (e) => { if (e.target.closest('[data-theme-toggle]')) setTheme(currentTheme() === 'dark' ? 'light' : 'dark'); });

// ---------- toast / modal ----------
function toast(msg, kind = '') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast ${kind}`; t.textContent = msg;
  box.append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3500);
}
/** Runs an async action from a button: disables it while pending and surfaces errors as a toast. */
async function run(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message, 'bad'); } finally { if (btn) btn.disabled = false; }
}
/**
 * modal({title, body(html), wide, actions:[{label, kind, onClick(close, el, btn)}]}) → {el, close}
 */
function modal({ title, body, actions = [], wide = false }) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="head"><h2 class="grow">${esc(title)}</h2><button class="btn ghost icon sm" data-x aria-label="Close">${icon('x')}</button></div>
    <div class="body">${body}</div><div class="foot"></div></div>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  $('[data-x]', ov).onclick = close;
  const foot = $('.foot', ov);
  for (const a of [{ label: 'Cancel', kind: 'ghost', onClick: (c) => c() }, ...actions]) {
    const b = document.createElement('button');
    b.className = `btn ${a.kind || ''}`; b.textContent = a.label;
    b.onclick = () => run(b, () => a.onClick(close, ov, b));
    foot.append(b);
  }
  document.body.append(ov);
  const first = $('.body input, .body select, .body textarea', ov);
  if (first) first.focus();
  return { el: ov, close };
}
const confirmBox = (title, text, label = 'Confirm', kind = 'danger') => new Promise((resolve) => {
  let done = false;
  const m = modal({ title, body: `<p class="dim">${esc(text)}</p>`, actions: [{ label, kind, onClick: (close) => { done = true; close(); resolve(true); } }] });
  new MutationObserver((_, o) => { if (!m.el.isConnected) { o.disconnect(); if (!done) resolve(false); } }).observe(document.body, { childList: true });
});
/** The verification game's Roblox link, set once by the owner ('' when not set). Fetched once per page. */
let verifyGamePromise = null;
function verifyGameUrl() {
  verifyGamePromise ||= api('/public/verify-game').then((d) => (/^https:\/\/(www\.)?roblox\.com\//i.test(d.url || '') ? d.url : '')).catch(() => '');
  return verifyGamePromise;
}
/** "Join to Verify" link button, or '' if the owner hasn't set the game link yet. */
async function joinVerifyButton(cls = 'btn primary') {
  const url = await verifyGameUrl();
  return url ? `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('roblox')} Join to Verify</a>` : '';
}

async function copyText(text) { try { await navigator.clipboard.writeText(text); toast('Copied', 'good'); } catch { toast('Copy failed — select and copy manually', 'bad'); } }
// ---------- filling in a form (applications, access requests) ----------
const shuffled = (list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function questionField(q) {
  const name = `q_${q.id}`;
  const opts = q.shuffle ? shuffled(q.options || []) : q.options || [];
  // "Other": a radio/checkbox plus a text box; typing in the box selects it.
  const other = (kind) => q.other ? `<label class="check other-opt"><input type="${kind}" name="${name}" value="${FormRules.OTHER}" ${kind === 'radio' && q.required ? 'required' : ''}> Other:
      <input class="other-text" name="${name}__other" maxlength="300" aria-label="${esc(q.label)} — other answer"></label>` : '';
  switch (q.type) {
    case 'choice': return `<div class="opts" role="radiogroup">${opts.map((o) => `<label class="check"><input type="radio" name="${name}" value="${esc(o)}" ${q.required ? 'required' : ''}> ${esc(o)}</label>`).join('')}${other('radio')}</div>`;
    case 'checkboxes': return `<div class="opts">${opts.map((o) => `<label class="check"><input type="checkbox" name="${name}" value="${esc(o)}"> ${esc(o)}</label>`).join('')}${other('checkbox')}</div>`;
    case 'dropdown': return `<select name="${name}" ${q.required ? 'required' : ''} aria-label="${esc(q.label)}"><option value="">Choose…</option>${opts.map((o) => `<option>${esc(o)}</option>`).join('')}</select>`;
    case 'date': return `<input type="date" name="${name}" ${q.required ? 'required' : ''} aria-label="${esc(q.label)}" style="max-width:220px">`;
    case 'time': return `<input type="time" name="${name}" ${q.required ? 'required' : ''} aria-label="${esc(q.label)}" style="max-width:160px">`;
    case 'scale': {
      let h = '';
      for (let n = q.min; n <= q.max; n++) h += `<label><input type="radio" name="${name}" value="${n}" ${q.required ? 'required' : ''}><span>${n}</span></label>`;
      return `<div class="scale-wrap">${q.minLabel ? `<span class="scale-end">${esc(q.minLabel)}</span>` : ''}<div class="scale" role="radiogroup">${h}</div>${q.maxLabel ? `<span class="scale-end">${esc(q.maxLabel)}</span>` : ''}</div>`;
    }
  }
  switch (q.type) {
    case 'short': return `<input name="${name}" maxlength="300" ${q.required ? 'required' : ''} aria-label="${esc(q.label)}">`;
    case 'paragraph': return `<textarea name="${name}" maxlength="4000" rows="5" ${q.required ? 'required' : ''} aria-label="${esc(q.label)}"></textarea>`;
    case 'number': return `<input type="number" step="any" name="${name}" ${q.min != null ? `min="${q.min}"` : ''} ${q.max != null ? `max="${q.max}"` : ''} ${q.required ? 'required' : ''} aria-label="${esc(q.label)}" style="max-width:220px">`;
    case 'yesno': return `<div class="opts" role="radiogroup">${['Yes', 'No'].map((o) => `<label class="check"><input type="radio" name="${name}" value="${o}" ${q.required ? 'required' : ''}> ${o}</label>`).join('')}</div>`;
  }
  return '';
}
/** Question cards for a form (sections become headings). */
const questionsHTML = (questions) => questions.map((q) => q.type === 'section'
  ? `<div style="margin-top:8px"><h2 style="font-size:17px">${esc(q.label)}</h2>${q.description ? `<p class="dim">${esc(q.description)}</p>` : ''}</div>`
  : `<div class="card q" data-q="${esc(q.id)}"><div><b>${esc(q.label)}</b>${q.required ? ' <span class="req" title="Required">*</span>' : ''}${q.description ? `<p class="hint">${esc(q.description)}</p>` : ''}</div>${questionField(q)}</div>`).join('');
/**
 * Reads answers keyed by question ID and checks them the same way the API does (FormRules).
 * Marks every failing question inline and returns { error, el } for the first one.
 */
function readAnswers(form, questions) {
  const fd = new FormData(form), answers = {};
  $$('.q-err', form).forEach((x) => x.remove());
  $$('.card.q.invalid', form).forEach((x) => x.classList.remove('invalid'));
  let first = null;
  const fail = (q, msg) => {
    const card = form.querySelector(`[data-q="${CSS.escape(q.id)}"]`);
    if (card) { card.classList.add('invalid'); card.insertAdjacentHTML('beforeend', `<p class="q-err" role="alert">${icon('alert', 'sm')} ${esc(msg)}</p>`); }
    if (!first) first = { error: `“${q.label}”: ${msg}`, el: card };
  };
  for (const q of questions) {
    if (q.type === 'section') continue;
    const otherText = (fd.get(`q_${q.id}__other`) ?? '').toString().trim();
    let v = q.type === 'checkboxes' ? fd.getAll(`q_${q.id}`) : (fd.get(`q_${q.id}`) ?? '').toString().trim();
    if (q.other) {
      const picked = Array.isArray(v) ? v.includes(FormRules.OTHER) : v === FormRules.OTHER;
      if (picked && !otherText) { fail(q, 'Type your answer next to “Other”.'); continue; }
      if (Array.isArray(v)) v = v.map((x) => (x === FormRules.OTHER ? otherText : x));
      else if (picked) v = otherText;
    }
    const empty = !v || !v.length;
    if (empty) { if (q.required) fail(q, 'This question is required.'); continue; }
    if (q.type === 'number' || q.type === 'scale') v = Number(v);
    const broken = FormRules.check(q, v);
    if (broken) { fail(q, broken); continue; }
    answers[q.id] = v;
  }
  return first || { answers };
}
/** Clicking or typing in an "Other" box selects its option (call once per form). */
function bindOtherInputs(form) {
  form.addEventListener('input', (e) => {
    if (!e.target.classList.contains('other-text')) return;
    const box = e.target.closest('.other-opt').querySelector('input[type="radio"], input[type="checkbox"]');
    if (box && e.target.value.trim()) box.checked = true;
  });
}

/** CSV from an array of rows (first row = headers). Cells that a spreadsheet would run as formulas are prefixed with '. */
function toCSV(rows) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n'); // BOM so Excel reads UTF-8
}
function downloadCSV(name, rows) { downloadFile(name, toCSV(rows), 'text/csv;charset=utf-8'); toast(`Exported ${rows.length - 1} row${rows.length === 2 ? '' : 's'}`, 'good'); }
function downloadFile(name, text, type = 'application/xml') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- bar chart (single series, hours) ----------
/**
 * barChart(el, [{label, value (seconds), sub, dim}]) — responsive SVG bars with a hover tooltip.
 * Bars are 4px-rounded at the data end and anchored to the baseline; grid and axes stay recessive.
 */
function barChart(el, items, { height = 220 } = {}) {
  el.classList.add('chart');
  const draw = () => {
    const W = Math.max(280, el.clientWidth || 600), H = height;
    const m = { l: 40, r: 6, t: 10, b: 24 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const maxH = Math.max(...items.map((d) => d.value), 0) / 3600;
    const step = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((s) => maxH / s <= 4) || 2000;
    const top = Math.max(step, Math.ceil(maxH / step) * step);
    const slot = pw / Math.max(1, items.length);
    const bw = Math.max(2, Math.min(34, slot - 2));
    const every = Math.max(1, Math.ceil(items.length / Math.max(1, Math.floor(pw / 58))));
    let g = '';
    for (let v = 0; v <= top + 1e-9; v += step) {
      const y = m.t + ph - (v / top) * ph;
      g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text class="axis" x="${m.l - 8}" y="${y + 4}" text-anchor="end">${+v.toFixed(2)}h</text>`;
    }
    let bars = '';
    items.forEach((d, i) => {
      const x = m.l + i * slot + (slot - bw) / 2;
      const h = Math.max(d.value > 0 ? 2 : 0, (d.value / 3600 / top) * ph);
      const y = m.t + ph - h, r = Math.min(4, bw / 2, h);
      bars += `<rect class="hit" data-i="${i}" x="${m.l + i * slot}" y="${m.t}" width="${slot}" height="${ph}"/>`;
      if (h > 0) bars += `<path class="bar ${d.dim ? 'dim' : ''}" data-b="${i}" d="M${x},${y + h}V${y + r}a${r},${r} 0 0 1 ${r},${-r}h${bw - 2 * r}a${r},${r} 0 0 1 ${r},${r}V${y + h}z"/>`;
      if (i % every === 0) bars += `<text class="axis" x="${m.l + i * slot + slot / 2}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Hours played per period">${g}${bars}</svg><div class="tip hidden"></div>`;
    const tip = $('.tip', el);
    el.onmousemove = (e) => {
      const hit = e.target.closest('.hit');
      $$('.bar.hot', el).forEach((b) => b.classList.remove('hot'));
      if (!hit) { tip.classList.add('hidden'); return; }
      const i = +hit.dataset.i, d = items[i];
      $(`[data-b="${i}"]`, el)?.classList.add('hot');
      tip.innerHTML = `<b>${fmtDur(d.value)}</b>${esc(d.tip || d.label)}${d.sub ? `<br><span class="muted">${esc(d.sub)}</span>` : ''}`;
      tip.classList.remove('hidden');
      const cx = m.l + i * slot + slot / 2;
      tip.style.left = `${Math.min(W - 70, Math.max(70, cx))}px`;
      tip.style.top = `${Math.max(34, m.t + ph - (d.value / 3600 / top) * ph - 8)}px`;
    };
    el.onmouseleave = () => { tip.classList.add('hidden'); $$('.bar.hot', el).forEach((b) => b.classList.remove('hot')); };
  };
  draw();
  if (el._ro) el._ro.disconnect();
  let lastW = el.clientWidth;
  el._ro = new ResizeObserver(() => { if (el.clientWidth !== lastW) { lastW = el.clientWidth; draw(); } });
  el._ro.observe(el);
}

/** Turns a per-day series into daily or weekly bars covering a fixed window ending today. */
function bucketSeries(series, mode, { days = 14, weeks = 12 } = {}) {
  const map = new Map(series.map((d) => [d.day, d]));
  const t = today();
  if (mode === 'weekly') {
    const out = [];
    for (let w = weeks - 1; w >= 0; w--) {
      const start = addDays(weekStart(t), -7 * w);
      let sum = 0;
      for (let i = 0; i < 7; i++) sum += map.get(addDays(start, i))?.seconds || 0;
      out.push({ label: fmtDay(start), tip: `Week of ${fmtDay(start)}`, value: sum, dim: w !== 0, sub: w === 0 ? 'This week so far' : '' });
    }
    return out;
  }
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(t, -i), d = map.get(day);
    out.push({ label: fmtDay(day), tip: fmtDay(day), value: d?.seconds || 0, dim: i !== 0, sub: d?.members ? `${d.members} member${d.members === 1 ? '' : 's'} active` : (i === 0 ? 'Today so far' : '') });
  }
  return out;
}

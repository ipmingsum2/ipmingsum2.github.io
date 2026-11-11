// Dashboard shell: sign-in, navigation, hash router. Views register themselves on VIEWS.
'use strict';

const S = { user: null, groups: [], gid: null, permissions: [], scopes: [] };
const VIEWS = {};
const can = (p) => S.user.role === 'owner' || S.user.permissions.includes(p);
const group = () => S.groups.find((g) => g.id === S.gid) || null;
const G = (path = '') => `/api/groups/${S.gid}${path}`;
const NAME = window.RP_CONFIG?.NAME || 'Roleplay System';

const NAV = [
  ['Group'],
  ['', 'Overview', 'home'],
  ['activity', 'Activity', 'chart'],
  ['requirements', 'Requirements', 'target'],
  ['timeoff', 'Time off', 'calendar'],
  ['ranking', 'Ranking', 'rank', () => can('ranking')],
  ['sessions', 'Sessions', 'clock'],
  ['applications', 'Applications', 'file', () => can('manage_applications') || can('review_applications')],
  ['logs', 'Logs', 'list', () => can('view_logs')],
  ['System'],
  ['groups', 'Groups', 'users', () => can('manage_groups')],
  ['api', 'API', 'key', () => can('manage_api_keys')],
  ['links', 'Linked accounts', 'link'],
  ['access', 'Access', 'shield', () => S.user.role === 'owner'],
  ['account', 'My account', 'user'],
];

const ERRORS = {
  not_whitelisted: 'That account is not on the whitelist. Ask the owner to add your Google email or Discord ID.',
  invalid_state: 'The sign-in link expired. Please try again.', expired: 'The sign-in took too long. Please try again.',
  cancelled: 'Sign-in was cancelled.', provider_error: 'The sign-in provider returned an error. Please try again.',
};

function loginScreen(error) {
  const dev = ['localhost', '127.0.0.1'].includes(location.hostname);
  $('#root').innerHTML = `<div class="center"><div class="login">
    <div class="mark">${icon('shield', 'lg')}</div>
    <h1>${esc(NAME)}</h1>
    <p class="dim">Access is whitelist-only. Sign in with an account the owner has approved.</p>
    ${error ? `<div class="callout bad" role="alert">${icon('alert')}<span>${esc(error)}</span></div>` : ''}
    <a class="btn big" href="${API_URL}/auth/google/start">${icon('google')} Continue with Google</a>
    <a class="btn big" href="${API_URL}/auth/discord/start">${icon('discord')} Continue with Discord</a>
    ${dev ? `<button class="btn ghost" id="dev">Local development sign-in</button>` : ''}
    <p class="muted"><a href="verify.html">Link Discord to Roblox</a> · <a href="docs.html">API docs</a></p>
  </div></div>`;
  if (dev) $('#dev').onclick = (e) => run(e.target, async () => { store.set('rp_token', (await api('/auth/dev', { method: 'POST' })).token); boot(); });
}

async function boot() {
  const h = location.hash;
  if (h.startsWith('#token=')) { store.set('rp_token', h.slice(7)); history.replaceState(null, '', location.pathname + '#/'); }
  if (h.startsWith('#error=')) { const code = decodeURIComponent(h.slice(7)); history.replaceState(null, '', location.pathname); return loginScreen(ERRORS[code] || 'Sign-in failed.'); }
  if (!store.get('rp_token')) return loginScreen();
  try {
    const me = await api('/api/me');
    Object.assign(S, { user: me.user, permissions: me.permissions, scopes: me.scopes });
    await loadGroups();
  } catch (e) {
    if (e.status === 401) { store.set('rp_token', null); return loginScreen('Your session expired. Please sign in again.'); }
    return loginScreen(e.message);
  }
  const p = new URLSearchParams(location.search);
  if (p.get('linked')) toast(`${p.get('linked')[0].toUpperCase() + p.get('linked').slice(1)} account linked`, 'good');
  if (p.get('link_error')) toast('That account is already linked to another dashboard user.', 'bad');
  if (p.has('linked') || p.has('link_error')) history.replaceState(null, '', location.pathname + location.hash);
  shell();
  window.onhashchange = route;
  route();
}

async function loadGroups() {
  S.groups = (await api('/api/groups')).groups;
  const saved = store.get('rp_gid');
  S.gid = S.groups.some((g) => g.id === saved) ? saved : S.groups[0]?.id || null;
}

function shell() {
  $('#root').innerHTML = `<div class="app">
    <aside class="side" id="side">
      <div class="brand"><span class="mark">${icon('shield')}</span><span>${esc(NAME)}</span></div>
      <nav class="nav" id="nav" aria-label="Main"></nav>
    </aside>
    <div class="main">
      <header class="top">
        <button class="btn ghost icon menu-btn" id="menu" aria-label="Menu">${icon('menu')}</button>
        <div id="groupPick" class="row"></div>
        <div class="right row">
          <a class="btn ghost sm" href="#/account">${icon('user', 'sm')} ${esc(S.user.name || S.user.googleEmail || 'Account')}${S.user.role === 'owner' ? ' <span class="badge accent">Owner</span>' : ''}</a>
          <button class="btn ghost icon sm" id="logout" aria-label="Sign out" title="Sign out">${icon('logout')}</button>
        </div>
      </header>
      <main class="page" id="view"></main>
    </div></div>`;
  $('#menu').onclick = () => $('#side').classList.toggle('open');
  $('#logout').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); store.set('rp_token', null); location.hash = ''; boot(); };
  drawGroupPick();
}

function drawGroupPick() {
  const el = $('#groupPick');
  if (!S.groups.length) { el.innerHTML = '<span class="muted">No groups yet</span>'; return; }
  el.innerHTML = `${icon('users')}<select id="gsel" aria-label="Group" style="width:auto;min-width:180px">${S.groups.map((g) => `<option value="${g.id}" ${g.id === S.gid ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>`;
  $('#gsel').onchange = (e) => { S.gid = e.target.value; store.set('rp_gid', S.gid); route(); };
}

function drawNav(current) {
  $('#nav').innerHTML = NAV.map(([path, label, ic, show]) => {
    if (label === undefined) return `<div class="nav-label">${path}</div>`;
    if (show && !show()) return '';
    return `<a href="#/${path}" class="${path === current ? 'on' : ''}" ${path === current ? 'aria-current="page"' : ''}>${icon(ic)} ${label}</a>`;
  }).join('');
}

const NO_GROUP_OK = new Set(['groups', 'api', 'links', 'access', 'account', 'logs']);
let routeSeq = 0;
async function route() {
  const [name = '', arg, arg2] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const key = name === '' ? 'overview' : name === 'member' ? 'member' : name;
  const navKey = name === 'member' ? 'activity' : name;
  drawNav(navKey);
  $('#side').classList.remove('open');
  const el = $('#view');
  const seq = ++routeSeq;
  const view = VIEWS[key];
  if (!view) { el.innerHTML = `<div class="empty">${icon('alert')}<div>Page not found.</div></div>`; return; }
  if (!S.gid && !NO_GROUP_OK.has(key)) {
    el.innerHTML = `<div class="card"><div class="empty">${icon('users')}<div><b>No groups yet</b></div><p>${can('manage_groups') ? 'Add your first Roblox group to start tracking.' : 'Ask someone with group access to add a Roblox group.'}</p>${can('manage_groups') ? '<p style="margin-top:12px"><a class="btn primary" href="#/groups">Add a group</a></p>' : ''}</div></div>`;
    return;
  }
  el.innerHTML = '<div class="empty">Loading…</div>';
  try {
    // Render into a detached node so a slow response can never overwrite a newer page.
    const box = document.createElement('div');
    box.className = 'stack';
    await view(box, arg, arg2, () => { if (seq === routeSeq) route(); });
    if (seq === routeSeq) el.replaceChildren(box);
  } catch (e) {
    if (seq !== routeSeq) return;
    if (e.status === 401) { store.set('rp_token', null); return boot(); }
    el.innerHTML = `<div class="callout bad" role="alert">${icon('alert')}<span>${esc(e.message)}</span></div>`;
  }
}

// ---------- shared view pieces ----------
const head = (title, sub = '', actions = '') => `<div class="page-head"><div class="grow"><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="row wrap">${actions}</div></div>`;
const who = (name, sub = '') => `<div class="who"><span class="ava">${esc(String(name || '?')[0].toUpperCase())}</span><span class="grow"><b>${esc(name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span></div>`;
const emptyRow = (cols, text, ic = 'info') => `<tr><td colspan="${cols}"><div class="empty">${icon(ic)}<div>${text}</div></div></td></tr>`;
const statusBadge = (s) => `<span class="badge ${{ approved: 'good', accepted: 'good', completed: 'good', pending: 'warn', scheduled: 'accent', denied: 'bad', cancelled: 'bad' }[s] || ''}">${esc(s)}</span>`;
const stat = (k, v, s = '', ic = '') => `<div class="stat"><div class="k">${ic ? icon(ic, 'sm') : ''}${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
const seg = (id, opts, cur) => `<div class="seg" id="${id}" role="group">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}" aria-pressed="${v === cur}">${l}</button>`).join('')}</div>`;
function onSeg(root, id, fn) {
  $(`#${id}`, root).onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('button', e.currentTarget).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    fn(b.dataset.v);
  };
}
const val = (root, sel) => $(sel, root).value.trim();
const rolesOf = (g = group()) => (g?.roles || []).filter((r) => r.rank > 0);

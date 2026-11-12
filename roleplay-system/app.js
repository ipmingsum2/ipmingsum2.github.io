// Dashboard shell: sign-in, navigation, hash router. Views register themselves on VIEWS.
'use strict';

const S = { user: null, groups: [], gid: null, permissions: [], scopes: [] };
const VIEWS = {};
const OWNER = 'owner'; // the Owner Menu context (S.gid === OWNER)
const isOwner = () => S.user?.role === 'owner';
const inOwnerMenu = () => S.gid === OWNER;
const can = (p) => isOwner() || S.user.permissions.includes(p);
const group = () => S.groups.find((g) => g.id === S.gid) || null;
const G = (path = '') => `/api/groups/${S.gid}${path}`;
const NAME = window.RP_CONFIG?.NAME || 'Roleplay System';

// Sidebar for a group. System pages appear here only for non-owners with the permission — the owner has them in the Owner Menu.
const GROUP_NAV = () => [
  [group()?.name || 'Group'],
  ['', 'Overview', 'home'],
  ['news', 'News', 'megaphone'],
  ['activity', 'Activity', 'chart'],
  ['requirements', 'Requirements', 'target'],
  ['timeoff', 'Time off', 'calendar'],
  ['logbook', 'Logbook', 'clipboard'],
  ['ranking', 'Ranking', 'rank', () => can('ranking')],
  ['promotions', 'Promotions', 'thumb'],
  ['autopromote', 'Auto-promotion', 'sparkle'],
  ['sessions', 'Sessions', 'clock'],
  ['applications', 'Applications', 'file', () => can('manage_applications') || can('review_applications')],
  ['blacklist', 'Blacklist', 'ban'],
  ['kb', 'Knowledgebase', 'book'],
  ['logs', 'Logs', 'list', () => can('view_logs')],
  ...(isOwner() ? [] : [
    ['System', null, null, () => can('manage_groups') || can('manage_api_keys')],
    ['groups', 'Groups', 'users', () => can('manage_groups')],
    ['api', 'API', 'key', () => can('manage_api_keys')],
    ['links', 'Linked accounts', 'link'],
  ]),
  ['Account'],
  ['account', 'My account', 'user'],
];
const OWNER_NAV = () => [
  ['Owner Menu'],
  ['', 'Overview', 'home'],
  ['groups', 'Groups', 'users'],
  ['access', 'Access & whitelist', 'shield'],
  ['requests', 'Access requests', 'inbox'],
  ['api', 'API keys', 'key'],
  ['verification', 'Verification game', 'roblox'],
  ['links', 'Linked accounts', 'link'],
  ['logs', 'All logs', 'list'],
  ['Account'],
  ['account', 'My account', 'user'],
];
// Pages that belong to a group (need S.gid to be a real group).
const GROUP_PAGES = new Set(['overview', 'activity', 'member', 'requirements', 'timeoff', 'ranking', 'sessions', 'applications', 'submission', 'news', 'logbook', 'promotions', 'kb', 'blacklist', 'autopromote']);
// Pages highlighted under another sidebar entry.
const NAV_PARENT = { member: 'activity', submission: 'applications' };
// Deep links from outside (e.g. Discord's "Decide" button): #/go/<groupId>/<page…> switches group, then opens the page.
const isDeepLink = (h) => /^#\/go\/[^/]+\/./.test(h || '');

const ERRORS = {
  not_whitelisted: 'That account is not on the whitelist. Ask the owner to add your Google email or Discord ID.',
  invalid_state: 'The sign-in link expired. Please try again.', expired: 'The sign-in took too long. Please try again.',
  cancelled: 'Sign-in was cancelled.', provider_error: 'The sign-in provider returned an error. Please try again.',
};

function loginScreen(error) {
  // Remember a deep link so it opens right after signing in.
  if (isDeepLink(location.hash)) store.set('rp_next', location.hash);
  const dev = ['localhost', '127.0.0.1'].includes(location.hostname);
  $('#root').innerHTML = `<div class="corner-theme">${themeButton()}</div><div class="center"><div class="login">
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
  if (h.startsWith('#token=')) {
    store.set('rp_token', h.slice(7));
    store.set('rp_gid', null); // a fresh sign-in starts at the picker, unless a deep link was waiting
    const next = store.get('rp_next');
    store.set('rp_next', null);
    history.replaceState(null, '', location.pathname + (isDeepLink(next) ? next : '#/select'));
  } else if (isDeepLink(h)) store.set('rp_next', null);
  // Signed in with an account that isn't whitelisted: show the access request form.
  if (h.startsWith('#access=')) {
    store.set('rp_access', h.slice(8));
    history.replaceState(null, '', location.pathname + '#/request-access');
    return accessScreen();
  }
  if (h === '#/request-access' && !store.get('rp_token') && store.get('rp_access')) return accessScreen();
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
  window.onhashchange = route;
  route();
}

/** Refreshes the group list and keeps the current context only while it is still valid. */
async function loadGroups() {
  S.groups = (await api('/api/groups')).groups;
  const valid = (id) => (id === OWNER && isOwner()) || S.groups.some((g) => g.id === id);
  const cur = S.gid ?? store.get('rp_gid');
  S.gid = valid(cur) ? cur : null;
  // Someone with exactly one place to go skips the picker.
  if (!S.gid && !isOwner() && S.groups.length === 1) S.gid = S.groups[0].id;
}

/** `replace` swaps the current history entry (so Back doesn't bounce through a #/go/ link). */
function enter(id, hash = '#/', replace = false) {
  S.gid = id;
  store.set('rp_gid', id);
  if (replace) { history.replaceState(null, '', location.pathname + hash); route(); }
  else if (location.hash === hash) route(); else location.hash = hash;
}

// ---------- access request (signed in, not whitelisted) ----------
async function accessScreen() {
  const root = $('#root');
  root.onclick = null;
  root.innerHTML = `<div class="corner-theme">${themeButton()}</div><main class="public" id="req"><div class="empty">Loading…</div></main>`;
  const box = $('#req');
  let d;
  try { d = await api('/public/access-request', { access: true }); } catch (e) {
    store.set('rp_access', null);
    history.replaceState(null, '', location.pathname);
    return loginScreen(e.status === 401 ? 'Your sign-in for the access request expired. Sign in again to continue.' : e.message);
  }
  const id = d.identity;
  const account = id.provider === 'google' ? `${icon('google', 'sm')} <b>${esc(id.id)}</b>` : `${icon('discord', 'sm')} <b>${esc(id.name || 'Discord user')}</b> <span class="muted mono">${esc(id.id)}</span>`;
  const signIn = `${API_URL}/auth/${id.provider}/start`;
  const top = (title, sub) => `<div class="card"><div class="body stack gap-s">
      <div class="row"><span class="mark">${icon('shield')}</span><span class="dim">${esc(NAME)}</span></div>
      <h1>${title}</h1>${sub ? `<p class="dim">${sub}</p>` : ''}
      <div class="row wrap acct"><span class="muted">Signed in as</span><span class="row gap-s">${account}</span><button class="btn ghost sm right" data-other>Use a different account</button></div>
    </div></div>`;
  const message = (ic, title, text, extra = '') => `${top(title)}<div class="card"><div class="empty">${icon(ic, 'lg')}<div>${text}</div>${extra}</div></div>`;
  const r = d.request;
  const waitUntil = r?.status === 'denied' && r.retryAt * 1000 > Date.now() ? r.retryAt : null;

  if (d.whitelisted) box.innerHTML = message('check', 'You have access', 'The owner approved this account. Sign in again to open the dashboard.', `<a class="btn primary" href="${signIn}">Sign in</a>`);
  else if (r?.status === 'pending') box.innerHTML = message('clock', 'Request sent', `Your access request from ${fmtTime(r.created_at)} is waiting for the owner. Sign in again later — once it’s approved you’ll go straight to the dashboard.`);
  else if (waitUntil) box.innerHTML = message('x', 'Request denied', `The owner denied your request.${r.review_note ? `<div class="note" style="margin-top:10px;text-align:left"><b>Note:</b> ${esc(r.review_note)}</div>` : ''}`, `<p class="muted">You can send a new request after ${fmtTime(waitUntil)}.</p>`);
  else if (!d.enabled) box.innerHTML = message('alert', 'No access', 'This account isn’t on the whitelist, and access requests are closed. Ask the owner to add you.');
  else {
    box.innerHTML = `${top('You don’t have access yet', 'This account isn’t on the whitelist. Send an access request and the owner will review it.')}
      ${r?.status === 'denied' ? `<div class="callout warn">${icon('alert')}<span>Your previous request was denied${r.review_note ? `: ${esc(r.review_note)}` : '.'} You can try again.</span></div>` : ''}
      ${d.form.intro ? `<div class="card"><div class="body"><p style="white-space:pre-wrap;margin:0">${esc(d.form.intro)}</p></div></div>` : ''}
      <form id="f" class="stack" novalidate>${questionsHTML(d.form.questions)}
        <div id="err" role="alert"></div>
        <div class="row"><button class="btn primary" style="height:42px;padding:0 22px" id="send">${icon('inbox')} Send access request</button><span class="muted"><span class="req" style="color:var(--bad)">*</span> required</span></div>
      </form>`;
    const err = (msg, el) => { $('#err').innerHTML = `<div class="callout bad">${icon('alert')}<span>${esc(msg)}</span></div>`; el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    bindOtherInputs($('#f'));
    $('#f').onsubmit = (e) => {
      e.preventDefault();
      const { answers, error, el } = readAnswers(e.target, d.form.questions);
      if (error) return err(error, el);
      run($('#send'), async () => {
        $('#err').innerHTML = '';
        try { await api('/public/access-request', { access: true, body: { answers } }); accessScreen(); } catch (e2) { err(e2.message); }
      });
    };
  }
  $('[data-other]', box).onclick = () => { store.set('rp_access', null); history.replaceState(null, '', location.pathname); loginScreen(); };
}

// ---------- picker ----------
function picker() {
  const owner = isOwner();
  $('#root').innerHTML = `<div class="corner-theme row">${themeButton()}<button class="btn ghost icon sm" data-logout aria-label="Sign out" title="Sign out">${icon('logout')}</button></div>
    <main class="picker">
      <div class="row"><span class="mark">${icon('shield')}</span><span class="dim">${esc(NAME)}</span></div>
      <div><h1>Where do you want to work?</h1><p class="dim">Signed in as <b>${esc(S.user.name || S.user.googleEmail || S.user.discordName || 'you')}</b>${owner ? ' <span class="badge accent">Owner</span>' : ''}. You can switch any time from the top bar.</p></div>
      <div class="pick-grid" id="picks">
        ${owner ? `<button class="pick owner" data-pick="${OWNER}">
          <div class="row"><span class="pi">${icon('shield')}</span><span class="badge accent">Owner only</span></div>
          <div><h2>Owner Menu</h2><p class="dim">Whitelist and permissions, every group, API keys, linked accounts and logs across all groups.</p></div>
          <div class="pick-meta" id="ownerMeta"><span><b>${S.groups.length}</b> group${S.groups.length === 1 ? '' : 's'}</span></div>
        </button>` : ''}
        ${S.groups.map((g) => `<button class="pick" data-pick="${esc(g.id)}">
          <div class="row"><span class="pi">${icon('users')}</span><span class="muted mono grow">${esc(g.id)}</span>${g.hasApiKey ? '' : '<span class="badge warn" title="Ranking needs an Open Cloud key">No Open Cloud key</span>'}</div>
          <div><h2>${esc(g.name)}</h2><p class="dim">${g.trackedRanks.length ? `${g.trackedRanks.length} tracked rank${g.trackedRanks.length === 1 ? '' : 's'}` : 'No ranks tracked yet'}</p></div>
          <div class="pick-meta" data-meta="${esc(g.id)}"><span class="muted">Loading…</span></div>
        </button>`).join('')}
        ${owner ? `<button class="pick add" data-add>${icon('plus', 'lg')}<span>Add a group</span></button>` : ''}
      </div>
      ${!owner && !S.groups.length ? `<div class="card"><div class="empty">${icon('users')}<div><b>No groups yet</b></div><p>Ask the owner to add a Roblox group.</p></div></div>` : ''}
    </main>`;
  $('#root').onclick = (e) => {
    const p = e.target.closest('[data-pick]');
    if (p) return enter(p.dataset.pick);
    if (e.target.closest('[data-add]')) return enter(OWNER, '#/groups');
    if (e.target.closest('[data-logout]')) logout();
  };
  // Live numbers for each card (a failure just leaves the card without them).
  for (const g of S.groups) {
    const meta = () => $(`[data-meta="${CSS.escape(g.id)}"]`);
    api(`/api/groups/${g.id}/overview`).then((o) => {
      const el = meta(); if (!el) return;
      const pending = o.pendingTimeOff + o.pendingApplications;
      el.innerHTML = `<span><b>${o.trackedMembers}</b> tracked</span><span>${o.online ? '<span class="dot"></span> ' : ''}<b>${o.online}</b> in game</span><span><b>${fmtHours(o.week.seconds)}h</b> this week</span>${pending ? `<span class="badge warn">${pending} pending</span>` : ''}`;
    }).catch(() => { const el = meta(); if (el) el.innerHTML = ''; });
  }
  if (owner) api('/api/users').then((u) => { const el = $('#ownerMeta'); if (el) el.insertAdjacentHTML('beforeend', `<span><b>${u.users.length}</b> whitelisted</span>`); }).catch(() => {});
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  store.set('rp_token', null); store.set('rp_gid', null);
  S.gid = null;
  history.replaceState(null, '', location.pathname);
  boot();
}

// ---------- shell ----------
function shell() {
  $('#root').onclick = null;
  $('#root').innerHTML = `<div class="app">
    <aside class="side" id="side">
      <div class="brand"><span class="mark">${icon('shield')}</span><span>${esc(NAME)}</span></div>
      <nav class="nav" id="nav" aria-label="Main"></nav>
    </aside>
    <div class="main">
      <header class="top">
        <button class="btn ghost icon menu-btn" id="menu" aria-label="Menu">${icon('menu')}</button>
        <a class="btn ctx" id="ctx" href="#/select" title="Switch group"></a>
        <button class="btn ghost sm kbtn" id="kbtn" aria-label="Search (Ctrl+K)" title="Search (Ctrl+K)">${icon('search', 'sm')} <span class="hide-sm">Search</span> <kbd class="hide-sm">Ctrl K</kbd></button>
        <div class="right row">
          <a class="btn ghost sm" href="#/account">${icon('user', 'sm')} <span class="hide-sm">${esc(S.user.name || S.user.googleEmail || 'Account')}</span>${isOwner() ? ' <span class="badge accent">Owner</span>' : ''}</a>
          ${themeButton()}
          <button class="btn ghost icon sm" data-logout aria-label="Sign out" title="Sign out">${icon('logout')}</button>
        </div>
      </header>
      <main class="page" id="view"></main>
    </div></div>`;
  $('#menu').onclick = () => $('#side').classList.toggle('open');
  $('[data-logout]').onclick = logout;
  $('#kbtn').onclick = palette;
}

// ---------- quick search (Ctrl+K) ----------
const memberCache = new Map(); // gid -> members (fetched once per page load)
async function paletteItems() {
  const items = [];
  const nav = (list, ctxLabel, ctxId) => list.filter(([, label, , show]) => label && (!show || show())).forEach(([path, label, ic]) =>
    items.push({ label, hint: ctxLabel, ic, go: () => (ctxId === S.gid ? (location.hash = `#/${path}`) : enter(ctxId, `#/${path}`)) }));
  if (inOwnerMenu()) nav(OWNER_NAV(), 'Owner Menu', OWNER); else if (group()) nav(GROUP_NAV(), group().name, S.gid);
  if (isOwner() && !inOwnerMenu()) items.push({ label: 'Owner Menu', hint: 'Switch', ic: 'shield', go: () => enter(OWNER) });
  S.groups.filter((g) => g.id !== S.gid).forEach((g) => items.push({ label: g.name, hint: 'Switch group', ic: 'users', go: () => enter(g.id) }));
  items.push({ label: 'Toggle light / dark theme', hint: 'Action', ic: 'moon', go: () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark') });
  items.push({ label: 'Sign out', hint: 'Action', ic: 'logout', go: logout });
  if (group()) {
    if (!memberCache.has(S.gid)) memberCache.set(S.gid, api(G('/members')).then((d) => d.members).catch(() => []));
    (await memberCache.get(S.gid)).forEach((m) => items.push({ label: m.username, sub: m.displayName && m.displayName !== m.username ? m.displayName : '', hint: m.roleName || 'Member', ic: 'user', member: true, go: () => { location.hash = `#/member/${m.robloxId}`; } }));
  }
  return items;
}
async function palette() {
  if ($('.palette')) return;
  const ov = document.createElement('div');
  ov.className = 'overlay palette-ov';
  ov.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="Search">
      <div class="pal-in">${icon('search')}<input id="palQ" placeholder="Search pages, groups and members…" autocomplete="off" spellcheck="false" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="palList"><kbd>Esc</kbd></div>
      <div class="pal-list" id="palList" role="listbox"><div class="empty">Loading…</div></div>
      <div class="pal-foot muted small"><span><kbd>${icon('up', 'inl')}</kbd><kbd>${icon('down', 'inl')}</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Ctrl</kbd><kbd>K</kbd> anytime</span></div></div>`;
  document.body.append(ov);
  const input = $('#palQ', ov), list = $('#palList', ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
  let items = [], shown = [], sel = 0;
  const draw = () => {
    const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (it) => { const s = `${it.label} ${it.sub || ''} ${it.hint || ''}`.toLowerCase(); return words.every((w) => s.includes(w)); };
    // With no query: pages and actions only; members appear once you type.
    shown = (words.length ? items.filter(hit) : items.filter((it) => !it.member)).slice(0, 40);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length ? shown.map((it, i) => `<button type="button" class="pal-item ${i === sel ? 'on' : ''}" role="option" aria-selected="${i === sel}" data-i="${i}">${icon(it.ic || 'search')}<span class="grow"><b>${esc(it.label)}</b>${it.sub ? ` <span class="muted">${esc(it.sub)}</span>` : ''}</span><span class="muted small">${esc(it.hint || '')}</span></button>`).join('')
      : `<div class="empty">${icon('search')}<div>Nothing matches “${esc(input.value)}”.</div></div>`;
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  const pick = (i) => { const it = shown[i]; if (!it) return; close(); it.go(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
  };
  document.addEventListener('keydown', onKey, true);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  list.onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) pick(+b.dataset.i); };
  list.onmousemove = (e) => { const b = e.target.closest('[data-i]'); if (b && +b.dataset.i !== sel) { sel = +b.dataset.i; $$('.pal-item', list).forEach((x, i) => { x.classList.toggle('on', i === sel); x.setAttribute('aria-selected', i === sel); }); } };
  input.oninput = () => { sel = 0; draw(); };
  input.focus();
  items = await paletteItems();
  if (ov.isConnected) draw();
}
// Ctrl/Cmd+K anywhere, or "/" when not typing in a field.
addEventListener('keydown', (e) => {
  if (!$('#kbtn')) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing && !$('.overlay'))) { e.preventDefault(); palette(); }
});

function drawContext() {
  $('#ctx').innerHTML = inOwnerMenu()
    ? `${icon('shield')} <span>Owner Menu</span> ${icon('swap', 'sm sw')}`
    : `${icon('users')} <span>${esc(group()?.name || 'Group')}</span> ${icon('swap', 'sm sw')}`;
}

function drawNav(current) {
  $('#nav').innerHTML = (inOwnerMenu() ? OWNER_NAV() : GROUP_NAV()).map(([path, label, ic, show]) => {
    if (show && !show()) return '';
    if (!label) return `<div class="nav-label">${esc(path)}</div>`;
    return `<a href="#/${path}" class="${path === current ? 'on' : ''}" ${path === current ? 'aria-current="page"' : ''}>${icon(ic)} ${label}</a>`;
  }).join('');
}

let routeSeq = 0;
async function route() {
  const [name = '', arg, arg2] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const seq = ++routeSeq;
  if (name === 'go') {
    const rest = location.hash.replace(/^#\/go\/[^/]+\/?/, '');
    if (arg === OWNER ? isOwner() : S.groups.some((g) => g.id === arg)) return enter(arg, `#/${rest}`, true);
    toast(arg === OWNER ? 'Only the owner can open that page.' : 'You do not have access to that group.', 'bad');
    history.replaceState(null, '', location.pathname + '#/select');
    return picker();
  }
  if (name === 'select' || !S.gid) return picker();
  let key = name === '' ? 'overview' : name;
  if (inOwnerMenu()) {
    if (key === 'overview') key = 'ownerHome';
    else if (GROUP_PAGES.has(key)) { location.hash = '#/'; return; } // group pages need a group
  }
  if (!$('#side')) shell();
  drawContext();
  drawNav(NAV_PARENT[name] || name);
  $('#side').classList.remove('open');
  const el = $('#view');
  const view = VIEWS[key];
  if (!view) { el.innerHTML = `<div class="empty">${icon('alert')}<div>Page not found.</div></div>`; return; }
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

// Public Posts (/posts/) and Handbooks (/handbooks/) pages.
// Public items need no sign-in; anything limited to staff or a permission asks people to sign in,
// and the dashboard sends them straight back here afterwards (localStorage rp_return).
'use strict';
(() => {
  const KIND = document.body.dataset.kind === 'handbooks' ? 'handbooks' : 'posts';
  const SITE_NAME = window.RP_CONFIG?.NAME || 'Roleplay System';
  const LABEL = { posts: 'Posts', handbooks: 'Handbooks' };
  const q = new URLSearchParams(location.search);
  const root = $('#root');
  let groups = [], viewer = null; // viewer comes from /public/content (null = not signed in)

  const signIn = () => { store.set('rp_return', location.href); location.href = '../app.html'; };
  const signOut = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); store.set('rp_token', null); location.reload(); };
  const link = (kind, params = {}) => `../${kind}/${new URLSearchParams(params).toString() ? `?${new URLSearchParams(params)}` : ''}`;

  function page(viewer, gid, inner, wide = false) {
    if (!viewer && store.get('rp_token')) store.set('rp_token', null); // expired session: show "Sign in" again
    const g = gid ? { g: gid } : {};
    const switcher = groups.length > 1 && gid ? `<select class="vis-sel" id="grp" aria-label="Group">${groups.map((x) => `<option value="${esc(x.id)}" ${x.id === gid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : '';
    root.innerHTML = `<header class="pub-top">
        <a class="brand" href="../"><span class="mark">${icon('shield')}</span><span>${esc(SITE_NAME)}</span></a>
        <nav class="pub-tabs" aria-label="Sections"><a href="${link('posts', g)}" class="${KIND === 'posts' ? 'on' : ''}">${icon('megaphone', 'sm')} Posts</a><a href="${link('handbooks', g)}" class="${KIND === 'handbooks' ? 'on' : ''}">${icon('book', 'sm')} Handbooks</a></nav>
        <div class="row right">${switcher}${themeButton()}${viewer ? `<span class="pub-who">${icon('user', 'sm')} ${esc(viewer.name)}</span><button class="btn ghost sm" id="out">Sign out</button>` : `<button class="btn sm" id="in">${icon('lock', 'sm')} Sign in</button>`}</div>
      </header>
      <main class="pub-main ${wide ? 'wide' : ''}">${inner}</main>`;
    $('#in')?.addEventListener('click', signIn);
    $('#out')?.addEventListener('click', signOut);
    $('#grp')?.addEventListener('change', (e) => { location.href = link(KIND, { g: e.target.value }); });
  }
  const fail = (viewer, msg, gid) => page(viewer, gid, `<div class="card"><div class="empty">${icon('alert')}<div>${esc(msg)}</div></div></div>`);
  const gate = (viewer, needLogin, what, gid) => page(viewer, gid, `<div class="card gate">${icon('lock', 'lg')}
      <h1>${needLogin ? `Sign in to read this ${what}` : `You can’t read this ${what}`}</h1>
      <p class="dim">${needLogin ? 'It’s for staff only. Sign in with an account on the whitelist and you’ll come straight back here.' : 'It’s limited to people with a permission your account doesn’t have. Ask your group’s management if you need it.'}</p>
      ${needLogin ? `<button class="btn primary" id="gateIn">${icon('user')} Sign in</button>` : ''}
      <a href="${link(KIND, gid ? { g: gid } : {})}" class="muted">${icon('arrowL', 'inl')} All ${LABEL[KIND].toLowerCase()}</a></div>`);
  const lockedNote = (viewer, n, what) => (n ? `<div class="locked-note">${icon('lock')}<span>${viewer
    ? `${n} more ${what}${n === 1 ? ' is' : 's are'} limited to a permission you don’t have.`
    : `${n} more ${what}${n === 1 ? ' is' : 's are'} for staff only.`}</span>${viewer ? '' : `<button class="btn sm right" id="noteIn">${icon('user', 'sm')} Sign in</button>`}</div>` : '');
  const meta = (by, ts) => `<span class="muted small">${by ? `${esc(by)} · ` : ''}${fmtTime(ts)}</span>`;

  // ---------- one post ----------
  async function onePost(id) {
    let d;
    try { d = await api(`/public/posts/${encodeURIComponent(id)}`); } catch (e) {
      if (e.status === 401 || e.status === 403) return gate(viewer, e.status === 401, 'post');
      return fail(viewer, e.message);
    }
    const p = d.post;
    document.title = `${p.title} · ${p.group_name}`;
    page(d.viewer, p.group_id, `<div><a href="${link('posts', { g: p.group_id })}" class="muted">${icon('arrowL', 'inl')} ${esc(p.group_name)} posts</a></div>
      <article class="card post-card"><div class="head"><div class="grow"><span class="kicker-sm">${esc(p.group_name)}</span><h1 class="doc-title">${esc(p.title)}</h1></div>${p.pinned ? `<span class="badge accent">${icon('pin', 'sm')} Pinned</span>` : ''}${visBadge(p.visibility)}</div>
        <div class="body md">${md(p.body)}</div><div class="body" style="padding-top:0">${meta(p.author, p.created_at)}</div></article>`);
  }

  // ---------- one handbook (with the group's other handbooks alongside) ----------
  async function oneHandbook(id) {
    let d;
    try { d = await api(`/public/handbooks/${encodeURIComponent(id)}`); } catch (e) {
      if (e.status === 401 || e.status === 403) return gate(viewer, e.status === 401, 'handbook');
      return fail(viewer, e.message);
    }
    const h = d.handbook;
    document.title = `${h.title} · ${h.group_name}`;
    const list = await api(`/public/groups/${encodeURIComponent(h.group_id)}/handbooks`).catch(() => ({ handbooks: [h], locked: 0 }));
    const body = String(h.body).replace(/^\s*#\s+(.+)\n?/, (m, t) => (t.trim().toLowerCase() === h.title.trim().toLowerCase() ? '' : m));
    page(d.viewer, h.group_id, `<div class="hb">${handbookNav(list.handbooks, h.id)}
      <article class="card"><div class="head"><div class="grow"><span class="kicker-sm">${esc(h.category)}</span><h1 class="doc-title">${esc(h.title)}</h1></div>${visBadge(h.visibility)}</div>
        <div class="body md">${md(body) || '<p class="muted">This page is empty.</p>'}</div>
        <div class="body" style="border-top:1px solid var(--line)">${meta(h.updated_by ? `Last edited by ${h.updated_by}` : '', h.updated_at)}</div></article></div>
      ${lockedNote(d.viewer, list.locked, 'handbook')}`, true);
    $('#noteIn')?.addEventListener('click', signIn);
  }
  const handbookNav = (docs, current) => {
    const cats = [...new Set(docs.map((x) => x.category))];
    return `<nav class="hb-nav card" aria-label="Handbooks">${cats.map((c) => `<div class="nav-label">${esc(c)}</div>${docs.filter((x) => x.category === c).map((x) => `<a href="${link('handbooks', { id: x.id })}" class="${x.id === current ? 'on' : ''}">${icon('file', 'sm')} <span class="grow">${esc(x.title)}</span>${x.visibility === 'public' ? '' : icon('lock', 'sm')}</a>`).join('')}`).join('') || '<div class="empty">Nothing here yet.</div>'}</nav>`;
  };

  // ---------- a group's list ----------
  async function groupList(gid) {
    let d;
    try { d = await api(`/public/groups/${encodeURIComponent(gid)}/${KIND}`); } catch (e) { return fail(viewer, e.status === 404 ? 'That group doesn’t exist.' : e.message); }
    document.title = `${LABEL[KIND]} · ${d.group.name}`;
    const intro = `<div class="pub-head"><span class="kicker-sm">${esc(d.group.name)}</span><h1>${LABEL[KIND]}</h1></div>`;
    if (KIND === 'posts') {
      page(d.viewer, gid, `${intro}${d.posts.length ? d.posts.map((p) => `<article class="card post-card">
          <div class="head"><h2 class="grow"><a href="${link('posts', { id: p.id })}">${esc(p.title)}</a></h2>${p.pinned ? `<span class="badge accent">${icon('pin', 'sm')} Pinned</span>` : ''}${p.visibility === 'public' ? '' : visBadge(p.visibility)}</div>
          <div class="body md">${md(p.body)}</div><div class="body" style="padding-top:0">${meta(p.author, p.created_at)}</div></article>`).join('')
        : `<div class="card"><div class="empty">${icon('megaphone')}<div>No posts ${d.locked ? 'you can read ' : ''}yet.</div></div></div>`}
        ${lockedNote(d.viewer, d.locked, 'post')}`);
    } else {
      const cats = [...new Set(d.handbooks.map((x) => x.category))];
      page(d.viewer, gid, `${intro}${d.handbooks.length ? cats.map((c) => `<section class="stack gap-s"><h2 class="hb-cat">${esc(c)}</h2><div class="pub-groups">${d.handbooks.filter((x) => x.category === c).map((x) => `<a class="pub-group" href="${link('handbooks', { id: x.id })}">
          <div class="row">${icon('book')}<b class="grow">${esc(x.title)}</b>${x.visibility === 'public' ? '' : icon('lock', 'sm')}</div><span class="muted small">Updated ${fmtDate(x.updated_at)}</span></a>`).join('')}</div></section>`).join('')
        : `<div class="card"><div class="empty">${icon('book')}<div>No handbooks ${d.locked ? 'you can read ' : ''}yet.</div></div></div>`}
        ${lockedNote(d.viewer, d.locked, 'handbook')}`);
    }
    $('#noteIn')?.addEventListener('click', signIn);
  }

  // ---------- pick a group ----------
  async function start() {
    try { ({ groups, viewer } = await api('/public/content')); } catch (e) { return fail(null, e.message); }
    const id = q.get('id');
    if (id) return KIND === 'posts' ? onePost(id) : oneHandbook(id);
    const withContent = groups.filter((g) => g[KIND].open + g[KIND].locked > 0);
    const gid = q.get('g') || (withContent.length === 1 ? withContent[0].id : groups.length === 1 ? groups[0].id : null);
    if (gid) return groupList(gid);
    page(viewer, null, `<div class="pub-head"><h1>${LABEL[KIND]}</h1><p>Pick a group.</p></div>
      <div class="pub-groups">${groups.map((g) => `<a class="pub-group" href="${link(KIND, { g: g.id })}"><div class="row">${icon('users')}<b class="grow">${esc(g.name)}</b></div>
        <span class="muted small">${g[KIND].open} ${KIND === 'posts' ? 'post' : 'handbook'}${g[KIND].open === 1 ? '' : 's'}${g[KIND].locked ? ` · ${g[KIND].locked} for staff` : ''}</span></a>`).join('') || `<div class="card"><div class="empty">${icon('users')}<div>No groups yet.</div></div></div>`}</div>`);
  }
  document.addEventListener('click', (e) => { if (e.target.closest('#gateIn')) signIn(); });
  start();
})();

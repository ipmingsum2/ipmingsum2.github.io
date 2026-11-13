// Views: news, logbook, promotion recommendations, knowledgebase — plus shared dialogs
// (logbook entry, recommend, session register) used by other pages.
'use strict';

// ---------- logbook ----------
const LB_TYPES = { warning: ['Warning', 'warn'], strike: ['Strike', 'bad'], suspension: ['Suspension', 'bad'], demotion: ['Demotion', 'bad'], promotion: ['Promotion', 'good'], commendation: ['Commendation', 'good'], termination: ['Termination', 'bad'] };
const lbBadge = (t) => `<span class="badge ${LB_TYPES[t]?.[1] || ''}">${esc(LB_TYPES[t]?.[0] || t)}</span>`;
function lbStatus(e) {
  if (e.revoked_at) return `<span class="badge">Revoked</span><br><span class="muted small">by ${esc(e.revoked_by || '?')}</span>`;
  if (e.expires_at && e.expires_at <= Date.now() / 1000) return '<span class="badge">Expired</span>';
  if (e.expires_at) return `<span class="badge accent">Active</span><br><span class="muted small">until ${fmtDate(e.expires_at)}</span>`;
  return '<span class="badge accent">Active</span>';
}
/** Table of logbook entries; `withMember` adds the member column (group-wide view). */
function logbookTable(entries, withMember) {
  const cols = withMember ? 6 : 5;
  return `<div class="tbl-wrap"><table><thead><tr>${withMember ? '<th>Member</th>' : ''}<th>Type</th><th>Reason</th><th>By</th><th>Status</th><th></th></tr></thead><tbody>
    ${entries.length ? entries.map((e) => `<tr class="${e.revoked_at || (e.expires_at && e.expires_at <= Date.now() / 1000) ? 'faded' : ''}">
      ${withMember ? `<td><a href="#/member/${esc(e.roblox_id)}">${who(e.username || e.roblox_id)}</a></td>` : ''}
      <td>${lbBadge(e.type)}</td>
      <td class="wrap-text">${esc(e.reason)}${e.evidence ? `<br><a href="${esc(e.evidence)}" target="_blank" rel="noopener noreferrer" class="small">${icon('external', 'sm')} Evidence</a>` : ''}</td>
      <td class="muted">${esc(e.author || '')}<br><span class="small">${fmtDate(e.created_at)}</span></td>
      <td>${lbStatus(e)}</td>
      <td class="r">${can('manage_discipline') && !e.revoked_at ? `<button class="btn sm ghost" data-revoke="${e.id}">Revoke</button>` : ''}</td></tr>`).join('') : emptyRow(cols, 'No logbook entries.', 'clipboard')}
  </tbody></table></div>`;
}
function bindLogbookRevoke(el, done) {
  $$('[data-revoke]', el).forEach((b) => b.onclick = async () => {
    if (await confirmBox('Revoke this entry?', 'It stays on record but no longer counts as active.', 'Revoke')) run(b, async () => { await api(`/api/logbook/${b.dataset.revoke}/revoke`, { method: 'POST' }); toast('Entry revoked', 'good'); done(); });
  });
}
function logbookModal(user, done) {
  const m = modal({ title: 'New logbook entry', body: `
      <label class="field">Member<input id="u" value="${esc(user)}" placeholder="Roblox username or user ID"></label>
      <div class="grid2"><label class="field">Type<select id="t">${Object.entries(LB_TYPES).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label class="field">Expires after<select id="x"><option value="0">Never</option><option value="7">7 days</option><option value="14">14 days</option><option value="30" selected>30 days</option><option value="60">60 days</option><option value="90">90 days</option><option value="180">180 days</option></select><small>Expired warnings stop counting.</small></label></div>
      <label class="field">Reason<textarea id="r" maxlength="1000" placeholder="What happened?"></textarea></label>
      <label class="field">Evidence link (optional)<input id="e" placeholder="https://… screenshot or clip"></label>
      <label class="check hidden" id="applyRow"><input type="checkbox" id="ap" checked> Also change their rank in Roblox</label>
      <div class="callout"><span>${icon('info')}</span><span>Templates:</span> <span class="row wrap gap-s" id="tpls">${['Inactivity without notice', 'Unprofessional behaviour towards a guest', 'Abusing staff commands', 'Excellent shift leadership'].map((t) => `<button type="button" class="btn sm ghost" data-tpl="${esc(t)}">${esc(t)}</button>`).join('')}</span></div>`,
    actions: [{ label: 'Save entry', kind: 'primary', onClick: async (close, mm) => {
      const type = val(mm, '#t');
      const r = await api(G('/logbook'), { body: { user: val(mm, '#u'), type, reason: val(mm, '#r'), evidence: val(mm, '#e'), expiresInDays: Number(val(mm, '#x')), applyRank: !$('#applyRow', mm).classList.contains('hidden') && $('#ap', mm).checked } });
      close(); toast(r.ranked ? `Saved — now ${r.ranked.name}` : `Saved${['warning', 'strike'].includes(type) ? ` — ${r.activeWarnings} active warning${r.activeWarnings === 1 ? '' : 's'}` : ''}`, 'good'); done();
    } }] });
  const t = $('#t', m.el), row = $('#applyRow', m.el);
  const sync = () => { row.classList.toggle('hidden', !(can('ranking') && ['promotion', 'demotion'].includes(t.value))); $('#x', m.el).closest('label').classList.toggle('hidden', !['warning', 'strike', 'suspension'].includes(t.value)); };
  t.onchange = sync; sync();
  $('#tpls', m.el).onclick = (e) => { const b = e.target.closest('[data-tpl]'); if (b) $('#r', m.el).value = b.dataset.tpl; };
}

VIEWS.logbook = async (el, _a, _b, reload) => {
  const type = store.get('rp_lbtype') || '';
  const d = await api(G(`/logbook?type=${type}`));
  const counts = Object.entries(d.activeWarnings).map(([rid, n]) => [rid, n, d.entries.find((e) => e.roblox_id === rid)?.username]).sort((a, b) => b[1] - a[1]);
  el.innerHTML = `${head('Logbook', 'Warnings, strikes, suspensions, demotions, promotions and commendations. Warnings can expire; nothing is ever deleted — entries are revoked.', can('manage_discipline') ? `<button class="btn primary" id="add">${icon('plus')} New entry</button>` : '')}
    <div class="stats">
      ${stat('Active warnings', Object.values(d.activeWarnings).reduce((a, b) => a + b, 0), `${counts.length} member${counts.length === 1 ? '' : 's'}`, 'alert')}
      ${stat('Entries this month', d.entries.filter((e) => e.created_at > Date.now() / 1000 - 30 * 86400).length, '', 'clipboard')}
      ${stat('Commendations', d.entries.filter((e) => e.type === 'commendation').length, 'all time', 'trophy')}
    </div>
    ${counts.length ? `<div class="card"><div class="head"><h2 class="grow">Warning ticker</h2><span class="muted">Active warnings and strikes per member</span></div><div class="body row wrap">${counts.map(([rid, n, name]) => `<a class="ticker" href="#/member/${esc(rid)}"><b>${n}</b> ${esc(name || rid)}</a>`).join('')}</div></div>` : ''}
    <div class="card"><div class="head"><select id="ft" style="width:auto" aria-label="Filter by type"><option value="">All types</option>${Object.entries(LB_TYPES).map(([k, [l]]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${logbookTable(d.entries, true)}</div>`;
  $('#ft', el).onchange = (e) => { store.set('rp_lbtype', e.target.value); reload(); };
  if ($('#add', el)) $('#add', el).onclick = () => logbookModal('', reload);
  bindLogbookRevoke(el, reload);
};

// ---------- session register ----------
async function registerModal(ev, done) {
  if (!ev) return;
  const draw = async (m) => {
    const { people, event } = await api(`/api/events/${ev.id}/people`);
    const mine = S.user.robloxId && people.find((p) => p.roblox_id === S.user.robloxId);
    const ROLE = { host: 'Host', cohost: 'Co-host', attendee: 'Attended' };
    $('#reg', m).innerHTML = `
      <div class="row wrap"><span class="badge">${esc(event.type)}</span><span class="muted">${fmtTime(event.starts_at)} · ${event.duration_min} min</span>${statusBadge(event.status)}</div>
      <div class="tbl-wrap card"><table><tbody>${people.length ? people.map((p) => `<tr><td>${who(p.username || p.roblox_id)}</td><td><span class="badge ${p.role === 'host' ? 'accent' : ''}">${ROLE[p.role]}</span></td><td class="muted small">added by ${esc(p.added_by || '')}</td>
        <td class="r">${can('manage_activity') ? `<button class="btn ghost icon sm" data-rm="${esc(p.roblox_id)}" aria-label="Remove">${icon('x', 'sm')}</button>` : ''}</td></tr>`).join('') : emptyRow(4, 'Nobody on the register yet.', 'users')}</tbody></table></div>
      ${event.status === 'scheduled' ? `<div class="row wrap">${S.user.robloxId ? (mine ? `<span class="dim grow">You’re on this register as <b>${ROLE[mine.role]}</b>.</span><button class="btn sm" data-unclaim>Leave</button>`
        : `<span class="dim grow">Claim this session:</span><button class="btn sm primary" data-claim="host" ${event.host_name ? 'disabled title="Already has a host"' : ''}>Host it</button><button class="btn sm" data-claim="cohost">Co-host</button><button class="btn sm" data-claim="attendee">Attend</button>`)
        : '<span class="muted">Link your Roblox account on <a href="#/account">My account</a> to claim sessions.</span>'}</div>` : ''}
      ${can('manage_activity') ? `<div class="card"><div class="body stack gap-s"><b class="small">Add to register</b>
        <div class="row wrap"><select id="role" style="width:auto"><option value="attendee">Attended</option><option value="cohost">Co-host</option><option value="host">Host</option></select>
        <input id="names" class="grow" placeholder="Usernames — paste several separated by spaces or commas"><button class="btn primary" id="addp">Add</button></div></div></div>` : ''}
      ${can('manage_roster') && people.length ? `<div class="row wrap"><span class="dim grow">Training session? Give everyone on this register a certification.</span><button class="btn sm" id="awardAll">${icon('award', 'sm')} Award certification to all ${people.length}</button></div>` : ''}`;
    if ($('#awardAll', m)) $('#awardAll', m).onclick = (e) => run(e.currentTarget, async () => { const d = await api(G('/roster')); awardModal(d.certTypes, people.map((p) => p.username || p.roblox_id).join(' '), () => draw(m)); });
    $$('[data-rm]', m).forEach((b) => b.onclick = () => run(b, async () => { await api(`/api/events/${ev.id}/people/${b.dataset.rm}`, { method: 'DELETE' }); draw(m); }));
    $$('[data-claim]', m).forEach((b) => b.onclick = () => run(b, async () => { await api(`/api/events/${ev.id}/claim`, { body: { role: b.dataset.claim } }); toast('Claimed', 'good'); draw(m); }));
    if ($('[data-unclaim]', m)) $('[data-unclaim]', m).onclick = (e) => run(e.currentTarget, async () => { await api(`/api/events/${ev.id}/claim`, { method: 'DELETE' }); draw(m); });
    if ($('#addp', m)) $('#addp', m).onclick = (e) => run(e.currentTarget, async () => { const r = await api(`/api/events/${ev.id}/people`, { body: { user: val(m, '#names'), role: val(m, '#role') } }); toast(`Added ${r.added.join(', ')}`, 'good'); draw(m); });
  };
  const m = modal({ title: `Register — ${ev.title}`, wide: true, body: '<div id="reg" class="stack"><div class="empty">Loading…</div></div>', actions: [{ label: 'Done', kind: 'primary', onClick: (close) => { close(); done(); } }] });
  try { await draw(m.el); } catch (e) { $('#reg', m.el).innerHTML = `<div class="callout bad">${icon('alert')}<span>${esc(e.message)}</span></div>`; }
}

// ---------- promotion recommendations ----------
function recommendModal(user, done) {
  modal({ title: 'Recommend for promotion', body: `
      <label class="field">Member<input id="u" value="${esc(user)}" placeholder="Roblox username or user ID"></label>
      <label class="field">Why do they deserve it?<textarea id="r" maxlength="1000" placeholder="Concrete examples help others vote"></textarea></label>`,
    actions: [{ label: 'Recommend', kind: 'primary', onClick: async (close, m) => { await api(G('/recommendations'), { body: { user: val(m, '#u'), reason: val(m, '#r') } }); close(); toast('Recommendation posted', 'good'); done(); } }] });
}

VIEWS.promotions = async (el, _a, _b, reload) => {
  const status = store.get('rp_recstatus') || 'open';
  const sort = store.get('rp_recsort') || 'votes';
  const role = store.get('rp_recrole') || '';
  const d = await api(G(`/recommendations?status=${status}`));
  let list = d.recommendations.filter((r) => !role || String(r.rank) === role);
  list.sort(sort === 'trending' ? (a, b) => b.recentVotes - a.recentVotes || b.voteCount - a.voteCount : sort === 'new' ? (a, b) => b.created_at - a.created_at : (a, b) => b.voteCount - a.voteCount);
  const ranks = [...new Map(d.recommendations.filter((r) => r.rank != null).map((r) => [r.rank, r.role_name])).entries()].sort((a, b) => a[0] - b[0]);
  el.innerHTML = `${head('Promotions', 'Nominate members who deserve a promotion. Staff upvote with a short justification; someone with ranking permission promotes straight from here.', `<button class="btn primary" id="add">${icon('plus')} Recommend someone</button>`)}
    <div class="grid-side">
      <div class="stack">
        <div class="card"><div class="head">
          ${seg('rs', [['open', 'Open'], ['promoted', 'Promoted'], ['declined', 'Declined']], status)}
          <select id="rr" style="width:auto" aria-label="Filter by rank"><option value="">All ranks</option>${ranks.map(([r, n]) => `<option value="${r}" ${String(r) === role ? 'selected' : ''}>${esc(n || `Rank ${r}`)}</option>`).join('')}</select>
          <span class="right">${seg('so', [['votes', 'Most votes'], ['trending', 'Trending'], ['new', 'Newest']], sort)}</span>
        </div></div>
        ${list.length ? list.map((r) => `<article class="card rec">
          <div class="vote ${r.myVote ? 'on' : ''}"><button class="btn icon ${r.myVote ? 'primary' : ''}" data-vote="${r.id}" ${status !== 'open' ? 'disabled' : ''} aria-label="${r.myVote ? 'Remove your upvote' : 'Upvote'}" aria-pressed="${r.myVote}">${icon('up')}</button><b class="num">${r.voteCount}</b>${r.recentVotes ? `<span class="small muted">+${r.recentVotes} this week</span>` : ''}</div>
          <div class="grow stack gap-s">
            <div class="row wrap"><a href="#/member/${esc(r.roblox_id)}">${who(r.username, r.role_name || '')}</a>
              ${status === 'open' ? (can('ranking') ? `<span class="right row"><button class="btn sm" data-decide="${r.id}:declined">Decline</button><button class="btn sm good" data-decide="${r.id}:promoted">${icon('up', 'sm')} Promote</button></span>` : '') : `<span class="right">${statusBadge(r.status === 'promoted' ? 'accepted' : 'denied')} <span class="muted small">by ${esc(r.decided_by || '')}</span></span>`}</div>
            <p class="wrap-text">${esc(r.reason)}</p>
            <span class="muted small">Recommended by ${esc(r.created_by || '')} · ${ago(r.created_at)}</span>
            ${r.votes.length ? `<details><summary class="small">${r.votes.length} justification${r.votes.length === 1 ? '' : 's'}</summary><ul class="votes">${r.votes.map((v) => `<li><b>${esc(v.user)}</b> <span class="dim">${esc(v.justification)}</span></li>`).join('')}</ul></details>` : ''}
          </div></article>`).join('') : `<div class="card"><div class="empty">${icon('thumb')}<div>No ${status} recommendations${role ? ' for this rank' : ''}.</div></div></div>`}
      </div>
      <div class="card"><div class="head"><h2>Recommender insights</h2></div><div class="tbl-wrap"><table><thead><tr><th>Recommender</th><th class="r">Total</th><th class="r">Promoted</th></tr></thead><tbody>
        ${d.insights.length ? d.insights.map((i) => `<tr><td>${esc(i.name)}</td><td class="r num">${i.total}</td><td class="r num">${i.promoted}${i.total ? ` <span class="muted small">(${Math.round(i.promoted / i.total * 100)}%)</span>` : ''}</td></tr>`).join('') : emptyRow(3, 'No recommendations yet.', 'users')}
      </tbody></table></div></div>
    </div>`;
  onSeg(el, 'rs', (v) => { store.set('rp_recstatus', v); reload(); });
  onSeg(el, 'so', (v) => { store.set('rp_recsort', v); reload(); });
  $('#rr', el).onchange = (e) => { store.set('rp_recrole', e.target.value); reload(); };
  $('#add', el).onclick = () => recommendModal('', reload);
  $$('[data-vote]', el).forEach((b) => b.onclick = () => {
    const r = d.recommendations.find((x) => x.id == b.dataset.vote);
    if (r.myVote) return run(b, async () => { await api(`/api/recommendations/${r.id}/vote`, { method: 'DELETE' }); reload(); });
    modal({ title: `Upvote ${r.username}`, body: '<label class="field">Why do you support this?<textarea id="j" maxlength="500" placeholder="A sentence is enough"></textarea><small>Required — it’s shown with your vote.</small></label>',
      actions: [{ label: 'Upvote', kind: 'primary', onClick: async (close, m) => { await api(`/api/recommendations/${r.id}/vote`, { body: { justification: val(m, '#j') } }); close(); reload(); } }] });
  });
  $$('[data-decide]', el).forEach((b) => b.onclick = async () => {
    const [id, st] = b.dataset.decide.split(':');
    const r = d.recommendations.find((x) => x.id == id);
    const ok = await confirmBox(st === 'promoted' ? `Promote ${r.username}?` : `Decline ${r.username}?`, st === 'promoted' ? 'They will be moved up one rank in Roblox now, and the recommendation closes.' : 'The recommendation closes without a rank change.', st === 'promoted' ? 'Promote' : 'Decline', st === 'promoted' ? 'primary' : 'danger');
    if (ok) run(b, async () => { const res = await api(`/api/recommendations/${id}`, { method: 'PATCH', body: { status: st } }); toast(res.ranked ? `${r.username} is now ${res.ranked.name}` : 'Recommendation closed', 'good'); reload(); });
  });
};

// ---------- knowledgebase ----------
VIEWS.kb = async (el, id, sub, reload) => {
  const { docs } = await api(G('/kb'));
  const edit = can('manage_content');
  const cats = [...new Set(docs.map((d) => d.category))];
  let current = id && id !== 'new' ? (await api(`/api/kb/${id}`)).doc : null;
  if (!id && docs.length) { location.replace(`#/kb/${docs[0].id}`); return; }
  const editing = id === 'new' || sub === 'edit';
  if (editing && !edit) throw new Error('You do not have permission to edit the knowledgebase.');
  const nav = `<nav class="kb-nav card">${edit ? `<div class="body"><a class="btn primary" style="width:100%" href="#/kb/new">${icon('plus')} New page</a></div>` : ''}
    ${cats.length ? cats.map((c) => `<div class="nav-label">${esc(c)}</div>${docs.filter((d) => d.category === c).map((d) => `<a href="#/kb/${d.id}" class="${current?.id === d.id ? 'on' : ''}">${icon('file', 'sm')} <span class="grow">${esc(d.title)}</span>${d.visibility === 'public' ? icon('globe', 'sm') : icon('lock', 'sm')}</a>`).join('')}`).join('') : '<div class="empty">No pages yet.</div>'}</nav>`;
  let main;
  if (editing) {
    const d = current || { title: '', category: cats[0] || 'General', body: '', visibility: '' };
    main = `<div class="card"><div class="head"><h2 class="grow">${current ? 'Edit page' : 'New page'}</h2>${current ? `<button class="btn danger" id="del">${icon('trash')} Delete</button>` : ''}<a class="btn ghost" href="#/kb${current ? `/${current.id}` : ''}">Cancel</a><button class="btn primary" id="save">${icon('check')} Save</button></div>
      <div class="body stack"><div class="grid3"><label class="field">Title<input id="t" maxlength="120" value="${esc(d.title)}"></label>
        <label class="field">Category<input id="c" maxlength="40" value="${esc(d.category)}" list="cats"><datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <label class="field">Who can read it<select id="v">${visOptions(d.visibility)}</select><small>Public pages need no sign-in. Anything else asks people to sign in.</small></label></div>
        <div class="grid2 kb-edit"><label class="field">Content <small>Markdown: # heading, **bold**, *italic*, - lists, 1. lists, > quote, [link](https://…)</small><textarea id="b" rows="22">${esc(d.body)}</textarea></label>
        <div class="field"><span>Preview</span><div class="md card body" id="pv">${md(d.body)}</div></div></div></div></div>`;
  } else if (current) {
    main = `<article class="card"><div class="head"><div class="grow"><span class="kicker-sm">${esc(current.category)}</span><h2 class="doc-title">${esc(current.title)}</h2></div>
      ${visBadge(current.visibility)}<a class="btn ghost" href="handbooks/?id=${current.id}" target="_blank" rel="noopener">${icon('external')} Page</a>${edit ? `<a class="btn" href="#/kb/${current.id}/edit">${icon('edit')} Edit</a>` : ''}</div>
      <div class="body md">${md(String(current.body).replace(/^\s*#\s+(.+)\n?/, (m, t) => (t.trim().toLowerCase() === current.title.trim().toLowerCase() ? '' : m))) || '<p class="muted">This page is empty.</p>'}</div>
      <div class="body muted small" style="border-top:1px solid var(--line)">Last edited by ${esc(current.updated_by || '')} · ${fmtTime(current.updated_at)}</div></article>`;
  } else main = `<div class="card"><div class="empty">${icon('book')}<div><b>No knowledgebase pages yet</b></div><p>Store your handbooks, guides and policies here.</p>${edit ? '<p style="margin-top:12px"><a class="btn primary" href="#/kb/new">Write the first page</a></p>' : ''}</div></div>`;
  el.innerHTML = `${head('Knowledgebase', 'Handbooks, guides and policies. Each page is public, for signed-in staff, or for one permission — and is also published on the Handbooks page.', `<a class="btn" href="handbooks/?g=${encodeURIComponent(S.gid)}" target="_blank" rel="noopener">${icon('external')} Handbooks page</a>`)}<div class="kb">${nav}<div class="kb-main">${main}</div></div>`;
  if (editing) {
    $('#b', el).oninput = (e) => { $('#pv', el).innerHTML = md(e.target.value); };
    $('#save', el).onclick = (e) => run(e.currentTarget, async () => {
      const body = { title: val(el, '#t'), category: val(el, '#c'), visibility: val(el, '#v'), body: $('#b', el).value };
      const r = current ? await api(`/api/kb/${current.id}`, { method: 'PATCH', body }) : await api(G('/kb'), { body });
      toast('Page saved', 'good'); location.hash = `#/kb/${current ? current.id : r.id}`;
    });
    if ($('#del', el)) $('#del', el).onclick = async () => { if (await confirmBox('Delete this page?', 'This cannot be undone.', 'Delete')) run(null, async () => { await api(`/api/kb/${current.id}`, { method: 'DELETE' }); location.hash = '#/kb'; }); };
  }
};

// ---------- news ----------
VIEWS.news = async (el, _a, _b, reload) => {
  const { posts } = await api(G('/news'));
  const edit = can('manage_content');
  el.innerHTML = `${head('News', 'Announcements. Pinned posts stay on top and show on the overview; every post is also on the Posts page, public or for the people you choose.', `<a class="btn" href="posts/?g=${encodeURIComponent(S.gid)}" target="_blank" rel="noopener">${icon('external')} Posts page</a>${edit ? `<button class="btn primary" id="add">${icon('plus')} New post</button>` : ''}`)}
    <div class="news">${posts.length ? posts.map((p) => `<article class="card post">
      <div class="head">${p.pinned ? `<span class="badge accent">${icon('pin', 'sm')} Pinned</span>` : ''}<h2 class="grow"><a href="posts/?id=${p.id}" target="_blank" rel="noopener">${esc(p.title)}</a></h2>${edit ? `<select class="vis-sel" data-vis="${p.id}" aria-label="Who can read this post">${visOptions(p.visibility || '')}</select>` : visBadge(p.visibility || '')}
        ${edit ? `<button class="btn ghost sm" data-pin="${p.id}:${p.pinned ? 0 : 1}">${p.pinned ? 'Unpin' : 'Pin'}</button><button class="btn ghost icon sm" data-del="${p.id}" aria-label="Delete post">${icon('trash', 'sm')}</button>` : ''}</div>
      <div class="body md">${md(p.body)}</div>
      <div class="body muted small" style="padding-top:0">${esc(p.author || '')} · ${fmtTime(p.created_at)}</div></article>`).join('') : `<div class="card"><div class="empty">${icon('megaphone')}<div>No news yet.</div></div></div>`}</div>`;
  if (!edit) return;
  $('#add', el).onclick = () => modal({ title: 'New post', wide: true, body: `
      <label class="field">Title<input id="t" maxlength="140"></label>
      <label class="field">Message <small>Markdown supported</small><textarea id="b" rows="8" maxlength="4000"></textarea></label>
      <label class="field">Who can read it<select id="v">${visOptions('')}</select><small>Public posts appear on the Posts page for anyone. Anything else asks people to sign in.</small></label>
      <div class="row wrap" style="gap:18px"><label class="check"><input type="checkbox" id="p"> Pin to the top</label>
      <label class="check"><input type="checkbox" id="a" ${group()?.settings.news?.webhookUrl ? 'checked' : 'disabled'}> Announce in Discord ${group()?.settings.news?.webhookUrl ? '' : '<span class="muted">(set a news webhook in Groups)</span>'}</label></div>`,
    actions: [{ label: 'Post', kind: 'primary', onClick: async (close, m) => { const r = await api(G('/news'), { body: { title: val(m, '#t'), body: $('#b', m).value, pinned: $('#p', m).checked, announce: $('#a', m).checked, visibility: val(m, '#v') } }); close(); toast(r.announced ? 'Posted and announced' : 'Posted', 'good'); reload(); } }] });
  $$('[data-vis]', el).forEach((s) => s.onchange = () => run(null, async () => { await api(`/api/news/${s.dataset.vis}`, { method: 'PATCH', body: { visibility: s.value } }); toast(s.value === 'public' ? 'Post is now public' : 'Visibility updated', 'good'); }));
  $$('[data-pin]', el).forEach((b) => b.onclick = () => run(b, async () => { const [id, pin] = b.dataset.pin.split(':'); await api(`/api/news/${id}`, { method: 'PATCH', body: { pinned: pin === '1' } }); reload(); }));
  $$('[data-del]', el).forEach((b) => b.onclick = async () => { if (await confirmBox('Delete post?', 'This cannot be undone.', 'Delete')) run(b, async () => { await api(`/api/news/${b.dataset.del}`, { method: 'DELETE' }); reload(); }); });
};

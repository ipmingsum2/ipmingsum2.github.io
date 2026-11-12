// Views: blacklist, auto-promotion, access requests (Owner Menu).
'use strict';

// ---------- blacklist ----------
function blacklistModal(user, done) {
  modal({ title: 'Blacklist a player', body: `
      <label class="field">Player<input id="u" value="${esc(user)}" placeholder="Roblox username or user ID"></label>
      <label class="field">Reason<textarea id="r" maxlength="500" placeholder="Why are they blacklisted?"></textarea><small>Players who are kicked see this reason (you can change the kick message in the tracker settings).</small></label>
      <div class="grid2">
        <label class="field">Length<select id="x"><option value="0">Permanent</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="180">180 days</option><option value="365">1 year</option></select></label>
        <label class="field">Evidence link (optional)<input id="e" placeholder="https://…"></label>
      </div>
      <div class="callout">${icon('info')}<span>Blacklisted players are kicked from games running the ActivityTracker module and can’t submit applications.</span></div>`,
    actions: [{ label: 'Blacklist', kind: 'danger', onClick: async (close, m) => {
      const r = await api(G('/blacklist'), { body: { user: val(m, '#u'), reason: val(m, '#r'), evidence: val(m, '#e'), expiresInDays: Number(val(m, '#x')) } });
      close(); toast(`${r.user.name} blacklisted`, 'good'); done();
    } }] });
}

VIEWS.blacklist = async (el, _a, _b, reload) => {
  const { entries } = await api(G('/blacklist'));
  const manage = can('manage_discipline');
  let show = store.get('rp_blshow') === 'all' ? 'all' : 'active', q = '';
  const active = entries.filter((e) => e.active);
  el.innerHTML = `${head('Blacklist', 'Players who may not join your games or apply. The ActivityTracker module kicks them automatically.', `
      <button class="btn" id="csv">${icon('download')} Export CSV</button>
      ${manage ? `<button class="btn danger" id="add">${icon('ban')} Blacklist a player</button>` : ''}`)}
    <div class="stats">
      ${stat('Active', active.length, 'blacklisted now', 'ban')}
      ${stat('Permanent', active.filter((e) => !e.expires_at).length, `${active.filter((e) => e.expires_at).length} temporary`, 'shield')}
      ${stat('Added this month', entries.filter((e) => e.created_at > Date.now() / 1000 - 30 * 86400).length, '', 'calendar')}
    </div>
    <div class="card"><div class="head">${seg('bs', [['active', 'Active'], ['all', 'All, including removed']], show)}
      <div class="search right" style="width:220px">${icon('search', 'sm')}<input id="q" placeholder="Search player or reason" aria-label="Search blacklist"></div></div>
      <div class="tbl-wrap"><table><thead><tr><th>Player</th><th>Reason</th><th>Added</th><th>Status</th><th></th></tr></thead><tbody id="rows"></tbody></table></div></div>`;
  const status = (e) => e.removed_at ? `<span class="badge">Removed</span><br><span class="muted small">by ${esc(e.removed_by || '?')}</span>`
    : !e.active ? '<span class="badge">Expired</span>'
    : e.expires_at ? `<span class="badge bad">Active</span><br><span class="muted small">until ${fmtDate(e.expires_at)}</span>` : '<span class="badge bad">Permanent</span>';
  const list = () => entries.filter((e) => (show === 'all' || e.active) && (!q || `${e.username} ${e.roblox_id} ${e.reason} ${e.author}`.toLowerCase().includes(q)));
  const draw = () => {
    const rows = list();
    $('#rows', el).innerHTML = rows.length ? rows.map((e) => `<tr class="${e.active ? '' : 'faded'}">
        <td>${who(e.username || e.roblox_id, `Roblox ${e.roblox_id}`)}</td>
        <td class="wrap-text">${esc(e.reason)}${e.evidence ? `<br><a href="${esc(e.evidence)}" target="_blank" rel="noopener noreferrer" class="small">${icon('external', 'sm')} Evidence</a>` : ''}</td>
        <td class="muted">${esc(e.author || '')}<br><span class="small">${fmtDate(e.created_at)}</span></td>
        <td>${status(e)}</td>
        <td class="r"><div class="row" style="justify-content:flex-end"><a class="btn sm ghost" target="_blank" rel="noopener" href="https://www.roblox.com/users/${encodeURIComponent(e.roblox_id)}/profile">Profile</a>
          ${manage && e.active ? `<button class="btn sm" data-rm="${e.id}">Remove</button>` : ''}</div></td></tr>`).join('')
      : emptyRow(5, entries.length ? 'Nothing matches.' : 'Nobody is blacklisted.', 'ban');
  };
  draw();
  onSeg(el, 'bs', (v) => { show = v; store.set('rp_blshow', v); draw(); });
  $('#q', el).oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  $('#rows', el).onclick = async (e) => {
    const b = e.target.closest('[data-rm]'); if (!b) return;
    const x = entries.find((y) => y.id == b.dataset.rm);
    if (await confirmBox(`Remove ${x.username} from the blacklist?`, 'They will be able to join your games and apply again. The entry stays on record.', 'Remove', 'primary')) {
      run(b, async () => { await api(`/api/blacklist/${x.id}/remove`, { method: 'POST' }); toast('Removed from the blacklist', 'good'); reload(); });
    }
  };
  if (manage) $('#add', el).onclick = () => blacklistModal('', reload);
  $('#csv', el).onclick = () => downloadCSV(`blacklist-${group().name.replace(/[^\w-]+/g, '_')}.csv`, [
    ['Roblox ID', 'Username', 'Reason', 'Evidence', 'Added by', 'Added (UTC)', 'Expires (UTC)', 'Status'],
    ...list().map((e) => [e.roblox_id, e.username || '', e.reason, e.evidence || '', e.author || '', new Date(e.created_at * 1000).toISOString().slice(0, 10),
      e.expires_at ? new Date(e.expires_at * 1000).toISOString().slice(0, 10) : 'never', e.removed_at ? 'removed' : e.active ? 'active' : 'expired']),
  ]);
};

// ---------- auto-promotion ----------
VIEWS.autopromote = async (el, _a, _b, reload) => {
  const d = await api(G('/autopromote'));
  const edit = can('ranking');
  const s = d.settings;
  const rules = s.rules.map((r) => ({ ...r }));
  const roles = rolesOf().filter((r) => r.rank < 255);
  const tracked = group().trackedRanks;
  const roleName = (rank) => roles.find((r) => r.rank === rank)?.name || `Rank ${rank}`;
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const localHour = (h) => { const dt = new Date(); dt.setUTCHours(h, 0, 0, 0); return dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
  const eligible = d.rules.reduce((n, r) => n + r.people.filter((p) => p.eligible && !(s.mode === 'recommend' && p.recommended)).length, 0);

  el.innerHTML = `${head('Auto-promotion', 'Rules that move members up once they’ve put in the hours and sessions. Runs once a day, or whenever you press “Run now”.', edit ? `
      <button class="btn" id="run" ${s.rules.length ? '' : 'disabled'}>${icon('sparkle')} Run now</button><button class="btn primary" id="save">${icon('check')} Save</button>` : '')}
    <div class="stats">
      ${stat('Status', s.enabled ? '<span class="badge good">On</span>' : '<span class="badge">Off</span>', s.enabled ? `daily at ${String(s.checkHour).padStart(2, '0')}:00 UTC` : 'not running on a schedule', 'clock')}
      ${stat('Mode', s.mode === 'promote' ? 'Promote' : 'Recommend', s.mode === 'promote' ? 'changes ranks in Roblox' : 'creates recommendations to approve', 'thumb')}
      ${stat('Ready now', eligible, s.mode === 'promote' ? 'would be promoted' : 'would be recommended', 'trophy')}
      ${stat('Last run', s.lastRunDay ? fmtDay(s.lastRunDay) : '—', 'scheduled runs', 'calendar')}
    </div>
    ${!group().hasApiKey && s.mode === 'promote' ? `<div class="callout warn">${icon('alert')}<span>Promote mode needs this group’s Open Cloud key (Groups, then Settings). Until then, use Recommend mode.</span></div>` : ''}
    <div class="card"><div class="head"><h2 class="grow">Settings</h2></div><div class="body stack">
      <div class="grid3">
        <label class="field">Mode<select id="mode" ${edit ? '' : 'disabled'}><option value="recommend" ${s.mode !== 'promote' ? 'selected' : ''}>Recommend (someone approves on Promotions)</option><option value="promote" ${s.mode === 'promote' ? 'selected' : ''}>Promote automatically</option></select><small>Approving a recommendation moves them up one rank.</small></label>
        <label class="field">Runs daily at (UTC)<select id="hour" ${edit ? '' : 'disabled'}>${hours.map((h) => `<option value="${h}" ${h === s.checkHour ? 'selected' : ''}>${String(h).padStart(2, '0')}:00 UTC (${localHour(h)} your time)</option>`).join('')}</select></label>
        <label class="field">Discord webhook (optional)<input id="hook" value="${esc(s.webhookUrl || '')}" placeholder="https://discord.com/api/webhooks/…" ${edit ? '' : 'disabled'}><small>Posts who was promoted or recommended.</small></label>
      </div>
      <label class="check"><input type="checkbox" id="on" ${s.enabled ? 'checked' : ''} ${edit ? '' : 'disabled'}> Run automatically every day</label>
    </div></div>
    <div class="card"><div class="head"><h2 class="grow">Rules</h2><span class="muted">One rule per starting rank. At most 25 people are changed per run.</span></div>
      <div class="body stack"><div class="stack gap-s" id="rules"></div>
      ${edit ? `<div><button class="btn" id="addRule">${icon('plus')} Add rule</button></div>` : ''}</div></div>
    ${d.rules.map((r) => {
      const ready = r.people.filter((p) => p.eligible && !(s.mode === 'recommend' && p.recommended));
      return `<div class="card"><div class="head"><h2 class="grow">${esc(r.fromName)} ${icon('arrowR', 'inl')} ${esc(r.toName)}</h2>
        <span class="muted">${[r.minHours ? `${r.minHours}h` : '', r.minSessions ? `${r.minSessions} session${r.minSessions === 1 ? '' : 's'}` : ''].filter(Boolean).join(' + ')} ${r.days ? `in the last ${r.days} days` : 'all time'}${r.noWarnings ? ' · no active warnings' : ''}</span>
        <span class="badge ${ready.length ? 'good' : ''}">${ready.length} ready</span></div>
        <div class="tbl-wrap"><table><thead><tr><th>Member</th><th style="width:28%">Hours</th><th style="width:22%">Sessions</th><th>Status</th></tr></thead><tbody>
        ${r.people.length ? r.people.slice(0, 100).map((p) => `<tr class="click" data-member="${esc(p.robloxId)}">
          <td>${who(p.username, p.displayName && p.displayName !== p.username ? p.displayName : '')}</td>
          <td>${progress(p.hours, r.minHours, 'h')}</td>
          <td>${progress(p.sessions, r.minSessions, '')}</td>
          <td>${p.blocked ? `<span class="badge bad">${esc(p.blocked)}</span>` : p.eligible ? (p.recommended && s.mode === 'recommend' ? '<span class="badge accent">Already recommended</span>' : '<span class="badge good">Ready</span>') : '<span class="badge">In progress</span>'}</td></tr>`).join('')
          : emptyRow(4, `Nobody is ranked ${esc(r.fromName)} yet.`, 'users')}
        </tbody></table></div></div>`;
    }).join('')}`;

  function progress(v, need, unit) {
    if (!need) return `<span class="muted">${v}${unit} · not required</span>`;
    const pct = Math.min(100, (v / need) * 100);
    return `<div class="row gap-s"><div class="meter grow"><i style="width:${pct}%"></i></div><span class="num small ${v >= need ? '' : 'muted'}">${v}${unit}/${need}${unit}</span></div>`;
  }

  const box = $('#rules', el);
  const rankOpts = (cur, list) => list.map((r) => `<option value="${r.rank}" ${r.rank === cur ? 'selected' : ''}>${esc(r.name)} (${r.rank})</option>`).join('');
  const draw = () => {
    box.innerHTML = rules.length ? rules.map((r, i) => `<div class="rule" data-i="${i}">
        <label class="field">From<select data-f="fromRank" ${edit ? '' : 'disabled'}>${rankOpts(r.fromRank, roles.filter((x) => !tracked.length || tracked.includes(x.rank) || x.rank === r.fromRank))}</select></label>
        <label class="field">To<select data-f="toRank" ${edit ? '' : 'disabled'}>${rankOpts(r.toRank, roles.filter((x) => x.rank > r.fromRank))}</select></label>
        <label class="field">Hours<input type="number" min="0" step="0.5" data-f="minHours" value="${r.minHours || ''}" placeholder="0" ${edit ? '' : 'disabled'}></label>
        <label class="field">Sessions<input type="number" min="0" data-f="minSessions" value="${r.minSessions || ''}" placeholder="0" ${edit ? '' : 'disabled'}></label>
        <label class="field">Counted over<select data-f="days" ${edit ? '' : 'disabled'}>${[[7, 'Last 7 days'], [14, 'Last 14 days'], [30, 'Last 30 days'], [60, 'Last 60 days'], [90, 'Last 90 days'], [0, 'All time']].map(([v, l]) => `<option value="${v}" ${v === r.days ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" data-f="noWarnings" ${r.noWarnings ? 'checked' : ''} ${edit ? '' : 'disabled'}> No active warnings</label>
        ${edit ? `<button class="btn ghost icon sm" data-rm aria-label="Remove rule" title="Remove rule">${icon('trash', 'sm')}</button>` : ''}
      </div>`).join('') : `<div class="empty">${icon('sparkle')}<div>No rules yet.${edit ? ' Add one — for example “Trainee to Staff after 10 hours and 3 sessions in 30 days”.' : ''}</div></div>`;
  };
  draw();
  $$('[data-member]', el).forEach((tr) => tr.onclick = () => { location.hash = `#/member/${tr.dataset.member}`; });
  if (!edit) return;

  box.onchange = box.oninput = (e) => {
    const row = e.target.closest('.rule'); if (!row) return;
    const r = rules[+row.dataset.i], f = e.target.dataset.f;
    if (!f) return;
    if (f === 'noWarnings') r.noWarnings = e.target.checked;
    else r[f] = e.target.value === '' ? 0 : Number(e.target.value);
    if (f === 'fromRank' && e.type === 'change') { if (r.toRank <= r.fromRank) r.toRank = roles.find((x) => x.rank > r.fromRank)?.rank || r.toRank; draw(); }
  };
  box.onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { rules.splice(+b.closest('.rule').dataset.i, 1); draw(); } };
  $('#addRule', el).onclick = () => {
    const used = new Set(rules.map((r) => r.fromRank));
    const from = roles.find((x) => !used.has(x.rank) && (!tracked.length || tracked.includes(x.rank)) && roles.some((y) => y.rank > x.rank));
    if (!from) return toast('Every rank already has a rule', 'bad');
    rules.push({ fromRank: from.rank, toRank: roles.find((y) => y.rank > from.rank).rank, minHours: 10, minSessions: 0, days: 30, noWarnings: true });
    draw();
  };
  const body = () => ({ enabled: $('#on', el).checked, mode: val(el, '#mode'), checkHour: Number(val(el, '#hour')), webhookUrl: val(el, '#hook'), rules });
  $('#save', el).onclick = (e) => run(e.currentTarget, async () => { await api(G('/autopromote'), { method: 'PUT', body: body() }); toast('Auto-promotion saved', 'good'); reload(); });
  $('#run', el).onclick = async (e) => {
    const btn = e.currentTarget;
    const promote = val(el, '#mode') === 'promote';
    if (!await confirmBox('Run auto-promotion now?', `This uses the saved rules and mode. ${promote ? 'Everyone who is ready will be ranked up in Roblox.' : 'Everyone who is ready gets a recommendation on the Promotions page.'} Unsaved changes are not used.`, 'Run now', 'primary')) return;
    run(btn, async () => {
      const r = await api(G('/autopromote/run'), { method: 'POST' });
      const ok = r.results.filter((x) => x.result !== 'failed').length, bad = r.results.length - ok;
      if (!r.results.length) toast('Nobody new is ready right now', 'good');
      else toast(`${r.mode === 'promote' ? 'Promoted' : 'Recommended'} ${ok}${bad ? `, ${bad} failed — see Logs` : ''}`, bad ? 'bad' : 'good');
      reload();
    });
  };
};

// ---------- access requests (Owner Menu) ----------
const reqWho = (r) => r.name || r.google_email || r.discord_id;
const reqAccount = (r) => r.provider === 'google' ? `${icon('google', 'sm')} ${esc(r.google_email)}` : `${icon('discord', 'sm')} ${esc(r.name || '')} <span class="muted mono">${esc(r.discord_id)}</span>`;
const answerText = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) ? '<span class="muted">No answer</span>' : esc(Array.isArray(v) ? v.join(', ') : v);

VIEWS.requests = async (el, id, _sub, reload) => {
  if (!isOwner()) throw new Error('Only the owner can review access requests.');
  if (id === 'form') return accessFormEditor(el);
  if (id) return accessRequestPage(el, id, reload);
  const status = ['approved', 'denied'].includes(store.get('rp_reqstatus')) ? store.get('rp_reqstatus') : 'pending';
  const [d, f] = await Promise.all([api(`/api/access-requests?status=${status}`), api('/api/access-form')]);
  const first = d.questions.find((q) => q.type !== 'section');
  el.innerHTML = `${head('Access requests', 'People who signed in without being on the whitelist and asked for access. Approving adds them to the whitelist.', `<a class="btn" href="#/requests/form">${icon('edit')} Edit form</a>`)}
    ${f.form.enabled ? '' : `<div class="callout warn">${icon('alert')}<span>Access requests are turned off — people who aren’t whitelisted just see “not whitelisted”. <a href="#/requests/form">Turn them on</a>.</span></div>`}
    <div class="stats">
      ${stat('Pending', d.counts.pending || 0, 'waiting for you', 'inbox')}
      ${stat('Approved', d.counts.approved || 0, 'all time', 'check')}
      ${stat('Denied', d.counts.denied || 0, 'all time', 'x')}
    </div>
    <div class="card"><div class="head">${seg('rs', [['pending', 'Pending'], ['approved', 'Approved'], ['denied', 'Denied']], status)}</div>
      <div class="tbl-wrap"><table><thead><tr><th>Person</th><th>Account</th>${first ? `<th>${esc(first.label)}</th>` : ''}<th>Sent</th><th></th></tr></thead><tbody>
      ${d.requests.length ? d.requests.map((r) => `<tr class="click" data-id="${r.id}">
        <td>${who(reqWho(r))}</td><td class="nowrap">${reqAccount(r)}</td>
        ${first ? `<td class="wrap-text dim">${answerText(r.answers[first.id])}</td>` : ''}
        <td class="muted">${ago(r.created_at)}${r.reviewer ? `<br><span class="small">${esc(r.status)} by ${esc(r.reviewer)}</span>` : ''}</td>
        <td class="r"><a class="btn sm ${r.status === 'pending' ? 'primary' : ''}" href="#/requests/${r.id}">${r.status === 'pending' ? 'Review' : 'View'}</a></td></tr>`).join('')
        : emptyRow(first ? 5 : 4, `No ${status} requests.`, 'inbox')}
      </tbody></table></div></div>`;
  onSeg(el, 'rs', (v) => { store.set('rp_reqstatus', v); reload(); });
  $('tbody', el).onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && !e.target.closest('a')) location.hash = `#/requests/${tr.dataset.id}`; };
};

async function accessRequestPage(el, id, reload) {
  const { request: r, questions, whitelistedAs, history } = await api(`/api/access-requests/${encodeURIComponent(id)}`);
  const pending = r.status === 'pending';
  let n = 0;
  el.innerHTML = `<div><a href="#/requests" class="muted">${icon('arrowL', 'inl')} Access requests</a></div>
    ${head(reqWho(r), `Asked for access ${fmtTime(r.created_at)}`)}
    <div class="stats">
      ${stat('Status', statusBadge(r.status === 'approved' ? 'accepted' : r.status), r.reviewer ? `by ${esc(r.reviewer)} · ${fmtTime(r.reviewed_at)}` : 'Waiting for you', 'inbox')}
      ${stat('Signed in with', r.provider === 'google' ? 'Google' : 'Discord', r.provider === 'google' ? esc(r.google_email) : esc(r.discord_id), r.provider)}
      ${stat('Earlier requests', history.length, history.length ? history.map((h) => `${esc(h.status)} ${fmtDate(h.created_at)}`).join(' · ') : 'first time asking', 'list')}
    </div>
    ${whitelistedAs ? `<div class="callout">${icon('info')}<span>This account is already on the whitelist as <b>${esc(whitelistedAs.name || 'a user')}</b>.</span></div>` : ''}
    <div class="sub-grid">
      <div class="card"><div class="head"><h2 class="grow">Answers</h2></div><div class="body stack qa">
        ${questions.map((q) => q.type === 'section' ? `<h3 class="qa-sec">${esc(q.label)}</h3>`
          : `<div class="qa-item"><div class="qa-q"><b><span class="muted num">${++n}.</span> ${esc(q.label)}</b></div><div class="qa-a">${answerText(r.answers[q.id])}</div></div>`).join('')}
        ${Object.keys(r.answers).some((k) => !questions.some((q) => q.id === k)) ? `<p class="hint">Some answers are to questions that have since been removed from the form.</p>` : ''}
      </div></div>
      <div class="card decide"><div class="head"><h2 class="grow">Decide</h2></div><div class="body stack">
        ${pending ? `
          <label class="field">Name on the whitelist<input id="nm" maxlength="60" value="${esc(r.name || '')}" placeholder="Shown in logs"></label>
          <div class="stack gap-s"><b style="font-size:13px">Permissions</b><span class="hint">Everyone on the whitelist can view activity, requirements, time off and sessions. You can change this later on Access &amp; whitelist.</span>
            ${S.permissions.map((p) => `<label class="check"><input type="checkbox" data-p="${p}"> ${esc(PERM_LABELS[p] || p)}</label>`).join('')}</div>
          <label class="field">Note (optional)<textarea id="note" maxlength="500" placeholder="Shown to them if you deny"></textarea></label>
          <div class="row wrap"><button class="btn danger grow" data-decide="denied">${icon('x')} Deny</button><button class="btn primary grow" data-decide="approved">${icon('check')} Approve</button></div>`
        : `<p>${statusBadge(r.status === 'approved' ? 'accepted' : r.status)} by <b>${esc(r.reviewer || 'unknown')}</b> <span class="muted">· ${fmtTime(r.reviewed_at)}</span></p>
           ${r.review_note ? `<div class="note"><b>Note:</b> ${esc(r.review_note)}</div>` : ''}
           ${r.status === 'approved' ? '<p class="hint">They can now sign in. Change their permissions on Access &amp; whitelist.</p>' : ''}`}
      </div></div>
    </div>`;
  $$('[data-decide]', el).forEach((b) => b.onclick = async () => {
    const status = b.dataset.decide;
    const perms = $$('[data-p]:checked', el).map((i) => i.dataset.p);
    const ok = status === 'approved'
      ? await confirmBox(`Approve ${reqWho(r)}?`, `They’ll be added to the whitelist with ${perms.length ? `${perms.length} permission${perms.length === 1 ? '' : 's'}` : 'view-only access'} and can sign in right away.`, 'Approve', 'primary')
      : await confirmBox(`Deny ${reqWho(r)}?`, 'They’ll see that the request was denied (and your note), and can ask again after 24 hours.', 'Deny');
    if (!ok) return;
    run(b, async () => {
      await api(`/api/access-requests/${r.id}`, { method: 'PATCH', body: { status, note: val(el, '#note'), name: val(el, '#nm'), permissions: perms } });
      toast(status === 'approved' ? `${reqWho(r)} added to the whitelist` : 'Request denied', 'good');
      reload();
    });
  });
}

async function accessFormEditor(el) {
  const { form } = await api('/api/access-form');
  const qs = form.questions.map((q) => ({ ...q, options: q.options ? [...q.options] : undefined }));
  el.innerHTML = `<div><a href="#/requests" class="muted">${icon('arrowL', 'inl')} Access requests</a></div>
    ${head('Access request form', 'What people see after signing in with an account that isn’t whitelisted.', `<button class="btn primary" id="save">${icon('check')} Save</button>`)}
    <div class="card"><div class="body stack">
      <label class="check"><input type="checkbox" id="on" ${form.enabled ? 'checked' : ''}> Let people who aren’t whitelisted send an access request</label>
      <label class="field">Message at the top<textarea id="intro" maxlength="1000" placeholder="e.g. Only staff of our groups get access. Tell us who you are.">${esc(form.intro || '')}</textarea></label>
      <label class="field">Discord webhook (optional)<input id="hook" value="${esc(form.webhookUrl || '')}" placeholder="https://discord.com/api/webhooks/…"><small>Posts each new request with its answers and a Review button.</small></label>
    </div></div>
    <div class="card"><div class="head"><h2 class="grow">Questions</h2><span class="muted">Their Google or Discord account is recorded automatically.</span></div><div class="body stack">${questionEditorHTML()}</div></div>`;
  bindQuestionEditor(el, qs, { grading: false });
  $('#save', el).onclick = (e) => run(e.currentTarget, async () => {
    await api('/api/access-form', { method: 'PUT', body: { enabled: $('#on', el).checked, intro: val(el, '#intro'), webhookUrl: val(el, '#hook'), questions: qs } });
    toast('Access request form saved', 'good'); location.hash = '#/requests';
  });
}

// Views: blacklist, auto-promotion.
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
    ${!group().hasApiKey && s.mode === 'promote' ? `<div class="callout warn">${icon('alert')}<span>Promote mode needs this group’s Open Cloud key (Groups → edit). Until then, use Recommend mode.</span></div>` : ''}
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
      return `<div class="card"><div class="head"><h2 class="grow">${esc(r.fromName)} → ${esc(r.toName)}</h2>
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
      </div>`).join('') : `<div class="empty">${icon('sparkle')}<div>No rules yet.${edit ? ' Add one — for example “Trainee → Staff after 10 hours and 3 sessions in 30 days”.' : ''}</div></div>`;
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

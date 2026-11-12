// Views: overview, activity, member profile, requirements, time off, ranking, sessions.
'use strict';

const SERIES_FROM = () => addDays(weekStart(today()), -77); // 12 weeks of history for graphs
const chartCard = (title) => `<div class="card"><div class="head"><h2 class="grow">${title}</h2>${seg('gmode', [['daily', 'Daily'], ['weekly', 'Weekly']], store.get('rp_gmode') || 'daily')}</div><div class="body"><div id="chart"></div><p class="hint" style="margin-top:8px">Days are counted in UTC; weeks start on Monday.</p></div></div>`;
// ---------- heatmap: when members play (weekday × hour, viewer's local time) ----------
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const heatCard = () => `<div class="card"><div class="head"><div class="grow"><h2>When members play</h2><span class="muted small" id="heatSub"></span></div>
    ${seg('heatDays', [['7', '7 days'], ['28', '28 days'], ['90', '90 days']], store.get('rp_heat') || '28')}</div>
  <div class="body stack"><div class="heat-wrap"><div class="heat" id="heat" role="img" aria-label="Hours played by weekday and hour"></div><div class="tip hidden" id="heatTip"></div></div>
    <div class="row wrap heat-foot"><span class="dim small" id="heatBusy"></span><span class="heat-legend right" aria-hidden="true"><span class="muted small">Less</span>${[0, 1, 2, 3, 4].map((i) => `<i class="h${i}"></i>`).join('')}<span class="muted small">More</span></span></div></div></div>`;
async function mountHeatmap(el) {
  const box = $('#heat', el), tip = $('#heatTip', el);
  const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;
  const draw = async (days) => {
    const d = await api(G(`/heatmap?days=${days}`));
    // Buckets come in UTC; shift to this viewer's time zone (whole hours).
    const shift = Math.round(-new Date().getTimezoneOffset() / 60);
    const local = new Array(168).fill(0);
    d.buckets.forEach((v, i) => { local[(((i + shift) % 168) + 168) % 168] += v; });
    const max = Math.max(...local);
    const weeks = Math.max(1, d.days / 7);
    // 5 sequential steps of one hue; empty hours stay neutral.
    const step = (v) => (!v || !max ? 0 : Math.min(4, 1 + Math.floor((v / max) * 3.999)));
    box.innerHTML = `<span></span>${Array.from({ length: 24 }, (_, h) => `<span class="hx">${h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span>`).join('')}
      ${WEEKDAYS.map((w, r) => `<span class="hy">${w}</span>${Array.from({ length: 24 }, (_, h) => { const v = local[r * 24 + h]; return `<i class="h${step(v)}" data-i="${r * 24 + h}" tabindex="-1"></i>`; }).join('')}`).join('')}`;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
    $('#heatSub', el).textContent = `Last ${d.days} days · ${tz}`;
    const top = local.map((v, i) => [v, i]).filter(([v]) => v > 0).sort((a, b) => b[0] - a[0]).slice(0, 3);
    $('#heatBusy', el).innerHTML = top.length ? `Busiest: ${top.map(([v, i]) => `<b>${WEEKDAYS[Math.floor(i / 24)]} ${hourLabel(i % 24)}</b> (${fmtHours(v / weeks)} h/week)`).join(' · ')}` : 'No play sessions in this period yet.';
    box.onmousemove = (e) => {
      const c = e.target.closest('i[data-i]'); if (!c) { tip.classList.add('hidden'); return; }
      const i = +c.dataset.i, v = local[i];
      tip.innerHTML = `<b>${fmtDur(v)} played</b>${WEEKDAYS[Math.floor(i / 24)]} ${hourLabel(i % 24)}–${hourLabel((i % 24 + 1) % 24)}<br><span class="muted">≈ ${fmtDur(v / weeks)} per week</span>`;
      const r = c.getBoundingClientRect(), p = box.parentElement.getBoundingClientRect();
      tip.style.left = `${r.left - p.left + r.width / 2}px`; tip.style.top = `${r.top - p.top - 6}px`;
      tip.classList.remove('hidden');
    };
    box.onmouseleave = () => tip.classList.add('hidden');
  };
  onSeg(el, 'heatDays', (v) => { store.set('rp_heat', v); run(null, () => draw(v)); });
  await draw(store.get('rp_heat') || '28');
}

function mountChart(el, series) {
  const draw = (mode) => barChart($('#chart', el), bucketSeries(series, mode));
  onSeg(el, 'gmode', (v) => { store.set('rp_gmode', v); draw(v); });
  draw(store.get('rp_gmode') || 'daily');
}

// ---------- overview ----------
VIEWS.overview = async (el) => {
  const t = today();
  const [o, a] = await Promise.all([api(G('/overview')), api(G(`/activity?from=${t}&to=${t}&seriesFrom=${SERIES_FROM()}`))]);
  const g = group();
  el.innerHTML = `${head(g.name, 'What is happening in this group right now.')}
    ${g.trackedRanks.length ? '' : `<div class="callout warn">${icon('alert')}<span>No ranks are tracked yet, so no activity is being recorded. ${can('manage_groups') ? '<a href="#/groups">Choose tracked ranks</a>.' : ''}</span></div>`}
    <div class="stats">
      ${stat('Hours today', fmtHours(o.today.seconds), `${o.today.members} member${o.today.members === 1 ? '' : 's'} active`, 'clock')}
      ${stat('Hours this week', fmtHours(o.week.seconds), `${o.week.members} active of ${o.trackedMembers} tracked`, 'chart')}
      ${stat('In game now', o.online, o.online ? '<span class="dot"></span> live' : 'nobody online', 'play')}
      ${stat('Weekly requirement', o.requirements.due ? `${o.requirements.met}/${o.requirements.due}` : '—', o.requirements.due ? 'have met it so far' : 'no requirement set', 'target')}
      ${stat('Pending time off', o.pendingTimeOff, '<a href="#/timeoff">Review</a>', 'calendar')}
      ${stat('Pending applications', o.pendingApplications, can('review_applications') || can('manage_applications') ? '<a href="#/applications">Review</a>' : '', 'file')}
      ${stat('Promotion picks', o.openRecommendations, '<a href="#/promotions">Vote</a>', 'thumb')}
    </div>
    ${chartCard('Total hours played')}
    <div class="grid2">
      <div class="card"><div class="head">${icon('trophy')}<h2 class="grow">This week's leaders</h2></div>
        <div class="body leaders">
          <div><h3 class="muted">Most time played</h3>${o.leaders.minutes.length ? `<ol class="podium">${o.leaders.minutes.map((m, i) => `<li><span class="place p${i + 1}">${i + 1}</span><a href="#/member/${esc(m.robloxId)}">${esc(m.username)}</a><span class="muted grow">${esc(m.roleName)}</span><b class="num">${fmtDur(m.value)}</b></li>`).join('')}</ol>` : '<p class="muted">Nobody has played yet this week.</p>'}</div>
          <div><h3 class="muted">Most sessions</h3>${o.leaders.sessions.length ? `<ol class="podium">${o.leaders.sessions.map((m, i) => `<li><span class="place p${i + 1}">${i + 1}</span><a href="#/member/${esc(m.robloxId)}">${esc(m.username)}</a><span class="muted grow">${esc(m.roleName)}</span><b class="num">${m.value}</b></li>`).join('')}</ol>` : '<p class="muted">No completed sessions yet this week.</p>'}</div>
        </div></div>
      <div class="card"><div class="head">${icon('megaphone')}<h2 class="grow">News</h2><a class="btn sm ghost" href="#/news">All</a></div>
        ${o.news.length ? `<div class="body stack">${o.news.map((n) => `<article class="news-mini">${n.pinned ? `<span class="badge accent">${icon('pin', 'sm')} Pinned</span>` : ''}<b>${esc(n.title)}</b><p class="dim clamp2">${esc(plainText(n.body))}</p><span class="muted">${esc(n.author || '')} · ${ago(n.created_at)}</span></article>`).join('')}</div>` : `<div class="empty">No news yet.${can('manage_content') ? ' <a href="#/news">Post an update</a>.' : ''}</div>`}</div>
    </div>
    <div class="grid2">
      <div class="card"><div class="head"><h2 class="grow">Upcoming sessions</h2><a class="btn sm ghost" href="#/sessions">All</a></div>
        ${o.upcoming.length ? `<table><tbody>${o.upcoming.map((e) => `<tr><td><b>${esc(e.title)}</b><br><span class="muted">${esc(e.type)}${e.host_name ? ` · ${esc(e.host_name)}` : ''}</span></td><td class="r">${fmtTime(e.starts_at)}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">Nothing scheduled.</div>`}</div>
      <div class="card"><div class="head"><h2 class="grow">Recent activity log</h2>${can('view_logs') ? '<a class="btn sm ghost" href="#/logs">All</a>' : ''}</div>
        ${o.recentLogs.length ? `<table><tbody>${o.recentLogs.map((l) => `<tr><td>${esc(l.summary)}<br><span class="muted">${ago(l.ts)}</span></td></tr>`).join('')}</tbody></table>` : `<div class="empty">${can('view_logs') ? 'No log entries yet.' : 'You do not have access to logs.'}</div>`}</div>
    </div>`;
  mountChart(el, a.series);
};

// ---------- activity ----------
VIEWS.activity = async (el, _a, _b, reload) => {
  const t = today(), wk = weekStart(t);
  const RANGES = { today: ['Today', t, t], week: ['This week', wk, t], last: ['Last week', addDays(wk, -7), addDays(wk, -1)], month: ['30 days', addDays(t, -29), t], all: ['All time', '2000-01-01', t] };
  let rangeKey = store.get('rp_range') in RANGES ? store.get('rp_range') : 'week';
  let data, filter = '';

  el.innerHTML = `${head('Activity', 'Time played by members in tracked ranks.', `
      <button class="btn" id="csv">${icon('download')} Export CSV</button>
      ${can('manage_activity') ? `<button class="btn" id="adjust">${icon('edit')} Adjust time</button>` : ''}
      ${can('manage_activity') || can('manage_groups') ? `<button class="btn" id="sync">${icon('refresh')} Sync members</button>` : ''}`)}
    ${chartCard('Total hours played')}
    ${heatCard()}
    <div class="card">
      <div class="head">
        ${seg('range', Object.entries(RANGES).map(([k, v]) => [k, v[0]]), rangeKey)}
        <div class="row"><input type="date" id="from" aria-label="From" style="width:auto"><span class="muted">to</span><input type="date" id="to" aria-label="To" style="width:auto"></div>
        <div class="search right" style="width:200px">${icon('search', 'sm')}<input id="q" placeholder="Search members" aria-label="Search members"></div>
      </div>
      <div class="stats" id="tot" style="padding:16px 16px 0"></div>
      <div class="tbl-wrap"><table><thead><tr><th>#</th><th>Member</th><th>Rank</th><th>Time played</th><th></th><th class="r">Idle</th><th class="r">Sessions</th><th class="r">Messages</th></tr></thead><tbody id="rows"></tbody></table></div>
    </div>`;

  const rows = () => {
    const list = data.leaderboard.filter((m) => !filter || `${m.username} ${m.displayName || ''} ${m.roleName || ''}`.toLowerCase().includes(filter));
    const top = Math.max(1, ...data.leaderboard.map((m) => m.seconds));
    $('#tot', el).innerHTML = stat('Total', `${fmtHours(data.totals.seconds)}h`, `${fmtDay(data.from)} – ${fmtDay(data.to)}`) + stat('Active members', `${data.totals.active}/${data.totals.members}`, 'played in this range') + stat('Average', fmtDur(data.totals.members ? data.totals.seconds / data.totals.members : 0), 'per tracked member') + stat('In game now', data.totals.online, '');
    $('#rows', el).innerHTML = list.length ? list.map((m, i) => `<tr class="click" data-id="${m.robloxId}" tabindex="0">
        <td class="muted num">${i + 1}</td>
        <td>${who(m.username, m.displayName && m.displayName !== m.username ? m.displayName : '')}</td>
        <td>${m.tracked ? esc(m.roleName || m.rank) : '<span class="badge">Former</span>'} ${m.online ? '<span class="badge good"><span class="dot"></span> In game</span>' : ''}</td>
        <td class="num"><b>${fmtDur(m.seconds)}</b></td>
        <td style="width:22%"><div class="meter"><i style="width:${(m.seconds / top) * 100}%"></i></div></td>
        <td class="r num muted">${fmtDur(m.idleSeconds)}</td><td class="r num">${m.sessions}</td><td class="r num">${m.messages}</td></tr>`).join('')
      : emptyRow(8, data.leaderboard.length ? 'No members match that search.' : 'No tracked members yet. Members appear when they join the game, or after “Sync members”.', 'users');
  };
  const load = async (from, to) => {
    data = await api(G(`/activity?from=${from}&to=${to}&seriesFrom=${SERIES_FROM()}`));
    $('#from', el).value = data.from === '2000-01-01' ? '' : data.from; $('#to', el).value = data.to;
    rows();
  };
  await load(RANGES[rangeKey][1], RANGES[rangeKey][2]);
  mountChart(el, data.series);
  await mountHeatmap(el);

  onSeg(el, 'range', (k) => { rangeKey = k; store.set('rp_range', k); run(null, () => load(RANGES[k][1], RANGES[k][2])); });
  const custom = () => { const f = $('#from', el).value, to = $('#to', el).value; if (f && to && f <= to) { $$('#range button', el).forEach((b) => b.classList.remove('on')); run(null, () => load(f, to)); } };
  $('#from', el).onchange = custom; $('#to', el).onchange = custom;
  $('#q', el).oninput = (e) => { filter = e.target.value.trim().toLowerCase(); rows(); };
  const open = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && (e.type === 'click' || e.key === 'Enter')) location.hash = `#/member/${tr.dataset.id}`; };
  $('#rows', el).onclick = open; $('#rows', el).onkeydown = open;
  if ($('#sync', el)) $('#sync', el).onclick = (e) => run(e.currentTarget, async () => { const r = await api(G('/sync-members'), { method: 'POST' }); toast(`Synced ${r.synced} members from Roblox`, 'good'); reload(); });
  if ($('#adjust', el)) $('#adjust', el).onclick = () => adjustModal('', reload);
  $('#csv', el).onclick = () => {
    const list = data.leaderboard.filter((m) => !filter || `${m.username} ${m.displayName || ''} ${m.roleName || ''}`.toLowerCase().includes(filter));
    downloadCSV(`activity-${group().name.replace(/[^\w-]+/g, '_')}-${data.from === '2000-01-01' ? 'all' : data.from}-to-${data.to}.csv`, [
      ['Roblox ID', 'Username', 'Display name', 'Rank', 'Role', 'Hours played', 'Idle hours', 'Sessions', 'Messages', 'Tracked'],
      ...list.map((m) => [m.robloxId, m.username, m.displayName || '', m.rank ?? '', m.roleName || '', (m.seconds / 3600).toFixed(2), ((m.idleSeconds || 0) / 3600).toFixed(2), m.sessions, m.messages, m.tracked ? 'yes' : 'no']),
    ]);
  };
};

function adjustModal(user, done) {
  modal({ title: 'Adjust activity time', body: `
      <label class="field">Member<input id="u" value="${esc(user)}" placeholder="Roblox username or user ID"></label>
      <div class="grid2"><label class="field">Day (UTC)<input id="d" type="date" value="${today()}"></label>
      <label class="field">Minutes<input id="m" type="number" placeholder="e.g. 30 or -15"><small>Negative removes time.</small></label></div>
      <label class="field">Reason<input id="r" placeholder="Shown in the logs"></label>`,
    actions: [{ label: 'Apply', kind: 'primary', onClick: async (close, m) => {
      await api(G('/activity/adjust'), { body: { user: val(m, '#u'), day: val(m, '#d'), minutes: Number(val(m, '#m')), reason: val(m, '#r') } });
      close(); toast('Activity adjusted', 'good'); done();
    } }] });
}

// ---------- member profile ----------
VIEWS.member = async (el, rid, _b, reload) => {
  const p = await api(G(`/members/${rid}`));
  const m = p.member, g = group();
  const tracked = g.trackedRanks.includes(m.rank);
  el.innerHTML = `<div><a href="#/activity" class="muted">← Activity</a></div>
    <div class="page-head">
      <span class="ava" style="width:48px;height:48px;font-size:20px">${esc(m.username[0].toUpperCase())}</span>
      <div class="grow"><h1>${esc(m.username)}</h1>
        <p>${tracked ? esc(m.roleName || `Rank ${m.rank}`) : 'No longer in a tracked rank'} · Roblox ID <span class="mono">${esc(m.robloxId)}</span>
        ${p.discord ? ` · ${icon('discord', 'sm')} ${esc(p.discord.name || p.discord.id)}` : ' · <span class="muted">Discord not linked</span>'}</p></div>
      <div class="row wrap">
        <a class="btn" target="_blank" rel="noopener" href="https://www.roblox.com/users/${encodeURIComponent(m.robloxId)}/profile">${icon('external')} Roblox profile</a>
        <button class="btn" id="recBtn">${icon('thumb')} Recommend</button>
        ${can('manage_discipline') ? `<button class="btn" id="lbBtn">${icon('clipboard')} Log entry</button>` : ''}
        ${can('ranking') ? `<button class="btn" data-rank="demote">${icon('down')} Demote</button><button class="btn primary" data-rank="promote">${icon('up')} Promote</button>` : ''}
      </div>
    </div>
    <div class="stats">
      ${stat('Today', fmtDur(p.totals.today))}${stat('This week', fmtDur(p.totals.week))}${stat('All time', `${fmtHours(p.totals.allTime)}h`)}
      ${stat('Game sessions', p.totals.sessions)}${stat('Sessions attended', p.sessionsAttended.week, `${p.sessionsAttended.allTime} all time`)}${stat('Active warnings', p.activeWarnings, p.activeWarnings ? '<a href="#lb" data-jump>See logbook</a>' : 'clean record')}${stat('Messages', p.totals.messages)}
    </div>
    ${chartCard('Hours played')}
    <div class="card" id="lb"><div class="head">${icon('clipboard')}<h2 class="grow">Logbook</h2>${p.activeWarnings ? `<span class="badge warn">${p.activeWarnings} active warning${p.activeWarnings === 1 ? '' : 's'}</span>` : '<span class="badge good">No active warnings</span>'}</div>
      ${logbookTable(p.logbook, false)}</div>
    <div class="grid2">
      <div class="card"><div class="head"><h2 class="grow">Notes</h2>${can('manage_activity') ? `<button class="btn sm" id="addNote">${icon('plus', 'sm')} Add</button>` : ''}</div>
        <div class="body stack gap-s">${p.notes.length ? p.notes.map((n) => `<div class="note ${n.kind}"><div class="row"><span class="badge ${n.kind === 'warning' ? 'warn' : ''}">${n.kind}</span><span class="muted grow">${esc(n.author || '')} · ${ago(n.created_at)}</span>${can('manage_activity') ? `<button class="btn ghost icon sm" data-del-note="${n.id}" aria-label="Delete note">${icon('trash', 'sm')}</button>` : ''}</div><div>${esc(n.text)}</div></div>`).join('') : '<span class="muted">Nothing recorded.</span>'}</div></div>
      <div class="card"><div class="head"><h2>Time off</h2></div>
        ${p.timeOff.length ? `<table><tbody>${p.timeOff.map((t) => `<tr><td>${fmtDay(t.start_date)} – ${fmtDay(t.end_date)}<br><span class="muted">${esc(t.reason || 'No reason given')}</span></td><td class="r">${statusBadge(t.status)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No time off.</div>'}</div>
    </div>
    <div class="grid2">
      <div class="card"><div class="head"><h2>Recent play sessions</h2></div><div class="tbl-wrap"><table><thead><tr><th>Started</th><th>Length</th><th class="r">Idle</th><th class="r">Msgs</th></tr></thead><tbody>
        ${p.sessions.length ? p.sessions.map((s) => `<tr><td>${fmtTime(s.start)} ${s.live ? '<span class="badge good"><span class="dot"></span> Live</span>' : ''}</td><td class="num">${fmtDur(s.seconds)}</td><td class="r num muted">${fmtDur(s.idleSeconds)}</td><td class="r num">${s.messages}</td></tr>`).join('') : emptyRow(4, 'No sessions recorded.', 'clock')}</tbody></table></div></div>
      <div class="card"><div class="head"><h2>Session register</h2></div><div class="tbl-wrap"><table><tbody>
        ${p.register.length ? p.register.map((r) => `<tr><td><b>${esc(r.title)}</b> <span class="badge">${esc(r.type)}</span></td><td><span class="badge ${r.role === 'host' ? 'accent' : ''}">${esc(r.role === 'cohost' ? 'co-host' : r.role)}</span></td><td class="muted">${fmtTime(r.starts_at)}</td><td class="r">${statusBadge(r.status)}</td></tr>`).join('') : emptyRow(4, 'Not on any session register yet.', 'clock')}</tbody></table></div></div>
    </div>
    <div>
      <div class="card"><div class="head"><h2>Requirement history</h2></div><div class="tbl-wrap"><table><thead><tr><th>Period</th><th>Played</th><th class="r">Result</th></tr></thead><tbody>
        ${p.requirements.length ? p.requirements.map((r) => `<tr><td>${r.period_type === 'daily' ? fmtDay(r.period_start) : `Week of ${fmtDay(r.period_start)}`}</td><td class="num">${fmtDur(r.seconds)} / ${fmtDur(r.required)}</td><td class="r">${r.met ? '<span class="badge good">Met</span>' : r.exempt ? '<span class="badge">Excused</span>' : '<span class="badge bad">Not met</span>'}</td></tr>`).join('') : emptyRow(3, 'No checks have run yet.', 'target')}</tbody></table></div></div>
    </div>`;
  mountChart(el, p.series);
  $$('[data-rank]', el).forEach((b) => b.onclick = () => rankModal(m.username, b.dataset.rank, reload));
  $('#recBtn', el).onclick = () => recommendModal(m.username, reload);
  if ($('#lbBtn', el)) $('#lbBtn', el).onclick = () => logbookModal(m.username, reload);
  bindLogbookRevoke(el, reload);
  el.addEventListener('click', (e) => { if (e.target.closest('[data-jump]')) { e.preventDefault(); $('#lb', el).scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
  if ($('#addNote', el)) $('#addNote', el).onclick = () => modal({ title: `Add note — ${m.username}`, body: `
      <p class="hint">For warnings, strikes and other formal records use the <b>Logbook</b> instead.</p>
      <label class="field">Text<textarea id="t" maxlength="1000"></textarea></label>`,
    actions: [{ label: 'Save', kind: 'primary', onClick: async (close, mm) => { await api(G(`/members/${rid}/notes`), { body: { kind: 'note', text: val(mm, '#t') } }); close(); reload(); } }] });
  $$('[data-del-note]', el).forEach((b) => b.onclick = async () => { if (await confirmBox('Delete note?', 'This cannot be undone.', 'Delete')) run(b, async () => { await api(`/api/notes/${b.dataset.delNote}`, { method: 'DELETE' }); reload(); }); });
};

function rankModal(user, action, done) {
  const g = group();
  const max = g.settings.ranking?.maxRank || 254;
  modal({ title: 'Change rank', body: `
      ${g.hasApiKey ? '' : `<div class="callout warn">${icon('alert')}<span>This group has no Open Cloud API key, so ranking will fail. Add one in Groups.</span></div>`}
      <label class="field">Member<input id="u" value="${esc(user)}" placeholder="Roblox username or user ID"></label>
      <label class="field">Action<select id="a">${[['promote', 'Promote one rank'], ['demote', 'Demote one rank'], ['set', 'Set a specific rank']].map(([v, l]) => `<option value="${v}" ${v === action ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field ${action === 'set' ? '' : 'hidden'}" id="rk">Rank<select id="r">${rolesOf(g).filter((r) => r.rank <= max).map((r) => `<option value="${r.rank}">${esc(r.name)} (${r.rank})</option>`).join('')}</select></label>
      <label class="field">Reason<input id="why" placeholder="Shown in the logs"></label>`,
    actions: [{ label: 'Apply', kind: 'primary', onClick: async (close, m) => {
      const r = await api(G('/ranking'), { body: { user: val(m, '#u'), action: val(m, '#a'), rank: Number(val(m, '#r') || 0), reason: val(m, '#why') } });
      close(); toast(`${r.user.name}: ${r.from.name} → ${r.to.name}`, 'good'); done();
    } }] }).el.querySelector('#a').onchange = (e) => e.target.closest('.body').querySelector('#rk').classList.toggle('hidden', e.target.value !== 'set');
}

// ---------- ranking ----------
VIEWS.ranking = async (el, _a, _b, reload) => {
  if (!can('ranking')) throw new Error('You do not have permission to rank members.');
  const g = group();
  const logs = can('view_logs') ? (await api(`/api/logs?group=${S.gid}&type=rank&limit=30`)).logs : null;
  el.innerHTML = `${head('Ranking', 'Promote, demote or set ranks through Roblox Open Cloud. Every change is logged.', `<button class="btn primary" id="go">${icon('rank')} Change a rank</button>`)}
    ${g.hasApiKey ? '' : `<div class="callout warn">${icon('alert')}<span>No Open Cloud API key is set for this group. ${can('manage_groups') ? '<a href="#/groups">Add one</a>.' : 'Ask a group manager to add one.'}</span></div>`}
    <div class="card"><div class="head"><h2 class="grow">Group ranks</h2><span class="muted">Highest rank this system may assign: ${g.settings.ranking?.maxRank || 254}</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>Rank</th><th>Role</th><th class="r">Members</th><th class="r">Tracked</th></tr></thead><tbody>
      ${rolesOf(g).length ? rolesOf(g).slice().reverse().map((r) => `<tr><td class="num">${r.rank}</td><td>${esc(r.name)}</td><td class="r num">${r.memberCount ?? '—'}</td><td class="r">${g.trackedRanks.includes(r.rank) ? '<span class="badge accent">Tracked</span>' : ''}</td></tr>`).join('') : emptyRow(4, 'Roles load once an Open Cloud key is added.', 'rank')}</tbody></table></div></div>
    <div class="card"><div class="head"><h2>Recent rank changes</h2></div>
      ${logs ? `<div class="tbl-wrap"><table><tbody>${logs.length ? logs.map((l) => `<tr><td><span class="badge ${l.type === 'rank.demote' ? 'bad' : 'good'}">${esc(l.type.split('.')[1])}</span></td><td>${esc(l.summary)}</td><td class="muted">${esc(l.actor_name || '')}</td><td class="r muted">${ago(l.ts)}</td></tr>`).join('') : emptyRow(4, 'No rank changes yet.', 'rank')}</tbody></table></div>` : '<div class="empty">You need log access to see rank history.</div>'}</div>`;
  $('#go', el).onclick = () => rankModal('', 'promote', reload);
};

// ---------- requirements ----------
VIEWS.requirements = async (el, _a, _b, reload) => {
  const g = group();
  const r = g.settings.requirements || {};
  const manage = can('manage_activity') || can('manage_groups');
  let type = store.get('rp_reqtype') === 'daily' ? 'daily' : 'weekly';
  const tracked = rolesOf(g).filter((x) => g.trackedRanks.includes(x.rank));

  el.innerHTML = `${head('Requirements', 'Minimum activity for members in tracked ranks. Misses are logged and sent to Discord.', manage ? `<button class="btn" id="runNow">${icon('bell')} Run check now</button>` : '')}
    <div class="card"><div class="head">${seg('rtype', [['weekly', 'This week'], ['daily', 'Today']], type)}<span class="muted right" id="rsum"></span></div>
      <div class="tbl-wrap"><table><thead><tr><th>Member</th><th>Rank</th><th>Progress</th><th></th><th class="r">Status</th></tr></thead><tbody id="rrows"></tbody></table></div></div>
    ${manage ? `<div class="card"><div class="head"><h2 class="grow">Settings</h2><label class="check"><input type="checkbox" id="en" ${r.enabled ? 'checked' : ''}> Automatic checks enabled</label></div>
      <div class="body stack">
        <div class="grid4">
          <label class="field">Daily requirement (minutes)<input type="number" id="dm" min="0" value="${r.dailyMinutes || 0}"><small>0 = no daily requirement.</small></label>
          <label class="field">Weekly requirement (minutes)<input type="number" id="wm" min="0" value="${r.weeklyMinutes || 0}"><small>0 = no weekly requirement.</small></label>
          <label class="field">Weekly sessions<input type="number" id="ws" min="0" max="100" value="${r.weeklySessions || 0}"><small>Hosted, co-hosted or attended. 0 = none.</small></label>
          <label class="field">Check at (UTC hour)<select id="ch">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === (r.checkHour || 0) ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select><small>Daily: checks yesterday. Weekly: Mondays, checks last week.</small></label>
        </div>
        ${tracked.length ? `<div><h3>Per-rank overrides</h3><p class="hint">Leave blank to use the defaults above.</p>
          <div class="tbl-wrap"><table><thead><tr><th>Rank</th><th>Daily minutes</th><th>Weekly minutes</th><th>Weekly sessions</th></tr></thead><tbody>${tracked.map((x) => `<tr><td>${esc(x.name)} <span class="muted">(${x.rank})</span></td>
            <td><input type="number" min="0" data-ov="${x.rank}" data-k="dailyMinutes" value="${r.rankOverrides?.[x.rank]?.dailyMinutes ?? ''}" placeholder="default" aria-label="Daily minutes for ${esc(x.name)}"></td>
            <td><input type="number" min="0" data-ov="${x.rank}" data-k="weeklyMinutes" value="${r.rankOverrides?.[x.rank]?.weeklyMinutes ?? ''}" placeholder="default" aria-label="Weekly minutes for ${esc(x.name)}"></td>
            <td><input type="number" min="0" data-ov="${x.rank}" data-k="weeklySessions" value="${r.rankOverrides?.[x.rank]?.weeklySessions ?? ''}" placeholder="default" aria-label="Weekly sessions for ${esc(x.name)}"></td></tr>`).join('')}</tbody></table></div></div>` : ''}
        <label class="check"><input type="checkbox" id="ci" ${r.countIdle === false ? '' : 'checked'}> Count idle (AFK) time towards requirements</label>
        <h3>Discord notification</h3>
        <label class="field">Webhook URL<input id="wh" value="${esc(r.webhookUrl || '')}" placeholder="https://discord.com/api/webhooks/…"></label>
        <div class="grid2">
          <label class="field">Role to mention (optional)<input id="mr" value="${esc(r.mentionRoleId || '')}" placeholder="Discord role ID"></label>
          <div class="stack gap-s" style="justify-content:flex-end">
            <label class="check"><input type="checkbox" id="pm" ${r.pingMembers ? 'checked' : ''}> Ping members whose Discord is linked</label>
            <label class="check"><input type="checkbox" id="am" ${r.notifyAllMet ? 'checked' : ''}> Also post when everyone met it</label>
          </div>
        </div>
        <label class="field">Header message<input id="ht" value="${esc(r.headerTemplate || '')}" placeholder="{count} member(s) did not meet the {period} activity requirement ({range})."><small>Placeholders: <code>{count}</code> <code>{period}</code> <code>{range}</code> <code>{group}</code> <code>{checked}</code></small></label>
        <label class="field">Line per member<input id="lt" value="${esc(r.lineTemplate || '')}" placeholder="{mention} **{user}** ({rank}) — {played} / {required}"><small>Placeholders: <code>{mention}</code> <code>{user}</code> <code>{id}</code> <code>{rank}</code> <code>{played}</code> <code>{required}</code> <code>{missing}</code></small></label>
        <div class="row"><button class="btn primary" id="save">Save settings</button></div>
      </div></div>` : ''}
    <div class="card"><div class="head"><h2>Past checks</h2></div><div class="tbl-wrap"><table><thead><tr><th>Period</th><th>Ran</th><th class="r">Not met</th></tr></thead><tbody id="runs"></tbody></table></div></div>`;

  const load = async () => {
    const d = await api(G(`/requirements?type=${type}`));
    const due = d.members.filter((m) => m.required > 0 || m.requiredSessions > 0);
    const pct = (m) => Math.min(100, Math.min(m.required ? m.seconds / m.required : 1, m.requiredSessions ? m.sessions / m.requiredSessions : 1) * 100);
    const togo = (m) => [m.seconds < m.required ? fmtDur(m.required - m.seconds) : '', m.sessions < m.requiredSessions ? `${m.requiredSessions - m.sessions} session${m.requiredSessions - m.sessions === 1 ? '' : 's'}` : ''].filter(Boolean).join(' + ');
    $('#rsum', el).textContent = due.length ? `${due.filter((m) => m.met).length} of ${due.length} have met it · ${fmtDay(d.from)}${d.from === d.to ? '' : ` – ${fmtDay(d.to)}`}` : `No ${type} requirement set`;
    $('#rrows', el).innerHTML = due.length ? due.map((m) => `<tr class="click" data-id="${m.robloxId}"><td>${who(m.username)}</td><td>${esc(m.roleName || m.rank)}</td>
        <td class="num">${m.required ? `${fmtDur(m.seconds)} / ${fmtDur(m.required)}` : ''}${m.requiredSessions ? `${m.required ? '<br>' : ''}<span class="${m.required ? 'muted' : ''}">${m.sessions} / ${m.requiredSessions} sessions</span>` : ''}</td><td style="width:26%"><div class="meter ${m.met ? 'good' : ''}"><i style="width:${pct(m)}%"></i></div></td>
        <td class="r">${m.met ? `<span class="badge good">${icon('check', 'sm')} Met</span>` : m.exempt ? '<span class="badge">On time off</span>' : `<span class="badge warn">${togo(m)} to go</span>`}</td></tr>`).join('')
      : emptyRow(5, d.members.length ? `Set a ${type} requirement below to see progress.` : 'No tracked members yet.', 'target');
    $('#runs', el).innerHTML = d.runs.length ? d.runs.map((x) => `<tr><td>${x.period_type === 'daily' ? fmtDay(x.period_start) : `Week of ${fmtDay(x.period_start)}`} <span class="badge">${x.period_type}</span></td><td class="muted">${fmtTime(x.ran_at)}</td><td class="r num">${x.failed} of ${x.checked}</td></tr>`).join('') : emptyRow(3, 'No checks have run yet.', 'clock');
  };
  await load();
  onSeg(el, 'rtype', (v) => { type = v; store.set('rp_reqtype', v); run(null, load); });
  $('#rrows', el).onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) location.hash = `#/member/${tr.dataset.id}`; };

  if (!manage) return;
  $('#save', el).onclick = (e) => run(e.currentTarget, async () => {
    const overrides = {};
    $$('[data-ov]', el).forEach((i) => { if (i.value !== '') (overrides[i.dataset.ov] ||= {})[i.dataset.k] = Number(i.value); });
    const out = await api(G(), { method: 'PATCH', body: { requirements: {
      enabled: $('#en', el).checked, dailyMinutes: Number(val(el, '#dm')), weeklyMinutes: Number(val(el, '#wm')), weeklySessions: Number(val(el, '#ws')), checkHour: Number(val(el, '#ch')), countIdle: $('#ci', el).checked,
      webhookUrl: val(el, '#wh'), mentionRoleId: val(el, '#mr'), pingMembers: $('#pm', el).checked, notifyAllMet: $('#am', el).checked,
      headerTemplate: val(el, '#ht'), lineTemplate: val(el, '#lt'), rankOverrides: overrides } } });
    Object.assign(g, out.group); toast('Requirements saved', 'good'); reload();
  });
  $('#runNow', el).onclick = () => modal({ title: 'Run a requirement check', body: `
      <p class="dim">Checks a period right now, records the results and logs everyone who has not met it.</p>
      <label class="field">Period<select id="p"><option value="weekly:0">This week (so far)</option><option value="weekly:-7">Last week</option><option value="daily:0">Today (so far)</option><option value="daily:-1">Yesterday</option></select></label>
      <label class="check"><input type="checkbox" id="s" checked> Send the result to the Discord webhook</label>`,
    actions: [{ label: 'Run check', kind: 'primary', onClick: async (close, m) => {
      const [t, off] = val(m, '#p').split(':');
      const send = $('#s', m).checked;
      const out = await api(G('/requirements/run'), { body: { type: t, start: addDays(today(), Number(off)), send } });
      close(); toast(`${out.failed.length} of ${out.checked} did not meet it${send ? (out.sent ? ' — sent to Discord' : ' — nothing sent to Discord') : ''}`, out.failed.length ? '' : 'good'); reload();
    } }] });
};

// ---------- time off ----------
VIEWS.timeoff = async (el, _a, _b, reload) => {
  const { timeOff } = await api(G('/timeoff'));
  const manage = can('manage_activity');
  const t = today();
  el.innerHTML = `${head('Time off', 'Approved time off excuses a member from requirements for any period it overlaps.', manage ? `<button class="btn primary" id="add">${icon('plus')} Add time off</button>` : '')}
    <div class="card"><div class="tbl-wrap"><table><thead><tr><th>Member</th><th>Dates</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>
    ${timeOff.length ? timeOff.map((x) => `<tr><td>${who(x.username || x.roblox_id, x.requested_by ? `Requested by ${x.requested_by}` : '')}</td>
      <td>${fmtDay(x.start_date)} – ${fmtDay(x.end_date)} ${x.status === 'approved' && x.start_date <= t && x.end_date >= t ? '<span class="badge accent">Active now</span>' : ''}</td>
      <td class="dim">${esc(x.reason || '—')}</td><td>${statusBadge(x.status)}</td>
      <td class="r"><div class="row" style="justify-content:flex-end">${manage && x.status === 'pending' ? `<button class="btn sm good" data-rev="${x.id}:approved">${icon('check', 'sm')} Approve</button><button class="btn sm danger" data-rev="${x.id}:denied">${icon('x', 'sm')} Deny</button>` : ''}
      ${manage ? `<button class="btn ghost icon sm" data-del="${x.id}" aria-label="Delete">${icon('trash', 'sm')}</button>` : ''}</div></td></tr>`).join('') : emptyRow(5, 'No time off recorded.', 'calendar')}
    </tbody></table></div></div>`;
  if (!manage) return;
  $('#add', el).onclick = () => modal({ title: 'Add time off', body: `
      <label class="field">Member<input id="u" placeholder="Roblox username or user ID"></label>
      <div class="grid2"><label class="field">From<input id="a" type="date" value="${t}"></label><label class="field">Until<input id="b" type="date" value="${addDays(t, 6)}"></label></div>
      <label class="field">Reason<input id="r"></label>
      <label class="check"><input type="checkbox" id="ap" checked> Approve immediately</label>`,
    actions: [{ label: 'Save', kind: 'primary', onClick: async (close, m) => { await api(G('/timeoff'), { body: { user: val(m, '#u'), startDate: val(m, '#a'), endDate: val(m, '#b'), reason: val(m, '#r'), approve: $('#ap', m).checked } }); close(); reload(); } }] });
  $$('[data-rev]', el).forEach((b) => b.onclick = () => run(b, async () => { const [id, status] = b.dataset.rev.split(':'); await api(`/api/timeoff/${id}`, { method: 'PATCH', body: { status } }); reload(); }));
  $$('[data-del]', el).forEach((b) => b.onclick = async () => { if (await confirmBox('Delete time off?', 'The member will no longer be excused for these dates.', 'Delete')) run(b, async () => { await api(`/api/timeoff/${b.dataset.del}`, { method: 'DELETE' }); reload(); }); });
};

// ---------- scheduled sessions ----------
VIEWS.sessions = async (el, _a, _b, reload) => {
  const { events } = await api(G('/events'));
  const manage = can('manage_activity');
  const toLocal = (ts) => { const d = new Date(ts * 1000 - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
  const form = (e = {}) => `
      <label class="field">Title<input id="t" value="${esc(e.title || '')}" maxlength="100"></label>
      <div class="grid2"><label class="field">Type<select id="ty">${['shift', 'training', 'interview', 'event', 'meeting'].map((x) => `<option ${x === e.type ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="field">Host<input id="h" value="${esc(e.host_name || '')}" placeholder="Roblox username"></label></div>
      <div class="grid2"><label class="field">Starts (your local time)<input id="s" type="datetime-local" value="${toLocal(e.starts_at || Math.ceil(Date.now() / 3600000) * 3600)}"></label>
      <label class="field">Length (minutes)<input id="d" type="number" min="5" value="${e.duration_min || 60}"></label></div>
      <label class="field">Notes<textarea id="n">${esc(e.notes || '')}</textarea></label>`;
  const read = (m) => ({ title: val(m, '#t'), type: val(m, '#ty'), hostName: val(m, '#h'), startsAt: Math.floor(new Date(val(m, '#s')).getTime() / 1000), durationMin: Number(val(m, '#d')), notes: val(m, '#n') });
  el.innerHTML = `${head('Sessions', 'Schedule shifts, trainings and events, claim them, and keep a register of who attended. New sessions can be announced to Discord (set the webhook in Groups).', manage ? `<button class="btn primary" id="add">${icon('plus')} Schedule session</button>` : '')}
    <div class="card"><div class="tbl-wrap"><table><thead><tr><th>Session</th><th>Host</th><th>Starts</th><th>Length</th><th>Status</th><th></th></tr></thead><tbody>
    ${events.length ? events.map((e) => `<tr><td><b>${esc(e.title)}</b> <span class="badge">${esc(e.type)}</span>${e.notes ? `<br><span class="muted">${esc(e.notes)}</span>` : ''}</td><td>${esc(e.host_name || '—')}</td><td>${fmtTime(e.starts_at)}</td><td class="num">${e.duration_min}m</td><td>${statusBadge(e.status)}</td>
      <td class="r"><div class="row" style="justify-content:flex-end"><button class="btn sm" data-reg="${e.id}">${icon('list', 'sm')} Register</button>${manage ? `${e.status === 'scheduled' ? `<button class="btn sm good" data-st="${e.id}:completed">Complete</button><button class="btn sm" data-st="${e.id}:cancelled">Cancel</button>` : ''}
      <button class="btn ghost icon sm" data-edit="${e.id}" aria-label="Edit">${icon('edit', 'sm')}</button><button class="btn ghost icon sm" data-del="${e.id}" aria-label="Delete">${icon('trash', 'sm')}</button>` : ''}</div></td></tr>`).join('') : emptyRow(6, 'No sessions scheduled.', 'clock')}
    </tbody></table></div></div>`;
  $$('[data-reg]', el).forEach((b) => b.onclick = () => registerModal(events.find((x) => x.id == b.dataset.reg), reload));
  if (!manage) return;
  $('#add', el).onclick = () => modal({ title: 'Schedule session', body: form(), actions: [{ label: 'Schedule', kind: 'primary', onClick: async (close, m) => { await api(G('/events'), { body: read(m) }); close(); reload(); } }] });
  $$('[data-edit]', el).forEach((b) => b.onclick = () => { const e = events.find((x) => x.id == b.dataset.edit); modal({ title: 'Edit session', body: form(e), actions: [{ label: 'Save', kind: 'primary', onClick: async (close, m) => { await api(`/api/events/${e.id}`, { method: 'PATCH', body: read(m) }); close(); reload(); } }] }); });
  $$('[data-st]', el).forEach((b) => b.onclick = () => run(b, async () => { const [id, status] = b.dataset.st.split(':'); await api(`/api/events/${id}`, { method: 'PATCH', body: { status } }); reload(); }));
  $$('[data-del]', el).forEach((b) => b.onclick = async () => { if (await confirmBox('Delete session?', 'This cannot be undone.', 'Delete')) run(b, async () => { await api(`/api/events/${b.dataset.del}`, { method: 'DELETE' }); reload(); }); });
};

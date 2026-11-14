// Views: live servers (dashboard → game), the in-game moderation log, and admin-system plugins.
'use strict';

const MOD_BADGE = { kick: 'warn', ban: 'bad', unban: 'good', warn: 'warn', mute: 'accent', other: '' };
const MOD_LABEL = { kick: 'Kick', ban: 'Ban', unban: 'Unban', warn: 'Warning', mute: 'Mute', other: 'Other' };
const spanText = (s) => {
  if (s === -1) return 'Permanent';
  if (!(s > 0)) return '';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.round((s % 3600) / 60);
  return d ? `${d}d${h ? ` ${h}h` : ''}` : h ? `${h}h${m ? ` ${m}m` : ''}` : `${Math.max(1, m)}m`;
};

// ---------- live servers ----------
VIEWS.servers = async (el, _a, _b, reload) => {
  const d = await api(G('/servers'));
  const manage = d.canManage;
  const tracked = new Set(group()?.trackedRanks || []);
  const shortId = (j) => j.startsWith('studio-') ? 'Studio test' : `${j.slice(0, 8)}…`;
  const serverName = (s, i) => `Server ${i + 1}`;
  const playerRow = (s, p) => `<tr>
      <td>${tracked.has(p.rank) ? `<a href="#/member/${encodeURIComponent(p.userId)}">${who(p.displayName || p.username, `@${p.username}`)}</a>` : who(p.displayName || p.username, `@${p.username}`)}</td>
      <td>${esc(p.role || '')}${p.rank ? ` <span class="muted small">(${p.rank})</span>` : ''}</td>
      <td>${p.onDuty ? `<span class="badge good">${icon('shield', 'sm')} On duty${p.dutyLabel ? ` · ${esc(p.dutyLabel)}` : ''}</span>` : ''} ${p.idle ? '<span class="badge">Idle</span>' : ''}</td>
      <td class="r">${manage ? `<button class="btn sm" data-kick="${esc(p.userId)}" data-job="${esc(s.jobId)}" data-name="${esc(p.username)}">${icon('logout', 'sm')} Kick</button>` : ''}</td></tr>`;
  const serverCard = (s, i) => `<div class="card"><div class="head server-head">${icon('server')}<h2 class="grow">${serverName(s, i)} <span class="muted small">· ${s.players.length} player${s.players.length === 1 ? '' : 's'} · up ${fmtDur(Date.now() / 1000 - s.startedAt)} · ${esc(shortId(s.jobId))}</span></h2>
      ${manage ? `<button class="btn sm" data-ann="${esc(s.jobId)}">${icon('megaphone', 'sm')} Announce here</button><button class="btn sm danger" data-shut="${esc(s.jobId)}">${icon('power', 'sm')} Shut down</button>` : ''}</div>
      <div class="tbl-wrap"><table><thead><tr><th>Player</th><th>Rank</th><th>Status</th><th></th></tr></thead><tbody>
        ${s.players.length ? s.players.map((p) => playerRow(s, p)).join('') : emptyRow(4, 'Nobody in this server right now.', 'users')}
      </tbody></table></div></div>`;

  el.innerHTML = `${head('Live servers', 'Every game server running the ActivityTracker module, updated each minute. Announcements, kicks and shutdowns reach the game within a minute.', `
      <button class="btn" id="refresh">${icon('refresh')} Refresh</button>
      ${manage ? `<button class="btn primary" id="annAll">${icon('megaphone')} Announce to every server</button>` : ''}`)}
    <div class="stats">
      ${stat('Servers', d.totals.servers, 'running now', 'server')}
      ${stat('Players', d.totals.players, 'across all servers', 'users')}
      ${stat('On duty', d.totals.onDuty, 'via the duty command', 'shield')}
    </div>
    ${d.servers.length ? d.servers.map(serverCard).join('') : `<div class="card"><div class="empty">${icon('server')}<div><b>No servers are running right now.</b><br>Servers appear here once the ActivityTracker module is started in your game${can('manage_groups') ? ' — see Groups › Roblox setup' : ''}.</div></div></div>`}
    <p class="hint">${icon('info', 'inl')} Players go on duty with the <code>duty</code> command from any of the admin plugins (Groups › Roblox setup), or from your own scripts with <code>ActivityTracker.SetOnDuty(player, true)</code>. Time on duty shows on each member’s page.</p>`;

  const announce = (jobId) => modal({ title: jobId ? 'Announce in one server' : 'Announce to every server', body: `
      <label class="field">Title<input id="t" maxlength="60" value="Announcement"></label>
      <label class="field">Message<textarea id="m" maxlength="400" placeholder="Training starts at the main base in 5 minutes."></textarea><small>Shown on everyone’s screen (or in your admin system’s banner if its plugin is installed). Roblox’s text filter is applied in the game.</small></label>
      <label class="field">Show for<select id="s"><option value="8">8 seconds</option><option value="12" selected>12 seconds</option><option value="20">20 seconds</option><option value="30">30 seconds</option></select></label>`,
    actions: [{ label: 'Send', kind: 'primary', onClick: async (close, m) => {
      await api(G('/servers/announce'), { body: { title: val(m, '#t'), message: val(m, '#m'), seconds: Number(val(m, '#s')), jobId } });
      close(); toast('Sent — it appears in game within a minute', 'good');
    } }] });

  $('#refresh', el).onclick = () => reload();
  if ($('#annAll', el)) $('#annAll', el).onclick = () => announce(null);
  el.onclick = async (e) => {
    const k = e.target.closest('[data-kick]'), a = e.target.closest('[data-ann]'), s = e.target.closest('[data-shut]');
    if (a) announce(a.dataset.ann);
    if (k) modal({ title: `Kick ${k.dataset.name}`, body: `
        <label class="field">Reason<input id="r" maxlength="300" placeholder="Shown to the player"></label>
        <div class="callout">${icon('info')}<span>The kick is recorded in the Moderation log. To keep them out, blacklist them instead.</span></div>`,
      actions: [{ label: 'Kick', kind: 'danger', onClick: async (close, m) => {
        await api(G('/servers/kick'), { body: { userId: k.dataset.kick, jobId: k.dataset.job, reason: val(m, '#r') } });
        close(); toast(`${k.dataset.name} will be kicked within a minute`, 'good');
      } }] });
    if (s) modal({ title: 'Shut down this server?', body: `
        <p>Everyone in the server is kicked, and anyone who joins it afterwards too. Other servers are not affected.</p>
        <label class="field">Message<input id="r" maxlength="200" value="This server was shut down by staff. Please rejoin."></label>`,
      actions: [{ label: 'Shut down', kind: 'danger', onClick: async (close, m) => {
        await api(G('/servers/shutdown'), { body: { jobId: s.dataset.shut, message: val(m, '#r') } });
        close(); toast('The server shuts down within a minute', 'good');
      } }] });
  };
  // Keep the page fresh while it is open.
  const timer = setInterval(() => { if (!el.isConnected || location.hash.split('/')[1] !== 'servers') clearInterval(timer); else if (!document.hidden && !document.querySelector('.overlay')) reload(); }, 30000);
};

// ---------- moderation log ----------
VIEWS.moderation = async (el) => {
  let action = '', q = '';
  el.innerHTML = `${head('Moderation', 'Kicks, bans, unbans and warnings copied from your admin system (Adonis, Basic Admin Essentials and Kohl’s Admin plugins), and kicks sent from Live servers.', `
      <button class="btn" id="csv">${icon('download')} Export CSV</button>`)}
    <div class="stats" id="counts"></div>
    <div class="card"><div class="head">${seg('ma', [['', 'All'], ['kick', 'Kicks'], ['ban', 'Bans'], ['unban', 'Unbans'], ['warn', 'Warnings']], '')}
      <div class="search right" style="width:240px">${icon('search', 'sm')}<input id="q" placeholder="Search player, moderator, reason" aria-label="Search moderation log"></div></div>
      <div class="tbl-wrap"><table><thead><tr><th>When</th><th>Action</th><th>Player</th><th>Moderator</th><th>Reason</th></tr></thead><tbody id="rows"><tr><td colspan="5"><div class="empty">${icon('clock')}<div>Loading…</div></div></td></tr></tbody></table></div></div>
    <p class="hint">${icon('info', 'inl')} Your admin system fills this log through its Roleplay System plugin (Groups › Roblox setup). Send it to Discord too with the moderation webhook in the group’s settings.</p>`;
  let data;
  const load = async () => {
    const qs = new URLSearchParams(); if (action) qs.set('action', action); if (q) qs.set('q', q);
    data = await api(G(`/moderation?${qs}`));
    const lw = data.lastWeek || {};
    $('#counts', el).innerHTML = `${stat('Kicks', lw.kick || 0, 'last 7 days', 'logout')}${stat('Bans', lw.ban || 0, `${lw.unban || 0} unbanned`, 'ban')}${stat('Warnings', lw.warn || 0, 'last 7 days', 'alert')}`;
    $('#rows', el).innerHTML = data.entries.length ? data.entries.map((e) => `<tr>
        <td class="muted small">${fmtTime(e.created_at)}</td>
        <td><span class="badge ${MOD_BADGE[e.action] || ''}">${MOD_LABEL[e.action] || esc(e.action)}</span>${e.duration ? `<br><span class="muted small">${spanText(e.duration)}</span>` : ''}</td>
        <td>${e.roblox_id ? `<a target="_blank" rel="noopener" href="https://www.roblox.com/users/${encodeURIComponent(e.roblox_id)}/profile">${who(e.username || e.roblox_id, e.roblox_id)}</a>` : who(e.username || '?')}</td>
        <td>${esc(e.moderator || '—')}${e.source ? `<br><span class="muted small">${esc(e.source)}</span>` : ''}</td>
        <td class="wrap-text">${e.reason ? esc(e.reason) : '<span class="muted">No reason</span>'}</td></tr>`).join('')
      : emptyRow(5, action || q ? 'Nothing matches.' : 'Nothing logged yet. Install an admin plugin from Groups › Roblox setup.', 'shield');
  };
  await load();
  onSeg(el, 'ma', (v) => { action = v; load(); });
  let t;
  $('#q', el).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim(); load(); }, 250); };
  $('#csv', el).onclick = () => downloadCSV(`moderation-${S.gid}.csv`, [
    ['Time (UTC)', 'Action', 'Player', 'Roblox ID', 'Duration (s)', 'Moderator', 'Moderator ID', 'Source', 'Reason'],
    ...data.entries.map((e) => [new Date(e.created_at * 1000).toISOString(), e.action, e.username || '', e.roblox_id || '', e.duration ?? '', e.moderator || '', e.moderator_id || '', e.source || '', e.reason || '']),
  ]);
};

// ---------- admin-system plugins (inside Groups › Roblox setup) ----------
function adminPluginsCard() {
  const rows = Object.entries(ADMIN_PLUGINS).map(([k, p]) => `<div class="plug">
      <div class="grow"><b>${esc(p.label)}</b>${p.mirror ? ' <span class="badge good small">Mirrors kicks &amp; bans</span>' : ''}
        <div class="muted small">Insert into <code>${esc(p.into)}</code>${p.merge ? `, then add one line (<a href="#" data-merge="${k}">copy</a>)` : ''}</div></div>
      <button class="btn sm" data-plugin="${k}">${icon('download', 'sm')} .rbxmx</button></div>`).join('');
  return `<div class="card"><div class="body stack gap-s"><h3>3 · Admin system plugins</h3>
    <p class="dim">Adds the same commands to your admin system: <code>rpinfo</code>, <code>rpwarn</code>, <code>rpstrike</code>, <code>rppromote</code>, <code>rpdemote</code>, <code>rpblacklist</code>, <code>rpcert</code>, plus <code>duty</code> and <code>onduty</code> for everyone. Staff commands act as the moderator’s <b>linked dashboard account</b>, so they need the matching permission here too. Plugins hold no API key — they use the ActivityTracker, so start it first.</p>
    <div class="plugs">${rows}</div>
    <p class="hint">In Studio, right-click the folder shown, choose <b>Insert from File…</b> and pick the download. Each module explains its settings at the top.</p></div></div>`;
}
function bindAdminPlugins(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-plugin]'), mg = e.target.closest('[data-merge]');
    if (mg) { e.preventDefault(); copyText(ADMIN_PLUGINS[mg.dataset.merge].merge); return; }
    if (!b) return;
    run(b, async () => { const f = await buildModelFile(b.dataset.plugin); downloadFile(f.name, f.xml); toast(`${ADMIN_PLUGINS[b.dataset.plugin].label} plugin downloaded`, 'good'); });
  });
}

// ---------- downloads: everything in one place ----------
VIEWS.downloads = async (el) => {
  const g = group();
  const keys = can('manage_api_keys');
  const slug = (s) => String(s || '').replace(/[^\w-]+/g, '_');
  const row = (title, sub, actions) => `<div class="plug"><div class="grow"><b>${title}</b><div class="muted small">${sub}</div></div><div class="row wrap gap-s">${actions}</div></div>`;
  const need = (what) => `<span class="badge small" title="Ask the owner for this permission">Needs ${esc(what)}</span>`;
  const dl = (id, label) => `<button class="btn sm" data-dl="${id}">${icon('download', 'sm')} ${label}</button>`;
  const src = (file) => `<a class="btn sm ghost" href="roblox/${file}" target="_blank" rel="noopener">${icon('external', 'sm')} Source</a>`;

  const game = `<div class="card"><div class="head">${icon('roblox')}<h2 class="grow">Roblox game${g ? ` <span class="muted small">· ${esc(g.name)}</span>` : ''}</h2></div><div class="body stack gap-s">
      <p class="dim">Put the activity module in <code>ServerScriptService</code> and start it with the loader script. It tracks playtime and duty, kicks blacklisted players and powers Live servers. Turn on <b>Game Settings ${icon('arrowR', 'inl')} Security ${icon('arrowR', 'inl')} Allow HTTP Requests</b> in every place.</p>
      <div class="plugs">
        ${row('Module + loader (easiest)', g ? 'The module and a <code>RoleplaySystemLoader</code> Script with a new API key for this group, in one file. Insert into <code>ServerScriptService</code> and publish.' : 'Open a group — the key belongs to a group.', g ? (keys ? dl('bundle', 'ActivityTracker-with-loader.rbxmx') : need('API keys')) : '')}
        ${row('Module only', 'A ModuleScript named <code>ActivityTracker</code> (.rbxmx). Holds no key. In Studio, right-click <code>ServerScriptService</code> › <b>Insert from File…</b>', `${src('ActivityTracker.lua')}${dl('module', 'ActivityTracker.rbxmx')}`)}
        ${row('Loader script', g ? 'A Script that starts the module with a new API key for this group. Copied to your clipboard.' : 'Open a group to create one — the key belongs to a group.', g ? (keys ? `<button class="btn sm" data-dl="loader">${icon('copy', 'sm')} Copy with new key</button>` : need('API keys')) : '')}
        ${row('Application center', g ? 'A ready-to-publish place (.rbxlx) that loads this group’s open applications. Creates a new API key.' : 'Open a group to download its application center.', g ? (keys ? dl('appcenter', 'ApplicationCenter.rbxlx') : need('API keys')) : '')}
        ${isOwner() ? row('Verification game', 'One place for the whole system (.rbxlx) with a key that can only verify. Then paste its link on the Verification game page.', `<a class="btn sm ghost" href="#/go/owner/verification">${icon('arrowR', 'sm')} Set link</a>${dl('verify', 'VerificationGame.rbxlx')}`) : ''}
      </div></div></div>`;

  const plugins = `<div class="card"><div class="head">${icon('puzzle')}<h2 class="grow">Admin system plugins</h2></div><div class="body stack gap-s">
      <p class="dim">Adds <code>rpinfo</code>, <code>rpwarn</code>, <code>rpstrike</code>, <code>rppromote</code>, <code>rpdemote</code>, <code>rpblacklist</code>, <code>rpcert</code>, <code>duty</code> and <code>onduty</code> to the admin system you use. They need the activity module running and hold no key. Staff commands act as the moderator’s linked dashboard account. In Studio, right-click the folder shown, choose <b>Insert from File…</b> and pick the download.</p>
      <div class="plugs">${Object.entries(ADMIN_PLUGINS).map(([k, p]) => row(`${esc(p.label)}${p.mirror ? ' <span class="badge good small">Mirrors kicks &amp; bans</span>' : ''}`,
        `Insert into <code>${esc(p.into)}</code>${p.merge ? `, then add one line (<a href="#" data-merge="${k}">copy</a>)` : ''}`,
        `<button class="btn sm" data-plugin="${k}">${icon('download', 'sm')} .rbxmx</button>`)).join('')}</div></div></div>`;

  const exp = (id, label, sub, ok = true, perm = '') => row(label, sub, ok ? `<button class="btn sm" data-csv="${id}">${icon('download', 'sm')} CSV</button>` : need(perm));
  const exportsCard = g ? `<div class="card"><div class="head">${icon('list')}<h2 class="grow">Data exports <span class="muted small">· ${esc(g.name)}</span></h2></div><div class="body stack gap-s">
      <div class="plugs">
        ${row('Activity', 'Hours, idle time, sessions and messages per member.', `<select id="actRange" aria-label="Activity range"><option value="week">This week</option><option value="30">Last 30 days</option><option value="all">All time</option></select><button class="btn sm" data-csv="activity">${icon('download', 'sm')} CSV</button>`)}
        ${exp('roster', 'Roster', 'Members with callsign, departments and certifications.')}
        ${exp('logbook', 'Logbook', 'Warnings, strikes, suspensions, promotions and more (latest 300).')}
        ${exp('blacklist', 'Blacklist', 'Every entry, including removed and expired ones.')}
        ${exp('moderation', 'Moderation log', 'Kicks, bans and warnings from your admin system (latest 300).', can('manage_discipline') || can('view_logs') || can('manage_servers'), 'discipline or logs')}
      </div>
      ${can('view_logs') ? '<p class="hint">The full log export (up to 5,000 rows, with filters) is on the <a href="#/logs">Logs</a> page.</p>' : ''}</div></div>`
    : `<div class="card"><div class="empty">${icon('list')}<div>Open a group to export its activity, roster, logbook, blacklist and moderation log.</div></div></div>`;

  el.innerHTML = `${head('Downloads', 'Everything you can download: the Roblox module and places, admin system plugins, and your data as CSV.')}
    ${game}${plugins}${exportsCard}`;
  bindAdminPlugins(el);

  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const day = (ts) => (ts ? new Date(ts * 1000).toISOString().slice(0, 10) : '');
  const name = slug(g?.name);
  const CSV = {
    activity: async () => {
      const r = val(el, '#actRange');
      const qs = r === 'all' ? `?from=2000-01-01&to=${today}` : r === '30' ? `?from=${daysAgo(29)}&to=${today}` : '';
      const d = await api(G(`/activity${qs}`));
      downloadCSV(`activity-${name}-${d.from === '2000-01-01' ? 'all' : d.from}-to-${d.to}.csv`, [
        ['Roblox ID', 'Username', 'Display name', 'Rank', 'Role', 'Hours played', 'Idle hours', 'Sessions', 'Messages', 'Tracked'],
        ...d.leaderboard.map((m) => [m.robloxId, m.username, m.displayName || '', m.rank ?? '', m.roleName || '', (m.seconds / 3600).toFixed(2), ((m.idleSeconds || 0) / 3600).toFixed(2), m.sessions, m.messages, m.tracked ? 'yes' : 'no'])]);
    },
    roster: async () => {
      const d = await api(G('/roster'));
      const dep = new Map(d.departments.map((x) => [x.id, x.name])), cert = new Map(d.certTypes.map((x) => [x.id, x.name]));
      downloadCSV(`roster-${name}.csv`, [['Roblox ID', 'Username', 'Rank', 'Role', 'Callsign', 'Departments', 'Certifications'],
        ...d.members.map((m) => [m.robloxId, m.username, m.rank ?? '', m.roleName, m.callsign, m.departments.map((x) => dep.get(x) || x).join('; '),
          (m.certifications || []).map((x) => cert.get(typeof x === 'object' ? x.certId : x) || '').filter(Boolean).join('; ')])]);
    },
    logbook: async () => {
      const d = await api(G('/logbook'));
      downloadCSV(`logbook-${name}.csv`, [['Created (UTC)', 'Roblox ID', 'Username', 'Type', 'Reason', 'Evidence', 'By', 'Expires (UTC)', 'Status'],
        ...d.entries.map((e) => [day(e.created_at), e.roblox_id, e.username || '', e.type, e.reason, e.evidence || '', e.author || '', day(e.expires_at), e.revoked_at ? 'revoked' : e.active ? 'active' : 'expired'])]);
    },
    blacklist: async () => {
      const d = await api(G('/blacklist'));
      downloadCSV(`blacklist-${name}.csv`, [['Roblox ID', 'Username', 'Reason', 'Evidence', 'Added by', 'Added (UTC)', 'Expires (UTC)', 'Status'],
        ...d.entries.map((e) => [e.roblox_id, e.username || '', e.reason, e.evidence || '', e.author || '', day(e.created_at), e.expires_at ? day(e.expires_at) : 'never', e.removed_at ? 'removed' : e.active ? 'active' : 'expired'])]);
    },
    moderation: async () => {
      const d = await api(G('/moderation'));
      downloadCSV(`moderation-${name}.csv`, [['Time (UTC)', 'Action', 'Player', 'Roblox ID', 'Duration (s)', 'Moderator', 'Moderator ID', 'Source', 'Reason'],
        ...d.entries.map((e) => [new Date(e.created_at * 1000).toISOString(), e.action, e.username || '', e.roblox_id || '', e.duration ?? '', e.moderator || '', e.moderator_id || '', e.source || '', e.reason || ''])]);
    },
  };

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dl], [data-csv]'); if (!b) return;
    run(b, async () => {
      if (b.dataset.csv) return CSV[b.dataset.csv]();
      const d = b.dataset.dl;
      if (d === 'module') { const f = await buildTrackerModel(); return downloadFile(f.name, f.xml); }
      if (d === 'verify') {
        const { key } = await api('/api/keys', { body: { name: 'Verification game — system', scopes: ['verify'] } });
        downloadFile('VerificationGame.rbxlx', await buildPlaceFile('verify', { apiUrl: ROBLOX_API_URL, apiKey: key, title: NAME }));
        return toast('Downloaded — publish it, then paste its link on the Verification game page', 'good');
      }
      const key = await createGameKey(d === 'appcenter' ? 'Application center' : 'Activity tracker', g.id);
      if (d === 'bundle') { const f = await buildTrackerModel({ apiUrl: ROBLOX_API_URL, apiKey: key }); downloadFile(f.name, f.xml); return toast('Downloaded — insert it into ServerScriptService', 'good'); }
      if (d === 'loader') return copyText(`-- Script in ServerScriptService (next to the ActivityTracker ModuleScript)\nlocal ActivityTracker = require(script.Parent:WaitForChild("ActivityTracker"))\n\nActivityTracker.Start({\n\tApiUrl = "${ROBLOX_API_URL}",\n\tApiKey = "${key}",\n})\n`);
      downloadFile(`ApplicationCenter-${g.id}.rbxlx`, await buildPlaceFile('appcenter', { apiUrl: ROBLOX_API_URL, apiKey: key, title: g.name }));
      return toast('Place file generated', 'good');
    });
  });
};

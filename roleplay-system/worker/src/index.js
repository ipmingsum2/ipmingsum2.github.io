// Roleplay system API — Cloudflare Worker entry point and router.
//
//   /auth/*      OAuth sign-in (Google, Discord)
//   /api/*       dashboard API (session token; whitelist only)
//   /public/*    public pages: apply + verify (no dashboard access)
//   /v1/*        public API (API keys) and the Roblox game endpoints
import { CORS, HttpError, bad, json, now, parseJSON, str, int, readBody, encrypt, cleanWebhook, sendWebhook, logEvent, dayStr, weekStartOf } from './util.js';
import * as auth from './auth.js';
import * as rbx from './roblox.js';
import * as act from './activity.js';
import * as apps from './apps.js';
import * as feat from './features.js';
import * as more from './more.js';
import * as access from './access.js';

const routes = [];
/**
 * opts.auth: 'user' (dashboard session) | 'key' (API key) | 'none'
 * opts.perm / opts.anyPerm / opts.owner: dashboard permission checks
 * opts.scope: required API key scope
 * A `:gid` path parameter always loads the group into c.group (404 if missing).
 */
function R(method, path, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, opts: { auth: path.startsWith('/api/') ? 'user' : path.startsWith('/v1/') ? 'key' : 'none', ...opts } });
}

// ---------- groups ----------
function groupView(g, user) {
  const settings = parseJSON(g.settings, {});
  const manage = !user || auth.can(user, 'manage_groups') || auth.can(user, 'manage_activity');
  if (!manage) { // webhook URLs are credentials — hide them from view-only users
    settings.logWebhook = settings.logWebhook ? '(hidden)' : '';
    if (settings.requirements) settings.requirements.webhookUrl = settings.requirements.webhookUrl ? '(hidden)' : '';
    if (settings.events) settings.events.webhookUrl = settings.events.webhookUrl ? '(hidden)' : '';
    if (settings.news) settings.news.webhookUrl = settings.news.webhookUrl ? '(hidden)' : '';
  }
  return { id: g.id, name: g.name, hasApiKey: !!g.api_key_enc, roles: parseJSON(g.roles, []), trackedRanks: parseJSON(g.tracked_ranks, []), settings, createdAt: g.created_at };
}

async function listGroups(c) {
  const rows = (await c.env.DB.prepare('SELECT * FROM groups ORDER BY created_at').all()).results;
  return json({ groups: rows.map((g) => groupView(g, c.user)) });
}

async function createGroup(c) {
  const b = await readBody(c.req);
  const id = str(b.id, 20);
  if (!/^\d{1,15}$/.test(id)) bad('Group ID must be the numeric Roblox group ID');
  if (await c.env.DB.prepare('SELECT 1 FROM groups WHERE id=?').bind(id).first()) bad('That group has already been added', 409);
  const key = str(b.apiKey, 2000);
  let name = str(b.name, 80) || `Group ${id}`;
  let roles = [];
  if (key) { // validates the key against Roblox before saving anything
    name = (await rbx.fetchGroupInfo(key, id)).name;
    roles = await rbx.fetchRoles(key, id);
  }
  await c.env.DB.prepare('INSERT INTO groups (id, name, api_key_enc, roles, tracked_ranks, settings, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(id, name, key ? await encrypt(c.env, key) : null, JSON.stringify(roles), '[]', '{}', now()).run();
  await logEvent(c.env, c.ctx, { groupId: id, type: 'group.added', actor: c.actor, summary: `${c.actor.name} added group ${name} (${id})` });
  return json({ id, name });
}

function cleanRequirements(r = {}, prev = {}) {
  const mins = (v) => int(v, 0, 10080);
  const overrides = {};
  for (const [rank, o] of Object.entries(r.rankOverrides || {})) {
    if (!/^\d{1,3}$/.test(rank) || !o) continue;
    const e = {};
    if (o.dailyMinutes !== '' && o.dailyMinutes != null) e.dailyMinutes = mins(o.dailyMinutes);
    if (o.weeklyMinutes !== '' && o.weeklyMinutes != null) e.weeklyMinutes = mins(o.weeklyMinutes);
    if (o.weeklySessions !== '' && o.weeklySessions != null) e.weeklySessions = int(o.weeklySessions, 0, 100);
    if (Object.keys(e).length) overrides[rank] = e;
  }
  const hook = r.webhookUrl === '(hidden)' ? prev.webhookUrl || '' : cleanWebhook(r.webhookUrl);
  const role = str(r.mentionRoleId, 25);
  if (role && !/^\d{15,21}$/.test(role)) bad('Role to mention must be a numeric Discord role ID');
  return {
    enabled: !!r.enabled, dailyMinutes: mins(r.dailyMinutes), weeklyMinutes: mins(r.weeklyMinutes), weeklySessions: int(r.weeklySessions, 0, 100), countIdle: r.countIdle !== false,
    checkHour: int(r.checkHour, 0, 23, 0), webhookUrl: hook, mentionRoleId: role, pingMembers: !!r.pingMembers, notifyAllMet: !!r.notifyAllMet,
    headerTemplate: str(r.headerTemplate, 400), lineTemplate: str(r.lineTemplate, 300), rankOverrides: overrides,
  };
}

async function updateGroup(c) {
  const g = c.group;
  const b = await readBody(c.req);
  const admin = auth.can(c.user, 'manage_groups');
  const settings = parseJSON(g.settings, {});
  const changed = [];
  const sets = [], vals = [];

  if (b.requirements !== undefined) {
    if (!admin && !auth.can(c.user, 'manage_activity')) bad('You do not have permission to edit requirements', 403);
    settings.requirements = cleanRequirements(b.requirements, settings.requirements);
    changed.push('requirements');
  }
  const adminOnly = ['name', 'apiKey', 'trackedRanks', 'logWebhook', 'ranking', 'events', 'news'].filter((k) => b[k] !== undefined);
  if (adminOnly.length && !admin) bad('You do not have permission to edit group settings', 403);

  if (b.name !== undefined) { const n = str(b.name, 80); if (!n) bad('Name cannot be empty'); sets.push('name=?'); vals.push(n); changed.push('name'); }
  if (b.apiKey !== undefined) {
    const key = str(b.apiKey, 2000);
    if (key) {
      const roles = await rbx.fetchRoles(key, g.id); // rejects a bad key before it is stored
      sets.push('api_key_enc=?', 'roles=?'); vals.push(await encrypt(c.env, key), JSON.stringify(roles));
    } else { sets.push('api_key_enc=?'); vals.push(null); }
    changed.push('Open Cloud API key');
  }
  if (b.trackedRanks !== undefined) {
    if (!Array.isArray(b.trackedRanks)) bad('trackedRanks must be an array of rank numbers');
    const ranks = [...new Set(b.trackedRanks.map((r) => int(r, 1, 255, -1)).filter((r) => r > 0))].sort((x, y) => x - y);
    sets.push('tracked_ranks=?'); vals.push(JSON.stringify(ranks)); changed.push(`tracked ranks (${ranks.join(', ') || 'none'})`);
  }
  if (b.logWebhook !== undefined) { settings.logWebhook = cleanWebhook(b.logWebhook); changed.push('log webhook'); }
  if (b.ranking !== undefined) { settings.ranking = { maxRank: int(b.ranking?.maxRank, 1, 254, 254) }; changed.push(`max assignable rank (${settings.ranking.maxRank})`); }
  if (b.events !== undefined) { settings.events = { webhookUrl: cleanWebhook(b.events?.webhookUrl) }; changed.push('session announcements webhook'); }
  if (b.news !== undefined) { settings.news = feat.cleanNewsSettings(b.news); changed.push('news webhook'); }
  if (!changed.length) bad('Nothing to update');

  sets.push('settings=?'); vals.push(JSON.stringify(settings));
  await c.env.DB.prepare(`UPDATE groups SET ${sets.join(', ')} WHERE id=?`).bind(...vals, g.id).run();
  await logEvent(c.env, c.ctx, { groupId: g.id, type: 'group.updated', actor: c.actor, summary: `${c.actor.name} updated ${g.name}: ${changed.join(', ')}` });
  const fresh = await c.env.DB.prepare('SELECT * FROM groups WHERE id=?').bind(g.id).first();
  return json({ group: groupView(fresh, c.user) });
}

async function deleteGroup(c) {
  const { DB } = c.env;
  const id = c.group.id;
  await DB.batch([
    ...['members', 'play_sessions', 'activity_daily', 'time_off', 'requirement_runs', 'requirement_results', 'applications', 'submissions', 'events', 'notes', 'logbook', 'event_people', 'recommendations', 'kb_docs', 'posts', 'blacklist']
      .map((t) => DB.prepare(`DELETE FROM ${t} WHERE group_id=?`).bind(id)),
    DB.prepare('DELETE FROM rec_votes WHERE rec_id NOT IN (SELECT id FROM recommendations)'),
    DB.prepare('UPDATE api_keys SET revoked=1 WHERE group_id=?').bind(id),
    DB.prepare('DELETE FROM groups WHERE id=?').bind(id),
  ]);
  await logEvent(c.env, c.ctx, { type: 'group.removed', actor: c.actor, summary: `${c.actor.name} removed group ${c.group.name} (${id}) and all of its data` });
  return json({ ok: true });
}

async function syncRoles(c) {
  const roles = await rbx.refreshRoles(c.env, c.group);
  await logEvent(c.env, c.ctx, { groupId: c.group.id, type: 'group.roles_synced', actor: c.actor, summary: `${c.actor.name} refreshed roles for ${c.group.name} (${roles.length} roles)` });
  return json({ roles });
}

async function syncMembersRoute(c) {
  const out = await rbx.syncMembers(c.env, c.group);
  await logEvent(c.env, c.ctx, { groupId: c.group.id, type: 'group.members_synced', actor: c.actor, summary: `${c.actor.name} synced members for ${c.group.name}: ${out.synced} in tracked ranks${out.truncated ? ' (list truncated)' : ''}` });
  return json(out);
}

async function overview(c) {
  const { DB } = c.env;
  const gid = c.group.id;
  const today = dayStr();
  const wk = weekStartOf(today);
  const tracked = parseJSON(c.group.tracked_ranks, []);
  const [d, w, live, off, subs, mem, logs, ev] = await DB.batch([
    DB.prepare('SELECT COALESCE(SUM(seconds),0) s, COUNT(*) u FROM activity_daily WHERE group_id=? AND day=? AND seconds>0').bind(gid, today),
    DB.prepare('SELECT COALESCE(SUM(seconds),0) s, COUNT(DISTINCT roblox_id) u FROM activity_daily WHERE group_id=? AND day>=? AND seconds>0').bind(gid, wk),
    DB.prepare('SELECT COUNT(DISTINCT roblox_id) n FROM play_sessions WHERE group_id=? AND ended=0 AND last_ts>?').bind(gid, now() - 180),
    DB.prepare("SELECT COUNT(*) n FROM time_off WHERE group_id=? AND status='pending'").bind(gid),
    DB.prepare("SELECT COUNT(*) n FROM submissions WHERE group_id=? AND status='pending'").bind(gid),
    DB.prepare('SELECT rank FROM members WHERE group_id=?').bind(gid),
    DB.prepare('SELECT id, ts, type, actor_name, summary FROM logs WHERE group_id=? ORDER BY id DESC LIMIT 8').bind(gid),
    DB.prepare("SELECT * FROM events WHERE group_id=? AND status='scheduled' AND starts_at>? ORDER BY starts_at LIMIT 5").bind(gid, now() - 3600),
  ]);
  const [weekly, leaders, news, recs] = await Promise.all([
    act.requirementStatus(c.env, c.group, 'weekly', wk),
    feat.leaderboard(c.env, c.group),
    DB.prepare('SELECT id, title, body, pinned, author, created_at FROM posts WHERE group_id=? ORDER BY pinned DESC, id DESC LIMIT 3').bind(gid).all(),
    DB.prepare("SELECT COUNT(*) n FROM recommendations WHERE group_id=? AND status='open'").bind(gid).first(),
  ]);
  const due = weekly.members.filter((m) => (m.required > 0 || m.requiredSessions > 0) && !m.exempt);
  return json({
    today: { seconds: d.results[0].s, members: d.results[0].u }, week: { seconds: w.results[0].s, members: w.results[0].u },
    online: live.results[0].n, pendingTimeOff: off.results[0].n, pendingApplications: subs.results[0].n,
    trackedMembers: mem.results.filter((m) => tracked.includes(m.rank)).length,
    requirements: { due: due.length, met: due.filter((m) => m.met).length },
    recentLogs: auth.can(c.user, 'view_logs') ? logs.results : [], upcoming: ev.results,
    leaders, news: news.results, openRecommendations: recs.n,
  });
}

// ---------- logs ----------
async function logsList(c, forcedGroup = null) {
  const where = [], vals = [];
  const gid = forcedGroup || str(c.q.get('group'), 20);
  if (gid) { where.push('group_id=?'); vals.push(gid); }
  const type = str(c.q.get('type'), 40).replace(/[^a-z_.]/g, '');
  if (type) { where.push('type LIKE ?'); vals.push(`${type}%`); }
  const q = str(c.q.get('q'), 60);
  if (q) { where.push('(summary LIKE ? OR target_name LIKE ? OR actor_name LIKE ? OR target_id=?)'); vals.push(`%${q}%`, `%${q}%`, `%${q}%`, q); }
  const before = int(c.q.get('before'), 0, Number.MAX_SAFE_INTEGER);
  if (before) { where.push('id<?'); vals.push(before); }
  const limit = int(c.q.get('limit'), 1, 200, 50);
  const rows = (await c.env.DB.prepare(`SELECT * FROM logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).bind(...vals, limit).all()).results;
  return json({ logs: rows.map((l) => ({ ...l, details: parseJSON(l.details, null) })), next: rows.length === limit ? rows[rows.length - 1].id : null });
}

// ---------- scheduled sessions ----------
async function listEvents(c) {
  const rows = (await c.env.DB.prepare('SELECT * FROM events WHERE group_id=? ORDER BY starts_at DESC LIMIT 200').bind(c.group.id).all()).results;
  return json({ events: rows });
}
function eventFields(b) {
  const title = str(b.title, 100);
  if (!title) bad('Title is required');
  const startsAt = int(b.startsAt, 1, 4102444800);
  if (!startsAt) bad('Start time is required');
  return { title, type: str(b.type, 30) || 'shift', host: str(b.hostName, 40), startsAt, duration: int(b.durationMin, 5, 1440, 60), notes: str(b.notes, 1000) };
}
async function createEvent(c) {
  const f = eventFields(await readBody(c.req));
  await c.env.DB.prepare('INSERT INTO events (group_id, title, type, host_name, starts_at, duration_min, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(c.group.id, f.title, f.type, f.host, f.startsAt, f.duration, f.notes, c.actor.name, now()).run();
  await logEvent(c.env, c.ctx, { groupId: c.group.id, type: 'session.scheduled', actor: c.actor, summary: `${c.actor.name} scheduled ${f.type} "${f.title}" for ${new Date(f.startsAt * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC` });
  const hook = parseJSON(c.group.settings, {}).events?.webhookUrl;
  if (hook) c.ctx.waitUntil(sendWebhook(hook, { embeds: [{ title: `${f.type[0].toUpperCase() + f.type.slice(1)}: ${f.title}`, color: 0x5b8def,
    description: `Starts <t:${f.startsAt}:F> (<t:${f.startsAt}:R>) · ${f.duration} min${f.host ? `\nHost: **${f.host}**` : ''}${f.notes ? `\n\n${f.notes}` : ''}` }] }));
  return json({ ok: true });
}
async function updateEvent(c) {
  const e = await c.env.DB.prepare('SELECT * FROM events WHERE id=?').bind(Number(c.params.id)).first();
  if (!e) bad('Session not found', 404);
  const b = await readBody(c.req);
  if (b.status !== undefined && Object.keys(b).length === 1) {
    if (!['scheduled', 'completed', 'cancelled'].includes(b.status)) bad('Invalid status');
    await c.env.DB.prepare('UPDATE events SET status=? WHERE id=?').bind(b.status, e.id).run();
    await logEvent(c.env, c.ctx, { groupId: e.group_id, type: `session.${b.status}`, actor: c.actor, summary: `${c.actor.name} marked session "${e.title}" as ${b.status}` });
  } else {
    const f = eventFields(b);
    await c.env.DB.prepare('UPDATE events SET title=?, type=?, host_name=?, starts_at=?, duration_min=?, notes=? WHERE id=?').bind(f.title, f.type, f.host, f.startsAt, f.duration, f.notes, e.id).run();
    await logEvent(c.env, c.ctx, { groupId: e.group_id, type: 'session.updated', actor: c.actor, summary: `${c.actor.name} edited session "${f.title}"` });
  }
  return json({ ok: true });
}
async function deleteEvent(c) {
  const e = await c.env.DB.prepare('SELECT * FROM events WHERE id=?').bind(Number(c.params.id)).first();
  if (!e) bad('Session not found', 404);
  await c.env.DB.prepare('DELETE FROM events WHERE id=?').bind(e.id).run();
  await logEvent(c.env, c.ctx, { groupId: e.group_id, type: 'session.deleted', actor: c.actor, summary: `${c.actor.name} deleted session "${e.title}"` });
  return json({ ok: true });
}

// ---------- ranking ----------
async function rank(c) {
  const b = await readBody(c.req);
  return json(await rbx.changeRank(c.env, c.ctx, c.group, { user: b.user ?? b.userId ?? b.username, action: str(b.action, 10), rank: b.rank, reason: b.reason }, c.actor));
}

// =====================================================================
// Routes
// =====================================================================
const A = 'manage_activity', G = 'manage_groups';

// --- auth ---
R('GET', '/auth/:provider/start', auth.authStart);
R('GET', '/auth/:provider/callback', auth.authCallback);
R('POST', '/auth/dev', auth.devLogin);
R('GET', '/api/me', auth.me);
R('POST', '/api/auth/logout', auth.logout);
R('POST', '/api/auth/link', auth.linkStart);
R('POST', '/api/auth/unlink', auth.unlink);
R('POST', '/api/me/verify-code', auth.myVerifyCode);

// --- access (owner only) ---
R('GET', '/api/users', auth.listUsers, { owner: true });
R('POST', '/api/users', auth.createUser, { owner: true });
R('PATCH', '/api/users/:id', auth.updateUser, { owner: true });
R('DELETE', '/api/users/:id', auth.deleteUser, { owner: true });
R('PUT', '/api/verify-game', auth.verifyGameSave, { owner: true });
R('GET', '/api/access-form', access.formGet, { owner: true });
R('PUT', '/api/access-form', access.formSave, { owner: true });
R('GET', '/api/access-requests', access.list, { owner: true });
R('GET', '/api/access-requests/:id', access.get, { owner: true });
R('PATCH', '/api/access-requests/:id', access.decide, { owner: true });

// --- groups ---
R('GET', '/api/groups', listGroups);
R('POST', '/api/groups', createGroup, { perm: G });
R('PATCH', '/api/groups/:gid', updateGroup, { anyPerm: [G, A] });
R('DELETE', '/api/groups/:gid', deleteGroup, { perm: G });
R('POST', '/api/groups/:gid/sync-roles', syncRoles, { perm: G });
R('POST', '/api/groups/:gid/sync-members', syncMembersRoute, { anyPerm: [G, A] });
R('GET', '/api/groups/:gid/overview', overview);

// --- activity ---
R('GET', '/api/groups/:gid/activity', act.activity);
R('POST', '/api/groups/:gid/activity/adjust', act.adjust, { perm: A });
R('GET', '/api/groups/:gid/members', act.memberList);
R('GET', '/api/groups/:gid/members/:rid', act.memberProfile);
R('POST', '/api/groups/:gid/members/:rid/notes', act.addNote, { perm: A });
R('DELETE', '/api/notes/:id', act.deleteNote, { perm: A });
R('GET', '/api/groups/:gid/requirements', act.requirementsGet);
R('POST', '/api/groups/:gid/requirements/run', act.requirementsRun, { perm: A });
R('GET', '/api/groups/:gid/timeoff', act.listTimeOff);
R('POST', '/api/groups/:gid/timeoff', (c) => act.createTimeOff(c, true), { perm: A });
R('PATCH', '/api/timeoff/:id', act.reviewTimeOff, { perm: A });
R('DELETE', '/api/timeoff/:id', act.deleteTimeOff, { perm: A });

// --- ranking / sessions ---
R('POST', '/api/groups/:gid/ranking', rank, { perm: 'ranking' });
R('GET', '/api/groups/:gid/events', listEvents);
R('POST', '/api/groups/:gid/events', createEvent, { perm: A });
R('PATCH', '/api/events/:id', updateEvent, { perm: A });
R('DELETE', '/api/events/:id', deleteEvent, { perm: A });

// --- logbook, session registers, recommendations, knowledgebase, news ---
const DISC = 'manage_discipline', CONTENT = 'manage_content';
R('GET', '/api/groups/:gid/logbook', feat.logbookList);
R('POST', '/api/groups/:gid/logbook', feat.logbookCreate, { perm: DISC });
R('POST', '/api/logbook/:id/revoke', feat.logbookRevoke, { perm: DISC });
R('GET', '/api/events/:id/people', feat.eventPeople);
R('POST', '/api/events/:id/people', feat.eventAddPerson, { perm: A });
R('DELETE', '/api/events/:id/people/:rid', feat.eventRemovePerson, { perm: A });
R('POST', '/api/events/:id/claim', feat.eventClaim);
R('DELETE', '/api/events/:id/claim', feat.eventUnclaim);
R('GET', '/api/groups/:gid/recommendations', feat.recList);
R('POST', '/api/groups/:gid/recommendations', feat.recCreate);
R('POST', '/api/recommendations/:id/vote', feat.recVote);
R('DELETE', '/api/recommendations/:id/vote', feat.recUnvote);
R('PATCH', '/api/recommendations/:id', feat.recDecide, { perm: 'ranking' });
R('GET', '/api/groups/:gid/kb', feat.kbList);
R('POST', '/api/groups/:gid/kb', feat.kbCreate, { perm: CONTENT });
R('GET', '/api/kb/:id', feat.kbGet);
R('PATCH', '/api/kb/:id', feat.kbUpdate, { perm: CONTENT });
R('DELETE', '/api/kb/:id', feat.kbDelete, { perm: CONTENT });
R('GET', '/api/groups/:gid/news', feat.newsList);
R('POST', '/api/groups/:gid/news', feat.newsCreate, { perm: CONTENT });
R('PATCH', '/api/news/:id', feat.newsUpdate, { perm: CONTENT });
R('DELETE', '/api/news/:id', feat.newsDelete, { perm: CONTENT });

// --- blacklist, auto-promotion ---
R('GET', '/api/groups/:gid/blacklist', more.blacklistList);
R('POST', '/api/groups/:gid/blacklist', more.blacklistAdd, { perm: DISC });
R('POST', '/api/blacklist/:id/remove', more.blacklistRemove, { perm: DISC });
R('GET', '/api/groups/:gid/autopromote', more.autoPromoteGet);
R('PUT', '/api/groups/:gid/autopromote', more.autoPromoteSave, { perm: 'ranking' });
R('POST', '/api/groups/:gid/autopromote/run', more.autoPromoteRun, { perm: 'ranking' });

// --- applications ---
const APP = ['manage_applications', 'review_applications'];
R('GET', '/api/groups/:gid/applications', apps.listApps, { anyPerm: APP });
R('POST', '/api/groups/:gid/applications', apps.createApp, { perm: 'manage_applications' });
R('GET', '/api/applications/:id', apps.getApp, { anyPerm: APP });
R('PATCH', '/api/applications/:id', apps.updateApp, { perm: 'manage_applications' });
R('DELETE', '/api/applications/:id', apps.deleteApp, { perm: 'manage_applications' });
R('GET', '/api/applications/:id/submissions', apps.listSubmissions, { anyPerm: APP });
R('GET', '/api/submissions/:id', apps.getSubmission, { anyPerm: APP });
R('PATCH', '/api/submissions/:id', apps.reviewSubmission, { perm: 'review_applications' });

// --- logs, keys, links ---
R('GET', '/api/logs', (c) => logsList(c), { perm: 'view_logs' });
R('GET', '/api/keys', auth.listKeys, { perm: 'manage_api_keys' });
R('POST', '/api/keys', auth.createKey, { perm: 'manage_api_keys' });
R('DELETE', '/api/keys/:id', auth.revokeKey, { perm: 'manage_api_keys' });
R('GET', '/api/links', auth.listLinks);
R('DELETE', '/api/links/:id', auth.deleteLink, { perm: G });

// --- public pages ---
R('GET', '/public/access-request', access.publicGet);
R('POST', '/public/access-request', access.publicSubmit);
R('GET', '/public/verify-game', auth.verifyGameGet);
R('GET', '/public/link', auth.publicLink);
R('POST', '/public/verify-code', auth.publicVerifyCode);
R('GET', '/public/applications/:id', apps.publicGet);
R('POST', '/public/applications/:id/submit', apps.publicSubmit);

// --- public API (API keys) ---
R('GET', '/v1/groups/:gid', (c) => { const g = groupView(c.group); return json({ id: g.id, name: g.name, roles: g.roles, trackedRanks: g.trackedRanks }); }, { scope: 'read' });
R('GET', '/v1/groups/:gid/activity', act.activity, { scope: 'read' });
R('GET', '/v1/groups/:gid/members', act.memberList, { scope: 'read' });
R('GET', '/v1/groups/:gid/members/:rid', act.memberProfile, { scope: 'read' });
R('GET', '/v1/groups/:gid/requirements', act.requirementsGet, { scope: 'read' });
R('GET', '/v1/groups/:gid/logs', (c) => logsList(c, c.group.id), { scope: 'read' });
R('GET', '/v1/groups/:gid/timeoff', act.listTimeOff, { scope: 'read' });
R('GET', '/v1/groups/:gid/logbook', feat.logbookList, { scope: 'read' });
R('GET', '/v1/groups/:gid/news', feat.newsList, { scope: 'read' });
R('GET', '/v1/groups/:gid/blacklist', more.blacklistPublic, { scope: 'read' });
R('GET', '/v1/groups/:gid/blacklist/:rid', more.blacklistCheck, { scope: 'read' });
R('POST', '/v1/groups/:gid/timeoff', (c) => act.createTimeOff(c, false), { scope: 'timeoff' });
R('POST', '/v1/groups/:gid/ranking', rank, { scope: 'ranking' });
R('GET', '/v1/links/discord/:id', (c) => auth.linkLookup(c, 'discord_id'), { scope: 'read' });
R('GET', '/v1/links/roblox/:id', (c) => auth.linkLookup(c, 'roblox_id'), { scope: 'read' });

// --- Roblox game endpoints (key with the "game" scope, tied to one group) ---
R('GET', '/v1/game/config', act.gameConfig, { scope: 'game', keyGroup: true });
R('POST', '/v1/game/heartbeat', act.heartbeat, { scope: 'game', keyGroup: true });
R('POST', '/v1/game/session-end', act.sessionEnd, { scope: 'game', keyGroup: true });
R('GET', '/v1/game/blacklist/:rid', more.blacklistCheck, { scope: 'game', keyGroup: true });
R('GET', '/v1/game/applications', apps.gameList, { scope: 'game', keyGroup: true });
R('POST', '/v1/game/applications/:id/submit', apps.gameSubmit, { scope: 'game', keyGroup: true });
// Verification is system-wide: only keys with the "verify" scope (the owner's verification game) may link accounts.
R('POST', '/v1/game/verify', auth.gameVerify, { scope: 'verify' });

// =====================================================================
async function handle(req, env, ctx) {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (url.pathname === '/' || url.pathname === '/health') return json({ ok: true, service: 'rp-system' });

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const c = { req, env, ctx, url, q: url.searchParams, params, user: null, key: null, group: null, actor: { type: 'public', id: null, name: 'Public' } };
    const o = r.opts;

    if (o.auth === 'user') {
      c.user = await auth.getUser(req, env);
      if (!c.user) bad('Sign in required', 401);
      if (o.owner && c.user.role !== 'owner') bad('Only the owner can do this', 403);
      if (o.perm && !auth.can(c.user, o.perm)) bad(`Missing permission: ${o.perm}`, 403);
      if (o.anyPerm && !o.anyPerm.some((p) => auth.can(c.user, p))) bad(`Missing permission: ${o.anyPerm.join(' or ')}`, 403);
      c.actor = auth.userActor(c.user);
    } else if (o.auth === 'key') {
      c.key = await auth.getApiKey(req, env, ctx);
      if (!c.key) bad('A valid API key is required (Authorization: Bearer rpk_… or X-Api-Key)', 401);
      const need = [].concat(o.scope || []);
      if (need.length && !need.some((s) => c.key.scopes.includes(s))) bad(`This API key is missing the "${need.join('" or "')}" scope`, 403);
      if (params.gid && c.key.group_id && c.key.group_id !== params.gid) bad('This API key is not valid for that group', 403);
      if (o.keyGroup) { if (!c.key.group_id) bad('This endpoint needs an API key tied to a group', 403); params.gid = c.key.group_id; }
      c.actor = { type: o.keyGroup || url.pathname.startsWith('/v1/game/') ? 'game' : 'api', id: c.key.id, name: `API key "${c.key.name}"` };
    }
    if (params.gid) {
      c.group = await env.DB.prepare('SELECT * FROM groups WHERE id=?').bind(params.gid).first();
      if (!c.group) bad('Group not found', 404);
    }
    return r.handler(c);
  }
  bad('Not found', 404);
}

export default {
  async fetch(req, env, ctx) {
    try {
      return await handle(req, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Internal error' }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(act.cron(env, ctx).finally(() => more.autoPromoteCron(env, ctx)));
  },
};

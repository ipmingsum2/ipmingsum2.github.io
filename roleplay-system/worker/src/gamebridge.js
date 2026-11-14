// Game bridge: live servers, dashboard → game commands (announce, kick, shut down), the moderation log that
// admin-system plugins (Adonis, Basic Admin, HD Admin, Kohl's Admin) feed, and in-game staff commands that act
// as the moderator's linked dashboard account.
import { bad, json, now, parseJSON, str, int, readBody, dayStr, weekStartOf, cleanWebhook, isWebhook, sendWebhook, logEvent } from './util.js';
import { can, userActor } from './auth.js';
import { resolveUser, changeRank } from './roblox.js';
import { logbookCreate } from './features.js';
import { blacklistAdd, blacklisted } from './more.js';
import { memberRosterInfo, certAward } from './roster.js';

const LIVE = 180;            // a server that hasn't sent a heartbeat for this long is gone
const COMMAND_TTL = 600;     // commands older than this are never delivered
export const MOD_ACTIONS = ['kick', 'ban', 'unban', 'warn', 'mute', 'other'];
const MOD_COLORS = { kick: 0xf59e0b, ban: 0xe5484d, unban: 0x2fa58a, warn: 0xf5a524, mute: 0x8b5cf6, other: 0x6b7280 };
const isId = (v) => /^\d{1,15}$/.test(String(v ?? ''));

// ---------- heartbeat side (called from activity.heartbeat) ----------
/** Records who is in this server and returns the commands it hasn't received yet. */
export async function serverSync(env, group, jobId, placeId, players) {
  const { DB } = env;
  const t = now();
  const list = players.slice(0, 200).filter((p) => isId(p?.userId)).map((p) => ({
    userId: String(p.userId), username: str(p.username, 40), displayName: str(p.displayName, 40),
    rank: int(p.rank, 0, 255), role: str(p.role, 60), idle: !!p.idle, onDuty: !!p.onDuty, dutyLabel: str(p.dutyLabel, 40),
  }));
  const row = await DB.prepare('SELECT last_cmd FROM game_servers WHERE group_id=? AND job_id=?').bind(group.id, jobId).first();
  let commands = [];
  let last;
  if (!row) {
    // A new server starts after everything already queued, so it never replays old announcements or kicks.
    last = (await DB.prepare('SELECT MAX(id) m FROM game_commands WHERE group_id=?').bind(group.id).first())?.m || 0;
    await DB.prepare('INSERT INTO game_servers (group_id, job_id, place_id, players, started_at, last_seen, last_cmd) VALUES (?,?,?,?,?,?,?) ON CONFLICT(group_id, job_id) DO NOTHING')
      .bind(group.id, jobId, str(placeId, 20) || null, JSON.stringify(list), t, t, last).run();
    return [];
  }
  commands = (await DB.prepare('SELECT * FROM game_commands WHERE group_id=? AND id>? AND created_at>? AND (job_id IS NULL OR job_id=?) ORDER BY id LIMIT 20')
    .bind(group.id, row.last_cmd, t - COMMAND_TTL, jobId).all()).results;
  last = commands.length ? commands[commands.length - 1].id : row.last_cmd;
  await DB.prepare('UPDATE game_servers SET players=?, last_seen=?, last_cmd=?, place_id=COALESCE(?, place_id) WHERE group_id=? AND job_id=?')
    .bind(JSON.stringify(list), t, last, str(placeId, 20) || null, group.id, jobId).run();
  return commands.map((x) => ({ id: x.id, type: x.type, ...parseJSON(x.data, {}) }));
}

/** Hourly: forget servers that stopped and commands nobody can receive any more. */
export async function cleanupCron(env) {
  const t = now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM game_servers WHERE last_seen<?').bind(t - 3600),
    env.DB.prepare('DELETE FROM game_commands WHERE created_at<?').bind(t - 86400),
  ]);
}

// ---------- dashboard: live servers ----------
export async function servers(c) {
  const t = now();
  const rows = (await c.env.DB.prepare('SELECT * FROM game_servers WHERE group_id=? AND last_seen>? ORDER BY started_at').bind(c.group.id, t - LIVE).all()).results;
  const list = rows.map((s) => ({ jobId: s.job_id, placeId: s.place_id, startedAt: s.started_at, lastSeen: s.last_seen, players: parseJSON(s.players, []) }));
  const players = list.flatMap((s) => s.players);
  return json({ servers: list, totals: { servers: list.length, players: players.length, onDuty: players.filter((p) => p.onDuty).length }, canManage: can(c.user, 'manage_servers') });
}

async function queue(c, type, jobId, data) {
  const r = await c.env.DB.prepare('INSERT INTO game_commands (group_id, job_id, type, data, author, created_at) VALUES (?,?,?,?,?,?)')
    .bind(c.group.id, jobId || null, type, JSON.stringify(data), c.actor.name, now()).run();
  return r.meta.last_row_id;
}
async function liveServer(c, jobId) {
  if (!jobId) return null;
  const s = await c.env.DB.prepare('SELECT job_id FROM game_servers WHERE group_id=? AND job_id=? AND last_seen>?').bind(c.group.id, str(jobId, 64), now() - LIVE).first();
  if (!s) bad('That server is no longer running', 404);
  return s.job_id;
}

/** POST …/servers/announce {message, title?, jobId?} — shown in every server (or one) within a minute. */
export async function announce(c) {
  const b = await readBody(c.req);
  const message = str(b.message, 400); if (!message) bad('Write a message');
  const title = str(b.title, 60) || 'Announcement';
  const jobId = await liveServer(c, b.jobId);
  // fromUserId lets the game filter the text as the author (Roblox requires filtering text shown to players).
  await queue(c, 'announce', jobId, { title, message, from: c.actor.name, fromUserId: c.user.roblox_id ? Number(c.user.roblox_id) : null, seconds: int(b.seconds, 5, 60, 12) });
  await logEvent(c.env, c.ctx, { groupId: c.group.id, type: 'game.announce', actor: c.actor, summary: `${c.actor.name} announced in ${jobId ? 'one server' : 'every server'}: ${title} — ${message}` });
  return json({ ok: true });
}

/** POST …/servers/kick {userId, reason, jobId?} */
export async function kick(c) {
  const b = await readBody(c.req);
  const rid = str(b.userId, 20); if (!isId(rid)) bad('Pick a player');
  const reason = str(b.reason, 300) || 'Removed by staff';
  const jobId = await liveServer(c, b.jobId);
  const who = await c.env.DB.prepare('SELECT players FROM game_servers WHERE group_id=? AND last_seen>?').bind(c.group.id, now() - LIVE).all();
  const p = who.results.flatMap((s) => parseJSON(s.players, [])).find((x) => x.userId === rid);
  await queue(c, 'kick', jobId, { userId: Number(rid), reason });
  await record(c.env, c.ctx, c.group, { action: 'kick', rid, username: p?.username || null, reason, moderatorId: c.user.roblox_id || null, moderator: c.actor.name, source: 'Dashboard', jobId });
  return json({ ok: true });
}

/** POST …/servers/shutdown {jobId, message?} — kicks everyone in one server. */
export async function shutdown(c) {
  const b = await readBody(c.req);
  const jobId = await liveServer(c, str(b.jobId, 64) || bad('Pick a server'));
  const message = str(b.message, 200) || 'This server was shut down by staff.';
  await queue(c, 'shutdown', jobId, { message });
  await logEvent(c.env, c.ctx, { groupId: c.group.id, type: 'game.shutdown', actor: c.actor, summary: `${c.actor.name} shut down a game server (${jobId.slice(0, 8)}…): ${message}` });
  return json({ ok: true });
}

// ---------- moderation log ----------
export const cleanModeration = (m = {}) => ({ webhookUrl: cleanWebhook(m.webhookUrl) });

async function record(env, ctx, group, e) {
  const t = now();
  const r = await env.DB.prepare('INSERT INTO moderation (group_id, roblox_id, username, action, reason, duration, moderator_id, moderator, source, job_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(group.id, e.rid || null, e.username || null, e.action, e.reason || null, e.duration ?? null, e.moderatorId || null, e.moderator || null, e.source || null, e.jobId || null, t).run();
  const who = e.username || (e.rid ? `User ${e.rid}` : 'someone');
  const dur = e.duration > 0 ? ` for ${fmtSpan(e.duration)}` : e.action === 'ban' && e.duration === -1 ? ' permanently' : '';
  await logEvent(env, ctx, { groupId: group.id, type: `moderation.${e.action}`, actor: { type: 'game', id: e.moderatorId, name: e.moderator || e.source || 'Game' },
    target: e.rid ? { id: e.rid, name: who } : null, summary: `${e.moderator || 'A moderator'} ${PAST[e.action]} ${who}${dur}${e.reason ? ` — ${e.reason}` : ''}${e.source ? ` (${e.source})` : ''}`, silent: true });
  const url = parseJSON(group.settings, {}).moderation?.webhookUrl;
  if (isWebhook(url)) {
    const fields = [{ name: 'Player', value: e.rid ? `[${who}](https://www.roblox.com/users/${e.rid}/profile)` : who, inline: true }, { name: 'Moderator', value: e.moderator || 'Unknown', inline: true }];
    if (dur) fields.push({ name: 'Duration', value: dur.trim(), inline: true });
    if (e.reason) fields.push({ name: 'Reason', value: e.reason.slice(0, 1000) });
    const p = sendWebhook(url, { embeds: [{ title: `${ACTION_TITLES[e.action]}${e.source ? ` · ${e.source}` : ''}`, color: MOD_COLORS[e.action], fields, timestamp: new Date(t * 1000).toISOString() }] });
    if (ctx?.waitUntil) ctx.waitUntil(p); else await p;
  }
  return r.meta.last_row_id;
}
const PAST = { kick: 'kicked', ban: 'banned', unban: 'unbanned', warn: 'warned', mute: 'muted', other: 'moderated' };
const ACTION_TITLES = { kick: 'Kick', ban: 'Ban', unban: 'Unban', warn: 'Warning', mute: 'Mute', other: 'Moderation' };
function fmtSpan(s) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.round((s % 3600) / 60);
  return d ? `${d}d${h ? ` ${h}h` : ''}` : h ? `${h}h${m ? ` ${m}m` : ''}` : `${Math.max(1, m)}m`;
}

/**
 * POST /v1/game/moderation — what an admin system did in the game.
 * {action, userId?, username?, reason?, duration? (seconds; -1 = permanent), moderatorId?, moderatorName?, source?}
 */
export async function gameModeration(c) {
  const b = await readBody(c.req);
  const action = MOD_ACTIONS.includes(b.action) ? b.action : 'other';
  let rid = isId(b.userId) ? String(b.userId) : null;
  let username = str(b.username, 40) || null;
  if (!rid && username) { try { const u = await resolveUser(c.env, username, c.group.id); rid = u.id; username = u.name; } catch { /* keep the name only */ } }
  if (rid && !username) {
    const m = await c.env.DB.prepare('SELECT username FROM members WHERE group_id=? AND roblox_id=?').bind(c.group.id, rid).first();
    if (m?.username) username = m.username;
    else { try { username = (await resolveUser(c.env, rid, c.group.id)).name; } catch { /* keep the ID only */ } }
  }
  if (!rid && !username) bad('userId or username is required');
  const id = await record(c.env, c.ctx, c.group, {
    action, rid, username, reason: str(b.reason, 500), duration: b.duration == null ? null : int(b.duration, -1, 10 * 365 * 86400),
    moderatorId: isId(b.moderatorId) ? String(b.moderatorId) : null, moderator: str(b.moderatorName, 40) || null, source: str(b.source, 40) || null, jobId: str(b.jobId, 64) || null,
  });
  return json({ ok: true, id });
}

/** GET …/moderation?rid=&action=&q= */
export async function moderationList(c) {
  const where = ['group_id=?'], vals = [c.group.id];
  const rid = str(c.q.get('rid'), 20); if (rid) { where.push('roblox_id=?'); vals.push(rid); }
  const action = c.q.get('action'); if (MOD_ACTIONS.includes(action)) { where.push('action=?'); vals.push(action); }
  const q = str(c.q.get('q'), 60); if (q) { where.push('(username LIKE ? OR moderator LIKE ? OR reason LIKE ?)'); vals.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const rows = (await c.env.DB.prepare(`SELECT * FROM moderation WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 300`).bind(...vals).all()).results;
  const counts = (await c.env.DB.prepare('SELECT action, COUNT(*) n FROM moderation WHERE group_id=? AND created_at>? GROUP BY action').bind(c.group.id, now() - 7 * 86400).all()).results;
  return json({ entries: rows, lastWeek: Object.fromEntries(counts.map((r) => [r.action, r.n])), actions: MOD_ACTIONS });
}

// ---------- in-game lookups ----------
/** GET /v1/game/profile/:rid — everything an admin's info command shows. */
export async function gameProfile(c) {
  const rid = str(c.params.rid, 20);
  if (!isId(rid)) bad('User ID must be numeric');
  const { DB } = c.env;
  const gid = c.group.id, t = now(), today = dayStr(), wk = weekStartOf(today);
  const [m, week, warns, recent, leave, mods] = await DB.batch([
    DB.prepare('SELECT username, rank, role_name FROM members WHERE group_id=? AND roblox_id=?').bind(gid, rid),
    DB.prepare('SELECT SUM(seconds) s, SUM(duty_seconds) d, SUM(sessions) n FROM activity_daily WHERE group_id=? AND roblox_id=? AND day>=?').bind(gid, rid, wk),
    DB.prepare("SELECT COUNT(*) n FROM logbook WHERE group_id=? AND roblox_id=? AND type IN ('warning','strike') AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)").bind(gid, rid, t),
    DB.prepare('SELECT type, reason, author, created_at FROM logbook WHERE group_id=? AND roblox_id=? AND revoked_at IS NULL ORDER BY id DESC LIMIT 3').bind(gid, rid),
    DB.prepare("SELECT end_date FROM time_off WHERE group_id=? AND roblox_id=? AND status='approved' AND start_date<=? AND end_date>=? LIMIT 1").bind(gid, rid, today, today),
    DB.prepare('SELECT COUNT(*) n FROM moderation WHERE group_id=? AND roblox_id=?').bind(gid, rid),
  ]);
  const mem = m.results[0];
  const info = await memberRosterInfo(c.env, gid, rid);
  const bl = await blacklisted(c.env, gid, rid);
  return json({
    robloxId: rid, username: mem?.username || null, member: !!mem && mem.rank > 0, rank: mem?.rank ?? null, roleName: mem?.role_name || null,
    callsign: info.callsign, departments: info.departments.map((d) => d.name),
    certifications: info.certifications.filter((x) => x.active).map((x) => ({ name: x.name, expiresAt: x.expiresAt })),
    week: { seconds: week.results[0]?.s || 0, dutySeconds: week.results[0]?.d || 0, sessions: week.results[0]?.n || 0 },
    activeWarnings: warns.results[0]?.n || 0, recent: recent.results.map((e) => ({ type: e.type, reason: e.reason, by: e.author, at: e.created_at })),
    onLeaveUntil: leave.results[0]?.end_date || null, blacklisted: bl ? { reason: bl.reason } : null, moderationCount: mods.results[0]?.n || 0,
  });
}

// ---------- in-game staff commands ----------
const STAFF_ACTIONS = {
  warn: 'manage_discipline', strike: 'manage_discipline', blacklist: 'manage_discipline',
  promote: 'ranking', demote: 'ranking', setrank: 'ranking', certify: 'manage_roster',
};

// Runs a dashboard handler as the linked user, with `body` as the request body.
async function asUser(c, user, handler, body) {
  const sub = { ...c, user, actor: userActor(user), req: new Request('https://internal/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) };
  return (await handler(sub)).json();
}

async function findCert(env, gid, name) {
  const types = (await env.DB.prepare('SELECT id, name FROM cert_types WHERE group_id=?').bind(gid).all()).results;
  const q = name.toLowerCase();
  const exact = types.find((t) => t.name.toLowerCase() === q);
  if (exact) return exact;
  const starts = types.filter((t) => t.name.toLowerCase().startsWith(q));
  if (starts.length === 1) return starts[0];
  if (!types.length) bad('This group has no certifications yet (dashboard → Roster → Certifications)');
  bad(starts.length > 1 ? `"${name}" matches ${starts.map((t) => t.name).join(', ')} — be more specific` : `No certification called "${name}". Options: ${types.map((t) => t.name).join(', ')}`);
}

/**
 * POST /v1/game/staff {actorId, action, target, reason?, rank?, cert?}
 * The moderator (actorId) must have linked their Roblox account to a dashboard account; that account's
 * permissions decide what they may do, so an in-game admin rank alone is never enough.
 * Always answers 200 with {ok, message} so admin plugins can show the message as-is.
 */
export async function gameStaff(c) {
  const b = await readBody(c.req);
  const action = String(b.action || '').toLowerCase();
  try {
    const perm = STAFF_ACTIONS[action] || bad(`Unknown action "${action}"`);
    if (!isId(b.actorId)) bad('actorId is required');
    const row = await c.env.DB.prepare('SELECT * FROM users WHERE roblox_id=?').bind(String(b.actorId)).first();
    if (!row) bad('Your Roblox account is not linked to a dashboard account. Sign in to the dashboard and link it with the verification game first.');
    const user = { ...row, permissions: parseJSON(row.permissions, []) };
    if (!can(user, perm)) bad(`Your dashboard account is missing the "${perm}" permission.`);
    const targetRaw = str(b.target, 40) || bad('Pick a player');
    const target = await resolveUser(c.env, targetRaw, c.group.id);
    if (target.id === String(b.actorId)) bad('You cannot use this on yourself.');
    const reason = str(b.reason, 500);
    const actor = userActor(user);

    if (action === 'warn' || action === 'strike') {
      if (!reason) bad('Give a reason.');
      const r = await asUser(c, user, logbookCreate, { type: action === 'warn' ? 'warning' : 'strike', user: target.id, reason });
      return json({ ok: true, message: `${action === 'warn' ? 'Warning' : 'Strike'} logged for ${target.name} — ${r.activeWarnings} active.`, activeWarnings: r.activeWarnings });
    }
    if (action === 'blacklist') {
      if (!reason) bad('Give a reason.');
      await asUser(c, user, blacklistAdd, { user: target.id, reason });
      return json({ ok: true, message: `${target.name} is blacklisted and will be removed from every server within a minute.` });
    }
    if (action === 'certify') {
      const cert = await findCert(c.env, c.group.id, str(b.cert, 60) || bad('Name the certification.'));
      const r = await asUser(c, user, certAward, { certId: cert.id, users: [target.id], note: reason });
      return json({ ok: true, message: `${cert.name} ${r.renewed.length ? 'renewed' : 'awarded'} for ${target.name}.` });
    }
    const r = await changeRank(c.env, c.ctx, c.group, { user: target.id, action: action === 'setrank' ? 'set' : action, rank: b.rank, reason: reason ? `In game: ${reason}` : 'In game' }, actor);
    return json({ ok: true, message: `${target.name}: ${r.from.name} → ${r.to.name}.`, from: r.from, to: r.to });
  } catch (e) {
    if (e?.status && e.message) return json({ ok: false, message: e.message });
    throw e;
  }
}

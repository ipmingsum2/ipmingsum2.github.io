// Activity tracking, requirements, time off, and the hourly cron.
import { bad, json, now, parseJSON, str, int, readBody, dayStr, addDays, weekStartOf, isDay, fmtDur, isWebhook, sendWebhook, logEvent, batchAll, SYSTEM } from './util.js';
import { resolveUser, syncMembers } from './roblox.js';
import { sessionCounts } from './features.js';

const STALE = 180; // seconds without a heartbeat before a play session is considered over

// ---------- game → API ----------
/** POST /v1/game/heartbeat {jobId, players:[{userId, username, displayName, rank, role, idle, messages}]} — send every ~60s. */
export async function heartbeat(c) {
  const { env, group } = c;
  const b = await readBody(c.req);
  const jobId = str(b.jobId, 64) || 'unknown';
  const players = Array.isArray(b.players) ? b.players.slice(0, 200) : [];
  const tracked = new Set(parseJSON(group.tracked_ranks, []));
  const t = now();
  const day = dayStr(t);
  const { DB } = env;

  const open = (await DB.prepare('SELECT id, roblox_id, last_ts FROM play_sessions WHERE group_id=? AND job_id=? AND ended=0').bind(group.id, jobId).all()).results;
  const openMap = new Map(open.map((s) => [s.roblox_id, s]));
  const present = new Set();
  const stmts = [];
  const daily = (rid, sec, idle, msgs, sess) => DB.prepare(
    `INSERT INTO activity_daily (group_id, roblox_id, day, seconds, idle_seconds, messages, sessions) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(group_id, roblox_id, day) DO UPDATE SET seconds=seconds+excluded.seconds, idle_seconds=idle_seconds+excluded.idle_seconds,
       messages=messages+excluded.messages, sessions=sessions+excluded.sessions`
  ).bind(group.id, rid, day, sec, idle, msgs, sess);

  let counted = 0;
  for (const p of players) {
    const rid = str(p?.userId, 20);
    if (!/^\d{1,15}$/.test(rid) || present.has(rid)) continue;
    const rank = int(p.rank, 0, 255);
    const role = str(p.role, 60) || null;
    if (!tracked.has(rank)) {
      // Not a tracked rank: keep an existing member row honest, but record no activity.
      stmts.push(DB.prepare('UPDATE members SET rank=-1, role_name=?, updated_at=? WHERE group_id=? AND roblox_id=?').bind(role, t, group.id, rid));
      continue;
    }
    present.add(rid);
    counted++;
    stmts.push(DB.prepare(
      `INSERT INTO members (group_id, roblox_id, username, display_name, rank, role_name, updated_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(group_id, roblox_id) DO UPDATE SET username=excluded.username, display_name=excluded.display_name, rank=excluded.rank, role_name=excluded.role_name, updated_at=excluded.updated_at`
    ).bind(group.id, rid, str(p.username, 40) || null, str(p.displayName, 40) || null, rank, role, t));
    const s = openMap.get(rid);
    const msgs = int(p.messages, 0, 1000);
    if (s && t - s.last_ts <= STALE) {
      const d = Math.max(0, t - s.last_ts);
      const idle = p.idle ? d : 0;
      stmts.push(DB.prepare('UPDATE play_sessions SET last_ts=?, idle_seconds=idle_seconds+?, messages=messages+? WHERE id=?').bind(t, idle, msgs, s.id));
      stmts.push(daily(rid, d, idle, msgs, 0));
    } else {
      if (s) stmts.push(DB.prepare('UPDATE play_sessions SET ended=1 WHERE id=?').bind(s.id));
      stmts.push(DB.prepare('INSERT INTO play_sessions (group_id, roblox_id, job_id, start_ts, last_ts) VALUES (?,?,?,?,?)').bind(group.id, rid, jobId, t, t));
      stmts.push(daily(rid, 0, 0, msgs, 1));
    }
  }
  // Anyone with an open session in this server who is no longer listed has left.
  for (const s of open) if (!present.has(s.roblox_id)) stmts.push(DB.prepare('UPDATE play_sessions SET ended=1 WHERE id=?').bind(s.id));
  await batchAll(env, stmts);
  return json({ ok: true, tracked: counted });
}

/** POST /v1/game/session-end {jobId, userId} — optional, sent when a player leaves so the last partial minute counts. */
export async function sessionEnd(c) {
  const b = await readBody(c.req);
  const rid = str(b.userId, 20);
  const t = now();
  const s = await c.env.DB.prepare('SELECT id, last_ts FROM play_sessions WHERE group_id=? AND job_id=? AND roblox_id=? AND ended=0').bind(c.group.id, str(b.jobId, 64) || 'unknown', rid).first();
  if (!s) return json({ ok: true });
  const d = t - s.last_ts <= STALE ? Math.max(0, t - s.last_ts) : 0;
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE play_sessions SET last_ts=last_ts+?, ended=1 WHERE id=?').bind(d, s.id),
    c.env.DB.prepare('UPDATE activity_daily SET seconds=seconds+? WHERE group_id=? AND roblox_id=? AND day=?').bind(d, c.group.id, rid, dayStr(t)),
  ]);
  return json({ ok: true });
}

export const gameConfig = (c) => json({ groupId: c.group.id, name: c.group.name, trackedRanks: parseJSON(c.group.tracked_ranks, []), heartbeatSeconds: 60 });

// ---------- stats ----------
function range(c) {
  const today = dayStr();
  const to = isDay(c.q.get('to')) ? c.q.get('to') : today;
  const from = isDay(c.q.get('from')) ? c.q.get('from') : weekStartOf(today);
  if (from > to) bad('from must be on or before to');
  return { from, to };
}

/** Leaderboard for a date range + a per-day series for the graph. */
export async function activity(c) {
  const { DB } = c.env;
  const gid = c.group.id;
  const { from, to } = range(c);
  const seriesFrom = isDay(c.q.get('seriesFrom')) ? c.q.get('seriesFrom') : from;
  const tracked = new Set(parseJSON(c.group.tracked_ranks, []));
  const [act, mem, ser, live] = await DB.batch([
    DB.prepare('SELECT roblox_id, SUM(seconds) s, SUM(idle_seconds) i, SUM(messages) m, SUM(sessions) n FROM activity_daily WHERE group_id=? AND day BETWEEN ? AND ? GROUP BY roblox_id').bind(gid, from, to),
    DB.prepare('SELECT * FROM members WHERE group_id=?').bind(gid),
    DB.prepare('SELECT day, SUM(seconds) s, SUM(idle_seconds) i, COUNT(DISTINCT roblox_id) u FROM activity_daily WHERE group_id=? AND day BETWEEN ? AND ? AND seconds>0 GROUP BY day ORDER BY day').bind(gid, seriesFrom, to),
    DB.prepare('SELECT DISTINCT roblox_id FROM play_sessions WHERE group_id=? AND ended=0 AND last_ts>?').bind(gid, now() - STALE),
  ]);
  const a = new Map(act.results.map((r) => [r.roblox_id, r]));
  const online = new Set(live.results.map((r) => r.roblox_id));
  const rows = [];
  for (const m of mem.results) {
    const r = a.get(m.roblox_id);
    const isTracked = tracked.has(m.rank);
    if (!isTracked && !(r?.s > 0)) continue; // former members only appear if they have time in this range
    rows.push({ robloxId: m.roblox_id, username: m.username || `User ${m.roblox_id}`, displayName: m.display_name, rank: m.rank, roleName: m.role_name, tracked: isTracked,
      seconds: r?.s || 0, idleSeconds: r?.i || 0, messages: r?.m || 0, sessions: r?.n || 0, online: online.has(m.roblox_id) });
  }
  rows.sort((x, y) => y.seconds - x.seconds);
  return json({
    from, to, seriesFrom,
    totals: { seconds: rows.reduce((n, r) => n + r.seconds, 0), members: rows.filter((r) => r.tracked).length, active: rows.filter((r) => r.seconds > 0).length, online: online.size },
    leaderboard: rows,
    series: ser.results.map((r) => ({ day: r.day, seconds: r.s, idleSeconds: r.i, members: r.u })),
  });
}

export async function memberList(c) {
  const tracked = new Set(parseJSON(c.group.tracked_ranks, []));
  const rows = (await c.env.DB.prepare('SELECT * FROM members WHERE group_id=? ORDER BY rank DESC, username').bind(c.group.id).all()).results;
  return json({ members: rows.filter((m) => tracked.has(m.rank)).map((m) => ({ robloxId: m.roblox_id, username: m.username, displayName: m.display_name, rank: m.rank, roleName: m.role_name })) });
}

/** Full profile: totals, 12-week daily series, recent sessions, notes, time off, linked Discord. */
export async function memberProfile(c) {
  const { DB } = c.env;
  const gid = c.group.id;
  const rid = str(c.params.rid, 20);
  const today = dayStr();
  const wk = weekStartOf(today);
  const since = addDays(wk, -77);
  const [m, days, sess, notes, off, link, tot, reqs, book, regs] = await DB.batch([
    DB.prepare('SELECT * FROM members WHERE group_id=? AND roblox_id=?').bind(gid, rid),
    DB.prepare('SELECT day, seconds, idle_seconds, messages, sessions FROM activity_daily WHERE group_id=? AND roblox_id=? AND day>=? ORDER BY day').bind(gid, rid, since),
    DB.prepare('SELECT start_ts, last_ts, idle_seconds, messages, ended FROM play_sessions WHERE group_id=? AND roblox_id=? ORDER BY start_ts DESC LIMIT 25').bind(gid, rid),
    DB.prepare('SELECT * FROM notes WHERE group_id=? AND roblox_id=? ORDER BY id DESC').bind(gid, rid),
    DB.prepare('SELECT * FROM time_off WHERE group_id=? AND roblox_id=? ORDER BY start_date DESC LIMIT 20').bind(gid, rid),
    DB.prepare('SELECT discord_id, discord_name FROM links WHERE roblox_id=?').bind(rid),
    DB.prepare('SELECT SUM(seconds) s, SUM(messages) m, SUM(sessions) n FROM activity_daily WHERE group_id=? AND roblox_id=?').bind(gid, rid),
    DB.prepare('SELECT period_type, period_start, seconds, required, met, exempt FROM requirement_results WHERE group_id=? AND roblox_id=? ORDER BY period_start DESC LIMIT 20').bind(gid, rid),
    DB.prepare('SELECT * FROM logbook WHERE group_id=? AND roblox_id=? ORDER BY id DESC LIMIT 50').bind(gid, rid),
    DB.prepare("SELECT e.id, e.title, e.type, e.starts_at, e.status, p.role FROM event_people p JOIN events e ON e.id=p.event_id WHERE p.group_id=? AND p.roblox_id=? ORDER BY e.starts_at DESC LIMIT 15").bind(gid, rid),
  ]);
  const mem = m.results[0];
  if (!mem) bad('Member not found in this group', 404);
  const sum = (f) => days.results.filter(f).reduce((n, d) => n + d.seconds, 0);
  const t = now();
  const logbook = book.results.map((e) => ({ ...e, active: !e.revoked_at && (!e.expires_at || e.expires_at > t) }));
  const [weekSess, allSess] = await Promise.all([sessionCounts(c.env, gid, wk, today), sessionCounts(c.env, gid, '2000-01-01', today)]);
  return json({
    member: { robloxId: rid, username: mem.username || `User ${rid}`, displayName: mem.display_name, rank: mem.rank, roleName: mem.role_name, updatedAt: mem.updated_at },
    discord: link.results[0] ? { id: link.results[0].discord_id, name: link.results[0].discord_name } : null,
    totals: { today: sum((d) => d.day === today), week: sum((d) => d.day >= wk), allTime: tot.results[0]?.s || 0, messages: tot.results[0]?.m || 0, sessions: tot.results[0]?.n || 0 },
    series: days.results.map((d) => ({ day: d.day, seconds: d.seconds, idleSeconds: d.idle_seconds, messages: d.messages, sessions: d.sessions })),
    seriesFrom: since,
    sessions: sess.results.map((s) => ({ start: s.start_ts, end: s.last_ts, seconds: s.last_ts - s.start_ts, idleSeconds: s.idle_seconds, messages: s.messages, live: !s.ended && now() - s.last_ts <= STALE })),
    notes: notes.results, timeOff: off.results, requirements: reqs.results,
    logbook, activeWarnings: logbook.filter((e) => e.active && ['warning', 'strike'].includes(e.type)).length,
    sessionsAttended: { week: weekSess.get(rid) || 0, allTime: allSess.get(rid) || 0 }, register: regs.results,
  });
}

/** POST …/activity/adjust {user, day, minutes, reason} — manual correction (positive or negative). */
export async function adjust(c) {
  const b = await readBody(c.req);
  const u = await resolveUser(c.env, b.user, c.group.id);
  const day = isDay(b.day) ? b.day : dayStr();
  const minutes = int(b.minutes, -1440, 1440);
  if (!minutes) bad('minutes must be a non-zero number');
  const reason = str(b.reason, 200);
  await c.env.DB.prepare(
    `INSERT INTO activity_daily (group_id, roblox_id, day, seconds) VALUES (?,?,?,MAX(0, ?))
     ON CONFLICT(group_id, roblox_id, day) DO UPDATE SET seconds=MAX(0, seconds+?)`
  ).bind(c.group.id, u.id, day, minutes * 60, minutes * 60).run();
  await logEvent(c.env, c.ctx, { groupId: c.group.id, type: 'activity.adjusted', actor: c.actor, target: u, summary: `${c.actor.name} adjusted ${u.name}'s activity on ${day} by ${minutes > 0 ? '+' : ''}${minutes} min${reason ? ` — ${reason}` : ''}`, details: { day, minutes, reason } });
  return json({ ok: true });
}

// ---------- notes & warnings ----------
export async function addNote(c) {
  const b = await readBody(c.req);
  const text = str(b.text, 1000);
  if (!text) bad('Note text is required');
  const kind = b.kind === 'warning' ? 'warning' : 'note';
  const rid = str(c.params.rid, 20);
  const m = await c.env.DB.prepare('SELECT username FROM members WHERE group_id=? AND roblox_id=?').bind(c.group.id, rid).first();
  if (!m) bad('Member not found', 404);
  await c.env.DB.prepare('INSERT INTO notes (group_id, roblox_id, kind, text, author, created_at) VALUES (?,?,?,?,?,?)').bind(c.group.id, rid, kind, text, c.actor.name, now()).run();
  await logEvent(c.env, c.ctx, { groupId: c.group.id, type: `member.${kind}`, actor: c.actor, target: { id: rid, name: m.username }, summary: `${c.actor.name} added a ${kind} to ${m.username || rid}: ${text}` });
  return json({ ok: true });
}

export async function deleteNote(c) {
  const n = await c.env.DB.prepare('SELECT * FROM notes WHERE id=?').bind(Number(c.params.id)).first();
  if (!n) bad('Note not found', 404);
  await c.env.DB.prepare('DELETE FROM notes WHERE id=?').bind(n.id).run();
  await logEvent(c.env, c.ctx, { groupId: n.group_id, type: 'member.note_removed', actor: c.actor, target: { id: n.roblox_id }, summary: `${c.actor.name} removed a ${n.kind} from ${n.roblox_id}: ${n.text}` });
  return json({ ok: true });
}

// ---------- time off ----------
export async function listTimeOff(c) {
  const rows = (await c.env.DB.prepare("SELECT * FROM time_off WHERE group_id=? ORDER BY status='pending' DESC, start_date DESC LIMIT 300").bind(c.group.id).all()).results;
  return json({ timeOff: rows });
}

/** `autoApprove` is true for dashboard managers; API/bot requests always start as pending. */
export async function createTimeOff(c, autoApprove) {
  const b = await readBody(c.req);
  const u = await resolveUser(c.env, b.user ?? b.userId ?? b.username, c.group.id);
  if (!isDay(b.startDate) || !isDay(b.endDate)) bad('startDate and endDate must be YYYY-MM-DD');
  if (b.endDate < b.startDate) bad('endDate must be on or after startDate');
  if (b.endDate > addDays(b.startDate, 365)) bad('Time off cannot be longer than a year');
  const reason = str(b.reason, 500);
  const status = autoApprove && b.approve !== false ? 'approved' : 'pending';
  const r = await c.env.DB.prepare('INSERT INTO time_off (group_id, roblox_id, username, start_date, end_date, reason, status, requested_by, reviewed_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(c.group.id, u.id, u.name, b.startDate, b.endDate, reason, status, c.actor.name, status === 'approved' ? c.actor.name : null, now()).run();
  await logEvent(c.env, c.ctx, { groupId: c.group.id, type: status === 'approved' ? 'timeoff.approved' : 'timeoff.requested', actor: c.actor, target: u, summary: `Time off ${status === 'approved' ? 'added' : 'requested'} for ${u.name}: ${b.startDate} → ${b.endDate}${reason ? ` — ${reason}` : ''}` });
  return json({ ok: true, id: r.meta.last_row_id, status });
}

export async function reviewTimeOff(c) {
  const b = await readBody(c.req);
  if (!['approved', 'denied'].includes(b.status)) bad('status must be approved or denied');
  const t = await c.env.DB.prepare('SELECT * FROM time_off WHERE id=?').bind(Number(c.params.id)).first();
  if (!t) bad('Request not found', 404);
  await c.env.DB.prepare('UPDATE time_off SET status=?, reviewed_by=? WHERE id=?').bind(b.status, c.actor.name, t.id).run();
  await logEvent(c.env, c.ctx, { groupId: t.group_id, type: `timeoff.${b.status}`, actor: c.actor, target: { id: t.roblox_id, name: t.username }, summary: `${c.actor.name} ${b.status} time off for ${t.username} (${t.start_date} → ${t.end_date})` });
  return json({ ok: true });
}

export async function deleteTimeOff(c) {
  const t = await c.env.DB.prepare('SELECT * FROM time_off WHERE id=?').bind(Number(c.params.id)).first();
  if (!t) bad('Request not found', 404);
  await c.env.DB.prepare('DELETE FROM time_off WHERE id=?').bind(t.id).run();
  await logEvent(c.env, c.ctx, { groupId: t.group_id, type: 'timeoff.deleted', actor: c.actor, target: { id: t.roblox_id, name: t.username }, summary: `${c.actor.name} deleted time off for ${t.username} (${t.start_date} → ${t.end_date})` });
  return json({ ok: true });
}

// ---------- requirements ----------
export function requiredSeconds(settings, rank, type) {
  const r = settings.requirements || {};
  const key = type === 'daily' ? 'dailyMinutes' : 'weeklyMinutes';
  const o = r.rankOverrides?.[rank]?.[key];
  return Math.max(0, Number(o ?? r[key]) || 0) * 60;
}

/** Weekly session target (hosted, co-hosted or attended). Daily periods have none. */
export function requiredSessions(settings, rank, type) {
  if (type !== 'weekly') return 0;
  const r = settings.requirements || {};
  return Math.max(0, Number(r.rankOverrides?.[rank]?.weeklySessions ?? r.weeklySessions) || 0);
}

const periodEnd = (type, start) => (type === 'daily' ? start : addDays(start, 6));
function currentPeriod(type) { const t = dayStr(); return type === 'daily' ? t : weekStartOf(t); }

/** Everyone in a tracked rank with their progress against the requirement for one period. */
export async function requirementStatus(env, group, type, start) {
  const { DB } = env;
  const end = periodEnd(type, start);
  const settings = parseJSON(group.settings, {});
  const countIdle = settings.requirements?.countIdle !== false;
  const tracked = new Set(parseJSON(group.tracked_ranks, []));
  const [mem, act, off, links] = await DB.batch([
    DB.prepare('SELECT * FROM members WHERE group_id=?').bind(group.id),
    DB.prepare('SELECT roblox_id, SUM(seconds) s, SUM(idle_seconds) i FROM activity_daily WHERE group_id=? AND day BETWEEN ? AND ? GROUP BY roblox_id').bind(group.id, start, end),
    DB.prepare("SELECT DISTINCT roblox_id FROM time_off WHERE group_id=? AND status='approved' AND start_date<=? AND end_date>=?").bind(group.id, end, start),
    DB.prepare('SELECT l.roblox_id, l.discord_id FROM links l JOIN members m ON m.roblox_id=l.roblox_id AND m.group_id=?').bind(group.id),
  ]);
  const a = new Map(act.results.map((r) => [r.roblox_id, r]));
  const sess = await sessionCounts(env, group.id, start, end);
  const exempt = new Set(off.results.map((r) => r.roblox_id));
  const discord = new Map(links.results.map((r) => [r.roblox_id, r.discord_id]));
  const members = mem.results.filter((m) => tracked.has(m.rank)).map((m) => {
    const r = a.get(m.roblox_id);
    const seconds = Math.max(0, (r?.s || 0) - (countIdle ? 0 : r?.i || 0));
    const required = requiredSeconds(settings, m.rank, type);
    const sessions = sess.get(m.roblox_id) || 0, needSessions = requiredSessions(settings, m.rank, type);
    return { robloxId: m.roblox_id, username: m.username || `User ${m.roblox_id}`, rank: m.rank, roleName: m.role_name, seconds, required, sessions, requiredSessions: needSessions,
      met: seconds >= required && sessions >= needSessions, exempt: exempt.has(m.roblox_id), discordId: discord.get(m.roblox_id) || null };
  }).sort((x, y) => (x.met - y.met) || (x.seconds - y.seconds));
  return { type, from: start, to: end, members };
}

const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
export const DEFAULT_HEADER = '{count} member(s) did not meet the {period} activity requirement ({range}).';
export const DEFAULT_LINE = '{mention} **{user}** ({rank}) — {played} / {required}';

/**
 * Checks a finished (or in-progress) period. `record` stores results + logs; `send` posts to the Discord webhook.
 * Returns the status plus who failed.
 */
export async function runRequirementCheck(env, ctx, group, type, start, { record = true, send = true, actor = SYSTEM } = {}) {
  const status = await requirementStatus(env, group, type, start);
  const r = parseJSON(group.settings, {}).requirements || {};
  const checked = status.members.filter((m) => m.required > 0 || m.requiredSessions > 0);
  const failed = checked.filter((m) => !m.met && !m.exempt);
  const label = type === 'daily' ? 'daily' : 'weekly';
  const rangeText = status.from === status.to ? status.from : `${status.from} → ${status.to}`;
  // Nothing is required for this period type (e.g. no daily requirement set): the scheduler skips it silently.
  if (!checked.length && actor === SYSTEM) return { ...status, failed: [], checked: 0, sent: false };

  if (record) {
    const { DB } = env;
    const t = now();
    const res = DB.prepare('INSERT OR REPLACE INTO requirement_results (group_id, period_type, period_start, roblox_id, seconds, required, met, exempt) VALUES (?,?,?,?,?,?,?,?)');
    const log = DB.prepare("INSERT INTO logs (ts, group_id, type, actor_type, actor_name, target_id, target_name, summary, details) VALUES (?,?,'requirement.not_met',?,?,?,?,?,?)");
    await batchAll(env, [
      DB.prepare('INSERT OR REPLACE INTO requirement_runs (group_id, period_type, period_start, ran_at, failed, checked) VALUES (?,?,?,?,?,?)').bind(group.id, type, start, t, failed.length, checked.length),
      ...checked.map((m) => res.bind(group.id, type, start, m.robloxId, m.seconds, m.required, m.met ? 1 : 0, m.exempt ? 1 : 0)),
      ...failed.map((m) => log.bind(t, group.id, actor.type, actor.name, m.robloxId, m.username, `${m.username} did not meet the ${label} requirement for ${rangeText}: ${fmtDur(m.seconds)} / ${fmtDur(m.required)}${m.requiredSessions ? `, ${m.sessions} / ${m.requiredSessions} sessions` : ''}`, JSON.stringify({ period: type, start, seconds: m.seconds, required: m.required, sessions: m.sessions, requiredSessions: m.requiredSessions }))),
    ]);
    const excused = checked.filter((m) => !m.met && m.exempt).length;
    await logEvent(env, ctx, { groupId: group.id, type: 'requirement.check', actor, summary: `${label[0].toUpperCase() + label.slice(1)} requirement check for ${rangeText}: ${failed.length} of ${checked.length} did not meet it${excused ? ` (${excused} more excused by time off)` : ''}`, details: { type, start, failed: failed.length, checked: checked.length, excused } });
  }

  let sent = false;
  if (send && isWebhook(r.webhookUrl) && (failed.length || r.notifyAllMet)) {
    const vars = { count: failed.length, period: label, range: rangeText, group: group.name, checked: checked.length };
    const header = failed.length ? fill(r.headerTemplate || DEFAULT_HEADER, vars) : `Everyone met the ${label} activity requirement (${rangeText}).`;
    const lines = failed.map((m) => fill(r.lineTemplate || (m.requiredSessions ? `${DEFAULT_LINE} · {sessions}/{requiredSessions} sessions` : DEFAULT_LINE), {
      ...vars, user: m.username, id: m.robloxId, rank: m.roleName || m.rank, played: fmtDur(m.seconds), required: fmtDur(m.required), missing: fmtDur(Math.max(0, m.required - m.seconds)), sessions: m.sessions, requiredSessions: m.requiredSessions,
      mention: r.pingMembers && m.discordId ? `<@${m.discordId}>` : '',
    }).trim());
    // Chunk into embeds (Discord: 4096 chars per description, 10 embeds / 6000 chars per message).
    const chunks = [];
    let cur = '';
    for (const l of lines) { if (cur.length + l.length + 1 > 3500) { chunks.push(cur); cur = ''; } cur += (cur ? '\n' : '') + l; }
    if (cur || !chunks.length) chunks.push(cur);
    const users = r.pingMembers ? failed.map((m) => m.discordId).filter(Boolean) : [];
    const roleId = /^\d{15,21}$/.test(r.mentionRoleId || '') ? r.mentionRoleId : null;
    sent = true;
    for (let i = 0; i < chunks.length; i++) {
      const ok = await sendWebhook(r.webhookUrl, {
        content: i === 0 && roleId ? `<@&${roleId}>` : undefined,
        allowed_mentions: { parse: [], roles: roleId ? [roleId] : [], users: users.slice(0, 100) },
        embeds: [{
          title: i === 0 ? `${group.name} — ${label} requirements` : undefined,
          description: `${i === 0 ? header + '\n\n' : ''}${chunks[i]}`.slice(0, 4000),
          color: failed.length ? 0xe5484d : 0x2fa58a,
          footer: i === chunks.length - 1 ? { text: `${checked.length - failed.length} of ${checked.length} met or excused` } : undefined,
        }],
      });
      sent = sent && ok;
    }
  }
  return { ...status, failed: failed.map((m) => m.robloxId), checked: checked.length, sent };
}

/** GET …/requirements?type=weekly&start=YYYY-MM-DD — live progress for the current (or a given) period. */
export async function requirementsGet(c) {
  const type = c.q.get('type') === 'daily' ? 'daily' : 'weekly';
  let start = isDay(c.q.get('start')) ? c.q.get('start') : currentPeriod(type);
  if (type === 'weekly') start = weekStartOf(start);
  const [status, runs] = await Promise.all([
    requirementStatus(c.env, c.group, type, start),
    c.env.DB.prepare('SELECT * FROM requirement_runs WHERE group_id=? ORDER BY ran_at DESC LIMIT 15').bind(c.group.id).all(),
  ]);
  return json({ ...status, runs: runs.results });
}

/** POST …/requirements/run {type, start?, send} — manual check; records results and optionally notifies Discord. */
export async function requirementsRun(c) {
  const b = await readBody(c.req);
  const type = b.type === 'daily' ? 'daily' : 'weekly';
  let start = isDay(b.start) ? b.start : currentPeriod(type);
  if (type === 'weekly') start = weekStartOf(start);
  const out = await runRequirementCheck(c.env, c.ctx, c.group, type, start, { record: true, send: b.send !== false, actor: c.actor });
  return json(out);
}

// ---------- cron ----------
export async function cron(env, ctx) {
  const { DB } = env;
  const t = now();
  await DB.batch([
    DB.prepare('DELETE FROM auth_sessions WHERE expires<?').bind(t),
    DB.prepare('DELETE FROM oauth_states WHERE expires<?').bind(t),
    DB.prepare('DELETE FROM verify_codes WHERE expires<?').bind(t),
    DB.prepare('UPDATE play_sessions SET ended=1 WHERE ended=0 AND last_ts<?').bind(t - STALE * 2),
  ]);
  const hour = new Date(t * 1000).getUTCHours();
  const today = dayStr(t);
  const groups = (await DB.prepare('SELECT * FROM groups').all()).results;
  for (const group of groups) {
    const r = parseJSON(group.settings, {}).requirements || {};
    if (!r.enabled || hour !== int(r.checkHour, 0, 23, 0)) continue;
    try {
      // Refresh the roster first so people who never joined the game are still checked.
      if (group.api_key_enc) await syncMembers(env, group).catch((e) => logEvent(env, ctx, { groupId: group.id, type: 'group.sync_failed', summary: `Member sync before requirement check failed: ${e.message}`, silent: true }));
      const jobs = [['daily', addDays(today, -1)]];
      if (weekStartOf(today) === today) jobs.push(['weekly', addDays(today, -7)]);
      for (const [type, start] of jobs) {
        const done = await DB.prepare('SELECT 1 FROM requirement_runs WHERE group_id=? AND period_type=? AND period_start=?').bind(group.id, type, start).first();
        if (done) continue;
        await runRequirementCheck(env, ctx, group, type, start, { record: true, send: true });
      }
    } catch (e) {
      await logEvent(env, ctx, { groupId: group.id, type: 'requirement.error', summary: `Scheduled requirement check failed: ${e.message}`, silent: true });
    }
  }
}

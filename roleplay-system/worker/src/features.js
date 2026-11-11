// Logbook, session registers, promotion recommendations, knowledgebase, news, leaderboard.
import { bad, json, now, parseJSON, str, int, readBody, addDays, dayStr, weekStartOf, cleanWebhook, sendWebhook, logEvent } from './util.js';
import { resolveUser, changeRank } from './roblox.js';
import { can, PERMISSIONS } from './auth.js';

const ts = (day) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);

// ---------- session counts (used by requirements, profiles and the leaderboard) ----------
/** Completed sessions per member between two UTC days (inclusive): registered as host/co-host/attendee, or named as host. */
export async function sessionCounts(env, gid, fromDay, toDay) {
  const a = ts(fromDay), z = ts(addDays(toDay, 1));
  const rows = (await env.DB.prepare(
    `SELECT roblox_id, COUNT(*) n FROM (
       SELECT p.event_id, p.roblox_id FROM event_people p JOIN events e ON e.id = p.event_id
         WHERE e.group_id = ?1 AND e.status = 'completed' AND e.starts_at >= ?2 AND e.starts_at < ?3
       UNION
       SELECT e.id, m.roblox_id FROM events e JOIN members m ON m.group_id = e.group_id AND m.username = e.host_name COLLATE NOCASE
         WHERE e.group_id = ?1 AND e.status = 'completed' AND e.starts_at >= ?2 AND e.starts_at < ?3
     ) GROUP BY roblox_id`
  ).bind(gid, a, z).all()).results;
  return new Map(rows.map((r) => [r.roblox_id, r.n]));
}

/** Top 3 by minutes and by sessions this week (overview leaderboard). */
export async function leaderboard(env, group) {
  const wk = weekStartOf(dayStr()), today = dayStr();
  const tracked = new Set(parseJSON(group.tracked_ranks, []));
  const [mins, mem] = await env.DB.batch([
    env.DB.prepare('SELECT roblox_id, SUM(seconds) s FROM activity_daily WHERE group_id=? AND day BETWEEN ? AND ? GROUP BY roblox_id ORDER BY s DESC LIMIT 20').bind(group.id, wk, today),
    env.DB.prepare('SELECT roblox_id, username, rank, role_name FROM members WHERE group_id=?').bind(group.id),
  ]);
  const m = new Map(mem.results.map((r) => [r.roblox_id, r]));
  const sess = await sessionCounts(env, group.id, wk, today);
  const row = (id, v) => ({ robloxId: id, username: m.get(id)?.username || `User ${id}`, roleName: m.get(id)?.role_name || '', value: v });
  return {
    minutes: mins.results.filter((r) => r.s > 0 && tracked.has(m.get(r.roblox_id)?.rank)).slice(0, 3).map((r) => row(r.roblox_id, r.s)),
    sessions: [...sess].filter(([id]) => tracked.has(m.get(id)?.rank)).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([id, n]) => row(id, n)),
  };
}

// ---------- logbook ----------
export const LOG_TYPES = ['warning', 'strike', 'suspension', 'demotion', 'promotion', 'commendation', 'termination'];
const COUNTS_AS_WARNING = ['warning', 'strike'];
const isActive = (e, t = now()) => !e.revoked_at && (!e.expires_at || e.expires_at > t);
const entryView = (e, t = now()) => ({ ...e, active: isActive(e, t), countsAsWarning: COUNTS_AS_WARNING.includes(e.type) });

export async function logbookList(c) {
  const where = ['group_id=?'], vals = [c.group.id];
  const rid = str(c.q.get('rid'), 20); if (rid) { where.push('roblox_id=?'); vals.push(rid); }
  const type = c.q.get('type'); if (LOG_TYPES.includes(type)) { where.push('type=?'); vals.push(type); }
  const q = str(c.q.get('q'), 60); if (q) { where.push('(username LIKE ? OR reason LIKE ? OR author LIKE ?)'); vals.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  let rows = (await c.env.DB.prepare(`SELECT * FROM logbook WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 300`).bind(...vals).all()).results.map((e) => entryView(e));
  if (c.q.get('active') === '1') rows = rows.filter((e) => e.active);
  // Active warning counts per member — the "warning ticker".
  const counts = {};
  for (const e of rows) if (e.active && e.countsAsWarning) counts[e.roblox_id] = (counts[e.roblox_id] || 0) + 1;
  return json({ entries: rows, activeWarnings: counts, types: LOG_TYPES });
}

export async function logbookCreate(c) {
  const b = await readBody(c.req);
  const type = LOG_TYPES.includes(b.type) ? b.type : bad('Pick an entry type');
  const reason = str(b.reason, 1000); if (!reason) bad('A reason is required');
  const evidence = str(b.evidence, 500);
  if (evidence && !/^https:\/\/\S+$/.test(evidence)) bad('Evidence must be an https:// link');
  const days = int(b.expiresInDays, 0, 3650);
  const u = await resolveUser(c.env, b.user, c.group.id);
  const t = now();
  // Optionally carry out the rank change the entry records.
  let ranked = null;
  if (b.applyRank && (type === 'promotion' || type === 'demotion')) {
    if (!can(c.user, 'ranking')) bad('You need the ranking permission to change ranks', 403);
    ranked = await changeRank(c.env, c.ctx, c.group, { user: u.id, action: type === 'promotion' ? 'promote' : 'demote', reason: `Logbook: ${reason}` }, c.actor);
  }
  const r = await c.env.DB.prepare('INSERT INTO logbook (group_id, roblox_id, username, type, reason, evidence, expires_at, author, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(c.group.id, u.id, u.name, type, reason, evidence || null, days ? t + days * 86400 : null, c.actor.name, t).run();
  const active = (await c.env.DB.prepare("SELECT COUNT(*) n FROM logbook WHERE group_id=? AND roblox_id=? AND type IN ('warning','strike') AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)").bind(c.group.id, u.id, t).first()).n;
  await logEvent(c.env, c.ctx, { groupId: c.group.id, type: `logbook.${type}`, actor: c.actor, target: u,
    summary: `${c.actor.name} logged a ${type} for ${u.name}: ${reason}${days ? ` (expires in ${days} days)` : ''}${COUNTS_AS_WARNING.includes(type) ? ` — ${active} active warning${active === 1 ? '' : 's'}` : ''}`,
    details: { entryId: r.meta.last_row_id, evidence: evidence || null } });
  return json({ ok: true, id: r.meta.last_row_id, activeWarnings: active, ranked: ranked?.to || null });
}

export async function logbookRevoke(c) {
  const e = await c.env.DB.prepare('SELECT * FROM logbook WHERE id=?').bind(Number(c.params.id)).first();
  if (!e) bad('Entry not found', 404);
  if (e.revoked_at) bad('This entry was already revoked');
  await c.env.DB.prepare('UPDATE logbook SET revoked_at=?, revoked_by=? WHERE id=?').bind(now(), c.actor.name, e.id).run();
  await logEvent(c.env, c.ctx, { groupId: e.group_id, type: 'logbook.revoked', actor: c.actor, target: { id: e.roblox_id, name: e.username }, summary: `${c.actor.name} revoked ${e.username}'s ${e.type}: ${e.reason}` });
  return json({ ok: true });
}

// ---------- session registers ----------
const ROLES = ['host', 'cohost', 'attendee'];
async function loadEvent(env, id) {
  const e = await env.DB.prepare('SELECT * FROM events WHERE id=?').bind(Number(id)).first();
  if (!e) bad('Session not found', 404);
  return e;
}
export async function eventPeople(c) {
  const e = await loadEvent(c.env, c.params.id);
  const rows = (await c.env.DB.prepare("SELECT * FROM event_people WHERE event_id=? ORDER BY CASE role WHEN 'host' THEN 0 WHEN 'cohost' THEN 1 ELSE 2 END, username").bind(e.id).all()).results;
  return json({ event: e, people: rows });
}
export async function eventAddPerson(c) {
  const e = await loadEvent(c.env, c.params.id);
  const b = await readBody(c.req);
  const role = ROLES.includes(b.role) ? b.role : 'attendee';
  const users = String(b.user ?? '').split(/[\s,]+/).filter(Boolean).slice(0, 50); // paste a list of names
  if (!users.length) bad('Enter at least one Roblox username or ID');
  const added = [];
  for (const raw of users) {
    const u = await resolveUser(c.env, raw, e.group_id);
    await c.env.DB.prepare('INSERT OR REPLACE INTO event_people (event_id, group_id, roblox_id, username, role, added_by, created_at) VALUES (?,?,?,?,?,?,?)').bind(e.id, e.group_id, u.id, u.name, role, c.actor.name, now()).run();
    added.push(u.name);
  }
  if (role === 'host') await c.env.DB.prepare('UPDATE events SET host_name=? WHERE id=?').bind(added[0], e.id).run();
  await logEvent(c.env, c.ctx, { groupId: e.group_id, type: 'session.register', actor: c.actor, summary: `${c.actor.name} added ${added.join(', ')} to "${e.title}" as ${role}`, silent: added.length > 3 });
  return json({ ok: true, added });
}
export async function eventRemovePerson(c) {
  const e = await loadEvent(c.env, c.params.id);
  await c.env.DB.prepare('DELETE FROM event_people WHERE event_id=? AND roblox_id=?').bind(e.id, str(c.params.rid, 20)).run();
  return json({ ok: true });
}
/** Staff claim a session for themselves (needs their Roblox account linked on My account). */
export async function eventClaim(c) {
  const e = await loadEvent(c.env, c.params.id);
  if (e.status !== 'scheduled') bad('Only scheduled sessions can be claimed');
  const b = await readBody(c.req);
  const role = b.role === 'cohost' ? 'cohost' : b.role === 'attendee' ? 'attendee' : 'host';
  if (!c.user.roblox_id) bad('Link your Roblox account on My account first, so the session can be credited to you', 400);
  if (role === 'host') {
    const cur = await c.env.DB.prepare("SELECT username FROM event_people WHERE event_id=? AND role='host' AND roblox_id<>?").bind(e.id, c.user.roblox_id).first();
    if (cur || (e.host_name && e.host_name.toLowerCase() !== String(c.user.roblox_name || '').toLowerCase())) bad(`Already hosted by ${cur?.username || e.host_name}`, 409);
    await c.env.DB.prepare('UPDATE events SET host_name=? WHERE id=?').bind(c.user.roblox_name, e.id).run();
  }
  await c.env.DB.prepare('INSERT OR REPLACE INTO event_people (event_id, group_id, roblox_id, username, role, added_by, created_at) VALUES (?,?,?,?,?,?,?)').bind(e.id, e.group_id, c.user.roblox_id, c.user.roblox_name, role, c.actor.name, now()).run();
  await logEvent(c.env, c.ctx, { groupId: e.group_id, type: 'session.claimed', actor: c.actor, summary: `${c.user.roblox_name} claimed "${e.title}" as ${role}` });
  return json({ ok: true });
}
export async function eventUnclaim(c) {
  const e = await loadEvent(c.env, c.params.id);
  if (!c.user.roblox_id) bad('Link your Roblox account first');
  const me = await c.env.DB.prepare('SELECT role FROM event_people WHERE event_id=? AND roblox_id=?').bind(e.id, c.user.roblox_id).first();
  await c.env.DB.prepare('DELETE FROM event_people WHERE event_id=? AND roblox_id=?').bind(e.id, c.user.roblox_id).run();
  if (me?.role === 'host') await c.env.DB.prepare('UPDATE events SET host_name=NULL WHERE id=?').bind(e.id).run();
  return json({ ok: true });
}

// ---------- promotion recommendations ----------
export async function recList(c) {
  const status = ['open', 'promoted', 'declined'].includes(c.q.get('status')) ? c.q.get('status') : 'open';
  const { DB } = c.env;
  const [recs, votes] = await DB.batch([
    DB.prepare('SELECT * FROM recommendations WHERE group_id=? AND status=? ORDER BY id DESC LIMIT 200').bind(c.group.id, status),
    DB.prepare('SELECT v.* FROM rec_votes v JOIN recommendations r ON r.id=v.rec_id WHERE r.group_id=? AND r.status=? ORDER BY v.created_at').bind(c.group.id, status),
  ]);
  const byRec = new Map();
  for (const v of votes.results) { if (!byRec.has(v.rec_id)) byRec.set(v.rec_id, []); byRec.get(v.rec_id).push(v); }
  const week = now() - 7 * 86400;
  const list = recs.results.map((r) => {
    const vs = byRec.get(r.id) || [];
    return { ...r, votes: vs.map((v) => ({ user: v.user_name, justification: v.justification, at: v.created_at })), voteCount: vs.length,
      recentVotes: vs.filter((v) => v.created_at > week).length, myVote: vs.some((v) => v.user_id === c.user.id), mine: r.created_by_id === c.user.id };
  });
  // Recommender insights: who suggests most, and how often their picks get promoted.
  const insights = (await DB.prepare("SELECT created_by name, COUNT(*) total, SUM(status='promoted') promoted, SUM(status='open') open FROM recommendations WHERE group_id=? GROUP BY created_by ORDER BY total DESC LIMIT 8").bind(c.group.id).all()).results;
  return json({ recommendations: list, insights });
}
export async function recCreate(c) {
  const b = await readBody(c.req);
  const reason = str(b.reason, 1000); if (reason.length < 10) bad('Explain the recommendation (at least 10 characters)');
  const u = await resolveUser(c.env, b.user, c.group.id);
  const m = await c.env.DB.prepare('SELECT rank, role_name FROM members WHERE group_id=? AND roblox_id=?').bind(c.group.id, u.id).first();
  const dup = await c.env.DB.prepare("SELECT id FROM recommendations WHERE group_id=? AND roblox_id=? AND status='open'").bind(c.group.id, u.id).first();
  if (dup) bad(`${u.name} already has an open recommendation — upvote it instead`, 409);
  const r = await c.env.DB.prepare('INSERT INTO recommendations (group_id, roblox_id, username, rank, role_name, reason, created_by_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(c.group.id, u.id, u.name, m?.rank ?? null, m?.role_name ?? null, reason, c.user.id, c.actor.name, now()).run();
  await logEvent(c.env, c.ctx, { groupId: c.group.id, type: 'promotion.recommended', actor: c.actor, target: u, summary: `${c.actor.name} recommended ${u.name} for promotion: ${reason}` });
  return json({ ok: true, id: r.meta.last_row_id });
}
async function loadRec(env, id) {
  const r = await env.DB.prepare('SELECT * FROM recommendations WHERE id=?').bind(Number(id)).first();
  if (!r) bad('Recommendation not found', 404);
  return r;
}
export async function recVote(c) {
  const r = await loadRec(c.env, c.params.id);
  if (r.status !== 'open') bad('This recommendation is closed');
  const b = await readBody(c.req);
  const why = str(b.justification, 500); if (why.length < 5) bad('Add a short justification for your upvote');
  await c.env.DB.prepare('INSERT OR REPLACE INTO rec_votes (rec_id, user_id, user_name, justification, created_at) VALUES (?,?,?,?,?)').bind(r.id, c.user.id, c.actor.name, why, now()).run();
  return json({ ok: true });
}
export async function recUnvote(c) {
  const r = await loadRec(c.env, c.params.id);
  await c.env.DB.prepare('DELETE FROM rec_votes WHERE rec_id=? AND user_id=?').bind(r.id, c.user.id).run();
  return json({ ok: true });
}
export async function recDecide(c) {
  const r = await loadRec(c.env, c.params.id);
  if (r.status !== 'open') bad('This recommendation is already closed');
  const b = await readBody(c.req);
  if (!['promoted', 'declined'].includes(b.status)) bad('status must be promoted or declined');
  let ranked = null;
  if (b.status === 'promoted' && b.promote !== false) {
    const group = await c.env.DB.prepare('SELECT * FROM groups WHERE id=?').bind(r.group_id).first();
    ranked = (await changeRank(c.env, c.ctx, group, { user: r.roblox_id, action: 'promote', reason: `Recommendation: ${r.reason}` }, c.actor)).to;
  }
  await c.env.DB.prepare('UPDATE recommendations SET status=?, decided_by=?, decided_at=? WHERE id=?').bind(b.status, c.actor.name, now(), r.id).run();
  await logEvent(c.env, c.ctx, { groupId: r.group_id, type: `promotion.${b.status === 'promoted' ? 'approved' : 'declined'}`, actor: c.actor, target: { id: r.roblox_id, name: r.username },
    summary: `${c.actor.name} ${b.status === 'promoted' ? 'approved' : 'declined'} the promotion recommendation for ${r.username}${ranked ? ` — now ${ranked.name}` : ''}` });
  return json({ ok: true, ranked });
}

// ---------- knowledgebase ----------
const canSee = (user, doc) => !doc.visibility || can(user, doc.visibility) || can(user, 'manage_content');
function docFields(b) {
  const title = str(b.title, 120); if (!title) bad('Title is required');
  const visibility = b.visibility && PERMISSIONS.includes(b.visibility) ? b.visibility : '';
  return { title, category: str(b.category, 40) || 'General', body: str(b.body, 50000), visibility };
}
export async function kbList(c) {
  const rows = (await c.env.DB.prepare('SELECT id, title, category, visibility, updated_by, updated_at, length(body) size FROM kb_docs WHERE group_id=? ORDER BY category, title').bind(c.group.id).all()).results;
  return json({ docs: rows.filter((d) => canSee(c.user, d)) });
}
export async function kbGet(c) {
  const d = await c.env.DB.prepare('SELECT * FROM kb_docs WHERE id=?').bind(Number(c.params.id)).first();
  if (!d || !canSee(c.user, d)) bad('Document not found', 404);
  return json({ doc: d });
}
export async function kbCreate(c) {
  const f = docFields(await readBody(c.req));
  const t = now();
  const r = await c.env.DB.prepare('INSERT INTO kb_docs (group_id, title, category, body, visibility, updated_by, updated_at, created_at) VALUES (?,?,?,?,?,?,?,?)').bind(c.group.id, f.title, f.category, f.body, f.visibility, c.actor.name, t, t).run();
  await logEvent(c.env, c.ctx, { groupId: c.group.id, type: 'content.doc_created', actor: c.actor, summary: `${c.actor.name} created knowledgebase page "${f.title}"` });
  return json({ ok: true, id: r.meta.last_row_id });
}
export async function kbUpdate(c) {
  const d = await c.env.DB.prepare('SELECT * FROM kb_docs WHERE id=?').bind(Number(c.params.id)).first();
  if (!d) bad('Document not found', 404);
  const f = docFields(await readBody(c.req));
  await c.env.DB.prepare('UPDATE kb_docs SET title=?, category=?, body=?, visibility=?, updated_by=?, updated_at=? WHERE id=?').bind(f.title, f.category, f.body, f.visibility, c.actor.name, now(), d.id).run();
  await logEvent(c.env, c.ctx, { groupId: d.group_id, type: 'content.doc_updated', actor: c.actor, summary: `${c.actor.name} edited knowledgebase page "${f.title}"`, silent: true });
  return json({ ok: true });
}
export async function kbDelete(c) {
  const d = await c.env.DB.prepare('SELECT * FROM kb_docs WHERE id=?').bind(Number(c.params.id)).first();
  if (!d) bad('Document not found', 404);
  await c.env.DB.prepare('DELETE FROM kb_docs WHERE id=?').bind(d.id).run();
  await logEvent(c.env, c.ctx, { groupId: d.group_id, type: 'content.doc_deleted', actor: c.actor, summary: `${c.actor.name} deleted knowledgebase page "${d.title}"` });
  return json({ ok: true });
}

// ---------- news ----------
export async function newsList(c) {
  const rows = (await c.env.DB.prepare('SELECT * FROM posts WHERE group_id=? ORDER BY pinned DESC, id DESC LIMIT ?').bind(c.group.id, int(c.q.get('limit'), 1, 100, 50)).all()).results;
  return json({ posts: rows });
}
export async function newsCreate(c) {
  const b = await readBody(c.req);
  const title = str(b.title, 140); if (!title) bad('Title is required');
  const body = str(b.body, 4000); if (!body) bad('Write something');
  const r = await c.env.DB.prepare('INSERT INTO posts (group_id, title, body, pinned, author, created_at) VALUES (?,?,?,?,?,?)').bind(c.group.id, title, body, b.pinned ? 1 : 0, c.actor.name, now()).run();
  await logEvent(c.env, c.ctx, { groupId: c.group.id, type: 'content.news_posted', actor: c.actor, summary: `${c.actor.name} posted news: ${title}`, silent: true });
  const hook = parseJSON(c.group.settings, {}).news?.webhookUrl;
  let announced = false;
  if (b.announce && hook) {
    announced = true;
    c.ctx.waitUntil(sendWebhook(hook, { embeds: [{ title, description: body.slice(0, 3900), color: 0x5b8def, footer: { text: `${c.group.name} · posted by ${c.actor.name}` }, timestamp: new Date().toISOString() }] }));
  }
  return json({ ok: true, id: r.meta.last_row_id, announced, hasWebhook: !!hook });
}
export async function newsUpdate(c) {
  const p = await c.env.DB.prepare('SELECT * FROM posts WHERE id=?').bind(Number(c.params.id)).first();
  if (!p) bad('Post not found', 404);
  const b = await readBody(c.req);
  await c.env.DB.prepare('UPDATE posts SET pinned=? WHERE id=?').bind(b.pinned ? 1 : 0, p.id).run();
  return json({ ok: true });
}
export async function newsDelete(c) {
  const p = await c.env.DB.prepare('SELECT * FROM posts WHERE id=?').bind(Number(c.params.id)).first();
  if (!p) bad('Post not found', 404);
  await c.env.DB.prepare('DELETE FROM posts WHERE id=?').bind(p.id).run();
  await logEvent(c.env, c.ctx, { groupId: p.group_id, type: 'content.news_deleted', actor: c.actor, summary: `${c.actor.name} deleted news post "${p.title}"`, silent: true });
  return json({ ok: true });
}
export const cleanNewsSettings = (n = {}) => ({ webhookUrl: cleanWebhook(n.webhookUrl) });

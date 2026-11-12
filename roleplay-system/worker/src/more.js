// Blacklist (kicked in-game, blocked from applying) and auto-promotion rules (hours + sessions → next rank).
import { bad, json, now, parseJSON, str, int, readBody, addDays, dayStr, cleanWebhook, sendWebhook, logEvent, SYSTEM } from './util.js';
import { resolveUser, changeRank } from './roblox.js';
import { can } from './auth.js';
import { sessionCounts } from './features.js';

// =====================================================================
// Blacklist
// =====================================================================
const ACTIVE_SQL = 'removed_at IS NULL AND (expires_at IS NULL OR expires_at > ?)';
const blView = (e, t = now()) => ({ ...e, active: !e.removed_at && (!e.expires_at || e.expires_at > t) });

/** The active blacklist entry for one user, or null. */
export async function blacklisted(env, gid, rid) {
  return env.DB.prepare(`SELECT * FROM blacklist WHERE group_id=? AND roblox_id=? AND ${ACTIVE_SQL} ORDER BY id DESC LIMIT 1`).bind(gid, String(rid), now()).first();
}

/** Active entries for a set of user IDs (heartbeat: who should be kicked). */
export async function blacklistedAmong(env, gid, ids) {
  if (!ids.length) return [];
  const want = new Set(ids.map(String));
  const rows = (await env.DB.prepare(`SELECT roblox_id, reason FROM blacklist WHERE group_id=? AND ${ACTIVE_SQL} LIMIT 5000`).bind(gid, now()).all()).results;
  return rows.filter((r) => want.has(r.roblox_id));
}

export async function blacklistList(c) {
  const rows = (await c.env.DB.prepare('SELECT * FROM blacklist WHERE group_id=? ORDER BY id DESC LIMIT 500').bind(c.group.id).all()).results;
  const t = now();
  return json({ entries: rows.map((e) => blView(e, t)) });
}

export async function blacklistAdd(c) {
  const b = await readBody(c.req);
  const reason = str(b.reason, 500);
  if (!reason) bad('A reason is required');
  const evidence = str(b.evidence, 500);
  if (evidence && !/^https:\/\/\S+$/.test(evidence)) bad('Evidence must be an https:// link');
  const days = int(b.expiresInDays, 0, 3650);
  const u = await resolveUser(c.env, b.user, c.group.id);
  if (await blacklisted(c.env, c.group.id, u.id)) bad(`${u.name} is already blacklisted`, 409);
  const t = now();
  const r = await c.env.DB.prepare('INSERT INTO blacklist (group_id, roblox_id, username, reason, evidence, expires_at, author, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(c.group.id, u.id, u.name, reason, evidence || null, days ? t + days * 86400 : null, c.actor.name, t).run();
  await logEvent(c.env, c.ctx, { groupId: c.group.id, type: 'blacklist.added', actor: c.actor, target: u,
    summary: `${c.actor.name} blacklisted ${u.name}: ${reason}${days ? ` (for ${days} days)` : ' (permanent)'}`, details: { entryId: r.meta.last_row_id, evidence: evidence || null } });
  return json({ ok: true, id: r.meta.last_row_id, user: u });
}

export async function blacklistRemove(c) {
  const e = await c.env.DB.prepare('SELECT * FROM blacklist WHERE id=?').bind(Number(c.params.id) || 0).first();
  if (!e) bad('Entry not found', 404);
  if (e.removed_at) bad('This entry was already removed');
  await c.env.DB.prepare('UPDATE blacklist SET removed_at=?, removed_by=? WHERE id=?').bind(now(), c.actor.name, e.id).run();
  await logEvent(c.env, c.ctx, { groupId: e.group_id, type: 'blacklist.removed', actor: c.actor, target: { id: e.roblox_id, name: e.username }, summary: `${c.actor.name} removed ${e.username} from the blacklist` });
  return json({ ok: true });
}

/** GET /v1/groups/:gid/blacklist — active entries only. */
export async function blacklistPublic(c) {
  const rows = (await c.env.DB.prepare(`SELECT roblox_id, username, reason, expires_at, created_at FROM blacklist WHERE group_id=? AND ${ACTIVE_SQL} ORDER BY id DESC LIMIT 1000`).bind(c.group.id, now()).all()).results;
  return json({ blacklist: rows.map((r) => ({ robloxId: r.roblox_id, username: r.username, reason: r.reason, expiresAt: r.expires_at, createdAt: r.created_at })) });
}

/** GET /v1/groups/:gid/blacklist/:rid and /v1/game/blacklist/:rid */
export async function blacklistCheck(c) {
  const rid = str(c.params.rid, 20);
  if (!/^\d{1,15}$/.test(rid)) bad('User ID must be numeric');
  const e = await blacklisted(c.env, c.group.id, rid);
  return json({ robloxId: rid, blacklisted: !!e, reason: e?.reason || null, expiresAt: e?.expires_at || null });
}

// =====================================================================
// Auto-promotion
// =====================================================================
const MAX_RULES = 20;
const MAX_PER_RUN = 25; // keeps a run well inside Open Cloud rate limits

export function cleanAutoPromote(a = {}, prev = {}) {
  const rules = (Array.isArray(a.rules) ? a.rules : []).slice(0, MAX_RULES).map((r, i) => {
    const fromRank = int(r?.fromRank, 1, 254), toRank = int(r?.toRank, 1, 254);
    if (!fromRank || !toRank) bad(`Rule ${i + 1}: pick both ranks`);
    if (toRank <= fromRank) bad(`Rule ${i + 1}: the new rank must be higher than the current rank`);
    const minHours = Math.max(0, Math.min(10000, Math.round(Number(r.minHours) * 10) / 10 || 0));
    const minSessions = int(r.minSessions, 0, 1000);
    if (!minHours && !minSessions) bad(`Rule ${i + 1}: set a minimum number of hours or sessions`);
    return { fromRank, toRank, minHours, minSessions, days: int(r.days, 0, 365), noWarnings: !!r.noWarnings };
  });
  const from = rules.map((r) => r.fromRank);
  if (new Set(from).size !== from.length) bad('Each rank can only have one rule');
  return {
    enabled: !!a.enabled,
    mode: a.mode === 'promote' ? 'promote' : 'recommend',
    checkHour: int(a.checkHour, 0, 23, 0),
    webhookUrl: a.webhookUrl === '(hidden)' ? prev.webhookUrl || '' : cleanWebhook(a.webhookUrl),
    rules,
    lastRunDay: prev.lastRunDay || null,
  };
}

/** Everyone in a rule's starting rank with their progress; `eligible` when every condition is met. */
export async function evaluate(env, group, settings = parseJSON(group.settings, {})) {
  const ap = settings.autoPromote || { rules: [] };
  if (!ap.rules?.length) return [];
  const { DB } = env;
  const gid = group.id, today = dayStr(), t = now();
  const countIdle = settings.requirements?.countIdle !== false;
  const roles = parseJSON(group.roles, []);
  const roleName = (rank) => roles.find((r) => r.rank === rank)?.name || `Rank ${rank}`;
  const ranks = ap.rules.map((r) => r.fromRank);
  const [mem, warn, bl, recs] = await DB.batch([
    DB.prepare(`SELECT roblox_id, username, display_name, rank, role_name FROM members WHERE group_id=? AND rank IN (${ranks.map(() => '?').join(',')})`).bind(gid, ...ranks),
    DB.prepare("SELECT roblox_id, COUNT(*) n FROM logbook WHERE group_id=? AND type IN ('warning','strike') AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) GROUP BY roblox_id").bind(gid, t),
    DB.prepare(`SELECT roblox_id FROM blacklist WHERE group_id=? AND ${ACTIVE_SQL}`).bind(gid, t),
    DB.prepare("SELECT roblox_id FROM recommendations WHERE group_id=? AND status='open'").bind(gid),
  ]);
  const warnings = new Map(warn.results.map((r) => [r.roblox_id, r.n]));
  const banned = new Set(bl.results.map((r) => r.roblox_id));
  const openRec = new Set(recs.results.map((r) => r.roblox_id));

  const out = [];
  for (const rule of ap.rules) {
    const from = rule.days ? addDays(today, -(rule.days - 1)) : '2000-01-01';
    const [secs, sessions] = await Promise.all([
      DB.prepare('SELECT roblox_id, SUM(seconds) s, SUM(idle_seconds) i FROM activity_daily WHERE group_id=? AND day BETWEEN ? AND ? GROUP BY roblox_id').bind(gid, from, today).all(),
      sessionCounts(env, gid, from, today),
    ]);
    const played = new Map(secs.results.map((r) => [r.roblox_id, Math.max(0, r.s - (countIdle ? 0 : r.i))]));
    const people = mem.results.filter((m) => m.rank === rule.fromRank).map((m) => {
      const hours = Math.round(((played.get(m.roblox_id) || 0) / 3600) * 10) / 10;
      const n = sessions.get(m.roblox_id) || 0, w = warnings.get(m.roblox_id) || 0;
      const blocked = banned.has(m.roblox_id) ? 'Blacklisted' : rule.noWarnings && w ? `${w} active warning${w === 1 ? '' : 's'}` : null;
      return { robloxId: m.roblox_id, username: m.username || `User ${m.roblox_id}`, displayName: m.display_name || '', hours, sessions: n, warnings: w,
        eligible: !blocked && hours >= rule.minHours && n >= rule.minSessions, blocked, recommended: openRec.has(m.roblox_id) };
    }).sort((a, b) => (b.eligible - a.eligible) || (b.hours - a.hours));
    out.push({ ...rule, fromName: roleName(rule.fromRank), toName: roleName(rule.toRank), people });
  }
  return out;
}

/** Promotes (or recommends) everyone eligible. Returns what happened per person. */
export async function runAutoPromote(env, ctx, group, actor = SYSTEM) {
  const settings = parseJSON(group.settings, {});
  const ap = settings.autoPromote;
  if (!ap?.rules?.length) bad('Add at least one rule first');
  if (ap.mode === 'promote' && !group.api_key_enc) bad('Promoting needs the group’s Open Cloud key — add it under Groups, or use “recommend” mode');
  const rules = await evaluate(env, group, settings);
  const done = [];
  for (const rule of rules) {
    for (const p of rule.people.filter((x) => x.eligible)) {
      if (done.length >= MAX_PER_RUN) break;
      const why = `Auto-promotion: ${p.hours}h and ${p.sessions} session${p.sessions === 1 ? '' : 's'}${rule.days ? ` in ${rule.days} days` : ''}`;
      if (ap.mode === 'recommend') {
        if (p.recommended) continue;
        await env.DB.prepare('INSERT INTO recommendations (group_id, roblox_id, username, rank, role_name, reason, created_by_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
          .bind(group.id, p.robloxId, p.username, rule.fromRank, rule.fromName, `${why} — qualifies for ${rule.toName}.`, null, 'Auto-promotion', now()).run();
        done.push({ ...p, to: rule.toName, result: 'recommended' });
      } else {
        try {
          const r = await changeRank(env, ctx, group, { user: p.robloxId, action: 'set', rank: rule.toRank, reason: why }, actor);
          done.push({ ...p, to: r.to.name, result: 'promoted' });
        } catch (e) { done.push({ ...p, to: rule.toName, result: 'failed', error: e.message }); }
      }
    }
  }
  const ok = done.filter((d) => d.result !== 'failed');
  if (done.length) {
    await logEvent(env, ctx, { groupId: group.id, type: 'autopromote.run', actor,
      summary: `Auto-promotion ${ap.mode === 'promote' ? 'promoted' : 'recommended'} ${ok.length} member${ok.length === 1 ? '' : 's'}${done.length > ok.length ? ` (${done.length - ok.length} failed)` : ''}: ${done.slice(0, 15).map((d) => `${d.username} → ${d.to}`).join(', ')}${done.length > 15 ? '…' : ''}`,
      details: { results: done.map(({ robloxId, username, to, result, error }) => ({ robloxId, username, to, result, error })) } });
    if (ap.webhookUrl) {
      const lines = done.map((d) => `${d.result === 'failed' ? '⚠️' : d.result === 'promoted' ? '⬆️' : '👍'} **${d.username}** → ${d.to} · ${d.hours}h, ${d.sessions} sessions${d.error ? ' — failed, see Logs' : ''}`);
      ctx.waitUntil(sendWebhook(ap.webhookUrl, { embeds: [{ title: ap.mode === 'promote' ? 'Auto-promotions' : 'Promotion recommendations', color: 0x2fa58a,
        description: lines.join('\n').slice(0, 4000), footer: { text: group.name }, timestamp: new Date().toISOString() }] }));
    }
  }
  return { mode: ap.mode, results: done };
}

export async function autoPromoteGet(c) {
  const settings = parseJSON(c.group.settings, {});
  const ap = { enabled: false, mode: 'recommend', checkHour: 0, webhookUrl: '', rules: [], ...(settings.autoPromote || {}) };
  if (!can(c.user, 'ranking') && ap.webhookUrl) ap.webhookUrl = '(hidden)';
  return json({ settings: ap, rules: await evaluate(c.env, c.group, settings) });
}

export async function autoPromoteSave(c) {
  const b = await readBody(c.req);
  const settings = parseJSON(c.group.settings, {});
  settings.autoPromote = cleanAutoPromote(b, settings.autoPromote || {});
  await c.env.DB.prepare('UPDATE groups SET settings=? WHERE id=?').bind(JSON.stringify(settings), c.group.id).run();
  const a = settings.autoPromote;
  await logEvent(c.env, c.ctx, { groupId: c.group.id, type: 'autopromote.updated', actor: c.actor,
    summary: `${c.actor.name} ${a.enabled ? 'updated' : 'saved (disabled)'} auto-promotion: ${a.rules.length} rule${a.rules.length === 1 ? '' : 's'}, ${a.mode} mode, daily at ${String(a.checkHour).padStart(2, '0')}:00 UTC` });
  return json({ ok: true });
}

export async function autoPromoteRun(c) {
  return json(await runAutoPromote(c.env, c.ctx, c.group, c.actor));
}

/** Hourly cron: runs each enabled group once a day at its check hour. */
export async function autoPromoteCron(env, ctx) {
  const t = now(), hour = new Date(t * 1000).getUTCHours(), today = dayStr(t);
  const groups = (await env.DB.prepare('SELECT * FROM groups').all()).results;
  for (const group of groups) {
    const settings = parseJSON(group.settings, {});
    const ap = settings.autoPromote;
    if (!ap?.enabled || !ap.rules?.length || hour !== ap.checkHour || ap.lastRunDay === today) continue;
    ap.lastRunDay = today; // mark first so a slow or failing run never repeats within the day
    await env.DB.prepare('UPDATE groups SET settings=? WHERE id=?').bind(JSON.stringify(settings), group.id).run();
    try { await runAutoPromote(env, ctx, { ...group, settings: JSON.stringify(settings) }); }
    catch (e) { await logEvent(env, ctx, { groupId: group.id, type: 'autopromote.error', summary: `Scheduled auto-promotion failed: ${e.message}`, silent: true }); }
  }
}

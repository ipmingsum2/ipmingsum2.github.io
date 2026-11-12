// Session reminders (Discord, shortly before a session starts), the weekly "Staff of the week" leaderboard post,
// and the activity heatmap (when members play, by weekday and hour).
import { bad, json, now, parseJSON, str, int, addDays, dayStr, cleanWebhook, sendWebhook, logEvent, SYSTEM } from './util.js';
import { sessionCounts } from './features.js';

const REMIND_OPTIONS = [0, 10, 15, 30, 60, 120];
const ROLE_ID = /^\d{15,21}$/;
const cleanRole = (v, what) => { const r = str(v, 25); if (r && !ROLE_ID.test(r)) bad(`${what} must be a numeric Discord role ID`); return r; };
const keep = (v, prev) => (v === '(hidden)' ? prev || '' : cleanWebhook(v)); // view-only users see "(hidden)" instead of the URL

// ---------- settings ----------
export function cleanEvents(e = {}, prev = {}) {
  const remind = int(e.remindMinutes, 0, 120, 0);
  return {
    webhookUrl: keep(e.webhookUrl, prev.webhookUrl),
    remindMinutes: REMIND_OPTIONS.includes(remind) ? remind : 30,
    mentionRoleId: cleanRole(e.mentionRoleId, 'Role to ping for reminders'),
  };
}

export function cleanLeaderboard(l = {}, prev = {}) {
  const top = int(l.top, 3, 10, 5);
  return {
    enabled: !!l.enabled,
    webhookUrl: keep(l.webhookUrl, prev.webhookUrl),
    day: int(l.day, 0, 6, 6),   // 0 = Monday … 6 = Sunday
    hour: int(l.hour, 0, 23, 18), // UTC
    top: [3, 5, 10].includes(top) ? top : 5,
    lastPostDay: prev.lastPostDay || null,
  };
}

// ---------- session reminders (every 5 minutes) ----------
const TYPE_LABEL = (t) => (t ? t[0].toUpperCase() + t.slice(1) : 'Session');

/** Marks the event reminded (only one caller wins), then posts the reminder. */
async function remind(env, e, ev) {
  const claimed = await env.DB.prepare('UPDATE events SET reminded_at=? WHERE id=? AND reminded_at IS NULL').bind(now(), e.id).run();
  if (!claimed.meta.changes) return false;
  const people = (await env.DB.prepare("SELECT username, role FROM event_people WHERE event_id=? AND role IN ('host','cohost') ORDER BY role DESC").bind(e.id).all()).results;
  const host = people.find((p) => p.role === 'host')?.username || e.host_name;
  const cohosts = people.filter((p) => p.role === 'cohost').map((p) => p.username);
  const role = ev.mentionRoleId;
  return sendWebhook(ev.webhookUrl, {
    content: role ? `<@&${role}>` : undefined,
    allowed_mentions: { parse: [], roles: role ? [role] : [] },
    embeds: [{
      title: `⏰ Starting soon — ${TYPE_LABEL(e.type)}: ${e.title}`.slice(0, 256), color: 0xe2a336,
      description: [`Starts <t:${e.starts_at}:t> (<t:${e.starts_at}:R>) · ${e.duration_min} min`, host ? `Host: **${host}**` : '', cohosts.length ? `Co-host${cohosts.length > 1 ? 's' : ''}: ${cohosts.map((c) => `**${c}**`).join(', ')}` : '', e.notes ? `\n${String(e.notes).slice(0, 1500)}` : ''].filter(Boolean).join('\n'),
      timestamp: new Date(e.starts_at * 1000).toISOString(),
    }],
  });
}

export async function remindersCron(env) {
  const t = now();
  const rows = (await env.DB.prepare(
    `SELECT e.*, g.settings AS gsettings FROM events e JOIN groups g ON g.id = e.group_id
     WHERE e.status = 'scheduled' AND e.reminded_at IS NULL AND e.starts_at > ? AND e.starts_at <= ? ORDER BY e.starts_at LIMIT 200`
  ).bind(t, t + 121 * 60).all()).results;
  let sent = 0;
  for (const e of rows) {
    const ev = parseJSON(e.gsettings, {}).events || {};
    if (!ev.webhookUrl || !ev.remindMinutes) continue;
    if (e.starts_at - t > ev.remindMinutes * 60) continue;
    if (await remind(env, e, ev)) sent++;
  }
  return sent;
}

/** A session created or moved inside the reminder window was just announced — don't remind straight away. */
export function remindedAtFor(group, startsAt) {
  const m = parseJSON(group.settings, {}).events?.remindMinutes || 0;
  return m && startsAt - now() <= m * 60 ? now() : null;
}

// ---------- weekly leaderboard ----------
const MEDALS = ['🥇', '🥈', '🥉'];
const hrs = (sec) => { const h = sec / 3600; return h >= 10 ? Math.round(h).toString() : h.toFixed(1); };

/** Top members by hours and by sessions over the 7 full days before `today`. */
export async function weeklyTop(env, group, top = 5, today = dayStr()) {
  const from = addDays(today, -7), to = addDays(today, -1);
  const settings = parseJSON(group.settings, {});
  const countIdle = settings.requirements?.countIdle !== false;
  const tracked = new Set(parseJSON(group.tracked_ranks, []));
  const [act, mem] = await env.DB.batch([
    env.DB.prepare('SELECT roblox_id, SUM(seconds) s, SUM(idle_seconds) i FROM activity_daily WHERE group_id=? AND day BETWEEN ? AND ? GROUP BY roblox_id').bind(group.id, from, to),
    env.DB.prepare('SELECT roblox_id, username, rank, role_name FROM members WHERE group_id=?').bind(group.id),
  ]);
  const m = new Map(mem.results.map((r) => [r.roblox_id, r]));
  const sessions = await sessionCounts(env, group.id, from, to);
  const row = (id, value) => ({ robloxId: id, username: m.get(id)?.username || `User ${id}`, roleName: m.get(id)?.role_name || '', value });
  const hours = act.results.map((r) => [r.roblox_id, Math.max(0, r.s - (countIdle ? 0 : r.i))])
    .filter(([id, s]) => s > 0 && tracked.has(m.get(id)?.rank)).sort((a, b) => b[1] - a[1]).slice(0, top).map(([id, s]) => row(id, s));
  const sess = [...sessions].filter(([id, n]) => n > 0 && tracked.has(m.get(id)?.rank)).sort((a, b) => b[1] - a[1]).slice(0, top).map(([id, n]) => row(id, n));
  const total = act.results.reduce((n, r) => n + (tracked.has(m.get(r.roblox_id)?.rank) ? Math.max(0, r.s - (countIdle ? 0 : r.i)) : 0), 0);
  return { from, to, hours, sessions: sess, totalSeconds: total, active: act.results.filter((r) => r.s > 0 && tracked.has(m.get(r.roblox_id)?.rank)).length };
}

async function postLeaderboard(env, group, lb) {
  const w = await weeklyTop(env, group, lb.top);
  // Name + value only: with the rank too, the two side-by-side columns wrap onto several lines in Discord.
  const list = (items, fmt) => items.length ? items.map((x, i) => `${MEDALS[i] || `**${i + 1}.**`} **${x.username}** — ${fmt(x.value)}`).join('\n') : '_Nobody yet_';
  const star = w.hours[0];
  const ok = await sendWebhook(lb.webhookUrl, {
    embeds: [{
      title: `🏆 Staff of the week — ${group.name}`.slice(0, 256), color: 0xf2b84b,
      description: star ? `**${star.username}** led the week with **${hrs(star.value)} hours** in game. Thank you!` : 'No activity was recorded this week.',
      fields: [
        { name: 'Most hours', value: list(w.hours, (s) => `${hrs(s)} h`).slice(0, 1024), inline: true },
        { name: 'Most sessions', value: list(w.sessions, (n) => `${n} session${n === 1 ? '' : 's'}`).slice(0, 1024), inline: true },
      ],
      footer: { text: `${w.from} → ${w.to} · ${hrs(w.totalSeconds)} hours from ${w.active} member${w.active === 1 ? '' : 's'}` },
      timestamp: new Date().toISOString(),
    }],
  });
  return { ok, ...w };
}

/** Hourly: posts once on the configured weekday and hour (UTC). */
export async function leaderboardCron(env, ctx) {
  const t = now(), d = new Date(t * 1000), today = dayStr(t);
  const weekday = (d.getUTCDay() + 6) % 7, hour = d.getUTCHours();
  const groups = (await env.DB.prepare('SELECT * FROM groups').all()).results;
  for (const group of groups) {
    const settings = parseJSON(group.settings, {});
    const lb = settings.leaderboard;
    if (!lb?.enabled || !lb.webhookUrl || lb.day !== weekday || lb.hour !== hour || lb.lastPostDay === today) continue;
    lb.lastPostDay = today; // first, so a retry never double-posts
    await env.DB.prepare('UPDATE groups SET settings=? WHERE id=?').bind(JSON.stringify(settings), group.id).run();
    try {
      const r = await postLeaderboard(env, group, lb);
      await logEvent(env, ctx, { groupId: group.id, type: 'leaderboard.posted', actor: SYSTEM, summary: `Posted Staff of the week (${r.from} → ${r.to})${r.hours[0] ? `: ${r.hours[0].username}` : ''}`, silent: true });
    } catch (e) {
      await logEvent(env, ctx, { groupId: group.id, type: 'leaderboard.error', summary: `Weekly leaderboard failed: ${e.message}`, silent: true });
    }
  }
}

/** GET /api/groups/:gid/leaderboard/week — preview of what the post would say. */
export async function leaderboardPreview(c) {
  return json(await weeklyTop(c.env, c.group, parseJSON(c.group.settings, {}).leaderboard?.top || 5));
}

/** POST /api/groups/:gid/leaderboard/post — post it now (test the webhook). */
export async function leaderboardPostNow(c) {
  const lb = parseJSON(c.group.settings, {}).leaderboard;
  if (!lb?.webhookUrl) bad('Set a leaderboard webhook in the group’s settings first');
  const r = await postLeaderboard(c.env, c.group, lb);
  if (!r.ok) bad('Discord did not accept the post — check the webhook URL', 502);
  await logEvent(c.env, c.ctx, { groupId: c.group.id, type: 'leaderboard.posted', actor: c.actor, summary: `${c.actor.name} posted Staff of the week (${r.from} → ${r.to})` });
  return json({ ok: true });
}

// ---------- heatmap ----------
/**
 * GET /api/groups/:gid/heatmap?days=28 → 168 buckets of seconds played (UTC; index = weekday*24 + hour, weekday 0 = Monday).
 * Each play session is spread over the hours it covers.
 */
export async function heatmap(c) {
  const days = int(c.q.get('days'), 7, 90, 28);
  const since = now() - days * 86400;
  const rows = (await c.env.DB.prepare('SELECT start_ts, last_ts FROM play_sessions WHERE group_id=? AND last_ts>? LIMIT 50000').bind(c.group.id, since).all()).results;
  const buckets = new Array(168).fill(0);
  for (const r of rows) {
    let a = Math.max(r.start_ts, since);
    const z = r.last_ts;
    while (a < z) {
      const d = new Date(a * 1000);
      const next = Math.min(z, (Math.floor(a / 3600) + 1) * 3600);
      buckets[((d.getUTCDay() + 6) % 7) * 24 + d.getUTCHours()] += next - a;
      a = next;
    }
  }
  return json({ days, buckets, sessions: rows.length });
}

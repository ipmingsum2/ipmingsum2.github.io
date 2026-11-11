// Roblox Open Cloud: group roles, memberships, ranking, member sync.
import { HttpError, bad, parseJSON, decrypt, now, logEvent, batchAll } from './util.js';

const OC = 'https://apis.roblox.com/cloud/v2';

async function oc(key, path, init = {}) {
  let r;
  try {
    r = await fetch(`${OC}/${path}`, { ...init, headers: { 'x-api-key': key, 'content-type': 'application/json' } });
  } catch { throw new HttpError(502, 'Could not reach Roblox Open Cloud'); }
  const text = await r.text();
  const data = parseJSON(text, null);
  if (!r.ok) {
    const hint = r.status === 401 || r.status === 403 ? ' — check the API key, its group scopes (group:read, group:write) and that the key owner can manage this group' : '';
    throw new HttpError(502, `Roblox Open Cloud error ${r.status}: ${data?.message || text.slice(0, 160) || 'request failed'}${hint}`);
  }
  return data;
}

export async function groupKey(env, group) {
  if (!group.api_key_enc) bad('This group has no Open Cloud API key configured (Groups → Edit)');
  return decrypt(env, group.api_key_enc);
}

export async function fetchGroupInfo(key, gid) {
  const g = await oc(key, `groups/${gid}`);
  return { name: g?.displayName || `Group ${gid}` };
}

export async function fetchRoles(key, gid) {
  const roles = [];
  let token = '';
  for (let i = 0; i < 5; i++) {
    const d = await oc(key, `groups/${gid}/roles?maxPageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
    for (const r of d?.groupRoles || []) roles.push({ id: String(r.id ?? r.path.split('/').pop()), name: r.displayName, rank: r.rank, memberCount: r.memberCount ?? null });
    token = d?.nextPageToken || '';
    if (!token) break;
  }
  return roles.sort((a, b) => a.rank - b.rank);
}

export async function refreshRoles(env, group, key) {
  const roles = await fetchRoles(key || (await groupKey(env, group)), group.id);
  await env.DB.prepare('UPDATE groups SET roles=? WHERE id=?').bind(JSON.stringify(roles), group.id).run();
  group.roles = JSON.stringify(roles);
  return roles;
}

async function getMembership(key, gid, uid) {
  const f = encodeURIComponent(`user == 'users/${uid}'`);
  const d = await oc(key, `groups/${gid}/memberships?maxPageSize=10&filter=${f}`);
  const m = d?.groupMemberships?.[0];
  return m ? { path: m.path, roleId: String(m.role).split('/').pop() } : null;
}

// ---------- user lookups (public Roblox web API; failures are non-fatal) ----------
export async function usersByIds(ids) {
  const out = new Map();
  const list = [...new Set(ids.map(String))].filter((s) => /^\d+$/.test(s));
  for (let i = 0; i < list.length; i += 100) {
    try {
      const r = await fetch('https://users.roblox.com/v1/users', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userIds: list.slice(i, i + 100).map(Number), excludeBannedUsers: false }),
      });
      if (!r.ok) continue;
      for (const u of (await r.json()).data || []) out.set(String(u.id), { id: String(u.id), name: u.name, displayName: u.displayName });
    } catch { /* names are best-effort */ }
  }
  return out;
}

async function userByName(name) {
  try {
    const r = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usernames: [name], excludeBannedUsers: false }),
    });
    if (!r.ok) throw new Error();
    const u = (await r.json()).data?.[0];
    return u ? { id: String(u.id), name: u.name, displayName: u.displayName } : null;
  } catch { throw new HttpError(502, 'Could not look up that username on Roblox right now — try the numeric user ID instead'); }
}

/** Accepts a numeric user id or a username; returns {id, name, displayName}. */
export async function resolveUser(env, input, gid = null) {
  const s = String(input ?? '').trim();
  if (/^\d{1,15}$/.test(s)) {
    if (gid) {
      const m = await env.DB.prepare('SELECT username, display_name FROM members WHERE group_id=? AND roblox_id=?').bind(gid, s).first();
      if (m?.username) return { id: s, name: m.username, displayName: m.display_name || '' };
    }
    return (await usersByIds([s])).get(s) || { id: s, name: `User ${s}`, displayName: '' };
  }
  if (!/^[A-Za-z0-9_]{3,20}$/.test(s)) bad('Enter a Roblox username or numeric user ID');
  if (gid) {
    const m = await env.DB.prepare('SELECT roblox_id, username, display_name FROM members WHERE group_id=? AND username=? COLLATE NOCASE').bind(gid, s).first();
    if (m) return { id: m.roblox_id, name: m.username, displayName: m.display_name || '' };
  }
  const u = await userByName(s);
  if (!u) bad('Roblox user not found', 404);
  return u;
}

// ---------- ranking ----------
/**
 * action: 'promote' | 'demote' | 'set' (with `rank`). Never touches rank 255 (owner) or 0 (guest),
 * and never assigns above the group's configured max rank.
 */
export async function changeRank(env, ctx, group, { user, action, rank, reason }, actor) {
  const key = await groupKey(env, group);
  let roles = parseJSON(group.roles, []);
  if (!roles.length) roles = await refreshRoles(env, group, key);
  const u = await resolveUser(env, user, group.id);
  const mem = await getMembership(key, group.id, u.id);
  if (!mem) bad(`${u.name} is not a member of this group`, 404);
  let cur = roles.find((r) => r.id === mem.roleId);
  if (!cur) { roles = await refreshRoles(env, group, key); cur = roles.find((r) => r.id === mem.roleId); }
  if (!cur) bad('Could not determine the current rank of this user');

  const settings = parseJSON(group.settings, {});
  const maxRank = Math.min(254, Number(settings.ranking?.maxRank) || 254);
  const assignable = roles.filter((r) => r.rank > 0 && r.rank <= maxRank);
  if (cur.rank === 255) bad('The group owner cannot be re-ranked');
  if (cur.rank > maxRank) bad(`${u.name} is above the maximum rank this system may manage (${maxRank})`, 403);

  let target;
  if (action === 'promote') target = assignable.filter((r) => r.rank > cur.rank)[0];
  else if (action === 'demote') target = assignable.filter((r) => r.rank < cur.rank).pop();
  else if (action === 'set') target = assignable.find((r) => r.rank === Number(rank));
  else bad('action must be promote, demote or set');
  if (!target) bad(action === 'set' ? `Rank ${rank} does not exist or is not assignable (max ${maxRank})` : `No rank available to ${action} to`);
  if (target.id === cur.id) bad(`${u.name} already has that rank`);

  await oc(key, mem.path, { method: 'PATCH', body: JSON.stringify({ role: `groups/${group.id}/roles/${target.id}` }) });

  const tracked = parseJSON(group.tracked_ranks, []);
  const t = now();
  if (tracked.includes(target.rank)) {
    await env.DB.prepare(
      `INSERT INTO members (group_id, roblox_id, username, display_name, rank, role_name, updated_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(group_id, roblox_id) DO UPDATE SET rank=excluded.rank, role_name=excluded.role_name, updated_at=excluded.updated_at`
    ).bind(group.id, u.id, u.name, u.displayName || null, target.rank, target.name, t).run();
  } else {
    await env.DB.prepare('UPDATE members SET rank=-1, role_name=?, updated_at=? WHERE group_id=? AND roblox_id=?').bind(target.name, t, group.id, u.id).run();
  }

  const up = target.rank > cur.rank;
  const type = action === 'set' ? 'rank.set' : up ? 'rank.promote' : 'rank.demote';
  const why = String(reason || '').trim().slice(0, 300);
  await logEvent(env, ctx, {
    groupId: group.id, type, actor, target: u,
    summary: `${u.name} was ${up ? 'promoted' : 'demoted'} from ${cur.name} (${cur.rank}) to ${target.name} (${target.rank})${why ? ` — ${why}` : ''}`,
    details: { from: cur, to: target, reason: why, action },
  });
  return { user: u, from: { name: cur.name, rank: cur.rank }, to: { name: target.name, rank: target.rank } };
}

// ---------- member sync ----------
/** Pulls every member in the tracked ranks from Open Cloud into the members table. */
export async function syncMembers(env, group) {
  const key = await groupKey(env, group);
  const roles = await refreshRoles(env, group, key);
  const tracked = new Set(parseJSON(group.tracked_ranks, []));
  const t = now();
  const found = [];
  let truncated = false;
  for (const role of roles.filter((r) => tracked.has(r.rank))) {
    const f = encodeURIComponent(`role == 'groups/${group.id}/roles/${role.id}'`);
    let token = '';
    for (let page = 0; ; page++) {
      if (page >= 8) { truncated = true; break; }
      const d = await oc(key, `groups/${group.id}/memberships?maxPageSize=100&filter=${f}${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
      for (const m of d?.groupMemberships || []) found.push({ id: String(m.user).split('/').pop(), role });
      token = d?.nextPageToken || '';
      if (!token) break;
    }
  }
  const known = new Map((await env.DB.prepare('SELECT roblox_id, username FROM members WHERE group_id=?').bind(group.id).all()).results.map((m) => [m.roblox_id, m.username]));
  const names = await usersByIds(found.filter((m) => !known.get(m.id)).map((m) => m.id));
  const stmt = env.DB.prepare(
    `INSERT INTO members (group_id, roblox_id, username, display_name, rank, role_name, updated_at) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(group_id, roblox_id) DO UPDATE SET rank=excluded.rank, role_name=excluded.role_name,
       username=COALESCE(excluded.username, members.username), display_name=COALESCE(excluded.display_name, members.display_name), updated_at=excluded.updated_at`
  );
  await batchAll(env, found.map((m) => { const n = names.get(m.id); return stmt.bind(group.id, m.id, n?.name ?? null, n?.displayName ?? null, m.role.rank, m.role.name, t); }));
  // Anyone we did not see is no longer in a tracked rank (kept for history, excluded from requirements).
  if (!truncated) await env.DB.prepare('UPDATE members SET rank=-1 WHERE group_id=? AND updated_at<? AND rank>=0').bind(group.id, t).run();
  return { synced: found.length, truncated };
}

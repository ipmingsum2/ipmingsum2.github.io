// Roster: departments (divisions/units), callsigns, and certifications (qualifications that can expire).
import { bad, json, now, str, int, readBody, logEvent } from './util.js';
import { resolveUser } from './roblox.js';

const COLOR = /^#[0-9a-f]{6}$/i;
const cleanColor = (c, d = '#5b8def') => (COLOR.test(String(c || '')) ? String(c).toLowerCase() : d);
export const certActive = (c, t = now()) => !c.revoked_at && (!c.expires_at || c.expires_at > t);
const splitUsers = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[\s,]+/)).map((x) => str(x, 40)).filter(Boolean).slice(0, 50);

// ---------- read ----------
/** Everything the roster page needs: departments, certification types, and every tracked member with callsign, departments and active certifications. */
export async function rosterData(env, gid) {
  const { DB } = env;
  const t = now();
  const [deps, links, calls, types, certs, mem] = await DB.batch([
    DB.prepare('SELECT * FROM departments WHERE group_id=? ORDER BY sort, name').bind(gid),
    DB.prepare('SELECT department_id, roblox_id FROM member_departments WHERE group_id=?').bind(gid),
    DB.prepare('SELECT roblox_id, callsign FROM roster WHERE group_id=?').bind(gid),
    DB.prepare('SELECT * FROM cert_types WHERE group_id=? ORDER BY name').bind(gid),
    DB.prepare('SELECT * FROM certifications WHERE group_id=? AND revoked_at IS NULL').bind(gid),
    DB.prepare('SELECT roblox_id, username, display_name, rank, role_name FROM members WHERE group_id=? AND rank>=0 ORDER BY rank DESC, username').bind(gid),
  ]);
  const callsign = new Map(calls.results.map((r) => [r.roblox_id, r.callsign]));
  const depOf = new Map();
  for (const l of links.results) { if (!depOf.has(l.roblox_id)) depOf.set(l.roblox_id, []); depOf.get(l.roblox_id).push(l.department_id); }
  const certOf = new Map();
  for (const c of certs.results.filter((x) => certActive(x, t))) { if (!certOf.has(c.roblox_id)) certOf.set(c.roblox_id, []); certOf.get(c.roblox_id).push({ id: c.id, certId: c.cert_id, expiresAt: c.expires_at, issuedAt: c.issued_at, issuedBy: c.issued_by }); }
  return {
    departments: deps.results.map((d) => ({ id: d.id, name: d.name, color: d.color, description: d.description || '', headId: d.head_roblox_id, headName: d.head_name, members: links.results.filter((l) => l.department_id === d.id).length })),
    certTypes: types.results.map((c) => ({ id: c.id, name: c.name, color: c.color, description: c.description || '', validDays: c.valid_days, holders: certs.results.filter((x) => x.cert_id === c.id && certActive(x, t)).length })),
    members: mem.results.map((m) => ({ robloxId: m.roblox_id, username: m.username || `User ${m.roblox_id}`, displayName: m.display_name || '', rank: m.rank, roleName: m.role_name || '', callsign: callsign.get(m.roblox_id) || '', departments: depOf.get(m.roblox_id) || [], certifications: certOf.get(m.roblox_id) || [] })),
  };
}
export const roster = async (c) => json(await rosterData(c.env, c.group.id));

/** Callsign, departments and certifications for one member (profile, API, games). */
export async function memberRosterInfo(env, gid, rid) {
  const { DB } = env;
  const t = now();
  const [call, deps, certs] = await DB.batch([
    DB.prepare('SELECT callsign FROM roster WHERE group_id=? AND roblox_id=?').bind(gid, rid),
    DB.prepare('SELECT d.id, d.name, d.color FROM member_departments m JOIN departments d ON d.id=m.department_id WHERE m.group_id=? AND m.roblox_id=? ORDER BY d.sort, d.name').bind(gid, rid),
    DB.prepare('SELECT c.*, t.name, t.color FROM certifications c JOIN cert_types t ON t.id=c.cert_id WHERE c.group_id=? AND c.roblox_id=? ORDER BY c.issued_at DESC LIMIT 100').bind(gid, rid),
  ]);
  return {
    callsign: call.results[0]?.callsign || '',
    departments: deps.results,
    certifications: certs.results.map((c) => ({ id: c.id, certId: c.cert_id, name: c.name, color: c.color, issuedAt: c.issued_at, issuedBy: c.issued_by, expiresAt: c.expires_at, revokedAt: c.revoked_at, note: c.note || '', active: certActive(c, t) })),
  };
}

/** GET /v1/groups/:gid/members/:rid/roster and /v1/game/member/:rid — what a bot or game needs to gate tools, doors or vehicles. */
export async function memberInfoApi(c) {
  const rid = str(c.params.rid, 20);
  if (!/^\d{1,15}$/.test(rid)) bad('User ID must be numeric');
  const m = await c.env.DB.prepare('SELECT username, rank, role_name FROM members WHERE group_id=? AND roblox_id=?').bind(c.group.id, rid).first();
  const info = await memberRosterInfo(c.env, c.group.id, rid);
  return json({
    robloxId: rid, username: m?.username || null, rank: m?.rank ?? null, roleName: m?.role_name || null, callsign: info.callsign,
    departments: info.departments.map((d) => d.name),
    certifications: info.certifications.filter((x) => x.active).map((x) => ({ name: x.name, issuedAt: x.issuedAt, expiresAt: x.expiresAt })),
  });
}

// ---------- departments ----------
async function deptFields(c, b) {
  const name = str(b.name, 60); if (!name) bad('Give the department a name');
  let head = null;
  if (str(b.head, 40)) head = await resolveUser(c.env, b.head, c.group.id);
  return { name, color: cleanColor(b.color), description: str(b.description, 300), headId: head?.id || null, headName: head?.name || null, sort: int(b.sort, 0, 999, 0) };
}
async function loadDept(env, id) { const d = await env.DB.prepare('SELECT * FROM departments WHERE id=?').bind(Number(id) || 0).first(); if (!d) bad('Department not found', 404); return d; }

export async function deptCreate(c) {
  const f = await deptFields(c, await readBody(c.req));
  const r = await c.env.DB.prepare('INSERT INTO departments (group_id, name, color, description, head_roblox_id, head_name, sort, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(c.group.id, f.name, f.color, f.description, f.headId, f.headName, f.sort, now()).run();
  await logEvent(c.env, c.ctx, { groupId: c.group.id, type: 'roster.department_created', actor: c.actor, summary: `${c.actor.name} created the ${f.name} department${f.headName ? ` (head: ${f.headName})` : ''}` });
  return json({ ok: true, id: r.meta.last_row_id });
}
export async function deptUpdate(c) {
  const d = await loadDept(c.env, c.params.id);
  c.group = await c.env.DB.prepare('SELECT * FROM groups WHERE id=?').bind(d.group_id).first();
  const f = await deptFields(c, await readBody(c.req));
  await c.env.DB.prepare('UPDATE departments SET name=?, color=?, description=?, head_roblox_id=?, head_name=?, sort=? WHERE id=?').bind(f.name, f.color, f.description, f.headId, f.headName, f.sort, d.id).run();
  await logEvent(c.env, c.ctx, { groupId: d.group_id, type: 'roster.department_updated', actor: c.actor, summary: `${c.actor.name} updated the ${f.name} department`, silent: true });
  return json({ ok: true });
}
export async function deptDelete(c) {
  const d = await loadDept(c.env, c.params.id);
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM member_departments WHERE department_id=?').bind(d.id), c.env.DB.prepare('DELETE FROM departments WHERE id=?').bind(d.id)]);
  await logEvent(c.env, c.ctx, { groupId: d.group_id, type: 'roster.department_deleted', actor: c.actor, summary: `${c.actor.name} deleted the ${d.name} department` });
  return json({ ok: true });
}

/** PUT /api/groups/:gid/members/:rid/roster {callsign, departments: [ids]} */
export async function memberRosterSave(c) {
  const rid = str(c.params.rid, 20);
  if (!/^\d{1,15}$/.test(rid)) bad('User ID must be numeric');
  const b = await readBody(c.req);
  const { DB } = c.env;
  const m = await DB.prepare('SELECT username FROM members WHERE group_id=? AND roblox_id=?').bind(c.group.id, rid).first();
  if (!m) bad('That person is not a tracked member of this group', 404);
  const callsign = str(b.callsign, 24);
  if (callsign) {
    const taken = await DB.prepare('SELECT roblox_id FROM roster WHERE group_id=? AND callsign=? COLLATE NOCASE AND roblox_id!=?').bind(c.group.id, callsign, rid).first();
    if (taken) bad(`Callsign ${callsign} is already used by someone else`, 409);
  }
  const valid = new Set((await DB.prepare('SELECT id FROM departments WHERE group_id=?').bind(c.group.id).all()).results.map((d) => d.id));
  const deps = [...new Set((Array.isArray(b.departments) ? b.departments : []).map(Number).filter((id) => valid.has(id)))];
  const t = now();
  await DB.batch([
    DB.prepare('INSERT INTO roster (group_id, roblox_id, callsign, updated_at) VALUES (?,?,?,?) ON CONFLICT(group_id, roblox_id) DO UPDATE SET callsign=excluded.callsign, updated_at=excluded.updated_at').bind(c.group.id, rid, callsign || null, t),
    DB.prepare('DELETE FROM member_departments WHERE group_id=? AND roblox_id=?').bind(c.group.id, rid),
    ...deps.map((id) => DB.prepare('INSERT INTO member_departments (group_id, department_id, roblox_id, added_at) VALUES (?,?,?,?)').bind(c.group.id, id, rid, t)),
  ]);
  await logEvent(c.env, c.ctx, { groupId: c.group.id, type: 'roster.member_updated', actor: c.actor, target: { id: rid, name: m.username }, summary: `${c.actor.name} updated ${m.username}'s roster entry${callsign ? ` (callsign ${callsign})` : ''}`, silent: true });
  return json({ ok: true });
}

// ---------- certifications ----------
async function loadCertType(env, id) { const t = await env.DB.prepare('SELECT * FROM cert_types WHERE id=?').bind(Number(id) || 0).first(); if (!t) bad('Certification not found', 404); return t; }
const certFields = (b) => { const name = str(b.name, 60); if (!name) bad('Give the certification a name'); return { name, color: cleanColor(b.color, '#2fa58a'), description: str(b.description, 300), validDays: int(b.validDays, 0, 3650, 0) }; };

export async function certTypeCreate(c) {
  const f = certFields(await readBody(c.req));
  const r = await c.env.DB.prepare('INSERT INTO cert_types (group_id, name, color, description, valid_days, created_at) VALUES (?,?,?,?,?,?)').bind(c.group.id, f.name, f.color, f.description, f.validDays, now()).run();
  await logEvent(c.env, c.ctx, { groupId: c.group.id, type: 'cert.type_created', actor: c.actor, summary: `${c.actor.name} created the ${f.name} certification${f.validDays ? ` (valid ${f.validDays} days)` : ''}` });
  return json({ ok: true, id: r.meta.last_row_id });
}
export async function certTypeUpdate(c) {
  const t = await loadCertType(c.env, c.params.id);
  const f = certFields(await readBody(c.req));
  await c.env.DB.prepare('UPDATE cert_types SET name=?, color=?, description=?, valid_days=? WHERE id=?').bind(f.name, f.color, f.description, f.validDays, t.id).run();
  return json({ ok: true });
}
export async function certTypeDelete(c) {
  const t = await loadCertType(c.env, c.params.id);
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM certifications WHERE cert_id=?').bind(t.id), c.env.DB.prepare('DELETE FROM cert_types WHERE id=?').bind(t.id)]);
  await logEvent(c.env, c.ctx, { groupId: t.group_id, type: 'cert.type_deleted', actor: c.actor, summary: `${c.actor.name} deleted the ${t.name} certification and its records` });
  return json({ ok: true });
}

/** POST /api/groups/:gid/certifications {certId, users: "name, name" | [ids], note} — awards (or renews) for up to 50 people. */
export async function certAward(c) {
  const b = await readBody(c.req);
  const type = await loadCertType(c.env, b.certId);
  if (type.group_id !== c.group.id) bad('Certification not found', 404);
  const users = splitUsers(b.users ?? b.user);
  if (!users.length) bad('Enter at least one Roblox username or ID');
  const note = str(b.note, 300);
  const t = now(), expires = type.valid_days ? t + type.valid_days * 86400 : null;
  const { DB } = c.env;
  const awarded = [], renewed = [], failed = [];
  for (const raw of users) {
    let u;
    try { u = await resolveUser(c.env, raw, c.group.id); } catch (e) { failed.push({ user: raw, error: e.message }); continue; }
    const cur = await DB.prepare('SELECT id, expires_at, revoked_at FROM certifications WHERE group_id=? AND cert_id=? AND roblox_id=? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1').bind(c.group.id, type.id, u.id).first();
    if (cur) { await DB.prepare('UPDATE certifications SET issued_at=?, issued_by=?, expires_at=?, note=? WHERE id=?').bind(t, c.actor.name, expires, note || null, cur.id).run(); renewed.push(u.name); }
    else { await DB.prepare('INSERT INTO certifications (group_id, cert_id, roblox_id, username, issued_by, issued_at, expires_at, note) VALUES (?,?,?,?,?,?,?,?)').bind(c.group.id, type.id, u.id, u.name, c.actor.name, t, expires, note || null).run(); awarded.push(u.name); }
  }
  const all = [...awarded, ...renewed];
  if (all.length) await logEvent(c.env, c.ctx, { groupId: c.group.id, type: 'cert.awarded', actor: c.actor, summary: `${c.actor.name} awarded ${type.name} to ${all.join(', ')}${renewed.length ? ` (${renewed.length} renewed)` : ''}${note ? ` — ${note}` : ''}` });
  return json({ ok: true, awarded, renewed, failed });
}

export async function certRevoke(c) {
  const x = await c.env.DB.prepare('SELECT c.*, t.name FROM certifications c JOIN cert_types t ON t.id=c.cert_id WHERE c.id=?').bind(Number(c.params.id) || 0).first();
  if (!x) bad('Record not found', 404);
  if (x.revoked_at) bad('Already revoked');
  await c.env.DB.prepare('UPDATE certifications SET revoked_at=?, revoked_by=? WHERE id=?').bind(now(), c.actor.name, x.id).run();
  await logEvent(c.env, c.ctx, { groupId: x.group_id, type: 'cert.revoked', actor: c.actor, target: { id: x.roblox_id, name: x.username }, summary: `${c.actor.name} revoked ${x.username}'s ${x.name} certification` });
  return json({ ok: true });
}

/** Members (ids) who currently hold a certification — used by auto-promotion rules. */
export async function holders(env, gid, certId) {
  const rows = (await env.DB.prepare('SELECT roblox_id, expires_at, revoked_at FROM certifications WHERE group_id=? AND cert_id=? AND revoked_at IS NULL').bind(gid, certId).all()).results;
  const t = now();
  return new Set(rows.filter((r) => certActive(r, t)).map((r) => r.roblox_id));
}

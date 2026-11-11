// Sign-in (Google + Discord OAuth), whitelist, dashboard users, API keys, account linking.
import { HttpError, bad, json, redirect, now, parseJSON, str, readBody, randHex, randCode, sha256, signToken, verifyToken, logEvent } from './util.js';

export const PERMISSIONS = ['manage_activity', 'ranking', 'manage_groups', 'manage_applications', 'review_applications', 'view_logs', 'manage_api_keys'];
export const SCOPES = ['read', 'ranking', 'timeoff', 'game', 'verify'];
const SESSION_TTL = 30 * 86400;

const dash = (env) => String(env.DASHBOARD_URL || '').replace(/\/+$/, '');
export const can = (user, perm) => user.role === 'owner' || user.permissions.includes(perm);
export const userActor = (u) => ({ type: 'user', id: u.id, name: u.name || u.google_email || u.discord_name || `User ${u.id}` });

const publicUser = (u) => ({
  id: u.id, name: u.name, role: u.role, permissions: u.role === 'owner' ? PERMISSIONS : u.permissions,
  googleEmail: u.google_email, discordId: u.discord_id, discordName: u.discord_name,
  robloxId: u.roblox_id, robloxName: u.roblox_name, lastLogin: u.last_login, createdAt: u.created_at,
});
const hydrate = (u) => (u ? { ...u, permissions: parseJSON(u.permissions, []) } : null);

/** The owner row always exists and always carries the configured owner identities. */
export async function ensureOwner(env) {
  const o = await env.DB.prepare("SELECT id FROM users WHERE role='owner'").first();
  if (o) return;
  await env.DB.prepare("INSERT INTO users (name, google_email, discord_id, roblox_id, role, permissions, created_at) VALUES ('Owner',?,?,?,'owner','[]',?)")
    .bind((env.OWNER_GOOGLE_EMAIL || '').toLowerCase() || null, env.OWNER_DISCORD_ID || null, env.OWNER_ROBLOX_ID || null, now()).run();
}

export async function getUser(req, env) {
  const m = /^Bearer\s+([a-f0-9]{64})$/.exec(req.headers.get('authorization') || '');
  if (!m) return null;
  const row = await env.DB.prepare(
    'SELECT u.* FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?'
  ).bind(await sha256(m[1]), now()).first();
  return hydrate(row);
}

async function createSession(env, userId) {
  const token = randHex(32);
  await env.DB.prepare('INSERT INTO auth_sessions (token_hash, user_id, expires) VALUES (?,?,?)').bind(await sha256(token), userId, now() + SESSION_TTL).run();
  return token;
}

// ---------- OAuth ----------
const PROVIDERS = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile', id: (e) => e.GOOGLE_CLIENT_ID, secret: (e) => e.GOOGLE_CLIENT_SECRET,
    async identity(accessToken) {
      const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${accessToken}` } });
      const d = await r.json();
      if (!r.ok || !d.email || d.email_verified === false) return null;
      return { id: String(d.sub), email: String(d.email).toLowerCase(), name: d.name || d.email };
    },
  },
  discord: {
    authUrl: 'https://discord.com/oauth2/authorize', tokenUrl: 'https://discord.com/api/oauth2/token',
    scope: 'identify', id: (e) => e.DISCORD_CLIENT_ID, secret: (e) => e.DISCORD_CLIENT_SECRET,
    async identity(accessToken) {
      const r = await fetch('https://discord.com/api/users/@me', { headers: { authorization: `Bearer ${accessToken}` } });
      const d = await r.json();
      if (!r.ok || !d.id) return null;
      return { id: String(d.id), name: d.global_name || d.username };
    },
  },
};

const callbackUrl = (req, provider) => `${new URL(req.url).origin}/auth/${provider}/callback`;

async function authorizeUrl(req, env, provider, purpose, userId, returnTo) {
  const p = PROVIDERS[provider];
  if (!p) bad('Unknown provider', 404);
  if (!p.id(env) || !p.secret(env)) bad(`${provider} sign-in is not configured on the Worker`, 500);
  const state = randHex(24);
  await env.DB.prepare('INSERT INTO oauth_states (state, provider, purpose, user_id, return_to, expires) VALUES (?,?,?,?,?,?)')
    .bind(state, provider, purpose, userId, returnTo, now() + 600).run();
  const q = new URLSearchParams({ client_id: p.id(env), redirect_uri: callbackUrl(req, provider), response_type: 'code', scope: p.scope, state, prompt: provider === 'google' ? 'select_account' : 'none' });
  if (provider === 'discord') q.delete('prompt');
  return `${p.authUrl}?${q}`;
}

/** GET /auth/:provider/start?purpose=login|public&return=verify.html */
export async function authStart(c) {
  const provider = c.params.provider;
  const purpose = c.q.get('purpose') === 'public' ? 'public' : 'login';
  if (purpose === 'public' && provider !== 'discord') bad('Public sign-in uses Discord');
  let ret = c.q.get('return') || '';
  // Only our own public pages may be returned to — never an arbitrary URL.
  if (!/^(verify\.html|apply\.html\?id=[A-Za-z0-9_-]{1,40})$/.test(ret)) ret = purpose === 'public' ? 'verify.html' : '';
  return redirect(await authorizeUrl(c.req, c.env, provider, purpose, null, ret));
}

/** POST /api/auth/link {provider} → {url}; the signed-in user attaches another identity. */
export async function linkStart(c) {
  const { provider } = await readBody(c.req);
  return json({ url: await authorizeUrl(c.req, c.env, provider, 'link', c.user.id, '') });
}

export async function authCallback(c) {
  const { env, ctx, req } = c;
  const provider = c.params.provider;
  const p = PROVIDERS[provider];
  const home = `${dash(env)}/app.html`;
  const fail = (code, page = home) => redirect(`${page}#error=${encodeURIComponent(code)}`);
  if (!p) return fail('unknown_provider');

  const st = await env.DB.prepare('SELECT * FROM oauth_states WHERE state=? AND provider=?').bind(c.q.get('state') || '', provider).first();
  if (!st) return fail('invalid_state');
  await env.DB.prepare('DELETE FROM oauth_states WHERE state=?').bind(st.state).run();
  const page = st.purpose === 'public' ? `${dash(env)}/${st.return_to || 'verify.html'}` : home;
  if (st.expires < now()) return fail('expired', page);
  const code = c.q.get('code');
  if (!code) return fail('cancelled', page);

  let ident = null;
  try {
    const tr = await fetch(p.tokenUrl, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: p.id(env), client_secret: p.secret(env), grant_type: 'authorization_code', code, redirect_uri: callbackUrl(req, provider) }),
    });
    const tok = await tr.json();
    if (tr.ok && tok.access_token) ident = await p.identity(tok.access_token);
  } catch { /* falls through to failure */ }
  if (!ident) return fail('provider_error', page);

  // Public identity (verify / apply pages): no dashboard access, just proves a Discord account.
  if (st.purpose === 'public') {
    const t = await signToken(env, { d: ident.id, n: ident.name, exp: now() + 2 * 3600 });
    return redirect(`${page}#ptoken=${t}`);
  }

  await ensureOwner(env);
  const col = provider === 'google' ? 'google_email' : 'discord_id';
  const val = provider === 'google' ? ident.email : ident.id;
  const existing = hydrate(await env.DB.prepare(`SELECT * FROM users WHERE ${col}=?`).bind(val).first());

  if (st.purpose === 'link') {
    const me = hydrate(await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(st.user_id).first());
    if (!me) return fail('invalid_state');
    if (existing && existing.id !== me.id) return redirect(`${home}?link_error=in_use#/account`);
    await saveIdentity(env, me.id, provider, ident);
    await logEvent(env, ctx, { type: 'link.account', actor: userActor(me), summary: `${userActor(me).name} linked ${provider} account ${provider === 'google' ? ident.email : `${ident.name} (${ident.id})`}` });
    return redirect(`${home}?linked=${provider}#/account`);
  }

  if (!existing) {
    await logEvent(env, ctx, { type: 'auth.denied', actor: { type: 'public', id: val, name: ident.name }, summary: `Sign-in denied (not whitelisted): ${provider} ${val}` });
    return fail('not_whitelisted');
  }
  await saveIdentity(env, existing.id, provider, ident);
  await env.DB.prepare('UPDATE users SET last_login=? WHERE id=?').bind(now(), existing.id).run();
  await logEvent(env, ctx, { type: 'auth.login', actor: userActor(existing), summary: `${userActor(existing).name} signed in with ${provider}` });
  return redirect(`${home}#token=${await createSession(env, existing.id)}`);
}

async function saveIdentity(env, userId, provider, ident) {
  if (provider === 'google') {
    await env.DB.prepare('UPDATE users SET google_email=?, google_sub=?, name=COALESCE(NULLIF(name,\'\'), ?) WHERE id=?').bind(ident.email, ident.id, ident.name, userId).run();
  } else {
    await env.DB.prepare('UPDATE users SET discord_id=?, discord_name=?, name=COALESCE(NULLIF(name,\'\'), ?) WHERE id=?').bind(ident.id, ident.name, ident.name, userId).run();
    // Discord already verified in-game → carry the Roblox account over to the dashboard user.
    const link = await env.DB.prepare('SELECT roblox_id, roblox_name FROM links WHERE discord_id=?').bind(ident.id).first();
    if (link) await setUserRoblox(env, userId, link.roblox_id, link.roblox_name);
  }
}

async function setUserRoblox(env, userId, robloxId, robloxName) {
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET roblox_id=NULL, roblox_name=NULL WHERE roblox_id=? AND id!=?').bind(robloxId, userId),
    env.DB.prepare('UPDATE users SET roblox_id=?, roblox_name=? WHERE id=?').bind(robloxId, robloxName, userId),
  ]);
}

/** Local development only: sign in as the owner without OAuth. Requires DEV_LOGIN=1 and a localhost request. */
export async function devLogin(c) {
  const host = new URL(c.req.url).hostname;
  if (c.env.DEV_LOGIN !== '1' || !['localhost', '127.0.0.1'].includes(host)) bad('Not found', 404);
  await ensureOwner(c.env);
  const o = await c.env.DB.prepare("SELECT id FROM users WHERE role='owner'").first();
  return json({ token: await createSession(c.env, o.id) });
}

export const me = (c) => json({ user: publicUser(c.user), permissions: PERMISSIONS, scopes: SCOPES });

export async function logout(c) {
  const m = /^Bearer\s+([a-f0-9]{64})$/.exec(c.req.headers.get('authorization') || '');
  if (m) await c.env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await sha256(m[1])).run();
  return json({ ok: true });
}

export async function unlink(c) {
  const { provider } = await readBody(c.req);
  const u = c.user;
  if (provider === 'google') {
    if (!u.discord_id) bad('Link Discord first — you need at least one way to sign in');
    await c.env.DB.prepare('UPDATE users SET google_email=NULL, google_sub=NULL WHERE id=?').bind(u.id).run();
  } else if (provider === 'discord') {
    if (!u.google_email) bad('Link Google first — you need at least one way to sign in');
    await c.env.DB.prepare('UPDATE users SET discord_id=NULL, discord_name=NULL WHERE id=?').bind(u.id).run();
  } else if (provider === 'roblox') {
    await c.env.DB.prepare('UPDATE users SET roblox_id=NULL, roblox_name=NULL WHERE id=?').bind(u.id).run();
  } else bad('Unknown provider');
  await logEvent(c.env, c.ctx, { type: 'link.removed', actor: c.actor, summary: `${c.actor.name} unlinked their ${provider} account` });
  return json({ ok: true });
}

// ---------- whitelist / dashboard users (owner only) ----------
function identityFields(b) {
  const email = str(b.googleEmail, 120).toLowerCase();
  const discord = str(b.discordId, 25);
  const roblox = str(b.robloxId, 20);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad('Google email is not a valid email address');
  if (discord && !/^\d{15,21}$/.test(discord)) bad('Discord ID must be the numeric user ID (15–21 digits)');
  if (roblox && !/^\d{1,15}$/.test(roblox)) bad('Roblox ID must be numeric');
  if (!email && !discord) bad('Give a Google email or a Discord ID so this person can sign in');
  return { email: email || null, discord: discord || null, roblox: roblox || null };
}
const cleanPerms = (p) => (Array.isArray(p) ? PERMISSIONS.filter((x) => p.includes(x)) : []);
const uniqueGuard = (e) => { if (/UNIQUE/i.test(String(e?.message))) bad('Another whitelisted user already has that Google email, Discord ID or Roblox ID', 409); throw e; };

export async function listUsers(c) {
  await ensureOwner(c.env);
  const rows = (await c.env.DB.prepare("SELECT * FROM users ORDER BY role='owner' DESC, id").all()).results;
  return json({ users: rows.map((u) => publicUser(hydrate(u))) });
}

export async function createUser(c) {
  const b = await readBody(c.req);
  const f = identityFields(b);
  const perms = cleanPerms(b.permissions);
  const name = str(b.name, 60);
  try {
    await c.env.DB.prepare('INSERT INTO users (name, google_email, discord_id, roblox_id, role, permissions, created_at) VALUES (?,?,?,?,\'member\',?,?)')
      .bind(name || null, f.email, f.discord, f.roblox, JSON.stringify(perms), now()).run();
  } catch (e) { uniqueGuard(e); }
  await logEvent(c.env, c.ctx, { type: 'access.granted', actor: c.actor, target: { id: f.email || f.discord, name }, summary: `${c.actor.name} whitelisted ${name || f.email || f.discord} (${perms.join(', ') || 'view only'})`, details: { ...f, permissions: perms } });
  return json({ ok: true });
}

export async function updateUser(c) {
  const id = Number(c.params.id);
  const target = hydrate(await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first());
  if (!target) bad('User not found', 404);
  if (target.role === 'owner') bad('The owner account is managed from wrangler.toml and the Account page, not the whitelist', 403);
  const b = await readBody(c.req);
  const f = identityFields(b);
  const perms = cleanPerms(b.permissions);
  const name = str(b.name, 60);
  try {
    await c.env.DB.prepare('UPDATE users SET name=?, google_email=?, discord_id=?, roblox_id=?, permissions=? WHERE id=?')
      .bind(name || null, f.email, f.discord, f.roblox, JSON.stringify(perms), id).run();
  } catch (e) { uniqueGuard(e); }
  await logEvent(c.env, c.ctx, { type: 'access.updated', actor: c.actor, target: { id, name }, summary: `${c.actor.name} updated access for ${name || f.email || f.discord} (${perms.join(', ') || 'view only'})`, details: { ...f, permissions: perms } });
  return json({ ok: true });
}

export async function deleteUser(c) {
  const id = Number(c.params.id);
  const target = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first();
  if (!target) bad('User not found', 404);
  if (target.role === 'owner') bad('The owner cannot be removed', 403);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM auth_sessions WHERE user_id=?').bind(id),
    c.env.DB.prepare('DELETE FROM users WHERE id=?').bind(id),
  ]);
  const label = target.name || target.google_email || target.discord_id;
  await logEvent(c.env, c.ctx, { type: 'access.revoked', actor: c.actor, target: { id, name: label }, summary: `${c.actor.name} removed ${label} from the whitelist` });
  return json({ ok: true });
}

// ---------- API keys ----------
export async function getApiKey(req, env, ctx) {
  const raw = req.headers.get('x-api-key') || (/^Bearer\s+(rpk_[a-f0-9]+)$/.exec(req.headers.get('authorization') || '') || [])[1];
  if (!raw || !raw.startsWith('rpk_')) return null;
  const k = await env.DB.prepare('SELECT * FROM api_keys WHERE key_hash=? AND revoked=0').bind(await sha256(raw)).first();
  if (!k) return null;
  if (!k.last_used || now() - k.last_used > 300) ctx.waitUntil(env.DB.prepare('UPDATE api_keys SET last_used=? WHERE id=?').bind(now(), k.id).run());
  return { ...k, scopes: parseJSON(k.scopes, []) };
}

export async function listKeys(c) {
  const rows = (await c.env.DB.prepare('SELECT id, name, prefix, group_id, scopes, created_by, created_at, last_used FROM api_keys WHERE revoked=0 ORDER BY id DESC').all()).results;
  return json({ keys: rows.map((k) => ({ ...k, scopes: parseJSON(k.scopes, []) })) });
}

export async function createKey(c) {
  const b = await readBody(c.req);
  const name = str(b.name, 60);
  if (!name) bad('Give the key a name');
  const scopes = Array.isArray(b.scopes) ? SCOPES.filter((s) => b.scopes.includes(s)) : [];
  if (!scopes.length) bad('Pick at least one scope');
  const groupId = str(b.groupId, 20) || null;
  if (groupId && !(await c.env.DB.prepare('SELECT id FROM groups WHERE id=?').bind(groupId).first())) bad('Group not found', 404);
  if (scopes.includes('game') && !groupId) bad('A key with the "game" scope must be tied to one group');
  const key = `rpk_${randHex(24)}`;
  await c.env.DB.prepare('INSERT INTO api_keys (name, key_hash, prefix, group_id, scopes, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(name, await sha256(key), key.slice(0, 12), groupId, JSON.stringify(scopes), c.actor.name, now()).run();
  await logEvent(c.env, c.ctx, { groupId, type: 'apikey.created', actor: c.actor, summary: `${c.actor.name} created API key "${name}" (${scopes.join(', ')})` });
  return json({ key });
}

export async function revokeKey(c) {
  const k = await c.env.DB.prepare('SELECT * FROM api_keys WHERE id=? AND revoked=0').bind(Number(c.params.id)).first();
  if (!k) bad('Key not found', 404);
  await c.env.DB.prepare('UPDATE api_keys SET revoked=1 WHERE id=?').bind(k.id).run();
  await logEvent(c.env, c.ctx, { groupId: k.group_id, type: 'apikey.revoked', actor: c.actor, summary: `${c.actor.name} revoked API key "${k.name}"` });
  return json({ ok: true });
}

// ---------- Discord ↔ Roblox linking (code shown on the site, typed in the Roblox game) ----------
export async function publicIdentity(c) {
  const t = await verifyToken(c.env, c.req.headers.get('x-public-token') || '');
  return t ? { discordId: String(t.d), discordName: String(t.n || '') } : null;
}

async function issueCode(env, { discordId = null, discordName = null, userId = null }) {
  if (discordId) await env.DB.prepare('DELETE FROM verify_codes WHERE discord_id=?').bind(discordId).run();
  if (userId) await env.DB.prepare('DELETE FROM verify_codes WHERE user_id=?').bind(userId).run();
  const code = randCode(6);
  await env.DB.prepare('INSERT INTO verify_codes (code, discord_id, discord_name, user_id, expires) VALUES (?,?,?,?,?)').bind(code, discordId, discordName, userId, now() + 900).run();
  return { code, expiresIn: 900 };
}

/** POST /api/me/verify-code — a dashboard user links their own Roblox account. */
export async function myVerifyCode(c) {
  return json(await issueCode(c.env, { discordId: c.user.discord_id, discordName: c.user.discord_name, userId: c.user.id }));
}

/** GET /public/link — current link for the signed-in Discord account. */
export async function publicLink(c) {
  const idn = await publicIdentity(c);
  if (!idn) bad('Sign in with Discord first', 401);
  const link = await c.env.DB.prepare('SELECT roblox_id, roblox_name, linked_at FROM links WHERE discord_id=?').bind(idn.discordId).first();
  return json({ discord: idn, link: link ? { robloxId: link.roblox_id, robloxName: link.roblox_name, linkedAt: link.linked_at } : null });
}

export async function publicVerifyCode(c) {
  const idn = await publicIdentity(c);
  if (!idn) bad('Sign in with Discord first', 401);
  return json(await issueCode(c.env, idn));
}

/** POST /v1/game/verify {code, userId, username} — called by the Roblox verification game. */
export async function gameVerify(c) {
  const b = await readBody(c.req);
  const code = str(b.code, 12).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const robloxId = str(b.userId, 20);
  const robloxName = str(b.username, 40);
  if (!/^\d{1,15}$/.test(robloxId)) bad('userId is required');
  const row = await c.env.DB.prepare('SELECT * FROM verify_codes WHERE code=? AND expires>?').bind(code, now()).first();
  if (!row) return json({ ok: false, error: 'That code is invalid or has expired.' }, 404);
  const { DB } = c.env;
  const stmts = [DB.prepare('DELETE FROM verify_codes WHERE code=?').bind(code)];
  if (row.discord_id) {
    stmts.push(
      DB.prepare('DELETE FROM links WHERE discord_id=? OR roblox_id=?').bind(row.discord_id, robloxId),
      DB.prepare('INSERT INTO links (discord_id, discord_name, roblox_id, roblox_name, linked_at) VALUES (?,?,?,?,?)').bind(row.discord_id, row.discord_name, robloxId, robloxName, now()),
    );
  }
  await DB.batch(stmts);
  const dashUser = row.user_id
    ? await DB.prepare('SELECT id FROM users WHERE id=?').bind(row.user_id).first()
    : row.discord_id ? await DB.prepare('SELECT id FROM users WHERE discord_id=?').bind(row.discord_id).first() : null;
  if (dashUser) await setUserRoblox(c.env, dashUser.id, robloxId, robloxName);
  await logEvent(c.env, c.ctx, {
    type: 'link.roblox', actor: c.actor, target: { id: robloxId, name: robloxName },
    summary: `Roblox ${robloxName} (${robloxId}) linked to ${row.discord_id ? `Discord ${row.discord_name || ''} (${row.discord_id})` : `dashboard user #${row.user_id}`}`,
  });
  return json({ ok: true, discordName: row.discord_name || null });
}

export async function listLinks(c) {
  const q = `%${str(c.q.get('q'), 40)}%`;
  const rows = (await c.env.DB.prepare(
    'SELECT * FROM links WHERE discord_id LIKE ?1 OR roblox_id LIKE ?1 OR roblox_name LIKE ?1 OR discord_name LIKE ?1 ORDER BY linked_at DESC LIMIT 200'
  ).bind(q).all()).results;
  return json({ links: rows });
}

export async function deleteLink(c) {
  const l = await c.env.DB.prepare('SELECT * FROM links WHERE discord_id=?').bind(c.params.id).first();
  if (!l) bad('Link not found', 404);
  await c.env.DB.prepare('DELETE FROM links WHERE discord_id=?').bind(l.discord_id).run();
  await logEvent(c.env, c.ctx, { type: 'link.removed', actor: c.actor, target: { id: l.roblox_id, name: l.roblox_name }, summary: `${c.actor.name} removed the link between Discord ${l.discord_id} and Roblox ${l.roblox_name} (${l.roblox_id})` });
  return json({ ok: true });
}

export const linkLookup = async (c, col) => {
  const l = await c.env.DB.prepare(`SELECT * FROM links WHERE ${col}=?`).bind(c.params.id).first();
  if (!l) throw new HttpError(404, 'No link found');
  return json({ discordId: l.discord_id, discordName: l.discord_name, robloxId: l.roblox_id, robloxName: l.roblox_name, linkedAt: l.linked_at });
};

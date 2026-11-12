// Shared helpers: responses, crypto, dates, Discord webhooks, audit logging.

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Api-Key,X-Public-Token',
  'Access-Control-Max-Age': '86400',
};

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = (message, status = 400) => { throw new HttpError(status, message); };
export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });
export const redirect = (url) => new Response(null, { status: 302, headers: { location: url } });
export const now = () => Math.floor(Date.now() / 1000);
export const parseJSON = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
export const str = (v, max = 200) => (v == null ? '' : String(v)).trim().slice(0, max);
export const int = (v, min, max, d = 0) => { if (v == null || v === '') return d; const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };

export async function readBody(req) {
  let b = null;
  try { b = await req.json(); } catch { /* handled below */ }
  if (!b || typeof b !== 'object') bad('Invalid JSON body');
  return b;
}

// ---------- crypto ----------
const enc = new TextEncoder();
const dec = new TextDecoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const toB64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64u = (bytes) => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/'));

export const randHex = (n = 32) => hex(crypto.getRandomValues(new Uint8Array(n)));
export function randCode(len = 6) {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(len))].map((x) => a[x % a.length]).join('');
}
export async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }

function secret(env) {
  if (!env.SECRET_KEY || env.SECRET_KEY.length < 16) throw new HttpError(500, 'SECRET_KEY is not configured on the Worker');
  return env.SECRET_KEY;
}
async function hmac(env, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}
/** Stateless signed token (used for public Discord identity on apply/verify pages). */
export async function signToken(env, payload) {
  const p = b64u(enc.encode(JSON.stringify(payload)));
  return `${p}.${await hmac(env, p)}`;
}
export async function verifyToken(env, token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [p, sig] = token.split('.');
  const want = await hmac(env, p);
  if (sig.length !== want.length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= sig.charCodeAt(i) ^ want.charCodeAt(i);
  if (diff) return null;
  const data = parseJSON(dec.decode(unb64u(p)), null);
  return data && data.exp > now() ? data : null;
}
async function aesKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('enc:' + secret(env)));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encrypt(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(text)));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return toB64(out);
}
export async function decrypt(env, b64) {
  const raw = fromB64(b64);
  try {
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await aesKey(env), raw.slice(12)));
  } catch { throw new HttpError(500, 'Could not decrypt the stored Open Cloud key (did SECRET_KEY change?). Re-enter the key in Groups.'); }
}

// ---------- dates (all UTC) ----------
export const dayStr = (ts = now()) => new Date(ts * 1000).toISOString().slice(0, 10);
export const addDays = (day, n) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** Monday of the week containing `day`. */
export const weekStartOf = (day) => addDays(day, -((new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7));
export const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
export const fmtDur = (sec) => { const m = Math.round(sec / 60); const h = Math.floor(m / 60); return h ? `${h}h ${m % 60}m` : `${m}m`; };

// ---------- Discord webhooks ----------
export const isWebhook = (u) =>
  typeof u === 'string' && /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(u);
/** '' is allowed (clears it); anything else must be a real Discord webhook URL. */
export const cleanWebhook = (u) => { const s = str(u, 300); if (s && !isWebhook(s)) bad('Webhook must be a Discord webhook URL (https://discord.com/api/webhooks/...)'); return s; };
/** `query` is appended after validation (e.g. 'with_components=true' so plain webhooks may send link buttons). */
export async function sendWebhook(url, payload, query = '') {
  if (!isWebhook(url)) return false;
  try {
    const r = await fetch(query ? `${url}?${query}` : url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }) });
    return r.ok;
  } catch { return false; }
}

// ---------- audit log ----------
const LOG_COLORS = { rank: 0x5b8def, requirement: 0xe5484d, timeoff: 0xe2a336, application: 0x8e6fd8, auth: 0x6b7280, access: 0xd9534f, group: 0x2fa58a, link: 0x2fa58a };
export const SYSTEM = { type: 'system', id: null, name: 'System' };

/**
 * Writes one audit log row, and mirrors it to the group's log webhook if one is set.
 * `silent` skips the webhook (used for bulk rows that are summarised separately).
 */
export async function logEvent(env, ctx, { groupId = null, type, actor = SYSTEM, target = null, summary = '', details = null, silent = false }) {
  const t = now();
  await env.DB.prepare(
    'INSERT INTO logs (ts, group_id, type, actor_type, actor_id, actor_name, target_id, target_name, summary, details) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(t, groupId, type, actor.type, actor.id == null ? null : String(actor.id), actor.name || null,
    target?.id == null ? null : String(target.id), target?.name || null, summary, details ? JSON.stringify(details) : null).run();
  if (silent || !groupId) return;
  const g = await env.DB.prepare('SELECT settings FROM groups WHERE id=?').bind(groupId).first();
  const url = parseJSON(g?.settings, {}).logWebhook;
  if (!isWebhook(url)) return;
  const p = sendWebhook(url, { embeds: [{ title: type, description: summary.slice(0, 3900), color: LOG_COLORS[type.split('.')[0]] ?? 0x6b7280, footer: { text: `by ${actor.name || actor.type}` }, timestamp: new Date(t * 1000).toISOString() }] });
  if (ctx?.waitUntil) ctx.waitUntil(p); else await p;
}

/** Runs D1 statements in chunks so large batches stay under limits. */
export async function batchAll(env, stmts, size = 40) {
  for (let i = 0; i < stmts.length; i += size) await env.DB.batch(stmts.slice(i, i + size));
}

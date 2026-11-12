// Access requests: someone who signs in but isn't whitelisted fills in the owner's form; the owner approves or denies.
import { bad, json, now, parseJSON, str, readBody, signToken, verifyToken, cleanWebhook, logEvent } from './util.js';
import { cleanQuestions, gradeAndValidate, answerFields, notify } from './apps.js';
import { PERMISSIONS } from './auth.js';

const TOKEN_TTL = 2 * 3600;
const RETRY_AFTER = 24 * 3600; // after a denial, wait this long before asking again
const MAX_PENDING_TOTAL = 500; // stops a flood of requests from new throwaway accounts

export const DEFAULT_FORM = {
  enabled: true,
  intro: 'This dashboard is invite-only. Tell the owner who you are and why you need access.',
  webhookUrl: '',
  questions: [
    { id: 'who', type: 'short', label: 'Your Roblox username', description: '', required: true },
    { id: 'group', type: 'short', label: 'Which group are you staff in, and what is your rank?', description: '', required: true },
    { id: 'why', type: 'paragraph', label: 'Why do you need access to the dashboard?', description: '', required: true },
  ],
};

// ---------- form config (stored in app_settings) ----------
export async function loadForm(env) {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key='access_form'").first();
  return { ...DEFAULT_FORM, ...parseJSON(row?.value, {}) };
}
const ungraded = (qs) => qs.map(({ points, correct, ...q }) => q);

export async function formGet(c) { return json({ form: await loadForm(c.env) }); }

export async function formSave(c) {
  const b = await readBody(c.req);
  const prev = await loadForm(c.env);
  const questions = ungraded(cleanQuestions(b.questions || []));
  if (b.enabled && !questions.some((q) => q.type !== 'section')) bad('Add at least one question, or turn access requests off');
  const form = {
    enabled: !!b.enabled,
    intro: str(b.intro, 1000),
    webhookUrl: b.webhookUrl === '(hidden)' ? prev.webhookUrl : cleanWebhook(b.webhookUrl),
    questions,
  };
  await c.env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('access_form', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(form)).run();
  await logEvent(c.env, c.ctx, { type: 'access.form_updated', actor: c.actor, summary: `${c.actor.name} ${form.enabled ? 'updated the access request form' : 'turned access requests off'} (${questions.filter((q) => q.type !== 'section').length} questions)` });
  return json({ ok: true });
}

// ---------- identity token (issued by the OAuth callback when an account isn't whitelisted) ----------
/** `k: 'access'` keeps this token from ever being accepted as a public Discord identity (see auth.publicIdentity). */
export const accessToken = (env, provider, ident) =>
  signToken(env, { k: 'access', p: provider, i: provider === 'google' ? ident.email : ident.id, n: ident.name || '', exp: now() + TOKEN_TTL });

async function identity(c) {
  const t = await verifyToken(c.env, c.req.headers.get('x-access-token') || '');
  if (!t || t.k !== 'access' || !['google', 'discord'].includes(t.p) || !t.i) bad('Your sign-in for this request expired. Sign in again to continue.', 401);
  return { provider: t.p, id: String(t.i), name: String(t.n || '') };
}
const idCol = (p) => (p === 'google' ? 'google_email' : 'discord_id');
const label = (r) => r.name || r.google_email || r.discord_name || r.discord_id;

/** GET /public/access-request — the form plus this identity's latest request. */
export async function publicGet(c) {
  const who = await identity(c);
  const form = await loadForm(c.env);
  const whitelisted = !!(await c.env.DB.prepare(`SELECT 1 FROM users WHERE ${idCol(who.provider)}=?`).bind(who.id).first());
  const last = await c.env.DB.prepare(`SELECT id, status, review_note, created_at, reviewed_at FROM access_requests WHERE provider=? AND ${idCol(who.provider)}=? ORDER BY id DESC LIMIT 1`).bind(who.provider, who.id).first();
  return json({
    identity: who, whitelisted, enabled: form.enabled,
    form: form.enabled ? { intro: form.intro, questions: form.questions } : null,
    request: last ? { ...last, retryAt: last.status === 'denied' ? (last.reviewed_at || last.created_at) + RETRY_AFTER : null } : null,
  });
}

/** POST /public/access-request {answers} */
export async function publicSubmit(c) {
  const who = await identity(c);
  const form = await loadForm(c.env);
  if (!form.enabled) bad('Access requests are closed. Ask the owner directly.', 403);
  const { DB } = c.env;
  if (await DB.prepare(`SELECT 1 FROM users WHERE ${idCol(who.provider)}=?`).bind(who.id).first()) bad('You already have access — sign in again.', 409);
  const last = await DB.prepare(`SELECT * FROM access_requests WHERE provider=? AND ${idCol(who.provider)}=? ORDER BY id DESC LIMIT 1`).bind(who.provider, who.id).first();
  if (last?.status === 'pending') bad('You already have a request waiting for the owner.', 409);
  if (last?.status === 'denied' && (last.reviewed_at || last.created_at) + RETRY_AFTER > now()) bad('Your last request was denied. You can ask again 24 hours after it was reviewed.', 429);
  if ((await DB.prepare("SELECT COUNT(*) n FROM access_requests WHERE status='pending'").first()).n >= MAX_PENDING_TOTAL) bad('Too many requests are waiting right now. Try again later.', 429);
  const b = await readBody(c.req);
  const { answers } = gradeAndValidate(form.questions, b.answers);
  const t = now();
  const r = await DB.prepare('INSERT INTO access_requests (provider, google_email, discord_id, name, answers, created_at) VALUES (?,?,?,?,?,?)')
    .bind(who.provider, who.provider === 'google' ? who.id : null, who.provider === 'discord' ? who.id : null, str(who.name, 80) || null, JSON.stringify(answers), t).run();
  const id = r.meta.last_row_id;
  const shown = who.provider === 'google' ? who.id : `${who.name} (${who.id})`;
  await logEvent(c.env, c.ctx, { type: 'access.requested', actor: { type: 'public', id: who.id, name: who.name || who.id }, summary: `${who.name || who.id} requested dashboard access (${who.provider}: ${shown})`, details: { requestId: id } });
  if (form.webhookUrl) {
    const link = `${String(c.env.DASHBOARD_URL || '').replace(/\/+$/, '')}/app.html#/go/owner/requests/${id}`;
    c.ctx.waitUntil(notify(form.webhookUrl, {
      title: 'New access request', url: link, color: 0x5b8def,
      description: `**${who.name || who.id}** asked for dashboard access.\n${who.provider === 'google' ? `Google: ${who.id}` : `Discord: <@${who.id}> (${who.id})`}`,
      fields: answerFields(form.questions, answers), footer: { text: 'Review to approve or deny' }, timestamp: new Date().toISOString(),
    }, [{ label: 'Review', url: link }]));
  }
  return json({ ok: true, id });
}

// ---------- owner review ----------
const view = (r) => ({ ...r, answers: parseJSON(r.answers, {}) });

export async function list(c) {
  const status = ['pending', 'approved', 'denied'].includes(c.q.get('status')) ? c.q.get('status') : 'pending';
  const [rows, counts] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM access_requests WHERE status=? ORDER BY id DESC LIMIT 300').bind(status),
    c.env.DB.prepare('SELECT status, COUNT(*) n FROM access_requests GROUP BY status'),
  ]);
  return json({ requests: rows.results.map(view), counts: Object.fromEntries(counts.results.map((x) => [x.status, x.n])), questions: (await loadForm(c.env)).questions });
}

export async function get(c) {
  const r = await c.env.DB.prepare('SELECT * FROM access_requests WHERE id=?').bind(Number(c.params.id) || 0).first();
  if (!r) bad('Request not found', 404);
  const col = r.provider === 'google' ? 'google_email' : 'discord_id';
  const user = await c.env.DB.prepare(`SELECT id, name FROM users WHERE ${col}=?`).bind(r[col]).first();
  const history = (await c.env.DB.prepare(`SELECT id, status, created_at FROM access_requests WHERE ${col}=? AND id!=? ORDER BY id DESC LIMIT 10`).bind(r[col], r.id).all()).results;
  return json({ request: view(r), questions: (await loadForm(c.env)).questions, whitelistedAs: user || null, history });
}

/** PATCH /api/access-requests/:id {status: approved|denied, note, name, permissions} */
export async function decide(c) {
  const { DB } = c.env;
  const r = await DB.prepare('SELECT * FROM access_requests WHERE id=?').bind(Number(c.params.id) || 0).first();
  if (!r) bad('Request not found', 404);
  if (r.status !== 'pending') bad('This request has already been decided');
  const b = await readBody(c.req);
  if (!['approved', 'denied'].includes(b.status)) bad('status must be approved or denied');
  const note = str(b.note, 500);
  const who = label(r);
  let perms = [];
  if (b.status === 'approved') {
    perms = Array.isArray(b.permissions) ? PERMISSIONS.filter((p) => b.permissions.includes(p)) : [];
    const name = str(b.name, 60) || r.name || null;
    const col = r.provider === 'google' ? 'google_email' : 'discord_id';
    const exists = await DB.prepare(`SELECT id FROM users WHERE ${col}=?`).bind(r[col]).first();
    if (!exists) {
      await DB.prepare('INSERT INTO users (name, google_email, discord_id, discord_name, role, permissions, created_at) VALUES (?,?,?,?,\'member\',?,?)')
        .bind(name, r.google_email, r.discord_id, r.provider === 'discord' ? r.name : null, JSON.stringify(perms), now()).run();
      await logEvent(c.env, c.ctx, { type: 'access.granted', actor: c.actor, target: { id: r.google_email || r.discord_id, name: name || who }, summary: `${c.actor.name} whitelisted ${name || who} from an access request (${perms.join(', ') || 'view only'})`, details: { requestId: r.id, permissions: perms } });
    }
  }
  await DB.prepare('UPDATE access_requests SET status=?, review_note=?, reviewer=?, reviewed_at=? WHERE id=?').bind(b.status, note || null, c.actor.name, now(), r.id).run();
  await logEvent(c.env, c.ctx, { type: `access.request_${b.status}`, actor: c.actor, target: { id: r.google_email || r.discord_id, name: who }, summary: `${c.actor.name} ${b.status} ${who}'s access request${note ? ` — ${note}` : ''}`, details: { requestId: r.id } });
  return json({ ok: true });
}

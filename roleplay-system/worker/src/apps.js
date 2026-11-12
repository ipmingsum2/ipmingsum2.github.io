// Application centers: configurable forms, submissions (web or in-game), review, auto-ranking.
import { bad, json, now, parseJSON, str, int, readBody, randHex, cleanWebhook, sendWebhook, logEvent } from './util.js';
import { resolveUser, changeRank } from './roblox.js';
import { publicIdentity } from './auth.js';
import { blacklisted } from './more.js';
import FormRules from '../../form-rules.js';

export const QUESTION_TYPES = ['short', 'paragraph', 'choice', 'checkboxes', 'dropdown', 'number', 'scale', 'yesno', 'date', 'time', 'section'];
const HAS_OPTIONS = ['choice', 'checkboxes', 'dropdown'];
const HAS_OTHER = ['choice', 'checkboxes'];
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

export function cleanQuestions(input) {
  if (!Array.isArray(input)) bad('questions must be an array');
  if (input.length > 60) bad('An application can have at most 60 questions');
  const seen = new Set();
  return input.map((q, i) => {
    const type = QUESTION_TYPES.includes(q?.type) ? q.type : bad(`Question ${i + 1} has an unknown type`);
    const label = str(q.label, 300);
    if (!label) bad(`Question ${i + 1} needs a title`);
    let id = str(q.id, 20).replace(/[^A-Za-z0-9_]/g, '');
    if (!id || seen.has(id)) id = `q${randHex(4)}`;
    seen.add(id);
    const out = { id, type, label, description: str(q.description, 500), required: type !== 'section' && !!q.required };
    if (HAS_OPTIONS.includes(type)) {
      out.options = [...new Set((Array.isArray(q.options) ? q.options : []).map((o) => str(o, 120)).filter(Boolean))].slice(0, 25);
      if (out.options.length < 2) bad(`Question ${i + 1} ("${label}") needs at least two options`);
    }
    if (HAS_OTHER.includes(type) && q.other) out.other = true;
    if (HAS_OPTIONS.includes(type) && q.shuffle) out.shuffle = true;
    if (type === 'scale') {
      out.min = int(q.min, 0, 1, 1); out.max = int(q.max, 2, 10, 5);
      const lo = str(q.minLabel, 60), hi = str(q.maxLabel, 60);
      if (lo) out.minLabel = lo;
      if (hi) out.maxLabel = hi;
    }
    // Custom requirements (Google Forms' "response validation").
    try { const v = FormRules.clean(type, q.validation); if (v) out.validation = v; } catch (e) { bad(`Question ${i + 1} ("${label}"): ${e.message}`); }
    if (type === 'number') { out.min = q.min === '' || q.min == null ? null : Number(q.min) || 0; out.max = q.max === '' || q.max == null ? null : Number(q.max) || 0; }
    // Optional auto-grading.
    const points = int(q.points, 0, 100);
    if (points > 0 && type !== 'section' && type !== 'paragraph' && type !== 'scale') {
      let correct = q.correct;
      if (type === 'checkboxes') correct = (Array.isArray(correct) ? correct : []).filter((x) => out.options.includes(x));
      else if (type === 'choice' || type === 'dropdown') correct = out.options.includes(correct) ? correct : null;
      else if (type === 'yesno') correct = ['Yes', 'No'].includes(correct) ? correct : null;
      else correct = str(correct, 200) || null;
      if (correct != null && (!Array.isArray(correct) || correct.length)) { out.points = points; out.correct = correct; }
    }
    return out;
  });
}

function cleanSettings(s = {}) {
  const acceptRank = s.acceptRank === '' || s.acceptRank == null ? null : int(s.acceptRank, 1, 254);
  return {
    open: s.open !== false,
    identity: s.identity === 'discord' ? 'discord' : 'username',
    allowWeb: s.allowWeb !== false,
    allowGame: s.allowGame !== false,
    webhookUrl: cleanWebhook(s.webhookUrl),
    acceptRank,
    successMessage: str(s.successMessage, 500),
  };
}

const full = (a) => ({ id: a.id, groupId: a.group_id, title: a.title, description: a.description || '', questions: parseJSON(a.questions, []), settings: parseJSON(a.settings, {}), createdAt: a.created_at });
/** What applicants see — never includes correct answers, points or the webhook. */
const publicForm = (a, groupName) => {
  const f = full(a);
  return { id: f.id, group: groupName, title: f.title, description: f.description, identity: f.settings.identity, successMessage: f.settings.successMessage,
    questions: f.questions.map(({ correct, points, ...q }) => q) };
};

async function loadApp(env, id) {
  const a = await env.DB.prepare('SELECT * FROM applications WHERE id=?').bind(str(id, 40)).first();
  if (!a) bad('Application not found', 404);
  return a;
}

// ---------- dashboard ----------
export async function listApps(c) {
  const rows = (await c.env.DB.prepare(
    `SELECT a.*, (SELECT COUNT(*) FROM submissions s WHERE s.application_id=a.id AND s.status='pending') pending,
            (SELECT COUNT(*) FROM submissions s WHERE s.application_id=a.id) total
     FROM applications a WHERE a.group_id=? ORDER BY a.created_at DESC`
  ).bind(c.group.id).all()).results;
  return json({ applications: rows.map((a) => ({ ...full(a), pending: a.pending, total: a.total })) });
}

export async function createApp(c) {
  const b = await readBody(c.req);
  const title = str(b.title, 100);
  if (!title) bad('Title is required');
  const id = randHex(5);
  await c.env.DB.prepare('INSERT INTO applications (id, group_id, title, description, questions, settings, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(id, c.group.id, title, str(b.description, 2000), JSON.stringify(cleanQuestions(b.questions || [])), JSON.stringify(cleanSettings(b.settings)), now()).run();
  await logEvent(c.env, c.ctx, { groupId: c.group.id, type: 'application.created', actor: c.actor, summary: `${c.actor.name} created application "${title}"` });
  return json({ id });
}

export async function getApp(c) { return json({ application: full(await loadApp(c.env, c.params.id)) }); }

export async function updateApp(c) {
  const a = await loadApp(c.env, c.params.id);
  const b = await readBody(c.req);
  const title = str(b.title, 100);
  if (!title) bad('Title is required');
  const questions = cleanQuestions(b.questions || []);
  await c.env.DB.prepare('UPDATE applications SET title=?, description=?, questions=?, settings=? WHERE id=?')
    .bind(title, str(b.description, 2000), JSON.stringify(questions), JSON.stringify(cleanSettings(b.settings)), a.id).run();
  await logEvent(c.env, c.ctx, { groupId: a.group_id, type: 'application.updated', actor: c.actor, summary: `${c.actor.name} updated application "${title}" (${questions.filter((q) => q.type !== 'section').length} questions)` });
  return json({ ok: true });
}

export async function deleteApp(c) {
  const a = await loadApp(c.env, c.params.id);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM submissions WHERE application_id=?').bind(a.id),
    c.env.DB.prepare('DELETE FROM applications WHERE id=?').bind(a.id),
  ]);
  await logEvent(c.env, c.ctx, { groupId: a.group_id, type: 'application.deleted', actor: c.actor, summary: `${c.actor.name} deleted application "${a.title}" and its submissions` });
  return json({ ok: true });
}

export async function listSubmissions(c) {
  const a = await loadApp(c.env, c.params.id);
  const status = ['pending', 'accepted', 'denied'].includes(c.q.get('status')) ? c.q.get('status') : null;
  const rows = (await c.env.DB.prepare(`SELECT * FROM submissions WHERE application_id=? ${status ? 'AND status=?' : ''} ORDER BY id DESC LIMIT 200`).bind(...(status ? [a.id, status] : [a.id])).all()).results;
  return json({ application: full(a), submissions: rows.map((s) => ({ ...s, answers: parseJSON(s.answers, {}) })) });
}

/** GET /api/submissions/:id — one submission with its application (the page the Discord "Decide" button opens). */
export async function getSubmission(c) {
  const s = await c.env.DB.prepare('SELECT * FROM submissions WHERE id=?').bind(Number(c.params.id) || 0).first();
  if (!s) bad('Submission not found', 404);
  const a = await loadApp(c.env, s.application_id);
  return json({ application: full(a), submission: { ...s, answers: parseJSON(s.answers, {}) } });
}

// ---------- Discord notifications ----------
const clip = (t, n) => { t = String(t ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
/** Dashboard page for one submission; `#/go/<gid>/…` switches to the right group first. */
const submissionUrl = (env, gid, id) => `${String(env.DASHBOARD_URL || '').replace(/\/+$/, '')}/app.html#/go/${encodeURIComponent(gid)}/submission/${id}`;

/** Embed fields for every answered question (Discord: ≤25 fields, ≤1024 chars per value, ≤6000 chars per embed). */
export function answerFields(questions, answers) {
  const fields = [];
  let used = 0, skipped = 0, n = 0;
  // Share the ~4600-character budget across up to 24 answers so long forms still show most of them.
  const count = Math.max(1, Math.min(24, questions.filter((q) => q.type !== 'section').length));
  const per = Math.max(150, Math.min(1024, Math.floor(4600 / count) - 60));
  for (const q of questions) {
    if (q.type === 'section') continue;
    n++;
    const v = answers?.[q.id];
    const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
    let mark = '';
    if (q.points && !empty) {
      const ok = q.type === 'checkboxes' ? v.length === q.correct.length && q.correct.every((x) => v.includes(x)) : norm(v) === norm(q.correct);
      mark = ok ? ' ✅' : ' ❌';
    } else if (q.points) mark = ' ❌';
    const name = clip(`${n}. ${q.label}${mark}`, 256);
    const value = empty ? '*No answer*' : clip(Array.isArray(v) ? v.join(', ') : v, per);
    if (fields.length >= 24 || used + name.length + value.length > 5000) { skipped++; continue; }
    used += name.length + value.length;
    fields.push({ name, value, inline: false });
  }
  if (skipped) fields.push({ name: '…', value: `${skipped} more answer${skipped === 1 ? '' : 's'} — open the submission to read everything.`, inline: false });
  return fields;
}

/** Posts with link buttons; if Discord refuses the components, posts again without them so the notice still arrives. */
export async function notify(url, embed, buttons) {
  const links = buttons.filter((b) => /^https?:\/\/\S+$/.test(b.url || '') && b.url.length <= 512).map((b) => ({ type: 2, style: 5, label: b.label, url: b.url }));
  if (!links.length) return sendWebhook(url, { embeds: [embed] });
  if (await sendWebhook(url, { embeds: [embed], components: [{ type: 1, components: links }] }, 'with_components=true')) return true;
  return sendWebhook(url, { embeds: [embed] });
}

export async function reviewSubmission(c) {
  const b = await readBody(c.req);
  if (!['accepted', 'denied'].includes(b.status)) bad('status must be accepted or denied');
  const s = await c.env.DB.prepare('SELECT * FROM submissions WHERE id=?').bind(Number(c.params.id)).first();
  if (!s) bad('Submission not found', 404);
  if (s.status !== 'pending') bad('This submission has already been reviewed');
  const a = await loadApp(c.env, s.application_id);
  const settings = parseJSON(a.settings, {});
  const note = str(b.note, 500);
  await c.env.DB.prepare('UPDATE submissions SET status=?, reviewer=?, review_note=?, reviewed_at=? WHERE id=?').bind(b.status, c.actor.name, note, now(), s.id).run();
  await logEvent(c.env, c.ctx, { groupId: s.group_id, type: `application.${b.status}`, actor: c.actor, target: { id: s.roblox_id, name: s.roblox_name }, summary: `${c.actor.name} ${b.status} ${s.roblox_name}'s application for "${a.title}"${note ? ` — ${note}` : ''}` });

  // Accepting can rank the applicant automatically.
  let ranked = null, rankError = null;
  if (b.status === 'accepted' && settings.acceptRank) {
    try {
      const group = await c.env.DB.prepare('SELECT * FROM groups WHERE id=?').bind(s.group_id).first();
      ranked = (await changeRank(c.env, c.ctx, group, { user: s.roblox_id, action: 'set', rank: settings.acceptRank, reason: `Accepted application: ${a.title}` }, c.actor)).to;
    } catch (e) { rankError = e.message; }
  }
  if (settings.webhookUrl) {
    const link = submissionUrl(c.env, s.group_id, s.id);
    c.ctx.waitUntil(notify(settings.webhookUrl, { title: `Application ${b.status}`, url: link, color: b.status === 'accepted' ? 0x2fa58a : 0xe5484d,
      description: `**${s.roblox_name}**'s application for **${a.title}** was ${b.status} by ${c.actor.name}.${note ? `\n> ${clip(note, 500)}` : ''}${ranked ? `\nRanked to **${ranked.name}**.` : ''}${rankError ? `\nAuto-rank failed: ${rankError}` : ''}`,
      timestamp: new Date().toISOString() }, [{ label: 'View submission', url: link }]));
  }
  return json({ ok: true, ranked, rankError });
}

// ---------- submitting ----------
const norm = (v) => String(v ?? '').trim().toLowerCase();

export function gradeAndValidate(questions, input) {
  const answers = {};
  let score = 0, max = 0;
  for (const q of questions) {
    if (q.type === 'section') continue;
    let v = input?.[q.id];
    const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
    if (empty) { if (q.required) bad(`"${q.label}" is required`); if (q.points) max += q.points; continue; }
    switch (q.type) {
      case 'short': v = str(v, 300); break;
      case 'paragraph': v = str(v, 4000); break;
      case 'choice': case 'dropdown': {
        const raw = str(v, 300);
        if (q.options.includes(raw)) v = raw;
        else if (q.other && raw && raw !== FormRules.OTHER) v = `${FormRules.OTHER_PREFIX}${raw}`; // anything that isn't an option is the typed "Other" answer
        else bad(q.other && raw === FormRules.OTHER ? `"${q.label}": type your answer next to “Other”` : `"${q.label}" has an invalid answer`);
        break;
      }
      case 'checkboxes': {
        const raw = (Array.isArray(v) ? v : [v]).map((x) => str(x, 300)).filter(Boolean);
        v = q.options.filter((o) => raw.includes(o)); // keeps the form's option order
        const other = q.other ? raw.find((x) => !q.options.includes(x) && x !== FormRules.OTHER) : null;
        if (other) v.push(`${FormRules.OTHER_PREFIX}${other}`);
        if (q.other && raw.includes(FormRules.OTHER) && !other) bad(`"${q.label}": type your answer next to “Other”`);
        if (!v.length && q.required) bad(`"${q.label}" is required`);
        break;
      }
      case 'date': v = str(v, 10); if (!isDate(v)) bad(`"${q.label}" must be a date (YYYY-MM-DD)`); break;
      case 'time': v = str(v, 5); if (!isTime(v)) bad(`"${q.label}" must be a time (HH:MM, 24-hour)`); break;
      case 'yesno': v = str(v, 3); if (!['Yes', 'No'].includes(v)) bad(`"${q.label}" must be Yes or No`); break;
      case 'number': v = Number(v); if (!Number.isFinite(v)) bad(`"${q.label}" must be a number`);
        if (q.min != null && v < q.min) bad(`"${q.label}" must be at least ${q.min}`); if (q.max != null && v > q.max) bad(`"${q.label}" must be at most ${q.max}`); break;
      case 'scale': v = int(v, q.min, q.max, q.min); break;
    }
    const broken = FormRules.check(q, v);
    if (broken) bad(`"${q.label}": ${broken}`);
    answers[q.id] = v;
    if (q.points) {
      max += q.points;
      const ok = q.type === 'checkboxes'
        ? v.length === q.correct.length && q.correct.every((x) => v.includes(x))
        : norm(v) === norm(q.correct);
      if (ok) score += q.points;
    }
  }
  return { answers, score, max };
}

async function submit(c, app, who, input) {
  const settings = parseJSON(app.settings, {});
  if (settings.open === false) bad('This application is closed', 403);
  if (await blacklisted(c.env, app.group_id, who.robloxId)) {
    await logEvent(c.env, c.ctx, { groupId: app.group_id, type: 'application.blocked', actor: c.actor, target: { id: who.robloxId, name: who.robloxName }, summary: `${who.robloxName} tried to apply for "${app.title}" but is blacklisted` });
    bad('You are not eligible to apply to this group.', 403);
  }
  const dup = await c.env.DB.prepare("SELECT id FROM submissions WHERE application_id=? AND roblox_id=? AND status='pending'").bind(app.id, who.robloxId).first();
  if (dup) bad('You already have a pending submission for this application', 409);
  const questions = parseJSON(app.questions, []);
  const { answers, score, max } = gradeAndValidate(questions, input);
  const ins = await c.env.DB.prepare('INSERT INTO submissions (application_id, group_id, roblox_id, roblox_name, discord_id, answers, score, max_score, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(app.id, app.group_id, who.robloxId, who.robloxName, who.discordId || null, JSON.stringify(answers), score, max, now()).run();
  await logEvent(c.env, c.ctx, { groupId: app.group_id, type: 'application.submitted', actor: c.actor, target: { id: who.robloxId, name: who.robloxName }, summary: `${who.robloxName} applied for "${app.title}"${max ? ` (score ${score}/${max})` : ''}` });
  if (settings.webhookUrl) {
    const link = submissionUrl(c.env, app.group_id, ins.meta.last_row_id);
    c.ctx.waitUntil(notify(settings.webhookUrl, {
      title: clip(`New application — ${app.title}`, 256), url: link, color: 0x8e6fd8,
      description: `**${who.robloxName}** (${who.robloxId}) applied for **${app.title}**.${max ? `\nAuto-score: **${score}/${max}**` : ''}${who.discordId ? `\nDiscord: <@${who.discordId}>` : ''}`,
      fields: answerFields(questions, answers),
      footer: { text: 'Use Decide to accept or deny in the dashboard' },
      timestamp: new Date().toISOString(),
    }, [{ label: 'Decide', url: link }, { label: 'Roblox profile', url: `https://www.roblox.com/users/${who.robloxId}/profile` }]));
  }
  return json({ ok: true, message: settings.successMessage || 'Your application has been submitted.' });
}

const groupName = async (env, gid) => (await env.DB.prepare('SELECT name FROM groups WHERE id=?').bind(gid).first())?.name || '';

/** GET /public/applications/:id — the form for the web apply page. */
export async function publicGet(c) {
  const a = await loadApp(c.env, c.params.id);
  const s = parseJSON(a.settings, {});
  if (s.allowWeb === false) bad('This application can only be completed in the Roblox application center', 403);
  return json({ application: publicForm(a, await groupName(c.env, a.group_id)), open: s.open !== false });
}

/** POST /public/applications/:id/submit {username?, answers} (+ X-Public-Token when Discord sign-in is required). */
export async function publicSubmit(c) {
  const a = await loadApp(c.env, c.params.id);
  const s = parseJSON(a.settings, {});
  if (s.allowWeb === false) bad('This application can only be completed in the Roblox application center', 403);
  const b = await readBody(c.req);
  const idn = await publicIdentity(c);
  let who;
  if (s.identity === 'discord') {
    if (!idn) bad('Sign in with Discord to apply', 401);
    const link = await c.env.DB.prepare('SELECT roblox_id, roblox_name FROM links WHERE discord_id=?').bind(idn.discordId).first();
    if (!link) bad('Link your Roblox account first (use the Verify page)', 403);
    who = { robloxId: link.roblox_id, robloxName: link.roblox_name, discordId: idn.discordId };
  } else {
    const u = await resolveUser(c.env, b.username);
    who = { robloxId: u.id, robloxName: u.name, discordId: idn?.discordId };
  }
  c.actor = { type: 'public', id: who.robloxId, name: who.robloxName };
  return submit(c, a, who, b.answers);
}

/** GET /v1/game/applications — open applications (with questions) for the in-game application center. */
export async function gameList(c) {
  const rows = (await c.env.DB.prepare('SELECT * FROM applications WHERE group_id=? ORDER BY created_at').bind(c.group.id).all()).results;
  const open = rows.filter((a) => { const s = parseJSON(a.settings, {}); return s.open !== false && s.allowGame !== false; });
  return json({ group: c.group.name, applications: open.map((a) => publicForm(a, c.group.name)) });
}

/** POST /v1/game/applications/:id/submit {userId, username, answers} — identity comes from the Roblox server, so it is verified. */
export async function gameSubmit(c) {
  const a = await loadApp(c.env, c.params.id);
  if (a.group_id !== c.group.id) bad('Application not found', 404);
  if (parseJSON(a.settings, {}).allowGame === false) bad('This application is not available in-game', 403);
  const b = await readBody(c.req);
  const robloxId = str(b.userId, 20);
  if (!/^\d{1,15}$/.test(robloxId)) bad('userId is required');
  const link = await c.env.DB.prepare('SELECT discord_id FROM links WHERE roblox_id=?').bind(robloxId).first();
  return submit(c, a, { robloxId, robloxName: str(b.username, 40) || `User ${robloxId}`, discordId: link?.discord_id }, b.answers);
}

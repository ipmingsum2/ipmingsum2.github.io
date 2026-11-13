// Reports: arrest reports, incident reports, patient care reports, flight logs… Each group designs its own report types
// with the application form builder, picks who may file and who reviews, and gets them in Discord.
import { bad, json, now, parseJSON, str, readBody, cleanWebhook, logEvent } from './util.js';
import { cleanQuestions, gradeAndValidate, answerFields, notify } from './apps.js';
import { resolveUser } from './roblox.js';
import { can, PERMISSIONS } from './auth.js';

const SUBJECT = ['none', 'optional', 'required'];
const COLOR = /^#[0-9a-f]{6}$/i;
const perm = (v) => (PERMISSIONS.includes(v) ? v : '');
export const canFile = (u, t) => !t.file_perm || can(u, t.file_perm) || can(u, 'manage_reports');
export const canReview = (u, t) => can(u, 'manage_reports') || (!!t.view_perm && can(u, t.view_perm));
const dash = (env) => String(env.DASHBOARD_URL || '').replace(/\/+$/, '');

const typeView = (t, u) => {
  const v = { id: t.id, name: t.name, description: t.description || '', color: t.color, subject: t.subject, filePerm: t.file_perm, viewPerm: t.view_perm,
    questions: parseJSON(t.questions, []).map(({ correct, points, ...q }) => q), canFile: canFile(u, t), canReview: canReview(u, t) };
  if (can(u, 'manage_reports')) v.webhookUrl = t.webhook_url || '';
  return v;
};
async function loadType(env, id) { const t = await env.DB.prepare('SELECT * FROM report_types WHERE id=?').bind(Number(id) || 0).first(); if (!t) bad('Report type not found', 404); return t; }

function typeFields(b, prev = {}) {
  const name = str(b.name, 60); if (!name) bad('Give the report type a name');
  const questions = cleanQuestions(b.questions || []).map(({ correct, points, ...q }) => q);
  if (!questions.some((q) => q.type !== 'section')) bad('Add at least one question');
  return {
    name, description: str(b.description, 500), color: COLOR.test(String(b.color || '')) ? String(b.color).toLowerCase() : '#5b8def',
    subject: SUBJECT.includes(b.subject) ? b.subject : 'optional', filePerm: perm(b.filePerm), viewPerm: perm(b.viewPerm),
    webhookUrl: b.webhookUrl === '(hidden)' ? prev.webhook_url || '' : cleanWebhook(b.webhookUrl), questions,
  };
}

// ---------- report types ----------
export async function typesList(c) {
  const rows = (await c.env.DB.prepare('SELECT * FROM report_types WHERE group_id=? ORDER BY name').bind(c.group.id).all()).results;
  return json({ types: rows.map((t) => typeView(t, c.user)).filter((t) => t.canFile || t.canReview || can(c.user, 'manage_reports')) });
}
export async function typeCreate(c) {
  const f = typeFields(await readBody(c.req));
  const r = await c.env.DB.prepare('INSERT INTO report_types (group_id, name, description, color, subject, file_perm, view_perm, webhook_url, questions, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(c.group.id, f.name, f.description, f.color, f.subject, f.filePerm, f.viewPerm, f.webhookUrl || null, JSON.stringify(f.questions), now()).run();
  await logEvent(c.env, c.ctx, { groupId: c.group.id, type: 'report.type_created', actor: c.actor, summary: `${c.actor.name} created the "${f.name}" report type` });
  return json({ ok: true, id: r.meta.last_row_id });
}
export async function typeUpdate(c) {
  const t = await loadType(c.env, c.params.id);
  const f = typeFields(await readBody(c.req), t);
  await c.env.DB.prepare('UPDATE report_types SET name=?, description=?, color=?, subject=?, file_perm=?, view_perm=?, webhook_url=?, questions=? WHERE id=?')
    .bind(f.name, f.description, f.color, f.subject, f.filePerm, f.viewPerm, f.webhookUrl || null, JSON.stringify(f.questions), t.id).run();
  await logEvent(c.env, c.ctx, { groupId: t.group_id, type: 'report.type_updated', actor: c.actor, summary: `${c.actor.name} updated the "${f.name}" report type`, silent: true });
  return json({ ok: true });
}
export async function typeDelete(c) {
  const t = await loadType(c.env, c.params.id);
  const n = (await c.env.DB.prepare('SELECT COUNT(*) n FROM reports WHERE type_id=?').bind(t.id).first()).n;
  if (n) bad(`${n} report${n === 1 ? '' : 's'} use this type — it can't be deleted while they exist`, 409);
  await c.env.DB.prepare('DELETE FROM report_types WHERE id=?').bind(t.id).run();
  await logEvent(c.env, c.ctx, { groupId: t.group_id, type: 'report.type_deleted', actor: c.actor, summary: `${c.actor.name} deleted the "${t.name}" report type` });
  return json({ ok: true });
}

// ---------- reports ----------
const reportView = (r, t) => ({ id: r.id, typeId: r.type_id, typeName: t?.name || 'Report', color: t?.color || '#5b8def', authorId: r.author_id, authorName: r.author_name,
  subjectId: r.subject_id, subjectName: r.subject_name, answers: parseJSON(r.answers, {}), status: r.status, reviewer: r.reviewer, reviewNote: r.review_note, reviewedAt: r.reviewed_at, createdAt: r.created_at });

/** GET /api/groups/:gid/reports?status=open|closed&type=ID&mine=1&subject=RID — your own reports, plus every type you review. */
export async function list(c) {
  const { DB } = c.env;
  const types = new Map((await DB.prepare('SELECT * FROM report_types WHERE group_id=?').bind(c.group.id).all()).results.map((t) => [t.id, t]));
  const where = ['group_id=?'], vals = [c.group.id];
  const st = c.q.get('status'); if (['open', 'closed'].includes(st)) { where.push('status=?'); vals.push(st); }
  const ty = Number(c.q.get('type')); if (ty) { where.push('type_id=?'); vals.push(ty); }
  const subj = str(c.q.get('subject'), 20); if (/^\d{1,15}$/.test(subj)) { where.push('subject_id=?'); vals.push(subj); }
  if (c.q.get('mine') === '1') { where.push('author_id=?'); vals.push(c.user.id); }
  const rows = (await DB.prepare(`SELECT * FROM reports WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 300`).bind(...vals).all()).results;
  const visible = rows.filter((r) => r.author_id === c.user.id || (types.get(r.type_id) && canReview(c.user, types.get(r.type_id))));
  const counts = (await DB.prepare("SELECT status, COUNT(*) n FROM reports WHERE group_id=? GROUP BY status").bind(c.group.id).all()).results;
  return json({ reports: visible.map((r) => reportView(r, types.get(r.type_id))), reviewer: [...types.values()].some((t) => canReview(c.user, t)), counts: Object.fromEntries(counts.map((x) => [x.status, x.n])) });
}

/** POST /api/groups/:gid/reports {typeId, subject, answers} */
export async function create(c) {
  const b = await readBody(c.req);
  const t = await loadType(c.env, b.typeId);
  if (t.group_id !== c.group.id) bad('Report type not found', 404);
  if (!canFile(c.user, t)) bad('You don’t have permission to file this kind of report', 403);
  let subject = null;
  if (t.subject !== 'none' && str(b.subject, 40)) subject = await resolveUser(c.env, b.subject, c.group.id);
  if (t.subject === 'required' && !subject) bad('Enter who this report is about (Roblox username or ID)');
  const questions = parseJSON(t.questions, []);
  const { answers } = gradeAndValidate(questions, b.answers);
  const ts = now();
  const r = await c.env.DB.prepare('INSERT INTO reports (group_id, type_id, author_id, author_name, subject_id, subject_name, answers, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(c.group.id, t.id, c.user.id, c.actor.name, subject?.id || null, subject?.name || null, JSON.stringify(answers), 'open', ts).run();
  const id = r.meta.last_row_id;
  await logEvent(c.env, c.ctx, { groupId: c.group.id, type: 'report.filed', actor: c.actor, target: subject, summary: `${c.actor.name} filed ${t.name} #${id}${subject ? ` about ${subject.name}` : ''}`, details: { reportId: id } });
  if (t.webhook_url) {
    const link = `${dash(c.env)}/app.html#/go/${encodeURIComponent(c.group.id)}/report/${id}`;
    c.ctx.waitUntil(notify(t.webhook_url, {
      title: `${t.name} #${id}`.slice(0, 256), url: link, color: parseInt(t.color.slice(1), 16) || 0x5b8def,
      description: `Filed by **${c.actor.name}**${subject ? `\nAbout: **${subject.name}** (${subject.id})` : ''}`,
      fields: answerFields(questions, answers), footer: { text: c.group.name }, timestamp: new Date(ts * 1000).toISOString(),
    }, [{ label: 'Open report', url: link }]));
  }
  return json({ ok: true, id });
}

async function loadVisible(c) {
  const r = await c.env.DB.prepare('SELECT * FROM reports WHERE id=?').bind(Number(c.params.id) || 0).first();
  if (!r) bad('Report not found', 404);
  const t = await c.env.DB.prepare('SELECT * FROM report_types WHERE id=?').bind(r.type_id).first();
  const review = !!t && canReview(c.user, t);
  if (r.author_id !== c.user.id && !review) bad('Report not found', 404);
  return { r, t, review };
}
export async function get(c) {
  const { r, t, review } = await loadVisible(c);
  return json({ report: reportView(r, t), type: t ? typeView(t, c.user) : null, canReview: review });
}
/** PATCH /api/reports/:id {status: open|closed, note} */
export async function review(c) {
  const { r, t, review: ok } = await loadVisible(c);
  if (!ok) bad('You don’t review this kind of report', 403);
  const b = await readBody(c.req);
  if (!['open', 'closed'].includes(b.status)) bad('status must be open or closed');
  const note = str(b.note, 1000);
  await c.env.DB.prepare('UPDATE reports SET status=?, reviewer=?, review_note=?, reviewed_at=? WHERE id=?').bind(b.status, c.actor.name, note || null, now(), r.id).run();
  await logEvent(c.env, c.ctx, { groupId: r.group_id, type: `report.${b.status === 'closed' ? 'closed' : 'reopened'}`, actor: c.actor, summary: `${c.actor.name} ${b.status === 'closed' ? 'closed' : 'reopened'} ${t?.name || 'report'} #${r.id}${note ? ` — ${note}` : ''}` });
  return json({ ok: true });
}

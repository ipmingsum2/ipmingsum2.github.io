// Search across everything a signed-in user may see: members, notes, logbook, blacklist, moderation, time off,
// promotions, sessions, handbooks, news, applications and their submissions, reports, roster, logs, and (for the
// owner) the whitelist and access requests. Each source applies the same permission rules as its own page.
import { json, str, parseJSON } from './util.js';
import { can } from './auth.js';
import { canSee } from './features.js';
import { canReview } from './reports.js';

const PER_TYPE = 6;

/** Splits the query into words; every word must appear in at least one of the columns. */
function matcher(words, cols) {
  const sql = words.map(() => `(${cols.map((c) => `COALESCE(${c},'') LIKE ? ESCAPE '\\'`).join(' OR ')})`).join(' AND ');
  const vals = words.flatMap((w) => cols.map(() => `%${w.replace(/[\\%_]/g, (m) => `\\${m}`)}%`));
  return { sql, vals };
}

const plain = (s) => String(s ?? '').replace(/[#*_>`[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
/** ~120 characters around the first matching word. */
function snippet(text, words) {
  const t = plain(text);
  if (!t) return '';
  const low = t.toLowerCase();
  let at = -1;
  for (const w of words) { const i = low.indexOf(w.toLowerCase()); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0 || t.length <= 120) return t.slice(0, 120) + (t.length > 120 ? '…' : '');
  const start = Math.max(0, at - 40);
  return (start ? '…' : '') + t.slice(start, start + 120) + (start + 120 < t.length ? '…' : '');
}
// Text of JSON answers ({id: value | [values]}) for matching snippets.
const answersText = (a) => Object.values(parseJSON(a, {})).flat().map((v) => String(v ?? '')).join(' · ');

/** GET /api/search?q=&gid= */
export async function search(c) {
  const q = str(c.q.get('q'), 80);
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length >= 1).slice(0, 5);
  if (!words.length || q.length < 2) return json({ results: [] });
  const { DB } = c.env;
  const u = c.user;
  const gid = str(c.q.get('gid'), 20);
  const group = gid && /^\d+$/.test(gid) ? await DB.prepare('SELECT id, name FROM groups WHERE id=?').bind(gid).first() : null;
  const out = [];
  const add = (type, rows, map) => { for (const r of rows.slice(0, PER_TYPE)) out.push({ type, ...map(r) }); };
  const find = async (table, cols, extra = '', vals = [], order = 'id DESC', select = '*') => {
    const m = matcher(words, cols);
    return (await DB.prepare(`SELECT ${select} FROM ${table} WHERE ${extra ? `${extra} AND ` : ''}${m.sql} ORDER BY ${order} LIMIT ${PER_TYPE * 3}`).bind(...vals, ...m.vals).all()).results;
  };
  const tasks = [];

  if (group) {
    const g = group.id;
    tasks.push(
      // Members, by name, display name, role or callsign.
      (async () => {
        const m = matcher(words, ['m.username', 'm.display_name', 'm.role_name', 'r.callsign']);
        const rows = (await DB.prepare(`SELECT m.*, r.callsign FROM members m LEFT JOIN roster r ON r.group_id=m.group_id AND r.roblox_id=m.roblox_id WHERE m.group_id=? AND m.rank>0 AND ${m.sql} ORDER BY m.rank DESC, m.username LIMIT ${PER_TYPE * 2}`).bind(g, ...m.vals).all()).results;
        add('member', rows, (r) => ({ title: r.username || r.roblox_id, sub: [r.display_name && r.display_name !== r.username ? r.display_name : '', r.role_name, r.callsign].filter(Boolean).join(' · '), href: `#/member/${r.roblox_id}` }));
      })(),
      (async () => add('note', await find('notes n LEFT JOIN members m ON m.group_id=n.group_id AND m.roblox_id=n.roblox_id', ['n.text', 'n.author', 'm.username'], 'n.group_id=?', [g], 'n.id DESC', 'n.*, m.username'), (r) => ({ title: `${r.kind === 'warning' ? 'Warning' : 'Note'} on ${r.username || r.roblox_id}`, sub: snippet(r.text, words), href: `#/member/${r.roblox_id}`, at: r.created_at })))(),
      (async () => add('logbook', await find('logbook', ['username', 'reason', 'author', 'type'], 'group_id=?', [g]), (r) => ({ title: `${r.type[0].toUpperCase()}${r.type.slice(1)} · ${r.username || r.roblox_id}`, sub: snippet(r.reason, words), href: `#/member/${r.roblox_id}`, at: r.created_at })))(),
      (async () => add('blacklist', await find('blacklist', ['username', 'reason', 'author', 'roblox_id'], 'group_id=?', [g]), (r) => ({ title: `${r.username || r.roblox_id}${r.removed_at ? ' (removed)' : ''}`, sub: snippet(r.reason, words), href: '#/blacklist', at: r.created_at })))(),
      (async () => add('timeoff', await find('time_off', ['username', 'reason'], 'group_id=?', [g]), (r) => ({ title: `${r.username || r.roblox_id} · ${r.start_date} to ${r.end_date}`, sub: `${r.status}${r.reason ? ` — ${snippet(r.reason, words)}` : ''}`, href: '#/timeoff', at: r.created_at })))(),
      (async () => add('promotion', await find('recommendations', ['username', 'reason', 'created_by', 'role_name'], 'group_id=?', [g]), (r) => ({ title: `${r.username} · ${r.role_name || ''}`.trim(), sub: snippet(r.reason, words), href: '#/promotions', at: r.created_at })))(),
      (async () => add('session', await find('events', ['title', 'type', 'host_name', 'notes'], 'group_id=?', [g], 'starts_at DESC'), (r) => ({ title: r.title, sub: [r.type, r.host_name ? `host ${r.host_name}` : '', snippet(r.notes, words)].filter(Boolean).join(' · '), href: '#/sessions', at: r.starts_at })))(),
      (async () => add('handbook', (await find('kb_docs', ['title', 'category', 'body'], 'group_id=?', [g], 'updated_at DESC')).filter((d) => canSee(u, d)), (r) => ({ title: r.title, sub: [r.category, snippet(r.body, words)].filter(Boolean).join(' · '), href: `#/kb/${r.id}`, at: r.updated_at })))(),
      (async () => add('news', (await find('posts', ['title', 'body', 'author'], 'group_id=?', [g])).filter((d) => canSee(u, d)), (r) => ({ title: r.title, sub: snippet(r.body, words), href: '#/news', at: r.created_at })))(),
      (async () => {
        const types = (await find('departments', ['name', 'description', 'head_name'], 'group_id=?', [g], 'sort, name')).map((r) => ({ title: r.name, sub: ['Department', r.head_name ? `head ${r.head_name}` : '', snippet(r.description, words)].filter(Boolean).join(' · '), href: '#/roster' }));
        const certs = (await find('cert_types', ['name', 'description'], 'group_id=?', [g], 'name')).map((r) => ({ title: r.name, sub: ['Certification', snippet(r.description, words)].filter(Boolean).join(' · '), href: '#/roster' }));
        add('roster', [...types, ...certs], (r) => r);
      })(),
      (async () => {
        const types = new Map((await DB.prepare('SELECT * FROM report_types WHERE group_id=?').bind(g).all()).results.map((t) => [t.id, t]));
        const rows = (await find('reports', ['author_name', 'subject_name', 'answers', 'review_note'], 'group_id=?', [g])).filter((r) => r.author_id === u.id || (types.get(r.type_id) && canReview(u, types.get(r.type_id))));
        add('report', rows, (r) => ({ title: `${types.get(r.type_id)?.name || 'Report'} #${r.id}${r.subject_name ? ` · ${r.subject_name}` : ''}`, sub: `${r.status} · by ${r.author_name} — ${snippet(answersText(r.answers), words)}`, href: `#/report/${r.id}`, at: r.created_at }));
      })(),
    );
    if (can(u, 'manage_discipline') || can(u, 'view_logs') || can(u, 'manage_servers')) {
      tasks.push((async () => add('moderation', await find('moderation', ['username', 'reason', 'moderator', 'source', 'action'], 'group_id=?', [g]), (r) => ({ title: `${r.action[0].toUpperCase()}${r.action.slice(1)} · ${r.username || r.roblox_id || '?'}`, sub: [r.moderator ? `by ${r.moderator}` : '', r.source, snippet(r.reason, words)].filter(Boolean).join(' · '), href: '#/moderation', at: r.created_at })))());
    }
    if (can(u, 'manage_applications') || can(u, 'review_applications')) {
      tasks.push(
        (async () => add('application', await find('applications', ['title', 'description'], 'group_id=?', [g]), (r) => ({ title: r.title, sub: snippet(r.description, words) || 'Application', href: `#/applications/${r.id}/submissions`, at: r.created_at })))(),
        (async () => {
          const rows = await find('submissions s JOIN applications a ON a.id=s.application_id', ['s.roblox_name', 's.discord_id', 's.answers', 's.review_note'], 's.group_id=?', [g], 's.id DESC', 's.*, a.title');
          add('submission', rows, (r) => ({ title: `${r.title} · ${r.roblox_name || r.roblox_id}`, sub: `${r.status} — ${snippet(answersText(r.answers), words)}`, href: `#/submission/${r.id}`, at: r.created_at }));
        })(),
      );
    }
  }
  if (can(u, 'view_logs')) {
    const mine = u.groupIds ? [...u.groupIds] : null;
    const scope = group ? ['group_id=?', [group.id]] : mine ? [mine.length ? `group_id IN (${mine.map(() => '?').join(',')})` : '0', mine] : ['', []];
    tasks.push((async () => add('log', await find('logs', ['summary', 'actor_name', 'target_name', 'type'], scope[0], scope[1]), (r) => ({ title: r.type, sub: snippet(r.summary, words), href: '#/logs', at: r.ts })))());
  }
  if (u.role === 'owner') {
    tasks.push(
      (async () => add('user', await find('users', ['name', 'google_email', 'discord_name', 'discord_id', 'roblox_name', 'roblox_id']), (r) => ({ title: r.name || r.google_email || r.discord_name || `User ${r.id}`, sub: [r.role === 'owner' ? 'Owner' : 'Whitelisted', r.google_email, r.discord_name, r.roblox_name].filter(Boolean).join(' · '), href: '#/go/owner/access' })))(),
      (async () => add('access', await find('access_requests', ['name', 'google_email', 'discord_id', 'answers', 'review_note']), (r) => ({ title: `${r.name || r.google_email || r.discord_id} · access request`, sub: `${r.status} — ${snippet(answersText(r.answers), words)}`, href: `#/go/owner/requests/${r.id}`, at: r.created_at })))(),
    );
  }
  await Promise.all(tasks);
  const ORDER = ['member', 'note', 'logbook', 'report', 'handbook', 'news', 'session', 'roster', 'promotion', 'timeoff', 'blacklist', 'moderation', 'application', 'submission', 'user', 'access', 'log'];
  out.sort((x, y) => ORDER.indexOf(x.type) - ORDER.indexOf(y.type));
  return json({ results: out, group: group ? { id: group.id, name: group.name } : null });
}

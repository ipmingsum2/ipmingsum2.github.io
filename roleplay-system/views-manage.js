// Views: applications (list, builder, submissions), logs, groups, API keys, linked accounts, access, account.
'use strict';

const Q_TYPES = [['short', 'Short answer'], ['paragraph', 'Paragraph'], ['choice', 'Multiple choice'], ['checkboxes', 'Checkboxes'], ['dropdown', 'Dropdown'], ['yesno', 'Yes / No'], ['number', 'Number'], ['scale', 'Linear scale'], ['date', 'Date'], ['time', 'Time'], ['section', 'Section heading']];
const Q_LABEL = Object.fromEntries(Q_TYPES);
const HAS_OPTS = ['choice', 'checkboxes', 'dropdown'];
const GRADABLE = ['short', 'choice', 'checkboxes', 'dropdown', 'yesno', 'number'];
const applyUrl = (id) => new URL(`apply.html?id=${id}`, location.href).href;
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PERM_LABELS = { manage_activity: 'Manage activity, requirements, time off, notes, sessions and registers', ranking: 'Promote / demote / set ranks, approve promotion recommendations, auto-promotion', manage_groups: 'Add and configure groups', manage_applications: 'Create and edit applications', review_applications: 'Accept / deny submissions', view_logs: 'View logs', manage_api_keys: 'Create and revoke API keys', manage_discipline: 'Logbook entries and the blacklist', manage_content: 'Post news and edit the knowledgebase', manage_roster: 'Departments, callsigns and certifications', manage_reports: 'Design report types and review every report', manage_servers: 'Live servers: announce, kick and shut down game servers' };

/** Creates a group-bound API key with the "game" scope (used by generated place files and loader snippets). */
async function createGameKey(label, gid = S.gid) {
  if (!can('manage_api_keys')) throw new Error('You need the "manage API keys" permission to generate a game key.');
  const g = S.groups.find((x) => x.id === gid);
  return (await api('/api/keys', { body: { name: `${label} — ${g?.name || gid}`, scopes: ['game'], groupId: gid } })).key;
}

// ---------- applications ----------
VIEWS.applications = async (el, id, sub, reload) => {
  if (id === 'new' || (id && !sub)) return appBuilder(el, id === 'new' ? null : id);
  if (id && sub === 'submissions') return appSubmissions(el, id, reload);
  const { applications } = await api(G('/applications'));
  const manage = can('manage_applications');
  el.innerHTML = `${head('Applications', 'Application centers with your own questions. Applicants apply on the web page or inside the Roblox application center.', `
      ${manage ? `<button class="btn" id="rbx">${icon('download')} Application center (.rbxlx)</button><a class="btn primary" href="#/applications/new">${icon('plus')} New application</a>` : ''}`)}
    <div class="card"><div class="tbl-wrap"><table><thead><tr><th>Application</th><th>Questions</th><th>Status</th><th class="r">Pending</th><th class="r">Total</th><th></th></tr></thead><tbody>
    ${applications.length ? applications.map((a) => `<tr><td><b>${esc(a.title)}</b><br><span class="muted">${a.settings.allowWeb === false ? 'In-game only' : `<a href="${applyUrl(a.id)}" target="_blank" rel="noopener">Web form</a>`}${a.settings.allowGame === false ? ' · web only' : ' · in-game'}</span></td>
      <td class="num">${a.questions.filter((q) => q.type !== 'section').length}</td><td>${a.settings.open === false ? '<span class="badge bad">Closed</span>' : '<span class="badge good">Open</span>'}</td>
      <td class="r num">${a.pending ? `<span class="badge warn">${a.pending}</span>` : '0'}</td><td class="r num">${a.total}</td>
      <td class="r"><div class="row" style="justify-content:flex-end"><a class="btn sm" href="#/applications/${a.id}/submissions">Submissions</a>
      ${a.settings.allowWeb === false ? '' : `<button class="btn ghost icon sm" data-copy="${a.id}" aria-label="Copy link" title="Copy link">${icon('copy', 'sm')}</button>`}
      ${manage ? `<a class="btn ghost icon sm" href="#/applications/${a.id}" aria-label="Edit" title="Edit">${icon('edit', 'sm')}</a>` : ''}</div></td></tr>`).join('') : emptyRow(6, 'No applications yet.', 'file')}
    </tbody></table></div></div>`;
  $$('[data-copy]', el).forEach((b) => b.onclick = () => copyText(applyUrl(b.dataset.copy)));
  if (manage) $('#rbx', el).onclick = () => modal({ title: 'Download the Roblox application center', body: `
      <p class="dim">Generates a ready-to-publish place file for <b>${esc(group().name)}</b>. The place contains no questions — its server script fetches this group’s open applications from the API every time, so edits you make here appear in-game without regenerating the file.</p>
      <div class="callout warn">${icon('alert')}<span>The file embeds a new API key in a server-only script. Do not share the file or make the place copyable. You can revoke the key any time on the API page.</span></div>
      <p class="hint">After opening it in Roblox Studio: publish the place, then make sure <b>Game Settings ${icon('arrowR', 'inl')} Security ${icon('arrowR', 'inl')} Allow HTTP Requests</b> is on.</p>`,
    actions: [{ label: 'Generate & download', kind: 'primary', onClick: async (close) => {
      const key = await createGameKey('Application center');
      downloadFile(`ApplicationCenter-${S.gid}.rbxlx`, await buildPlaceFile('appcenter', { apiUrl: ROBLOX_API_URL, apiKey: key, title: group().name }));
      close(); toast('Place file generated', 'good');
    } }] });
};

/** "Response validation" block for a question card (short answer, paragraph, checkboxes). */
function validationEditor(q) {
  const rules = FormRules.rulesFor(q.type);
  if (!rules.length) return '';
  const v = q.validation || {}, def = FormRules.RULES[v.rule];
  const groups = [...new Set(rules.map(([, r]) => r[1]))];
  const kind = !def ? '' : ['contains', 'notContains'].includes(v.rule) ? 'text' : ['matches', 'notMatches'].includes(v.rule) ? 'pattern' : 'number';
  const ph = { text: 'Text', pattern: 'Regular expression, e.g. [A-Za-z0-9_]{3,20}', number: def?.[1] === 'Number' ? 'Number' : 'Count' }[kind];
  return `<details class="rv" ${v.rule ? 'open' : ''}><summary class="hint" style="cursor:pointer">Response validation (optional)</summary>
    <div class="rv-row">
      <select data-v="rule" aria-label="Requirement"><option value="">No requirement</option>${groups.map((gname) => `<optgroup label="${esc(gname)}">${rules.filter(([, r]) => r[1] === gname).map(([id, r]) => `<option value="${id}" ${id === v.rule ? 'selected' : ''}>${esc(r[0])}</option>`).join('')}</optgroup>`).join('')}</select>
      ${def && def[3] >= 1 ? `<input data-v="a" value="${esc(v.a ?? '')}" placeholder="${esc(ph)}" aria-label="Value" ${kind === 'number' ? 'inputmode="decimal"' : ''}>` : ''}
      ${def && def[3] === 2 ? `<span class="muted">and</span><input data-v="b" value="${esc(v.b ?? '')}" placeholder="Number" aria-label="Second value" inputmode="decimal">` : ''}
      ${def ? `<input data-v="message" class="rv-msg" value="${esc(v.message || '')}" maxlength="200" placeholder="Custom error text (optional)" aria-label="Custom error text">` : ''}
    </div>
    ${kind === 'pattern' ? '<p class="hint">The whole answer must match. Example: <code>[A-Za-z0-9_]{3,20}</code> = a valid Roblox username.</p>' : ''}
    ${q.type === 'checkboxes' && def ? '<p class="hint">“Other” counts as one selection.</p>' : ''}
  </details>`;
}

/** Question list editor (applications and the access request form). Edits `qs` in place. */
const questionEditorHTML = () => `<div class="stack" id="qs"></div>
  <div class="row wrap"><select id="newType" style="width:auto" aria-label="Question type">${Q_TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><button class="btn" id="addQ">${icon('plus')} Add question</button></div>`;
function bindQuestionEditor(root, qs, { grading = true } = {}) {
  const box = $('#qs', root);
  const draw = () => {
    box.innerHTML = qs.length ? qs.map((q, i) => `<div class="qcard" data-i="${i}">
        <div class="bar-top"><span class="badge accent">${Q_LABEL[q.type]}</span><span class="grow"></span>
          ${q.type === 'section' ? '' : `<label class="check"><input type="checkbox" data-f="required" ${q.required ? 'checked' : ''}> Required</label>`}
          <button class="btn ghost icon sm" data-mv="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('up', 'sm')}</button>
          <button class="btn ghost icon sm" data-mv="1" ${i === qs.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('down', 'sm')}</button>
          <button class="btn ghost icon sm" data-dup aria-label="Duplicate question" title="Duplicate">${icon('copy', 'sm')}</button>
          <button class="btn ghost icon sm" data-rm aria-label="Remove question">${icon('trash', 'sm')}</button></div>
        <input data-f="label" value="${esc(q.label || '')}" placeholder="${q.type === 'section' ? 'Section title' : 'Question'}" aria-label="Question title" maxlength="300">
        <input data-f="description" value="${esc(q.description || '')}" placeholder="Help text (optional)" aria-label="Help text" maxlength="500">
        ${HAS_OPTS.includes(q.type) ? `<div class="stack gap-s">${(q.options || []).map((o, j) => `<div class="opt-row"><input data-opt="${j}" value="${esc(o)}" placeholder="Option ${j + 1}" aria-label="Option ${j + 1}" maxlength="120"><button class="btn ghost icon sm" data-rmopt="${j}" aria-label="Remove option">${icon('x', 'sm')}</button></div>`).join('')}
          ${q.other ? `<div class="opt-row"><input disabled placeholder="Other: (people type their own answer)" aria-label="Other option preview"><button class="btn ghost icon sm" data-f-off="other" aria-label="Remove Other option">${icon('x', 'sm')}</button></div>` : ''}
          <div class="row wrap gap-s"><button class="btn sm" data-addopt>${icon('plus', 'sm')} Add option</button>
            ${['choice', 'checkboxes'].includes(q.type) && !q.other ? `<button class="btn sm ghost" data-add-other>${icon('plus', 'sm')} Add “Other”</button>` : ''}
            <label class="check right"><input type="checkbox" data-f="shuffle" ${q.shuffle ? 'checked' : ''}> Shuffle option order</label></div></div>` : ''}
        ${q.type === 'date' ? '<p class="hint">People pick a date (year, month, day).</p>' : q.type === 'time' ? '<p class="hint">People pick a time of day (24-hour).</p>' : ''}
        ${validationEditor(q)}
        ${q.type === 'scale' ? `<div class="grid2"><label class="field">From<select data-f="min"><option ${q.min === 0 ? 'selected' : ''}>0</option><option ${q.min !== 0 ? 'selected' : ''}>1</option></select></label><label class="field">To<select data-f="max">${[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option ${n === (q.max || 5) ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>` : ''}
        ${q.type === 'scale' ? `<div class="grid2"><label class="field">Label for ${q.min ?? 1} (optional)<input data-f="minLabel" maxlength="60" value="${esc(q.minLabel || '')}" placeholder="e.g. Not likely"></label><label class="field">Label for ${q.max || 5} (optional)<input data-f="maxLabel" maxlength="60" value="${esc(q.maxLabel || '')}" placeholder="e.g. Very likely"></label></div>` : ''}
        ${q.type === 'number' ? `<div class="grid2"><label class="field">Minimum (optional)<input type="number" data-f="min" value="${q.min ?? ''}"></label><label class="field">Maximum (optional)<input type="number" data-f="max" value="${q.max ?? ''}"></label></div>` : ''}
        ${grading && GRADABLE.includes(q.type) ? `<details ${q.points ? 'open' : ''}><summary class="hint" style="cursor:pointer">Auto-grading (optional)</summary><div class="grid2" style="margin-top:8px">
          <label class="field">Points<input type="number" min="0" max="100" data-f="points" value="${q.points || ''}" placeholder="0 = not graded"></label>
          <label class="field">Correct answer${q.type === 'checkboxes' ? 's' : ''}${q.type === 'yesno' ? `<select data-f="correct"><option value=""></option><option ${q.correct === 'Yes' ? 'selected' : ''}>Yes</option><option ${q.correct === 'No' ? 'selected' : ''}>No</option></select>`
            : `<input data-f="correct" value="${esc(Array.isArray(q.correct) ? q.correct.join(' | ') : q.correct ?? '')}" placeholder="${q.type === 'checkboxes' ? 'Option A | Option B' : HAS_OPTS.includes(q.type) ? 'Exact option text' : 'Exact answer'}">`}</label></div>
          <p class="hint">Applicants never see correct answers or points.</p></details>` : ''}
      </div>`).join('') : `<div class="empty">${icon('file')}<div>No questions yet — add one below.</div></div>`;
  };
  draw();
  // Text edits update the model in place; only structural changes redraw.
  box.oninput = (e) => {
    const card = e.target.closest('.qcard'); if (!card) return;
    const q = qs[+card.dataset.i], t = e.target;
    if (t.dataset.opt !== undefined) q.options[+t.dataset.opt] = t.value;
    else if (t.dataset.v === 'rule') { if (e.type === 'change') { q.validation = t.value ? { rule: t.value, message: q.validation?.message || '' } : null; draw(); } }
    else if (t.dataset.v) { q.validation = { ...(q.validation || {}), [t.dataset.v]: t.value }; }
    else if (t.dataset.f === 'required' || t.dataset.f === 'shuffle') q[t.dataset.f] = t.checked;
    else if (t.dataset.f === 'correct' && q.type === 'checkboxes') q.correct = t.value.split('|').map((x) => x.trim()).filter(Boolean);
    else if (['min', 'max', 'points'].includes(t.dataset.f)) q[t.dataset.f] = t.value === '' ? null : Number(t.value);
    else if (t.dataset.f) q[t.dataset.f] = t.value;
  };
  box.onchange = box.oninput;
  box.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const i = +b.closest('.qcard').dataset.i, q = qs[i];
    if (b.dataset.rm !== undefined) qs.splice(i, 1);
    else if (b.dataset.mv) { const j = i + +b.dataset.mv; [qs[i], qs[j]] = [qs[j], qs[i]]; }
    else if (b.dataset.addopt !== undefined) q.options.push('');
    else if (b.dataset.addOther !== undefined) q.other = true;
    else if (b.dataset.fOff) q[b.dataset.fOff] = false;
    else if (b.dataset.dup !== undefined) qs.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(q)), id: '', label: q.label ? `${q.label} (copy)` : '' });
    else if (b.dataset.rmopt !== undefined) q.options.splice(+b.dataset.rmopt, 1);
    else return;
    draw();
  };
  $('#addQ', root).onclick = () => {
    const type = $('#newType', root).value;
    qs.push({ type, label: '', description: '', required: type !== 'section', ...(HAS_OPTS.includes(type) ? { options: ['', ''] } : {}), ...(type === 'scale' ? { min: 1, max: 5 } : {}) });
    draw(); $$('.qcard [data-f="label"]', box).pop().focus();
  };
}

async function appBuilder(el, id) {
  if (!can('manage_applications')) throw new Error('You do not have permission to edit applications.');
  const app = id ? (await api(`/api/applications/${id}`)).application : { title: '', description: '', questions: [], settings: { open: true, identity: 'username', allowWeb: true, allowGame: true } };
  const qs = app.questions.map((q) => ({ ...q, options: q.options ? [...q.options] : undefined }));
  const s = app.settings;
  const g = group();
  el.innerHTML = `<div><a href="#/applications" class="muted">${icon('arrowL', 'inl')} Applications</a></div>
    ${head(id ? 'Edit application' : 'New application', '', `${id ? `<button class="btn danger" id="del">${icon('trash')} Delete</button>` : ''}<button class="btn primary" id="save">${icon('check')} Save</button>`)}
    <div class="card"><div class="body stack">
      <label class="field">Title<input id="title" maxlength="100" value="${esc(app.title)}" placeholder="e.g. Staff application"></label>
      <label class="field">Description<textarea id="desc" maxlength="2000" placeholder="Shown at the top of the form">${esc(app.description)}</textarea></label>
    </div></div>
    <div class="card"><div class="head"><h2 class="grow">Questions</h2></div><div class="body stack">${questionEditorHTML()}</div></div>
    <div class="card"><div class="head"><h2>Settings</h2></div><div class="body stack">
      <div class="grid2">
        <label class="field">Who is applying?<select id="ident"><option value="username" ${s.identity !== 'discord' ? 'selected' : ''}>Applicant types their Roblox username</option><option value="discord" ${s.identity === 'discord' ? 'selected' : ''}>Must sign in with Discord (linked Roblox account)</option></select><small>Applies to the web form. In-game submissions are always the verified Roblox player.</small></label>
        <label class="field">Rank on acceptance (optional)<select id="arank"><option value="">Do not rank automatically</option>${rolesOf(g).filter((r) => r.rank < 255).map((r) => `<option value="${r.rank}" ${s.acceptRank === r.rank ? 'selected' : ''}>${esc(r.name)} (${r.rank})</option>`).join('')}</select><small>Uses Roblox Open Cloud when a reviewer accepts.</small></label>
      </div>
      <label class="field">Discord webhook (optional)<input id="hook" value="${esc(s.webhookUrl || '')}" placeholder="https://discord.com/api/webhooks/…"><small>Notified on new submissions and decisions.</small></label>
      <label class="field">Message after submitting<input id="succ" value="${esc(s.successMessage || '')}" placeholder="Your application has been submitted."></label>
      <div class="row wrap" style="gap:18px">
        <label class="check"><input type="checkbox" id="open" ${s.open === false ? '' : 'checked'}> Accepting submissions</label>
        <label class="check"><input type="checkbox" id="web" ${s.allowWeb === false ? '' : 'checked'}> Available on the web form</label>
        <label class="check"><input type="checkbox" id="game" ${s.allowGame === false ? '' : 'checked'}> Available in the Roblox application center</label>
      </div></div></div>`;

  bindQuestionEditor(el, qs);
  $('#save', el).onclick = (e) => run(e.currentTarget, async () => {
    const body = { title: val(el, '#title'), description: val(el, '#desc'), questions: qs,
      settings: { open: $('#open', el).checked, allowWeb: $('#web', el).checked, allowGame: $('#game', el).checked, identity: val(el, '#ident'), acceptRank: val(el, '#arank'), webhookUrl: val(el, '#hook'), successMessage: val(el, '#succ') } };
    if (id) await api(`/api/applications/${id}`, { method: 'PATCH', body }); else await api(G('/applications'), { body });
    toast('Application saved', 'good'); location.hash = '#/applications';
  });
  if (id) $('#del', el).onclick = async () => { if (await confirmBox('Delete application?', 'The form and all of its submissions will be permanently deleted.', 'Delete')) run(null, async () => { await api(`/api/applications/${id}`, { method: 'DELETE' }); location.hash = '#/applications'; }); };
}

async function appSubmissions(el, id) {
  const { application: app, submissions } = await api(`/api/applications/${id}/submissions`);
  el.innerHTML = `<div><a href="#/applications" class="muted">${icon('arrowL', 'inl')} Applications</a></div>
    ${head(app.title, `${submissions.filter((x) => x.status === 'pending').length} pending · ${submissions.length} shown`)}
    <div class="card"><div class="tbl-wrap"><table><thead><tr><th>Applicant</th><th>Submitted</th><th>Score</th><th>Status</th><th></th></tr></thead><tbody>
    ${submissions.length ? submissions.map((x) => `<tr class="click" data-id="${x.id}"><td>${who(x.roblox_name, `Roblox ${x.roblox_id}${x.discord_id ? ` · Discord ${x.discord_id}` : ''}`)}</td><td class="muted">${fmtTime(x.created_at)}</td>
      <td class="num">${x.max_score ? `${x.score}/${x.max_score}` : '—'}</td><td>${statusBadge(x.status)}${x.reviewer ? ` <span class="muted">by ${esc(x.reviewer)}</span>` : ''}</td>
      <td class="r"><a class="btn sm" href="#/submission/${x.id}">${x.status === 'pending' && can('review_applications') ? 'Decide' : 'View'}</a></td></tr>`).join('') : emptyRow(5, 'No submissions yet.', 'file')}
    </tbody></table></div></div>`;
  // The whole row opens the submission; the button inside is a real link for keyboard and middle-click.
  $('tbody', el).onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && !e.target.closest('a')) location.hash = `#/submission/${tr.dataset.id}`; };
}

/** One submission: every question with its answer, and Accept / Deny. Discord's "Decide" button links here. */
VIEWS.submission = async (el, id, _sub, reload) => {
  const { application: app, submission: x } = await api(`/api/submissions/${encodeURIComponent(id)}`);
  if (x.group_id !== S.gid) {
    if (!S.groups.some((g) => g.id === x.group_id)) throw new Error('This submission belongs to a group you cannot open.');
    enter(x.group_id, `#/submission/${x.id}`, true); return;
  }
  const review = can('review_applications'), pending = x.status === 'pending';
  const answer = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) ? '<span class="muted">No answer</span>' : esc(Array.isArray(v) ? v.join(', ') : v);
  const graded = (q, v) => {
    if (!q.points) return '';
    const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
    const norm = (s) => String(s ?? '').trim().toLowerCase();
    const ok = !empty && (q.type === 'checkboxes' ? v.length === q.correct.length && q.correct.every((c) => v.includes(c)) : norm(v) === norm(q.correct));
    return `<span class="badge ${ok ? 'good' : 'bad'}">${ok ? icon('check', 'sm') : icon('x', 'sm')} ${ok ? q.points : 0}/${q.points} pt</span>`;
  };
  let n = 0;
  el.innerHTML = `<div><a href="#/applications/${esc(app.id)}/submissions" class="muted">${icon('arrowL', 'inl')} ${esc(app.title)} submissions</a></div>
    ${head(x.roblox_name, `Applied for <b>${esc(app.title)}</b> · ${fmtTime(x.created_at)}`,
      `<a class="btn" target="_blank" rel="noopener" href="https://www.roblox.com/users/${encodeURIComponent(x.roblox_id)}/profile">${icon('external')} Roblox profile</a>`)}
    <div class="stats">
      ${stat('Status', statusBadge(x.status), x.reviewer ? `by ${esc(x.reviewer)}${x.reviewed_at ? ` · ${fmtTime(x.reviewed_at)}` : ''}` : 'Waiting for a decision', 'file')}
      ${stat('Score', x.max_score ? `${x.score}/${x.max_score}` : '—', x.max_score ? `${Math.round((x.score / x.max_score) * 100)}% auto-graded` : 'No graded questions', 'target')}
      ${stat('Roblox', esc(x.roblox_id), x.discord_id ? `Discord ${esc(x.discord_id)}` : 'No Discord linked', 'user')}
    </div>
    <div class="sub-grid">
      <div class="card"><div class="head"><h2 class="grow">Answers</h2></div><div class="body stack qa">
        ${app.questions.map((q) => q.type === 'section'
          ? `<h3 class="qa-sec">${esc(q.label)}</h3>`
          : `<div class="qa-item"><div class="qa-q"><b><span class="muted num">${++n}.</span> ${esc(q.label)}</b> ${graded(q, x.answers[q.id])}</div>
              <div class="qa-a">${answer(x.answers[q.id])}</div>
              ${q.points ? `<div class="hint">Expected: ${esc(Array.isArray(q.correct) ? q.correct.join(', ') : q.correct)}</div>` : ''}</div>`).join('')}
      </div></div>
      <div class="card decide"><div class="head"><h2 class="grow">Decide</h2></div><div class="body stack">
        ${pending && review ? `
          <label class="field">Note (optional)<textarea id="note" maxlength="500" placeholder="Shown in logs and the Discord notification"></textarea></label>
          ${app.settings.acceptRank ? `<p class="hint">Accepting sets their rank to <b>${esc(rolesOf().find((r) => r.rank === app.settings.acceptRank)?.name || app.settings.acceptRank)}</b> through Roblox Open Cloud.</p>` : ''}
          <div class="row wrap"><button class="btn danger grow" data-decide="denied">${icon('x')} Deny</button><button class="btn primary grow" data-decide="accepted">${icon('check')} Accept</button></div>`
        : pending ? `<p class="dim">Waiting for a reviewer. You need the “review applications” permission to decide.</p>`
        : `<p>${statusBadge(x.status)} by <b>${esc(x.reviewer || 'unknown')}</b>${x.reviewed_at ? ` <span class="muted">· ${fmtTime(x.reviewed_at)}</span>` : ''}</p>
           ${x.review_note ? `<div class="note"><b>Note:</b> ${esc(x.review_note)}</div>` : ''}`}
      </div></div>
    </div>`;
  $$('[data-decide]', el).forEach((b) => b.onclick = async () => {
    const status = b.dataset.decide;
    if (status === 'denied' && !await confirmBox(`Deny ${x.roblox_name}?`, `Their application for "${app.title}" will be marked as denied.`, 'Deny')) return;
    run(b, async () => {
      const r = await api(`/api/submissions/${x.id}`, { method: 'PATCH', body: { status, note: val(el, '#note') } });
      if (r.rankError) toast(`Accepted, but auto-rank failed: ${r.rankError}`, 'bad'); else toast(r.ranked ? `Accepted and ranked to ${r.ranked.name}` : `Application ${status}`, 'good');
      reload();
    });
  });
};

// ---------- logs ----------
VIEWS.logs = async (el) => {
  const TYPES = [['', 'Everything'], ['rank', 'Ranking'], ['requirement', 'Requirements'], ['timeoff', 'Time off'], ['activity', 'Activity'], ['member', 'Notes & warnings'], ['application', 'Applications'], ['session', 'Sessions'], ['shift', 'Shifts (clocking)'], ['moderation', 'Moderation'], ['group', 'Groups'], ['access', 'Access'], ['auth', 'Sign-ins'], ['link', 'Account links'], ['apikey', 'API keys']];
  const COLOR = { 'rank.promote': 'good', 'rank.demote': 'bad', 'requirement.not_met': 'bad', 'auth.denied': 'bad', 'access.revoked': 'bad', 'application.accepted': 'good', 'application.denied': 'bad', 'timeoff.approved': 'good', 'timeoff.denied': 'bad' };
  el.innerHTML = `${head('Logs', 'Everything the system does: promotions, demotions, missed requirements, sign-ins, settings changes and more.', `<button class="btn" id="csv">${icon('download')} Export CSV</button>`)}
    <div class="card"><div class="head">
      <select id="scope" style="width:auto" aria-label="Scope">${group() ? `<option value="${S.gid}">${esc(group().name)}</option>` : ''}<option value="">All groups + system</option>${S.groups.filter((g) => g.id !== S.gid).map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}</select>
      <select id="type" style="width:auto" aria-label="Type">${TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <div class="search grow">${icon('search', 'sm')}<input id="q" placeholder="Search by member, staff or text" aria-label="Search logs"></div></div>
      <div class="tbl-wrap"><table><thead><tr><th>When</th><th>Type</th><th>What happened</th><th>By</th></tr></thead><tbody id="rows"></tbody></table></div>
      <div class="body" id="more" style="text-align:center"></div></div>`;
  let next = null, shown = [];
  const load = async (append) => {
    const p = new URLSearchParams({ group: val(el, '#scope'), type: val(el, '#type'), q: val(el, '#q'), limit: 50 });
    if (append && next) p.set('before', next);
    const d = await api(`/api/logs?${p}`);
    next = d.next;
    shown = append ? shown.concat(d.logs) : d.logs;
    const html = d.logs.map((l) => `<tr><td class="muted" style="white-space:nowrap" title="${new Date(l.ts * 1000).toISOString()}">${fmtTime(l.ts)}</td><td><span class="badge ${COLOR[l.type] || ''}">${esc(l.type)}</span></td><td>${esc(l.summary)}</td><td class="dim">${esc(l.actor_name || l.actor_type)}</td></tr>`).join('');
    if (append) $('#rows', el).insertAdjacentHTML('beforeend', html); else $('#rows', el).innerHTML = html || emptyRow(4, 'No log entries match.', 'list');
    $('#more', el).innerHTML = next ? '<button class="btn" id="moreBtn">Load older</button>' : '';
    if (next) $('#moreBtn', el).onclick = (e) => run(e.currentTarget, () => load(true));
  };
  await load(false);
  let timer;
  $('#scope', el).onchange = $('#type', el).onchange = () => run(null, () => load(false));
  $('#q', el).oninput = () => { clearTimeout(timer); timer = setTimeout(() => run(null, () => load(false)), 300); };
  // Exports what the filters match, fetching older pages too (up to 5,000 rows).
  $('#csv', el).onclick = (e) => run(e.currentTarget, async () => {
    const rows = [...shown];
    let before = next;
    while (before && rows.length < 5000) {
      const p = new URLSearchParams({ group: val(el, '#scope'), type: val(el, '#type'), q: val(el, '#q'), limit: 200, before });
      const d = await api(`/api/logs?${p}`);
      rows.push(...d.logs); before = d.next;
    }
    downloadCSV(`logs-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Time (UTC)', 'Type', 'Summary', 'By', 'Actor type', 'Target ID', 'Target', 'Group ID'],
      ...rows.map((l) => [new Date(l.ts * 1000).toISOString().replace('T', ' ').slice(0, 19), l.type, l.summary, l.actor_name || '', l.actor_type || '', l.target_id || '', l.target_name || '', l.group_id || '']),
    ]);
  });
};

// ---------- groups ----------
VIEWS.groups = async (el, _a, _b, reload) => {
  if (!can('manage_groups')) throw new Error('You do not have permission to manage groups.');
  await loadGroups();
  const refresh = async () => { await loadGroups(); reload(); };
  el.innerHTML = `${head('Groups', 'Every Roblox group this system manages. Each has its own tracked ranks, requirements, applications and API key.', `<button class="btn primary" id="add">${icon('plus')} Add group</button>`)}
    ${S.groups.length ? S.groups.map((g) => `<div class="card" data-g="${g.id}"><div class="head"><div class="grow"><h2>${esc(g.name)}</h2><span class="muted">Group ID ${g.id}</span></div>
        ${g.hasApiKey ? '<span class="badge good">Open Cloud connected</span>' : '<span class="badge warn">No Open Cloud key</span>'}
        <button class="btn sm" data-a="setup">${icon('roblox', 'sm')} Roblox setup</button><button class="btn sm" data-a="roles">${icon('refresh', 'sm')} Refresh roles</button>
        <button class="btn sm" data-a="edit">${icon('sliders', 'sm')} Settings</button><button class="btn sm danger icon" data-a="del" aria-label="Remove group">${icon('trash', 'sm')}</button></div>
      <div class="body stack"><div><h3>Tracked ranks</h3><p class="hint">Only members in ticked ranks have activity recorded and requirements checked.</p></div>
        ${rolesOf(g).length ? `<div class="row wrap" style="gap:8px 18px">${rolesOf(g).map((r) => `<label class="check"><input type="checkbox" data-rank="${r.rank}" ${g.trackedRanks.includes(r.rank) ? 'checked' : ''}> ${esc(r.name)} <span class="muted">(${r.rank})</span></label>`).join('')}</div>
        <div><button class="btn primary sm" data-a="saveRanks">Save tracked ranks</button></div>` : `<div class="callout">${icon('info')}<span>Add an Open Cloud API key in Settings to load this group’s roles.</span></div>`}
      </div></div>`).join('') : `<div class="card"><div class="empty">${icon('users')}<div>No groups yet.</div></div></div>`}`;

  const keyHelp = `<small>Create at <a href="https://create.roblox.com/dashboard/credentials" target="_blank" rel="noopener">create.roblox.com ${icon('arrowR', 'inl')} Open Cloud ${icon('arrowR', 'inl')} API keys</a> with the <code>group:read</code> and <code>group:write</code> permissions for this group. The key’s owner needs permission to manage members in the group. Stored encrypted.</small>`;
  $('#add', el).onclick = () => modal({ title: 'Add a Roblox group', body: `
      <label class="field">Group ID<input id="id" inputmode="numeric" placeholder="e.g. 1234567"><small>The number in the group’s URL.</small></label>
      <label class="field">Open Cloud API key<input id="key" type="password" autocomplete="off">${keyHelp}</label>`,
    actions: [{ label: 'Add group', kind: 'primary', onClick: async (close, m) => { const r = await api('/api/groups', { body: { id: val(m, '#id'), apiKey: val(m, '#key') } }); close(); toast(`Added ${r.name}`, 'good'); refresh(); } }] });

  el.onclick = async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const card = b.closest('[data-g]'), g = S.groups.find((x) => x.id === card.dataset.g), path = `/api/groups/${g.id}`;
    const a = b.dataset.a;
    if (a === 'saveRanks') run(b, async () => { await api(path, { method: 'PATCH', body: { trackedRanks: $$('[data-rank]:checked', card).map((i) => Number(i.dataset.rank)) } }); toast('Tracked ranks saved', 'good'); refresh(); });
    if (a === 'roles') run(b, async () => { await api(`${path}/sync-roles`, { method: 'POST' }); toast('Roles refreshed', 'good'); refresh(); });
    if (a === 'del' && await confirmBox(`Remove ${g.name}?`, 'All activity, requirements, time off, applications and submissions for this group will be permanently deleted, and its API keys revoked.', 'Remove group')) run(b, async () => { await api(path, { method: 'DELETE' }); refresh(); });
    if (a === 'edit') modal({ title: `${g.name} — settings`, body: `
        <label class="field">Display name<input id="name" value="${esc(g.name)}"></label>
        <label class="field">Replace Open Cloud API key<input id="key" type="password" autocomplete="off" placeholder="${g.hasApiKey ? 'Leave blank to keep the current key' : 'Paste a key'}">${keyHelp}</label>
        <label class="field">Highest rank this system may assign<input id="max" type="number" min="1" max="254" value="${g.settings.ranking?.maxRank || 254}"><small>Promotions, set-rank and auto-rank on acceptance never go above this, and members above it cannot be changed.</small></label>
        <label class="field">Log webhook<input id="log" value="${esc(g.settings.logWebhook || '')}" placeholder="https://discord.com/api/webhooks/…"><small>Every log entry for this group is mirrored to this Discord channel.</small></label>
        <label class="field">News webhook<input id="nw" value="${esc(g.settings.news?.webhookUrl || '')}" placeholder="https://discord.com/api/webhooks/…"><small>News posts marked “announce” are sent here.</small></label>
        <label class="field">Moderation log webhook<input id="modHook" value="${esc(g.settings.moderation?.webhookUrl || '')}" placeholder="https://discord.com/api/webhooks/…"><small>Kicks, bans and warnings from your admin system's plugin, and kicks from Live servers, are posted here.</small></label>
        <h3 class="set-h">${icon('clock', 'sm')} Sessions</h3>
        <label class="field">Session announcements webhook<input id="ev" value="${esc(g.settings.events?.webhookUrl || '')}" placeholder="https://discord.com/api/webhooks/…"><small>New sessions are announced here, and so are reminders.</small></label>
        <div class="grid2">
          <label class="field">Reminder before a session<select id="evr">${[[0, 'No reminder'], [10, '10 minutes before'], [15, '15 minutes before'], [30, '30 minutes before'], [60, '1 hour before'], [120, '2 hours before']].map(([v, l]) => `<option value="${v}" ${(g.settings.events?.remindMinutes ?? 30) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field">Role to ping (optional)<input id="evrole" inputmode="numeric" value="${esc(g.settings.events?.mentionRoleId || '')}" placeholder="Discord role ID"></label>
        </div>
        <h3 class="set-h">${icon('trophy', 'sm')} Staff of the week</h3>
        <label class="check"><input type="checkbox" id="lbOn" ${g.settings.leaderboard?.enabled ? 'checked' : ''}> Post a weekly leaderboard to Discord (top members by hours and by sessions over the last 7 days)</label>
        <label class="field">Leaderboard webhook<input id="lbHook" value="${esc(g.settings.leaderboard?.webhookUrl || '')}" placeholder="https://discord.com/api/webhooks/…"></label>
        <div class="grid3">
          <label class="field">Day<select id="lbDay">${WEEKDAY_NAMES.map((d, i) => `<option value="${i}" ${(g.settings.leaderboard?.day ?? 6) === i ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
          <label class="field">Time (UTC)<select id="lbHour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${(g.settings.leaderboard?.hour ?? 18) === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></label>
          <label class="field">Show<select id="lbTop">${[3, 5, 10].map((n) => `<option value="${n}" ${(g.settings.leaderboard?.top ?? 5) === n ? 'selected' : ''}>Top ${n}</option>`).join('')}</select></label>
        </div>
        ${g.settings.leaderboard?.webhookUrl ? `<div><button type="button" class="btn sm" id="lbPost">${icon('trophy', 'sm')} Post this week’s leaderboard now</button> <span class="hint">Uses the saved settings.</span></div>` : ''}`,
      actions: [{ label: 'Save', kind: 'primary', onClick: async (close, m) => {
        const body = { name: val(m, '#name'), ranking: { maxRank: Number(val(m, '#max')) }, logWebhook: val(m, '#log'), news: { webhookUrl: val(m, '#nw') }, moderation: { webhookUrl: val(m, '#modHook') },
          events: { webhookUrl: val(m, '#ev'), remindMinutes: Number(val(m, '#evr')), mentionRoleId: val(m, '#evrole') },
          leaderboard: { enabled: $('#lbOn', m).checked, webhookUrl: val(m, '#lbHook'), day: Number(val(m, '#lbDay')), hour: Number(val(m, '#lbHour')), top: Number(val(m, '#lbTop')) } };
        if (val(m, '#key')) body.apiKey = val(m, '#key');
        await api(path, { method: 'PATCH', body }); close(); toast('Group settings saved', 'good'); refresh();
      } }] });
    if (a === 'edit' && $('#lbPost')) $('#lbPost').onclick = (ev) => run(ev.currentTarget, async () => { await api(`${path}/leaderboard/post`, { method: 'POST' }); toast('Leaderboard posted to Discord', 'good'); });
    if (a === 'setup') robloxSetup(g);
  };
};

function robloxSetup(g = group()) {
  const m = modal({ title: `Roblox setup — ${g.name}`, wide: true, body: `
      <p class="dim">These connect this group’s Roblox games to the system. The tracker loader and the application center each create a fresh API key for this group and embed it in a <b>server-only</b> script — never share those files or put the key in a LocalScript. The admin plugins hold no key.</p>
      <div class="card"><div class="body stack gap-s"><h3>1 · Activity tracker (ModuleScript)</h3>
        <p class="dim">Insert the downloaded file into <code>ServerScriptService</code> of your main game (right-click › <b>Insert from File…</b>). The module + loader download has everything; the module alone needs the loader script next to it. It reports playtime, idle and duty time and chat messages every minute, kicks blacklisted players, and powers Live servers (announcements, kicks, shutdowns).</p>
        <div class="row wrap"><button class="btn" data-d="module">${icon('download')} ActivityTracker.rbxmx</button>${can('manage_api_keys') ? `<button class="btn" data-d="bundle">${icon('download')} Module + loader (new key)</button>` : ''}<button class="btn" data-d="loader">${icon('copy')} Copy loader script (with new key)</button></div></div></div>
      <div class="card"><div class="body stack gap-s"><h3>2 · Application center</h3>
        <p class="dim">A place that loads this group’s open applications from the API and submits answers as the verified player.</p>
        <div class="row wrap"><button class="btn" data-d="appcenter">${icon('download')} ApplicationCenter.rbxlx</button></div></div></div>
      ${adminPluginsCard()}
      <p class="hint">${icon('download', 'inl')} Everything here is also on the <a href="#/downloads" onclick="this.closest('.overlay').remove()">Downloads</a> page, with data exports.</p>
      <p class="hint">In every place: enable <b>Game Settings ${icon('arrowR', 'inl')} Security ${icon('arrowR', 'inl')} Allow HTTP Requests</b>. Keys can be revoked on the API page. The verification game is shared by every group — the owner sets it up from their own menu.</p>` });
  bindAdminPlugins(m.el);
  m.el.onclick = (e) => {
    const b = e.target.closest('[data-d]'); if (!b) return;
    run(b, async () => {
      const d = b.dataset.d;
      if (d === 'module') { const f = await buildTrackerModel(); return downloadFile(f.name, f.xml); }
      const key = await createGameKey({ loader: 'Activity tracker', bundle: 'Activity tracker', appcenter: 'Application center' }[d], g.id);
      if (d === 'bundle') { const f = await buildTrackerModel({ apiUrl: ROBLOX_API_URL, apiKey: key }); downloadFile(f.name, f.xml); return toast('Downloaded — insert it into ServerScriptService', 'good'); }
      if (d === 'loader') return copyText(`-- Script in ServerScriptService (next to the ActivityTracker ModuleScript)\nlocal ActivityTracker = require(script.Parent:WaitForChild("ActivityTracker"))\n\nActivityTracker.Start({\n\tApiUrl = "${ROBLOX_API_URL}",\n\tApiKey = "${key}",\n})\n`);
      downloadFile(`ApplicationCenter-${g.id}.rbxlx`, await buildPlaceFile('appcenter', { apiUrl: ROBLOX_API_URL, apiKey: key, title: g.name }));
      toast('Place file generated', 'good');
    });
  };
}

// ---------- API keys ----------
VIEWS.api = async (el, _a, _b, reload) => {
  if (!can('manage_api_keys')) throw new Error('You do not have permission to manage API keys.');
  const { keys } = await api('/api/keys');
  const SC = { read: 'Read activity, members, requirements, logs, links', ranking: 'Promote / demote / set rank', timeoff: 'Submit time-off requests', game: 'Roblox game: heartbeats, in-game applications', verify: 'Verification game: confirm link codes (system-wide — leave the group empty)' };
  el.innerHTML = `${head('API', 'Keys for bots, websites and your Roblox games.', `<a class="btn" href="docs.html" target="_blank" rel="noopener">${icon('book')} API docs</a><button class="btn primary" id="add">${icon('plus')} New key</button>`)}
    <div class="card"><div class="body row wrap"><span class="dim">Base URL</span><code class="grow">${esc(ROBLOX_API_URL)}/v1</code><button class="btn sm" id="cp">${icon('copy', 'sm')} Copy</button></div>
      <div class="body hint" style="padding-top:0">Works from Roblox games, Discord bots and websites.</div></div>
    <div class="card"><div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Key</th><th>Group</th><th>Scopes</th><th>Last used</th><th></th></tr></thead><tbody>
    ${keys.length ? keys.map((k) => `<tr><td><b>${esc(k.name)}</b><br><span class="muted">by ${esc(k.created_by || '?')} · ${fmtDate(k.created_at)}</span></td><td class="mono">${esc(k.prefix)}…</td>
      <td>${k.group_id ? esc(S.groups.find((g) => g.id === k.group_id)?.name || k.group_id) : '<span class="muted">All groups</span>'}</td><td>${k.scopes.map((s) => `<span class="badge">${s}</span>`).join(' ')}</td>
      <td class="muted">${k.last_used ? ago(k.last_used) : 'Never'}</td><td class="r">${k.scopes.includes('verify') && !isOwner() ? '<span class="muted small">Owner only</span>' : `<button class="btn sm danger" data-rev="${k.id}">Revoke</button>`}</td></tr>`).join('') : emptyRow(6, 'No API keys yet.', 'key')}
    </tbody></table></div></div>`;
  $('#cp', el).onclick = () => copyText(`${ROBLOX_API_URL}/v1`);
  $('#add', el).onclick = () => modal({ title: 'New API key', body: `
      <label class="field">Name<input id="n" placeholder="e.g. Discord bot"></label>
      <label class="field">Group<select id="g"><option value="">All groups</option>${S.groups.map((g) => `<option value="${g.id}" ${g.id === S.gid ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
      <div class="stack gap-s"><b style="font-size:13px">Scopes</b>${S.scopes.filter((s) => s !== 'verify' || isOwner()).map((s) => `<label class="check"><input type="checkbox" data-s="${s}" ${s === 'read' ? 'checked' : ''}> <code>${s}</code> <span class="dim">${SC[s] || ''}</span></label>`).join('')}</div>`,
    actions: [{ label: 'Create key', kind: 'primary', onClick: async (close, m) => {
      const r = await api('/api/keys', { body: { name: val(m, '#n'), groupId: val(m, '#g'), scopes: $$('[data-s]:checked', m).map((i) => i.dataset.s) } });
      close();
      modal({ title: 'Copy your API key', body: `<div class="callout warn">${icon('alert')}<span>This is the only time the full key is shown. Store it somewhere safe.</span></div><pre><code id="k">${esc(r.key)}</code></pre>`, actions: [{ label: 'Copy', kind: 'primary', onClick: () => copyText(r.key) }] });
      reload();
    } }] });
  $$('[data-rev]', el).forEach((b) => b.onclick = async () => { if (await confirmBox('Revoke key?', 'Anything using this key will stop working immediately.', 'Revoke')) run(b, async () => { await api(`/api/keys/${b.dataset.rev}`, { method: 'DELETE' }); reload(); }); });
};

// ---------- linked accounts ----------
/** Owner Menu, Verification game: one place for the whole system — download it and set its Roblox link. */
VIEWS.verification = async (el, _a, _b, reload) => {
  if (!isOwner()) throw new Error('Only the owner can set up the verification game.');
  const gameUrl = (await api('/public/verify-game')).url;
  el.innerHTML = `${head('Verification game', 'Players link their Discord and Roblox accounts in this game. There is one for the whole system — it serves every group.', `<a class="btn" href="verify.html" target="_blank" rel="noopener">${icon('external')} Verify page</a><a class="btn" href="#/links">${icon('link')} Linked accounts</a>`)}
    <div class="card"><div class="head"><h2 class="grow">Set up</h2>${gameUrl ? '<span class="badge good">Link set</span>' : '<span class="badge warn">No link yet</span>'}</div><div class="body stack">
      <p class="dim">One small place for the whole system: players get a code on the Verify page (or My account), type it in this game, and are kicked once their accounts are linked.</p>
      <div class="vg-steps">
        <div class="stack gap-s"><b>1 · Download and publish</b><span class="hint">Creates a system API key that can only verify. Publish the place on Roblox and turn on <b>Allow HTTP Requests</b>.</span>
          <div><button class="btn" id="vgDownload">${icon('download')} VerificationGame.rbxlx</button></div></div>
        <div class="stack gap-s"><b>2 · Paste the game’s link</b><span class="hint">Shown to players as a <b>Join to Verify</b> button on the Verify page and in My account.</span>
          <div class="row wrap gap-s"><input id="vgUrl" class="grow" style="min-width:0;flex:1 1 240px" value="${esc(gameUrl)}" placeholder="https://www.roblox.com/games/1234567890/Verify" aria-label="Verification game link">
            <button class="btn primary" id="vgSave">${icon('check')} Save</button>${gameUrl ? `<a class="btn ghost" href="${esc(gameUrl)}" target="_blank" rel="noopener noreferrer">${icon('external')} Open</a>` : ''}</div></div>
      </div>
    </div></div>
    <div class="card"><div class="head"><h2>How players verify</h2></div><div class="body">
      <ol class="dim" style="margin:0;padding-left:20px;display:grid;gap:6px">
        <li>They open the <a href="verify.html" target="_blank" rel="noopener">Verify page</a> and sign in with Discord (staff can use <b>My account ${icon('arrowR', 'inl')} Link Roblox</b> instead).</li>
        <li>They get a 6-character code and press <b>Join to Verify</b>.</li>
        <li>In the game they type the code; once it’s linked, the game kicks them with a confirmation.</li>
      </ol>
      <p class="hint" style="margin-bottom:0">Re-downloading creates a new key; revoke old “Verification game — system” keys on the API keys page if you replace the place.</p>
    </div></div>`;
  $('#vgSave', el).onclick = (e) => run(e.currentTarget, async () => {
    await api('/api/verify-game', { method: 'PUT', body: { url: val(el, '#vgUrl') } });
    verifyGamePromise = null;
    toast(val(el, '#vgUrl') ? 'Verification game link saved' : 'Verification game link removed', 'good'); reload();
  });
  $('#vgDownload', el).onclick = (e) => run(e.currentTarget, async () => {
    // System-wide: no group, and only the "verify" scope — it can link accounts and nothing else.
    const { key } = await api('/api/keys', { body: { name: 'Verification game — system', scopes: ['verify'] } });
    downloadFile('VerificationGame.rbxlx', await buildPlaceFile('verify', { apiUrl: ROBLOX_API_URL, apiKey: key, title: NAME }));
    toast('Place file downloaded — publish it, then paste its link here', 'good');
  });
};

VIEWS.links = async (el) => {
  el.innerHTML = `${head('Linked accounts', 'Discord-to-Roblox links made through the verification game. Links are used to ping members in requirement notices and to identify applicants.', `<a class="btn" href="verify.html" target="_blank" rel="noopener">${icon('external')} Verify page</a>${isOwner() ? `<a class="btn" href="#/verification">${icon('roblox')} Verification game</a>` : ''}`)}
    <div class="card"><div class="head"><div class="search grow">${icon('search', 'sm')}<input id="q" placeholder="Search by Roblox or Discord name / ID" aria-label="Search links"></div></div>
    <div class="tbl-wrap"><table><thead><tr><th>Roblox</th><th>Discord</th><th>Linked</th><th></th></tr></thead><tbody id="rows"></tbody></table></div></div>`;
  const load = async () => {
    const { links } = await api(`/api/links?q=${encodeURIComponent(val(el, '#q'))}`);
    $('#rows', el).innerHTML = links.length ? links.map((l) => `<tr><td>${who(l.roblox_name || l.roblox_id, `ID ${l.roblox_id}`)}</td><td>${esc(l.discord_name || '')} <span class="muted mono">${esc(l.discord_id)}</span></td><td class="muted">${fmtDate(l.linked_at)}</td>
      <td class="r">${can('manage_groups') ? `<button class="btn ghost icon sm" data-del="${esc(l.discord_id)}" aria-label="Remove link">${icon('trash', 'sm')}</button>` : ''}</td></tr>`).join('') : emptyRow(4, 'No linked accounts found.', 'link');
    $$('[data-del]', el).forEach((b) => b.onclick = async () => { if (await confirmBox('Remove link?', 'The member will need to verify again.', 'Remove')) run(b, async () => { await api(`/api/links/${b.dataset.del}`, { method: 'DELETE' }); load(); }); });
  };
  await load();
  let timer;
  $('#q', el).oninput = () => { clearTimeout(timer); timer = setTimeout(() => run(null, load), 300); };
};

// ---------- access (owner) ----------
VIEWS.access = async (el, _a, _b, reload) => {
  if (S.user.role !== 'owner') throw new Error('Only the owner can manage access.');
  const { users } = await api('/api/users');
  const P = PERM_LABELS;
  const form = (u = {}) => `
      <label class="field">Name<input id="n" value="${esc(u.name || '')}" placeholder="Shown in logs"></label>
      <div class="grid2"><label class="field">Google email<input id="ge" type="email" value="${esc(u.googleEmail || '')}" placeholder="name@gmail.com"></label>
      <label class="field">Discord user ID<input id="di" inputmode="numeric" value="${esc(u.discordId || '')}" placeholder="e.g. 123456789012345678"></label></div>
      <label class="field">Roblox user ID (optional)<input id="ri" inputmode="numeric" value="${esc(u.robloxId || '')}"></label>
      <p class="hint">They can sign in with either identity you enter, then link the other one themselves from My account.</p>
      <div class="stack gap-s"><b style="font-size:13px">Permissions</b><span class="hint">Everyone on the whitelist can view activity, requirements, time off and sessions.</span>
      ${S.permissions.map((p) => `<label class="check"><input type="checkbox" data-p="${p}" ${u.permissions?.includes(p) ? 'checked' : ''}> ${P[p] || p}</label>`).join('')}</div>`;
  const read = (m) => ({ name: val(m, '#n'), googleEmail: val(m, '#ge'), discordId: val(m, '#di'), robloxId: val(m, '#ri'), permissions: $$('[data-p]:checked', m).map((i) => i.dataset.p) });
  el.innerHTML = `${head('Access', 'This system is whitelist-only. Only people listed here can sign in, and only you can change this list.', `<button class="btn primary" id="add">${icon('plus')} Whitelist someone</button>`)}
    <div class="card"><div class="tbl-wrap"><table><thead><tr><th>User</th><th>Google</th><th>Discord</th><th>Roblox</th><th>Permissions</th><th>Last sign-in</th><th></th></tr></thead><tbody>
    ${users.map((u) => `<tr><td>${who(u.name || u.googleEmail || u.discordId, u.role === 'owner' ? 'Owner' : '')}</td>
      <td>${u.googleEmail ? esc(u.googleEmail) : '<span class="muted">—</span>'}</td><td>${u.discordId ? `${esc(u.discordName || '')} <span class="muted mono">${esc(u.discordId)}</span>` : '<span class="muted">—</span>'}</td>
      <td>${u.robloxId ? `${esc(u.robloxName || '')} <span class="muted mono">${esc(u.robloxId)}</span>` : '<span class="muted">—</span>'}</td>
      <td>${u.role === 'owner' ? '<span class="badge accent">Everything</span>' : u.permissions.length ? u.permissions.map((p) => `<span class="badge">${p.replace(/_/g, ' ')}</span>`).join(' ') : '<span class="badge">View only</span>'}</td>
      <td class="muted">${u.lastLogin ? ago(u.lastLogin) : 'Never'}</td>
      <td class="r">${u.role === 'owner' ? '' : `<div class="row" style="justify-content:flex-end"><button class="btn ghost icon sm" data-edit="${u.id}" aria-label="Edit">${icon('edit', 'sm')}</button><button class="btn ghost icon sm" data-del="${u.id}" aria-label="Remove">${icon('trash', 'sm')}</button></div>`}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  $('#add', el).onclick = () => modal({ title: 'Whitelist someone', body: form(), actions: [{ label: 'Add to whitelist', kind: 'primary', onClick: async (close, m) => { await api('/api/users', { body: read(m) }); close(); toast('Added to the whitelist', 'good'); reload(); } }] });
  $$('[data-edit]', el).forEach((b) => b.onclick = () => { const u = users.find((x) => x.id == b.dataset.edit); modal({ title: `Edit access — ${u.name || u.googleEmail || u.discordId}`, body: form(u), actions: [{ label: 'Save', kind: 'primary', onClick: async (close, m) => { await api(`/api/users/${u.id}`, { method: 'PATCH', body: read(m) }); close(); toast('Access updated', 'good'); reload(); } }] }); });
  $$('[data-del]', el).forEach((b) => b.onclick = async () => { if (await confirmBox('Remove from whitelist?', 'They will be signed out immediately and can no longer sign in.', 'Remove')) run(b, async () => { await api(`/api/users/${b.dataset.del}`, { method: 'DELETE' }); reload(); }); });
};

// ---------- my account ----------
VIEWS.account = async (el, _a, _b, reload) => {
  const u = (await api('/api/me')).user;
  S.user = u;
  const rowFor = (key, ic, label, value, linked) => `<tr><td><div class="row">${icon(ic)} <b>${label}</b></div></td><td>${linked ? esc(value) : '<span class="muted">Not linked</span>'}</td>
    <td class="r">${linked ? `<button class="btn sm" data-unlink="${key}">Unlink</button>` : `<button class="btn sm primary" data-link="${key}">Link</button>`}</td></tr>`;
  el.innerHTML = `${head('My account', 'Link your Google, Discord and Roblox accounts so you can sign in with either and be recognised everywhere.')}
    <div class="card"><div class="tbl-wrap"><table><tbody>
      ${rowFor('google', 'google', 'Google', u.googleEmail, !!u.googleEmail)}
      ${rowFor('discord', 'discord', 'Discord', `${u.discordName || ''} (${u.discordId})`, !!u.discordId)}
      ${rowFor('roblox', 'roblox', 'Roblox', `${u.robloxName || ''} (${u.robloxId})`, !!u.robloxId)}
    </tbody></table></div></div>
    <div class="card"><div class="head"><h2>Your permissions</h2></div><div class="body row wrap">${u.role === 'owner' ? '<span class="badge accent">Owner — everything</span>' : u.permissions.length ? u.permissions.map((p) => `<span class="badge">${p.replace(/_/g, ' ')}</span>`).join('') : '<span class="badge">View only</span>'}</div></div>`;
  $$('[data-link]', el).forEach((b) => b.onclick = () => run(b, async () => {
    const p = b.dataset.link;
    if (p !== 'roblox') { location.href = (await api('/api/auth/link', { body: { provider: p } })).url; return; }
    const { code } = await api('/api/me/verify-code', { method: 'POST' });
    const join = await joinVerifyButton('btn primary');
    modal({ title: 'Link your Roblox account', body: `<p class="dim">Join the verification game on Roblox and enter this code. It expires in 15 minutes.</p><div class="codebox">${esc(code)}</div>${join ? `<div>${join}</div>` : ''}<p class="hint">You’ll be kicked from the game once it’s linked. This page updates after you close this window.</p>`, actions: [{ label: 'Done', kind: 'primary', onClick: (close) => { close(); reload(); } }] });
  }));
  $$('[data-unlink]', el).forEach((b) => b.onclick = async () => { if (await confirmBox(`Unlink ${b.dataset.unlink}?`, 'You can link it again at any time.', 'Unlink')) run(b, async () => { await api('/api/auth/unlink', { body: { provider: b.dataset.unlink } }); reload(); }); });
};

// ---------- Owner Menu overview ----------
VIEWS.ownerHome = async (el) => {
  if (!isOwner()) throw new Error('Only the owner can open the Owner Menu.');
  const [users, keys, links, logs, overviews] = await Promise.all([
    api('/api/users'), api('/api/keys'), api('/api/links'), api('/api/logs?limit=12'),
    Promise.all(S.groups.map((g) => api(`/api/groups/${g.id}/overview`).catch(() => null))),
  ]);
  const gname = (id) => S.groups.find((g) => g.id === id)?.name;
  const staff = users.users.filter((u) => u.role !== 'owner');
  el.innerHTML = `${head('Owner Menu', 'Everything that spans all of your groups. Pick a group from the switcher to manage its activity, ranking and applications.', `<a class="btn" href="#/access">${icon('shield')} Whitelist someone</a><a class="btn primary" href="#/groups">${icon('plus')} Add a group</a>`)}
    <div class="stats">
      ${stat('Groups', S.groups.length, `${S.groups.filter((g) => g.hasApiKey).length} with Open Cloud`, 'users')}
      ${stat('Whitelisted staff', staff.length, `${staff.filter((u) => u.lastLogin && Date.now() / 1000 - u.lastLogin < 7 * 86400).length} signed in this week`, 'shield')}
      ${stat('API keys', keys.keys.length, `${keys.keys.filter((k) => k.scopes.includes('game')).length} used by games`, 'key')}
      ${stat('Linked accounts', links.links.length >= 200 ? '200+' : links.links.length, 'Discord-to-Roblox', 'link')}
    </div>
    <div class="card"><div class="head"><h2 class="grow">Your groups</h2><a class="btn sm ghost" href="#/groups">Manage</a></div>
      <div class="tbl-wrap"><table><thead><tr><th>Group</th><th class="r">Tracked</th><th class="r">In game</th><th class="r">Hours this week</th><th class="r">Pending</th><th></th></tr></thead><tbody>
      ${S.groups.length ? S.groups.map((g, i) => { const o = overviews[i]; return `<tr><td>${who(g.name, `ID ${g.id}`)}</td>
        <td class="r num">${o ? o.trackedMembers : '—'}</td><td class="r num">${o ? `${o.online ? '<span class="dot"></span> ' : ''}${o.online}` : '—'}</td>
        <td class="r num">${o ? fmtHours(o.week.seconds) : '—'}</td><td class="r">${o && o.pendingTimeOff + o.pendingApplications ? `<span class="badge warn">${o.pendingTimeOff + o.pendingApplications}</span>` : '<span class="muted">0</span>'}</td>
        <td class="r"><button class="btn sm" data-open="${esc(g.id)}">Open ${icon('external', 'sm')}</button></td></tr>`; }).join('') : emptyRow(6, 'No groups yet — add one to start tracking.', 'users')}
      </tbody></table></div></div>
    <div class="card"><div class="head"><h2 class="grow">Latest across all groups</h2><a class="btn sm ghost" href="#/logs">All logs</a></div>
      <div class="tbl-wrap"><table><tbody>${logs.logs.length ? logs.logs.map((l) => `<tr><td class="muted" style="white-space:nowrap">${ago(l.ts)}</td><td>${l.group_id ? `<span class="badge">${esc(gname(l.group_id) || l.group_id)}</span>` : '<span class="badge accent">system</span>'}</td><td>${esc(l.summary)}</td></tr>`).join('') : emptyRow(3, 'Nothing logged yet.', 'list')}</tbody></table></div></div>`;
  el.onclick = (e) => { const b = e.target.closest('[data-open]'); if (b) enter(b.dataset.open); };
};

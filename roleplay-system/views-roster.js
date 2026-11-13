// Views: Roster (departments, callsigns, certifications) and Reports (types, filing, review).
'use strict';

const colorDot = (c) => `<i class="cdot" style="--c:${esc(c || '#5b8def')}"></i>`;
const chip = (name, color, extra = '') => `<span class="rchip" style="--c:${esc(color || '#5b8def')}">${colorDot(color)}${esc(name)}${extra}</span>`;
const daysLeft = (ts) => Math.ceil((ts - Date.now() / 1000) / 86400);
const certChip = (c, type) => chip(type?.name || c.name || 'Certification', type?.color || c.color, c.expiresAt && daysLeft(c.expiresAt) <= 14 ? ` <small class="muted">${daysLeft(c.expiresAt)}d</small>` : '');

// ---------- shared dialogs (also used by the member profile and session register) ----------
function rosterEditModal(member, departments, done) {
  modal({ title: `Roster — ${member.username}`, body: `
      <label class="field">Callsign / badge number<input id="cs" maxlength="24" value="${esc(member.callsign || '')}" placeholder="e.g. 1-ADAM-12, #2041, FD-7"><small>Unique within the group. Leave empty for none.</small></label>
      <div class="stack gap-s"><b class="small">Departments</b>${departments.length ? departments.map((d) => `<label class="check"><input type="checkbox" data-dep="${d.id}" ${(member.departments || []).includes(d.id) ? 'checked' : ''}> ${colorDot(d.color)} ${esc(d.name)}</label>`).join('') : '<span class="hint">No departments yet — create them on the Roster page.</span>'}</div>`,
    actions: [{ label: 'Save', kind: 'primary', onClick: async (close, m) => {
      await api(G(`/members/${member.robloxId}/roster`), { method: 'PUT', body: { callsign: val(m, '#cs'), departments: $$('[data-dep]:checked', m).map((i) => Number(i.dataset.dep)) } });
      close(); toast('Roster updated', 'good'); done();
    } }] });
}
function awardModal(certTypes, users, done, presetId) {
  if (!certTypes.length) return toast('Create a certification on the Roster page first', 'bad');
  modal({ title: 'Award a certification', body: `
      <label class="field">Certification<select id="ct">${certTypes.map((c) => `<option value="${c.id}" ${c.id === presetId ? 'selected' : ''}>${esc(c.name)}${c.validDays ? ` (valid ${c.validDays} days)` : ''}</option>`).join('')}</select></label>
      <label class="field">Members<textarea id="us" rows="3" placeholder="Roblox usernames or IDs, separated by spaces or commas">${esc(users || '')}</textarea><small>Up to 50 at once. Anyone who already holds it is renewed.</small></label>
      <label class="field">Note (optional)<input id="nt" maxlength="300" placeholder="e.g. Passed the practical on 12 Nov"></label>`,
    actions: [{ label: 'Award', kind: 'primary', onClick: async (close, m) => {
      const r = await api(G('/certifications'), { body: { certId: Number(val(m, '#ct')), users: val(m, '#us'), note: val(m, '#nt') } });
      close();
      const n = r.awarded.length + r.renewed.length;
      toast(`${n ? `Awarded to ${n}` : 'Nobody awarded'}${r.renewed.length ? ` (${r.renewed.length} renewed)` : ''}${r.failed.length ? ` — not found: ${r.failed.map((f) => f.user).join(', ')}` : ''}`, r.failed.length ? 'bad' : 'good');
      done();
    } }] });
}

// ---------- Roster ----------
VIEWS.roster = async (el, _a, _b, reload) => {
  const d = await api(G('/roster'));
  const edit = can('manage_roster');
  const tab = ['departments', 'certifications'].includes(store.get('rp_rtab')) ? store.get('rp_rtab') : 'roster';
  const depById = new Map(d.departments.map((x) => [x.id, x])), certById = new Map(d.certTypes.map((x) => [x.id, x]));
  el.innerHTML = `${head('Roster', 'Who is who: departments, callsigns and certifications for everyone in a tracked rank.', edit ? `
      <button class="btn" id="award">${icon('award')} Award certification</button>` : '')}
    <div class="stats">
      ${stat('Members', d.members.length, 'in tracked ranks', 'users')}
      ${stat('Departments', d.departments.length, `${((n) => `${n} member${n === 1 ? '' : 's'} assigned`)(d.members.filter((m) => m.departments.length).length)}`, 'idcard')}
      ${stat('Certifications', d.certTypes.length, `${d.members.reduce((n, m) => n + m.certifications.length, 0)} held`, 'award')}
      ${stat('Callsigns', d.members.filter((m) => m.callsign).length, 'assigned', 'list')}
    </div>
    <div class="card"><div class="head">${seg('rtab', [['roster', 'Roster'], ['departments', 'Departments'], ['certifications', 'Certifications']], tab)}<span class="grow"></span><span id="rtools" class="row wrap"></span></div><div id="rbody"></div></div>`;
  const body = $('#rbody', el), tools = $('#rtools', el);

  const drawRoster = () => {
    const by = store.get('rp_rby') === 'all' ? 'all' : 'dept';
    let q = '';
    tools.innerHTML = `${seg('rby', [['dept', 'By department'], ['all', 'Everyone']], by)}<div class="search" style="width:200px">${icon('search', 'sm')}<input id="rq" placeholder="Name, callsign, cert" aria-label="Search roster"></div>`;
    const row = (m) => `<tr class="click" data-m="${esc(m.robloxId)}"><td>${who(m.username, m.displayName && m.displayName !== m.username ? m.displayName : '')}</td>
      <td class="mono">${m.callsign ? esc(m.callsign) : '<span class="muted">—</span>'}</td><td>${esc(m.roleName || `Rank ${m.rank}`)}</td>
      <td><div class="row wrap gap-s">${m.departments.map((id) => depById.get(id)).filter(Boolean).map((x) => chip(x.name, x.color)).join('') || '<span class="muted">—</span>'}</div></td>
      <td><div class="row wrap gap-s">${m.certifications.map((c) => certChip(c, certById.get(c.certId))).join('') || '<span class="muted">—</span>'}</div></td>
      <td class="r">${edit ? `<button class="btn ghost icon sm" data-edit="${esc(m.robloxId)}" aria-label="Edit roster entry" title="Edit">${icon('edit', 'sm')}</button>` : ''}</td></tr>`;
    const table = (list) => `<div class="tbl-wrap"><table><thead><tr><th>Member</th><th>Callsign</th><th>Rank</th><th>Departments</th><th>Certifications</th><th></th></tr></thead><tbody>${list.length ? list.map(row).join('') : emptyRow(6, 'Nobody here.', 'users')}</tbody></table></div>`;
    const match = (m) => !q || `${m.username} ${m.displayName} ${m.callsign} ${m.roleName} ${m.certifications.map((c) => certById.get(c.certId)?.name).join(' ')} ${m.departments.map((id) => depById.get(id)?.name).join(' ')}`.toLowerCase().includes(q);
    const render = () => {
      const list = d.members.filter(match);
      if (by === 'all' || !d.departments.length) { body.innerHTML = table(list); return; }
      body.innerHTML = d.departments.map((dep) => { const ms = list.filter((m) => m.departments.includes(dep.id)); return ms.length || !q ? `<section class="dep-sec"><div class="dep-head">${colorDot(dep.color)}<b>${esc(dep.name)}</b><span class="muted">${ms.length} member${ms.length === 1 ? '' : 's'}${dep.headName ? ` · Head: ${esc(dep.headName)}` : ''}</span></div>${ms.length ? table(ms) : '<p class="muted small" style="margin:0 16px 14px">No members yet.</p>'}</section>` : ''; }).join('')
        + (() => { const none = list.filter((m) => !m.departments.length); return none.length ? `<section class="dep-sec"><div class="dep-head">${colorDot('#8a93a5')}<b>No department</b><span class="muted">${none.length}</span></div>${table(none)}</section>` : ''; })();
    };
    render();
    onSeg(tools, 'rby', (v) => { store.set('rp_rby', v); drawRoster(); });
    $('#rq', tools).oninput = (e) => { q = e.target.value.trim().toLowerCase(); render(); };
    body.onclick = (e) => {
      const b = e.target.closest('[data-edit]');
      if (b) { e.stopPropagation(); rosterEditModal(d.members.find((m) => m.robloxId === b.dataset.edit), d.departments, reload); return; }
      const tr = e.target.closest('tr[data-m]'); if (tr) location.hash = `#/member/${tr.dataset.m}`;
    };
  };

  const deptModal = (dep = {}) => modal({ title: dep.id ? `Edit ${dep.name}` : 'New department', body: `
      <div class="grid2"><label class="field">Name<input id="n" maxlength="60" value="${esc(dep.name || '')}" placeholder="e.g. SWAT, Front Desk, Cabin Crew"></label>
      <label class="field">Colour<input id="c" type="color" value="${esc(dep.color || '#5b8def')}"></label></div>
      <label class="field">Head (optional)<input id="h" value="${esc(dep.headName || '')}" placeholder="Roblox username"></label>
      <label class="field">Description (optional)<input id="ds" maxlength="300" value="${esc(dep.description || '')}"></label>`,
    actions: [{ label: 'Save', kind: 'primary', onClick: async (close, m) => {
      const b = { name: val(m, '#n'), color: val(m, '#c'), head: val(m, '#h'), description: val(m, '#ds') };
      if (dep.id) await api(`/api/departments/${dep.id}`, { method: 'PATCH', body: b }); else await api(G('/departments'), { body: b });
      close(); toast('Department saved', 'good'); reload();
    } }] });
  const drawDepartments = () => {
    tools.innerHTML = edit ? `<button class="btn sm primary" id="newDep">${icon('plus', 'sm')} New department</button>` : '';
    body.innerHTML = d.departments.length ? `<div class="dep-grid">${d.departments.map((x) => `<div class="dep-card" style="--c:${esc(x.color)}"><div class="row">${colorDot(x.color)}<b class="grow">${esc(x.name)}</b>
        ${edit ? `<button class="btn ghost icon sm" data-dedit="${x.id}" aria-label="Edit">${icon('edit', 'sm')}</button><button class="btn ghost icon sm" data-ddel="${x.id}" aria-label="Delete">${icon('trash', 'sm')}</button>` : ''}</div>
        ${x.description ? `<p class="dim small">${esc(x.description)}</p>` : ''}<div class="muted small">${x.members} member${x.members === 1 ? '' : 's'}${x.headName ? ` · Head: <b>${esc(x.headName)}</b>` : ''}</div></div>`).join('')}</div>`
      : `<div class="empty">${icon('idcard')}<div><b>No departments yet</b></div><p>Divisions, units or teams — e.g. Patrol, SWAT and Traffic, or Front Desk and Housekeeping.</p></div>`;
    if (!edit) return;
    $('#newDep', tools).onclick = () => deptModal();
    body.onclick = async (e) => {
      const ed = e.target.closest('[data-dedit]'), del = e.target.closest('[data-ddel]');
      if (ed) deptModal(depById.get(Number(ed.dataset.dedit)));
      if (del) { const x = depById.get(Number(del.dataset.ddel)); if (await confirmBox(`Delete ${x.name}?`, 'Members are removed from it; nobody loses anything else.', 'Delete')) run(del, async () => { await api(`/api/departments/${x.id}`, { method: 'DELETE' }); reload(); }); }
    };
  };

  const certModal = (ct = {}) => modal({ title: ct.id ? `Edit ${ct.name}` : 'New certification', body: `
      <div class="grid2"><label class="field">Name<input id="n" maxlength="60" value="${esc(ct.name || '')}" placeholder="e.g. Firearms, Barista, Flight checkride"></label>
      <label class="field">Colour<input id="c" type="color" value="${esc(ct.color || '#2fa58a')}"></label></div>
      <label class="field">Valid for<select id="v">${[[0, 'Never expires'], [30, '30 days'], [60, '60 days'], [90, '90 days'], [180, '180 days'], [365, '1 year']].map(([v, l]) => `<option value="${v}" ${(ct.validDays || 0) === v ? 'selected' : ''}>${l}</option>`).join('')}</select><small>Expired certifications stop counting for auto-promotion and in-game checks.</small></label>
      <label class="field">Description (optional)<input id="ds" maxlength="300" value="${esc(ct.description || '')}"></label>`,
    actions: [{ label: 'Save', kind: 'primary', onClick: async (close, m) => {
      const b = { name: val(m, '#n'), color: val(m, '#c'), validDays: Number(val(m, '#v')), description: val(m, '#ds') };
      if (ct.id) await api(`/api/cert-types/${ct.id}`, { method: 'PATCH', body: b }); else await api(G('/cert-types'), { body: b });
      close(); toast('Certification saved', 'good'); reload();
    } }] });
  const drawCerts = () => {
    tools.innerHTML = edit ? `<button class="btn sm primary" id="newCert">${icon('plus', 'sm')} New certification</button>` : '';
    body.innerHTML = d.certTypes.length ? d.certTypes.map((ct) => {
      const hs = d.members.filter((m) => m.certifications.some((c) => c.certId === ct.id));
      return `<section class="dep-sec"><div class="dep-head">${colorDot(ct.color)}<b>${esc(ct.name)}</b><span class="muted">${ct.holders} holder${ct.holders === 1 ? '' : 's'} · ${ct.validDays ? `valid ${ct.validDays} days` : 'never expires'}</span><span class="grow"></span>
        ${edit ? `<button class="btn sm" data-aw="${ct.id}">${icon('award', 'sm')} Award</button><button class="btn ghost icon sm" data-cedit="${ct.id}" aria-label="Edit">${icon('edit', 'sm')}</button><button class="btn ghost icon sm" data-cdel="${ct.id}" aria-label="Delete">${icon('trash', 'sm')}</button>` : ''}</div>
        ${ct.description ? `<p class="dim small" style="margin:0 16px 8px">${esc(ct.description)}</p>` : ''}
        <div class="tbl-wrap"><table><tbody>${hs.length ? hs.map((m) => { const c = m.certifications.find((x) => x.certId === ct.id); return `<tr><td>${who(m.username, m.roleName)}</td><td class="muted small">by ${esc(c.issuedBy || '')} · ${fmtDate(c.issuedAt)}</td>
          <td>${c.expiresAt ? (daysLeft(c.expiresAt) <= 14 ? `<span class="badge warn">expires in ${daysLeft(c.expiresAt)} days</span>` : `<span class="muted small">until ${fmtDate(c.expiresAt)}</span>`) : '<span class="muted small">no expiry</span>'}</td>
          <td class="r">${edit ? `<button class="btn ghost sm" data-rev="${c.id}">Revoke</button>` : ''}</td></tr>`; }).join('') : emptyRow(4, 'Nobody holds this yet.', 'award')}</tbody></table></div></section>`;
    }).join('') : `<div class="empty">${icon('award')}<div><b>No certifications yet</b></div><p>Trainings and qualifications — e.g. Firearms, EMT-B, Barista or a flight checkride. Award them by hand or to everyone on a session register.</p></div>`;
    if (!edit) return;
    $('#newCert', tools).onclick = () => certModal();
    body.onclick = async (e) => {
      const aw = e.target.closest('[data-aw]'), ed = e.target.closest('[data-cedit]'), del = e.target.closest('[data-cdel]'), rev = e.target.closest('[data-rev]');
      if (aw) awardModal(d.certTypes, '', reload, Number(aw.dataset.aw));
      if (ed) certModal(certById.get(Number(ed.dataset.cedit)));
      if (del) { const x = certById.get(Number(del.dataset.cdel)); if (await confirmBox(`Delete ${x.name}?`, 'Everyone loses this certification and its history. This cannot be undone.', 'Delete')) run(del, async () => { await api(`/api/cert-types/${x.id}`, { method: 'DELETE' }); reload(); }); }
      if (rev && await confirmBox('Revoke this certification?', 'It stays on record but no longer counts.', 'Revoke')) run(rev, async () => { await api(`/api/certifications/${rev.dataset.rev}/revoke`, { method: 'POST' }); toast('Revoked', 'good'); reload(); });
    };
  };

  const draw = (t) => { body.onclick = null; (t === 'departments' ? drawDepartments : t === 'certifications' ? drawCerts : drawRoster)(); };
  draw(tab);
  onSeg(el, 'rtab', (v) => { store.set('rp_rtab', v); draw(v); });
  if (edit) $('#award', el).onclick = () => awardModal(d.certTypes, '', reload);
};

// ---------- Reports ----------
const SUBJECT_LABEL = { none: 'No member', optional: 'Member (optional)', required: 'Member (required)' };
const reportStatus = (s) => (s === 'closed' ? `<span class="badge">${icon('check', 'sm')} Closed</span>` : `<span class="badge warn">${icon('clock', 'sm')} Open</span>`);

VIEWS.reports = async (el, a, b, reload) => {
  if (a === 'types') return b ? reportTypeEditor(el, b === 'new' ? null : Number(b)) : reportTypesPage(el);
  if (a === 'new') return fileReport(el, Number(b));
  const status = ['closed', 'all'].includes(store.get('rp_rstatus')) ? store.get('rp_rstatus') : 'open';
  const mine = store.get('rp_rmine') === '1';
  const typeF = store.get('rp_rtype') || '';
  const [{ types }, d] = await Promise.all([api(G('/report-types')), api(G(`/reports?${new URLSearchParams({ status: status === 'all' ? '' : status, type: typeF, mine: mine ? '1' : '' })}`))]);
  const fileable = types.filter((t) => t.canFile);
  el.innerHTML = `${head('Reports', 'Arrest and incident reports, patient care reports, flight logs — whatever your group files. You see your own reports, plus every type you review.', `
      ${can('manage_reports') ? `<a class="btn" href="#/reports/types">${icon('sliders')} Report types</a>` : ''}
      ${fileable.length ? `<button class="btn primary" id="file">${icon('plus')} File a report</button>` : ''}`)}
    ${!types.length ? `<div class="card"><div class="empty">${icon('filetext')}<div><b>No report types yet</b></div><p>${can('manage_reports') ? 'Create your first one — e.g. “Arrest report” with suspect, charges and evidence.' : 'Someone with the “manage reports” permission needs to set them up.'}</p>${can('manage_reports') ? '<p style="margin-top:12px"><a class="btn primary" href="#/reports/types/new">Create a report type</a></p>' : ''}</div></div>` : `
    <div class="card"><div class="head">${seg('rst', [['open', 'Open'], ['closed', 'Closed'], ['all', 'All']], status)}
      <select id="rtf" style="width:auto" aria-label="Report type"><option value="">All types</option>${types.map((t) => `<option value="${t.id}" ${String(t.id) === typeF ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      ${d.reviewer ? `<label class="check right"><input type="checkbox" id="rmine" ${mine ? 'checked' : ''}> Only mine</label>` : ''}</div>
      <div class="tbl-wrap"><table><thead><tr><th>Report</th><th>About</th><th>Filed by</th><th>Status</th><th></th></tr></thead><tbody>
      ${d.reports.length ? d.reports.map((r) => `<tr class="click" data-r="${r.id}"><td>${colorDot(r.color)} <b>${esc(r.typeName)}</b> <span class="muted">#${r.id}</span><br><span class="muted small">${fmtTime(r.createdAt)}</span></td>
        <td>${r.subjectName ? esc(r.subjectName) : '<span class="muted">—</span>'}</td><td>${esc(r.authorName || '')}</td><td>${reportStatus(r.status)}${r.reviewer ? `<br><span class="muted small">by ${esc(r.reviewer)}</span>` : ''}</td>
        <td class="r"><a class="btn sm" href="#/report/${r.id}">Open</a></td></tr>`).join('') : emptyRow(5, `No ${status === 'all' ? '' : `${status} `}reports.`, 'filetext')}</tbody></table></div></div>`}`;
  if (!types.length) return;
  onSeg(el, 'rst', (v) => { store.set('rp_rstatus', v); reload(); });
  $('#rtf', el).onchange = (e) => { store.set('rp_rtype', e.target.value); reload(); };
  if ($('#rmine', el)) $('#rmine', el).onchange = (e) => { store.set('rp_rmine', e.target.checked ? '1' : ''); reload(); };
  $('tbody', el).onclick = (e) => { const tr = e.target.closest('tr[data-r]'); if (tr && !e.target.closest('a')) location.hash = `#/report/${tr.dataset.r}`; };
  if ($('#file', el)) $('#file', el).onclick = () => (fileable.length === 1 ? (location.hash = `#/reports/new/${fileable[0].id}`) : modal({ title: 'File a report', body: `<div class="stack gap-s">${fileable.map((t) => `<a class="pick-row" href="#/reports/new/${t.id}">${colorDot(t.color)}<span class="grow"><b>${esc(t.name)}</b>${t.description ? `<br><span class="muted small">${esc(t.description)}</span>` : ''}</span>${icon('arrowR', 'sm')}</a>`).join('')}</div>`, actions: [] }));
};

async function fileReport(el, typeId) {
  const { types } = await api(G('/report-types'));
  const t = types.find((x) => x.id === typeId);
  if (!t || !t.canFile) throw new Error('You can’t file this kind of report.');
  el.innerHTML = `<div><a href="#/reports" class="muted">${icon('arrowL', 'inl')} Reports</a></div>
    ${head(t.name, t.description ? esc(t.description) : 'Fill in the form and submit — reviewers are notified.')}
    <form id="rf" class="stack" novalidate style="max-width:820px">
      ${t.subject === 'none' ? '' : `<div class="card q" data-q="__subject"><div><b>Who is this report about?</b>${t.subject === 'required' ? ' <span class="req" title="Required">*</span>' : ''}<p class="hint">Roblox username or user ID.</p></div><input id="subj" maxlength="40" autocomplete="off"></div>`}
      ${questionsHTML(t.questions)}
      <div id="err" role="alert"></div>
      <div class="row"><button class="btn primary" id="send">${icon('check')} Submit report</button><a class="btn ghost" href="#/reports">Cancel</a></div>
    </form>`;
  bindOtherInputs($('#rf', el));
  $('#rf', el).onsubmit = (e) => {
    e.preventDefault();
    const form = e.target;
    const { answers, error, el: bad } = readAnswers(form, t.questions);
    const subject = t.subject === 'none' ? '' : val(form, '#subj');
    if (t.subject === 'required' && !subject) { $('#err', el).innerHTML = `<div class="callout bad">${icon('alert')}<span>Enter who this report is about.</span></div>`; return; }
    if (error) { $('#err', el).innerHTML = `<div class="callout bad">${icon('alert')}<span>${esc(error)}</span></div>`; bad?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    run($('#send', el), async () => {
      try { const r = await api(G('/reports'), { body: { typeId: t.id, subject, answers } }); toast(`${t.name} #${r.id} filed`, 'good'); location.hash = `#/report/${r.id}`; }
      catch (e2) { $('#err', el).innerHTML = `<div class="callout bad">${icon('alert')}<span>${esc(e2.message)}</span></div>`; }
    });
  };
}

VIEWS.report = async (el, id, _b, reload) => {
  const { report: r, type: t, canReview } = await api(`/api/reports/${encodeURIComponent(id)}`);
  const qs = t?.questions || [];
  let n = 0;
  el.innerHTML = `<div><a href="#/reports" class="muted">${icon('arrowL', 'inl')} Reports</a></div>
    ${head(`${r.typeName} #${r.id}`, `Filed by <b>${esc(r.authorName || '')}</b> · ${fmtTime(r.createdAt)}`, r.subjectId ? `<a class="btn" href="#/member/${esc(r.subjectId)}">${icon('user')} ${esc(r.subjectName || r.subjectId)}</a>` : '')}
    <div class="sub-grid">
      <div class="card"><div class="head"><h2 class="grow">Report</h2>${reportStatus(r.status)}</div><div class="body stack qa">
        ${r.subjectName ? `<div class="qa-item"><div class="qa-q"><b>About</b></div><div class="qa-a">${esc(r.subjectName)} <span class="muted">(${esc(r.subjectId)})</span></div></div>` : ''}
        ${qs.map((q) => q.type === 'section' ? `<h3 class="qa-sec">${esc(q.label)}</h3>` : `<div class="qa-item"><div class="qa-q"><b><span class="muted num">${++n}.</span> ${esc(q.label)}</b></div><div class="qa-a">${r.answers[q.id] == null || r.answers[q.id] === '' ? '<span class="muted">No answer</span>' : esc(Array.isArray(r.answers[q.id]) ? r.answers[q.id].join(', ') : r.answers[q.id])}</div></div>`).join('')}
      </div></div>
      <div class="card decide"><div class="head"><h2 class="grow">Review</h2></div><div class="body stack">
        ${r.reviewer ? `<p>${reportStatus(r.status)} by <b>${esc(r.reviewer)}</b> <span class="muted">· ${fmtTime(r.reviewedAt)}</span></p>${r.reviewNote ? `<div class="note"><b>Note:</b> ${esc(r.reviewNote)}</div>` : ''}` : '<p class="dim">Not reviewed yet.</p>'}
        ${canReview ? `<label class="field">Note (optional)<textarea id="note" maxlength="1000" placeholder="Outcome, follow-up, charges filed…"></textarea></label>
          <div class="row wrap">${r.status === 'open' ? `<button class="btn primary grow" data-st="closed">${icon('check')} Close report</button>` : `<button class="btn grow" data-st="open">${icon('refresh')} Reopen</button>`}</div>` : ''}
      </div></div>
    </div>`;
  $$('[data-st]', el).forEach((btn) => btn.onclick = () => run(btn, async () => { await api(`/api/reports/${r.id}`, { method: 'PATCH', body: { status: btn.dataset.st, note: val(el, '#note') } }); toast(btn.dataset.st === 'closed' ? 'Report closed' : 'Report reopened', 'good'); reload(); }));
};

async function reportTypesPage(el) {
  if (!can('manage_reports')) throw new Error('You need the “manage reports” permission.');
  const { types } = await api(G('/report-types'));
  el.innerHTML = `<div><a href="#/reports" class="muted">${icon('arrowL', 'inl')} Reports</a></div>
    ${head('Report types', 'Design each form your staff file, and choose who files and who reviews it.', `<a class="btn primary" href="#/reports/types/new">${icon('plus')} New report type</a>`)}
    <div class="card"><div class="tbl-wrap"><table><thead><tr><th>Type</th><th>Questions</th><th>Who can file</th><th>Reviewed by</th><th></th></tr></thead><tbody>
    ${types.length ? types.map((t) => `<tr><td>${colorDot(t.color)} <b>${esc(t.name)}</b><br><span class="muted small">${SUBJECT_LABEL[t.subject]}${t.webhookUrl ? ' · Discord' : ''}</span></td><td class="num">${t.questions.filter((q) => q.type !== 'section').length}</td>
      <td>${t.filePerm ? esc(VIS_LABELS[t.filePerm] || t.filePerm) : 'Any staff'}</td><td>Report managers${t.viewPerm ? ` + ${esc(VIS_LABELS[t.viewPerm] || t.viewPerm)}` : ''}</td>
      <td class="r"><a class="btn ghost icon sm" href="#/reports/types/${t.id}" aria-label="Edit">${icon('edit', 'sm')}</a></td></tr>`).join('') : emptyRow(5, 'No report types yet.', 'filetext')}</tbody></table></div></div>
    <div class="card"><div class="head"><h2>Start from a template</h2></div><div class="body row wrap">${REPORT_TEMPLATES.map((x, i) => `<button class="btn" data-tpl="${i}">${icon('plus', 'sm')} ${esc(x.name)}</button>`).join('')}</div></div>`;
  $$('[data-tpl]', el).forEach((btn) => btn.onclick = () => { sessionStorage.setItem('rp_rtpl', btn.dataset.tpl); location.hash = '#/reports/types/new'; });
}

const REPORT_TEMPLATES = [
  { name: 'Arrest report', color: '#e5484d', subject: 'required', questions: [
    { type: 'short', label: 'Charges', required: true }, { type: 'paragraph', label: 'What happened?', required: true, validation: { rule: 'minLen', a: 30 } },
    { type: 'choice', label: 'Was force used?', options: ['No', 'Yes — non-lethal', 'Yes — lethal'], required: true }, { type: 'short', label: 'Evidence link', validation: { rule: 'url' } }] },
  { name: 'Incident report', color: '#e2a336', subject: 'optional', questions: [
    { type: 'short', label: 'Location', required: true }, { type: 'date', label: 'Date', required: true }, { type: 'time', label: 'Time' },
    { type: 'paragraph', label: 'Describe the incident', required: true }, { type: 'checkboxes', label: 'Who responded?', options: ['Police', 'Fire', 'EMS', 'Management'], other: true }] },
  { name: 'Patient care report', color: '#2fa58a', subject: 'required', questions: [
    { type: 'dropdown', label: 'Condition on arrival', options: ['Stable', 'Serious', 'Critical'], required: true }, { type: 'paragraph', label: 'Treatment given', required: true },
    { type: 'yesno', label: 'Transported to hospital?', required: true }] },
  { name: 'Flight log', color: '#5b8def', subject: 'none', questions: [
    { type: 'short', label: 'Flight number', required: true, validation: { rule: 'matches', a: '[A-Z]{2,3}[0-9]{1,4}', message: 'Use an airline code and number, e.g. SR123' } },
    { type: 'short', label: 'Route (from – to)', required: true }, { type: 'number', label: 'Passengers', min: 0 }, { type: 'scale', label: 'How did it go?', min: 1, max: 5, minLabel: 'Rough', maxLabel: 'Perfect' }] },
  { name: 'Guest complaint', color: '#8e6fd8', subject: 'optional', questions: [
    { type: 'short', label: 'Guest name' }, { type: 'paragraph', label: 'Complaint', required: true }, { type: 'choice', label: 'Resolved?', options: ['Yes', 'No', 'Escalated'], required: true }] },
];

async function reportTypeEditor(el, id) {
  if (!can('manage_reports')) throw new Error('You need the “manage reports” permission.');
  const { types } = await api(G('/report-types'));
  const tpl = sessionStorage.getItem('rp_rtpl'); sessionStorage.removeItem('rp_rtpl');
  const t = id ? types.find((x) => x.id === id) : (tpl != null && REPORT_TEMPLATES[tpl] ? { ...REPORT_TEMPLATES[tpl], questions: REPORT_TEMPLATES[tpl].questions.map((q) => ({ description: '', ...q })) } : { name: '', color: '#5b8def', subject: 'optional', questions: [] });
  if (id && !t) throw new Error('Report type not found.');
  const qs = (t.questions || []).map((q) => ({ ...q, options: q.options ? [...q.options] : undefined }));
  const permOpts = (cur, first) => `<option value="">${first}</option>${Object.entries(VIS_LABELS).filter(([k]) => k && k !== 'public').map(([k, l]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}`;
  el.innerHTML = `<div><a href="#/reports/types" class="muted">${icon('arrowL', 'inl')} Report types</a></div>
    ${head(id ? `Edit ${t.name}` : 'New report type', '', `${id ? `<button class="btn danger" id="del">${icon('trash')} Delete</button>` : ''}<button class="btn primary" id="save">${icon('check')} Save</button>`)}
    <div class="card"><div class="body stack">
      <div class="grid3"><label class="field">Name<input id="n" maxlength="60" value="${esc(t.name || '')}" placeholder="e.g. Arrest report"></label>
        <label class="field">Colour<input id="c" type="color" value="${esc(t.color || '#5b8def')}"></label>
        <label class="field">About a member?<select id="sj">${Object.entries(SUBJECT_LABEL).map(([k, l]) => `<option value="${k}" ${k === t.subject ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <label class="field">Description (optional)<input id="ds" maxlength="500" value="${esc(t.description || '')}" placeholder="Shown when filing"></label>
      <div class="grid2"><label class="field">Who can file it<select id="fp">${permOpts(t.filePerm, 'Any signed-in staff')}</select></label>
        <label class="field">Also reviewed by<select id="vp">${permOpts(t.viewPerm, 'Only report managers')}</select><small>People with “manage reports” always review every type.</small></label></div>
      <label class="field">Discord webhook (optional)<input id="hk" value="${esc(t.webhookUrl || '')}" placeholder="https://discord.com/api/webhooks/…"><small>Each new report is posted with every answer and an Open button.</small></label>
    </div></div>
    <div class="card"><div class="head"><h2 class="grow">Questions</h2></div><div class="body stack">${questionEditorHTML()}</div></div>`;
  bindQuestionEditor(el, qs, { grading: false });
  $('#save', el).onclick = (e) => run(e.currentTarget, async () => {
    const body = { name: val(el, '#n'), color: val(el, '#c'), subject: val(el, '#sj'), description: val(el, '#ds'), filePerm: val(el, '#fp'), viewPerm: val(el, '#vp'), webhookUrl: val(el, '#hk'), questions: qs };
    if (id) await api(`/api/report-types/${id}`, { method: 'PATCH', body }); else await api(G('/report-types'), { body });
    toast('Report type saved', 'good'); location.hash = '#/reports/types';
  });
  if (id) $('#del', el).onclick = async () => { if (await confirmBox(`Delete ${t.name}?`, 'Only possible while no reports use it.', 'Delete')) run(null, async () => { await api(`/api/report-types/${id}`, { method: 'DELETE' }); location.hash = '#/reports/types'; }); };
}

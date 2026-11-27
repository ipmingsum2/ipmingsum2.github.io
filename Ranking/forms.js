import { $, $$, account, api, appLayout, busy, esc, fmtTime, icon, preview, status } from './ui.js';

const accountLabel = id => `${id.startsWith('pk_') ? 'Account' : 'Discord'} ${esc(id)}`;

const labels = {
  short: 'Short answer', paragraph: 'Paragraph', email: 'Email', number: 'Number', choice: 'Multiple choice',
  checkbox: 'Checkboxes', dropdown: 'Dropdown', date: 'Date', time: 'Time', scale: 'Linear scale', section: 'Section heading'
};
const demoForm = {
  title: 'Request dashboard access', revision: 'preview', open: true,
  description: 'Tell us about your Roblox group and how you plan to use Ranking.',
  success: 'Thanks for applying. Your request is under review.',
  questions: [
    { id: 'community', type: 'short', label: 'Which Roblox group do you run?', description: 'Include the community name and group ID.', required: true, min: 3, error: 'Please enter a group name and ID.' },
    { id: 'plans', type: 'paragraph', label: 'How will you use Ranking?', description: 'Tell us how your staff will use the dashboard.', required: true, min: 15 },
    { id: 'mode', type: 'choice', label: 'Which provider do you prefer?', options: ['Open Cloud', 'Cookie integration'], other: true, required: true }
  ]
};
const demoRequests = [
  { id: 'demo-one', name: 'Avery Chen', account: '100000000000000010', roblox_id: '45911672', status: 'pending', opened: 1795764100,
    form: demoForm, answers: { community: 'Northstar Transit · 34891321', plans: 'We run transit training sessions and want a shared workflow for promoting trainees and reviewing staff access.', mode: 'Open Cloud' } },
  { id: 'demo-two', name: 'Morgan Ellis', account: '100000000000000011', roblox_id: '97146712', status: 'pending', opened: 1795757000,
    form: demoForm, answers: { community: 'Overlook Labs · 34891322', plans: 'We want to manage community ranks after monthly training sessions.', mode: 'Cookie integration' } }
];

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function applicantQuestion(q) {
  const id = 'q-' + esc(q.id);
  const title = esc(q.label) + (q.required ? '<span class="muted" aria-label="required"> *</span>' : '');
  const description = q.description ? `<small id="${id}-desc">${esc(q.description)}</small>` : '';
  const described = `${q.description ? `${id}-desc ` : ''}${id}-error`;
  const common = `name="${id}" aria-describedby="${described}"`;
  const required = q.required ? ' required' : '';
  let input;
  if (q.type === 'section') return `<section class="panel stack"><h2>${esc(q.label)}</h2>${description}</section>`;
  if (q.type === 'paragraph') input = `<textarea ${common}${required} maxlength="4000" aria-label="${esc(q.label)}"></textarea>`;
  else if (['choice', 'checkbox', 'dropdown', 'scale'].includes(q.type)) {
    let options = q.type === 'scale' ? Array.from({ length: q.max - q.min + 1 }, (_, i) => q.min + i) : [...q.options];
    if (q.shuffle) options = shuffle(options);
    if (q.type === 'dropdown') input = `<select ${common}${required} aria-label="${esc(q.label)}"><option value="">Select an answer</option>${options.map(value => `<option>${esc(value)}</option>`).join('')}</select>`;
    else {
      const type = q.type === 'checkbox' ? 'checkbox' : 'radio';
      const items = options.map(value => `<label class="check"><input type="${type}" ${common} value="${esc(value)}"${type === 'radio' ? required : ''}><span>${esc(value)}</span></label>`).join('');
      input = (q.type === 'scale' ? `<div class="scale">${items}</div><div class="scale-labels"><small>${esc(q.low)}</small><small>${esc(q.high)}</small></div>` : items) +
        (q.other ? `<label class="check"><input type="${type}" ${common} data-other value=""${type === 'radio' ? required : ''}>Other</label><input name="${id}-other" aria-label="Other answer" maxlength="160" placeholder="Enter your answer" hidden>` : '');
    }
  } else {
    const type = q.type === 'short' ? 'text' : q.type;
    input = `<input type="${type}" ${common}${required} ${type === 'text' ? 'maxlength="300"' : ''} ${type === 'number' ? 'step="any"' : ''} aria-label="${esc(q.label)}">`;
  }
  return `<fieldset class="panel question" data-question="${esc(q.id)}"><legend class="sr-only">${title}</legend><div class="question-label" aria-hidden="true">${title}</div>${description}${input}<small class="field-error" id="${id}-error" role="status"></small></fieldset>`;
}

function captureAnswers(form, definition) {
  const data = new FormData(form);
  const answers = Object.create(null);
  for (const q of definition.questions) {
    if (q.type === 'section') continue;
    const name = 'q-' + q.id;
    const entries = data.getAll(name);
    const otherInput = $('[data-other]', $(`[data-question="${CSS.escape(q.id)}"]`, form));
    const other = data.get(name + '-other')?.trim();
    if (otherInput?.checked) {
      if (!other) throw Object.assign(new Error('Enter the write-in answer.'), { details: { [q.id]: q.error || 'Enter the write-in answer.' } });
      const index = entries.indexOf('');
      if (index >= 0) entries[index] = 'Other: ' + other;
    }
    if (q.type === 'checkbox') answers[q.id] = entries;
    else if (['number', 'scale'].includes(q.type) && entries[0] !== undefined && entries[0] !== '') answers[q.id] = Number(entries[0]);
    else answers[q.id] = entries[0] ?? '';
  }
  return answers;
}

export async function access() {
  const user = await account(false);
  if (!user) return;
  if (user.access && !preview) { location.replace('dashboard.html'); return; }
  const { form, request } = preview ? { form: demoForm, request: null } : await api('/api/access');
  const canReapply = request?.status !== 'denied' || Date.now() / 1000 >= request.reviewed + 86400;
  const message = request ? `<section class="panel stack"><h2>${request.status === 'pending' ? 'Request under review' : 'Request ' + esc(request.status)}</h2><p>Submitted ${esc(fmtTime(request.opened))}.</p>${request.note ? `<p>${esc(request.note)}</p>` : ''}${canReapply ? '' : '<small>You can apply again 24 hours after the decision.</small>'}</section>` : '';
  $('#content').innerHTML = `<div class="page-heading"><h1>${esc(form.title)}</h1><p>${esc(form.description)}</p></div>
    ${message}<div class="inline">${!user.robloxId ? `<a class="button ghost small" href="verify.html">Link your Roblox account ${icon('arrow-up-right')}</a>` : ''}
    </div>
    ${request?.status === 'pending' || !canReapply ? '' : !form.open ? '<section class="panel">The owner has paused access requests.</section>' :
    `<form id="application" class="stack" novalidate>${form.questions.map(applicantQuestion).join('')}<button class="button" type="submit">Submit request ${icon('arrow-up-right')}</button><p class="status" id="status" role="status"></p></form>`}
    ${preview ? '' : '<div class="inline"><button class="button ghost small" type="button" id="leave-access">Sign out</button></div>'}`;
  $('#leave-access')?.addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } finally { sessionStorage.removeItem('ranking-session'); location.assign('./'); }
  });
  const application = $('#application');
  if (!application) return;
  application.addEventListener('change', event => {
    const group = event.target.closest('[data-question]');
    if (!group) return;
    const other = $('[data-other]', group);
    if (other) {
      const field = $('[name$="-other"]', group);
      field.hidden = !other.checked;
      if (event.target === other && other.checked) field.focus();
    }
  });
  application.addEventListener('submit', event => {
    event.preventDefault();
    busy($('button', application), async () => {
      for (const group of $$('[data-question]', application)) {
        group.removeAttribute('aria-invalid');
        $('.field-error', group).textContent = '';
      }
      try {
        const answers = captureAnswers(application, form);
        if (!preview) await api('/api/access', { method: 'POST', body: { revision: form.revision, answers } });
        const result = document.createElement('section');
        result.className = 'panel status ok';
        result.setAttribute('role', 'status');
        result.textContent = form.success || 'Your request was submitted.';
        application.replaceWith(result);
      } catch (error) {
        for (const [id, text] of Object.entries(error.details || {})) {
          const question = $(`[data-question="${CSS.escape(id)}"]`, application);
          if (!question) continue;
          question.setAttribute('aria-invalid', 'true');
          $('.field-error', question).textContent = text;
        }
        $('[aria-invalid="true"] input, [aria-invalid="true"] textarea, [aria-invalid="true"] select', application)?.focus();
        throw error;
      }
    });
  });
}

function editorQuestion(q, index, total) {
  const options = ['choice', 'dropdown', 'checkbox'].includes(q.type);
  const limit = ['short', 'paragraph', 'checkbox', 'number', 'scale'].includes(q.type);
  const input = (title, name, value = '', type = 'text') => `<label class="control">${title}<input name="${name}" type="${type}" value="${esc(value)}" ${type === 'number' ? 'step="any"' : ''}></label>`;
  const check = (title, name) => `<label class="check"><input type="checkbox" name="${name}" ${q[name] ? 'checked' : ''}>${title}</label>`;
  const btn = (title, action, disabled = false, symbol) => `<button class="button ghost small" type="button" data-edit="${action}" ${disabled ? 'disabled' : ''} ${symbol ? `aria-label="${title}"` : ''}>${symbol ? icon(symbol) : title}</button>`;
  return `<article class="panel stack" data-editor="${index}"><div class="panel-title"><h3>${q.type === 'section' ? 'Section' : 'Question ' + (index + 1)}</h3>
  <div class="question-tools">${btn('Move question up', 'up', index === 0, 'arrow-up')}${btn('Move question down', 'down', index + 1 === total, 'arrow-down')}${btn('Duplicate', 'copy')}${btn('Remove', 'remove')}</div></div>
  <div class="fields">${input('Title', 'label', q.label)}<label class="control">Question type<select name="type">
  ${Object.entries(labels).map(([type, title]) => `<option value="${type}" ${q.type === type ? 'selected' : ''}>${title}</option>`).join('')}</select></label></div>
  ${input('Description', 'description', q.description)}
  ${options ? `<label class="control">Choices <small>One option per line</small><textarea name="options">${esc(q.options?.join('\n') || '')}</textarea></label><div class="inline">${check('Shuffle options', 'shuffle')}${q.type !== 'dropdown' ? check('Allow “Other” write-in', 'other') : ''}</div>` : ''}
  ${limit ? `<div class="fields">${input(q.type === 'checkbox' ? 'Minimum selections' : 'Minimum', 'min', q.min, 'number')}${input(q.type === 'checkbox' ? 'Maximum selections' : 'Maximum', 'max', q.max, 'number')}</div>` : ''}
  ${q.type === 'scale' ? `<div class="fields">${input('Low label', 'low', q.low)}${input('High label', 'high', q.high)}</div>` : ''}
  ${q.type === 'section' ? '' : input('Custom validation error', 'error', q.error) + check('Required', 'required')}</article>`;
}

async function editor(user) {
  let form = preview ? structuredClone(demoForm) : await api('/api/owner/form');
  appLayout(user, 'form', 'Form builder', 'Customize the application shown to people requesting dashboard access.', `
    <form id="editor" class="stack editor-form" novalidate>
      <section class="panel stack"><h2>Access request form</h2>
      <label class="control">Form title<input name="title" maxlength="100" value="${esc(form.title)}"></label>
      <label class="control">Description<textarea name="description" maxlength="2000">${esc(form.description)}</textarea></label>
      <label class="control">Confirmation message<input name="success" maxlength="300" value="${esc(form.success)}"></label>
      <label class="check"><input type="checkbox" name="open" ${form.open ? 'checked' : ''}>Accept new requests</label></section>
      <div class="stack" id="question-editor"></div>
      <div class="inline"><button class="button ghost" type="button" id="add-question">${icon('plus')} Add question</button><button class="button" type="submit">Save form</button>
      <button class="button ghost" type="button" id="preview-form">Preview</button></div><div id="preview-content" class="stack" hidden></div>
    </form>`);
  const element = $('#editor');
  const render = () => { $('#question-editor').innerHTML = form.questions.map((q, index) => editorQuestion(q, index, form.questions.length)).join(''); };
  const sync = () => {
    for (const field of ['title', 'description', 'success']) form[field] = element.elements[field].value;
    form.open = element.elements.open.checked;
    for (const card of $$('[data-editor]')) {
      const q = form.questions[Number(card.dataset.editor)];
      for (const field of $$('[name]', card)) {
        if (field.name === 'options') q.options = field.value.split('\n').map(value => value.trim()).filter(Boolean);
        else q[field.name] = field.type === 'checkbox' ? field.checked : field.type === 'number' && field.value ? field.valueAsNumber : field.value;
      }
      if (!['short', 'paragraph', 'number', 'checkbox', 'scale'].includes(q.type)) { delete q.min; delete q.max; }
    }
  };
  $('#question-editor').addEventListener('change', event => {
    if (event.target.name !== 'type') return;
    const index = Number(event.target.closest('[data-editor]').dataset.editor);
    const old = form.questions[index].type;
    sync();
    if (old !== form.questions[index].type) {
      delete form.questions[index].min;
      delete form.questions[index].max;
    }
    render();
  });
  $('#question-editor').addEventListener('click', event => {
    const button = event.target.closest('[data-edit]');
    if (!button) return;
    const index = Number(button.closest('[data-editor]').dataset.editor);
    const action = button.dataset.edit;
    sync();
    if (action === 'remove') form.questions.splice(index, 1);
    if (action === 'copy' && form.questions.length < 30) form.questions.splice(index + 1, 0, { ...structuredClone(form.questions[index]), id: crypto.randomUUID() });
    if (action === 'up' || action === 'down') {
      const other = index + (action === 'up' ? -1 : 1);
      [form.questions[index], form.questions[other]] = [form.questions[other], form.questions[index]];
    }
    render();
  });
  $('#add-question').addEventListener('click', () => {
    sync();
    if (form.questions.length >= 30) { status('The form can have up to 30 questions.', 'error'); return; }
    form.questions.push({ id: crypto.randomUUID(), type: 'short', label: '', required: false });
    render();
    $$('[data-editor] [name=label]').at(-1).focus();
  });
  $('#preview-form').addEventListener('click', () => {
    sync();
    const container = $('#preview-content');
    container.hidden = !container.hidden;
    if (!container.hidden) {
      container.innerHTML = `<h2>Form preview</h2>${form.questions.map(q => {
        const min = q.min === '' || q.min == null ? 1 : Number(q.min);
        const max = q.max === '' || q.max == null ? 5 : Number(q.max);
        return applicantQuestion({ ...q, min: Math.max(0, Math.min(min, 10)), max: Math.max(0, Math.min(max, 10)), options: q.options || [] });
      }).join('')}`;
      container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  element.addEventListener('submit', event => {
    event.preventDefault();
    busy($('[type=submit]', element), async () => {
      sync();
      if (!preview) form = await api('/api/owner/form', { method: 'PUT', body: form });
      else if (!form.title.trim() || !form.questions.length || form.questions.some(q => !q.label.trim())) throw new Error('Add a form title and fill in your question titles.');
      render();
      status(preview ? 'Demo form saved.' : 'Access form saved.', 'ok');
    });
  });
  render();
}

async function reviews(user) {
  let mode = 'pending';
  let requests = structuredClone(demoRequests);
  appLayout(user, 'requests', 'Access requests', 'Review applications and grant approved applicants access to Ranking.', `
    <div class="tour-controls" role="group" aria-label="Request status">
    ${['pending', 'approved', 'denied'].map((name, index) => `<button class="tab ${index === 0 ? 'selected' : ''}" data-filter="${name}" aria-pressed="${index === 0}">${name[0].toUpperCase() + name.slice(1)}</button>`).join('')}</div><div class="stack" id="requests"></div>`);
  const render = async () => {
    const current = mode;
    const shown = preview ? requests.filter(item => item.status === current) : (await api('/api/owner/requests?status=' + current)).requests;
    if (mode !== current) return;
    $('#requests').innerHTML = shown.length ? shown.map(item => `<article class="panel stack">
      <div class="panel-title"><div class="inline"><span class="avatar">${esc(item.name.slice(0, 1))}</span><div><h3>${esc(item.name)}</h3><small>${accountLabel(item.account)}${item.roblox_id ? ' · Roblox ' + esc(item.roblox_id) : ''}</small></div></div><span class="pill ${item.status === 'approved' ? 'success' : ''}">${esc(item.status)}</span></div>
      <small>Submitted ${esc(fmtTime(item.opened))}</small><dl class="review-answers">
      ${item.form.questions.filter(q => q.type !== 'section').map(q => { const value = item.answers[q.id]; return `<div><dt>${esc(q.label)}</dt><dd>${esc(Array.isArray(value) ? value.join(', ') : value ?? '—')}</dd></div>`; }).join('')}
      </dl>${mode === 'pending' ? `<label class="control">Decision note <small>Optional · shared with applicant</small><input name="note" maxlength="1000" placeholder="Leave a note"></label><div class="inline"><button class="button small" data-review="approved" data-id="${esc(item.id)}">Approve access</button><button class="button danger small" data-review="denied" data-id="${esc(item.id)}">Deny</button></div>` :
      item.note ? `<p>${esc(item.note)}</p>` : ''}</article>`).join('') : '<div class="panel">No requests match this status.</div>';
  };
  for (const button of $$('[data-filter]')) button.addEventListener('click', () => busy(button, async () => {
    mode = button.dataset.filter;
    for (const tab of $$('[data-filter]')) {
      tab.classList.toggle('selected', tab === button);
      tab.setAttribute('aria-pressed', tab === button);
    }
    await render();
  }));
  $('#requests').addEventListener('click', event => {
    const button = event.target.closest('[data-review]');
    if (!button) return;
    busy(button, async () => {
      const { review, id } = button.dataset;
      const note = $('[name=note]', button.closest('article')).value;
      if (preview) requests = requests.map(item => item.id === id ? { ...item, status: review, note } : item);
      else await api('/api/owner/requests/' + id, { method: 'POST', body: { status: review, note } });
      await render();
      status(review === 'approved' ? 'Access approved.' : 'Request denied.', 'ok');
    });
  });
  await render();
}

async function accounts(user) {
  let demo = demoRequests.map(item => ({ id: item.account, name: item.name, roblox_id: item.roblox_id, access: 1 }));
  appLayout(user, 'accounts', 'Account access', 'Grant or revoke dashboard access for Ranking accounts.', `
    <section class="panel stack"><form id="account-search" class="lookup"><label class="control">Name or account ID<input name="q" maxlength="100"></label><button class="button">Search</button></form><div id="accounts-list"></div></section>`);
  const render = async () => {
    const query = $('#account-search input').value.trim();
    const list = preview ? demo.filter(item => item.name.toLowerCase().includes(query.toLowerCase()) || item.id.includes(query))
      : (await api('/api/owner/accounts?q=' + encodeURIComponent(query))).accounts;
    $('#accounts-list').innerHTML = list.map(item => `<div class="item-row"><div><b>${esc(item.name)}</b><small>${accountLabel(item.id)}${item.roblox_id ? ' · Roblox ' + esc(item.roblox_id) : ''}</small></div>
    <div class="inline"><span class="pill">${item.id === user.id ? 'Owner' : item.access ? 'Approved' : 'Restricted'}</span>
    ${item.id === user.id ? '' : `<button class="button ghost small" data-account="${esc(item.id)}" data-grant="${!item.access}">${item.access ? 'Revoke access' : 'Grant access'}</button>`}</div></div>`).join('') || '<p>No accounts found.</p>';
  };
  $('#account-search').addEventListener('submit', event => { event.preventDefault(); busy($('button', event.currentTarget), render); });
  $('#accounts-list').addEventListener('click', event => {
    const button = event.target.closest('[data-account]');
    if (!button) return;
    const access = button.dataset.grant === 'true';
    if (!access && !confirm('Revoke this account’s dashboard access and suspend its group keys?')) return;
    busy(button, async () => {
      if (preview) demo = demo.map(item => item.id === button.dataset.account ? { ...item, access } : item);
      else await api('/api/owner/accounts/' + button.dataset.account, { method: 'PUT', body: { access } });
      await render();
      status('Account access updated.', 'ok');
    });
  });
  await render();
}

export async function owner() {
  const user = await account();
  if (!user) return;
  if (!user.owner) { location.replace('dashboard.html'); return; }
  const view = new URLSearchParams(location.search).get('view');
  if (view === 'form') await editor(user);
  else if (view === 'accounts') await accounts(user);
  else await reviews(user);
}

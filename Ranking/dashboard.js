import { $, $$, account, api, appLayout, busy, copy, esc, fmtTime, icon, preview, status } from './ui.js';

const demoGroup = { id: '34891321', name: 'Northstar Transit', max_rank: 150, terminate_rank: 1, provider: 'cloud' };
const demoGroups = [demoGroup, { id: '34891322', name: 'Overlook Labs', max_rank: 115, terminate_rank: null, provider: 'cookie' }];
const demoRoles = [{ rank: 1, name: 'Member' }, { rank: 25, name: 'Associate' }, { rank: 50, name: 'Coordinator' }, { rank: 75, name: 'Supervisor' }, { rank: 100, name: 'Manager' }];
const demoEntries = [
  { id: 'demo-1', user_id: '59401122', action: 'promote', previous_rank: 50, new_rank: 75, status: 'completed', created: 1795764900 },
  { id: 'demo-2', user_id: '88140116', action: 'set', previous_rank: 25, new_rank: 50, status: 'completed', created: 1795762100 },
  { id: 'demo-3', user_id: '70105486', action: 'demote', previous_rank: 100, new_rank: 75, status: 'completed', created: 1795758880 }
];
const demoKeys = [{ prefix: 'rnk_demo_workspace', label: 'Training experience', created: 1795511310 }];
const providerLabel = (provider) => provider === 'cloud' ? 'Open Cloud' : 'Cookie';

export function groupFields(user, group) {
  const cookie = group?.provider === 'cookie';
  return `
    ${group ? '' : '<label class="control">Roblox group ID<input name="id" inputmode="numeric" pattern="[1-9][0-9]*" maxlength="18" required placeholder="34891321"></label>'}
    <label class="control">Connection<select name="provider"><option value="cloud">Open Cloud</option>
    ${user.owner || cookie ? `<option value="cookie" ${cookie ? 'selected' : ''}>Cookie</option>` : ''}</select></label>
    <label class="control" data-credential> <span data-credential-label></span><input name="credential" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false" maxlength="512"><small data-credential-help></small></label>
    <div class="fields"><label class="control">Maximum rank<input name="maxRank" type="number" value="${group?.max_rank ?? 200}" min="1" max="254" required></label>
    <label class="control">Termination rank <small>Optional</small><input name="terminateRank" type="number" min="0" max="254" value="${group?.terminate_rank ?? ''}"></label></div>
    <small data-termination-help></small>`;
}

export function groupForm(form, user, group) {
  const sync = () => {
    const cookie = form.elements.provider.value === 'cookie';
    const input = form.elements.credential;
    const unchanged = group?.provider === form.elements.provider.value;
    $('[data-credential]', form).hidden = cookie && !user.owner;
    input.required = !unchanged && !(cookie && !user.owner);
    input.type = cookie ? 'text' : 'password';
    input.placeholder = cookie ? 'NORTHSTAR' : unchanged ? 'Leave empty to keep current key' : 'Creator Dashboard key';
    $('[data-credential-label]', form).textContent = cookie ? 'Cloudflare secret slot' : 'Roblox Open Cloud key';
    $('[data-credential-help]', form).textContent = cookie
      ? 'Enter only the slot name after ROBLOX_COOKIE_, such as NORTHSTAR.'
      : 'Use a group key with member read and write permissions.';
    $('[data-termination-help]', form).textContent = cookie
      ? 'Leave blank to disable termination. Rank 0 removes the member from the group.'
      : 'Leave blank to disable termination, or choose an existing member role.';
    form.elements.terminateRank.min = cookie ? '0' : '1';
  };
  form.elements.provider.addEventListener('change', () => {
    form.elements.credential.value = '';
    sync();
  });
  sync();
  return () => ({
    id: form.elements.id?.value?.trim(), provider: form.elements.provider.value,
    credential: form.elements.credential.value.trim(), maxRank: form.elements.maxRank.valueAsNumber,
    terminateRank: form.elements.terminateRank.value ? form.elements.terminateRank.valueAsNumber : null
  });
}

export async function register() {
  const user = await account();
  if (!user) return;
  if (!user.owner && !user.robloxId) {
    $('#content').innerHTML = `<h2>Verify Roblox first</h2><p>Use the Roblox account that owns the group you want to register.</p><a class="button" href="verify.html">Verify Roblox ${icon('arrow-up-right')}</a>`;
    return;
  }
  $('#content').innerHTML = `<form class="stack" id="registration">${groupFields(user)}<button class="button" type="submit">Register group ${icon('arrow-up-right')}</button><p class="status" id="status" role="status"></p></form>`;
  const form = $('#registration');
  const values = groupForm(form, user);
  form.addEventListener('submit', event => {
    event.preventDefault();
    busy($('button', form), async () => {
      const result = await api('/api/groups', { method: 'POST', body: values() });
      form.reset();
      location.assign('dashboard.html?group=' + encodeURIComponent(result.group.id));
    });
  });
}

function logTable(entries) {
  if (!entries.length) return '<p>No rank changes have been recorded for this group.</p>';
  return `<div class="table-wrap"><table><thead><tr><th>Member ID</th><th>Action</th><th>Rank change</th><th>Status</th><th>Time</th></tr></thead><tbody>
    ${entries.map(entry => `<tr><td>${esc(entry.user_id)}</td><td>${esc(entry.action)}</td><td><span class="rank-transition">${esc(entry.previous_rank ?? '—')} ${icon('arrow-right')}<span class="sr-only">to</span> ${esc(entry.new_rank ?? '—')}</span></td><td><span class="pill ${entry.status === 'completed' ? 'success' : ''}">${esc(entry.status.replaceAll('_', ' '))}</span></td><td>${esc(fmtTime(entry.created))}</td></tr>`).join('')}
    </tbody></table></div>`;
}

export async function dashboard() {
  const user = await account();
  if (!user) return;
  let groups = preview ? demoGroups : (await api('/api/groups')).groups;
  let selected = groups.find(group => group.id === new URLSearchParams(location.search).get('group')) || groups[0];
  let entries = [];
  let keys = [];
  let member;
  let requestVersion = 0;
  const groupUrl = (path) => `/api/groups/${selected.id}${path}`;
  const loadDetails = async () => {
    if (preview) {
      entries = [...demoEntries]; keys = [...demoKeys];
      member = { roles: demoRoles, player: { id: '59401122', name: 'riley_northstar', rank: 50, role: 'Coordinator', member: true } };
    } else if (selected) {
      const [audit, issued] = await Promise.all([api(groupUrl('/audit')), api(groupUrl('/keys'))]);
      entries = audit.entries; keys = issued.keys;
    }
  };

  function renderMember() {
    const box = $('#member-result');
    if (!member) { box.innerHTML = '<p>Search by exact Roblox username or user ID.</p>'; return; }
    const { player, roles } = member;
    const capped = !player.member || player.rank > selected.max_rank;
    box.innerHTML = `<div class="identity"><span class="team-icon" aria-hidden="true">${esc(player.name.slice(0, 2).toUpperCase())}</span>
    <div><strong>${esc(player.name)}</strong><br><small>Roblox ID ${esc(player.id)}</small></div><span class="pill">${esc(player.role)} · ${player.rank}</span></div>
    ${capped ? `<p>${player.member ? 'This member is above your rank cap.' : 'This player has to join the group before you can change their rank.'}</p>` :
    `<label class="control">Target role<select id="target-role"><option value="">Choose a role</option>${roles.map(role => `<option value="${role.rank}" ${preview && role.rank === 75 ? 'selected' : ''}>${esc(role.name)} · ${role.rank}</option>`).join('')}</select></label>
    <div class="rank-buttons"><button class="button small" data-action="set">Set rank</button><button class="button ghost small" data-action="promote" ${roles.some(role => role.rank > player.rank) ? '' : 'disabled'}>${icon('arrow-up')} Promote</button><button class="button ghost small" data-action="demote" ${roles.some(role => role.rank < player.rank) ? '' : 'disabled'}>${icon('arrow-down')} Demote</button>
    ${selected.terminate_rank == null ? '' : '<button class="button danger small" data-action="terminate">Terminate</button>'}</div>`}`;
    for (const button of $$('[data-action]', box)) button.addEventListener('click', () => prepareRank(button.dataset.action));
  }

  function prepareRank(action) {
    const data = member;
    const { player, roles } = data;
    const target = action === 'set' ? roles.find(role => role.rank === Number($('#target-role').value)) :
      action === 'promote' ? roles.find(role => role.rank > player.rank) :
      action === 'demote' ? roles.findLast(role => role.rank < player.rank) :
      selected.terminate_rank === 0 ? { name: 'Guest', rank: 0 } : roles.find(role => role.rank === selected.terminate_rank);
    if (!target) { status('Choose an eligible target role.', 'error'); return; }
    const dialog = $('#rank-dialog');
    $('#rank-summary').textContent = target.rank === 0
      ? `Remove ${player.name} from ${selected.name}?`
      : `Change ${player.name} from ${player.role} to ${target.name} (rank ${target.rank})?`;
    status('', '', $('#dialog-status'));
    $('#confirm-rank').onclick = () => busy($('#confirm-rank'), async () => {
      if (preview) {
        entries.unshift({ id: crypto.randomUUID(), user_id: player.id, action, previous_rank: player.rank,
          new_rank: target.rank, status: 'completed', created: Math.floor(Date.now() / 1000) });
      } else {
        await api(groupUrl('/rank'), { method: 'POST', body: {
          action, userId: player.id, expectedRank: player.rank, rank: target.rank, requestId: crypto.randomUUID()
        } });
      }
      dialog.close();
      data.player = { ...player, rank: target.rank, role: target.name, member: target.rank > 0 };
      renderMember();
      status(preview ? 'Demo rank updated.' : 'Rank updated.', 'ok');
      if (!preview) entries = (await api(groupUrl('/audit'))).entries;
      $('#log-rows').innerHTML = logTable(entries);
      $('#audit-count').textContent = entries.length;
    }, $('#dialog-status'));
    dialog.showModal();
  }

  function render() {
    if (!selected) {
      appLayout(user, 'dashboard', 'Rank control', 'Manage group ranks and issue experience keys.',
        `<section class="panel stack"><h2>Connect your first group</h2><p>Register a Roblox group to start ranking members.</p><a class="button" href="register.html">Register a group ${icon('arrow-up-right')}</a></section>`);
      return;
    }
    appLayout(user, 'dashboard', 'Rank control', 'Look up a group member and manage their Roblox role.', `
      <div class="stat-grid"><div class="panel stat"><small>Connection</small><strong>${providerLabel(selected.provider)}</strong></div>
      <div class="panel stat"><small>Maximum rank</small><strong>${selected.max_rank}</strong></div>
      <div class="panel stat"><small>Recent changes</small><strong id="audit-count">${entries.length}</strong></div></div>
      <div class="dash-grid"><div class="stack">
      <section class="panel stack"><div class="panel-title"><h2>Rank a member</h2><span class="pill">${esc(selected.name)}</span></div>
      <form class="lookup" id="lookup"><label class="control">Roblox username or user ID<input name="player" value="${preview ? 'riley_northstar' : ''}" required maxlength="30" placeholder="Enter a username or ID"></label><button type="submit" class="button ghost">Look up</button></form>
      <div class="stack" id="member-result"></div></section>
      <section class="panel stack"><h2>Recent activity</h2><div id="log-rows">${logTable(entries)}</div></section></div>
      <div class="stack"><section class="panel stack"><div class="panel-title"><h2>Group</h2><a class="button ghost small" href="register.html">Add group</a></div>
      <label class="control">Selected group<select id="group-select">${groups.map(group => `<option value="${group.id}" ${group.id === selected.id ? 'selected' : ''}>${esc(group.name)}</option>`).join('')}</select></label>
      <small>Roblox group ID ${esc(selected.id)}</small><details><summary>${icon('chevron-down')} Connection settings</summary><form class="stack" id="group-settings">${groupFields(user, selected)}<button class="button small" type="submit">Save settings</button></form></details></section>
      <section class="panel stack"><h2>Experience keys</h2><small>Each key ranks in this group. Copy it when it is issued.</small>
      <form class="lookup" id="new-key"><label class="control">Key name<input required name="label" maxlength="60" placeholder="Training experience"></label><button class="button small" type="submit">Issue key</button></form>
      <div class="stack" id="issued-key"></div><div id="key-list"></div></section></div></div>
      <dialog id="rank-dialog" class="panel"><div class="stack"><h2>Confirm rank change</h2><p id="rank-summary"></p><p id="dialog-status" class="status" role="status"></p><div class="inline"><button class="button" id="confirm-rank">Confirm change</button><form method="dialog"><button class="button ghost">Cancel</button></form></div></div></dialog>`);
    wireEvents();
    renderMember();
    renderKeys();
  }

  function renderKeys() {
    $('#key-list').innerHTML = keys.length ? keys.map(key =>
      `<div class="item-row"><div><b>${esc(key.label)}</b><small>${esc(key.prefix)}…</small></div>
      <button class="button danger small" data-revoke="${esc(key.prefix)}">Revoke</button></div>`).join('') : '<p>No keys issued yet.</p>';
    for (const button of $$('[data-revoke]')) button.addEventListener('click', () => {
      if (!window.confirm('Revoke this experience key? Roblox servers using it will lose ranking access.')) return;
      busy(button, async () => {
        if (!preview) await api(groupUrl('/keys/' + encodeURIComponent(button.dataset.revoke)), { method: 'DELETE' });
        keys = keys.filter(key => key.prefix !== button.dataset.revoke);
        $('#issued-key').replaceChildren();
        renderKeys();
        status('Key revoked.', 'ok');
      });
    });
  }

  function wireEvents() {
    $('#group-select').addEventListener('change', () => {
      const url = new URL(location.href);
      url.searchParams.set('group', $('#group-select').value);
      location.assign(url.href);
    });
    $('#lookup').addEventListener('submit', event => {
      event.preventDefault();
      const form = event.currentTarget;
      const value = form.elements.player.value.trim();
      const version = ++requestVersion;
      busy($('button', form), async () => {
        member = undefined;
        $('#member-result').textContent = 'Looking up the member…';
        try {
          const result = preview ? { roles: demoRoles, player: { id: /^[0-9]+$/.test(value) ? value : '59401122', name: value, rank: 50, role: 'Coordinator', member: true } }
            : await api(groupUrl('/member?player=' + encodeURIComponent(value)));
          if (version === requestVersion) member = result;
        } finally {
          if (version === requestVersion) renderMember();
        }
      });
    });
    const settingsForm = $('#group-settings');
    const values = groupForm(settingsForm, user, selected);
    settingsForm.addEventListener('submit', event => {
      event.preventDefault();
      busy($('button', settingsForm), async () => {
        const input = values();
        const { group } = preview ? { group: { ...selected, provider: input.provider, max_rank: input.maxRank, terminate_rank: input.terminateRank } }
          : await api(groupUrl(''), { method: 'PUT', body: input });
        selected = group; groups = groups.map(item => item.id === group.id ? group : item);
        if (!preview) member = undefined;
        render();
        status('Group settings saved.', 'ok');
      });
    });
    const issue = $('#new-key');
    issue.addEventListener('submit', event => {
      event.preventDefault();
      busy($('button', issue), async () => {
        const label = issue.elements.label.value.trim();
        const issued = preview ? { token: 'DEMO-ONLY-' + crypto.randomUUID(), prefix: 'demo_' + Date.now().toString() }
          : await api(groupUrl('/keys'), { method: 'POST', body: { label } });
        keys.unshift({ label, prefix: issued.prefix });
        $('#issued-key').innerHTML = `<span class="code-block">${esc(issued.token)}</span><button class="button ghost small">Copy key</button>`;
        $('#issued-key button').addEventListener('click', () => copy(issued.token));
        issue.reset();
        renderKeys();
        status('Copy the new key now. It is shown once.', 'ok');
      });
    });
  }
  await loadDetails();
  render();
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export const fmtTime = (time) => new Date(time * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
export const preview = new URLSearchParams(location.search).get('preview') === '1';
const tokenName = 'ranking-session';

export async function api(path, options = {}) {
  const base = window.RANKING_API;
  if (!base) throw new Error('The live Ranking API is being set up. You can still explore the dashboard preview.');
  const token = sessionStorage.getItem(tokenName);
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + path, {
    method: options.method || 'GET', credentials: 'omit',
    headers, body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || 'Ranking could not complete this request.');
    error.status = response.status;
    error.details = result.details;
    throw error;
  }
  return result;
}

export function setSession(value) {
  if (value) sessionStorage.setItem(tokenName, value);
  else sessionStorage.removeItem(tokenName);
}

export async function account(needsAccess = true) {
  if (preview) return { id: '100000000000000009', name: 'Jordan Park', owner: true, access: true, robloxId: '4500217' };
  if (!sessionStorage.getItem(tokenName)) {
    location.replace('login.html');
    return;
  }
  try {
    const user = await api('/api/me');
    if (needsAccess && !user.access) {
      location.replace('access.html');
      return;
    }
    return user;
  } catch (error) {
    if (error.status === 401) {
      setSession(null);
      location.replace('login.html');
      return;
    }
    throw error;
  }
}

export function status(message, mode = '', node = $('#status')) {
  if (!node) return;
  node.textContent = message || '';
  node.className = `status ${mode}`;
}

export async function busy(button, action, output = $('#status')) {
  if (button.disabled) return;
  button.disabled = true;
  status('', '', output);
  try {
    await action();
  } catch (error) {
    status(error.message, 'error', output);
  } finally {
    button.disabled = false;
  }
}

export async function copy(value, output = $('#status')) {
  try {
    await navigator.clipboard.writeText(value);
    status('Copied to clipboard.', 'ok', output);
  } catch {
    status('Select the displayed value and copy it manually.', '', output);
  }
}

function syncTheme() {
  const current = document.documentElement.dataset.theme;
  for (const button of $$('[data-theme-toggle]')) {
    button.textContent = current === 'dark' ? '☼' : '☾';
    button.setAttribute('aria-label', `Switch to ${current === 'dark' ? 'light' : 'dark'} mode`);
  }
  for (const img of $$('[data-dark][data-light]')) {
    if (img.getAttribute('src') !== img.dataset[current]) img.src = img.dataset[current];
  }
}

export function theme() {
  syncTheme();
  if (document.body.dataset.themeReady) return;
  document.body.dataset.themeReady = 'true';
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-theme-toggle]')) return;
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    const swap = () => {
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('ranking-theme', next); } catch {}
      syncTheme();
    };
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(swap);
    else swap();
  });
}

export function appLayout(user, current, heading, intro, inner) {
  const link = (id, href, glyph, label) => `<a class="app-link" ${id === current ? 'aria-current="page"' : ''} href="${href}"><span aria-hidden="true">${glyph}</span>${label}</a>`;
  const query = preview ? '?preview=1' : '';
  const ownerQuery = preview ? '&preview=1' : '';
  $('#app').innerHTML = `<aside class="app-sidebar"><a class="brand" href="./"><span class="brand-mark" aria-hidden="true">↗</span> Ranking<span class="brand-dot">.</span></a>
    <nav aria-label="Workspace"><span class="nav-label">Workspace</span>
    ${link('dashboard', 'dashboard.html' + query, '◈', 'Rank control')}${link('register', 'register.html', '⊞', 'Register group')}
    ${link('verify', 'verify.html', '◇', 'Verify Roblox')}${link('docs', 'docs.html', '⌘', 'API docs')}
    ${user.owner ? `<span class="nav-label">Owner</span>${link('requests', 'owner.html?view=requests' + ownerQuery, '◎', 'Access requests')}${link('form', 'owner.html?view=form' + ownerQuery, '☷', 'Form builder')}${link('accounts', 'owner.html?view=accounts' + ownerQuery, '◇', 'Accounts')}` : ''}
    </nav><div class="sidebar-end"><a class="app-link" href="./"><span aria-hidden="true">↗</span> Product tour</a></div></aside>
    <div><header class="dash-top"><div class="kicker">${preview ? 'DEMO WORKSPACE' : 'RANKING WORKSPACE'}</div><div class="inline">
    <span class="avatar">${user.avatar ? `<img alt="" src="${esc(user.avatar)}">` : esc(user.name.slice(0, 1))}</span><strong>${esc(user.name)}</strong>
    <button class="icon-button" type="button" data-theme-toggle aria-label="Switch theme">☼</button>
    ${preview ? '' : '<button class="button ghost small" id="logout">Sign out</button>'}</div></header>
    <main class="dash-body"><div class="page-heading"><h1>${heading}</h1><p>${intro}</p></div>
    <p id="status" class="status" role="status"></p>${inner}</main></div>`;
  theme();
  $('#logout')?.addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } finally { setSession(null); location.assign('./'); }
  });
}

export function setTour(name) {
  const image = $('#tour-screen');
  const labels = {
    dashboard: ['Rank control', 'Ranking dashboard with member lookup, role controls and activity'],
    owner: ['Request review', 'Ranking owner console with a completed access application ready for review'],
    form: ['Form builder', 'Ranking form builder showing question options and validation']
  };
  const [title, alt] = labels[name];
  image.dataset.dark = `assets/${name}-dark.webp`;
  image.dataset.light = `assets/${name}-light.webp`;
  image.alt = alt;
  syncTheme();
  $('#tour-caption').textContent = title + ' · Dashboard preview with fictional data';
  for (const button of $$('[data-tour]')) {
    const selected = button.dataset.tour === name;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', selected);
  }
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) image.animate([{ opacity: .45 }, { opacity: 1 }], { duration: 280 });
}

export function setupTour() {
  for (const button of $$('[data-tour]')) button.addEventListener('click', () => setTour(button.dataset.tour));
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    }), { threshold: .08 });
    document.documentElement.classList.add('animate-scroll');
    for (const item of $$('.reveal')) observer.observe(item);
  }
}

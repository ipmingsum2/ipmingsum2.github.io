import { $, account, api, busy, copy, esc, setSession, setupTour, status, theme } from './ui.js';
import { dashboard, register } from './dashboard.js';
import { access, owner } from './forms.js';

const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

async function login() {
  const button = $('#discord-login');
  const redirect = new URLSearchParams(location.hash.slice(1));
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  const verifier = sessionStorage.getItem('ranking-login-verifier');
  if (redirect.has('error')) {
    sessionStorage.removeItem('ranking-login-verifier');
    status('Discord sign-in expired or was canceled. Try again.', 'error');
  }
  button.addEventListener('click', () => busy(button, async () => {
    const browserSecret = encode(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = encode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(browserSecret)));
    sessionStorage.setItem('ranking-login-verifier', browserSecret);
    const { url } = await api('/api/auth/discord/start', { method: 'POST', body: { challenge } });
    const target = new URL(url);
    if (target.origin !== 'https://discord.com' || target.pathname !== '/oauth2/authorize') throw new Error('Discord sign-in could not start.');
    location.assign(target.href);
  }));
  if (redirect.has('ticket')) {
    sessionStorage.removeItem('ranking-login-verifier');
    await busy(button, async () => {
      if (!verifier) throw new Error('Open Discord sign-in from this tab to continue.');
      const { token } = await api('/api/auth/exchange', { method: 'POST', body: { ticket: redirect.get('ticket'), verifier } });
      setSession(token);
      const user = await account(false);
      if (user) location.replace(user.access ? 'dashboard.html' : 'access.html');
    });
  }
}

async function verify() {
  const user = await account(false);
  if (!user) return;
  const content = $('#content');
  let timer;
  const linked = id => {
    clearInterval(timer);
    content.innerHTML = `<h2>Roblox account verified</h2><p>Linked Roblox ID ${esc(id)}.</p>
      <a class="button" href="${user.access ? 'dashboard.html' : 'access.html'}">Continue ↗</a>`;
  };
  if (user.robloxId) { linked(user.robloxId); return; }
  content.innerHTML = `<h2>Generate a verification code</h2><p>Enter your code in the Ranking verification center within 10 minutes.</p>
    <div id="verification-output" class="stack"></div><div class="inline"><button type="button" class="button" id="create-code">Generate code</button>
    <button type="button" class="button ghost" id="refresh-code" hidden>Check verification</button></div><p id="status" class="status" role="status"></p>`;
  const check = async (manual = false) => {
    try {
      const profile = await api('/api/me');
      if (profile.robloxId) linked(profile.robloxId);
      else if (manual) status('Waiting for your code to be entered in Roblox.');
    } catch (error) {
      if (manual) status(error.message, 'error');
    }
  };
  const button = $('#create-code');
  const refresh = $('#refresh-code');
  refresh.addEventListener('click', () => busy(refresh, () => check(true)));
  button.addEventListener('click', () => busy(button, async () => {
    const result = await api('/api/verification', { method: 'POST' });
    if (!/^[1-9]\d*$/.test(result.placeId)) throw new Error('The verification place is unavailable.');
    clearInterval(timer);
    $('#verification-output').innerHTML = `<code class="code-block verification-code">${esc(result.code)}</code><div class="inline">
      <button type="button" class="button ghost small" id="copy-code">Copy code</button><a class="button ghost small" href="https://www.roblox.com/games/${result.placeId}" target="_blank" rel="noopener noreferrer">Open verification center ↗</a></div><small id="code-expires"></small>`;
    $('#copy-code').addEventListener('click', () => copy(result.code));
    button.textContent = 'Generate new code';
    refresh.hidden = false;
    let ticks = 0;
    const update = () => {
      const left = Math.max(0, result.expires - Math.floor(Date.now() / 1000));
      $('#code-expires').textContent = left ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Code expired. Generate a new code.';
      if (!left) clearInterval(timer);
      else if (++ticks % 5 === 0 && document.visibilityState === 'visible') void check();
    };
    timer = setInterval(update, 1000);
    update();
  }));
}

theme();
const routes = { home: setupTour, access, owner, login, verify, register, dashboard };
Promise.resolve().then(() => routes[document.body.dataset.page]?.()).catch(error => {
  const target = $('#status') || $('#content') || $('#app main');
  if (target) status(error.message || 'Ranking could not load this page.', 'error', target);
});

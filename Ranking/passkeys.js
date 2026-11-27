import { $, account, api, busy, fmtTime, icon, setSession, status } from './ui.js';

const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const supported = () => window.isSecureContext && Boolean(window.PublicKeyCredential && navigator.credentials);

function parseOptions(options, signingIn) {
  const parser = signingIn ? 'parseRequestOptionsFromJSON' : 'parseCreationOptionsFromJSON';
  if (PublicKeyCredential[parser]) return PublicKeyCredential[parser](options);
  const parsed = { ...options, challenge: decode(options.challenge) };
  const list = signingIn ? 'allowCredentials' : 'excludeCredentials';
  if (options[list]) parsed[list] = options[list].map(item => ({ ...item, id: decode(item.id) }));
  if (!signingIn) parsed.user = { ...options.user, id: decode(options.user.id) };
  return parsed;
}

function credentialJSON(credential, signingIn) {
  if (credential.toJSON) return credential.toJSON();
  const source = credential.response;
  const response = { clientDataJSON: encode(source.clientDataJSON) };
  if (signingIn) {
    response.authenticatorData = encode(source.authenticatorData);
    response.signature = encode(source.signature);
    response.userHandle = source.userHandle ? encode(source.userHandle) : null;
  } else {
    response.attestationObject = encode(source.attestationObject);
    response.transports = source.getTransports?.() ?? [];
  }
  return {
    id: credential.id, rawId: encode(credential.rawId), type: credential.type, response,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults()
  };
}

async function passkey(purpose, data = {}) {
  if (!supported()) throw new Error('Passkeys are unavailable here. Open Ranking in a current browser over HTTPS.');
  const url = '/api/auth/passkeys/' + purpose;
  const { ceremony, options } = await api(url + '/begin', { method: 'POST', body: data });
  const signingIn = purpose === 'login';
  const publicKey = parseOptions(options, signingIn);
  let credential;
  try {
    credential = await navigator.credentials[signingIn ? 'get' : 'create']({ publicKey });
  } catch (error) {
    if (error.name === 'InvalidStateError') throw new Error('This passkey is already linked to your account.');
    if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
      throw new Error('The passkey prompt closed. Try again or use a device that has your Ranking passkey.');
    }
    throw new Error('Your browser or device could not use a passkey. Try another device or sign in with Discord.');
  }
  if (!credential) throw new Error('No passkey was selected. Try again.');
  return api(url + '/finish', { method: 'POST', body: { ceremony, credential: credentialJSON(credential, signingIn) } });
}

export async function finishSignIn(token) {
  setSession(token);
  const user = await account(false);
  if (user) location.replace(user.access ? 'dashboard.html' : 'access.html');
}

export function passkeyLogin() {
  const button = $('#passkey-login');
  button.addEventListener('click', () => busy(button, async () => finishSignIn((await passkey('login')).token)));
}

export function signup() {
  const form = $('#signup');
  form.addEventListener('submit', event => {
    event.preventDefault();
    const name = new FormData(form).get('name');
    void busy($('button[type="submit"]', form), async () => finishSignIn((await passkey('signup', { name })).token));
  });
}

export async function settings() {
  const user = await account(false);
  if (!user) return;
  $('#account-back').href = user.access ? 'dashboard.html' : 'access.html';
  $('#account-back').textContent = user.access ? 'Back to dashboard' : 'Back to access request';
  $('#profile-name').textContent = user.name;
  $('#profile-provider').textContent = user.discordId ? 'Discord account' : 'Ranking account';
  const refresh = async () => {
    const { passkeys } = await api('/api/me/passkeys');
    $('#passkey-list').innerHTML = passkeys.map(item => `<li class="item-row"><div class="inline">${icon('passkey')}
      <div><b>Passkey</b><small>Added ${fmtTime(item.created)}${item.used ? ` · Last used ${fmtTime(item.used)}` : ''}</small></div></div></li>`).join('');
    $('#no-passkeys').hidden = passkeys.length > 0;
    return passkeys.length;
  };
  const button = $('#add-passkey');
  let count = await refresh();
  button.disabled = count >= 10;
  button.addEventListener('click', async () => {
    await busy(button, async () => {
      await passkey('link');
      count = await refresh();
      status('Passkey linked. You can use it the next time you sign in.', 'ok');
    });
    button.disabled = count >= 10;
  });
}

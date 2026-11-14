// Generates Roblox place files (.rbxlx, the XML place format) in the browser.
// The Luau sources live in /roblox as plain files; this wraps them in a minimal place:
// a baseplate + spawn, the server Script (holding the API URL and key), the client LocalScript,
// and HttpService with HTTP requests enabled.
'use strict';

const PLACES = {
  appcenter: { server: 'AppCenter.server.lua', client: 'AppCenter.client.lua', name: 'ApplicationCenter' },
  verify: { server: 'VerifyGame.server.lua', client: 'VerifyGame.client.lua', name: 'Verification' },
};

async function luaSource(file) {
  const r = await fetch(`roblox/${file}`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Could not load roblox/${file} (${r.status})`);
  return r.text();
}

const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Luau double-quoted string contents.
const luaEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');
// CDATA cannot contain "]]>", so split it across two sections if it ever appears.
const cdata = (s) => `<![CDATA[${String(s).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

let refId = 0;
const ref = () => `RBX${(++refId).toString(16).toUpperCase().padStart(8, '0')}`;
const item = (cls, name, props = '', children = '') =>
  `<Item class="${cls}" referent="${ref()}"><Properties><string name="Name">${xmlEsc(name)}</string>${props}</Properties>${children}</Item>`;
const script = (cls, name, source) => item(cls, name, `<ProtectedString name="Source">${cdata(source)}</ProtectedString>`);
const cframe = (x, y, z) => `<CoordinateFrame name="CFrame"><X>${x}</X><Y>${y}</Y><Z>${z}</Z><R00>1</R00><R01>0</R01><R02>0</R02><R10>0</R10><R11>1</R11><R12>0</R12><R20>0</R20><R21>0</R21><R22>1</R22></CoordinateFrame>`;
const part = (cls, name, [x, y, z], [sx, sy, sz], color) => item(cls, name,
  `<bool name="Anchored">true</bool>${cframe(x, y, z)}<Vector3 name="size"><X>${sx}</X><Y>${sy}</Y><Z>${sz}</Z></Vector3><Color3uint8 name="Color3uint8">${color}</Color3uint8><token name="TopSurface">0</token><token name="BottomSurface">0</token>`);

/**
 * buildPlaceFile('appcenter' | 'verify', {apiUrl, apiKey, title}) -> rbxlx XML string.
 * The API key is only ever written into the server Script.
 */
async function buildPlaceFile(kind, { apiUrl, apiKey, title }) {
  const def = PLACES[kind];
  if (!def) throw new Error('Unknown place type');
  const fill = (src) => src.replaceAll('__API_URL__', luaEsc(apiUrl)).replaceAll('__API_KEY__', luaEsc(apiKey)).replaceAll('__TITLE__', luaEsc(title || def.name));
  const [server, client] = await Promise.all([luaSource(def.server), luaSource(def.client)]);
  refId = 0;
  const body = [
    item('Workspace', 'Workspace', '<bool name="FilteringEnabled">true</bool>',
      part('Part', 'Baseplate', [0, -8, 0], [256, 16, 256], 4283256155) + part('SpawnLocation', 'SpawnLocation', [0, 0.5, 0], [12, 1, 12], 4284177243)),
    item('ServerScriptService', 'ServerScriptService', '', script('Script', def.name, fill(server))),
    item('StarterPlayer', 'StarterPlayer', '', item('StarterPlayerScripts', 'StarterPlayerScripts', '', script('LocalScript', `${def.name}Client`, fill(client)))),
    item('ReplicatedStorage', 'ReplicatedStorage'),
    item('Lighting', 'Lighting'),
    item('HttpService', 'HttpService', '<bool name="HttpEnabled">true</bool>'),
  ].join('\n');
  return `<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">\n<External>null</External>\n<External>nil</External>\n${body}\n</roblox>\n`;
}

// ---------- admin-system plugins (.rbxmx model files) ----------
// Plugins hold no API key — they call the ActivityTracker module, which does. Right-click the folder named in
// `into` in Studio, choose "Insert from File…" and pick the download.
const BAE_COMMANDS = ['rpinfo', 'rpwarn', 'rpstrike', 'rppromote', 'rpdemote', 'rpblacklist', 'rpcert', 'duty', 'onduty'];
const ADMIN_PLUGINS = {
  adonis: { label: 'Adonis', into: 'Adonis_Loader › Config › Plugins', mirror: true,
    items: async () => [script('ModuleScript', 'Server-RoleplaySystem', await luaSource('plugins/Adonis.lua'))] },
  bae: { label: 'Basic Admin Essentials 2.0', into: 'Basic Admin Essentials 2.0 › Plugins', mirror: true,
    items: async () => {
      const core = await luaSource('plugins/BasicAdmin.lua');
      return BAE_COMMANDS.map((n) => n === 'rpinfo'
        ? item('ModuleScript', n, `<ProtectedString name="Source">${cdata('-- Roleplay System: see the Core module inside this one.\nreturn require(script:WaitForChild("Core"))("rpinfo")\n')}</ProtectedString>`, script('ModuleScript', 'Core', core))
        : script('ModuleScript', n, `-- Roleplay System command (the shared code is rpinfo > Core).\nreturn require(script.Parent:WaitForChild("rpinfo"):WaitForChild("Core"))("${n}")\n`));
    } },
  hd1: { label: 'HD Admin v1 (classic)', into: 'HD Admin › Config › Commands › Server', mirror: false,
    merge: 'for _, command in require(script.RoleplaySystem) do table.insert(module, command) end',
    items: async () => [script('ModuleScript', 'RoleplaySystem', await luaSource('plugins/HDAdmin1.lua'))] },
  hd2: { label: 'HD Admin v2', into: 'HD Admin › Config › Commands', mirror: false,
    items: async () => [script('ModuleScript', 'RoleplaySystem', await luaSource('plugins/HDAdmin2.lua'))] },
  kohls: { label: 'Kohl’s Admin', into: 'Kohl’s Admin › Config › Addons', mirror: true,
    items: async () => [script('ModuleScript', 'RoleplaySystem', await luaSource('plugins/KohlsAdmin.lua')), script('ModuleScript', 'RoleplaySystemServer', await luaSource('plugins/KohlsAdminServer.lua'))] },
  kai: { label: 'Kohl’s Admin Infinite', into: 'Custom_Commands (Kohl’s Admin › Config › Legacy › Custom_Commands)', mirror: false,
    merge: 'for _, command in require(script.RoleplaySystem) do table.insert(commands, command) end',
    items: async () => [script('ModuleScript', 'RoleplaySystem', await luaSource('plugins/KohlsInfinite.lua'))] },
};

/** buildModelFile(kind) -> {name, xml} for one admin system's plugin. */
async function buildModelFile(kind) {
  const def = ADMIN_PLUGINS[kind];
  if (!def) throw new Error('Unknown admin system');
  refId = 0;
  const body = (await def.items()).join('\n');
  return { name: `RoleplaySystem-${kind}.rbxmx`, xml: `<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">\n<External>null</External>\n<External>nil</External>\n${body}\n</roblox>\n` };
}

// ---------- activity tracker (.rbxmx) ----------
const trackerLoader = (apiUrl, apiKey) => `-- Starts the Roleplay System tracker. Keep this Script next to the ActivityTracker ModuleScript in ServerScriptService.
-- The API key below is secret: never put it in a LocalScript or share this place file.
local ActivityTracker = require(script.Parent:WaitForChild("ActivityTracker"))

ActivityTracker.Start({
\tApiUrl = "${luaEsc(apiUrl)}",
\tApiKey = "${luaEsc(apiKey)}",
})
`;

/**
 * buildTrackerModel({apiUrl?, apiKey?}) -> {name, xml}. Always a ModuleScript named "ActivityTracker"; with a key it
 * also contains the "RoleplaySystemLoader" Script. Insert both into ServerScriptService.
 */
async function buildTrackerModel({ apiUrl, apiKey } = {}) {
  refId = 0;
  const parts = [script('ModuleScript', 'ActivityTracker', await luaSource('ActivityTracker.lua'))];
  if (apiKey) parts.push(script('Script', 'RoleplaySystemLoader', trackerLoader(apiUrl, apiKey)));
  return { name: apiKey ? 'ActivityTracker-with-loader.rbxmx' : 'ActivityTracker.rbxmx', xml: `<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">\n<External>null</External>\n<External>nil</External>\n${parts.join('\n')}\n</roblox>\n` };
}

# Roleplay System

A whitelist-only management system for Roblox roleplay groups: activity tracking, requirements, time off, ranking, logs, application centers, account linking and a public API.

- **API** — one Cloudflare Worker + a D1 database (`worker/`)
- **Dashboard** — static HTML/JS, no build step, hosted on GitHub Pages (this folder)
- **Roblox** — a tracker ModuleScript plus generated place files (`roblox/`)

**Live:** tour <https://ipmingsum2.github.io/roleplay-system/> · dashboard <https://ipmingsum2.github.io/roleplay-system/app.html> · API `https://rp-system.ipmingsum5.workers.dev` · [API docs](https://ipmingsum2.github.io/roleplay-system/docs.html)

## What it does

| Area | Details |
|---|---|
| Activity | Total hours played per member, filter by today / this week / last week / 30 days / all time / custom dates, daily or weekly bar graph, idle time, sessions, chat messages, who is in game now, manual adjustments |
| Requirements | Daily and weekly minimums, per-rank overrides, hourly scheduler, Discord webhook when members miss them (custom header + per-member line, role mention, ping linked members), manual "run now" |
| Time off | Requests (dashboard or API), approve/deny, approved time off excuses members from requirements |
| Ranking | Promote / demote / set rank through Roblox Open Cloud, with a maximum assignable rank |
| Groups | Any number of groups, each with its own tracked ranks, Open Cloud key, webhooks and settings |
| Logging | Every action is logged (promotions, demotions, missed requirements, sign-ins, settings, applications…), searchable, optionally mirrored to a Discord channel |
| Applications | Form builder (9 question types, required flags, optional auto-grading), web form + in-game application center, review with optional auto-rank |
| Accounts | Sign in with Google or Discord, link one to the other, link Roblox through a verification game |
| Access | Whitelist-only. The owner manages the whitelist and per-user permissions |
| Extras | Scheduled sessions (shifts/trainings) with Discord announcements, member notes and warnings, public API with scoped keys, API docs page |

## Feature tour

`index.html` is an animated, scroll-driven tour of every feature that ends with the sign-in; the sidebar lists each section and has sign-in buttons too. Its previews in `assets/screens/` are real screenshots of the dashboard running on fictional demo data, captured in light and dark (`<page>-light.webp` / `<page>-dark.webp`) — the tour swaps them with the theme. The light/dark toggle on every page remembers its choice; with no choice the system setting applies.

## Setup

You need a Cloudflare account, a GitHub account, and Node.js 18+.

### 1. Deploy the API (Cloudflare Worker)

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create rp-system
```

Copy the `database_id` it prints into `worker/wrangler.toml`, then:

```bash
npx wrangler d1 execute rp-system --remote --file=schema.sql
npx wrangler secret put SECRET_KEY
npx wrangler secret put OWNER_GOOGLE_EMAIL
npx wrangler secret put OWNER_DISCORD_ID
npx wrangler secret put OWNER_ROBLOX_ID
npx wrangler deploy
```

For `SECRET_KEY`, paste a long random string (40+ characters). It signs tokens and encrypts stored Open Cloud keys — if you change it later, re-enter each group's Open Cloud key.

The three `OWNER_*` values identify the owner, who always has full access and is the only one who can edit the whitelist. They are secrets rather than `[vars]` so they are not published with the repo.

Note the Worker URL it prints, e.g. `https://rp-system.YOURNAME.workers.dev`.

### 2. Sign-in providers

**Google** — [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → Create credentials → OAuth client ID → Web application.
Authorised redirect URI: `https://YOUR-WORKER-URL/auth/google/callback`

**Discord** — [Discord Developer Portal](https://discord.com/developers/applications) → New Application → OAuth2.
Redirect: `https://YOUR-WORKER-URL/auth/discord/callback`

Put the two client IDs in `wrangler.toml` (`GOOGLE_CLIENT_ID`, `DISCORD_CLIENT_ID`), then store the secrets and redeploy:

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler deploy
```

### 3. Host the dashboard (GitHub Pages)

This folder lives at `roleplay-system/` in the `ipmingsum2.github.io` repo. That site is built by Retype (`.github/workflows/retype-action.yml`), which lowercases file names, so `retype.yml` excludes `roleplay-system/` and the workflow copies the folder into the output unchanged ("Include roleplay system dashboard" step). Pushing to `main` publishes it.

1. `API_URL` in `config.js` points at the Worker.
2. `DASHBOARD_URL` in `worker/wrangler.toml` is the dashboard URL (no trailing slash); after changing it run `npx wrangler deploy`.

`DASHBOARD_URL` is where sign-in sends people back to — if it is wrong, sign-in will land on a 404.

### 4. First sign-in

Open the dashboard and sign in with the owner's Google or Discord account (the `OWNER_*` secrets). Then:

1. **Groups → Add group** — group ID + an Open Cloud API key ([create.roblox.com → Open Cloud → API keys](https://create.roblox.com/dashboard/credentials)) with `group:read` and `group:write` for that group. The key's owner must be able to manage members in the group.
2. Tick the **tracked ranks** and save.
3. **Groups → Roblox setup** — download the tracker module, verification game and application center.
4. **Access** — whitelist your staff and choose their permissions.

### 5. Roblox

Everything Roblox-side talks to the API with a key held in a **server Script**. In every place, turn on **Game Settings → Security → Allow HTTP Requests**.

**Activity tracker** — add `ActivityTracker.lua` as a ModuleScript named `ActivityTracker` in `ServerScriptService`, plus a Script next to it (the dashboard copies this with a fresh key filled in):

```lua
local ActivityTracker = require(script.Parent:WaitForChild("ActivityTracker"))

ActivityTracker.Start({
	ApiUrl = "https://rp-system.YOURNAME.workers.dev",
	ApiKey = "rpk_...",
})
```

**Application center (.rbxlx)** — generated from the Applications page. The place stores no questions: it fetches the group's open applications from the API whenever a player opens it, so editing a form in the dashboard updates the game without republishing.

**Verification game (.rbxlx)** — players sign in with Discord on `verify.html`, get a code, and type it in this game to link Discord ↔ Roblox.

Generated files embed an API key. Do not share them or make the places copyable; revoke keys on the API page if one leaks.

## Permissions

Everyone on the whitelist can view activity, requirements, time off and sessions. The owner grants the rest per user:

`manage_activity` · `ranking` · `manage_groups` · `manage_applications` · `review_applications` · `view_logs` · `manage_api_keys`

Only the owner can edit the whitelist.

## Public API

Full reference: `docs.html` on your dashboard (linked from the API page). Keys are created in the dashboard, shown once, scoped (`read`, `ranking`, `timeoff`, `game`, `verify`) and can be limited to one group.

```bash
curl "https://YOUR-WORKER-URL/v1/groups/1234567/activity?from=2026-11-09&to=2026-11-15" -H "Authorization: Bearer rpk_..."
```

## Local development

```bash
cd worker
printf 'SECRET_KEY=local-dev-secret-key-not-for-production\nDEV_LOGIN=1\n' > .dev.vars
npx wrangler d1 execute rp-system --local --file=schema.sql
npx wrangler dev
```

Serve this folder from localhost (for example `npx http-server . -p 5173`) and use **Local development sign-in**. That button only exists on localhost, and the endpoint behind it only works when `DEV_LOGIN=1` *and* the request is to localhost — never set `DEV_LOGIN` on the deployed Worker.

On Windows, if `wrangler` fails with `SQLITE_CANTOPEN`, the project path is too long: add `--persist-to C:\rp-data` to both commands.

## How things work

- **Time** is credited per heartbeat: each minute the game reports who is present, and the API adds the gap since the previous report (max 180 s; longer gaps start a new session). Days are **UTC**; weeks start **Monday**.
- **Idle** is detected server-side: a player who has not moved or chatted for 120 s is idle. Requirements can include or exclude idle time.
- **Requirement checks** run hourly via a Cron Trigger. At the configured UTC hour the daily check covers yesterday; on Mondays the weekly check covers last week. Each period is only checked once automatically. Before checking, the roster is re-synced from Roblox so members who never joined are still counted.
- **Ranking** never assigns rank 255, never changes the group owner, and never goes above the group's "highest rank this system may assign".
- **Secrets**: Open Cloud keys are AES-GCM encrypted in D1; API keys and session tokens are stored only as SHA-256 hashes; webhook URLs must be real Discord webhook URLs.

## Layout

```
worker/
  schema.sql          D1 schema (safe to re-run)
  wrangler.toml       config, owner identities, cron
  src/index.js        router and all routes
  src/auth.js         OAuth, whitelist, API keys, account linking
  src/activity.js     heartbeats, stats, requirements, time off, cron
  src/roblox.js       Open Cloud: roles, ranking, member sync
  src/apps.js         applications and submissions
  src/util.js         crypto, dates, webhooks, audit log
index.html            animated feature tour + sign-in (intro.css, intro.js, assets/screens/)
app.html              dashboard (app.js, views-*.js, core.js, styles.css)
apply.html            public application form
verify.html           Discord → Roblox linking
docs.html             API reference
config.js             API URL
rbxlx.js              place-file generator
roblox/               Luau sources (tracker module, app center, verification game)
```

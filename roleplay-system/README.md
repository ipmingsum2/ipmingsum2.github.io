# Roleplay System

A whitelist-only management system for Roblox roleplay groups: activity tracking, requirements, time off, ranking, logs, application centers, account linking and a public API.

- **API** — one Cloudflare Worker + a D1 database (`worker/`)
- **Dashboard** — static HTML/JS, no build step, hosted on GitHub Pages (this folder)
- **Roblox** — a tracker ModuleScript plus generated place files (`roblox/`)

**Live:** tour <https://ipmingsum2.github.io/roleplay-system/> · dashboard <https://ipmingsum2.github.io/roleplay-system/app.html> · API `https://rp-system.ipmingsum5.workers.dev` · [API docs](https://ipmingsum2.github.io/roleplay-system/docs.html)

## What it does

| Area | Details |
|---|---|
| Activity | Total hours played per member, filter by today / this week / last week / 30 days / all time / custom dates, daily or weekly bar graph, a weekday × hour heatmap of when members play (in each viewer's time zone), idle time, sessions, chat messages, who is in game now, manual adjustments |
| Requirements | Daily and weekly minimums, per-rank overrides, hourly scheduler, Discord webhook when members miss them (custom header + per-member line, role mention, ping linked members), manual "run now" |
| Time off | Requests (dashboard or API), approve/deny, approved time off excuses members from requirements |
| Ranking | Promote / demote / set rank through Roblox Open Cloud, with a maximum assignable rank |
| Groups | Any number of groups, each with its own tracked ranks, Open Cloud key, webhooks and settings |
| Logging | Every action is logged (promotions, demotions, missed requirements, sign-ins, settings, applications…), searchable, optionally mirrored to a Discord channel |
| Applications | Form builder (11 question types incl. date and time, required flags, an “Other” option with a typed answer on multiple choice and checkboxes, shuffled option order, scale end labels, Google-Forms-style response validation — number, text, length, regular expression and selection-count rules with custom error text — duplicate question, optional auto-grading), web form + in-game application center, review with optional auto-rank |
| Accounts | Sign in with Google or Discord, link one to the other, link Roblox through a verification game |
| Access | Whitelist-only. The owner manages the whitelist and per-user permissions. Someone who signs in without being whitelisted gets an access request form (questions set by the owner in the Owner Menu); the owner approves — choosing their permissions — or denies with a note, and can be pinged in Discord with a Review button. Denied people can ask again after 24 hours |
| Logbook | Warnings, strikes, suspensions, demotions, promotions, commendations and terminations with reason and evidence link; warnings expire, entries are revoked (never deleted); warning ticker per member; promotions/demotions can change the rank too |
| Sessions | Schedule shifts/trainings/events with Discord announcements and a reminder 10 minutes to 2 hours before they start (optional role ping); staff claim them as host or co-host; registers record who attended; optional weekly session target in requirements |
| Staff of the week | Optional weekly Discord post on a chosen day and hour: top 3/5/10 members by hours and by sessions over the last 7 days, with a “post now” button |
| Quick search | <kbd>Ctrl</kbd>+<kbd>K</kbd> (or <kbd>/</kbd>) anywhere in the dashboard jumps to a page, group or member |
| Promotions | Nominate members for promotion, upvote with a required justification, filter by rank, sort by votes or trending, recommender insights; rankers promote straight from a recommendation |
| Knowledgebase & news | Handbooks, guides and policies by category, each readable by everyone or one permission; group news with pinning and optional Discord announcement |
| Blacklist | Ban players with a reason, optional evidence link and expiry; the ActivityTracker module kicks them on join (and within a minute if they're added mid-game); blacklisted players can't apply; entries are removed, never deleted; API lookup |
| Auto-promotion | One rule per rank: hours and/or sessions over the last N days (or all time), optionally no active warnings. Runs daily at a chosen hour or on demand; either promotes through Open Cloud or creates recommendations to approve; progress bars for everyone in each rank; Discord summary |
| Exports | CSV download of activity (for the selected range and search), logs (current filters, up to 5,000 rows) and the blacklist |
| Extras | This-week leaderboard (minutes and sessions), member notes, application notifications in Discord with every answer and a Decide button, public API with scoped keys, API docs page, light/dark theme with a soft fade |

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
3. **Groups → Roblox setup** — download the tracker module and the application center for that group.
4. **Owner Menu → Verification game** — download the verification game once for the whole system, publish it, and paste its Roblox link so players get a **Join to Verify** button.
5. **Access** — whitelist your staff and choose their permissions.

### 5. Roblox

**Roblox relay.** Roblox's `HttpService` refuses `*.workers.dev` addresses, so games call a small Cloudflare Pages project instead: `roblox-proxy/` (live at `https://rp-roblox.pages.dev`). It forwards the public API (`/v1/*`, `/public/*`) to the Worker over a service binding — no extra public hop — and serves nothing else. It is also the base URL in the API docs, so bots and websites use the same address. Sign-in and the dashboard API stay on the Worker. Deploy or update it with:

```bash
cd roblox-proxy
npx wrangler pages deploy
```

`ROBLOX_API_URL` in `config.js` is what the dashboard puts into every generated script and place file.

Everything Roblox-side talks to the API with a key held in a **server Script**. In every place, turn on **Game Settings → Security → Allow HTTP Requests**.

**Activity tracker** — add `ActivityTracker.lua` as a ModuleScript named `ActivityTracker` in `ServerScriptService`, plus a Script next to it (the dashboard copies this with a fresh key filled in):

```lua
local ActivityTracker = require(script.Parent:WaitForChild("ActivityTracker"))

ActivityTracker.Start({
	ApiUrl = "https://rp-roblox.pages.dev",
	ApiKey = "rpk_...",
})
```

**Application center (.rbxlx)** — generated from the Applications page. The place stores no questions: it fetches the group's open applications from the API whenever a player opens it, so editing a form in the dashboard updates the game without republishing.

**Verification game (.rbxlx)** — one place for the whole system, downloaded from Owner Menu → Verification game with a key that can only verify. Players sign in with Discord on `verify.html` (or use My account), get a code, press **Join to Verify**, type the code, and are kicked with a confirmation once Discord ↔ Roblox is linked.

Generated files embed an API key. Do not share them or make the places copyable; revoke keys on the API page if one leaks.

## Permissions

Everyone on the whitelist can view activity, requirements, time off and sessions. The owner grants the rest per user:

`manage_activity` · `ranking` (also auto-promotion) · `manage_groups` · `manage_applications` · `review_applications` · `view_logs` · `manage_api_keys` · `manage_discipline` (logbook, blacklist) · `manage_content` (news, knowledgebase)

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

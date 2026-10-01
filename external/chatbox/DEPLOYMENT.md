# CHATBOX deployment

The frontend stays on GitHub Pages and uses the existing Supabase project. No database export is required. Deploy the database and Edge Function before publishing the frontend. The legacy frontend stops working at database cutover, so schedule these steps together.

## Preserved data

The first migration copies the existing accounts/profiles, channel IDs/names/order/privacy/locks, channel memberships, lock bypasses, messages, announcements/pins, user bans/mutes, and word filters into `cb_*` tables within the same database. It creates **no default channels or categories**. Localhost preview conversations are browser-only fixtures.

The migration locks the original tables, saves their client grants, revokes legacy client access, validates root and message references, and imports within one transaction. A failure rolls back the transaction. Original tables and rows remain as an archive. `chat-legacy.html` preserves the original frontend source; it is an archive, not a second writable client after cutover. Legacy IP bans/mutes and audit records remain in their original tables; IP-based enforcement is not part of this release.

New message attachments use private storage with channel permission checks and five-minute signed links. Existing attachments remain at their original public URLs. This upgrade does not retroactively make those URLs private.

## Apply the backend

1. Confirm a normal project backup is available and choose a short maintenance window. Keep the existing project; do not create a replacement database.
2. In the project's SQL Editor, run `supabase/migrations/202609280001_chatbox_v2.sql` as one complete script, then `202609280002_chatbox_private_media.sql`. Alternatively, apply both through an authenticated Supabase CLI migration workflow. Stop if either fails. Do not partially execute statements to bypass a validation error.
3. Verify the counts and original IDs using the read-only queries in `supabase/verify-chatbox.sql`. Root must resolve to exactly one account. No original channel/message should be missing.
4. Deploy `supabase/functions/chat-api/index.ts` as **chat-api**. For CLI deployment, use `supabase functions deploy chat-api --project-ref lflkpziiwnoamvtrbcil`. `supabase/config.toml` disables the gateway's legacy JWT check for this function because the function validates user sessions with `auth.getUser()` and separately verifies hashed bot tokens. Do not remove those checks.
5. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Never copy the service key into frontend code or GitHub. Optional secrets are listed below.
6. In Authentication → URL Configuration, allow `https://ipmingsum2.github.io/external/chat.html` and `https://ipmingsum2.github.io/external/chat.html?invited=1` as redirect URLs. Keep other required existing URLs. Set the Supabase Auth Site URL to `https://ipmingsum2.github.io/external/chat.html`. The Edge Function `CHATBOX_SITE_URL` remains the origin `https://ipmingsum2.github.io`.
7. Confirm email was already OFF during inspection, which supports registration with a syntactically valid made-up email. An unreachable inbox cannot receive invitations or recovery emails. Signed-in users change passwords in Settings using their current password, or request a reset link from Settings → Password → Send Reset Link. Recovery links issued through Supabase open the password-reset form; the login page has no forgot-password link.
8. Configure an email sender for reliable email invitations (below), then publish the frontend branch through the repository's existing GitHub Pages deployment.

## Email and optional providers

The existing project currently uses Supabase's built-in mail service. It restricts recipients and has low limits; use [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) for production Supabase invitations/recovery. The new invite function returns delivery failures instead of pretending an invitation was sent.

Alternatively set **both** `RESEND_API_KEY` and `CHATBOX_EMAIL_FROM` as Edge Function secrets after verifying a sending domain in Resend. This sends a registration invitation; the recipient chooses their own account credentials on the separate register page. Without these two secrets, invitations use Supabase Auth's SMTP route. The copyable registration link always works independently of email delivery. Do not enter provider secrets in chat or commit them.

| Optional secret                        | Purpose                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `CHATBOX_SITE_URL`                     | Defaults to `https://ipmingsum2.github.io`; controls invite destination and allowed origin  |
| `CHATBOX_ALLOWED_ORIGINS`              | Additional comma-separated trusted frontend origins, only when needed                       |
| `GIPHY_API_KEY`                        | GIPHY search; without it the app searches GIFs on Wikimedia Commons and retains attribution |
| `RESEND_API_KEY`, `CHATBOX_EMAIL_FROM` | Optional email invitation provider described above                                          |

Link cards use YouTube oEmbed or Microlink with a plain link-card fallback. No arbitrary user URL is fetched directly by the Edge Function and no old iframe embedding is used. External fonts use the supplied Apple font stylesheet's SF font sources with system fallbacks. These external services must be reachable for their enhancements to load.

## Publish and verify

Canonical sources are `external/chat.html`, `external/js/chat.js`, and `external/css/chat.css`. Run `npm run sync` from `external/chatbox` after editing them. It updates `chat-backup`, `chat-beta`, and the existing `chatbeta.html` alias. Shared helpers and font CSS are loaded by all new variants. `register.html` is a separate page using the shared authentication code.

Run `npm ci`, `npm run check`, and `npm test` in `external/chatbox`. The tests use an isolated PGlite database and mocked Auth/Storage/provider boundaries. They do not modify production or prove live email delivery. Preview with a static server at `http://127.0.0.1:4173/external/chat.html?preview=1`; preview is disabled on public hosts.

After deployment, verify with real accounts: login/register, root role assignment/removal, private-channel denial, participant-only DMs, AutoMod send/edit blocks, slowmode countdown, warning acknowledgement, private attachment playback, and an invitation to an explicitly chosen test inbox. Credential entry/password changes should be completed by the account owner. Check Edge Function and database logs for errors.

AutoMod has no fixed number of lists, words, allowed words, or regex patterns. Resource safeguards remain: RPC statement timeouts, message/API rate limits, 20,000-character messages, and 12 MB uploads. Patterns use PostgreSQL regex syntax. Slowmode accepts 0–21,600 seconds, and Manage Channel permission bypasses it. Bots run in a separate Node.js process, not GitHub Pages; see `BOT-API.md`.

## Recovery

If the migration fails before commit, PostgreSQL rolls it back. If frontend deployment fails after database cutover, finish publishing the new frontend rather than sending users back to a writable old client.

For an intentional rollback, stop new `cb_*` writes, reconcile any new messages/accounts/changes, then have the database administrator review and run `supabase/rollback-legacy-access.sql` and restore the old frontend. That script restores the saved legacy grants without deleting either dataset. It does not merge new data backward. Do not leave both schemas accepting writes.

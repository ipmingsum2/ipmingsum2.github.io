# CHATBOX bot API

Create a bot in **Server settings → Apps & Bots → Create Bot**. An Administrator or higher can create bots; only root assigns human staff roles. Copy the token once and keep it in a server environment variable. The token is stored as a hash in Supabase. Rotate or revoke it in the same panel.

Bots run in your own Node.js process or a hosting service. GitHub Pages hosts the chat frontend; it cannot keep a Node.js bot process running.

## Node.js quick start

Download `chatbox-bot.mjs` and `example-bot.mjs` into the same folder. Node.js 20+ is enough; no npm packages are required.

```powershell
$env:CHATBOX_BOT_TOKEN = 'your-token'
$env:CHATBOX_CHANNEL_ID = 'lobby'
node example-bot.mjs
```

```js
import { ChatboxBot } from "./chatbox-bot.mjs";
const bot = new ChatboxBot(); // reads CHATBOX_BOT_TOKEN
console.log(await bot.channels());
await bot.send("lobby", "Hello from my bot!");
```

## HTTP

Base URL: `https://lflkpziiwnoamvtrbcil.supabase.co/functions/v1/chat-api`

Use `Authorization: Bot YOUR_TOKEN`. JSON requests use `Content-Type: application/json`.

| Method | Path                         | Body / query                                                                   |
| ------ | ---------------------------- | ------------------------------------------------------------------------------ |
| GET    | `/v1/me`                     | Bot profile                                                                    |
| GET    | `/v1/channels`               | Channels the bot can view                                                      |
| GET    | `/v1/channels/{id}/messages` | `?after=ISO_TIMESTAMP&after_id=MESSAGE_ID`; at most 100 messages, oldest first |
| POST   | `/v1/channels/{id}/messages` | `{ "text": "Hello", "reply_to": "optional-message-id" }`                       |
| PATCH  | `/v1/messages/{id}`          | `{ "text": "Updated" }`; only the bot’s own messages                           |
| DELETE | `/v1/messages/{id}`          | Soft deletes the bot’s own message                                             |

Success returns JSON (a profile, a list, or a message). Errors return `{ "error": "description" }`. `401` means invalid/revoked token; `403` means forbidden; `429` means slow down. AutoMod responds with `422` and `{ "blocked": true, "message": "custom block message", "rule": "rule name" }`.

There are 60 API requests and 30 message mutations per minute per bot. Bots cannot grant roles, moderate people, change channel permissions, or bypass AutoMod. They receive no access to human DMs. For a private channel, add a member override for the bot in Channel settings and allow **View channel** and **Send messages**.

## Receiving messages

The example uses polling. `bot.listen()` checks one channel every three seconds using a timestamp-and-ID cursor, including when many messages share a timestamp. Handle your own bot’s messages explicitly to avoid reply loops. Save both the last message's `created_at` and `id` durably; pass them back as `after` and `afterId` for restart recovery. Handlers should be idempotent. Polling covers new messages; edits and deletes require refreshing previously loaded messages.

Slowmode also applies to bots unless they have Manage channel permission. A cooldown returns HTTP `429` with `slowmode: true` and `retry_after` seconds. The SDK throws an error with `status` and `retryAfter`; wait before retrying the send. A `30s` indicator appears beside the send button for people using the chat UI.

Do not log bot tokens or paste them into the browser, HTML, or a GitHub repository.

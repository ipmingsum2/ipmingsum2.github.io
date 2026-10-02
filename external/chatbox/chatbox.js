/** CHATBOX Node.js SDK. Node 20.3+, ES modules. Never put bot tokens in browser code. */
import { EventEmitter } from "node:events";
export const Events = Object.freeze({
  ClientReady: "ready",
  MessageCreate: "messageCreate",
  Error: "error",
});
export const Colors = Object.freeze({
  Blurple: 0x5865f2,
  Green: 0x57f287,
  Red: 0xed4245,
  Gold: 0xfee75c,
});
export class EmbedBuilder {
  constructor(data = {}) {
    this.data = structuredClone(data);
  }
  setTitle(value) {
    this.data.title = String(value);
    return this;
  }
  setDescription(value) {
    this.data.description = String(value);
    return this;
  }
  setURL(value) {
    this.data.url = String(value);
    return this;
  }
  setColor(value) {
    const n =
      typeof value === "string"
        ? Number.parseInt(value.replace(/^#/, ""), 16)
        : Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 0xffffff)
      throw Error("Color must be a hex color or integer");
    this.data.color = n;
    return this;
  }
  setAuthor({ name, url, iconURL }) {
    this.data.author = { name, url, icon_url: iconURL };
    return this;
  }
  setFooter({ text, iconURL }) {
    this.data.footer = { text, icon_url: iconURL };
    return this;
  }
  setImage(url) {
    this.data.image = { url };
    return this;
  }
  setThumbnail(url) {
    this.data.thumbnail = { url };
    return this;
  }
  setTimestamp(value = new Date()) {
    this.data.timestamp = new Date(value).toISOString();
    return this;
  }
  addFields(...fields) {
    this.data.fields = [...(this.data.fields || []), ...fields.flat()];
    return this;
  }
  setFields(...fields) {
    this.data.fields = fields.flat();
    return this;
  }
  toJSON() {
    return structuredClone(this.data);
  }
}
export class ChatboxAPIError extends Error {
  constructor(data, status) {
    super(data.message || data.error || "CHATBOX request failed");
    this.name = "ChatboxAPIError";
    this.status = status;
    this.blocked = !!data.blocked;
    this.retryAfter = data.retry_after;
  }
}
const payload = (value) =>
  typeof value === "string"
    ? { text: value }
    : {
        ...(Object.hasOwn(value, "content") ? { text: value.content } : {}),
        ...(Object.hasOwn(value, "embeds")
          ? { embeds: value.embeds.map((e) => e.toJSON?.() || e) }
          : {}),
        ...(value.replyTo ? { reply_to: value.replyTo } : {}),
      };
class User {
  constructor(client, data) {
    Object.assign(this, data);
    this.client = client;
    this.bot = !!data.is_bot;
    this.displayName = data.nickname || data.display_name || data.username;
  }
  async createDM() {
    const data = await this.client.request("/v1/dms", {
      method: "POST",
      body: { user_id: this.id },
    });
    return new Channel(this.client, { ...data, kind: "dm" });
  }
  async send(value) {
    return (await this.createDM()).send(value);
  }
}
class Channel {
  constructor(client, data) {
    Object.assign(this, data);
    this.client = client;
    this.messages = {
      fetch: async ({ after, afterId } = {}) =>
        (
          await client.request(
            `/v1/channels/${encodeURIComponent(this.id)}/messages?` +
              new URLSearchParams({
                ...(after ? { after } : {}),
                ...(afterId ? { after_id: afterId } : {}),
              }),
          )
        ).map((m) => new Message(client, m)),
    };
  }
  async send(value) {
    return new Message(
      this.client,
      await this.client.request(
        `/v1/channels/${encodeURIComponent(this.id)}/messages`,
        { method: "POST", body: payload(value) },
      ),
    );
  }
  isDMBased() {
    return this.kind === "dm";
  }
}
class Message {
  constructor(client, data) {
    Object.assign(this, data);
    this.client = client;
    this.content = data.text || "";
    this.channelId = data.room;
    this.author = new User(client, data.author || { id: data.user_id });
    this.channel =
      client.channels.cache.get(data.room) ||
      new Channel(client, {
        id: data.room,
        kind: data.room?.startsWith("dm-") ? "dm" : undefined,
      });
    this.createdTimestamp = new Date(data.created_at).getTime();
  }
  reply(value) {
    const data = typeof value === "string" ? { content: value } : value;
    return this.channel.send({ ...data, replyTo: this.id });
  }
  async edit(value) {
    return new Message(
      this.client,
      await this.client.request("/v1/messages/" + encodeURIComponent(this.id), {
        method: "PATCH",
        body: payload(value),
      }),
    );
  }
  delete() {
    return this.client.request("/v1/messages/" + encodeURIComponent(this.id), {
      method: "DELETE",
    });
  }
}
export class Client extends EventEmitter {
  constructor({
    baseURL = "https://lflkpziiwnoamvtrbcil.supabase.co/functions/v1/chat-api",
    pollInterval = 3000,
    cursor,
  } = {}) {
    super();
    this.baseURL = baseURL.replace(/\/$/, "");
    this.pollInterval = Math.max(1500, pollInterval);
    this.cursor = cursor;
    this.user = null;
    this.controller = null;
    this.channels = {
      cache: new Map(),
      fetch: async (id) => {
        const rows = await this.request("/v1/channels");
        this.channels.cache = new Map(
          rows.map((r) => [r.id, new Channel(this, r)]),
        );
        if (id && !this.channels.cache.has(id))
          throw Error("Channel unavailable");
        return id ? this.channels.cache.get(id) : this.channels.cache;
      },
    };
    this.users = {
      fetch: async (id) => {
        const p = await this.request("/v1/users/" + encodeURIComponent(id));
        if (!p) throw Error("User unavailable");
        return new User(this, p);
      },
    };
    const moderate = (id, action, reason, extra = {}) =>
      this.request("/v1/moderation", {
        method: "POST",
        body: { user_id: id, action, reason, ...extra },
      });
    this.moderation = {
      warn: (id, reason, evidence = "") =>
        moderate(id, "warning", reason, { evidence }),
      timeout: (id, seconds, reason) => {
        if (!Number.isFinite(seconds) || seconds <= 0)
          throw Error("Timeout seconds must be positive");
        return moderate(id, "timeout", reason, {
          expires_at: new Date(Date.now() + seconds * 1000).toISOString(),
        });
      },
      ban: (id, reason, { seconds, evidence } = {}) =>
        moderate(id, "ban", reason, {
          expires_at: seconds
            ? new Date(Date.now() + seconds * 1000).toISOString()
            : null,
          evidence,
        }),
      unban: (id, reason) => moderate(id, "unban", reason),
      untimeout: (id, reason) => moderate(id, "untimeout", reason),
    };
    this.automod = {
      save: (rule) =>
        this.request("/v1/automod", { method: "POST", body: rule }),
      delete: (id) =>
        this.request("/v1/automod/" + encodeURIComponent(id), {
          method: "DELETE",
        }),
    };
  }
  async request(path, { method = "GET", body, signal } = {}) {
    if (!this.token) throw Error("Call client.login(token) first");
    const res = await fetch(this.baseURL + path, {
      method,
      headers: {
        Authorization: "Bot " + this.token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) throw new ChatboxAPIError(data, res.status);
    return data;
  }
  async login(token = process.env.CHATBOX_BOT_TOKEN) {
    if (this.controller) throw Error("Client is already running");
    if (!token) throw Error("CHATBOX_BOT_TOKEN is required");
    this.token = token;
    const data = await this.request("/v1/me");
    this.user = new User(this, data);
    await this.channels.fetch();
    this.cursor ||= {
      after: data.server_time || new Date().toISOString(),
      afterId: "",
    };
    this.controller = new AbortController();
    await this._dispatch(Events.ClientReady, this);
    this._task = this._listen(this.controller.signal).catch((error) =>
      this._error(error),
    );
    return this;
  }
  destroy() {
    this.controller?.abort();
    this.controller = null;
  }
  async _dispatch(event, value) {
    for (const handler of this.rawListeners(event))
      await handler.call(this, value);
  }
  _error(error) {
    if (this.listenerCount(Events.Error)) this.emit(Events.Error, error);
    else console.error("CHATBOX:", error.message);
  }
  async _listen(signal) {
    while (!signal.aborted) {
      try {
        const query = new URLSearchParams({
          after: this.cursor.after,
          after_id: this.cursor.afterId || "",
        });
        const rows = await this.request("/v1/events?" + query, { signal });
        for (const row of rows) {
          if (signal.aborted) return;
          try {
            if (!row.deleted && !row.automod_event)
              await this._dispatch(
                Events.MessageCreate,
                new Message(this, row),
              );
          } catch (error) {
            this._error(error);
          }
          this.cursor = { after: row.created_at, afterId: row.id };
        }
        if (rows.length === 100) continue;
      } catch (error) {
        if (signal.aborted) return;
        this._error(error);
        if (error.status === 401 || error.status === 403) return;
        await delay(
          error.status === 429 ? (error.retryAfter || 60) * 1000 : 10000,
          signal,
        );
      }
      await delay(this.pollInterval, signal);
    }
  }
}
export function matchesWords(
  content,
  words,
  { allowedWords = [], patterns = [] } = {},
) {
  let text = String(content);
  for (const word of splitKeywords(allowedWords))
    text = text.replace(keywordRegex(word, "giu"), " ");
  return (
    splitKeywords(words).some((word) => keywordRegex(word, "iu").test(text)) ||
    patterns.some((pattern) => {
      const re =
        pattern instanceof RegExp
          ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""))
          : new RegExp(pattern, "i");
      return re.test(text);
    })
  );
}
export function splitKeywords(words) {
  return [
    ...new Set(
      (Array.isArray(words) ? words : [words])
        .flatMap((s) => String(s).split(/[,\r\n]+/))
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
function keywordRegex(word, flags) {
  const body = [...word]
    .map((c) =>
      c === "*" ? "[^\\s]*" : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  return new RegExp(
    (word.startsWith("*") ? "" : "(^|[^\\p{L}\\p{N}_])") +
      body +
      (word.endsWith("*") ? "" : "($|[^\\p{L}\\p{N}_])"),
    flags,
  );
}
function delay(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

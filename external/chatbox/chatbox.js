/** CHATBOX Node.js SDK. Node 20.3+, ES modules. Never put bot tokens in browser code. */
import { EventEmitter } from "node:events";
export const Events = Object.freeze({
  ClientReady: "ready",
  MessageCreate: "messageCreate",
  InteractionCreate: "interactionCreate",
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
export const ButtonStyle = Object.freeze({
  Primary: 1,
  Secondary: 2,
  Success: 3,
  Danger: 4,
  Link: 5,
});
export const TextInputStyle = Object.freeze({ Short: 1, Paragraph: 2 });
class ComponentBuilder {
  constructor(data = {}) {
    this.data = JSON.parse(JSON.stringify(data));
  }
  setCustomId(value) {
    this.data.custom_id = String(value);
    return this;
  }
  setLabel(value) {
    this.data.label = String(value);
    return this;
  }
  setStyle(value) {
    this.data.style = value;
    return this;
  }
  toJSON() {
    return JSON.parse(JSON.stringify(this.data));
  }
}
export class ButtonBuilder extends ComponentBuilder {
  constructor(data = {}) {
    super({ type: 2, style: 1, ...data });
  }
  setURL(value) {
    this.data.url = String(value);
    return this;
  }
  setDisabled(value = true) {
    this.data.disabled = !!value;
    return this;
  }
}
export class TextInputBuilder extends ComponentBuilder {
  constructor(data = {}) {
    super({ type: 4, style: 1, required: true, ...data });
  }
  setPlaceholder(value) {
    this.data.placeholder = String(value);
    return this;
  }
  setRequired(value = true) {
    this.data.required = !!value;
    return this;
  }
  setMaxLength(value) {
    this.data.max_length = value;
    return this;
  }
}
export class ActionRowBuilder extends ComponentBuilder {
  constructor(data = {}) {
    super({ type: 1, components: [], ...data });
  }
  addComponents(...items) {
    this.data.components.push(...items.flat().map((x) => x.toJSON?.() || x));
    return this;
  }
}
export class ModalBuilder extends ComponentBuilder {
  constructor(data = {}) {
    super({ fields: [], ...data });
  }
  setTitle(value) {
    this.data.title = String(value);
    return this;
  }
  addComponents(...rows) {
    for (const item of rows.flat()) {
      const row = item.toJSON?.() || item;
      this.data.fields.push(...(row.components || [row]));
    }
    return this;
  }
}
export class SlashCommandBuilder extends ComponentBuilder {
  setName(value) {
    this.data.name = String(value);
    return this;
  }
  setDescription(value) {
    this.data.description = String(value);
    return this;
  }
}
export class Interaction {
  constructor(client, data) {
    Object.assign(this, data);
    this.client = client;
    this.customId = data.custom_id;
    this.commandName = data.kind === "command" ? data.custom_id : null;
    this.channelId = data.channel_id;
    this.user = new User(client, data.user || { id: data.user_id });
    this.channel = new Channel(client, { id: data.channel_id });
    this.fields = {
      getTextInputValue: (id) => String(data.fields?.[id] || ""),
    };
    this.options = {
      getString: (name) =>
        name === "input" ? String(data.fields?.input || "") : null,
    };
  }
  isButton() {
    return this.kind === "button";
  }
  isModalSubmit() {
    return this.kind === "modal";
  }
  isChatInputCommand() {
    return this.kind === "command";
  }
  reply(value) {
    return this.client.action("interaction_reply", {
      id: this.id,
      ...payload(value),
      ephemeral: !!value?.ephemeral,
    });
  }
  showModal(modal) {
    return this.client.action("interaction_reply", {
      id: this.id,
      modal: modal.toJSON?.() || modal,
    });
  }
}
function installExtendedAPI(client) {
  const call = (op, p = {}) => client.action(op, p);
  client.commands = {
    set: (commands) =>
      call("commands_set", {
        commands: commands.map((x) => x.toJSON?.() || x),
      }),
    fetch: () => call("commands"),
  };
  client.application = { commands: client.commands };
  client.members = {
    fetch: () => call("members"),
    setNickname: (user_id, nickname) => call("nickname", { user_id, nickname }),
    standing: (user_id) => call("standing", { user_id }),
  };
  client.roles = { fetch: () => call("roles") };
  client.profile = { edit: (p) => call("profile", p) };
  client.categories = {
    fetch: () => call("categories"),
    create: (p) => call("category", p),
    delete: (id) => call("delete_category", { id }),
  };
  Object.assign(client.channels, {
    create: (p) => call("channel", p),
    edit: (channel_id, p) => call("channel", { ...p, channel_id }),
    archive: (channel_id) => call("archive_channel", { channel_id }),
    setPermission: (p) => call("permission", p),
  });
  client.threads = {
    fetch: (channel_id) => call("threads", { channel_id }),
    create: (p) => call("create_thread", p),
    archive: (p) => call("archive_thread", p),
  };
  client.polls = {
    create: (p) => call("create_poll", p),
    fetch: (channel_id, ids) => call("poll_data", { channel_id, ids }),
    vote: (p) => call("vote", p),
    close: (id) => call("close_poll", { id }),
  };
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
        ...(value.components
          ? { components: value.components.map((x) => x.toJSON?.() || x) }
          : {}),
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
    this.readCache = new Map();
    this.channels = {
      cache: new Map(),
      fetch: async (id) => {
        const rows = await this.cachedRead("/v1/channels");
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
        const p = await this.cachedRead("/v1/users/" + encodeURIComponent(id));
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
    installExtendedAPI(this);
  }
  action(action, payload = {}) {
    return this.request("/v1/actions", {
      method: "POST",
      body: { action, payload },
    });
  }
  async cachedRead(path) {
    const hit = this.readCache.get(path);
    if (hit && hit.until > Date.now()) return hit.promise;
    const entry = { until: Date.now() + 60000 };
    entry.promise = this.request(path).catch((error) => {
      if (this.readCache.get(path) === entry) this.readCache.delete(path);
      throw error;
    });
    this.readCache.set(path, entry);
    while (this.readCache.size > 100)
      this.readCache.delete(this.readCache.keys().next().value);
    return entry.promise;
  }
  async request(path, { method = "GET", body, signal } = {}) {
    if (!this.token) throw Error("Call client.login(token) first");
    if (method !== "GET") this.readCache.clear();
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
  async login(token = process.env.CHATBOX_BOT_TOKEN, { poll = true } = {}) {
    if (this.controller) throw Error("Client is already running");
    if (!token) throw Error("CHATBOX_BOT_TOKEN is required");
    this.readCache.clear();
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
    if (poll)
      this._task = this._listen(this.controller.signal).catch((error) =>
        this._error(error),
      );
    return this;
  }
  destroy() {
    this.controller?.abort();
    this.controller = null;
    this.readCache.clear();
  }
  async _dispatch(event, value) {
    for (const handler of this.rawListeners(event))
      await handler.call(this, value);
  }
  _error(error) {
    if (this.listenerCount(Events.Error)) this.emit(Events.Error, error);
    else console.error("CHATBOX:", error.message);
  }
  async pollOnce({
    beforeDispatch,
    maxEvents = 100,
    signal = this.controller?.signal,
  } = {}) {
    if (!this.cursor || !this.user) throw Error("Call client.login first");
    if (this.listenerCount(Events.InteractionCreate)) {
      const interactions = await this.action("interactions");
      for (const item of interactions) {
        if (signal?.aborted) break;
        try {
          await this._dispatch(
            Events.InteractionCreate,
            new Interaction(this, item),
          );
        } catch (error) {
          this._error(error);
        }
      }
    }
    const query = new URLSearchParams({
      after: this.cursor.after,
      after_id: this.cursor.afterId || "",
    });
    const rows = await this.request("/v1/events?" + query, { signal });
    let count = 0;
    for (const row of rows.slice(0, Math.max(1, Math.min(100, maxEvents)))) {
      if (signal?.aborted) break;
      const next = { after: row.created_at, afterId: row.id };
      if (beforeDispatch) await beforeDispatch(next);
      this.cursor = next;
      count++;
      try {
        if (!row.deleted && !row.automod_event)
          await this._dispatch(Events.MessageCreate, new Message(this, row));
      } catch (error) {
        this._error(error);
      }
    }
    return count;
  }
  async _listen(signal) {
    while (!signal.aborted) {
      try {
        const count = await this.pollOnce({ signal });
        if (count === 100) continue;
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

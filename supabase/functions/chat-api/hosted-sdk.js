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
    this.data = JSON.parse(JSON.stringify(data));
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
    return JSON.parse(JSON.stringify(this.data));
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
export const ApplicationCommandOptionType = Object.freeze({
  Subcommand: 1,
  SubcommandGroup: 2,
  String: 3,
  Integer: 4,
  Boolean: 5,
  User: 6,
  Channel: 7,
  Role: 8,
  Mentionable: 9,
  Number: 10,
  Attachment: 11,
});
export const ChannelType = Object.freeze({
  GuildText: 0,
  DM: 1,
  GuildCategory: 4,
  GuildAnnouncement: 5,
  PublicThread: 11,
});
export class SlashCommandOptionBuilder extends ComponentBuilder {
  setName(value) {
    this.data.name = String(value);
    return this;
  }
  setDescription(value) {
    this.data.description = String(value);
    return this;
  }
  setRequired(value = true) {
    this.data.required = !!value;
    return this;
  }
  setRequiredRole(value) {
    this.data.required_role = value;
    return this;
  }
  setAutocomplete(value = true) {
    this.data.autocomplete = !!value;
    return this;
  }
  setMinValue(value) {
    this.data.min_value = value;
    return this;
  }
  setMaxValue(value) {
    this.data.max_value = value;
    return this;
  }
  setMinLength(value) {
    this.data.min_length = value;
    return this;
  }
  setMaxLength(value) {
    this.data.max_length = value;
    return this;
  }
  setFormat(value) {
    this.data.format = value;
    return this;
  }
  addChoices(...values) {
    this.data.choices = [...(this.data.choices || []), ...values.flat()];
    return this;
  }
  setChoices(...values) {
    this.data.choices = values.flat();
    return this;
  }
  addChannelTypes(...values) {
    this.data.channel_types = [
      ...(this.data.channel_types || []),
      ...values.flat(),
    ];
    return this;
  }
  setFileTypes(...values) {
    this.data.file_types = values.flat();
    return this;
  }
  _option(type, value, format) {
    const option = new SlashCommandOptionBuilder({
      type,
      ...(type < 3 ? { options: [] } : {}),
      ...(format ? { format } : {}),
    });
    const result =
      typeof value === "function" ? value(option) || option : value;
    (this.data.options ||= []).push(result.toJSON?.() || result);
    return this;
  }
  addStringOption(value) {
    return this._option(3, value);
  }
  addIntegerOption(value) {
    return this._option(4, value);
  }
  addBooleanOption(value) {
    return this._option(5, value);
  }
  addUserOption(value) {
    return this._option(6, value);
  }
  addChannelOption(value) {
    return this._option(7, value);
  }
  addRoleOption(value) {
    return this._option(8, value);
  }
  addMentionableOption(value) {
    return this._option(9, value);
  }
  addNumberOption(value) {
    return this._option(10, value);
  }
  addAttachmentOption(value) {
    return this._option(11, value);
  }
  addSubcommand(value) {
    return this._option(1, value);
  }
  addSubcommandGroup(value) {
    return this._option(2, value);
  }
  addDurationOption(value) {
    return this._option(3, value, "duration");
  }
  addDateOption(value) {
    return this._option(3, value, "date");
  }
  addColorOption(value) {
    return this._option(3, value, "color");
  }
  addMultilineOption(value) {
    return this._option(3, value, "multiline");
  }
  addURLOption(value) {
    return this._option(3, value, "url");
  }
}
export class SlashCommandBuilder extends SlashCommandOptionBuilder {}
export class Collection extends Map {
  first() {
    return this.values().next().value;
  }
  find(fn) {
    for (const [key, value] of this) if (fn(value, key, this)) return value;
  }
  filter(fn) {
    return new Collection(
      [...this].filter(([key, value]) => fn(value, key, this)),
    );
  }
  map(fn) {
    return [...this].map(([key, value]) => fn(value, key, this));
  }
}
export class CommandInteractionOptionResolver {
  constructor(client, fields = {}) {
    this.client = client;
    this.data = fields.options || [];
    this.resolved = fields.resolved || {};
    this.focused = fields.focused;
    this.legacyInput = fields.input;
    let leaf = this.data;
    this.group = null;
    this.subcommand = null;
    if (leaf[0]?.type === 2) {
      this.group = leaf[0].name;
      leaf = leaf[0].options || [];
    }
    if (leaf[0]?.type === 1) {
      this.subcommand = leaf[0].name;
      leaf = leaf[0].options || [];
    }
    this.leaf = leaf;
  }
  get(name, required = false) {
    const v = this.leaf.find((x) => x.name === name);
    if (!v && required) throw Error(`Missing required option: ${name}`);
    return v || null;
  }
  _get(name, types, required) {
    const v = this.get(name, required);
    if (!v) return null;
    if (!types.includes(v.type)) throw Error(`Wrong option type: ${name}`);
    return v.value;
  }
  getString(name, required = false) {
    if (name === "input" && !this.data.length && this.legacyInput !== undefined)
      return String(this.legacyInput);
    return this._get(name, [3], required);
  }
  getInteger(name, required = false) {
    return this._get(name, [4], required);
  }
  getNumber(name, required = false) {
    return this._get(name, [10], required);
  }
  getBoolean(name, required = false) {
    return this._get(name, [5], required);
  }
  getUser(name, required = false) {
    const id = this._get(name, [6], required);
    return id
      ? new User(this.client, this.resolved.users?.[id] || { id })
      : null;
  }
  getMember(name, required = false) {
    return this.getUser(name, required);
  }
  getChannel(name, required = false) {
    const id = this._get(name, [7], required);
    return id
      ? new Channel(this.client, this.resolved.channels?.[id] || { id })
      : null;
  }
  getRole(name, required = false) {
    const id = this._get(name, [8], required);
    return id ? this.resolved.roles?.[id] || { id, name: id } : null;
  }
  getMentionable(name, required = false) {
    const id = this._get(name, [9], required);
    return !id
      ? null
      : this.resolved.roles?.[id] ||
          new User(this.client, this.resolved.users?.[id] || { id });
  }
  getAttachment(name, required = false) {
    const id = this._get(name, [11], required);
    return id
      ? {
          ...this.resolved.attachments?.[id],
          url: id,
          getURL: () => this.client.attachments.getURL(id),
        }
      : null;
  }
  getSubcommand(required = true) {
    if (!this.subcommand && required) throw Error("No subcommand selected");
    return this.subcommand;
  }
  getSubcommandGroup(required = false) {
    if (!this.group && required) throw Error("No subcommand group selected");
    return this.group;
  }
  getFocused(full = false) {
    if (!this.focused) throw Error("Not an autocomplete interaction");
    return full ? { ...this.focused } : this.focused.value;
  }
  getDuration(name, required = false) {
    const v = this.getString(name, required);
    if (v === null) return null;
    const m = /^(\d+(?:\.\d+)?)([smhdw])$/.exec(v);
    if (!m) throw Error("Invalid duration");
    return Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[m[2]];
  }
  getDate(name, required = false) {
    const v = this.getString(name, required);
    return v === null ? null : new Date(v + "T00:00:00Z");
  }
  getColor(name, required = false) {
    const v = this.getString(name, required);
    return v === null ? null : Number.parseInt(v.slice(1), 16);
  }
}
function installChannelAPI(client, channel) {
  const call = (op, p = {}) =>
    client.action(op, { channel_id: channel.id, ...p });
  channel.messages.fetch = async (options = {}) => {
    if (typeof options === "string")
      return new Message(client, await call("message", { id: options }));
    const { afterId, ...rest } = options;
    return (
      await call("messages", {
        ...rest,
        ...(afterId ? { after_id: afterId } : {}),
      })
    ).map((m) => new Message(client, m));
  };
  channel.messages.delete = (id) => call("delete_message", { id });
  channel.messages.edit = async (id, value) =>
    new Message(client, await call("edit", { id, ...payload(value) }));
  channel.messages.fetchPinned = async () =>
    (await call("pins")).map((m) => new Message(client, m));
  channel.bulkDelete = async (selection) => {
    let body;
    if (typeof selection === "number") {
      if (!Number.isInteger(selection) || selection < 1 || selection > 100)
        throw Error("Select 1–100 messages");
      body = { count: selection };
    } else {
      const rows =
        selection instanceof Map
          ? [...selection.values()]
          : Array.from(selection || []);
      if (!rows.length || rows.length > 100)
        throw Error("Select 1–100 messages");
      body = {
        ids: [...new Set(rows.map((x) => (typeof x === "string" ? x : x.id)))],
      };
    }
    const result = await call("bulk_delete", body);
    return new Collection(result.ids.map((id) => [id, { id }]));
  };
  channel.edit = async (p) => new Channel(client, await call("channel", p));
  channel.setName = (name) => channel.edit({ name });
  channel.setTopic = (topic) => channel.edit({ topic });
  channel.setRateLimitPerUser = (slowmode_seconds) =>
    channel.edit({ slowmode_seconds });
  channel.archive = () => call("archive_channel");
  channel.permissionOverwrites = {
    fetch: () => call("permissions"),
    edit: (subject, permissions) =>
      Promise.all(
        Object.entries(permissions).map(([permission, value]) =>
          call("permission", { subject, permission, value }),
        ),
      ),
  };
}
function installMessageAPI(client, message) {
  message.pin = () => client.action("pin", { id: message.id });
  message.unpin = () => client.action("unpin", { id: message.id });
  message.react = (emoji) => client.action("react", { id: message.id, emoji });
  message.reactions = {
    fetch: () => client.action("reactions", { id: message.id }),
    remove: (emoji) => client.action("unreact", { id: message.id, emoji }),
    removeAll: () => client.action("clear_reactions", { id: message.id }),
  };
}
export class Interaction {
  constructor(client, data) {
    Object.assign(this, data);
    this.client = client;
    this.customId = data.custom_id;
    this.commandName = ["command", "autocomplete"].includes(data.kind)
      ? data.custom_id
      : null;
    this.channelId = data.channel_id;
    this.user = new User(client, data.user || { id: data.user_id });
    this.channel = new Channel(client, { id: data.channel_id });
    this.fields = {
      getTextInputValue: (id) => String(data.fields?.[id] || ""),
    };
    this.options = new CommandInteractionOptionResolver(client, data.fields);
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
  isAutocomplete() {
    return this.kind === "autocomplete";
  }
  respond(choices) {
    return this.client.action("autocomplete_reply", { id: this.id, choices });
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
    fetch: async (name) => {
      const rows = await call("commands");
      return name ? rows.find((x) => x.name === name) || null : rows;
    },
    create: (command) =>
      call("command_create", { command: command.toJSON?.() || command }),
    edit: (name, command) =>
      call("command_edit", { name, command: command.toJSON?.() || command }),
    delete: (name) => call("command_delete", { name }),
  };
  client.application = {
    commands: client.commands,
    edit: (p) =>
      call("profile", {
        ...p,
        ...(p.description !== undefined ? { bio: p.description } : {}),
      }),
  };
  client.members = {
    fetch: () => call("members"),
    setNickname: (user_id, nickname) => call("nickname", { user_id, nickname }),
    standing: (user_id) => call("standing", { user_id }),
  };
  client.roles = { fetch: () => call("roles") };
  client.profile = { edit: (p) => call("profile", p) };
  client.attachments = {
    getURL: async (url) => (await call("attachment", { url })).url,
  };
  client.messages = {
    fetch: async (id) => new Message(client, await call("message", { id })),
  };
  client.automod.fetch = () => call("automod_rules");
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
  async _edit(fields) {
    if (this.id !== this.client.user?.id)
      throw Error("Only the logged-in bot can change its identity");
    Object.assign(this, await this.client.profile.edit(fields));
    return this;
  }
  setUsername(username) {
    return this._edit({ username });
  }
  setAvatar(avatar_url) {
    return this._edit({ avatar_url: avatar_url || "" });
  }
  setBanner(banner_url) {
    return this._edit({ banner_url: banner_url || "" });
  }
  setDescription(bio) {
    return this._edit({ bio });
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
    installChannelAPI(client, this);
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
    installMessageAPI(client, this);
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

const clients=[];
const rpc=async(action,payload={})=>JSON.parse(await __bridge(action,JSON.stringify(payload)));
export class Client{
 constructor(){this.handlers=new Map();this.user=new User(this,JSON.parse(__eventJSON).bot);this.channels={cache:new Map(),fetch:async id=>{if(!this.channels.cache.size)this.channels.cache=new Map((await rpc('channels')).map(c=>[c.id,new Channel(this,c)]));return id?this.channels.cache.get(id):this.channels.cache;}};this.users={fetch:async id=>new User(this,await rpc('user',{user_id:id}))};const mod=(user_id,action,reason,extra={})=>rpc('moderate',{user_id,action,reason,...extra});this.moderation={warn:(id,reason,evidence='')=>mod(id,'warning',reason,{evidence}),timeout:(id,seconds,reason)=>mod(id,'timeout',reason,{expires_at:new Date(Date.now()+seconds*1000).toISOString()}),untimeout:(id,reason)=>mod(id,'untimeout',reason),ban:(id,reason,{seconds,evidence}={})=>mod(id,'ban',reason,{expires_at:seconds?new Date(Date.now()+seconds*1000).toISOString():null,evidence}),unban:(id,reason)=>mod(id,'unban',reason)};this.automod={save:p=>rpc('automod',p),delete:id=>rpc('delete_rule',{id})};installExtendedAPI(this);}
 action(op,p={}){return rpc(op,p);}
 request(path,{method='GET',body={}}={}){const parts=path.split('/').map(decodeURIComponent);if(path==='/v1/dms')return rpc('dm',body);if(parts[2]==='channels'&&parts[4]==='messages'&&method==='POST')return rpc('send',{...body,channel_id:parts[3]});if(parts[2]==='messages')return rpc(method==='PATCH'?'edit':method==='DELETE'?'delete_message':'message',{...body,id:parts[3]});throw Error('Use the documented CHATBOX API methods');}
 on(event,handler){if(!this.handlers.has(event))this.handlers.set(event,[]);this.handlers.get(event).push(handler);return this;}
 once(event,handler){return this.on(event,handler);}
 async login(){if(clients.includes(this))throw Error('Client is already running');clients.push(this);if(JSON.parse(__eventJSON).startup)for(const handler of this.handlers.get('ready')||[])await handler(this);return this;}
 destroy(){this.handlers.clear();}
}
globalThis.__dispatch=async event=>{if(event.startup)return;for(const client of clients)for(const handler of client.handlers.get(event.interaction?'interactionCreate':'messageCreate')||[])await handler(event.interaction?new Interaction(client,event.interaction):new Message(client,event.message));};
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

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

const clients=[];
const rpc=async(action,payload={})=>JSON.parse(await __bridge(action,JSON.stringify(payload)));
const payload=value=>typeof value==='string'?{text:value}:{...(Object.hasOwn(value,'content')?{text:value.content}:{}),...(value.embeds?{embeds:value.embeds.map(e=>e.toJSON?.()||e)}:{}),...(value.replyTo?{reply_to:value.replyTo}:{}),...(value.components?{components:value.components.map(x=>x.toJSON?.()||x)}:{})};
class User{constructor(client,data){Object.assign(this,data);this.client=client;this.bot=!!data.is_bot;this.displayName=data.nickname||data.display_name||data.username;}async createDM(){return new Channel(this.client,{...await rpc('dm',{user_id:this.id}),kind:'dm'});}async send(value){return(await this.createDM()).send(value);}}
class Channel{constructor(client,data){Object.assign(this,data);this.client=client;this.messages={fetch:async({after,afterId}={})=>(await rpc('messages',{channel_id:this.id,after,after_id:afterId})).map(m=>new Message(client,m))};}async send(value){return new Message(this.client,await rpc('send',{channel_id:this.id,...payload(value)}));}isDMBased(){return this.kind==='dm'||this.id.startsWith('dm-');}}
class Message{constructor(client,data){Object.assign(this,data);this.client=client;this.content=data.text||'';this.channelId=data.room;this.author=new User(client,data.author||{id:data.user_id});this.channel=new Channel(client,{id:data.room});this.createdTimestamp=Date.parse(data.created_at);}reply(value){return this.channel.send({...typeof value==='string'?{content:value}:value,replyTo:this.id});}async edit(value){return new Message(this.client,await rpc('edit',{id:this.id,...payload(value)}));}delete(){return rpc('delete_message',{id:this.id});}}
export class Client{
 constructor(){this.handlers=new Map();this.user=new User(this,JSON.parse(__eventJSON).bot);this.channels={cache:new Map(),fetch:async id=>{if(!this.channels.cache.size)this.channels.cache=new Map((await rpc('channels')).map(c=>[c.id,new Channel(this,c)]));return id?this.channels.cache.get(id):this.channels.cache;}};this.users={fetch:async id=>new User(this,await rpc('user',{user_id:id}))};const mod=(user_id,action,reason,extra={})=>rpc('moderate',{user_id,action,reason,...extra});this.moderation={warn:(id,reason,evidence='')=>mod(id,'warning',reason,{evidence}),timeout:(id,seconds,reason)=>mod(id,'timeout',reason,{expires_at:new Date(Date.now()+seconds*1000).toISOString()}),untimeout:(id,reason)=>mod(id,'untimeout',reason),ban:(id,reason,{seconds,evidence}={})=>mod(id,'ban',reason,{expires_at:seconds?new Date(Date.now()+seconds*1000).toISOString():null,evidence}),unban:(id,reason)=>mod(id,'unban',reason)};this.automod={save:p=>rpc('automod',p),delete:id=>rpc('delete_rule',{id})};installExtendedAPI(this);}
 action(op,p={}){return rpc(op,p);}
 on(event,handler){if(!this.handlers.has(event))this.handlers.set(event,[]);this.handlers.get(event).push(handler);return this;}
 once(event,handler){return this.on(event,handler);}
 async login(){clients.push(this);return this;}
 destroy(){this.handlers.clear();}
}
globalThis.__dispatch=async event=>{for(const client of clients)for(const handler of client.handlers.get(event.interaction?'interactionCreate':'messageCreate')||[])await handler(event.interaction?new Interaction(client,event.interaction):new Message(client,event.message));};
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

// Uploaded JavaScript runs inside QuickJS/WASM, never in the Edge host context.
export async function runHosted(
  QuickJS,
  source,
  sdk,
  event,
  invoke,
  options = {},
) {
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(8 * 1024 * 1024);
  runtime.setMaxStackSize(256 * 1024);
  const vm = runtime.newContext(),
    logs = [],
    pending = new Set(),
    deferreds = [];
  let alive = true,
    calls = 0,
    cpu = options.cpuMs || 150,
    sliceEnd = Infinity;
  const deadline = Date.now() + (options.timeoutMs || 8000);
  runtime.setInterruptHandler(
    () => Date.now() > sliceEnd || Date.now() > deadline,
  );
  runtime.setModuleLoader((name) => {
    if (["chatbox.js", "./chatbox.js"].includes(name)) return sdk;
    throw Error("Only chatbox.js can be imported in hosted bots");
  });
  function execute(fn) {
    const start = Date.now();
    sliceEnd = start + cpu;
    try {
      return fn();
    } finally {
      cpu -= Date.now() - start;
      if (cpu < 0) cpu = 0;
    }
  }
  function unwrap(result) {
    if (result.error) {
      const error = vm.dump(result.error);
      result.error.dispose();
      throw Error(error.message || String(error));
    }
    return result.value;
  }
  function evaluate(code, name = "runtime.js", type = "global") {
    const h = unwrap(execute(() => vm.evalCode(code, name, { type })));
    h.dispose();
  }
  function read(name) {
    const h = vm.getProp(vm.global, name);
    try {
      return vm.dump(h);
    } finally {
      h.dispose();
    }
  }
  const bridge = vm.newFunction("__bridge", (actionHandle, payloadHandle) => {
    if (++calls > 8) throw Error("Maximum 8 API calls per event");
    const action = vm.getString(actionHandle),
      payload = JSON.parse(vm.getString(payloadHandle));
    const deferred = vm.newPromise();
    deferreds.push(deferred);
    const work = Promise.resolve()
      .then(() => invoke(action, payload))
      .then(
        (data) => {
          if (!alive) return;
          const h = vm.newString(JSON.stringify(data ?? null));
          deferred.resolve(h);
          h.dispose();
        },
        (error) => {
          if (!alive) return;
          const h = vm.newError(String(error.message || error));
          deferred.reject(h);
          h.dispose();
        },
      )
      .finally(() => pending.delete(work));
    pending.add(work);
    return deferred.handle.dup();
  });
  vm.setProp(vm.global, "__bridge", bridge);
  bridge.dispose();
  const logger = vm.newFunction("__log", (h) => {
    if (logs.length < 20) logs.push(vm.getString(h).slice(0, 500));
  });
  vm.setProp(vm.global, "__log", logger);
  logger.dispose();
  const data = vm.newString(JSON.stringify(event));
  vm.setProp(vm.global, "__eventJSON", data);
  data.dispose();
  async function drain(flag) {
    while (!read(flag)) {
      if (Date.now() > deadline)
        throw Error("Hosted bot exceeded its execution deadline");
      const result = execute(() => runtime.executePendingJobs(100));
      if (result.error) {
        const error = vm.dump(result.error);
        result.error.dispose();
        throw Error(error.message || "Script error");
      }
      if (!read(flag))
        await Promise.race([...pending, new Promise((r) => setTimeout(r, 5))]);
    }
    if (read("__failure")) throw Error(read("__failure"));
  }
  try {
    evaluate(
      'globalThis.console={log:(...a)=>__log(a.map(String).join(" ")),warn:(...a)=>__log(a.map(String).join(" ")),error:(...a)=>__log(a.map(String).join(" "))};globalThis.__ready=false;globalThis.__done=false;',
    );
    evaluate(source + "\nglobalThis.__ready=true;", "bot.js", "module");
    await drain("__ready");
    evaluate(
      "globalThis.__dispatch(JSON.parse(__eventJSON)).then(()=>globalThis.__done=true,e=>{globalThis.__failure=String(e.message||e);globalThis.__done=true;});",
    );
    await drain("__done");
    return { logs, calls };
  } finally {
    alive = false;
    for (const d of deferreds) if (d.alive) d.dispose();
    vm.dispose();
    runtime.dispose();
  }
}

export const HOSTED_SDK="export const Events = Object.freeze({\n  ClientReady: \"ready\",\n  MessageCreate: \"messageCreate\",\n  InteractionCreate: \"interactionCreate\",\n  Error: \"error\",\n});\nexport const Colors = Object.freeze({\n  Blurple: 0x5865f2,\n  Green: 0x57f287,\n  Red: 0xed4245,\n  Gold: 0xfee75c,\n});\nexport class EmbedBuilder {\n  constructor(data = {}) {\n    this.data = JSON.parse(JSON.stringify(data));\n  }\n  setTitle(value) {\n    this.data.title = String(value);\n    return this;\n  }\n  setDescription(value) {\n    this.data.description = String(value);\n    return this;\n  }\n  setURL(value) {\n    this.data.url = String(value);\n    return this;\n  }\n  setColor(value) {\n    const n =\n      typeof value === \"string\"\n        ? Number.parseInt(value.replace(/^#/, \"\"), 16)\n        : Number(value);\n    if (!Number.isInteger(n) || n < 0 || n > 0xffffff)\n      throw Error(\"Color must be a hex color or integer\");\n    this.data.color = n;\n    return this;\n  }\n  setAuthor({ name, url, iconURL }) {\n    this.data.author = { name, url, icon_url: iconURL };\n    return this;\n  }\n  setFooter({ text, iconURL }) {\n    this.data.footer = { text, icon_url: iconURL };\n    return this;\n  }\n  setImage(url) {\n    this.data.image = { url };\n    return this;\n  }\n  setThumbnail(url) {\n    this.data.thumbnail = { url };\n    return this;\n  }\n  setTimestamp(value = new Date()) {\n    this.data.timestamp = new Date(value).toISOString();\n    return this;\n  }\n  addFields(...fields) {\n    this.data.fields = [...(this.data.fields || []), ...fields.flat()];\n    return this;\n  }\n  setFields(...fields) {\n    this.data.fields = fields.flat();\n    return this;\n  }\n  toJSON() {\n    return JSON.parse(JSON.stringify(this.data));\n  }\n}\nexport const ButtonStyle = Object.freeze({\n  Primary: 1,\n  Secondary: 2,\n  Success: 3,\n  Danger: 4,\n  Link: 5,\n});\nexport const TextInputStyle = Object.freeze({ Short: 1, Paragraph: 2 });\nclass ComponentBuilder {\n  constructor(data = {}) {\n    this.data = JSON.parse(JSON.stringify(data));\n  }\n  setCustomId(value) {\n    this.data.custom_id = String(value);\n    return this;\n  }\n  setLabel(value) {\n    this.data.label = String(value);\n    return this;\n  }\n  setStyle(value) {\n    this.data.style = value;\n    return this;\n  }\n  toJSON() {\n    return JSON.parse(JSON.stringify(this.data));\n  }\n}\nexport class ButtonBuilder extends ComponentBuilder {\n  constructor(data = {}) {\n    super({ type: 2, style: 1, ...data });\n  }\n  setURL(value) {\n    this.data.url = String(value);\n    return this;\n  }\n  setDisabled(value = true) {\n    this.data.disabled = !!value;\n    return this;\n  }\n}\nexport class TextInputBuilder extends ComponentBuilder {\n  constructor(data = {}) {\n    super({ type: 4, style: 1, required: true, ...data });\n  }\n  setPlaceholder(value) {\n    this.data.placeholder = String(value);\n    return this;\n  }\n  setRequired(value = true) {\n    this.data.required = !!value;\n    return this;\n  }\n  setMaxLength(value) {\n    this.data.max_length = value;\n    return this;\n  }\n}\nexport class ActionRowBuilder extends ComponentBuilder {\n  constructor(data = {}) {\n    super({ type: 1, components: [], ...data });\n  }\n  addComponents(...items) {\n    this.data.components.push(...items.flat().map((x) => x.toJSON?.() || x));\n    return this;\n  }\n}\nexport class ModalBuilder extends ComponentBuilder {\n  constructor(data = {}) {\n    super({ fields: [], ...data });\n  }\n  setTitle(value) {\n    this.data.title = String(value);\n    return this;\n  }\n  addComponents(...rows) {\n    for (const item of rows.flat()) {\n      const row = item.toJSON?.() || item;\n      this.data.fields.push(...(row.components || [row]));\n    }\n    return this;\n  }\n}\nexport class SlashCommandBuilder extends ComponentBuilder {\n  setName(value) {\n    this.data.name = String(value);\n    return this;\n  }\n  setDescription(value) {\n    this.data.description = String(value);\n    return this;\n  }\n}\nexport class Interaction {\n  constructor(client, data) {\n    Object.assign(this, data);\n    this.client = client;\n    this.customId = data.custom_id;\n    this.commandName = data.kind === \"command\" ? data.custom_id : null;\n    this.channelId = data.channel_id;\n    this.user = new User(client, data.user || { id: data.user_id });\n    this.channel = new Channel(client, { id: data.channel_id });\n    this.fields = {\n      getTextInputValue: (id) => String(data.fields?.[id] || \"\"),\n    };\n    this.options = {\n      getString: (name) =>\n        name === \"input\" ? String(data.fields?.input || \"\") : null,\n    };\n  }\n  isButton() {\n    return this.kind === \"button\";\n  }\n  isModalSubmit() {\n    return this.kind === \"modal\";\n  }\n  isChatInputCommand() {\n    return this.kind === \"command\";\n  }\n  reply(value) {\n    return this.client.action(\"interaction_reply\", {\n      id: this.id,\n      ...payload(value),\n      ephemeral: !!value?.ephemeral,\n    });\n  }\n  showModal(modal) {\n    return this.client.action(\"interaction_reply\", {\n      id: this.id,\n      modal: modal.toJSON?.() || modal,\n    });\n  }\n}\nfunction installExtendedAPI(client) {\n  const call = (op, p = {}) => client.action(op, p);\n  client.commands = {\n    set: (commands) =>\n      call(\"commands_set\", {\n        commands: commands.map((x) => x.toJSON?.() || x),\n      }),\n    fetch: () => call(\"commands\"),\n  };\n  client.application = { commands: client.commands };\n  client.members = {\n    fetch: () => call(\"members\"),\n    setNickname: (user_id, nickname) => call(\"nickname\", { user_id, nickname }),\n    standing: (user_id) => call(\"standing\", { user_id }),\n  };\n  client.roles = { fetch: () => call(\"roles\") };\n  client.profile = { edit: (p) => call(\"profile\", p) };\n  client.categories = {\n    fetch: () => call(\"categories\"),\n    create: (p) => call(\"category\", p),\n    delete: (id) => call(\"delete_category\", { id }),\n  };\n  Object.assign(client.channels, {\n    create: (p) => call(\"channel\", p),\n    edit: (channel_id, p) => call(\"channel\", { ...p, channel_id }),\n    archive: (channel_id) => call(\"archive_channel\", { channel_id }),\n    setPermission: (p) => call(\"permission\", p),\n  });\n  client.threads = {\n    fetch: (channel_id) => call(\"threads\", { channel_id }),\n    create: (p) => call(\"create_thread\", p),\n    archive: (p) => call(\"archive_thread\", p),\n  };\n  client.polls = {\n    create: (p) => call(\"create_poll\", p),\n    fetch: (channel_id, ids) => call(\"poll_data\", { channel_id, ids }),\n    vote: (p) => call(\"vote\", p),\n    close: (id) => call(\"close_poll\", { id }),\n  };\n}\n\nconst clients=[];\nconst rpc=async(action,payload={})=>JSON.parse(await __bridge(action,JSON.stringify(payload)));\nconst payload=value=>typeof value==='string'?{text:value}:{...(Object.hasOwn(value,'content')?{text:value.content}:{}),...(value.embeds?{embeds:value.embeds.map(e=>e.toJSON?.()||e)}:{}),...(value.replyTo?{reply_to:value.replyTo}:{}),...(value.components?{components:value.components.map(x=>x.toJSON?.()||x)}:{})};\nclass User{constructor(client,data){Object.assign(this,data);this.client=client;this.bot=!!data.is_bot;this.displayName=data.nickname||data.display_name||data.username;}async createDM(){return new Channel(this.client,{...await rpc('dm',{user_id:this.id}),kind:'dm'});}async send(value){return(await this.createDM()).send(value);}}\nclass Channel{constructor(client,data){Object.assign(this,data);this.client=client;this.messages={fetch:async({after,afterId}={})=>(await rpc('messages',{channel_id:this.id,after,after_id:afterId})).map(m=>new Message(client,m))};}async send(value){return new Message(this.client,await rpc('send',{channel_id:this.id,...payload(value)}));}isDMBased(){return this.kind==='dm'||this.id.startsWith('dm-');}}\nclass Message{constructor(client,data){Object.assign(this,data);this.client=client;this.content=data.text||'';this.channelId=data.room;this.author=new User(client,data.author||{id:data.user_id});this.channel=new Channel(client,{id:data.room});this.createdTimestamp=Date.parse(data.created_at);}reply(value){return this.channel.send({...typeof value==='string'?{content:value}:value,replyTo:this.id});}async edit(value){return new Message(this.client,await rpc('edit',{id:this.id,...payload(value)}));}delete(){return rpc('delete_message',{id:this.id});}}\nexport class Client{\n constructor(){this.handlers=new Map();this.user=new User(this,JSON.parse(__eventJSON).bot);this.channels={cache:new Map(),fetch:async id=>{if(!this.channels.cache.size)this.channels.cache=new Map((await rpc('channels')).map(c=>[c.id,new Channel(this,c)]));return id?this.channels.cache.get(id):this.channels.cache;}};this.users={fetch:async id=>new User(this,await rpc('user',{user_id:id}))};const mod=(user_id,action,reason,extra={})=>rpc('moderate',{user_id,action,reason,...extra});this.moderation={warn:(id,reason,evidence='')=>mod(id,'warning',reason,{evidence}),timeout:(id,seconds,reason)=>mod(id,'timeout',reason,{expires_at:new Date(Date.now()+seconds*1000).toISOString()}),untimeout:(id,reason)=>mod(id,'untimeout',reason),ban:(id,reason,{seconds,evidence}={})=>mod(id,'ban',reason,{expires_at:seconds?new Date(Date.now()+seconds*1000).toISOString():null,evidence}),unban:(id,reason)=>mod(id,'unban',reason)};this.automod={save:p=>rpc('automod',p),delete:id=>rpc('delete_rule',{id})};installExtendedAPI(this);}\n action(op,p={}){return rpc(op,p);}\n on(event,handler){if(!this.handlers.has(event))this.handlers.set(event,[]);this.handlers.get(event).push(handler);return this;}\n once(event,handler){return this.on(event,handler);}\n async login(){clients.push(this);return this;}\n destroy(){this.handlers.clear();}\n}\nglobalThis.__dispatch=async event=>{for(const client of clients)for(const handler of client.handlers.get(event.interaction?'interactionCreate':'messageCreate')||[])await handler(event.interaction?new Interaction(client,event.interaction):new Message(client,event.message));};\nexport function matchesWords(\n  content,\n  words,\n  { allowedWords = [], patterns = [] } = {},\n) {\n  let text = String(content);\n  for (const word of splitKeywords(allowedWords))\n    text = text.replace(keywordRegex(word, \"giu\"), \" \");\n  return (\n    splitKeywords(words).some((word) => keywordRegex(word, \"iu\").test(text)) ||\n    patterns.some((pattern) => {\n      const re =\n        pattern instanceof RegExp\n          ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, \"\"))\n          : new RegExp(pattern, \"i\");\n      return re.test(text);\n    })\n  );\n}\nexport function splitKeywords(words) {\n  return [\n    ...new Set(\n      (Array.isArray(words) ? words : [words])\n        .flatMap((s) => String(s).split(/[,\\r\\n]+/))\n        .map((s) => s.trim())\n        .filter(Boolean),\n    ),\n  ];\n}\nfunction keywordRegex(word, flags) {\n  const body = [...word]\n    .map((c) =>\n      c === \"*\" ? \"[^\\\\s]*\" : c.replace(/[.*+?^${}()|[\\]\\\\]/g, \"\\\\$&\"),\n    )\n    .join(\"\");\n  return new RegExp(\n    (word.startsWith(\"*\") ? \"\" : \"(^|[^\\\\p{L}\\\\p{N}_])\") +\n      body +\n      (word.endsWith(\"*\") ? \"\" : \"($|[^\\\\p{L}\\\\p{N}_])\"),\n    flags,\n  );\n}\n";

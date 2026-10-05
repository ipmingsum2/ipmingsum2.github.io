import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const node = readFileSync(root + "external/chatbox/chatbox.js", "utf8");
const builder = node
  .slice(
    node.indexOf("export const Events"),
    node.indexOf("export class ChatboxAPIError"),
  )
  .replaceAll("structuredClone(data)", "JSON.parse(JSON.stringify(data))")
  .replaceAll(
    "structuredClone(this.data)",
    "JSON.parse(JSON.stringify(this.data))",
  );
const words = node.slice(
  node.indexOf("export function matchesWords"),
  node.indexOf("function delay"),
);
const sdk =
  builder +
  `
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
` +
  words;
writeFileSync(root + "supabase/functions/chat-api/hosted-sdk.js", sdk);

const runtime = readFileSync(
  root + "supabase/functions/chat-api/hosted-runtime.mjs",
  "utf8",
);
writeFileSync(
  root + "supabase/functions/chat-api/hosted-bundle.ts",
  runtime + "\nexport const HOSTED_SDK=" + JSON.stringify(sdk) + ";\n",
);

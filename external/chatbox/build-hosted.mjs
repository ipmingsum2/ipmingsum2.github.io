import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const node = readFileSync(
  root + "external/chatbox/chatbox.js",
  "utf8",
).replaceAll("\r\n", "\n");
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
  node.slice(
    node.indexOf("const payload ="),
    node.indexOf("export class Client"),
  ) +
  `
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

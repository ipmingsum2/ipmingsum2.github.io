import {ChatboxBot} from './chatbox-bot.mjs';
const bot=new ChatboxBot();
const me=await bot.me();
const channelId=process.env.CHATBOX_CHANNEL_ID;
if(!channelId)throw new Error('Set CHATBOX_CHANNEL_ID to a channel returned by bot.channels().');
console.log(`Connected as ${me.display_name}`);
const stop=new AbortController();process.once('SIGINT',()=>stop.abort());
await bot.listen(channelId,async message=>{
 if(message.user_id===me.id||message.deleted)return;
 if(message.text.trim()==='!ping')await bot.send(channelId,'Pong! 🏓',{replyTo:message.id});
},{signal:stop.signal});

import { Client, Events, EmbedBuilder, Colors } from './chatbox.js';
const client = new Client();
client.once(Events.ClientReady, () => console.log(`Ready as ${client.user.displayName}`));
client.on(Events.Error, error => console.error(error.message));
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  if (message.content === '!ping') await message.reply('Pong!');
  if (message.content === '!embed') {
    const embed = new EmbedBuilder().setColor(Colors.Blurple)
      .setTitle('Hello from CHATBOX').setDescription('One import. Your own bot.')
      .addFields({name:'Commands',value:'`!ping` · `!embed` · `!dm`'})
      .setFooter({text:'Built with chatbox.js'}).setTimestamp();
    await message.reply({embeds:[embed]});
  }
  if (message.content === '!dm') await message.author.send('You asked for a DM. Here it is!');
});
process.once('SIGINT', () => client.destroy());
await client.login();

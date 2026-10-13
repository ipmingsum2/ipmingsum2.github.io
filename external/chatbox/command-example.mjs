import { Client, Events, SlashCommandBuilder } from "./chatbox.js";
const client = new Client();
const purge = new SlashCommandBuilder()
  .setName("purge")
  .setDescription("Remove recent messages in this channel")
  .setRequiredRole("Moderator")
  .addIntegerOption((o) =>
    o
      .setName("count")
      .setDescription("How many messages?")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100),
  );
const search = new SlashCommandBuilder()
  .setName("search")
  .setDescription("Try bot-provided autocomplete")
  .addStringOption((o) =>
    o
      .setName("topic")
      .setDescription("Choose a topic")
      .setRequired(true)
      .setAutocomplete(true),
  );
client.once(Events.ClientReady, async () => {
  await client.commands.set([purge, search]);
});
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    const prefix = String(interaction.options.getFocused()).toLowerCase();
    return interaction.respond(
      ["JavaScript", "Luau", "TypeScript"]
        .filter((name) => name.toLowerCase().includes(prefix))
        .map((name) => ({ name, value: name })),
    );
  }
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === "purge") {
    // Root must grant manage_messages. The server also checks the invoking member's role.
    const deleted = await interaction.channel.bulkDelete(
      interaction.options.getInteger("count", true),
    );
    await interaction.reply({
      content: `Removed ${deleted.size} messages.`,
      ephemeral: true,
    });
  } else if (interaction.commandName === "search") {
    await interaction.reply({
      content: interaction.options.getString("topic", true),
      ephemeral: true,
    });
  }
});
await client.login(); // Dashboard hosting supplies identity; Node reads CHATBOX_BOT_TOKEN.

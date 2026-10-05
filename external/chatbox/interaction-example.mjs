import {
  Client,
  Events,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "./chatbox.js";
const client = new Client();
// Hosted Studio: register "apply | Open an application form" in Slash commands.
// Self-hosted: run await client.commands.set([{name:'apply',description:'Open an application form'}]) once after login.
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || message.content !== "!apply") return;
  await message.reply({
    content: "Apply to join the community",
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("apply")
          .setLabel("Open application")
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  });
});
client.on(Events.InteractionCreate, async (interaction) => {
  if (
    (interaction.isButton() && interaction.customId === "apply") ||
    (interaction.isChatInputCommand() && interaction.commandName === "apply")
  ) {
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId("application")
        .setTitle("Access request")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("reason")
              .setLabel("Why would you like access?")
              .setStyle(TextInputStyle.Paragraph)
              .setMaxLength(1000),
          ),
        ),
    );
  } else if (
    interaction.isModalSubmit() &&
    interaction.customId === "application"
  ) {
    const reason = interaction.fields.getTextInputValue("reason");
    // Process the application here. Do not log sensitive form values.
    await interaction.reply({
      content: `Thanks! Your response contains ${reason.length} characters.`,
      ephemeral: true,
    });
  }
});
await client.login();

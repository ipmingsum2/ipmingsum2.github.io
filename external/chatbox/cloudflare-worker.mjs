import { DurableObject } from "cloudflare:workers";
import { Client, Events, EmbedBuilder } from "./chatbox.js";

// One durable cursor and one active run, even when scheduled events overlap.
export class ChatboxRunner extends DurableObject {
  async run() {
    if (this.running) return { busy: true };
    this.running = true;
    let client;
    try {
      client = new Client({ cursor: await this.ctx.storage.get("cursor") });
      client.on(Events.Error, (error) =>
        console.error("Bot action failed:", error.message),
      );
      client.on(Events.MessageCreate, async (message) => {
        if (message.author.bot) return;
        if (message.content === "!ping")
          await message.reply("Pong from Cloudflare!");
        if (message.content === "!embed")
          await message.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle("Hello from Workers")
                .setDescription(
                  "This bot is hosted in your Cloudflare account.",
                ),
            ],
          });
      });
      await client.login(this.env.CHATBOX_BOT_TOKEN, { poll: false });
      // First run starts at the current server time, without replaying old chat.
      await this.ctx.storage.put("cursor", client.cursor);
      const processed = await client.pollOnce({
        maxEvents: 25,
        // Checkpoint BEFORE acting: a crash may skip one event, but will not replay a moderation action.
        beforeDispatch: (cursor) => this.ctx.storage.put("cursor", cursor),
      });
      console.log(JSON.stringify({ event: "chatbox.batch", processed }));
      return { processed };
    } finally {
      client?.destroy();
      this.running = false;
    }
  }
}
export default {
  async scheduled(_event, env) {
    await env.CHATBOX_RUNNER.getByName("primary").run();
  },
  fetch() {
    return new Response("CHATBOX bot runs on its schedule.", { status: 200 });
  },
};

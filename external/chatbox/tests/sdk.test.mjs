import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SlashCommandBuilder,
  ApplicationCommandOptionType,
  CommandInteractionOptionResolver,
  Interaction,
  Collection,
} from "../chatbox.js";

test("SDK builds typed commands, resolves references and exposes bulk message operations", async () => {
  const command = new SlashCommandBuilder()
    .setName("tools")
    .setDescription("Tools")
    .setRequiredRole("Moderator")
    .addSubcommandGroup((group) =>
      group
        .setName("messages")
        .setDescription("Messages")
        .addSubcommand((sub) =>
          sub
            .setName("purge")
            .setDescription("Purge")
            .addIntegerOption((o) =>
              o
                .setName("count")
                .setDescription("Count")
                .setRequired()
                .setMinValue(1)
                .setMaxValue(100),
            )
            .addBooleanOption((o) =>
              o.setName("confirm").setDescription("Confirm"),
            ),
        ),
    );
  assert.equal(
    command.toJSON().options[0].type,
    ApplicationCommandOptionType.SubcommandGroup,
  );
  assert.equal(command.toJSON().options[0].options[0].options[0].min_value, 1);
  const client = new Client();
  client.token = "test";
  const calls = [];
  client.action = async (action, payload) => {
    calls.push({ action, payload });
    return action === "bulk_delete"
      ? { ids: ["one", "two"], count: 2 }
      : action === "messages"
        ? [{ id: "one", room: "lobby", user_id: "user", text: "hello" }]
        : action === "message"
          ? { id: payload.id, room: "lobby", user_id: "user" }
          : {};
  };
  const resolver = new CommandInteractionOptionResolver(client, {
    options: [
      {
        type: 2,
        name: "messages",
        options: [
          {
            type: 1,
            name: "purge",
            options: [
              { type: 4, name: "count", value: 5 },
              { type: 5, name: "confirm", value: false },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(resolver.getSubcommandGroup(), "messages");
  assert.equal(resolver.getSubcommand(), "purge");
  assert.equal(resolver.getInteger("count", true), 5);
  assert.equal(resolver.getBoolean("confirm"), false);
  assert.throws(() => resolver.getString("count"), /type/);
  assert.throws(() => resolver.getString("missing", true), /required/);
  const i = new Interaction(client, {
    kind: "command",
    channel_id: "lobby",
    fields: {
      options: [
        { name: "user", type: 6, value: "alice" },
        { name: "duration", type: 3, value: "5m" },
      ],
      resolved: { users: { alice: { id: "alice", username: "alice" } } },
    },
  });
  assert.equal(i.options.getUser("user").username, "alice");
  assert.equal(i.options.getDuration("duration"), 300);
  const messages = await i.channel.messages.fetch({
    limit: 2,
    before: "cursor",
  });
  await messages[0].pin();
  await messages[0].react("👍");
  const deleted = await i.channel.bulkDelete(messages);
  assert.ok(deleted instanceof Collection);
  assert.equal(deleted.size, 2);
  assert.deepEqual(calls.find((x) => x.action === "bulk_delete").payload, {
    channel_id: "lobby",
    ids: ["one"],
  });
  await i.channel.bulkDelete(5);
  assert.equal(calls.at(-1).payload.count, 5);
  await assert.rejects(i.channel.bulkDelete(101), /1–100/);
  assert.equal((await i.channel.messages.fetch("one")).id, "one");
});
import {
  Client,
  Events,
  EmbedBuilder,
  Colors,
  matchesWords,
  splitKeywords,
} from "../chatbox.js";

test("scheduled SDK mode has no polling loop and checkpoints events before handlers", async () => {
  const client = new Client(),
    sequence = [];
  client.request = async (path) =>
    path === "/v1/me"
      ? { id: "bot", server_time: "2026-10-03T00:00:00Z" }
      : path === "/v1/channels"
        ? []
        : [
            {
              id: "one",
              room: "lobby",
              text: "hello",
              created_at: "2026-10-03T00:00:01Z",
              author: { id: "alice" },
            },
          ];
  client.on(Events.MessageCreate, (m) => sequence.push("handler:" + m.id));
  await client.login("test-token", { poll: false });
  assert.equal(client._task, undefined);
  const n = await client.pollOnce({
    beforeDispatch: async (cursor) => sequence.push("saved:" + cursor.afterId),
  });
  assert.equal(n, 1);
  assert.deepEqual(sequence, ["saved:one", "handler:one"]);
  assert.equal(client.cursor.afterId, "one");
  client.destroy();
});

test("SDK deduplicates channel lookups and clears cached identities on logout", async () => {
  const client = new Client();
  let count = 0;
  client.request = async () => {
    count++;
    return [{ id: "lobby", name: "Lobby" }];
  };
  await Promise.all([
    client.channels.fetch("lobby"),
    client.channels.fetch("lobby"),
  ]);
  assert.equal(count, 1);
  await client.channels.fetch("lobby");
  assert.equal(count, 1);
  client.destroy();
  await client.channels.fetch("lobby");
  assert.equal(count, 2);
});

test("SDK keywords use comma phrases, literal punctuation, wildcard boundaries and allowlists", () => {
  assert.deepEqual(splitKeywords("first phrase, second\nthird"), [
    "first phrase",
    "second",
    "third",
  ]);
  assert.equal(matchesWords("scatter", ["cat"]), false);
  assert.equal(matchesWords("cat!", ["cat"]), true);
  assert.equal(matchesWords("doghouse", ["dog*"]), true);
  assert.equal(matchesWords("blackbird", ["*bird"]), true);
  assert.equal(matchesWords("redfoxes", ["*fox*"]), true);
  assert.equal(matchesWords("use c++", ["c++"]), true);
  assert.equal(
    matchesWords("dogwood", ["dog*"], { allowedWords: ["dogwood"] }),
    false,
  );
  assert.equal(matchesWords("aaz", [], { patterns: ["a{2,3}z"] }), true);
});

test("Client emits new messages, supports replies, embeds, user DMs, moderation and stops polling", async () => {
  const original = globalThis.fetch,
    calls = [];
  const response = (data) =>
    new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname;
    const body = options.body && JSON.parse(options.body);
    calls.push({ path, body, options });
    if (path === "/v1/me")
      return response({
        id: "bot",
        is_bot: true,
        server_time: "2026-01-01T00:00:00Z",
      });
    if (path === "/v1/channels")
      return response([{ id: "general", kind: "text" }]);
    if (path === "/v1/events")
      return response([
        {
          id: "m1",
          room: "general",
          text: "!test",
          user_id: "alice",
          created_at: "2026-01-02T00:00:00Z",
          author: { id: "alice", username: "alice" },
        },
      ]);
    if (path === "/v1/users/alice")
      return response({ id: "alice", username: "alice" });
    if (path === "/v1/dms") return response({ id: "dm-bot-alice" });
    return response({
      id: "sent",
      room: path.includes("/channels/") ? path.split("/")[3] : "general",
      text: body?.text || "",
      embeds: body?.embeds || [],
      user_id: "bot",
    });
  };
  const client = new Client({ baseURL: "https://test.example" });
  let ready = false,
    resolveEvent;
  const received = new Promise((r) => (resolveEvent = r));
  client.once(Events.ClientReady, () => {
    ready = true;
  });
  client.on(Events.Error, (e) => {
    throw e;
  });
  client.on(Events.MessageCreate, async (message) => {
    assert.equal(message.author.bot, false);
    assert.equal(message.content, "!test");
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Reply")
          .setColor(Colors.Blurple)
          .addFields({ name: "A", value: "B", inline: true }),
      ],
    });
    client.destroy();
    resolveEvent();
  });
  try {
    await client.login("test-token");
    await received;
    await client._task;
    assert.equal(ready, true);
    assert.equal(client.cursor.afterId, "m1");
    const reply = calls.find((c) => c.body?.reply_to === "m1");
    assert.equal(reply.body.embeds[0].title, "Reply");
    const user = await client.users.fetch("alice");
    await user.send("Private reply");
    assert.ok(
      calls.some(
        (c) =>
          c.path === "/v1/channels/dm-bot-alice/messages" &&
          c.body.text === "Private reply",
      ),
    );
    await client.moderation.warn("alice", "Test reason");
    assert.ok(calls.some((c) => c.body?.action === "warning"));
    assert.equal(calls.filter((c) => c.path === "/v1/events").length, 1);
    assert.ok(
      calls.every((c) => c.options.headers.Authorization === "Bot test-token"),
    );
  } finally {
    client.destroy();
    globalThis.fetch = original;
  }
});

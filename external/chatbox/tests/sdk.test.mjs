import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Client,
  Events,
  EmbedBuilder,
  Colors,
  matchesWords,
  splitKeywords,
} from "../chatbox.js";

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

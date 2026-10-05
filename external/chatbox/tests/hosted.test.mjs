import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  getQuickJS,
  newQuickJSWASMModuleFromVariant,
  newVariant,
} from "quickjs-emscripten";
import RELEASE_SYNC from "@jitl/quickjs-singlefile-browser-release-sync";
import { runHosted } from "../../../supabase/functions/chat-api/hosted-runtime.mjs";
const sdk = await readFile(
  new URL(
    "../../../supabase/functions/chat-api/hosted-sdk.js",
    import.meta.url,
  ),
  "utf8",
);
const event = {
  bot: { id: "bot", is_bot: true },
  message: {
    id: "message",
    room: "lobby",
    text: "!ping",
    author: { id: "alice", username: "alice" },
    created_at: "2026-01-01",
  },
};
test("hosted interaction handler creates a validated-shape modal without a token", async () => {
  const calls = [];
  await runHosted(
    await getQuickJS(),
    `import {Client,Events,ModalBuilder,ActionRowBuilder,TextInputBuilder} from 'chatbox.js';const c=new Client();c.on(Events.InteractionCreate,async i=>{if(i.isButton())await i.showModal(new ModalBuilder().setCustomId('apply').setTitle('Application').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Why?').setMaxLength(200))));});await c.login();`,
    sdk,
    {
      bot: { id: "bot" },
      interaction: {
        id: "ticket",
        kind: "button",
        custom_id: "open",
        channel_id: "lobby",
        user: { id: "alice" },
      },
    },
    async (action, payload) => {
      calls.push({ action, payload });
      return {};
    },
  );
  assert.equal(calls[0].action, "interaction_reply");
  assert.equal(calls[0].payload.id, "ticket");
  assert.equal(calls[0].payload.modal.fields[0].custom_id, "reason");
});
test("hosted bot imports SDK and awaits real replies/embeds through a bounded API bridge", async () => {
  const calls = [];
  const result = await runHosted(
    await getQuickJS(),
    `import {Client,Events,EmbedBuilder} from 'chatbox.js';const client=new Client();client.on(Events.MessageCreate,async m=>{const sent=await m.reply({embeds:[new EmbedBuilder().setTitle('Pong')]});await sent.edit('Updated');console.log('done');});await client.login();`,
    sdk,
    event,
    async (action, payload) => {
      calls.push({ action, payload });
      return { id: "sent", room: "lobby", user_id: "bot", text: payload.text };
    },
  );
  assert.deepEqual(
    calls.map((c) => c.action),
    ["send", "edit"],
  );
  assert.equal(calls[0].payload.embeds[0].title, "Pong");
  assert.equal(calls[1].payload.id, "sent");
  assert.deepEqual(result.logs, ["done"]);
});

test("production single-file WASM variant enforces bridge and heap limits", async () => {
  const q = await newQuickJSWASMModuleFromVariant(
    newVariant(RELEASE_SYNC, {
      wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: 1024 }),
    }),
  );
  let calls = 0;
  await assert.rejects(
    runHosted(
      q,
      `import {Client,Events} from 'chatbox.js';const c=new Client();c.on(Events.MessageCreate,async m=>{for(let i=0;i<9;i++)await m.reply('x');});await c.login();`,
      sdk,
      event,
      async () => {
        calls++;
        return { id: "reply", room: "lobby" };
      },
    ),
    /Maximum 8/,
  );
  assert.equal(calls, 8);
  await assert.rejects(
    runHosted(
      q,
      "const a=[];while(true)a.push(new Array(10000).fill(42));",
      sdk,
      event,
      async () => {},
    ),
    /memory|interrupted|allocation/i,
  );
});
test("hosted scripts cannot access the host, import packages, or run forever", async () => {
  const q = await getQuickJS();
  let calls = 0;
  const invoke = async () => {
    calls++;
    return {};
  };
  await assert.rejects(
    runHosted(q, "while(true){}", sdk, event, invoke, { cpuMs: 20 }),
    /interrupted/,
  );
  await assert.rejects(
    runHosted(q, "import fs from 'node:fs'", sdk, event, invoke),
    /Only chatbox.js/,
  );
  await assert.rejects(
    runHosted(q, "fetch('https://example.com')", sdk, event, invoke),
    /fetch/,
  );
  await assert.rejects(
    runHosted(q, "process.env.SECRET", sdk, event, invoke),
    /process/,
  );
  assert.equal(calls, 0);
});

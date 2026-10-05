(() => {
  const template = `import { Client, Events, EmbedBuilder, Colors } from 'chatbox.js';
const client = new Client();
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  if (message.content === '!ping') await message.reply('Pong!');
  if (message.content === '!embed') {
    const embed = new EmbedBuilder().setColor(Colors.Blurple)
      .setTitle('Hello from your hosted bot')
      .setDescription('I keep running when your browser is closed.');
    await message.reply({ embeds: [embed] });
  }
});
await client.login(); // Hosting supplies this bot's identity. No token here.
`;
  let editorModule;
  window.ChatBotStudio = async function ({
    bot,
    userId,
    request,
    modal,
    esc,
    toast,
  }) {
    const program = await request("get", { bot_id: bot.id });
    const key = "chatbox-script:" + userId + ":" + bot.id;
    let source = program.draft_source ?? (program.source || template);
    try {
      source = localStorage.getItem(key) || source;
    } catch {}
    modal(
      "Bot Studio",
      `<div class="bot-studio"><div class="studio-summary"><span class="status-pill" id="studioStatus">${program.enabled ? "● Hosted · 24/7" : "○ Hosting stopped"}</span><a href="/external/chatbox/index.html#hosting" target="_blank">Hosting guide ↗</a></div><p class="muted">Upload or write JavaScript. Publish to run on new messages even when this browser is closed. Your bot keeps its existing permissions.</p><div class="studio-toolbar"><label class="secondary upload-script">Upload .js<input type="file" id="studioUpload" accept=".js,.mjs,text/javascript" hidden></label><button class="secondary" id="studioDownload">Download script</button><span class="muted" id="studioDraft">Drafts save on this device as you type.</span></div><div id="studioEditor"><textarea aria-label="Bot JavaScript" id="studioFallback" spellcheck="false">${esc(source)}</textarea></div><div class="studio-toolbar"><button class="secondary" id="studioSave">Save draft</button><button class="primary" id="studioPublish">Publish & run 24/7</button><button class="danger" id="studioStop">Stop hosting</button></div><p class="small-note">Use <code>import { Client } from 'chatbox.js'</code>. Hosted scripts support message handlers and the CHATBOX API. Node packages, external fetch, timers, and persistent global variables require the self-hosted option.</p><details class="studio-commands"><summary>Slash commands</summary><p class="small-note">One command per line: name | description. Register here once, then handle InteractionCreate in your script.</p><textarea id="studioCommands" aria-label="Slash command definitions" rows="4" placeholder="apply | Open an application form"></textarea><button class="secondary" id="studioSaveCommands">Save commands</button></details><div class="toolbar-row"><h3>Recent executions</h3><button class="secondary" id="studioLogs">Refresh logs</button></div><div id="studioLogList" class="studio-logs">${program.last_error ? esc(program.last_error) : "Load logs to see replies, errors, and console output."}</div></div>`,
    );
    const $ = (id) => document.getElementById(id),
      container = $("studioEditor");
    let editor = {
        getValue: () => $("studioFallback").value,
        setValue: (v) => {
          $("studioFallback").value = v;
          changed(v);
        },
        destroy() {},
      },
      timer;
    function changed(value) {
      source = value;
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(key, value);
          if ($("studioDraft"))
            $("studioDraft").textContent = "Draft saved on this device";
        } catch {
          if ($("studioDraft"))
            $("studioDraft").textContent = "Use Save draft to keep your code";
        }
      }, 350);
    }
    $("studioFallback").oninput = (e) => changed(e.target.value);
    try {
      editorModule ||= import("/external/js/chat-code-editor.js");
      const { createEditor } = await editorModule;
      if (!container.isConnected) return;
      container.replaceChildren();
      editor = createEditor(container, source, changed);
    } catch {
      toast(
        "Editor highlighting could not load; the plain editor still works.",
        true,
      );
    }
    const observer = new MutationObserver(() => {
      if (!container.isConnected) {
        editor.destroy();
        observer.disconnect();
      }
    });
    observer.observe(document.getElementById("modalContent"), {
      childList: true,
    });
    $("studioUpload").onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!/\.(m?js)$/i.test(file.name) || file.size > 80000) {
        toast("Choose a JavaScript file under 80 KB.", true);
        return;
      }
      editor.setValue(await file.text());
    };
    $("studioDownload").onclick = () => {
      const link = document.createElement("a"),
        url = URL.createObjectURL(
          new Blob(
            [
              editor
                .getValue()
                .replace(/from (['"])chatbox\.js\1/g, "from $1./chatbox.js$1"),
            ],
            { type: "text/javascript" },
          ),
        );
      link.href = url;
      link.download = "chatbox-bot.mjs";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    async function save(action) {
      const buttons = ["studioSave", "studioPublish", "studioStop"].map($);
      buttons.forEach((b) => (b.disabled = true));
      try {
        const value = editor.getValue();
        if (value.length > 80000)
          throw Error("Script must be 80,000 characters or fewer");
        const result = await request(action, {
          bot_id: bot.id,
          source: value,
          enabled: true,
        });
        $("studioStatus").textContent = result.enabled
          ? "● Hosted · 24/7"
          : "○ Hosting stopped";
        $("studioDraft").textContent = "Saved to your bot";
        try {
          localStorage.removeItem(key);
        } catch {}
        toast(
          action === "draft"
            ? "Draft saved. Published code is unchanged."
            : action === "stop"
              ? "Hosting stopped."
              : "Published. The bot will respond to new messages.",
        );
      } catch (e) {
        toast(e.message, true);
      } finally {
        buttons.forEach((b) => (b.disabled = false));
      }
    }
    $("studioSave").onclick = () => save("draft");
    $("studioPublish").onclick = () => save("save");
    $("studioStop").onclick = () => save("stop");
    try {
      const rows = await request("commands", { bot_id: bot.id });
      if ($("studioCommands"))
        $("studioCommands").value = rows
          .map((c) => c.name + " | " + c.description)
          .join("\n");
    } catch (e) {
      toast(e.message, true);
    }
    $("studioSaveCommands").onclick = async () => {
      try {
        const commands = $("studioCommands")
          .value.split(/\r?\n/)
          .map((x) => x.trim())
          .filter(Boolean)
          .map((line) => {
            const split = line.indexOf("|");
            if (split < 1) throw Error("Use name | description on each line");
            return {
              name: line.slice(0, split).trim(),
              description: line.slice(split + 1).trim(),
            };
          });
        await request("commands_set", { bot_id: bot.id, commands });
        toast("Commands saved. They appear in chat within a minute.");
      } catch (e) {
        toast(e.message, true);
      }
    };
    $("studioLogs").onclick = async () => {
      try {
        const logs = await request("logs", { bot_id: bot.id });
        $("studioLogList").innerHTML =
          logs
            .map(
              (log) =>
                `<article><b>${esc(log.status)}</b> <time>${esc(log.started_at ? new Date(log.started_at).toLocaleString() : "Queued")}</time><pre>${esc(log.error || (log.logs || []).join("\n") || "Completed without console output")}</pre></article>`,
            )
            .join("") ||
          "No executions yet. Publish and send a command to your bot.";
      } catch (e) {
        toast(e.message, true);
      }
    };
  };
})();

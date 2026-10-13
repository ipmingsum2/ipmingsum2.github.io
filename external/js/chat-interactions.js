/* Bot components and private form responses. No submitted fields enter channel history. */
(() => {
  window.ChatInteractions = ({
    state,
    rpc,
    modal,
    closeModal,
    profile,
    toast,
    safe,
    preview,
    upload,
  }) => {
    const { esc, https, render, embeds } = window.ChatCore;
    const cache = new Map(),
      pending = new Set();
    if (preview) {
      const bot = () => state.profiles.find((p) => p.is_bot)?.id;
      rpc = async (op, p) =>
        op === "commands"
          ? [
              {
                bot_id: bot(),
                name: "apply",
                description: "Preview an application form",
                options: [
                  {
                    type: 3,
                    name: "reason",
                    description: "Why would you like access?",
                    required: true,
                    format: "multiline",
                    max_length: 1000,
                  },
                  {
                    type: 4,
                    name: "days",
                    description: "How many days?",
                    min_value: 1,
                    max_value: 30,
                  },
                  { type: 6, name: "member", description: "Choose a member" },
                ],
              },
            ]
          : op === "status"
            ? {
                response:
                  p.id === "preview-submission"
                    ? {
                        type: "message",
                        text: "Thanks! This preview submission stayed in your browser.",
                      }
                    : {
                        type: "modal",
                        modal: {
                          title: "Access request",
                          custom_id: "application",
                          fields: [
                            {
                              custom_id: "username",
                              label: "Your username",
                              required: true,
                              max_length: 32,
                              style: 1,
                            },
                            {
                              custom_id: "reason",
                              label: "Why would you like access?",
                              required: true,
                              max_length: 1000,
                              style: 2,
                            },
                          ],
                        },
                      },
              }
            : {
                id: op === "submit" ? "preview-submission" : "preview-form",
                bot_id: bot(),
              };
    }
    async function commands() {
      const key = state.room,
        hit = cache.get(key);
      if (hit && hit.until > Date.now()) return hit.promise;
      const promise = rpc("commands", { channel_id: key });
      cache.set(key, { until: Date.now() + 60000, promise });
      try {
        return await promise;
      } catch (e) {
        cache.delete(key);
        throw e;
      }
    }
    function renderComponents(m) {
      if (m.deleted) return "";
      return `<div class="bot-components">${(m.components || []).map((row) => `<div class="bot-component-row">${(row.components || []).map((b) => (b.style === 5 ? (https(b.url) ? `<a class="secondary bot-component bot-style-5" ${b.disabled ? 'aria-disabled="true" tabindex="-1"' : `href="${esc(https(b.url))}" target="_blank" rel="noopener noreferrer"`}>${esc(b.label)} ↗</a>` : "") : `<button class="bot-component secondary bot-style-${[1, 2, 3, 4].includes(b.style) ? b.style : 2}" data-bot-button="${esc(b.custom_id)}" data-bot-message="${esc(m.id)}" ${b.disabled ? "disabled" : ""}>${esc(b.label)}</button>`)).join("")}</div>`).join("")}</div>`;
    }
    async function watch(ticket) {
      if (pending.has(ticket.id)) return;
      pending.add(ticket.id);
      const user = state.me?.id;
      try {
        for (let attempt = 0; attempt < 45; attempt++) {
          if (state.me?.id !== user) return;
          const result = await rpc("status", { id: ticket.id });
          if (state.me?.id !== user) return;
          if (result.expired)
            throw Error("This request expired. Please try again.");
          if (result.response) {
            const r = result.response;
            if (r.type === "modal") showForm(ticket, r.modal);
            else if (r.type === "message")
              modal(
                `${profile(ticket.bot_id).display_name} · Only you can see this`,
                `${render(r.text, state.profiles, state.channels)}${embeds(r.embeds || [], state.profiles, state.channels)}`,
              );
            else toast("The app replied in this channel.");
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        toast(
          "The app has not responded yet. Check that its bot is running.",
          true,
        );
      } finally {
        pending.delete(ticket.id);
      }
    }
    function showForm(ticket, form) {
      modal(
        form.title,
        `<p class="bot-form-notice">This form will be submitted to <b>${esc(profile(ticket.bot_id).display_name)}</b>. Do not share passwords or other sensitive information.</p><form id="botInteractionForm">${form.fields.map((f) => `<label>${esc(f.label)}${f.required !== false ? ' <span class="required">*</span>' : ""}${f.style === 2 ? `<textarea name="${esc(f.custom_id)}" rows="4"` : `<input type="text" name="${esc(f.custom_id)}"`} placeholder="${esc(f.placeholder || "")}" maxlength="${Math.min(4000, Number(f.max_length) || 1000)}" ${f.required !== false ? "required" : ""}>${f.style === 2 ? "</textarea>" : ""}</label>`).join("")}<div class="toolbar-row"><button type="button" class="secondary" id="cancelBotForm">Cancel</button><button type="submit" class="primary">Submit</button></div></form>`,
      );
      document.getElementById("cancelBotForm").onclick = closeModal;
      document.getElementById("botInteractionForm").onsubmit = (e) => {
        e.preventDefault();
        const formNode = e.currentTarget,
          button = formNode.querySelector("[type=submit]");
        button.disabled = true;
        safe(async () => {
          try {
            const child = await rpc("submit", {
              id: ticket.id,
              fields: Object.fromEntries(new FormData(formNode)),
            });
            closeModal();
            toast("Form submitted. Waiting for the app…");
            await watch(child);
          } finally {
            button.disabled = false;
          }
        });
      };
    }
    function commandForm(command, invoke) {
      const room = state.room,
        user = state.me?.id;
      let path = [],
        leaf = [],
        timers = new Map(),
        popup,
        requestVersion = 0;
      const optionsFor = (option) => {
        if (option.choices?.length)
          return option.choices.map((c) => [JSON.stringify(c.value), c.name]);
        if (option.type === 5)
          return [
            ["true", "True"],
            ["false", "False"],
          ];
        if (option.type === 6)
          return state.profiles.map((p) => [
            p.id,
            `${p.display_name} (@${p.username})`,
          ]);
        if (option.type === 8) return window.ChatCore.roles.map((r) => [r, r]);
        if (option.type === 9)
          return [
            ...state.profiles.map((p) => [p.id, "@" + p.username]),
            ...window.ChatCore.roles.map((r) => ["role:" + r, r + " · Role"]),
          ];
        if (option.type === 7) {
          const numeric = {
            text: 0,
            dm: 1,
            announcement: 5,
            thread: 11,
            category: 4,
          };
          return [
            ...state.channels,
            ...(state.categories || []).map((c) => ({
              ...c,
              kind: "category",
            })),
          ]
            .filter(
              (c) =>
                !option.channel_types?.length ||
                option.channel_types.includes(c.kind) ||
                option.channel_types.includes(numeric[c.kind]),
            )
            .map((c) => [c.id, (c.kind === "category" ? "▾ " : "# ") + c.name]);
        }
        return null;
      };
      const field = (o) => {
        const choices = optionsFor(o),
          required = o.required ? "required" : "",
          name = `arg-${o.name}`;
        let control;
        if (choices)
          control = `<select name="${esc(name)}" ${required}><option value="">${o.required ? "Choose a value" : "Not set"}</option>${choices.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join("")}</select>`;
        else if (o.type === 11)
          control = `<input type="file" name="${esc(name)}" ${required} ${o.file_types?.length ? `accept="${esc(o.file_types.map((t) => (t.startsWith(".") ? t : t + "/*")).join(","))}"` : ""}>`;
        else if (o.format === "multiline")
          control = `<textarea name="${esc(name)}" rows="3" minlength="${Number(o.min_length) || 0}" maxlength="${Number(o.max_length) || 6000}" ${required}></textarea>`;
        else
          control = `<input name="${esc(name)}" type="${[4, 10].includes(o.type) ? "number" : o.format === "date" ? "date" : o.format === "url" ? "url" : "text"}" ${[4, 10].includes(o.type) ? `step="${o.type === 4 ? "1" : "any"}" ${o.min_value !== undefined ? `min="${Number(o.min_value)}"` : ""} ${o.max_value !== undefined ? `max="${Number(o.max_value)}"` : ""}` : `minlength="${Number(o.min_length) || 0}" maxlength="${Number(o.max_length) || 6000}"`} ${o.format === "duration" ? 'placeholder="5m, 2h, 3d" pattern="[0-9]+(\\.[0-9]+)?[smhdw]"' : o.format === "color" ? 'placeholder="#5865f2" pattern="#[a-fA-F0-9]{6}"' : ""} ${o.autocomplete ? 'data-autocomplete="' + esc(o.name) + '" autocomplete="off"' : ""} ${required}>`;
        return `<label class="command-argument"><span><b>${esc(o.name)}</b> ${o.required ? '<span class="required">*</span>' : "<small>optional</small>"}</span><small>${esc(o.description)}</small>${control}</label>`;
      };
      function draw() {
        popup?.close();
        requestVersion++;
        let definitions = command.options || [],
          branch = "";
        for (
          let depth = 0;
          depth < 2 && definitions.some((o) => [1, 2].includes(o.type));
          depth++
        ) {
          const selected =
            definitions.find((o) => o.name === path[depth]) || definitions[0];
          path[depth] = selected.name;
          branch += `<label>${depth === 0 && selected.type === 2 ? "Command group" : "Subcommand"}<select data-command-path="${depth}">${definitions.map((o) => `<option value="${esc(o.name)}" ${o.name === selected.name ? "selected" : ""}>${esc(o.name)} — ${esc(o.description)}</option>`).join("")}</select></label>`;
          definitions = selected.options || [];
        }
        leaf = definitions;
        path = path.slice(0, branch.match(/data-command-path/g)?.length || 0);
        modal(
          "/" + command.name,
          `<div class="command-app-label">${esc(profile(command.bot_id).display_name)} <span class="bot-label">APP</span></div><p class="muted">${esc(command.description)}</p><form id="slashCommandForm">${branch}<div class="command-arguments">${leaf.map(field).join("")}</div><p class="small-note">Required arguments are marked *. This command is sent privately to this app.</p><div class="toolbar-row"><button type="button" class="secondary" id="cancelSlashCommand">Cancel</button><button type="submit" class="primary">Run command</button></div><p id="slashCommandError" class="error" role="alert"></p></form>`,
        );
        const form = document.getElementById("slashCommandForm");
        document.getElementById("cancelSlashCommand").onclick = () => {
          popup?.close();
          closeModal();
        };
        form.querySelectorAll("[data-command-path]").forEach(
          (s) =>
            (s.onchange = () => {
              path[Number(s.dataset.commandPath)] = s.value;
              path.length = Number(s.dataset.commandPath) + 1;
              draw();
            }),
        );
        form.querySelectorAll("[data-autocomplete]").forEach(
          (input) =>
            (input.oninput = () => {
              clearTimeout(timers.get(input.name));
              popup?.close();
              const version = ++requestVersion;
              if (!input.value.trim()) return;
              timers.set(
                input.name,
                setTimeout(
                  () =>
                    safe(async () => {
                      if (!input.isConnected || version !== requestVersion)
                        return;
                      const options = await collect(
                        form,
                        true,
                        input.dataset.autocomplete,
                      );
                      const ticket = await rpc("autocomplete", {
                        bot_id: command.bot_id,
                        channel_id: room,
                        name: command.name,
                        options,
                        path,
                        focused: {
                          name: input.dataset.autocomplete,
                          value: input.value.slice(0, 100),
                        },
                      });
                      let response;
                      for (let i = 0; i < 6; i++) {
                        if (
                          !input.isConnected ||
                          version !== requestVersion ||
                          state.room !== room ||
                          state.me?.id !== user
                        )
                          return;
                        const status = await rpc("status", { id: ticket.id });
                        if (status.response) {
                          response = status.response;
                          break;
                        }
                        if (status.expired) return;
                        await new Promise((r) => setTimeout(r, 700));
                      }
                      if (
                        !input.isConnected ||
                        version !== requestVersion ||
                        response?.type !== "choices" ||
                        !window.ChatUI
                      )
                        return;
                      const list = document.createElement("div");
                      list.className = "select-options command-autocomplete";
                      list.setAttribute("role", "listbox");
                      for (const choice of response.choices) {
                        const b = document.createElement("button");
                        b.type = "button";
                        b.textContent = choice.name;
                        b.setAttribute("role", "option");
                        b.onclick = () => {
                          input.value = String(choice.value);
                          popup?.close();
                          input.focus();
                        };
                        list.append(b);
                      }
                      if (list.childElementCount)
                        popup = window.ChatUI.floating(list, input);
                    }),
                  500,
                ),
              );
            }),
        );
        form.onsubmit = (e) => {
          e.preventDefault();
          if (!form.reportValidity()) return;
          const button = form.querySelector("[type=submit]");
          button.disabled = true;
          safe(async () => {
            try {
              if (state.room !== room || state.me?.id !== user)
                throw Error(
                  "The account or channel changed. Open the command again.",
                );
              const options = await collect(form, false);
              if (state.room !== room || state.me?.id !== user)
                throw Error(
                  "The account or channel changed. Open the command again.",
                );
              await invoke(command, options, room);
              popup?.close();
              closeModal();
            } catch (error) {
              const errorNode = document.getElementById("slashCommandError");
              if (errorNode) errorNode.textContent = error.message;
            } finally {
              button.disabled = false;
            }
          });
        };
      }
      async function collect(form, partial, focused) {
        const values = [];
        for (const option of leaf) {
          if (option.name === focused) continue;
          const input = form.elements.namedItem("arg-" + option.name);
          let value = input.value;
          if (option.type === 11) {
            if (partial || !input.files[0]) continue;
            const file = input.files[0];
            value = {
              url: await upload(file),
              name: file.name.slice(0, 200),
              size: file.size,
            };
          } else {
            if (value === "") continue;
            if (option.choices?.length || option.type === 5)
              value = JSON.parse(value);
            else if ([4, 10].includes(option.type)) {
              value = Number(value);
              if (!Number.isFinite(value)) continue;
            }
          }
          values.push({ name: option.name, type: option.type, value });
        }
        let result = values,
          defs = command.options || [];
        const branches = [];
        for (const name of path) {
          const d = defs.find((o) => o.name === name);
          branches.push(d);
          defs = d.options || [];
        }
        for (const d of branches.reverse())
          result = [{ name: d.name, type: d.type, options: result }];
        return result;
      }
      draw();
    }
    document.addEventListener("click", (e) => {
      const button = e.target.closest("[data-bot-button]");
      if (!button || button.disabled) return;
      button.disabled = true;
      safe(async () => {
        try {
          const ticket = await rpc("button", {
            message_id: button.dataset.botMessage,
            custom_id: button.dataset.botButton,
          });
          toast("Waiting for the app…");
          await watch(ticket);
        } finally {
          if (button.isConnected) button.disabled = false;
        }
      });
    });
    return {
      render: renderComponents,
      commands,
      async command(name, input) {
        const matches = (await commands()).filter((c) => c.name === name);
        if (!matches.length) return false;
        const invoke = async (c, options = [], room = state.room) => {
          const ticket = await rpc("command", {
            bot_id: c.bot_id,
            name,
            channel_id: room,
            input,
            options,
          });
          toast("Command sent. Waiting for the app…");
          safe(() => watch(ticket));
        };
        const choose = async (c) =>
          c.options?.length ? commandForm(c, invoke) : invoke(c);
        if (matches.length === 1) await choose(matches[0]);
        else {
          modal(
            "Choose an app",
            matches
              .map(
                (c, i) =>
                  `<button class="secondary command-choice" data-command-index="${i}">${esc(profile(c.bot_id).display_name)} · /${esc(name)}</button>`,
              )
              .join(""),
          );
          document.querySelectorAll("[data-command-index]").forEach(
            (b) =>
              (b.onclick = () =>
                safe(async () => {
                  closeModal();
                  await choose(matches[Number(b.dataset.commandIndex)]);
                })),
          );
        }
        return true;
      },
    };
  };
})();

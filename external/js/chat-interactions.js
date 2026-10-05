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
      return `<div class="bot-components">${(m.components || []).map((row) => `<div class="bot-component-row">${(row.components || []).map((b) => (b.style === 5 ? (https(b.url) ? `<a class="secondary bot-component" href="${esc(https(b.url))}" target="_blank" rel="noopener noreferrer">${esc(b.label)} ↗</a>` : "") : `<button class="bot-component ${b.style === 1 ? "primary" : b.style === 4 ? "danger" : "secondary"}" data-bot-button="${esc(b.custom_id)}" data-bot-message="${esc(m.id)}" ${b.disabled ? "disabled" : ""}>${esc(b.label)}</button>`)).join("")}</div>`).join("")}</div>`;
    }
    async function watch(ticket) {
      if (pending.has(ticket.id)) return;
      pending.add(ticket.id);
      const user = state.me?.id;
      try {
        for (let attempt = 0; attempt < 45; attempt++) {
          if (state.me?.id !== user) return;
          const result = await rpc("status", { id: ticket.id });
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
        const invoke = async (c) => {
          const ticket = await rpc("command", {
            bot_id: c.bot_id,
            name,
            channel_id: state.room,
            input,
          });
          toast("Command sent. Waiting for the app…");
          safe(() => watch(ticket));
        };
        if (matches.length === 1) await invoke(matches[0]);
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
                  await invoke(matches[Number(b.dataset.commandIndex)]);
                })),
          );
        }
        return true;
      },
    };
  };
})();

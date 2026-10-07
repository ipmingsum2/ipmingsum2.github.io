/* Threads and polls share the existing channel authorization and message pipeline. */
(() => {
  window.ChatSocial = function (api) {
    const {
      state,
      rpc,
      socialRPC,
      refresh,
      sync,
      modal,
      closeModal,
      profile,
      avatar,
      attachmentHTML,
      openChannel,
      toast,
      safe,
      preview,
    } = api;
    const { esc, render } = window.ChatCore;
    const $ = (id) => document.getElementById(id);
    const polls = new Map(),
      choices = new Map(),
      results = new Set(),
      threadInfo = new Map(),
      pending = new Map();
    const demoPolls = new Map(),
      pollFetched = new Map();
    let threadCanSend = false;
    let active = null,
      messages = [],
      reply = null,
      follow = true,
      request = 0,
      sending = false;
    const panel = document.createElement("aside");
    panel.id = "threadPane";
    panel.className = "thread-pane";
    panel.hidden = true;
    panel.setAttribute("aria-label", "Thread conversation");
    $("appView").append(panel);
    const threadButton = document.createElement("button");
    threadButton.id = "threadBrowserButton";
    threadButton.className = "icon-button";
    threadButton.type = "button";
    threadButton.title = "Threads";
    threadButton.setAttribute("aria-label", "Browse threads");
    threadButton.textContent = "≋";
    $("channelSettingsButton").before(threadButton);
    threadButton.onclick = () => safe(() => listThreads());
    async function action(op, p = {}) {
      if (!preview) return socialRPC(op, p);
      if (op === "threads")
        return state.demoChannels
          .filter((c) => c.parent_id === p.channel_id)
          .map((t) => ({
            ...t,
            message_count: state.demoMessages.filter(
              (m) => m.room === t.id && !m.deleted,
            ).length,
          }));
      if (op === "create_thread") {
        const result = await rpc("send", {
          channel_id: p.channel_id,
          text: p.name,
          reply_to: p.reply_to,
        });
        if (result.blocked) return result;
        const id = crypto.randomUUID();
        state.demoChannels.push({
          id,
          name: p.name,
          kind: "thread",
          parent_id: p.channel_id,
          created_by: state.me.id,
          created_at: new Date().toISOString(),
          archived: false,
        });
        state.demoMessages.find((m) => m.id === result.id).thread_id = id;
        return { id };
      }
      if (op === "archive_thread") {
        state.demoChannels.find((c) => c.id === p.id).archived = p.archived;
        return {};
      }
      if (op === "create_poll") {
        const result = await rpc("send", {
          channel_id: p.channel_id,
          text: p.question + "\n" + p.answers.map((a) => a.text).join("\n"),
        });
        if (result.blocked) return result;
        const id = crypto.randomUUID();
        demoPolls.set(id, {
          id,
          room: p.channel_id,
          question: p.question,
          created_by: state.me.id,
          options: p.answers.map((a) => ({
            ...a,
            id: crypto.randomUUID(),
            votes: 0,
          })),
          multiple: p.multiple,
          ends_at: new Date(
            Date.now() + p.duration_hours * 3600000,
          ).toISOString(),
          mine: [],
          total: 0,
        });
        state.demoMessages.find((m) => m.id === result.id).poll_id = id;
        return { id };
      }
      if (op === "poll_data")
        return p.ids
          .map((id) => demoPolls.get(id))
          .filter(Boolean)
          .map((p) => ({
            ...structuredClone(p),
            ended: new Date(p.ends_at) <= Date.now(),
          }));
      if (op === "vote") {
        const poll = demoPolls.get(p.id);
        poll.mine = p.choices;
        poll.total = p.choices.length ? 1 : 0;
        poll.options.forEach(
          (o) => (o.votes = p.choices.includes(o.id) ? 1 : 0),
        );
        return {};
      }
      if (op === "close_poll") {
        demoPolls.get(p.id).ends_at = new Date().toISOString();
        return {};
      }
      throw Error("Unsupported preview action");
    }
    const checkResult = (r) => {
      if (r?.blocked || r?.slowmode)
        throw Error(r.message || "Please wait before sending.");
      return r;
    };
    function pollHTML(p) {
      const show = p.ended || p.mine.length > 0 || results.has(p.id),
        selected = choices.get(p.id) || p.mine;
      const remaining = Math.max(0, new Date(p.ends_at) - Date.now());
      const time = p.ended
        ? "Poll ended"
        : remaining < 3600000
          ? Math.ceil(remaining / 60000) + "m left"
          : Math.ceil(remaining / 3600000) + "h left";
      return `<section class="poll-card" aria-label="Poll: ${esc(p.question)}"><h3>${esc(p.question)}</h3><p class="poll-instruction">${p.multiple ? "Select one or more answers" : "Select one answer"}</p><div class="poll-answers">${p.options
        .map((o) => {
          const pct = p.total ? Math.round((o.votes / p.total) * 100) : 0;
          return show
            ? `<div class="poll-result ${p.mine.includes(o.id) ? "voted" : ""}"><span class="poll-result-bar" style="width:${pct}%"></span><span>${esc(o.emoji || "")} ${esc(o.text)}</span><small>${o.votes} ${o.votes === 1 ? "vote" : "votes"}</small><b>${pct}%</b>${p.mine.includes(o.id) ? '<span class="poll-check">✓</span>' : ""}</div>`
            : `<label class="poll-answer ${selected.includes(o.id) ? "selected" : ""}"><span>${esc(o.emoji || "")} ${esc(o.text)}</span><input type="${p.multiple ? "checkbox" : "radio"}" name="poll-${esc(p.id)}" value="${esc(o.id)}" data-poll-choice="${esc(p.id)}" ${selected.includes(o.id) ? "checked" : ""}></label>`;
        })
        .join(
          "",
        )}</div><footer><span>${p.total} ${p.total === 1 ? "vote" : "votes"} <span class="muted">· ${time}</span></span><div>${!p.ended ? (p.mine.length ? `<button class="secondary" data-poll-remove="${esc(p.id)}">Remove Vote</button>` : show ? `<button class="secondary" data-poll-back="${esc(p.id)}">Back to Vote</button>` : `<button class="text-button" data-poll-results="${esc(p.id)}">Show results</button><button class="primary" data-poll-vote="${esc(p.id)}" ${selected.length ? "" : "disabled"}>Vote</button>`) : ""}${!p.ended && (p.created_by === state.me.id || state.root) ? `<button class="icon-button" data-poll-close="${esc(p.id)}" title="End poll" aria-label="End poll">◷</button>` : ""}</div></footer></section>`;
    }
    function paintPoll(id) {
      const p = polls.get(id);
      if (!p) return;
      document
        .querySelectorAll(`[data-poll-id="${CSS.escape(id)}"]`)
        .forEach((el) => {
          el.innerHTML = pollHTML(p);
        });
    }
    async function loadPolls(room, ids, force = false) {
      ids = ids.filter(
        (id) => force || Date.now() - (pollFetched.get(id) || 0) > 30000,
      );
      if (!ids.length) return;
      const key = room + ids.join(",");
      if (pending.has(key)) return pending.get(key);
      const work = action("poll_data", { channel_id: room, ids })
        .then((rows) => {
          for (const p of rows) {
            polls.set(p.id, p);
            pollFetched.set(p.id, Date.now());
            paintPoll(p.id);
          }
        })
        .finally(() => pending.delete(key));
      pending.set(key, work);
      return work;
    }
    function decorate() {
      const groups = new Map();
      document.querySelectorAll("[data-poll-id]").forEach((el) => {
        const id = el.dataset.pollId,
          room = el.dataset.pollRoom;
        if (polls.has(id)) el.innerHTML = pollHTML(polls.get(id));
        if (!groups.has(room)) groups.set(room, new Set());
        groups.get(room).add(id);
      });
      for (const [room, ids] of groups) safe(() => loadPolls(room, [...ids]));
    }
    function messageExtra(m) {
      if (m.deleted) return "";
      if (m.poll_id)
        return `<div class="poll-slot" data-poll-id="${esc(m.poll_id)}" data-poll-room="${esc(m.room)}">${polls.has(m.poll_id) ? pollHTML(polls.get(m.poll_id)) : '<p class="muted">Loading poll…</p>'}</div>`;
      if (m.thread_id) {
        const t =
          threadInfo.get(m.thread_id) ||
          state.channels.find((c) => c.id === m.thread_id);
        return `<button class="thread-card" data-open-thread="${esc(m.thread_id)}"><span class="thread-card-icon">≋</span><span><b>${esc(t?.name || m.text)}</b><small>${t?.archived ? "Closed · " : ""}${t?.message_count ?? 0} messages <span>›</span></small></span></button>`;
      }
      return "";
    }
    function createPoll(room = state.room) {
      if (!room) return;
      modal(
        "Create a Poll",
        `<form id="pollForm"><label>Question<textarea id="pollQuestion" maxlength="300" required placeholder="What would you like to ask?"></textarea></label><div class="poll-counter"><span id="pollQuestionCount">0</span> / 300</div><h3>Answers</h3><div id="pollAnswerFields"></div><button class="secondary poll-add" type="button" id="addPollAnswer">＋ Add another answer</button><label>Duration<select name="duration" id="pollDuration">${[
          [0.5, "30 minutes"],
          [1, "1 hour"],
          [4, "4 hours"],
          [8, "8 hours"],
          [24, "24 hours"],
          [72, "3 days"],
          [168, "7 days"],
        ]
          .map(
            ([v, l]) =>
              `<option value="${v}" ${v === 24 ? "selected" : ""}>${l}</option>`,
          )
          .join(
            "",
          )}</select></label><div class="poll-form-footer"><label class="check-label"><input id="pollMultiple" type="checkbox"> Allow Multiple Answers</label><button class="primary" type="submit">Post</button></div><p id="pollError" role="alert" class="form-error"></p></form>`,
      );
      const add = () => {
        const count = $("pollAnswerFields").children.length;
        if (count >= 10) return;
        const row = document.createElement("div");
        row.className = "poll-answer-field";
        row.innerHTML =
          '<button class="poll-emoji icon-button" type="button" aria-label="Choose answer emoji">☺</button><input class="poll-option-text" maxlength="100" required placeholder="Answer" aria-label="Poll answer"><button class="icon-button poll-delete" type="button" aria-label="Remove answer">×</button>';
        row.querySelector(".poll-delete").onclick = () => {
          if ($("pollAnswerFields").children.length > 2) {
            row.remove();
            update();
          }
        };
        row.querySelector(".poll-emoji").onclick = (e) =>
          window.ChatUI.menu(
            e.currentTarget,
            [
              "✨",
              "👍",
              "👎",
              "❤️",
              "😂",
              "🎉",
              "🔥",
              "🤔",
              "✅",
              "❌",
              "None",
            ].map((emoji) => ({
              label: emoji,
              action: () => {
                row.dataset.emoji = emoji === "None" ? "" : emoji;
                row.querySelector(".poll-emoji").textContent =
                  emoji === "None" ? "☺" : emoji;
              },
            })),
          );
        $("pollAnswerFields").append(row);
        update();
      };
      const update = () => {
        const n = $("pollAnswerFields").children.length;
        $("addPollAnswer").disabled = n >= 10;
        $("pollAnswerFields")
          .querySelectorAll(".poll-delete")
          .forEach((b) => (b.disabled = n <= 2));
      };
      add();
      add();
      $("addPollAnswer").onclick = add;
      $("pollQuestion").oninput = () => {
        $("pollQuestionCount").textContent = $("pollQuestion").value.length;
      };
      $("pollForm").onsubmit = async (e) => {
        e.preventDefault();
        const button = e.submitter;
        button.disabled = true;
        try {
          checkResult(
            await action("create_poll", {
              channel_id: room,
              question: $("pollQuestion").value,
              answers: [...$("pollAnswerFields").children].map((row) => ({
                text: row.querySelector("input").value,
                emoji: row.dataset.emoji || "",
              })),
              duration_hours: Number($("pollDuration").value),
              multiple: $("pollMultiple").checked,
            }),
          );
          closeModal();
          await sync();
          if (active === room) await refreshPane(true);
          else api.scrollBottom();
        } catch (error) {
          $("pollError").textContent = error.message;
        } finally {
          button.disabled = false;
        }
      };
    }
    function createThread(replyTo = null) {
      const room = state.room;
      if (!room) return;
      modal(
        "Create a Thread",
        `<p class="muted">A focused conversation inside #${esc(state.channels.find((c) => c.id === room)?.name)}. Channel permissions apply here too.</p><form id="threadCreate"><label>Thread name<input name="name" maxlength="100" required placeholder="Give this conversation a name"></label><p id="threadCreateError" class="form-error" role="alert"></p><button class="primary">Create Thread</button></form>`,
      );
      $("threadCreate").onsubmit = async (e) => {
        e.preventDefault();
        const button = e.submitter;
        button.disabled = true;
        try {
          const result = checkResult(
            await action("create_thread", {
              channel_id: room,
              name: new FormData(e.target).get("name"),
              reply_to: replyTo,
            }),
          );
          closeModal();
          await refresh();
          await sync();
          await openThread(result.id);
          api.scrollBottom();
        } catch (error) {
          $("threadCreateError").textContent = error.message;
        } finally {
          button.disabled = false;
        }
      };
    }
    async function listThreads() {
      if (!state.room) return;
      const rows = await action("threads", { channel_id: state.room });
      rows.forEach((t) => threadInfo.set(t.id, t));
      modal(
        "Threads",
        `<p class="muted">Keep a conversation going without filling the channel.</p><button class="primary" id="newThreadFromList">＋ Create Thread</button><div class="thread-directory">${rows.length ? rows.map((t) => `<button class="thread-directory-item" data-open-thread="${esc(t.id)}"><span>≋</span><div><b>${esc(t.name)}</b><small>${t.archived ? "Closed" : "Active"} · ${t.message_count} messages</small></div><span>›</span></button>`).join("") : '<div class="empty-state">No threads yet. Start the first conversation.</div>'}</div>`,
      );
      $("newThreadFromList").onclick = () => createThread();
    }
    function closeThread() {
      active = null;
      request++;
      panel.hidden = true;
      panel.innerHTML = "";
      $("appView").classList.remove("thread-open");
    }
    async function openThread(id) {
      let t = state.channels.find((c) => c.id === id);
      if (!t) {
        await refresh();
        t = state.channels.find((c) => c.id === id);
      }
      if (!t || t.kind !== "thread") throw Error("Thread unavailable");
      if (state.room !== t.parent_id) await openChannel(t.parent_id);
      closeModal();
      active = id;
      threadCanSend = false;
      messages = [];
      older = !preview;
      reply = null;
      follow = true;
      panel.hidden = false;
      $("appView").classList.add("thread-open");
      panel.innerHTML = `<header class="thread-header"><span class="hash">≋</span><div><h2>${esc(t.name)}</h2><small>Thread in #${esc(state.channels.find((c) => c.id === t.parent_id)?.name)}</small></div><button id="threadOptions" class="icon-button" aria-label="Thread options">•••</button><button id="closeThread" class="icon-button" aria-label="Close thread panel">×</button></header><div id="threadMessages" class="thread-messages" role="log" aria-label="Thread messages"></div><div class="thread-compose-area"><div id="threadReply" hidden></div><p id="threadNotice" class="small-note" role="status"></p><form id="threadForm" class="composer"><button id="threadAdd" type="button" class="composer-tool" aria-label="Thread message options">＋</button><textarea id="threadText" rows="1" aria-label="Thread message" placeholder="Message ${esc(t.name)}"></textarea><span id="threadSlowmode" class="slowmode-status" hidden></span><button class="send-button" id="threadSend" aria-label="Send thread message">➤</button></form></div>`;
      $("closeThread").onclick = closeThread;
      $("threadOptions").onclick = (e) =>
        window.ChatUI.menu(e.currentTarget, [
          {
            label: t.archived ? "Reopen Thread" : "Close Thread",
            action: () =>
              safe(async () => {
                await action("archive_thread", {
                  id,
                  archived: !state.channels.find((c) => c.id === id)?.archived,
                });
                await refresh();
                await refreshPane();
              }),
          },
        ]);
      $("threadAdd").onclick = (e) =>
        window.ChatUI.menu(e.currentTarget, [
          { label: "Create Poll", action: () => createPoll(id) },
        ]);
      $("threadForm").onsubmit = (e) => {
        e.preventDefault();
        safe(sendThread);
      };
      $("threadText").onkeydown = (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          safe(sendThread);
        }
      };
      $("threadMessages").onscroll = () => {
        const el = $("threadMessages");
        follow = el.scrollHeight - el.clientHeight - el.scrollTop < 100;
      };
      await refreshPane(true);
      $("threadText").focus();
    }
    function renderThread(forceBottom = false) {
      const t = state.channels.find((c) => c.id === active);
      if (!t || !$("threadMessages")) return;
      const list = $("threadMessages"),
        old = list.scrollTop,
        stick = forceBottom || follow;
      list.innerHTML =
        `<div class="thread-welcome"><span>≋</span><h2>${esc(t.name)}</h2><p>Started by ${esc(profile(t.created_by).display_name)}</p></div>` +
        messages
          .filter((m) => !m.deleted)
          .map(
            (m) =>
              `<article class="thread-message"><button class="text-button" data-profile="${m.user_id}" aria-label="View ${esc(profile(m.user_id).display_name)} profile">${avatar(profile(m.user_id))}</button><div><button class="message-author" data-profile="${m.user_id}">${esc(profile(m.user_id).display_name)}</button><time>${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>${m.reply_to ? '<small class="thread-reply-label">↳ Reply</small>' : ""}<div class="body">${m.deleted ? '<i class="muted">Message deleted</i>' : m.poll_id ? "" : render(m.text, state.profiles, state.channels)}</div>${!m.deleted ? attachmentHTML(m) + (api.componentHTML?.(m) || "") + window.ChatCore.embeds(m.embeds || [], state.profiles, state.channels) + messageExtra(m) : ""}${!m.deleted ? `<div class="thread-message-actions"><button class="text-button" data-thread-reply="${esc(m.id)}">Reply</button>${m.user_id === state.me.id ? `<button class="text-button" data-thread-delete="${esc(m.id)}">Delete</button>` : ""}</div>` : ""}</div></article>`,
          )
          .join("");
      if (older && messages.length) {
        const more = document.createElement("button");
        more.className = "load-older";
        more.textContent = "Load earlier replies";
        more.onclick = () =>
          safe(async () => {
            const id = active,
              height = list.scrollHeight,
              top = list.scrollTop;
            more.disabled = true;
            const rows = await api.getMessages(id, messages[0]);
            if (active !== id) return;
            older = rows.length === 100;
            const map = new Map([...rows, ...messages].map((m) => [m.id, m]));
            messages = [...map.values()].sort(
              (a, b) =>
                a.created_at.localeCompare(b.created_at) ||
                a.id.localeCompare(b.id),
            );
            follow = false;
            renderThread();
            list.scrollTop = top + list.scrollHeight - height;
          });
        list.prepend(more);
      }
      list.scrollTop = stick ? list.scrollHeight : old;
      follow = stick;
      const muted =
        state.timeout && new Date(state.timeout.expires_at) > Date.now();
      $("threadText").disabled = !!t.archived || muted || !threadCanSend;
      $("threadSend").disabled =
        !!t.archived || sending || muted || !threadCanSend;
      $("threadAdd").disabled = !!t.archived || muted || !threadCanSend;
      $("threadNotice").textContent = muted
        ? "You are timed out. You can read this thread, but cannot reply."
        : t.archived
          ? "This thread is closed. Reopen it to continue."
          : !threadCanSend
            ? "You do not have permission to send messages in this channel."
            : "";
      $("threadForm").hidden = !threadCanSend || muted || !!t.archived;
      $("threadNotice").classList.toggle(
        "send-permission-notice",
        !threadCanSend && !muted && !t.archived,
      );
      decorate();
    }
    let threadCooldown = 0,
      older = !preview;
    async function refreshPane(forceBottom = false) {
      if (!active) return;
      const id = active,
        n = ++request;
      if (!state.channels.some((c) => c.id === id)) {
        closeThread();
        return;
      }
      const rows = await api.getMessages(id);
      if (id !== active || n !== request) return;
      if (!messages.length) older = !preview && rows.length === 100;
      const map = new Map(messages.map((m) => [m.id, m]));
      rows.forEach((m) => map.set(m.id, m));
      messages = [...map.values()].sort(
        (a, b) =>
          a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
      );
      renderThread(forceBottom);
      if (document.hasFocus()) {
        await rpc("read", { channel_id: id });
        state.mentions[id] = 0;
      }
      const status = await rpc("channel_status", { channel_id: id });
      if (id !== active) return;
      threadCanSend = status.can_send === true;
      renderThread(false);
      threadCooldown = status.bypass
        ? 0
        : Date.now() + Number(status.retry_after || 0) * 1000;
      const el = $("threadSlowmode");
      el.hidden = !status.seconds;
      el.dataset.seconds = String(status.seconds || 0);
      el.textContent = "◷ " + status.seconds + "s";
    }
    setInterval(() => {
      if (!active || !$("threadSlowmode")) return;
      const seconds = Math.max(
        0,
        Math.ceil((threadCooldown - Date.now()) / 1000),
      );
      const el = $("threadSlowmode");
      el.textContent = "◷ " + (seconds || el.dataset.seconds || 0) + "s";
      $("threadSend").disabled =
        sending ||
        !threadCanSend ||
        seconds > 0 ||
        !!state.channels.find((c) => c.id === active)?.archived ||
        !!(state.timeout && new Date(state.timeout.expires_at) > Date.now());
      const blocked =
        !threadCanSend ||
        !!state.channels.find((c) => c.id === active)?.archived ||
        !!(state.timeout && new Date(state.timeout.expires_at) > Date.now());
      $("threadText").disabled = blocked;
      $("threadAdd").disabled = blocked;
    }, 500);
    async function sendThread() {
      if (sending || !active || !threadCanSend) return;
      const id = active,
        text = $("threadText").value.trim();
      if (!text) return;
      sending = true;
      $("threadSend").disabled = true;
      try {
        const r = await rpc("send", { channel_id: id, text, reply_to: reply });
        if (id !== active) return;
        if (r.slowmode) threadCooldown = Date.now() + r.retry_after * 1000;
        checkResult(r);
        $("threadText").value = "";
        reply = null;
        $("threadReply").hidden = true;
        follow = true;
        await refreshPane(true);
        await sync();
      } catch (error) {
        if (id === active) $("threadNotice").textContent = error.message;
        else toast(error.message, true);
      } finally {
        sending = false;
      }
    }
    function composerMenu(anchor) {
      window.ChatUI.menu(anchor, [
        { label: "↥  Upload a File", action: () => $("attachment").click() },
        {
          label: "≋  Create Thread",
          disabled:
            !state.room ||
            state.channels.find((c) => c.id === state.room)?.kind === "dm",
          action: () => createThread(),
        },
        {
          label: "▤  Create Poll",
          disabled: !state.room,
          action: () => createPoll(),
        },
        {
          label: "✦  Use Apps",
          action: () =>
            modal(
              "Apps",
              `<p class="muted">Mention a bot or use its commands in your conversation.</p>${
                state.profiles
                  .filter((p) => p.is_bot)
                  .map(
                    (p) =>
                      `<button class="member-row" data-profile="${p.id}">${avatar(p)}<b>${esc(p.display_name)}</b><span class="bot-label">APP</span></button>`,
                  )
                  .join("") ||
                '<div class="empty-state">No bots have been added yet.</div>'
              }`,
            ),
        },
      ]);
    }
    document.addEventListener("change", (e) => {
      const id = e.target.dataset.pollChoice;
      if (!id) return;
      const p = polls.get(id);
      if (!p) return;
      let next = choices.get(id) || [...p.mine];
      next = p.multiple
        ? e.target.checked
          ? [...new Set([...next, e.target.value])]
          : next.filter((v) => v !== e.target.value)
        : [e.target.value];
      choices.set(id, next);
      paintPoll(id);
    });
    document.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      safe(async () => {
        if (b.dataset.openThread) await openThread(b.dataset.openThread);
        if (b.dataset.createThread) createThread(b.dataset.createThread);
        if (b.dataset.pollResults) {
          results.add(b.dataset.pollResults);
          paintPoll(b.dataset.pollResults);
        }
        if (b.dataset.pollBack) {
          results.delete(b.dataset.pollBack);
          paintPoll(b.dataset.pollBack);
        }
        const id =
          b.dataset.pollVote || b.dataset.pollRemove || b.dataset.pollClose;
        if (id) {
          b.disabled = true;
          try {
            await action(b.dataset.pollClose ? "close_poll" : "vote", {
              id,
              choices: b.dataset.pollRemove ? [] : choices.get(id) || [],
            });
            choices.delete(id);
            results.delete(id);
            const room = b.closest("[data-poll-room]").dataset.pollRoom;
            await loadPolls(room, [id], true);
          } finally {
            b.disabled = false;
          }
        }
        if (b.dataset.threadReply) {
          reply = b.dataset.threadReply;
          $("threadReply").hidden = false;
          $("threadReply").innerHTML =
            `<span>Replying to ${esc(profile(messages.find((m) => m.id === reply)?.user_id).display_name)}</span><button class="text-button" id="cancelThreadReply">×</button>`;
          $("cancelThreadReply").onclick = () => {
            reply = null;
            $("threadReply").hidden = true;
          };
          $("threadText").focus();
        }
        if (b.dataset.threadDelete) {
          await rpc("delete_message", { id: b.dataset.threadDelete });
          await refreshPane();
        }
      });
    });
    async function refreshThreads() {
      if (
        !state.room ||
        state.channels.find((c) => c.id === state.room)?.kind === "dm"
      )
        return;
      const rows = await action("threads", { channel_id: state.room });
      rows.forEach((t) => threadInfo.set(t.id, t));
      document.querySelectorAll(".thread-card").forEach((el) => {
        const t = threadInfo.get(el.dataset.openThread);
        if (t) {
          const small = el.querySelector("small");
          if (small)
            small.textContent =
              (t.archived ? "Closed · " : "") + t.message_count + " messages ›";
        }
      });
    }
    function onChannel() {
      if (
        active &&
        state.channels.find((c) => c.id === active)?.parent_id !== state.room
      )
        closeThread();
      threadButton.hidden =
        !state.room ||
        state.channels.find((c) => c.id === state.room)?.kind === "dm";
      safe(refreshThreads);
    }
    return {
      onRealtime: async (payload) => {
        if (payload.table === "cb_poll_votes" || payload.table === "cb_polls") {
          pollFetched.clear();
          decorate();
        }
        if (payload.table === "cb_messages") {
          const room = payload.new?.room;
          if (room === active) await refreshPane();
          const parent = state.channels.find((c) => c.id === room)?.parent_id;
          if (parent === state.room || payload.new?.thread_id)
            await refreshThreads();
        }
      },
      messageExtra,
      decorate,
      composerMenu,
      createThread,
      openThread,
      closeThread,
      onChannel,
      refresh: async () => {
        await refreshThreads();
        await refreshPane();
      },
    };
  };
})();

/* Device-local sessions only. Passwords and bot tokens never enter this store. */
(() => {
  window.ChatAccounts = ({ client, config, modal, closeModal, esc, toast }) => {
    const key = "chatbox-accounts-v1:" + new URL(config.supabaseUrl).hostname;
    let activeId;
    const read = () => {
      try {
        const rows = JSON.parse(localStorage.getItem(key) || "[]");
        return Array.isArray(rows)
          ? rows.filter((x) => x.id && x.access_token && x.refresh_token)
          : [];
      } catch {
        return [];
      }
    };
    const write = (rows) => {
      try {
        localStorage.setItem(key, JSON.stringify(rows));
      } catch {
        throw Error(
          "This device could not save the account session. Check browser storage settings.",
        );
      }
    };
    function remember(session) {
      if (!session?.user?.id || !session.access_token || !session.refresh_token)
        return;
      activeId = session.user.id;
      const rows = read(),
        entry = {
          id: session.user.id,
          email: session.user.email || "",
          name:
            session.user.user_metadata?.display_name ||
            session.user.email?.split("@")[0] ||
            "Account",
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_at: session.expires_at,
        };
      const index = rows.findIndex((x) => x.id === entry.id);
      if (index >= 0) rows[index] = entry;
      else rows.push(entry);
      write(rows);
    }
    function forget(id) {
      write(read().filter((x) => x.id !== id));
    }
    client.auth.onAuthStateChange((event, session) => {
      try {
        if (
          [
            "SIGNED_IN",
            "TOKEN_REFRESHED",
            "INITIAL_SESSION",
            "USER_UPDATED",
          ].includes(event)
        )
          remember(session);
        if (event === "SIGNED_OUT" && activeId) {
          forget(activeId);
          activeId = null;
        }
      } catch (e) {
        toast(e.message, true);
      }
    });
    async function activate(entry) {
      const result = await client.auth.setSession({
        access_token: entry.access_token,
        refresh_token: entry.refresh_token,
      });
      if (result.error) {
        forget(entry.id);
        throw Error(
          "This saved session expired. Add the account again to sign in.",
        );
      }
      remember(result.data.session);
      // Reload clears every account-specific subscription, in-flight request and cache.
      location.reload();
    }
    async function show() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      remember(data.session);
      const current = data.session?.user?.id,
        rows = read();
      modal(
        "Switch accounts",
        `<p class="muted">Your signed-in accounts on this device.</p><div class="account-switch-list">${rows.map((x) => `<div class="account-switch-row"><button class="text-button" data-switch-account="${esc(x.id)}" ${x.id === current ? "disabled" : ""}><b>${esc(x.name)}</b><small>${esc(x.email.replace(/^(.).*(@.*)$/, "$1••••$2"))}</small></button>${x.id === current ? '<span class="status-pill">Active</span>' : `<button class="secondary" data-forget-account="${esc(x.id)}" aria-label="Remove ${esc(x.name)} from this device">${window.ChatIcons("close")}</button>`}</div>`).join("")}</div><button class="primary" id="addChatAccount">Add an account</button><p class="small-note">Use this on a trusted device. Saved sessions let anyone using this browser switch accounts. Passwords are never saved by CHATBOX.</p>`,
      );
      document.querySelectorAll("[data-switch-account]").forEach(
        (button) =>
          (button.onclick = async () => {
            button.disabled = true;
            try {
              await activate(
                rows.find((x) => x.id === button.dataset.switchAccount),
              );
            } catch (e) {
              toast(e.message, true);
              await show();
            }
          }),
      );
      document.querySelectorAll("[data-forget-account]").forEach(
        (button) =>
          (button.onclick = () => {
            forget(button.dataset.forgetAccount);
            show().catch((e) => toast(e.message, true));
          }),
      );
      document.getElementById("addChatAccount").onclick = add;
    }
    function add() {
      modal(
        "Add an account",
        '<p class="muted">Sign in to another CHATBOX account.</p><form id="addChatAccountForm"><label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><p id="addChatAccountError" class="error" role="alert"></p><div class="toolbar-row"><button type="button" class="secondary" id="cancelAddAccount">Back</button><button class="primary" type="submit">Continue</button></div></form>',
      );
      document.getElementById("cancelAddAccount").onclick = () =>
        show().catch((e) => toast(e.message, true));
      document.getElementById("addChatAccountForm").onsubmit = async (e) => {
        e.preventDefault();
        const form = e.currentTarget,
          button = form.querySelector("[type=submit]"),
          errorNode = document.getElementById("addChatAccountError");
        button.disabled = true;
        errorNode.textContent = "";
        const temporary = window.supabase.createClient(
          config.supabaseUrl,
          config.publishableKey,
          {
            auth: {
              persistSession: false,
              autoRefreshToken: false,
              detectSessionInUrl: false,
              storageKey: "chatbox-add-account",
            },
          },
        );
        try {
          const current = await client.auth.getSession();
          if (current.error) throw current.error;
          remember(current.data.session);
          const captchaToken = await window.ChatCaptcha.request(
            "Verify to add an account",
          );
          const result = await temporary.auth.signInWithPassword({
            email: form.elements.email.value.trim(),
            password: form.elements.password.value,
            options: { captchaToken },
          });
          if (result.error) throw result.error;
          form.elements.password.value = "";
          await activate(result.data.session);
        } catch (error) {
          errorNode.textContent = error.message;
        } finally {
          button.disabled = false;
          temporary.auth.stopAutoRefresh();
        }
      };
    }
    return { show, remember, forget, add };
  };
})();

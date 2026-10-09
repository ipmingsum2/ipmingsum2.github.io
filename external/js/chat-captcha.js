/* Tokens are single-use; only Supabase Auth or the server verifies them. */
(() => {
  const sitekey = "0d2e5bd6-b20c-4fa0-a824-abb2f40e9eb8";
  let loading, active;
  function styles() {
    if (document.getElementById("chatboxCaptchaStyle")) return;
    const style = document.createElement("style");
    style.id = "chatboxCaptchaStyle";
    style.textContent = `
      .captcha-overlay{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;padding:12px;overflow:auto;background:#000a;backdrop-filter:blur(5px);font:15px/1.5 var(--font,system-ui,sans-serif);color:#f2f3f5;box-sizing:border-box}
      .captcha-card{position:relative;box-sizing:border-box;width:min(500px,100%);padding:34px 32px 40px;background:linear-gradient(155deg,#30345d 0%,#242429 45%);border:1px solid #ffffff12;border-radius:16px;box-shadow:0 24px 90px #0007;text-align:center;animation:captcha-in .2s ease-out}
      .captcha-close{position:absolute;right:16px;top:12px;border:0!important;border-radius:6px;background:transparent!important;color:#f2f3f5!important;font:30px/1 system-ui;width:36px!important;height:36px;padding:0!important;cursor:pointer}
      .captcha-close:hover{background:#ffffff12!important}.captcha-close:focus-visible{outline:2px solid #a8afff;outline-offset:3px}
      .captcha-art{display:block;width:230px;max-width:80%;height:150px;margin:18px auto 28px}
      .captcha-context{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#b6b8cc;margin:0 0 8px}
      .captcha-card h2{color:#f2f3f5!important;font-size:27px;line-height:1.2;margin:0 0 12px;font-weight:750;letter-spacing:-.025em}
      .captcha-note{color:#b5b6be;font-size:17px;margin:0 0 28px;line-height:1.5}
      .captcha-widget{display:flex;justify-content:center;min-height:78px}.captcha-widget iframe{border:0}
      .captcha-overlay.is-challenging .captcha-card{visibility:hidden;pointer-events:none}
      @keyframes captcha-in{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
      @media(max-width:390px){.captcha-card{padding:28px 18px}.captcha-art{height:115px;margin:10px auto 20px}.captcha-card h2{font-size:24px}}
      @media(prefers-reduced-motion:reduce){.captcha-card{animation:none}.captcha-overlay{backdrop-filter:none}}
    `;
    document.head.append(style);
  }
  function load() {
    if (window.hcaptcha) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      let timer;
      window.chatboxCaptchaReady = () => {
        clearTimeout(timer);
        resolve();
      };
      script.src =
        "https://js.hcaptcha.com/1/api.js?onload=chatboxCaptchaReady&render=explicit";
      script.async = true;
      script.onerror = () => {
        clearTimeout(timer);
        loading = null;
        script.remove();
        reject(
          Error(
            "Could not load verification. Check your connection and try again.",
          ),
        );
      };
      timer = setTimeout(script.onerror, 20000);
      document.head.append(script);
    });
    return loading;
  }
  window.ChatCaptcha = {
    async request(label = "Verify to continue") {
      if (active) throw Error("Finish the current verification first.");
      active = true;
      try {
        await load();
        return await new Promise((resolve, reject) => {
          styles();
          // Native top-layer dialogs cover the provider's body-level challenge.
          // Suspend them without destroying their forms, then restore on cleanup.
          const previousFocus = document.activeElement;
          const suspended = [...document.querySelectorAll("dialog[open]")];
          for (const parent of suspended) parent.close();
          const background = [...document.body.children].filter(
            (element) =>
              !["SCRIPT", "STYLE", "LINK"].includes(element.tagName) &&
              !element.querySelector('iframe[src*="hcaptcha.com"]') &&
              !element.matches('iframe[src*="hcaptcha.com"]'),
          );
          const inertStates = background.map((element) => [
            element,
            element.inert,
          ]);
          for (const element of background) element.inert = true;
          const overlay = document.createElement("div");
          overlay.className = "captcha-overlay";
          const dialog = document.createElement("section");
          dialog.className = "captcha-card";
          dialog.setAttribute("role", "dialog");
          dialog.setAttribute("aria-modal", "true");
          const art = document.createElement("div");
          art.innerHTML = `<svg class="captcha-art" viewBox="0 0 260 165" aria-hidden="true"><defs><linearGradient id="captchaLens" x2="1" y2="1"><stop stop-color="#bca1ff"/><stop offset="1" stop-color="#5865f2"/></linearGradient></defs><ellipse cx="132" cy="146" rx="106" ry="8" fill="#17171d"/><path d="M41 126 58 70Q63 51 82 53L159 57Q181 59 186 77L200 126Q177 145 115 144Q63 143 41 126" fill="#5865f2"/><path d="m56 53 68-8 73 11 39 50-8 32" fill="none" stroke="#a56cff" stroke-width="11" stroke-linejoin="round"/><path d="M49 49q-6 21 2 45 6 14 33 7 22-6 26-44L49 49Zm85 7q-5 34 12 43 28 15 39-5 10-16 8-36l-59-2Z" fill="url(#captchaLens)" stroke="#bf8cff" stroke-width="7"/><path d="m62 53 29 2-36 36Zm84 6 32 1-34 34" fill="#e7d9ff" opacity=".6"/><path d="M109 62q8-16 17 4l18 44q-16 17-38 0Z" fill="#f075c7"/><ellipse cx="126" cy="111" rx="24" ry="12" fill="#bd47b8"/><path d="M91 122q14 15 32 5 13 9 27-3" fill="none" stroke="#252641" stroke-width="7" stroke-linecap="round"/><path d="m33 35 3-9 3 9 9 3-9 3-3 9-3-9-9-3Zm174 6 2-6 2 6 6 2-6 2-2 6-2-6-6-2Z" fill="#c9b5ff"/></svg>`;
          const heading = document.createElement("h2"),
            note = document.createElement("p"),
            widget = document.createElement("div"),
            cancel = document.createElement("button");
          heading.textContent = "Wait! Are you human?";
          heading.id = "captchaTitle";
          dialog.setAttribute("aria-labelledby", heading.id);
          const context = document.createElement("p");
          context.className = "captcha-context";
          context.textContent = label;
          note.className = "captcha-note";
          note.id = "captchaDescription";
          dialog.setAttribute("aria-describedby", note.id);
          note.textContent = "Please confirm you’re not a robot.";
          widget.className = "captcha-widget";
          cancel.type = "button";
          cancel.textContent = "×";
          cancel.className = "captcha-close";
          cancel.setAttribute("aria-label", "Cancel verification");
          dialog.append(cancel, art, context, heading, note, widget);
          overlay.append(dialog);
          document.body.append(overlay);
          cancel.focus();
          let id,
            done = false;
          const finish = (token, error) => {
            if (done) return;
            done = true;
            document.removeEventListener("keydown", escape);
            if (id !== undefined) window.hcaptcha.remove(id);
            overlay.remove();
            for (const [element, inert] of inertStates) element.inert = inert;
            for (const parent of suspended)
              if (parent.isConnected && !parent.open) parent.showModal();
            if (previousFocus?.isConnected) previousFocus.focus();
            error ? reject(Error(error)) : resolve(token);
          };
          cancel.onclick = () => finish(null, "Verification cancelled.");
          const escape = (e) => {
            if (
              e.key === "Escape" &&
              !overlay.classList.contains("is-challenging")
            ) {
              e.preventDefault();
              finish(null, "Verification cancelled.");
            }
          };
          document.addEventListener("keydown", escape);
          try {
            id = window.hcaptcha.render(widget, {
              sitekey,
              size: window.innerWidth < 390 ? "compact" : "normal",
              theme:
                document.documentElement.dataset.theme === "light" ||
                document.body.classList.contains("light")
                  ? "light"
                  : "dark",
              callback: (token) => finish(token),
              "open-callback": () => overlay.classList.add("is-challenging"),
              "close-callback": () =>
                overlay.classList.remove("is-challenging"),
              "chalexpired-callback": () => {
                overlay.classList.remove("is-challenging");
                note.textContent = "The challenge expired. Please try again.";
              },
              "expired-callback": () => {
                note.textContent = "Verification expired. Please try again.";
                window.hcaptcha.reset(id);
              },
              "error-callback": () =>
                finish(
                  null,
                  "Verification could not complete. Please try again.",
                ),
            });
          } catch {
            finish(null, "Verification could not start. Please refresh.");
          }
        });
      } finally {
        active = false;
      }
    },
  };
})();

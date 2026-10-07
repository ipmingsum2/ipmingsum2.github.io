/* Tokens are single-use; only Supabase Auth or the server verifies them. */
(() => {
  const sitekey = "0d2e5bd6-b20c-4fa0-a824-abb2f40e9eb8";
  let loading, active;
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
          const dialog = document.createElement("dialog");
          dialog.className = "captcha-dialog";
          dialog.style.cssText =
            "color-scheme:dark;background:#23242c;color:#f2f3f5;border:1px solid #454754;border-radius:12px;padding:24px;max-width:calc(100vw - 24px);font:15px system-ui;";
          const heading = document.createElement("h2"),
            note = document.createElement("p"),
            widget = document.createElement("div"),
            cancel = document.createElement("button");
          heading.textContent = label;
          heading.id = "captchaTitle";
          dialog.setAttribute("aria-labelledby", heading.id);
          note.textContent = "Complete hCaptcha below to continue.";
          cancel.type = "button";
          cancel.textContent = "Cancel";
          cancel.style.cssText =
            "margin-top:18px;padding:9px 18px;border:0;border-radius:6px;background:#4e5058;color:white;cursor:pointer;";
          dialog.append(heading, note, widget, cancel);
          document.body.append(dialog);
          dialog.showModal();
          let id,
            done = false;
          const finish = (token, error) => {
            if (done) return;
            done = true;
            if (id !== undefined) window.hcaptcha.remove(id);
            dialog.close();
            dialog.remove();
            error ? reject(Error(error)) : resolve(token);
          };
          cancel.onclick = () => finish(null, "Verification cancelled.");
          dialog.addEventListener("cancel", (e) => {
            e.preventDefault();
            finish(null, "Verification cancelled.");
          });
          try {
            id = window.hcaptcha.render(widget, {
              sitekey,
              theme:
                document.documentElement.dataset.theme === "light" ||
                document.body.classList.contains("light")
                  ? "light"
                  : "dark",
              callback: (token) => finish(token),
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

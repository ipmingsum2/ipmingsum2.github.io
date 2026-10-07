/* Verification applies to every network, including VPNs. Public static files are not an authorization boundary. */
(() => {
  const start = Date.parse("2026-10-20T00:00:00+08:00");
  if (Date.now() < start || location.hostname !== "ipmingsum2.github.io")
    return;
  if (
    /^\/external\/(chat(?:-backup|-beta|-legacy|beta)?|register)\.html$/.test(
      location.pathname,
    )
  )
    return;
  async function run() {
    if (!window.ChatCaptcha) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "/external/js/chat-captcha.js";
        script.onload = resolve;
        script.onerror = reject;
        document.head.append(script);
      });
    }
    const token = await window.ChatCaptcha.request("Verify to visit this site");
    const response = await fetch(
      "https://lflkpziiwnoamvtrbcil.supabase.co/functions/v1/chat-api",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify_visitor", captchaToken: token }),
      },
    );
    if (!response.ok || (await response.json()).verified !== true)
      throw Error("Verification failed.");
  }
  function show() {
    const cover = document.createElement("div");
    cover.style.cssText =
      "position:fixed;inset:0;z-index:2147483646;background:#17181f;color:#f2f3f5;display:grid;place-content:center;text-align:center;font:16px system-ui;padding:24px;";
    const title = document.createElement("h1"),
      note = document.createElement("p"),
      retry = document.createElement("button");
    title.textContent = "Verify to continue";
    note.textContent =
      "Verification is required on all networks, including VPNs.";
    retry.textContent = "Verify";
    retry.style.cssText =
      "padding:12px 20px;background:#5865f2;color:white;border:0;border-radius:8px;cursor:pointer;";
    cover.append(title, note, retry);
    document.body.append(cover);
    retry.onclick = async () => {
      retry.disabled = true;
      try {
        await run();
        cover.remove();
      } catch {
        note.textContent = "Verification did not complete. Please try again.";
      } finally {
        retry.disabled = false;
      }
    };
  }
  if (document.body) show();
  else document.addEventListener("DOMContentLoaded", show, { once: true });
})();

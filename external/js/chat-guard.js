/* A convenience override for this browser tab, not an authorization boundary. */
(() => {
  if (location.hostname !== "ipmingsum2.github.io") return;
  const eventName = "chatbox:vpn-bypass:7b36a92e";
  const expectedHash =
    "b7ba967e962c417a902c87af30e8be2cbac65bab3a2cbb13fbee95e122d29d73";
  const deadline = performance.now() + 10000;
  let bypass = false;
  try {
    bypass = sessionStorage.getItem(eventName) === "1";
  } catch {}
  const cancel = async (event) => {
    if (performance.now() >= deadline) return;
    if (typeof event.detail !== "string" || event.detail.length !== 64) return;
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(event.detail),
    );
    const hash = Array.from(new Uint8Array(digest), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("");
    if (hash !== expectedHash || performance.now() >= deadline) return;
    bypass = true;
    try {
      sessionStorage.setItem(eventName, "1");
    } catch {}
    console.info("CHATBOX: VPN script skipped for this tab session.");
  };
  window.addEventListener(eventName, cancel);
  setTimeout(() => {
    window.removeEventListener(eventName, cancel);
    if (bypass) return;
    const script = document.createElement("script");
    script.src = "/external/js/anti-vpn.js";
    script.async = true;
    document.head.append(script);
  }, 10000);
})();

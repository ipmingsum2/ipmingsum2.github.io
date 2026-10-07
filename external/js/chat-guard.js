/* Hong Kong launch: 20 October 2026. No browser-console bypass. */
(() => {
  if (location.hostname !== "ipmingsum2.github.io") return;
  const start = Date.parse("2026-10-20T00:00:00+08:00");
  function launch() {
    if (Date.now() < start) {
      setTimeout(launch, Math.min(start - Date.now(), 3600000));
      return;
    }
    const script = document.createElement("script");
    script.src = "/external/js/anti-vpn.js";
    script.async = true;
    document.head.append(script);
  }
  launch();
})();

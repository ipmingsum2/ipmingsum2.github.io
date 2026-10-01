/* Shared custom controls: real form values with keyboard-accessible custom menus. */
(() => {
  const opened = [],
    selects = new WeakMap();
  let sequence = 0;
  function floating(element, anchor, onClose = () => {}) {
    element.classList.add("floating-surface");
    element.setAttribute("popover", "manual");
    (anchor?.closest("dialog[open]") || document.body).append(element);
    if (element.showPopover) element.showPopover();
    const place = () => {
      if (!anchor?.isConnected) return close();
      const a = anchor.getBoundingClientRect(),
        r = element.getBoundingClientRect();
      const dropdown = element.matches(".select-options,.action-menu");
      const left = Math.min(
        Math.max(
          8,
          dropdown
            ? a.left
            : a.right + r.width < innerWidth
              ? a.right + 8
              : a.left - r.width - 8,
        ),
        Math.max(8, innerWidth - r.width - 8),
      );
      element.style.left = left + "px";
      element.style.top =
        Math.max(
          8,
          Math.min(
            dropdown
              ? a.bottom + r.height + 8 < innerHeight
                ? a.bottom + 6
                : a.top - r.height - 6
              : a.top,
            innerHeight - r.height - 8,
          ),
        ) + "px";
    };
    const entry = { element, anchor, close };
    function close(restore = false) {
      const index = opened.indexOf(entry);
      if (index < 0) return;
      opened.splice(index, 1);
      if (element.hidePopover && element.matches(":popover-open"))
        element.hidePopover();
      element.remove();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      onClose();
      if (restore && anchor.isConnected) anchor.focus();
    }
    opened.push(entry);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    place();
    return { close, place, element };
  }
  document.addEventListener(
    "pointerdown",
    (e) => {
      const entry = opened.at(-1);
      if (
        entry &&
        !entry.element.contains(e.target) &&
        !entry.anchor.contains(e.target)
      )
        entry.close();
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && opened.length) {
        e.preventDefault();
        e.stopImmediatePropagation();
        opened.at(-1).close(true);
      }
    },
    true,
  );
  function menu(anchor, items) {
    const el = document.createElement("div");
    el.className = "action-menu";
    el.setAttribute("role", "menu");
    const popup = floating(el, anchor);
    for (const item of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.textContent = item.label;
      b.disabled = !!item.disabled;
      b.onclick = () => {
        popup.close();
        item.action();
      };
      el.append(b);
    }
    const buttons = [...el.querySelectorAll("button:not(:disabled)")];
    el.addEventListener("keydown", (e) => {
      const i = buttons.indexOf(document.activeElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        buttons[
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? buttons.length - 1
              : (i + (e.key === "ArrowUp" ? -1 : 1) + buttons.length) %
                buttons.length
        ]?.focus();
      }
    });
    popup.place();
    buttons[0]?.focus();
    return popup;
  }
  function enhanceSelect(s) {
    let ui = selects.get(s);
    if (!ui) {
      const label =
        s.getAttribute("aria-label") ||
        s.labels?.[0]?.childNodes[0]?.textContent?.trim() ||
        s.name ||
        "Choose an option";
      const b = document.createElement("button");
      b.type = "button";
      b.className = "custom-select";
      b.setAttribute("role", "combobox");
      b.setAttribute("aria-label", label);
      b.setAttribute("aria-haspopup", "listbox");
      b.setAttribute("aria-expanded", "false");
      s.hidden = true;
      s.after(b);
      ui = { button: b, popup: null };
      selects.set(s, ui);
      const choose = () => {
        if (ui.popup) {
          ui.popup.close();
          return;
        }
        const list = document.createElement("div");
        list.className = "select-options";
        list.id = "select-options-" + ++sequence;
        list.setAttribute("role", "listbox");
        list.setAttribute("aria-label", label);
        list.style.minWidth =
          Math.min(b.getBoundingClientRect().width, innerWidth - 16) + "px";
        const buttons = [];
        for (const option of s.options) {
          const row = document.createElement("button");
          row.type = "button";
          row.tabIndex = -1;
          row.setAttribute("role", "option");
          row.setAttribute("aria-selected", String(option.selected));
          row.textContent = option.textContent;
          row.disabled = option.disabled;
          row.onclick = () => {
            s.value = option.value;
            s.dispatchEvent(new Event("change", { bubbles: true }));
            ui.popup?.close(true);
            update();
          };
          list.append(row);
          if (!row.disabled) buttons.push(row);
        }
        ui.popup = floating(list, b, () => {
          ui.popup = null;
          b.setAttribute("aria-expanded", "false");
          b.removeAttribute("aria-controls");
        });
        b.setAttribute("aria-expanded", "true");
        b.setAttribute("aria-controls", list.id);
        let typed = "",
          last = 0;
        list.onkeydown = (e) => {
          let i = buttons.indexOf(document.activeElement);
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
            e.preventDefault();
            i =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? buttons.length - 1
                  : (i + (e.key === "ArrowUp" ? -1 : 1) + buttons.length) %
                    buttons.length;
            buttons[i]?.focus();
          } else if (e.key === "Tab") ui.popup?.close();
          else if (e.key.length === 1 && e.key !== " ") {
            typed = Date.now() - last > 700 ? e.key : typed + e.key;
            last = Date.now();
            buttons
              .find((x) =>
                x.textContent.toLowerCase().startsWith(typed.toLowerCase()),
              )
              ?.focus();
          }
        };
        (
          buttons.find((x) => x.getAttribute("aria-selected") === "true") ||
          buttons[0]
        )?.focus();
      };
      b.onclick = choose;
      b.onkeydown = (e) => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          if (!ui.popup) choose();
        }
      };
      s.addEventListener("change", () => queueMicrotask(update));
      s.addEventListener("invalid", (e) => {
        e.preventDefault();
        b.focus();
        b.setAttribute("aria-invalid", "true");
      });
    }
    function update() {
      const text = s.selectedOptions[0]?.textContent || "Choose an option";
      if (ui.button.textContent !== text) ui.button.textContent = text;
      ui.button.disabled = s.disabled;
      if (s.validity.valid) ui.button.removeAttribute("aria-invalid");
    }
    update();
  }
  const observer = new MutationObserver(() => {
    if (!document?.body) return;
    for (const s of document.querySelectorAll("select")) enhanceSelect(s);
    for (const entry of [...opened])
      if (!entry.anchor.isConnected) entry.close();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll("select").forEach(enhanceSelect);
  window.ChatUI = {
    floating,
    menu,
    closeAll: () => [...opened].reverse().forEach((e) => e.close()),
  };
})();

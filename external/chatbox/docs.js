document.querySelectorAll(".copy").forEach(
  (button) =>
    (button.onclick = async () => {
      try {
        await navigator.clipboard.writeText(
          button.parentElement.nextElementSibling.textContent,
        );
        button.textContent = "Copied!";
        setTimeout(() => (button.textContent = "Copy"), 1500);
      } catch {
        button.textContent = "Select code to copy";
      }
    }),
);
const links = [...document.querySelectorAll("nav a")];
const observer = new IntersectionObserver(
  (entries) => {
    for (const e of entries)
      if (e.isIntersecting) {
        links.forEach((a) =>
          a.classList.toggle("active", a.hash === "#" + e.target.id),
        );
      }
  },
  { rootMargin: "-10% 0px -70% 0px" },
);
document
  .querySelectorAll("section[id]")
  .forEach((section) => observer.observe(section));

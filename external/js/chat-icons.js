/* Small, local SVG icon set; no icon-font or remote runtime required. */
window.ChatIcons = (() => {
  const paths = {
    settings:
      '<path d="m9 3-.6 2.2-2 .9L4.5 5.5 2 9.8l1.6 1.6v2.2L2 15.2l2.5 4.3 1.9-.6 2 .9L9 22h5l.6-2.2 2-.9 1.9.6 2.5-4.3-1.6-1.6v-2.2L21 9.8l-2.5-4.3-1.9.6-2-.9L14 3z"/><circle cx="11.5" cy="12.5" r="3.2"/>',
    members:
      '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/>',
    dm: '<path d="M21 11a8 8 0 0 1-8 8H8l-5 3V7a4 4 0 0 1 4-4h6a8 8 0 0 1 8 8Z"/><path d="M7 9h10M7 13h6"/>',
    announcement: '<path d="m4 9 15-5v16L4 15H2V9zM5 16l2 6h4l-2-5M22 9v6"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    smile:
      '<circle cx="12" cy="12" r="9"/><path d="M8 14a4 4 0 0 0 8 0M8 9h.01M16 9h.01"/>',
    send: '<path d="m3 3 19 9-19 9 4-9zM7 12h15"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',
    invite:
      '<circle cx="8" cy="8" r="3"/><path d="M2 21v-3a6 6 0 0 1 12 0v3M18 7v8M14 11h8"/>',
  };
  return (name) =>
    `<svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.plus}</svg>`;
})();

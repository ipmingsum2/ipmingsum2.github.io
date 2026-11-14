// Site text lives in Strings.json. Elements carry data-s="section.key" (their HTML) or
// data-s-attr="attr:key;attr:key" (attributes such as alt, aria-label or data-words). The HTML already contains the
// same text, so this only changes something when Strings.json was edited after the page was built — e.g. straight
// on GitHub. Scripts that need the text (intro.js) wait for window.STRINGS_READY.
'use strict';
(() => {
  const me = document.currentScript;
  const url = new URL('Strings.json', me ? me.src : location.href);
  const v = me && new URL(me.src).searchParams.get('v');
  if (v) url.searchParams.set('v', v);
  const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const apply = (all) => {
    document.querySelectorAll('[data-s]').forEach((el) => {
      const val = get(all, `${el.closest('[data-strings]')?.dataset.strings || 'tour'}.${el.dataset.s}`);
      if (typeof val === 'string' && el.innerHTML.trim() !== val) el.innerHTML = val;
    });
    document.querySelectorAll('[data-s-attr]').forEach((el) => {
      const page = el.closest('[data-strings]')?.dataset.strings || 'tour';
      for (const pair of el.dataset.sAttr.split(';')) {
        const i = pair.indexOf(':');
        const val = get(all, `${page}.${pair.slice(i + 1)}`);
        if (typeof val === 'string') {
          if (el.tagName === 'TITLE' || pair.slice(0, i) === 'text') el.textContent = val;
          else el.setAttribute(pair.slice(0, i), val);
        }
      }
    });
  };
  window.STRINGS = null;
  /** Looks up a string, e.g. S('tour.signin.openDashboard', 'Open dashboard'). */
  window.S = (path, fallback = '') => { const val = get(window.STRINGS, path); return typeof val === 'string' ? val : fallback; };
  const load = fetch(url, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const ready = new Promise((res) => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', res, { once: true }) : res()));
  // Never hold the page up for long: after 1.5 s carry on with the text already in the HTML.
  window.STRINGS_READY = Promise.race([Promise.all([load, ready]).then(([all]) => { if (all) { window.STRINGS = all; apply(all); } }), new Promise((res) => setTimeout(res, 1500))]);
})();

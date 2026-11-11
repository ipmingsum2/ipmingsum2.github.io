// Intro / feature tour: theme-aware screenshots, scroll-driven animation, sidebar with sign-in.
'use strict';
(() => {
  const SITE = 'ipmingsum2.github.io/roleplay-system/';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const signedIn = !!store.get('rp_token');

  // Icons are inline SVG from core.js.
  $$('[data-ic]').forEach((el) => { el.insertAdjacentHTML('afterbegin', icon(el.dataset.ic)); });

  // ---------- theme-aware screenshots ----------
  const shotSrc = (name) => `assets/screens/${name}-${currentTheme()}.webp`;
  const applyShots = () => $$('img[data-shot]').forEach((img) => { const s = shotSrc(img.dataset.shot); if (img.getAttribute('src') !== s) img.src = s; });
  document.addEventListener('rp:theme', applyShots);
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyShots);
  $('#themeSlot').innerHTML = themeButton();

  // ---------- scroll tours: one sticky frame, images cross-fade per step ----------
  const tourSets = $$('[data-tour]').map((tour) => {
    const steps = $$('.step', tour);
    const stack = $('.stack-imgs', tour);
    const url = $('.tour-media [data-url]', tour);
    const imgs = steps.map((st, i) => {
      const name = st.dataset.shotStep;
      const alt = `${$('h3', st).textContent} — screenshot`;
      stack.insertAdjacentHTML('beforeend', `<img data-shot="${name}" alt="${esc(alt)}" width="1440" height="900" ${i ? 'loading="lazy"' : ''}>`);
      // On phones the sticky frame is hidden and each step shows its own screenshot.
      st.insertAdjacentHTML('beforeend', `<figure class="frame step-shot"><img data-shot="${name}" alt="${esc(alt)}" width="1440" height="900" loading="lazy"></figure>`);
      return stack.lastElementChild;
    });
    const show = (i) => {
      steps.forEach((s, j) => s.classList.toggle('on', i === j));
      imgs.forEach((im, j) => im.classList.toggle('on', i === j));
      const u = steps[i].dataset.url || '';
      url.textContent = SITE + (u.startsWith('#') ? `app.html${u}` : u);
    };
    show(0);
    return { steps, show };
  });
  applyShots();

  // ---------- sidebar nav with scroll-spy ----------
  const sections = $$('[data-nav]');
  let num = 0;
  $('#inav').innerHTML = sections.map((s) => {
    const n = s.classList.contains('chapter') ? String(++num).padStart(2, '0') : '';
    return `<a href="#${s.id}" data-for="${s.id}">${icon(s.dataset.icon)}<span>${esc(s.dataset.nav)}</span>${n ? `<span class="n">${n}</span>` : ''}</a>`;
  }).join('');
  const navLinks = new Map($$('#inav a').map((a) => [a.dataset.for, a]));
  const setNav = (id) => navLinks.forEach((a, k) => { a.classList.toggle('on', k === id); if (k === id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
  const navIO = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) setNav(e.target.id); }), { rootMargin: '-45% 0px -54% 0px' });
  sections.forEach((s) => navIO.observe(s));
  setNav('top');

  // Step activation: whichever step crosses the middle of the viewport.
  const stepIO = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    for (const t of tourSets) { const i = t.steps.indexOf(e.target); if (i >= 0) t.show(i); }
  }), { rootMargin: '-48% 0px -48% 0px' });
  tourSets.forEach((t) => t.steps.forEach((s) => stepIO.observe(s)));

  // ---------- reveal on scroll ----------
  const revealIO = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add('in');
    revealIO.unobserve(e.target);
    $$('[data-count]', e.target).forEach(countUp);
    if (e.target.matches('[data-count]')) countUp(e.target);
  }), { rootMargin: '0px 0px -12% 0px' });
  $$('[data-anim]').forEach((el) => revealIO.observe(el));

  function countUp(el) {
    if (el.dataset.done) return;
    el.dataset.done = '1';
    const to = Number(el.dataset.count), suf = el.dataset.suffix || '';
    if (reduce.matches) { el.textContent = to + suf; return; }
    const t0 = performance.now(), dur = 1100;
    const tick = (t) => { const p = Math.min(1, (t - t0) / dur); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))) + suf; if (p < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  // ---------- scroll-linked: progress bar + hero tilt ----------
  const bar = $('#progress'), heroFrame = $('#heroFrame');
  let ticking = false;
  const onScroll = () => {
    ticking = false;
    const y = scrollY, max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
    if (!reduce.matches) heroFrame.style.setProperty('--t', Math.max(0, 1 - y / (innerHeight * 0.55)).toFixed(3));
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener('resize', onScroll);
  onScroll();

  // ---------- sign-in (sidebar + final section) ----------
  const google = `${API_URL}/auth/google/start`, discord = `${API_URL}/auth/discord/start`;
  if (signedIn) {
    $('#signinBody').innerHTML = `<a class="btn primary big" href="app.html">${icon('home')} Open dashboard</a>`;
    $('#miniSignin').innerHTML = `<a class="btn primary" href="app.html">${icon('home')} Open dashboard</a>`;
    $$('[data-signin-label]').forEach((a) => { a.textContent = 'Open dashboard'; a.href = 'app.html'; });
  } else {
    $('#signinBody').innerHTML = `<a class="btn big" href="${google}">${icon('google')} Continue with Google</a><a class="btn big" href="${discord}">${icon('discord')} Continue with Discord</a>`;
    $('#miniSignin').innerHTML = `<a class="btn primary" href="#signin">${icon('user')} Sign in</a><a class="btn ghost sm" href="${discord}">${icon('discord')} Discord</a><a class="btn ghost sm" href="${google}">${icon('google')} Google</a>`;
  }

  // ---------- mobile menu ----------
  const side = $('#side'), scrim = $('#scrim'), menuBtn = $('#menuBtn');
  const setMenu = (open) => { side.classList.toggle('open', open); scrim.hidden = !open; menuBtn.setAttribute('aria-expanded', open); };
  menuBtn.onclick = () => setMenu(!side.classList.contains('open'));
  scrim.onclick = () => setMenu(false);
  side.addEventListener('click', (e) => { if (e.target.closest('a[href^="#"]')) setMenu(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
})();

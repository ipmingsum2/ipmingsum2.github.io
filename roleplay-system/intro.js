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
  const applyShots = () => $$('img[data-shot]').forEach((img) => { const s = shotSrc(img.dataset.shot); if (img.getAttribute('src')?.split('?')[0] !== s) { img.dataset.tries = '0'; img.src = s; } });
  // A screenshot that fails (e.g. fetched mid-deploy, or a cached 404) retries twice with a cache-busting query.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.shot) return;
    const n = Number(img.dataset.tries || 0);
    if (n >= 2) return;
    img.dataset.tries = String(n + 1);
    setTimeout(() => { img.src = `${shotSrc(img.dataset.shot)}?r=${Date.now()}`; }, 600 * (n + 1));
  }, true);
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

// ---------- motion layer (all of it is skipped or static under prefers-reduced-motion) ----------
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const lerp = (a, b, t) => a + (b - a) * t;
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // Marquee: duplicate each track once so the loop is seamless.
  $$('[data-marquee]').forEach((t) => { if (!reduce) t.insertAdjacentHTML('beforeend', t.innerHTML.replace(/<span class="mchip"/g, '<span class="mchip" aria-hidden="true"')); });

  // Chapter numerals + staggered checklists.
  $$('.chapter').forEach((c, i) => c.insertAdjacentHTML('afterbegin', `<span class="bignum" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>`));
  $$('.ticks').forEach((ul) => [...ul.children].forEach((li, i) => li.style.setProperty('--i', i)));
  $$('.diagram .node').forEach((n, i) => n.style.setProperty('--i', i));

  // Rotating word in the headline.
  const rot = $('#rotator');
  if (rot) {
    const words = rot.dataset.words.split('|');
    let i = 0;
    const measure = (w) => { const s = document.createElement('span'); s.className = 'rw measure'; s.textContent = w; rot.append(s); const width = s.getBoundingClientRect().width; s.remove(); return Math.ceil(width) + 2; };
    const fit = () => { rot.style.width = `${measure(words[i])}px`; };
    fit(); addEventListener('resize', fit);
    if (!reduce) setInterval(() => {
      if (document.hidden) return;
      i = (i + 1) % words.length;
      const cur = $('.rw.on', rot), next = document.createElement('span');
      next.className = 'rw'; next.textContent = words[i]; rot.append(next);
      fit();
      requestAnimationFrame(() => requestAnimationFrame(() => { cur?.classList.replace('on', 'out'); next.classList.add('on'); }));
      setTimeout(() => cur?.remove(), 800);
    }, 2600);
  }

  // Hero: particle network that reacts to the pointer.
  const canvas = $('#heroCanvas'), hero = $('.hero');
  if (canvas && !reduce) {
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, dpr = 1, pts = [], color = '91,141,239', visible = true, raf = 0;
    const mouse = { x: -9999, y: -9999 };
    const readColor = () => {
      const probe = document.createElement('span'); probe.style.color = css('--accent') || '#5b8def'; document.body.append(probe);
      const m = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g); probe.remove();
      if (m) color = m.slice(0, 3).join(',');
    };
    const size = () => {
      const r = hero.getBoundingClientRect(); dpr = Math.min(2, devicePixelRatio || 1);
      W = r.width; H = r.height; canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(90, Math.max(28, (W * H) / 16000)));
      pts = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .35, vy: (Math.random() - .5) * .35, r: Math.random() * 1.6 + .6 }));
    };
    const frame = () => {
      raf = 0;
      if (!visible || document.hidden) return;
      ctx.clearRect(0, 0, W, H);
      const link = 130, link2 = link * link;
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < -20) p.x = W + 20; else if (p.x > W + 20) p.x = -20;
        if (p.y < -20) p.y = H + 20; else if (p.y > H + 20) p.y = -20;
        // gently pushed away from the pointer
        const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
        if (d2 < 140 * 140) { const f = (1 - Math.sqrt(d2) / 140) * .6; p.x += (dx / Math.sqrt(d2 || 1)) * f; p.y += (dy / Math.sqrt(d2 || 1)) * f; }
      }
      for (let a = 0; a < pts.length; a++) {
        const p = pts[a];
        for (let b = a + 1; b < pts.length; b++) {
          const q = pts[b], dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy;
          if (d2 < link2) { ctx.strokeStyle = `rgba(${color},${(1 - d2 / link2) * .22})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
        }
        const md = Math.hypot(p.x - mouse.x, p.y - mouse.y);
        if (md < 180) { ctx.strokeStyle = `rgba(${color},${(1 - md / 180) * .45})`; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke(); }
        ctx.fillStyle = `rgba(${color},.65)`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };
    const start = () => { if (!raf) raf = requestAnimationFrame(frame); };
    readColor(); size(); start();
    addEventListener('resize', () => { size(); start(); });
    document.addEventListener('rp:theme', () => setTimeout(readColor, 50));
    document.addEventListener('visibilitychange', start);
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; start(); }).observe(hero);
    hero.addEventListener('pointermove', (e) => { const r = hero.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; });
    hero.addEventListener('pointerleave', () => { mouse.x = mouse.y = -9999; });
  }

  // Hero frame: tilt toward the pointer with a moving glare; floating cards drift.
  const stage = $('#heroStage'), frameEl = $('#heroFrame');
  if (stage && frameEl && finePointer && !reduce) {
    const target = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
    let raf = 0;
    const tick = () => {
      cur.x = lerp(cur.x, target.x, .12); cur.y = lerp(cur.y, target.y, .12);
      frameEl.style.setProperty('--rx', `${cur.x * 7}deg`); frameEl.style.setProperty('--ry', `${-cur.y * 5}deg`);
      stage.style.setProperty('--px', cur.x.toFixed(3)); stage.style.setProperty('--py', cur.y.toFixed(3));
      raf = Math.abs(cur.x - target.x) + Math.abs(cur.y - target.y) > .001 ? requestAnimationFrame(tick) : 0;
    };
    hero.addEventListener('pointermove', (e) => {
      const r = stage.getBoundingClientRect();
      target.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      target.y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
      frameEl.style.setProperty('--gx', `${((e.clientX - r.left) / r.width) * 100}%`); frameEl.style.setProperty('--gy', `${((e.clientY - r.top) / r.height) * 100}%`);
      frameEl.style.setProperty('--go', '1');
      if (!raf) raf = requestAnimationFrame(tick);
    });
    hero.addEventListener('pointerleave', () => { target.x = target.y = 0; frameEl.style.setProperty('--go', '0'); if (!raf) raf = requestAnimationFrame(tick); });
  }

  // Scroll-linked drift for chapter numerals and layered screenshots (--p: -1 … 1 around the viewport centre).
  const chapters = $$('.chapter');
  let ticking = false;
  const drift = () => {
    ticking = false;
    const vh = innerHeight;
    for (const c of chapters) {
      const r = c.getBoundingClientRect();
      if (r.bottom < -vh || r.top > vh * 2) continue;
      const p = Math.max(-1, Math.min(1, (r.top + r.height / 2 - vh / 2) / vh));
      c.style.setProperty('--p', p.toFixed(3));
    }
  };
  if (!reduce) { addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(drift); } }, { passive: true }); drift(); }

  // Bento: spotlight follows the pointer.
  $$('.bcard').forEach((card) => card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`); card.style.setProperty('--my', `${e.clientY - r.top}px`);
  }));

  // Bento: mini heatmap.
  const mini = $('#miniHeat');
  if (mini) {
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    mini.innerHTML = Array.from({ length: 7 * 18 }, (_, i) => {
      const hour = i % 18, day = Math.floor(i / 18);
      const base = Math.max(0, Math.sin(((hour - 3) / 18) * Math.PI)) * (day >= 4 ? 1.25 : .9);
      const lvl = Math.min(4, Math.floor((base + rnd() * .5) * 3));
      return `<i class="h${lvl}" style="--dl:${(rnd() * 3.6).toFixed(2)}s"></i>`;
    }).join('');
  }

  // Bento: quick search types a few queries.
  const typed = $('.typed[data-type]');
  if (typed) {
    const words = typed.dataset.type.split('|');
    if (reduce) typed.textContent = words[0];
    else {
      let w = 0, n = 0, dir = 1;
      const step = () => {
        const word = words[w];
        n += dir; typed.textContent = word.slice(0, n);
        let wait = dir > 0 ? 90 : 45;
        if (dir > 0 && n >= word.length) { dir = -1; wait = 1400; } else if (dir < 0 && n <= 0) { dir = 1; w = (w + 1) % words.length; wait = 350; }
        setTimeout(step, wait);
      };
      step();
    }
  }

  // Discord demo: messages arrive one by one with a typing indicator, then the channel loops.
  const dc = $('#dcDemo');
  if (dc) {
    const msgs = $$('.dc-msg', dc), typing = $('.dc-typing', dc);
    if (!reduce) {
      let started = false, timer = 0;
      const play = () => {
        msgs.forEach((m) => { m.classList.add('wait'); m.classList.remove('pop'); });
        let k = 0;
        const next = () => {
          if (k >= msgs.length) { typing.classList.remove('on'); timer = setTimeout(play, 5200); return; }
          typing.classList.add('on');
          timer = setTimeout(() => { typing.classList.remove('on'); msgs[k].classList.remove('wait'); msgs[k].classList.add('pop'); k++; timer = setTimeout(next, 900); }, 1100);
        };
        next();
      };
      msgs.forEach((m) => m.classList.add('wait'));
      new IntersectionObserver(([e]) => { if (e.isIntersecting && !started) { started = true; play(); } }, { threshold: .35 }).observe(dc);
      addEventListener('pagehide', () => clearTimeout(timer));
    }
  }

  // Diagram: reveal, then send packets along every arrow.
  const diagram = $('.diagram');
  if (diagram && !reduce) {
    const svg = $('svg', diagram), NS = 'http://www.w3.org/2000/svg';
    $$('.flow', svg).forEach((path, i) => {
      for (const off of [0, 1.2]) {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('r', '4'); c.setAttribute('class', `packet${path.classList.contains('slow') ? ' g' : ''}`);
        const m = document.createElementNS(NS, 'animateMotion');
        m.setAttribute('dur', path.classList.contains('slow') ? '3.2s' : '2.4s'); m.setAttribute('repeatCount', 'indefinite');
        m.setAttribute('begin', `${(i * .3 + off).toFixed(2)}s`); m.setAttribute('path', path.getAttribute('d'));
        c.append(m); svg.append(c);
      }
    });
    new IntersectionObserver(([e]) => { if (e.isIntersecting) diagram.classList.add('in'); }, { threshold: .25 }).observe(diagram);
  } else if (diagram) diagram.classList.add('in');
})();

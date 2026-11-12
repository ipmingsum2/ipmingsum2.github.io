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

  // Hero frame: tilt toward the pointer with a moving glare; floating cards drift.
  const hero = $('.hero'), stage = $('#heroStage'), frameEl = $('#heroFrame');
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

// ---------- round 2: hero Live feed, motion in every chapter, tour rails, live demo cards ----------
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const ic = (name, cls = '') => icon(name, cls);

  // Animations only run while their element is on screen.
  const whenVisible = (el, start, stop = () => {}) => {
    if (reduce) { start(true); return; }
    new IntersectionObserver(([e]) => (e.isIntersecting ? start(false) : stop()), { threshold: .2 }).observe(el);
  };
  const every = (ms, fn) => { let t = 0; return { start: () => { if (!t) { fn(); t = setInterval(fn, ms); } }, stop: () => { clearInterval(t); t = 0; } }; };

  // ---------- hero Live feed ----------
  const list = $('#lfList');
  if (list) {
    const EVENTS = [
      ['play', 'good', '4 in game now', 'Avalynne, Sunny, Ruby +1'],
      ['rank', 'accent', 'ZaraPoolside promoted', 'Customer -> Trainee · logged'],
      ['file', 'accent', 'New application', 'NovaStarRBX · auto-score 7/7'],
      ['bell', 'bad', '3 missed this week', 'Posted to #staff-activity'],
      ['clock', 'warn', 'Shift starts in 30 min', 'Reminder sent · @Receptionists'],
      ['trophy', 'warn', 'Staff of the week', 'SunnyConcierge · 14.2 h'],
      ['calendar', 'good', 'Time off approved', 'KaiSuite204 · 3 days'],
      ['inbox', 'accent', 'Access request', 'NewStaffer asked to join'],
      ['sparkle', 'good', 'Auto-promoted', 'EliTrainee -> Receptionist'],
      ['ban', 'bad', 'Blacklisted player kicked', 'Exploiter99 tried to join'],
    ];
    let k = 0;
    const add = (animate) => {
      const [i, tone, title, sub] = EVENTS[k++ % EVENTS.length];
      $$('.lf-item', list).forEach((x, n) => { x.classList.remove('new'); x.classList.toggle('old', n >= 2); });
      list.insertAdjacentHTML('afterbegin', `<li class="lf-item ${animate ? 'new' : ''}"><span class="lf-ic ${tone}">${ic(i)}</span><div><b>${esc(title)}</b><small>${esc(sub).replace(/ -&gt; /g, ` ${ic('arrowR', 'inl')} `)}</small></div><span class="t">now</span></li>`);
      $$('.lf-item', list).forEach((x, n) => { const t = $('.t', x); if (t) t.textContent = n === 0 ? 'now' : `${n * 2}m`; });
      while (list.children.length > 5) list.lastElementChild.remove();
    };
    for (let n = 0; n < 4; n++) add(false);
    const loop = every(2800, () => add(true));
    whenVisible(list, (still) => { if (!still) loop.start(); }, loop.stop);
  }

  // ---------- every chapter: word-by-word headings, staggered copy ----------
  $$('.chapter h2, .signin h2').forEach((h) => {
    if (h.children.length) return;
    const words = h.textContent.trim().split(/\s+/);
    h.setAttribute('aria-label', h.textContent.trim());
    h.innerHTML = words.map((w, i) => `<span class="w2" aria-hidden="true" style="--i:${i}">${esc(w)}</span>`).join(' ');
  });
  const stagger = () => $$('.copy[data-anim]').forEach((c) => [...c.children].filter((x) => x.matches('p, .chips, .code, .btn, .live')).forEach((x, j) => x.style.setProperty('--j', j)));

  // ---------- screenshots tilt toward the pointer ----------
  if (finePointer && !reduce) {
    $$('.media').forEach((m) => {
      const frames = $$('.frame', m);
      if (!frames.length) return;
      m.addEventListener('pointermove', (e) => {
        const r = m.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        frames.forEach((f, i) => {
          const depth = i ? 1.4 : 1;
          f.style.setProperty('--rx', `${(x - .5) * 8 * depth}deg`); f.style.setProperty('--ry', `${(.5 - y) * 6 * depth}deg`);
          const fr = f.getBoundingClientRect();
          f.style.setProperty('--gx', `${((e.clientX - fr.left) / fr.width) * 100}%`); f.style.setProperty('--gy', `${((e.clientY - fr.top) / fr.height) * 100}%`); f.style.setProperty('--go', '1');
        });
      });
      m.addEventListener('pointerleave', () => frames.forEach((f) => { f.style.setProperty('--rx', '0deg'); f.style.setProperty('--ry', '0deg'); f.style.setProperty('--go', '0'); }));
    });
  }

  // ---------- tours: numbered steps and a rail that fills as you scroll ----------
  const rails = $$('.tour-steps');
  rails.forEach((r) => $$('.step', r).forEach((s, i) => s.insertAdjacentHTML('afterbegin', `<span class="snum" aria-hidden="true">${i + 1}</span>`)));
  const fill = () => rails.forEach((r) => {
    const b = r.getBoundingClientRect(), mid = innerHeight / 2;
    r.style.setProperty('--tp', Math.max(0, Math.min(1, (mid - b.top - innerHeight * .1) / (b.height - innerHeight * .2))).toFixed(3));
  });
  if (!reduce) { addEventListener('scroll', () => requestAnimationFrame(fill), { passive: true }); fill(); }

  // ---------- a live demo card under each chapter's text ----------
  const card = (label, right, body) => `<div class="live-top">${label}${right ? `<span class="lt-r">${right}</span>` : ''}</div>${body}`;
  const WIDGETS = {
    ranking(el) {
      const ranks = [['ZaraPoolside', 'Customer', 'Trainee'], ['EliTrainee', 'Trainee', 'Receptionist'], ['RubyLobby', 'Receptionist', 'Senior Receptionist'], ['MaxDoorman', 'Senior Receptionist', 'Receptionist', true]];
      el.innerHTML = card('Rank change', 'via Open Cloud', '<div class="lv-row" id="lvRank"></div>');
      let i = 0;
      const show = () => { const [n, a, b, down] = ranks[i++ % ranks.length]; $('#lvRank', el).innerHTML = `<span class="lv-ava">${n[0]}</span><div class="lv-swap" style="min-width:0"><div class="lv-name">${n}</div><div class="row wrap gap-s" style="margin-top:4px"><span class="lv-pill">${a}</span><span class="lv-arrow">${ic('arrowR', 'inl')}</span><span class="lv-pill ${down ? 'bad' : 'good'}">${b}</span></div></div><span class="lv-pill accent" style="margin-left:auto">logged</span>`; };
      return every(3000, show);
    },
    promotions(el) {
      el.innerHTML = card('Promotion pick', 'trending', `<div class="lv-row"><span class="lv-ava">R</span><div><div class="lv-name">RubyLobby</div><div class="lv-muted">for Senior Receptionist · “Runs every evening shift”</div></div><div class="lv-vote"><span class="vb">${ic('up')}</span><span class="n" id="lvVotes">11</span></div></div>`);
      let n = 11;
      return every(2200, () => {
        const vb = $('.vb', el), box = $('.lv-vote', el);
        n = n >= 18 ? 11 : n + 1; $('#lvVotes', el).textContent = n;
        vb.classList.remove('hit'); void vb.offsetWidth; vb.classList.add('hit');
        box.insertAdjacentHTML('beforeend', '<span class="plus1">+1</span>'); setTimeout(() => box.querySelector('.plus1')?.remove(), 1000);
      });
    },
    logs(el) {
      const L = [['good', 'rank.promote', `ZaraPoolside ${ic('arrowR', 'inl')} Trainee`], ['', 'application.submitted', 'NovaStarRBX'], ['good', 'timeoff.approved', 'KaiSuite204 · 3 days'], ['bad', 'requirement.not_met', 'MaxDoorman · 1h 10m / 3h'], ['', 'session.completed', 'Evening reception'], ['bad', 'blacklist.added', 'Exploiter99'], ['good', 'autopromote.run', '2 recommended']];
      el.innerHTML = card('Log stream', 'every action', '<div class="lv-log" id="lvLog"></div>');
      let i = 0;
      const add = (animate) => {
        const [tone, type, what] = L[i++ % L.length], box = $('#lvLog', el);
        const d = new Date(); const tm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        $$('div', box).forEach((x) => x.classList.remove('new'));
        box.insertAdjacentHTML('afterbegin', `<div class="${animate ? 'new' : ''}"><span class="tm">${tm}</span><span class="badge ${tone}">${type}</span><span>${what}</span></div>`);
        while (box.children.length > 5) box.lastElementChild.remove();
      };
      for (let n = 0; n < 4; n++) add(false);
      return every(1700, () => add(true));
    },
    logbook(el) {
      el.innerHTML = card('Logbook entry', 'auto-expires', `<div class="lv-row"><span class="lv-ava" style="background:var(--warn-soft);color:var(--warn)">${ic('alert')}</span><div style="min-width:0"><div class="lv-name">Warning · MaxDoorman</div><div class="lv-muted">Inactivity without notice · <span id="lvDays">30</span> days left</div></div><span class="lv-pill" style="margin-left:auto">2 active</span></div><div class="lv-bar"><i></i></div>`);
      let d = 30; return every(200, () => { d = d <= 1 ? 30 : d - 1; $('#lvDays', el).textContent = d; });
    },
    groups(el) {
      const G = [['Sunrise Hotels', '6 tracked ranks · 15 members'], ['Sunrise Security', '2 tracked ranks · 9 members'], ['Harbor City Police', '5 tracked ranks · 31 members']];
      el.innerHTML = card('Group switcher', 'Ctrl K', '<div class="lv-row" id="lvGroup"></div>');
      let i = 0;
      return every(2600, () => { const [n, s] = G[i++ % G.length]; $('#lvGroup', el).innerHTML = `<span class="lv-ava">${ic('users')}</span><div class="lv-swap"><div class="lv-name">${n}</div><div class="lv-muted">${s}</div></div><span class="lv-pill" style="margin-left:auto">${ic('swap', 'sm')} switch</span>`; });
    },
    sessions(el) {
      el.innerHTML = card('Next session', 'reminder at 30:00', `<div class="lv-row"><div><div class="lv-name">Shift: Evening reception</div><div class="lv-muted">Host Avalynne · co-host SunnyConcierge</div></div></div><div class="lv-row" style="margin-top:10px;justify-content:space-between"><span class="lv-count" id="lvCount">00:31:00</span><span class="lv-btn pulse">${ic('check', 'sm')} Claim co-host</span></div>`);
      let s = 31 * 60;
      return every(1000, () => { s = s <= 0 ? 31 * 60 : s - 1; const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; $('#lvCount', el).textContent = [h, m, x].map((v) => String(v).padStart(2, '0')).join(':'); });
    },
    kb(el) {
      const lines = ['1. Greet every guest within 30 seconds.', '2. Log your shift in the session register.', '3. Ask a supervisor before issuing refunds.'];
      el.innerHTML = card('Staff handbook', 'editing', '<div class="lv-doc"><h4>Front desk basics</h4><div id="lvDoc"></div></div>');
      let li = 0, ch = 0;
      return every(55, () => {
        const box = $('#lvDoc', el);
        if (li >= lines.length) { if (++ch > 40) { li = 0; ch = 0; box.innerHTML = ''; } return; }
        ch++; const done = lines.slice(0, li).map((l) => `<div>${esc(l)}</div>`).join('');
        box.innerHTML = `${done}<div class="lv-caret">${esc(lines[li].slice(0, ch))}</div>`;
        if (ch >= lines[li].length) { li++; ch = 0; }
      });
    },
    linking(el) {
      el.innerHTML = card('Account link', 'verification game', `<div class="lv-link"><span class="lv-pill">${ic('discord', 'sm')} builder</span><span class="lv-wire" id="lvWire"><span class="lv-check">${ic('check', 'inl')}</span></span><span class="lv-pill">${ic('roblox', 'sm')} Builderman</span></div><div class="lv-muted" id="lvLinkTxt" style="margin-top:10px">Waiting for code K7M2QX…</div>`);
      let on = false;
      return every(2400, () => { on = !on; $('#lvWire', el).classList.toggle('done', on); $('#lvLinkTxt', el).innerHTML = on ? `Linked · kicked with a thank-you ${ic('check', 'inl')}` : 'Waiting for code K7M2QX…'; });
    },
    access(el) {
      el.innerHTML = card('Access request', 'sign-in page', '<div id="lvAcc"></div>');
      let st = 0;
      return every(1800, () => {
        const box = $('#lvAcc', el);
        if (st % 3 === 0) box.innerHTML = `<div class="lv-row lv-swap"><span class="lv-ava">N</span><div><div class="lv-name">Not on the whitelist yet</div><div class="lv-muted">“I moderate the hotel and need to log warnings.”</div></div></div><div class="lv-actions"><span class="ok">Send request</span></div>`;
        else if (st % 3 === 1) $('.ok', box)?.classList.add('press');
        else box.innerHTML = `<div class="lv-row lv-swap"><span class="lv-ava" style="background:var(--good-soft);color:var(--good)">${ic('check')}</span><div><div class="lv-name">Request sent</div><div class="lv-muted">You’re in as soon as it’s approved</div></div></div>`;
        st++;
      });
    },
    api(el) {
      const req = 'GET /v1/groups/1234567/members/156';
      const res = ['{', '  <span class="k">"username"</span>: <span class="s">"Builderman"</span>,', '  <span class="k">"rank"</span>: 40,', '  <span class="k">"week"</span>: { <span class="k">"hours"</span>: 12.5 }', '}'];
      el.innerHTML = card('Request', '200 OK', '<pre class="lv-code" id="lvCode"></pre>');
      let ch = 0, ln = -1, hold = 0;
      return every(45, () => {
        const box = $('#lvCode', el);
        if (ch < req.length) { ch++; box.innerHTML = `<span class="m">$</span> ${esc(req.slice(0, ch))}<span class="lv-caret"></span>`; return; }
        if (ln < res.length - 1) { if (++hold % 6) return; ln++; box.innerHTML = `<span class="m">$</span> ${esc(req)}\n${res.slice(0, ln + 1).join('\n')}`; return; }
        if (++hold > 120) { ch = 0; ln = -1; hold = 0; }
      });
    },
    anywhere(el) {
      el.innerHTML = card('Theme', 'follows your system', `<div class="lv-row"><span class="lv-switch" id="lvSw"><i>${ic('sun', 'inl')}</i></span><div><div class="lv-name" id="lvThemeName">Light</div><div class="lv-muted">Soft fade — no flash</div></div><span class="lv-pill" style="margin-left:auto">${ic('user', 'sm')} 390 px wide</span></div>`);
      let on = false;
      return every(2200, () => { on = !on; $('#lvSw', el).classList.toggle('on', on); $('#lvSw i', el).innerHTML = ic(on ? 'moon' : 'sun', 'inl'); $('#lvThemeName', el).textContent = on ? 'Dark' : 'Light'; });
    },
  };
  for (const [id, build] of Object.entries(WIDGETS)) {
    const copy = $(`#${id} .copy`); if (!copy) continue;
    // The card element is created first and stays the same node, so each widget's lookups keep working.
    const el = document.createElement('div');
    el.className = 'live'; el.setAttribute('aria-hidden', 'true');
    const loop = build(el);
    copy.append(el);
    // Reduced motion: draw one frame and stop.
    whenVisible(el, (still) => { loop.start(); if (still) loop.stop(); }, loop.stop);
  }
  stagger();
})();

/* spacetime — router, warp timeline, input, main loop.
   Navigation: the current page is rasterized, the next page is fetched, staged
   and rasterized, and the shader plays collapse → wormhole → white hole.
   Browser Back plays the same timeline in reverse. */
(function () {
  var ST = (window.ST = window.ST || {});
  var S = ST.state;
  var doc = document, root = doc.documentElement;
  var reduced = root.classList.contains('rm');
  var ROUTES = ['index.html', 'about.html', 'projects.html', 'contact.html'];
  var FONTS = ['400 20px "Instrument Serif"', 'italic 400 20px "Instrument Serif"', '400 16px Inter',
    '500 16px Inter', '400 12px "JetBrains Mono"', '500 12px "JetBrains Mono"'];
  var DUR = 1750;

  var engine = null, gl = false;
  var busy = false, queued = null, anim = null;
  var cache = {};
  var current = routeOf(location.href) || 'index.html';
  var hIdx = 0, curState = null;
  var snap = doc.createElement('canvas');
  var announcer = doc.getElementById('announcer');

  ST.debug = ST.debug || { T: null };  // set T to 0..1 to freeze a warp at that progress (screenshots)

  /* ---------------- routing helpers ---------------- */
  function dirOf(p) { return p.slice(0, p.lastIndexOf('/') + 1); }
  function routeOf(href) {
    var u;
    try { u = new URL(href, location.href); } catch (e) { return null; }
    if (u.origin !== location.origin || u.hash || dirOf(u.pathname) !== dirOf(location.pathname)) return null;
    var last = u.pathname.split('/').pop() || 'index.html';
    return ROUTES.indexOf(last) > -1 ? last : null;
  }
  function label(main) { return (main.getAttribute('data-idx') || '') + ' ' + (main.getAttribute('data-name') || ''); }
  function centerOf(el) { var r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }
  function fromNorm(n) { return n && n.length === 2 ? [n[0] * S.W, n[1] * S.H] : [S.W / 2, S.H / 2]; }
  function assign(a, b) { var o = {}, k; for (k in (a || {})) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }

  function load(route) {
    if (!cache[route]) {
      cache[route] = fetch(route, { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (html) {
          var d = new DOMParser().parseFromString(html, 'text/html');
          var m = d.getElementById('main');
          if (!m) throw new Error('missing <main>');
          return { main: m, title: d.title };
        });
      cache[route].catch(function () { delete cache[route]; });
    }
    return cache[route];
  }

  function updateNav(route) {
    var links = doc.querySelectorAll('.nav a');
    for (var i = 0; i < links.length; i++) {
      if (routeOf(links[i].href) === route) links[i].setAttribute('aria-current', 'page');
      else links[i].removeAttribute('aria-current');
    }
  }

  function swap(oldMain, newMain, route, title, scroll) {
    oldMain.parentNode.replaceChild(newMain, oldMain);
    window.scrollTo(0, scroll || 0);
    S.scroll = window.scrollY;
    doc.title = title;
    current = route;
    updateNav(route);
  }

  /* ---------------- navigation ---------------- */
  function go(href, opts) {
    var route = routeOf(href);
    if (!route) { location.href = href; return; }
    if (busy) { queued = [href, opts]; return; }
    if (route === current) { if (opts.push) stutter(opts.P); return; }
    busy = true;
    load(route).then(function (page) {
      try { transition(route, href, page, opts); }
      catch (err) { console.warn('[spacetime] transition failed', err); location.href = href; }
    }, function () {
      handoff(href, opts.P);
    });
  }

  function transition(route, href, page, opts) {
    var rev = opts.dir < 0;
    var oldMain = doc.getElementById('main');
    var newMain = doc.importNode(page.main, true);
    var fromL = label(oldMain), toL = label(newMain);

    if (opts.push) {
      var next = { st: 1, idx: hIdx + 1, P: [opts.P[0] / S.W, opts.P[1] / S.H], scroll: 0 };
      try {
        history.replaceState(assign(history.state, { st: 1, idx: hIdx, scroll: window.scrollY }), '');
        history.pushState(next, '', href);
      } catch (err) {
        // e.g. file:// forbids pushState across files: fall through the wormhole the old way
        return handoff(href, opts.P);
      }
      hIdx++;
      curState = next;
    }

    if (!gl || reduced) { softSwap(oldMain, newMain, route, page.title, opts); return; }

    var k = engine.scale();
    ST.rasterize(oldMain, snap, k, S.W, S.H);
    engine.setTexture(rev ? 1 : 0, snap);
    newMain.classList.add('is-staged');
    swap(oldMain, newMain, route, page.title, opts.scroll);
    ST.rasterize(newMain, snap, k, S.W, S.H);
    engine.setTexture(rev ? 0 : 1, snap);

    startWarp({ P: opts.P, rev: rev, from: fromL, to: toL, main: newMain, t0: 0, t1: 1 });
  }

  function startWarp(o) {
    var w = S.warp;
    w.on = 1; w.rev = o.rev ? 1 : 0;
    w.P = o.P || [S.W / 2, S.H / 2];
    w.C = [S.W / 2, S.H / 2];
    w.seed = Math.random();
    w.spin = Math.random() < 0.5 ? -1 : 1;
    w.T = o.rev ? o.t1 : o.t0;
    S.ripples.length = 0;
    root.classList.add('is-warping');
    root.classList.toggle('is-rewinding', !!o.rev);
    if (o.from) ST.hud.warpStart(o.from, o.to, o.rev, o.status);
    anim = { start: performance.now(), dur: DUR * (o.t1 - o.t0), t0: o.t0, t1: o.t1, rev: !!o.rev, main: o.main, done: o.done, intro: o.intro };
  }

  function stepWarp(now) {
    var a = anim;
    if (!a || a.ending) return;
    var p = Math.min(1, (now - a.start) / a.dur);
    if (ST.debug.T != null) p = Math.max(0, Math.min(1, (ST.debug.T - a.t0) / (a.t1 - a.t0)));
    var u = a.t0 + (a.t1 - a.t0) * p;
    S.warp.T = a.rev ? (a.t0 + a.t1 - u) : u;
    if (p >= 1 && ST.debug.T == null) {
      a.ending = true;
      if (a.done) a.done(); else arrive(a);
    }
  }

  // final warp frame is identical to the page: fade the real DOM in over it, then go idle
  function arrive(a) {
    var m = a.main;
    m.classList.add('is-arriving');
    m.classList.remove('is-staged');
    if (a.intro) root.classList.add('intro-done');
    setTimeout(function () {
      S.warp.on = 0;
      anim = null;
      m.classList.remove('is-arriving');
      root.classList.remove('is-warping', 'is-rewinding', 'intro');
      engine.setTexture(0, null); engine.setTexture(1, null);
      ST.hud.warpEnd();
      finish(m, !a.intro);
    }, 190);
  }

  function finish(main, announce) {
    busy = false;
    if (announce) {
      var h = main.querySelector('h1');
      if (h) { try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } }
      if (announcer) announcer.textContent = 'Arrived at ' + (main.getAttribute('data-name') || doc.title);
    }
    var ey = main.querySelector('.eyebrow .ev');
    if (ey) ST.scramble(ey, null, 520);
    if (queued) { var q = queued; queued = null; go(q[0], q[1]); }
  }

  // no WebGL, or reduced motion: a CSS horizon instead of a shader
  function softSwap(oldMain, newMain, route, title, opts) {
    if (reduced || !oldMain.animate) {
      swap(oldMain, newMain, route, title, opts.scroll);
      if (newMain.animate) newMain.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
      finish(newMain, true);
      return;
    }
    var r = oldMain.getBoundingClientRect();
    var at = (opts.P[0] - r.left) + 'px ' + (opts.P[1] - r.top) + 'px';
    var out = oldMain.animate([
      { clipPath: 'circle(150% at ' + at + ')', filter: 'blur(0px)' },
      { clipPath: 'circle(0% at ' + at + ')', filter: 'blur(6px)' }
    ], { duration: 420, easing: 'cubic-bezier(.6,0,.9,.4)', fill: 'forwards' });
    out.onfinish = function () {
      swap(oldMain, newMain, route, title, opts.scroll);
      newMain.animate([
        { clipPath: 'circle(0% at 50% 40%)', filter: 'blur(8px)' },
        { clipPath: 'circle(150% at 50% 40%)', filter: 'blur(0px)' }
      ], { duration: 560, easing: 'cubic-bezier(.2,.7,.2,1)' }).onfinish = function () { finish(newMain, true); };
    };
  }

  // fetch impossible (e.g. opened from file://): fall in here, climb out on the next page load
  function handoff(href, P) {
    if (!gl || reduced) { location.href = href; return; }
    var oldMain = doc.getElementById('main');
    ST.rasterize(oldMain, snap, engine.scale(), S.W, S.H);
    engine.setTexture(0, snap); engine.setTexture(1, null);
    oldMain.classList.add('is-staged');
    startWarp({
      P: P, rev: false, from: label(oldMain), to: '··', t0: 0, t1: 0.47,
      done: function () {
        try { sessionStorage.setItem('st.handoff', JSON.stringify({ P: [P[0] / S.W, P[1] / S.H], t: Date.now() })); } catch (e) { /* ignore */ }
        location.href = href;
      }
    });
  }

  function stutter(P) {
    if (P) ST.ripple(P[0], P[1], 1.3);
    var cur = doc.querySelector('.nav a[aria-current="page"] .nav-label');
    if (cur) ST.scramble(cur, null, 360);
  }

  /* ---------------- intro: arrive out of a white hole ---------------- */
  function intro() {
    var hand = null;
    try {
      hand = JSON.parse(sessionStorage.getItem('st.handoff') || 'null');
      sessionStorage.removeItem('st.handoff');
    } catch (e) { hand = null; }
    if (hand && Date.now() - hand.t > 6000) hand = null;

    var main = doc.getElementById('main');
    ST.rasterize(main, snap, engine.scale(), S.W, S.H);
    engine.setTexture(0, null);
    engine.setTexture(1, snap);
    busy = true;
    startWarp({ P: hand ? fromNorm(hand.P) : null, rev: false, t0: hand ? 0.47 : 0.52, t1: 1, main: main, intro: true,
      from: '∅', to: label(main), status: 'Emerging from white hole' });
  }

  /* ---------------- input ---------------- */
  function bindInput() {
    doc.addEventListener('click', function (e) {
      var copyBtn = e.target.closest && e.target.closest('[data-copy]');
      if (copyBtn) {
        var txt = copyBtn.getAttribute('data-copy');
        var done = function () { ST.scramble(copyBtn, 'copied', 300); setTimeout(function () { ST.scramble(copyBtn, 'copy', 300); }, 1600); };
        if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, function () {});
        var c = centerOf(copyBtn); ST.ripple(c[0], c[1], 0.8);
        return;
      }
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a) { if (!reduced && e.detail !== 0) ST.ripple(e.clientX, e.clientY, 1); return; }
      if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      if (!routeOf(a.href)) return;
      e.preventDefault();
      var P = e.detail === 0 ? centerOf(a) : [e.clientX, e.clientY];
      go(a.href, { P: P, dir: 1, push: true, scroll: 0 });
    });

    doc.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      var t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      var n = '1234'.indexOf(e.key);
      if (n < 0) return;
      var link = doc.querySelectorAll('.nav a')[n];
      if (!link) return;
      e.preventDefault();
      go(link.href, { P: centerOf(link), dir: 1, push: true, scroll: 0 });
    });

    window.addEventListener('popstate', function (e) {
      var st = e.state || {};
      var route = routeOf(location.href.split('#')[0]);
      if (!route) { location.reload(); return; }
      if (route === current && !busy) return;   // in-page #fragment jumps
      var idx = typeof st.idx === 'number' ? st.idx : 0;
      var dir = idx < hIdx ? -1 : 1;
      var P = dir < 0 ? fromNorm(curState && curState.P) : fromNorm(st.P);
      hIdx = idx;
      curState = st;
      go(location.href, { P: P, dir: dir, push: false, scroll: st.scroll || 0 });
    });

    window.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      var m = S.mouse;
      if (m.tx < -9000) { m.x = e.clientX; m.y = e.clientY; }
      m.tx = e.clientX; m.ty = e.clientY; m.target = 1;
    }, { passive: true });
    root.addEventListener('mouseleave', function () { S.mouse.target = 0; });
    window.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch' && !reduced) ST.ripple(e.clientX, e.clientY, 0.9);
    }, { passive: true });

    doc.addEventListener('pointerover', function (e) {
      var a = e.target.closest && e.target.closest('a, button');
      S.mouse.boostTarget = a ? 1.7 : 1;
      var lab = a && a.querySelector('.nav-label');
      if (lab && a._hover !== true) { a._hover = true; ST.scramble(lab, null, 380); }
    });
    doc.addEventListener('pointerout', function (e) {
      var a = e.target.closest && e.target.closest('a, button');
      if (a && !a.contains(e.relatedTarget)) { a._hover = false; S.mouse.boostTarget = 1; }
    });

    window.addEventListener('scroll', function () { S.scroll = window.scrollY; }, { passive: true });

    var rq = 0;
    window.addEventListener('resize', function () {
      if (rq) return;
      rq = requestAnimationFrame(function () { rq = 0; if (engine) { engine.resize(); if (reduced) engine.render(performance.now()); } });
    });
  }

  /* ---------------- main loop ---------------- */
  var last = performance.now();
  function loop(now) {
    var dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    var m = S.mouse;
    var km = 1 - Math.exp(-dt * 14);
    if (m.tx > -9000) { m.x += (m.tx - m.x) * km; m.y += (m.ty - m.y) * km; }
    m.on += ((S.warp.on ? 0 : m.target) - m.on) * (1 - Math.exp(-dt * 5));
    m.boost += (m.boostTarget - m.boost) * (1 - Math.exp(-dt * 8));

    stepWarp(now);
    var gamma = S.warp.on ? ST.hud.warpFrame(S.warp.T) : 1;
    ST.hud.frame(dt, gamma, S.warp.on ? S.warp : null);

    engine.adapt(dt * 1000, now);
    engine.render(now);
    requestAnimationFrame(loop);
  }

  /* ---------------- boot ---------------- */
  function whenFontsReady() {
    if (!doc.fonts || !doc.fonts.load) return Promise.resolve();
    var all = Promise.all(FONTS.map(function (f) { return doc.fonts.load(f).catch(function () {}); })).then(function () { return doc.fonts.ready; });
    return Promise.race([all, new Promise(function (r) { setTimeout(r, 1600); })]);
  }

  function prefetch() {
    var run = function () { ROUTES.forEach(function (r) { if (r !== current) load(r).catch(function () {}); }); };
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2500 }); else setTimeout(run, 1200);
  }

  function boot() {
    ST.hud.init();
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    var st = history.state;
    if (st && typeof st.idx === 'number') { hIdx = st.idx; curState = st; }
    else { curState = { st: 1, idx: 0, P: null, scroll: 0 }; history.replaceState(curState, ''); }

    var mainNow = doc.getElementById('main');
    cache[current] = Promise.resolve({ main: mainNow.cloneNode(true), title: doc.title });

    bindInput();
    setInterval(function () { if (!S.warp.on) ST.hud.tickClock(); }, 1000);

    // never hold the page hostage for the intro: if shaders/fonts are slow, just show it
    var introLate = false;
    var deadline = setTimeout(function () { introLate = true; root.classList.remove('intro'); }, 1900);

    engine = new ST.Engine(doc.getElementById('spacetime'));
    var ready;
    try { ready = engine.init(); } catch (e) { ready = Promise.resolve(false); }
    Promise.all([ready.catch(function () { return false; }), reduced ? null : whenFontsReady()]).then(function (res) {
      gl = !!res[0];
      if (!gl) { clearTimeout(deadline); root.classList.remove('intro'); prefetch(); return; }
      root.classList.add('gl');
      prefetch();
      if (reduced) { engine.render(performance.now()); return; }
      requestAnimationFrame(loop);
      if (!introLate) { clearTimeout(deadline); engine.resize(); intro(); }
    });
  }

  ST.go = go;
  // the loop repaints every frame; a reduced-motion page is a still and needs asking
  ST.redraw = function () { if (gl && reduced) engine.render(performance.now()); };
  boot();
})();

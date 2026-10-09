/* spacetime — light / dark theme.
   The inline script in each page's <head> picks the theme before first paint
   (stored choice, else the system setting). This wires up the switch, keeps
   following the system until the visitor picks, and plays the change as a
   light cone opening from the switch. */
(function () {
  var ST = (window.ST = window.ST || {});
  var doc = document, root = doc.documentElement;
  var KEY = 'st.theme';
  var BG = { dark: '#050507', light: '#f1efe9' };   // keep in sync with --bg in site.css
  var reduced = root.classList.contains('rm');
  var sys = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null;
  var btn = doc.querySelector('.theme-toggle');
  var meta = doc.querySelector('meta[name="theme-color"]');

  function current() { return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
  function system() { return sys && sys.matches ? 'light' : 'dark'; }
  function stored() {
    try { var t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : null; } catch (e) { return null; }
  }

  function apply(t) {
    root.setAttribute('data-theme', t);
    if (ST.state) ST.state.light = t === 'light' ? 1 : 0;
    if (meta) meta.setAttribute('content', BG[t]);
    if (btn) btn.setAttribute('aria-pressed', String(t === 'light'));
    if (ST.redraw) ST.redraw();
  }

  // the theme being switched to: a view transition applies it a frame late,
  // and a second click inside that frame should still undo the first
  var want = current();

  /** Switch theme; `at` is the viewport point (css px) the new theme spreads from. */
  function set(t, at) {
    if (t === want) return;
    want = t;
    // picking what the system already says means "follow the system" again
    try { if (t === system()) localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch (e) { /* storage unavailable */ }
    if (reduced || !at || !doc.startViewTransition) { apply(t); return; }
    var vt = doc.startViewTransition(function () { apply(t); });
    // never leave the switch waiting on a frame that doesn't come: skipping still applies the theme
    var guard = setTimeout(function () { vt.skipTransition(); }, 300);
    vt.updateCallbackDone.then(function () { clearTimeout(guard); }, function () {});
    vt.ready.then(function () {
      var W = window.innerWidth, H = window.innerHeight;
      var r = Math.hypot(Math.max(at[0], W - at[0]), Math.max(at[1], H - at[1]));
      var c = ' at ' + at[0] + 'px ' + at[1] + 'px)';
      root.animate({ clipPath: ['circle(0px' + c, 'circle(' + r + 'px' + c] },
        { duration: 750, easing: 'cubic-bezier(.3, .6, .2, 1)', pseudoElement: '::view-transition-new(root)' });
    }, function () { /* skipped: the theme is already applied */ });
  }

  if (btn) {
    btn.addEventListener('click', function () {
      var r = btn.getBoundingClientRect();
      set(want === 'light' ? 'dark' : 'light', [r.left + r.width / 2, r.top + r.height / 2]);
    });
  }

  if (sys) {
    var follow = function () { if (!stored()) apply(want = system()); };
    if (sys.addEventListener) sys.addEventListener('change', follow); else if (sys.addListener) sys.addListener(follow);
  }

  apply(current());
  ST.theme = { get: function () { return want; }, set: set };
})();

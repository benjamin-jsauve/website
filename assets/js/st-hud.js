/* spacetime — HUD: proper time, dilation, coordinates, clock, warp readouts. */
(function () {
  var ST = (window.ST = window.ST || {});
  var GLYPHS = '∂∇∑∫Δλψωπ≈∞01<>/#*+';
  var YEARS = ['1687', '1905', '1915', '1919', '1974', '2015', '2019', '∞', '−∞', '0000'];
  var reduced = document.documentElement.classList.contains('rm');

  function $(k) { return document.querySelector('[data-hud="' + k + '"]'); }
  function set(el, v) { if (el && el._v !== v) { el._v = v; el.textContent = v; } }

  /** Scramble an element's text into `text` through random glyphs. */
  ST.scramble = function (el, text, dur) {
    if (!el) return;
    if (text == null) text = el._final || el.textContent;
    el._final = text;
    if (reduced) { el.textContent = text; return; }
    dur = dur || 520;
    if (el._scr) cancelAnimationFrame(el._scr);
    var start = performance.now(), n = text.length, at = [];
    for (var i = 0; i < n; i++) at.push((i / Math.max(1, n)) * 0.55 + Math.random() * 0.45);
    (function step(now) {
      var p = Math.min(1, (now - start) / dur), out = '';
      for (var i = 0; i < n; i++) {
        var ch = text[i];
        out += (ch === ' ' || p >= at[i]) ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      el.textContent = out;
      if (p < 1) el._scr = requestAnimationFrame(step);
      else { el.textContent = text; el._scr = 0; }
    })(start);
  };

  var hud = (ST.hud = {
    dil: 0,          // accumulated (t − τ) in seconds, persisted per visitor
    clockOffset: 0,  // seconds the clock has been flung by a warp
    el: {},

    init: function () {
      var e = this.el;
      ['x', 'y', 'dil', 'clock', 'year', 'status', 'from', 'to', 'v', 'g'].forEach(function (k) { e[k] = $(k); });
      try { this.dil = parseFloat(localStorage.getItem('st.dil')) || 0; } catch (err) { this.dil = 0; }
      this.year = String(new Date().getFullYear());
      set(e.year, this.year);
      try {
        this.fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      } catch (err) {
        this.fmt = { format: function (d) { return d.toTimeString().slice(0, 8); } };
      }
      this.renderDil();
      this.tickClock();
    },

    renderDil: function () {
      set(this.el.dil, (this.dil > 0 ? '−' : '') + this.dil.toFixed(3) + ' s');
    },

    tickClock: function () {
      var d = new Date(Date.now() + this.clockOffset * 1000);
      set(this.el.clock, this.fmt.format(d).replace(/^24/, '00'));
    },

    /** Per frame. gamma = current Lorentz factor (1 when idle). */
    frame: function (dt, gamma, warp) {
      var S = ST.state;
      if (gamma > 1) {
        this.dil += dt * (1 - 1 / gamma);
        this.renderDil();
      }
      if (warp) {
        var amt = Math.sin(Math.PI * warp.T);
        this.clockOffset += dt * 5400 * amt * (warp.rev ? -1 : 1);
        if (Math.random() < 0.3) set(this.el.year, YEARS[(Math.random() * YEARS.length) | 0]);
        if (Math.random() < 0.5) {
          set(this.el.x, Math.random().toFixed(3));
          set(this.el.y, Math.random().toFixed(3));
        }
      } else if (S.mouse.tx > -9000) {
        set(this.el.x, Math.max(0, Math.min(1, S.mouse.tx / S.W)).toFixed(3));
        set(this.el.y, Math.max(0, Math.min(1, 1 - S.mouse.ty / S.H)).toFixed(3));
      }
      this.tickClock();
    },

    /** Lorentz profile of a warp: v/c climbs to 0.99999 at mid-transit. */
    velocity: function (T) {
      var s = Math.pow(Math.max(0, Math.sin(Math.PI * T)), 0.8);
      var beta = 1 - Math.pow(10, -5 * s);
      return { beta: beta, gamma: 1 / Math.sqrt(Math.max(1e-12, 1 - beta * beta)) };
    },

    warpStart: function (fromLabel, toLabel, rev, status) {
      var e = this.el;
      set(e.from, fromLabel); set(e.to, toLabel);
      ST.scramble(e.status, status || (rev ? '◀◀ Rewinding time' : 'Traversing Einstein–Rosen bridge'), 600);
    },

    warpFrame: function (T) {
      var v = this.velocity(T), g = v.gamma;
      set(this.el.v, v.beta.toFixed(5));
      set(this.el.g, g < 10 ? g.toFixed(3) : g < 100 ? g.toFixed(2) : g.toFixed(1));
      return g;
    },

    warpEnd: function () {
      this.clockOffset = 0;
      this.tickClock();
      if (this.el.clock) ST.scramble(this.el.clock, this.el.clock.textContent, 380);
      set(this.el.year, this.year);
      if (this.el.year) ST.scramble(this.el.year, this.year, 420);
      try { localStorage.setItem('st.dil', String(this.dil)); } catch (err) { /* storage unavailable */ }
    }
  });
})();

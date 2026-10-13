/* ==========================================================================
   Banach–Tarski, loosely.
   Balls drift left to right. Every so often one is cut into annular pieces
   that fly apart and come back together as two balls the same size as the
   first. Piece (ring i, sector j) goes to the first new ball when i + j is
   even, so each new ball receives every other piece of every ring, and each
   piece stretches to twice its angle on the way. The real theorem manages
   this with rigid motions of non-measurable sets; we stretch.
   ========================================================================== */
(function () {
  'use strict';

  var canvas = document.getElementById('stage');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var COLORS = [[230, 57, 70], [34, 160, 96], [37, 99, 235]]; // red, green, blue
  var SIZES = [0.72, 0.86, 1, 1.14];
  var RINGS = [0, 0.5, 1];          // ring edges, as a fraction of the radius
  var SECTORS = [6, 12];            // pieces per ring; even, so each new ball gets half
  var SPLIT_SECONDS = 3.6;
  var PAD = 10;                     // keep balls this far from the stage edges
  var TAU = Math.PI * 2;

  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var W = 0, H = 0, dpr = 1, R = 24, speed = 1, target = 12;
  var balls = [];
  var veils = [];                   // text blocks, relative to the canvas: no splits start under them
  var clock = 0, spawnIn = 0;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(list) { return list[(Math.random() * list.length) | 0]; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); }
  function ease(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(2 - 2 * x, 3) / 2; }

  function rgb(c, t) { // t > 0 lightens toward white, t < 0 darkens toward black
    var m = t > 0 ? 255 : 0, f = Math.abs(t);
    return 'rgb(' + Math.round(c[0] + (m - c[0]) * f) + ',' +
      Math.round(c[1] + (m - c[1]) * f) + ',' + Math.round(c[2] + (m - c[2]) * f) + ')';
  }

  function cruise() { return rand(40, 64) * speed; }

  function makeBall(x, y, r, c, v) {
    return {
      x: x, y: y, r: r, c: c, fill: rgb(c, 0),
      v: v, vx: v, vy: 0,
      wf: rand(0.3, 0.7), wp: rand(0, TAU), // slow vertical wobble
      cool: rand(1, 5),                     // seconds before it may split
      split: null
    };
  }

  /* ---- sizing ------------------------------------------------------------ */

  function resize() {
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    W = w; H = h;
    R = clamp(Math.min(H * 0.078, W * 0.05), 13, 34);
    speed = clamp(W / 1440, 0.55, 1.15);
    target = clamp(Math.round(W * H / (R * R * 36)), 5, 32);
    return true;
  }

  function measureVeils() {
    var c = canvas.getBoundingClientRect(), els = document.querySelectorAll('.veil');
    veils = [];
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      veils.push({ l: r.left - c.left, t: r.top - c.top, r: r.right - c.left, b: r.bottom - c.top });
    }
  }

  // A split drifts right while it runs; keep that whole sweep out from under the text.
  function clearOfText(b) {
    var m = 2.2 * b.r + 8;
    var x0 = b.x - m, x1 = b.x + m + b.v * SPLIT_SECONDS, y0 = b.y - m, y1 = b.y + m;
    for (var i = 0; i < veils.length; i++) {
      var v = veils[i];
      if (x1 > v.l && x0 < v.r && y1 > v.t && y0 < v.b) return false;
    }
    return true;
  }

  /* ---- splitting --------------------------------------------------------- */

  function startSplit(b) {
    var reach = 1.18 * b.r;                       // old centre to each new centre
    var maxDy = Math.min(reach, (H - 2 * PAD) / 2 - b.r);
    if (maxDy < 0) return false;
    var dy = Math.min(reach * rand(0.7, 1), maxDy);
    var dx = Math.sqrt(reach * reach - dy * dy) * (Math.random() < 0.5 ? -1 : 1);
    var shift = clamp(b.y, PAD + b.r + dy, H - PAD - b.r - dy) - b.y;

    var pieces = [];
    for (var i = 0; i < SECTORS.length; i++) {
      var n = SECTORS[i], step = TAU / n, a = rand(0, TAU);
      var r0 = RINGS[i] * b.r, r1 = RINGS[i + 1] * b.r;
      var twist = [rand(0.5, 1.1) * (1 + 0.4 * i), -rand(0.5, 1.1) * (1 + 0.4 * i)];
      for (var j = 0; j < n; j++) {
        var to = (i + j) % 2;
        var a0 = a + j * step;
        var b0 = a + (j & 1) * step + twist[to] + 2 * (j >> 1) * step;
        pieces.push({
          to: to, r0: r0, r1: r1,
          a0: a0, a1: a0 + step,      // angles in the old ball
          b0: b0, b1: b0 + 2 * step,  // angles in the new ball: twice as wide
          wait: (SECTORS.length - 1 - i) * 0.04 + rand(0, 0.04), // outer rings leave first
          burst: b.r * (0.32 + 0.22 * i) * rand(0.85, 1.15),
          spin: rand(-0.9, 0.9),
          tone: rand(-0.2, 0.2)
        });
      }
    }
    b.split = { t: 0, dest: [{ x: dx, y: dy + shift }, { x: -dx, y: -dy + shift }], pieces: pieces };
    b.vx = b.v; b.vy = 0;
    return true;
  }

  function finishSplit(b) {
    var out = [];
    for (var k = 0; k < 2; k++) {
      var d = b.split.dest[k];
      var nb = makeBall(b.x + d.x, b.y + d.y, b.r, b.c, b.v * rand(0.94, 1.08));
      nb.vx = nb.v + d.x * 0.25;
      nb.vy = d.y * 0.25;
      nb.cool = rand(5, 12);
      out.push(nb);
    }
    return out;
  }

  /* ---- simulation -------------------------------------------------------- */

  // Collision bodies: a free ball can be pushed; a splitting ball holds the two
  // spots its new balls will take, so neighbours clear out of the way in time.
  function bodies() {
    var list = [];
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      if (b.split) {
        for (var k = 0; k < 2; k++) {
          var d = b.split.dest[k];
          list.push({ x: b.x + d.x, y: b.y + d.y, r: b.r, ball: null });
        }
      } else {
        list.push({ x: b.x, y: b.y, r: b.r, ball: b });
      }
    }
    return list;
  }

  function spawnY(r) {
    var best = null, bestRoom = R * 0.5;
    for (var n = 0; n < 12; n++) {
      var y = rand(PAD + r, H - PAD - r), room = Infinity;
      for (var i = 0; i < balls.length; i++) {
        var b = balls[i];
        if (b.x > 4 * R + b.r) continue;
        room = Math.min(room, Math.hypot(b.x + r, b.y - y) - b.r - r);
      }
      if (room > bestRoom) { bestRoom = room; best = y; }
    }
    return best;
  }

  function splitNearby(b) {
    for (var i = 0; i < balls.length; i++) {
      var o = balls[i];
      if (o !== b && o.split && Math.abs(o.x - b.x) < 3.5 * (o.r + b.r)) return true;
    }
    return false;
  }

  function step(dt) {
    var i, j, b;
    clock += dt;

    var list = bodies(), gap = R * 0.45;
    for (i = 0; i < list.length; i++) {
      for (j = i + 1; j < list.length; j++) {
        var p = list[i], q = list[j];
        if (!p.ball && !q.ball) continue;
        var dx = q.x - p.x, dy = q.y - p.y, d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        var over = p.r + q.r + gap - d;
        if (over <= 0) continue;
        var f = over * 18 * dt / d * (p.ball && q.ball ? 0.5 : 1);
        if (p.ball) { p.ball.vx -= dx * f; p.ball.vy -= dy * f; }
        if (q.ball) { q.ball.vx += dx * f; q.ball.vy += dy * f; }
      }
    }

    var splitting = 0;
    for (i = 0; i < balls.length; i++) if (balls[i].split) splitting++;
    var room = balls.length < target + 3 && splitting < 3;

    for (i = 0; i < balls.length; i++) {
      b = balls[i];
      b.x += b.vx * dt;
      if (b.split) { b.split.t += dt / SPLIT_SECONDS; continue; }

      var top = PAD + b.r, bot = H - PAD - b.r;
      if (b.y < top) b.vy += (top - b.y) * 30 * dt;
      if (b.y > bot) b.vy -= (b.y - bot) * 30 * dt;
      b.vy += Math.sin(clock * b.wf + b.wp) * 6 * dt;
      b.vy *= Math.exp(-1.6 * dt);
      b.vx += (b.v - b.vx) * (1 - Math.exp(-1.2 * dt));
      b.y = clamp(b.y + b.vy * dt, b.r, H - b.r);

      b.cool -= dt;
      if (room && b.cool <= 0 && b.x - b.r > W * 0.04 && b.x < W * 0.82 &&
          Math.random() < dt * 0.07 && !splitNearby(b) && clearOfText(b) && startSplit(b)) {
        splitting++;
        room = splitting < 3;
      }
    }

    var next = [];
    for (i = 0; i < balls.length; i++) {
      b = balls[i];
      if (b.x - 2.5 * b.r > W) continue;
      if (b.split && b.split.t >= 1) next.push.apply(next, finishSplit(b));
      else next.push(b);
    }
    balls = next;

    // Feed new balls in on the left whenever that side thins out.
    var left = 0;
    for (i = 0; i < balls.length; i++) if (balls[i].x < W * 0.22) left++;
    spawnIn -= dt;
    if (spawnIn <= 0 && left < Math.max(1, Math.round(target * 0.22)) && balls.length < target + 6) {
      var r = R * pick(SIZES), y = spawnY(r);
      if (y !== null) balls.push(makeBall(-r - 2, y, r, pick(COLORS), cruise()));
      spawnIn = rand(0.6, 1.6);
    }
  }

  function populate() {
    balls = [];
    clock = 0;
    spawnIn = 1.5;
    // Open with a split right away, in clear space toward the top left, so the idea is on screen at once.
    var r0 = R * 1.14;
    for (var n = 0; n < 160; n++) {
      var low = n < 80 ? H * 0.5 : H - PAD - 2.2 * r0;
      var o = makeBall(rand(0.06, 0.5) * W, rand(PAD + 2.2 * r0, Math.max(PAD + 2.2 * r0, low)), r0, pick(COLORS), cruise());
      if (clearOfText(o) && startSplit(o)) { balls.push(o); break; }
    }
    for (var tries = 0; tries < 600 && balls.length < Math.round(target * 0.8); tries++) {
      var r = R * pick(SIZES), x = rand(0.02, 0.98) * W, y = rand(PAD + r, H - PAD - r), ok = true;
      for (var i = 0; i < balls.length && ok; i++) {
        var q = balls[i], gap = q.split ? 2.4 * q.r : q.r;
        ok = Math.hypot(q.x - x, q.y - y) > gap + r + R * 1.2;
      }
      if (ok) balls.push(makeBall(x, y, r, pick(COLORS), cruise()));
    }
  }

  /* ---- drawing ----------------------------------------------------------- */

  function disc(x, y, r, fill) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawSplit(b) {
    var s = b.split, u = s.t;
    var broken = smooth(0, 0.14, u) * (1 - smooth(0.84, 1, u)); // how visible the cuts are
    var cut = Math.max(0.75, b.r * 0.04) * broken;

    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#fff';
    for (var n = 0; n < s.pieces.length; n++) {
      var p = s.pieces[n];
      var w = ease(clamp((u - 0.05 - p.wait) / 0.76, 0, 1));
      var d = s.dest[p.to];
      var a0 = lerp(p.a0, p.b0, w), a1 = lerp(p.a1, p.b1, w), mid = (a0 + a1) / 2;
      var out = p.burst * Math.sin(Math.PI * w);
      var cx = b.x + d.x * w + Math.cos(mid) * out;
      var cy = b.y + d.y * w + Math.sin(mid) * out;
      var rm = (p.r0 + p.r1) / 2;
      var px = cx + Math.cos(mid) * rm, py = cy + Math.sin(mid) * rm;

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(p.spin * Math.sin(Math.PI * w));
      ctx.translate(-px, -py);
      ctx.beginPath();
      if (p.r0 > 0) {
        ctx.arc(cx, cy, p.r1, a0, a1);
        ctx.arc(cx, cy, p.r0, a1, a0, true);
      } else {
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, p.r1, a0, a1);
      }
      ctx.closePath();
      ctx.fillStyle = rgb(b.c, p.tone * broken);
      ctx.fill();
      if (cut > 0.05) { ctx.lineWidth = cut; ctx.stroke(); }
      ctx.restore();
    }

    // Whole, seamless balls at either end hide the cuts while they open and close.
    var before = 1 - smooth(0, 0.1, u), after = smooth(0.9, 1, u);
    if (before > 0) {
      ctx.globalAlpha = before;
      disc(b.x, b.y, b.r, b.fill);
    }
    if (after > 0) {
      ctx.globalAlpha = after;
      disc(b.x + s.dest[0].x, b.y + s.dest[0].y, b.r, b.fill);
      disc(b.x + s.dest[1].x, b.y + s.dest[1].y, b.r, b.fill);
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var i;
    for (i = 0; i < balls.length; i++) if (!balls[i].split) disc(balls[i].x, balls[i].y, balls[i].r, balls[i].fill);
    for (i = 0; i < balls.length; i++) if (balls[i].split) drawSplit(balls[i]);
  }

  /* ---- loop -------------------------------------------------------------- */

  var raf = 0, last = 0, onScreen = true;

  function frame(now) {
    raf = 0;
    var dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    step(dt);
    draw();
    play();
  }

  function play() {
    if (raf || still || !onScreen || document.hidden || !W) return;
    if (!last) last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // Reduced motion: run the simulation quietly until a split is half done, then hold that frame.
  function stillFrame() {
    populate();
    for (var n = 0; n < 60 * 30; n++) {
      step(1 / 60);
      var caught = false;
      for (var i = 0; i < balls.length; i++) if (balls[i].split && balls[i].split.t > 0.42) caught = true;
      if (caught && n > 60 * 6) break;
    }
    draw();
  }

  function onResize() {
    var hadSize = W > 0;
    if (!resize()) return;
    measureVeils();
    if (still) { stillFrame(); return; }
    if (!hadSize) populate();
    for (var i = 0; i < balls.length; i++) balls[i].y = clamp(balls[i].y, balls[i].r, H - balls[i].r);
    draw();
    play();
  }

  if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(canvas);
  else window.addEventListener('resize', onResize);
  onResize();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureVeils);

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      onScreen = entries[0].isIntersecting;
      if (onScreen) { last = 0; play(); }
    }).observe(canvas);
  }
  document.addEventListener('visibilitychange', function () { last = 0; play(); });
})();

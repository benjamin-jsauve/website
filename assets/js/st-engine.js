/* spacetime — WebGL2 engine: owns the canvas, uniforms and page textures. */
(function () {
  var ST = (window.ST = window.ST || {});

  var S = (ST.state = {
    W: 1, H: 1, quality: 1,
    mouse: { x: -9999, y: -9999, tx: -9999, ty: -9999, on: 0, target: 0, boost: 1, boostTarget: 1 },
    scroll: 0,
    ripples: [],
    warp: { on: 0, T: 0, P: [0, 0], C: [0, 0], rev: 0, seed: 0, spin: 1 },
    t0: performance.now()
  });

  var UNIFORMS = ['uRes', 'uScale', 'uView', 'uTime', 'uMouse', 'uMouseOn', 'uScroll', 'uRip', 'uWarp', 'uT',
    'uP', 'uC', 'uRev', 'uSeed', 'uSpin', 'uTexA', 'uTexB', 'uHasA', 'uHasB'];

  function Engine(canvas) {
    this.canvas = canvas;
    this.ok = false;
    this.has = [0, 0];
    this.frameTimes = [];
    this.lastQualityChange = 0;
    this.maxScale = Math.min(window.devicePixelRatio || 1, 2);
    // phones: start at a lighter resolution, adapt() can climb back up
    if (window.matchMedia && matchMedia('(pointer: coarse)').matches) S.quality = 0.75;
  }

  Engine.prototype.init = function () {
    var self = this, c = this.canvas;
    var gl = c.getContext('webgl2', {
      antialias: false, alpha: false, depth: false, stencil: false,
      premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance'
    });
    if (!gl) return Promise.resolve(false);
    this.gl = gl;
    if (!this._lossBound) {
      this._lossBound = true;
      c.addEventListener('webglcontextlost', function (e) { e.preventDefault(); self.ok = false; }, false);
      c.addEventListener('webglcontextrestored', function () { self.build(); }, false);
    }
    return this.build().then(function (ok) { if (ok) self.resize(); return ok; });
  };

  Engine.prototype.compile = function (type, src) {
    var gl = this.gl, sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  };

  /* Compile + link. With KHR_parallel_shader_compile the driver compiles off the
     main thread and we poll for completion instead of blocking the page. */
  Engine.prototype.build = function () {
    var self = this, gl = this.gl;
    var par = gl.getExtension('KHR_parallel_shader_compile');
    var vs = this.compile(gl.VERTEX_SHADER, ST.VERT), fs = this.compile(gl.FRAGMENT_SHADER, ST.FRAG);
    var p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    return new Promise(function (resolve) {
      (function poll() {
        if (gl.isContextLost()) return resolve(false);
        if (par && !gl.getProgramParameter(p, par.COMPLETION_STATUS_KHR)) return setTimeout(poll, 16);
        resolve(self.link(p, vs, fs));
      })();
    });
  };

  Engine.prototype.link = function (p, vs, fs) {
    var gl = this.gl;
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.warn('[spacetime] shader failed:\n' + (gl.getShaderInfoLog(fs) || '') + (gl.getShaderInfoLog(vs) || '') + gl.getProgramInfoLog(p));
      return (this.ok = false);
    }
    this.prog = p;
    this.u = {};
    for (var i = 0; i < UNIFORMS.length; i++) this.u[UNIFORMS[i]] = gl.getUniformLocation(p, UNIFORMS[i]);

    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;

    this.tex = [this.makeTex(), this.makeTex()];
    this.has = [0, 0];
    this.ok = true;
    return true;
  };

  Engine.prototype.makeTex = function () {
    var gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };

  /** Upload a page snapshot (canvas) into slot 0 (outgoing/A) or 1 (incoming/B). */
  Engine.prototype.setTexture = function (slot, source) {
    if (!this.ok) return;
    var gl = this.gl;
    if (!source) { this.has[slot] = 0; return; }
    gl.bindTexture(gl.TEXTURE_2D, this.tex[slot]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.has[slot] = 1;
  };

  /** Device pixels per CSS pixel for the drawing buffer (and page snapshots). */
  Engine.prototype.scale = function () { return this.maxScale * S.quality; };

  Engine.prototype.resize = function () {
    var c = this.canvas;
    var W = c.clientWidth || window.innerWidth, H = c.clientHeight || window.innerHeight;
    this.maxScale = Math.min(window.devicePixelRatio || 1, 2);
    var k = this.scale();
    var bw = Math.max(1, Math.round(W * k)), bh = Math.max(1, Math.round(H * k));
    if (c.width !== bw) c.width = bw;
    if (c.height !== bh) c.height = bh;
    S.W = W; S.H = H;
  };

  /** Adaptive resolution: back off when frames are slow, recover when fast (only when idle). */
  Engine.prototype.adapt = function (dt, now) {
    var warping = !!S.warp.on, f = this.frameTimes;
    f.push(dt);
    if (f.length < (warping ? 12 : 45)) return;
    var avg = f.reduce(function (a, b) { return a + b; }, 0) / f.length;
    f.length = 0;
    if (now - this.lastQualityChange < (warping ? 300 : 1500)) return;
    var q = S.quality;
    if (avg > 24 && q > 0.5) q = Math.max(0.5, q * 0.8);
    else if (!warping && avg < 12 && q < 1) q = Math.min(1, q * 1.15);
    if (q !== S.quality) { S.quality = q; this.lastQualityChange = now; this.resize(); }
  };

  Engine.prototype.render = function (now) {
    if (!this.ok) return;
    var gl = this.gl, c = this.canvas, u = this.u, w = S.warp;
    var t = (now - S.t0) / 1000;
    gl.viewport(0, 0, c.width, c.height);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);

    gl.uniform2f(u.uRes, c.width, c.height);
    gl.uniform2f(u.uScale, c.width / S.W, c.height / S.H);
    gl.uniform2f(u.uView, S.W, S.H);
    gl.uniform1f(u.uTime, t);
    gl.uniform2f(u.uMouse, S.mouse.x, S.H - S.mouse.y);
    gl.uniform1f(u.uMouseOn, S.mouse.on * S.mouse.boost);
    gl.uniform1f(u.uScroll, S.scroll);

    var rip = new Float32Array(16);
    for (var i = 0; i < 4; i++) {
      var r = S.ripples[i];
      if (!r) continue;
      rip[i * 4] = r.x; rip[i * 4 + 1] = S.H - r.y; rip[i * 4 + 2] = r.t; rip[i * 4 + 3] = r.amp;
    }
    gl.uniform4fv(u.uRip, rip);

    gl.uniform1f(u.uWarp, w.on ? 1 : 0);
    gl.uniform1f(u.uT, w.T);
    gl.uniform2f(u.uP, w.P[0], S.H - w.P[1]);
    gl.uniform2f(u.uC, w.C[0], S.H - w.C[1]);
    gl.uniform1f(u.uRev, w.rev ? 1 : 0);
    gl.uniform1f(u.uSeed, w.seed);
    gl.uniform1f(u.uSpin, w.spin);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex[0]);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tex[1]);
    gl.uniform1i(u.uTexA, 0);
    gl.uniform1i(u.uTexB, 1);
    gl.uniform1f(u.uHasA, this.has[0]);
    gl.uniform1f(u.uHasB, this.has[1]);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  /** Emit a gravitational wave at viewport point (x, y) in CSS px. */
  ST.ripple = function (x, y, amp) {
    S.ripples.unshift({ x: x, y: y, t: (performance.now() - S.t0) / 1000, amp: amp == null ? 1 : amp });
    if (S.ripples.length > 4) S.ripples.length = 4;
  };

  ST.Engine = Engine;
})();

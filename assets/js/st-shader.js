/* spacetime — GLSL ES 3.00 shaders.
   One full-screen pass. All transition visuals are pure functions of uT so
   that playing uT backwards (browser Back) is an exact time reversal. */
(function () {
  var ST = (window.ST = window.ST || {});

  ST.VERT = [
    '#version 300 es',
    'in vec2 aPos;',
    'void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  ST.FRAG = `#version 300 es
precision highp float;

uniform vec2  uRes;      // drawing buffer, device px
uniform vec2  uScale;    // device px per css px
uniform vec2  uView;     // viewport, css px
uniform float uTime;     // seconds
uniform vec2  uMouse;    // css px, y up
uniform float uMouseOn;  // 0..1 lens presence
uniform float uScroll;   // css px
uniform vec4  uRip[4];   // gravitational waves: x, y, t0, amp
uniform float uWarp;     // 0 idle | 1 transition
uniform float uT;        // transition progress 0..1
uniform vec2  uP;        // collapse point (css px, y up)
uniform vec2  uC;        // emergence point
uniform float uRev;      // 1 while rewinding
uniform float uSeed;
uniform float uSpin;     // +1 / -1 frame-dragging direction
uniform sampler2D uTexA; // outgoing page (premultiplied)
uniform sampler2D uTexB; // incoming page
uniform float uHasA;
uniform float uHasB;
uniform float uLight;    // 0 dark theme | 1 light theme

out vec4 outColor;

#define PI  3.14159265359
#define TAU 6.28318530718

const vec3 PAPER = vec3(.945, .937, .914);   // light --bg (#f1efe9)
const vec3 INK   = vec3(.071, .071, .082);   // light --ink (#121215)
const vec3 GRID  = vec3(.32, .44, .74);      // graph-paper blue

float gVig = 1.0;
float gPaper = 0.;   // how much of the sky here is printed on paper (light theme)

/* ---------- hashing & noise ---------- */
float h11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2  h22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }

float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
// value noise, periodic in x with integer period k (for angular coordinates)
float pnoise(vec2 p, float k){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  float x0 = mod(i.x, k), x1 = mod(i.x + 1., k);
  return mix(mix(h21(vec2(x0, i.y)), h21(vec2(x1, i.y)), u.x),
             mix(h21(vec2(x0, i.y + 1.)), h21(vec2(x1, i.y + 1.)), u.x), u.y);
}
float fbm3(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 3; i++){ s += a * vnoise(p); p = p * 2.07 + 11.3; a *= .5; } return s; }
float pfbm(vec2 p, float k){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a * pnoise(p, k); p = p * 2. + vec2(0., 7.31); k *= 2.; a *= .5; } return s; }

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float maxCorner(vec2 P){ vec2 a = max(P, uView - P); return length(a); }

/* ---------- the universe behind the page ---------- */
vec3 starLayer(vec2 p, float cell, float seed, float dens, float bright){
  vec2 g = p / cell; vec2 id = floor(g); vec2 f = fract(g);
  float h = h21(id + seed * 17.31);
  if (h < 1. - dens) return vec3(0.);
  vec2 o = .2 + .6 * h22(id + seed * 3.7);
  vec2 d = (f - o) * cell;
  float r2 = dot(d, d);
  float hs = h21(id * 1.7 + seed);
  float s = mix(.55, 1.5, hs * hs * hs);
  float tw = .72 + .28 * sin(uTime * (.5 + 2.2 * h) + h * 91.);
  vec3 col = mix(vec3(1., .80, .64), vec3(.70, .82, 1.), h21(id + seed * 9.1));
  return col * bright * tw * (exp(-r2 / (s * s)) + .06 * exp(-r2 / (s * s * 20.)));
}

float gridLine(vec2 p, float g){
  vec2 d = abs(fract(p / g - .5) - .5) * g;
  return 1. - smoothstep(.3, 1.15, min(d.x, d.y));
}

vec3 space(vec2 p, float glow){
  vec2 q = p * .0010 + vec2(uTime * .003, -uScroll * .00004);
  float n = smoothstep(.45, .88, fbm3(q));
  float n2 = smoothstep(.52, .90, fbm3(q * 2.3 + 5.2));
  vec3 st = starLayer(p - vec2(0., uScroll * .05), 150., 1., .55, 1.0)
          + starLayer(p - vec2(0., uScroll * .12),  84., 2., .34, .78)
          + starLayer(p - vec2(0., uScroll * .22),  44., 3., .20, .52);
  float gl = gridLine(p - vec2(0., uScroll * .30), 72.);

  vec3 c = vec3(.010, .010, .017);
  c += vec3(.050, .026, .085) * n;
  c += vec3(.000, .022, .040) * n2;
  c += st;
  c += vec3(.52, .60, .90) * gl * (.040 + glow);
  c *= gVig;
  if (gPaper <= 0.) return c;

  // the same sky printed as a chart: nebulae as washes, stars in ink, graph-paper grid
  vec3 l = PAPER * (1. - vec3(.030, .042, .008) * n) * (1. - vec3(.026, .010, .000) * n2);
  l = mix(l, INK, clamp(dot(st, vec3(.3, .5, .2)) * .8, 0., .9));
  l = mix(l, GRID, gl * (.055 + glow * 1.2));
  l *= mix(1., gVig, .05);
  return mix(c, l, gPaper);
}

/* gravitational waves from clicks */
vec2 ripples(vec2 p){
  vec2 disp = vec2(0.);
  for (int i = 0; i < 4; i++){
    vec4 r = uRip[i];
    float age = uTime - r.z;
    if (r.w <= 0. || age < 0. || age > 3.) continue;
    vec2 d = p - r.xy; float rr = length(d) + 1e-3;
    float x = rr - age * 640.;
    float env = exp(-x * x / (2. * 70. * 70.)) * exp(-age * 1.3) * r.w;
    float ang = atan(d.y, d.x);
    disp += (d / rr) * sin(x * .05) * env * 15. * (.7 + .3 * cos(2. * ang));
  }
  return disp;
}

vec3 idle(vec2 p){
  vec2 q = p + ripples(p);
  vec2 d = q - uMouse;
  float r2 = dot(d, d);
  float rE = 40. * uMouseOn;
  float L = rE * rE;
  vec2 src = q - d * L / (r2 + 60.) * exp(-r2 / 90000.);
  float near = exp(-r2 / (L * 9. + 1.)) * uMouseOn;
  vec3 c = space(src, .12 * near);
  float r = sqrt(r2);
  float ring = exp(-pow((r - rE) / 2.6, 2.)) * uMouseOn;
  c += vec3(.62, .72, 1.) * .055 * ring * (1. - gPaper);
  return mix(c, GRID, .16 * ring * gPaper);
}

/* ---------- content textures ---------- */
vec4 texA(vec2 pc){
  vec2 uv = pc / uView;
  float inb = step(0., uv.x) * step(0., uv.y) * step(uv.x, 1.) * step(uv.y, 1.);
  return textureLod(uTexA, uv, 0.) * inb * uHasA;
}
vec4 texB(vec2 pc){
  vec2 uv = pc / uView;
  float inb = step(0., uv.x) * step(0., uv.y) * step(uv.x, 1.) * step(uv.y, 1.);
  return textureLod(uTexB, uv, 0.) * inb * uHasB;
}

/* ---------- wormhole interior ---------- */
vec3 tunnel(vec2 p, float T){
  float m = smoothstep(.28, .62, T);
  vec2 V = mix(uP, uC, m);
  float R = min(uView.x, uView.y);
  vec2 q = (p - V) / R;
  float rr = length(q) + 1e-4;
  float a = atan(q.y, q.x);
  float travel = 22. * (T - sin(TAU * T) / TAU);
  float z = .3 / rr;
  float zz = z + travel;
  float tw = a + uSpin * (z * .22 + T * 2.2);

  vec3 col = vec3(.014, .010, .045);
  float cl = pfbm(vec2((tw + PI) / TAU * 7., zz * .55), 7.);
  float far = smoothstep(.0, .35, rr);
  col += mix(vec3(.24, .12, .78), vec3(.12, .68, 1.), smoothstep(.35, .75, cl)) * pow(cl, 2.2) * 1.5 * far;

  // spacetime grid rolled into a tube (analytic line widths, no derivatives)
  float ga = abs(fract((tw + PI) / TAU * 18.) - .5) * (TAU / 18.) * rr * R;
  float gz = abs(fract(zz * .8) - .5) / .8 * rr * rr * R / .3;
  float lines = max(1. - smoothstep(.4, 1.5, ga), 1. - smoothstep(.4, 1.5, gz));
  col += vec3(.45, .55, 1.) * lines * .38 * smoothstep(.05, .5, rr) * (1. - smoothstep(1.2, 2., rr));

  // hyperspace streaks, blue-shifted ahead and red-shifted behind (starbow)
  float sa = (a + PI) / TAU * 240.;
  float sid = floor(sa); float sf = fract(sa) - .5;
  float hs = h11(sid + floor(uSeed * 100.));
  float pos = fract(zz * (.05 + .06 * hs) + hs * 7.3);
  float streak = smoothstep(.80, .985, pos) * (1. - smoothstep(.985, 1., pos));
  float wpx = abs(sf) * (TAU / 240.) * rr * R;
  streak *= exp(-wpx * wpx / .8) * step(.55, hs);
  vec3 sb = mix(vec3(.72, .86, 1.), vec3(1., .42, .25), smoothstep(.2, 1., rr));
  col += sb * streak * 2.2 * smoothstep(.02, .2, rr);

  col += vec3(.85, .90, 1.) * .045 / (rr * rr * 30. + .045);
  return col;
}

/* ---------- phase 1: collapse into a black hole at uP ---------- */
float horizon(float c, float Rcov){ return 3. * smoothstep(0., .05, c) + pow(c, 2.25) * Rcov; }

// shattered spacetime: radial + concentric cracks around uP (like impact glass)
// returns xy = displacement (display -> source), z = crack glow
vec3 shatter(vec2 p, float c, float Rcov){
  vec2 d = p - uP; float r = length(d) + 1e-3; float ang = atan(d.y, d.x);
  float Ns = 11.;
  float jit = .35 * sin(ang * 3. + uSeed * 40.) + .02 * (vnoise(vec2(r * .08, uSeed * 7.)) - .5);
  float a = (ang + PI) / TAU * Ns + jit;
  float dadphi = Ns / TAU + 1.05 * cos(ang * 3. + uSeed * 40.);   // sectors are uneven: convert to px properly
  float sec = floor(a); float fa = fract(a);
  float hs0 = h11(mod(sec, Ns) + uSeed * 31.);
  float lr = log(r * .02 + 1.) * 2.6 + hs0 * .9;
  float ring = floor(lr); float fr = fract(lr);
  float hs = h21(vec2(mod(sec, Ns), ring) + uSeed * 13.);
  float dSec = min(fa, 1. - fa) / dadphi * r;
  float dRing = min(fr, 1. - fr) / (2.6 * .02 / (r * .02 + 1.));
  float dC = min(dSec, dRing);
  float front = smoothstep(0., .32, c) * Rcov * 1.15;
  float formed = 1. - smoothstep(front - 80., front, r);
  float crack = exp(-dC * dC / .45) * formed * (1. - smoothstep(.22, .5, c)) * smoothstep(0., .03, c) * exp(-r / (Rcov * .55));
  float st = clamp((c - .05 - hs * .2) / .55, 0., 1.);
  float off = st * st * (24. + 80. * hs) * formed;
  float aC = (sec + .5) / Ns * TAU - PI;
  return vec3(vec2(cos(aC), sin(aC)) * off, crack);
}

vec2 collapseSrc(vec2 p, float c, float Rcov, out float red){
  float rh = horizon(c, Rcov);
  vec2 d = p - uP; float r = length(d) + 1e-3; vec2 n = d / r;
  float L = pow(rh * 1.2, 2.);
  vec2 beta = d - n * (L / r);                 // lens equation
  float rb = length(beta) + 1e-3;
  float k = rh * 1.05 + Rcov * .40 * pow(c, 1.6);
  float s = sqrt(rb * rb + k * k);             // infall: radial stretch, tangential squeeze
  float sw = uSpin * 6.5 * c * c * (rh + 120.) / (rb + rh * .5 + 120.);   // frame dragging
  float ph = atan(beta.y, beta.x) - sw;
  red = smoothstep(rh * 3. + 60., rh, r) * smoothstep(0., .12, c);
  return uP + s * vec2(cos(ph), sin(ph));
}

vec3 collapseCol(vec2 p, float T){
  float c = clamp(T / .42, 0., 1.);
  float Rcov = maxCorner(uP) * 1.04;
  vec3 sh = shatter(p, c, Rcov);
  vec2 ps = p + sh.xy;
  float rh = horizon(c, Rcov);
  vec2 d = ps - uP; float r = length(d) + 1e-3; vec2 n = d / r;
  float ang = atan(d.y, d.x);
  // light theme: the hole burns through the paper, a ragged scorch running ahead of the horizon
  float rag = 1. + .16 * (pnoise(vec2((ang + PI) / TAU * 9., T * 1.5), 9.) - .5);
  float burn = smoothstep(rh * 3.2 + 40., rh * 2.2 + 10., r * rag) * smoothstep(0., .2, c);
  gPaper = uLight * (1. - burn);
  vec3 col;

  if (r < rh){
    col = tunnel(p, T) * smoothstep(.12, .7, c);
    col *= mix(1., .15, smoothstep(rh * .55, rh, r));
  } else {
    // lensed + dragged background
    float L = pow(rh * 1.2, 2.);
    vec2 beta = d - n * (L / r);
    float sw = uSpin * 3. * c * c * (rh + 120.) / (length(beta) + rh * .5 + 120.);
    vec3 bg = space(uP + rot(sw) * beta * (1. + .3 * c), .14 * c);
    bg *= mix(vec3(1.), vec3(.80, .58, .36), uLight * burn * (1. - burn) * 3.);   // scorched paper browns before it goes

    // the page itself, with chronophotographic echoes (time-smeared trails)
    vec3 acc = vec3(0.), accA = vec3(0.); float ws = 0.;
    for (int k = 0; k < 5; k++){
      float ck = c - float(k) * .03;
      float w = (k == 0 ? 1. : exp(-float(k) * .85) * smoothstep(.12, .5, c)) * step(0., ck);
      float rk;
      vec2 sk = collapseSrc(ps, max(ck, 0.), Rcov, rk);
      float ca = (1.5 * smoothstep(0., .1, c) + 30. * c * c) * (.35 + rk);
      vec4 sr = texA(sk + n * ca), sg = texA(sk), sb = texA(sk - n * ca);
      vec3 tint = mix(vec3(1.), vec3(1., .32, .12), rk) * (1. - .7 * rk);
      vec3 cA = vec3(sr.r, sg.g, sb.b), aA = vec3(sr.a, sg.a, sb.a);
      // dark ink can't redden into the dark, so on paper it heats up like an ember instead
      vec3 heat = mix(cA, vec3(1., .42, .14) * aA * 1.2, rk);
      acc  += mix(cA * tint, heat, uLight) * w;
      accA += aA * (1. - .55 * rk) * w;
      ws += w;
    }
    acc /= ws; accA /= ws;
    col = bg * (1. - accA) + acc;

    // accretion disk
    float on = smoothstep(.03, .22, c);
    float dIn = rh * 1.12, dOut = rh * 2.9 + 50.;
    float band = smoothstep(dIn, dIn + 4. + rh * .1, r) * (1. - smoothstep(dIn + rh * .25, dOut, r));
    float sa = ang + uSpin * (T * 9. + 4. * c) * (rh + 60.) / (r + 60.);
    float dn = pfbm(vec2((sa + PI) / TAU * 16., log(r + 1.) * 7. - T * 3.), 16.);
    float beam = .62 + .38 * cos(ang - uSpin * 1.2);
    float temp = smoothstep(dOut, dIn, r);
    vec3 dcol = mix(vec3(.95, .26, .07), vec3(1., .86, .62), temp);
    dcol = mix(dcol, vec3(.86, .92, 1.), temp * temp * .5);
    col += dcol * band * pow(dn, 1.7) * 2.6 * beam * on;
    // photon ring
    col += vec3(1., .86, .7) * exp(-pow((r - rh * 1.03) / (1.2 + rh * .012), 2.)) * 1.5 * on;
  }
  col += vec3(.72, .86, 1.) * sh.z * .6 * (1. - gPaper);
  col *= 1. - vec3(.6, .5, .32) * sh.z * .7 * gPaper;   // on paper the fractures are drawn in pencil
  return col;
}

/* ---------- phase 3: white hole at uC, the new page inside an expanding light cone ---------- */
vec3 emergeCol(vec2 p, float T){
  float e = clamp((T - .6) / .4, 0., 1.);
  vec2 d = p - uC; float r = length(d) + 1e-3; vec2 n = d / r;
  float Rmax = maxCorner(uC) * 1.06;
  float Rc = Rmax * (1. - pow(1. - e, 3.));
  float edge = r - Rc;
  vec3 col;
  if (edge > 0.){
    col = tunnel(p, T) * (1. - .5 * e);
    col += vec3(.65, .82, 1.) * exp(-edge * edge / (2. * pow(8. + 26. * (1. - e), 2.))) * 1.3 * (1. - .6 * e);
  } else {
    float w = 26. + 110. * (1. - e);
    float shell = exp(-edge * edge / (2. * w * w));
    float infl = .5 * pow(1. - e, 3.);
    vec2 src = uC + d * (1. + infl) - n * shell * 34. * (1. - e);
    vec3 bg = space(src, 0.);
    vec3 acc = vec3(0.), accA = vec3(0.); float ws = 0.;
    for (int k = 0; k < 4; k++){
      float ek = max(e - float(k) * .035, 0.);
      float w2 = (k == 0 ? 1. : exp(-float(k) * 1.1) * pow(1. - e, 1.5)) * step(0., e - float(k) * .035);
      vec2 sk = uC + d * (1. + .5 * pow(1. - ek, 3.)) - n * shell * 34. * (1. - ek);
      float ca = (shell * 16. + 4.) * (1. - e);
      vec4 sr = texB(sk + n * ca), sg = texB(sk), sb = texB(sk - n * ca);
      acc  += vec3(sr.r, sg.g, sb.b) * w2;
      accA += vec3(sr.a, sg.a, sb.a) * w2;
      ws += w2;
    }
    acc /= ws; accA /= ws;
    col = bg * (1. - accA) + acc;
    // adding light to paper only clips to white: there the blue-shifted front is a cool wash instead
    col += vec3(.55, .75, 1.) * shell * .22 * (1. - e) * (1. - gPaper);
    col = mix(col, col * vec3(.84, .91, 1.), shell * (1. - e) * gPaper);
  }
  float fl = pow(1. - e, 4.) * (edge > 0. ? 1. : 1. - .75 * gPaper);
  col += vec3(.92, .95, 1.) * exp(-r * r / (2. * pow(40. + 500. * e, 2.))) * fl * 2.;
  return col;
}

/* ---------- transition: time fractures + rewind artefacts ---------- */
vec3 warp(vec2 p){
  float T = uT;
  float amt = sin(PI * T);

  // time fracture: random horizontal slices sit at a different moment
  float row = floor((p.y + uSeed * 577.) / 26.);
  float fl = floor(T * 20.);
  float act = step(.95, h21(vec2(row, fl + uSeed * 11.))) * amt * amt;
  float Tl = clamp(T + (h21(vec2(row * 1.37, fl + 3.)) - .5) * .14 * act, 0., 1.);
  vec2 pp = p + vec2((h21(vec2(row * 2.11, fl + 7.)) - .5) * 70. * act, 0.);

  float rv = uRev * amt;
  float band = 0.;
  if (uRev > .5){
    float roll = fract(p.y / uView.y * .9 - T * 3.);
    band = smoothstep(0., .04, roll) * (1. - smoothstep(.04, .14, roll));
    pp.x += (vnoise(vec2(p.y * .09, T * 90.)) - .5) * 26. * rv * (.3 + 2.5 * band);
  }

  vec3 col = Tl < .6 ? collapseCol(pp, Tl) : emergeCol(pp, Tl);

  if (uRev > .5){
    float lum = dot(col, vec3(.3, .59, .11));
    col = mix(col, lum * vec3(.85, .96, 1.15), .35 * rv);
    col *= 1. - .16 * rv * (.5 + .5 * sin(p.y * PI));
    col += vec3(.5, .6, .8) * band * .12 * rv;
  }
  return col;
}

void main(){
  vec2 p = gl_FragCoord.xy / uScale;
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 vq = (uv - .5) * vec2(uView.x / uView.y, 1.);
  gVig = mix(.5, 1., smoothstep(1.25, .3, length(vq)));
  gPaper = uLight;
  vec3 col = uWarp > .5 ? warp(p) : idle(p);
  col += (h21(gl_FragCoord.xy + fract(uTime * 7.) * 91.) - .5) / 255.;
  outColor = vec4(col, 1.);
}
`;
})();

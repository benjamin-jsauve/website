/* spacetime — DOM → canvas rasterizer.
   Re-draws the visible part of an element (text, solid boxes, borders) into a
   2D canvas at the exact positions the browser laid it out, so the shader can
   bend the real page. Handles what the site uses inside <main>: text,
   backgrounds, borders, border-radius, underlines, opacity, text-transform. */
(function () {
  var ST = (window.ST = window.ST || {});

  function alphaOf(c) {
    if (!c || c === 'transparent') return 0;
    var m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return 1;
    var parts = m[1].split(/[\s,\/]+/).filter(Boolean);
    return parts.length > 3 ? parseFloat(parts[3]) : 1;
  }

  function radiusOf(v, w, h) {
    if (!v) return 0;
    var r = v.indexOf('%') > -1 ? (parseFloat(v) / 100) * Math.min(w, h) : parseFloat(v) || 0;
    return Math.max(0, Math.min(r, w / 2, h / 2));
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (r <= 0) { ctx.rect(x, y, w, h); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function transformText(s, tt) {
    if (tt === 'uppercase') return s.toUpperCase();
    if (tt === 'lowercase') return s.toLowerCase();
    return s;
  }

  /**
   * rasterize(root, canvas, scale, W, H) → canvas
   * root's own opacity is ignored (staged pages are opacity:0 while captured).
   */
  ST.rasterize = function (root, canvas, scale, W, H) {
    var cw = Math.max(1, Math.round(W * scale)), ch = Math.max(1, Math.round(H * scale));
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.setTransform(cw / W, 0, 0, ch / H, 0, 0);
    if ('fontKerning' in ctx) ctx.fontKerning = 'normal';

    var styles = new Map(), ops = new Map();
    function cs(el) { var s = styles.get(el); if (!s) { s = getComputedStyle(el); styles.set(el, s); } return s; }
    function opacity(el) {
      if (!el || el === root) return 1;
      var o = ops.get(el);
      if (o === undefined) { o = parseFloat(cs(el).opacity) * opacity(el.parentElement); ops.set(el, o); }
      return o;
    }
    function hidden(el) {
      for (var n = el; n && n !== root; n = n.parentElement) {
        var s = cs(n);
        if (s.display === 'none') return true;
      }
      return cs(el).visibility === 'hidden';
    }

    /* pass 1 — boxes, in document order so parents paint under children */
    var els = root.querySelectorAll('*');
    for (var i = 0; i < els.length; i++) {
      var el = els[i], s = cs(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      var bgA = alphaOf(s.backgroundColor);
      var bt = parseFloat(s.borderTopWidth) || 0, br = parseFloat(s.borderRightWidth) || 0,
          bb = parseFloat(s.borderBottomWidth) || 0, bl = parseFloat(s.borderLeftWidth) || 0;
      var hasB = (bt && alphaOf(s.borderTopColor)) || (br && alphaOf(s.borderRightColor)) ||
                 (bb && alphaOf(s.borderBottomColor)) || (bl && alphaOf(s.borderLeftColor));
      if (!bgA && !hasB) continue;
      var r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) continue;
      var o = opacity(el);
      if (o <= 0) continue;
      ctx.globalAlpha = o;
      var rad = radiusOf(s.borderTopLeftRadius, r.width, r.height);
      if (bgA) {
        ctx.fillStyle = s.backgroundColor;
        roundRectPath(ctx, r.left, r.top, r.width, r.height, rad);
        ctx.fill();
      }
      if (hasB) {
        var uniform = bt === br && bt === bb && bt === bl &&
          s.borderTopColor === s.borderRightColor && s.borderTopColor === s.borderBottomColor && s.borderTopColor === s.borderLeftColor;
        if (uniform && bt > 0) {
          ctx.strokeStyle = s.borderTopColor; ctx.lineWidth = bt;
          roundRectPath(ctx, r.left + bt / 2, r.top + bt / 2, r.width - bt, r.height - bt, Math.max(0, rad - bt / 2));
          ctx.stroke();
        } else {
          if (bt) { ctx.fillStyle = s.borderTopColor; ctx.fillRect(r.left, r.top, r.width, bt); }
          if (bb) { ctx.fillStyle = s.borderBottomColor; ctx.fillRect(r.left, r.bottom - bb, r.width, bb); }
          if (bl) { ctx.fillStyle = s.borderLeftColor; ctx.fillRect(r.left, r.top, bl, r.height); }
          if (br) { ctx.fillStyle = s.borderRightColor; ctx.fillRect(r.right - br, r.top, br, r.height); }
        }
      }
    }

    /* pass 2 — text */
    var range = document.createRange();
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var text = node.data;
      if (!/\S/.test(text)) continue;
      var pe = node.parentElement;
      if (!pe || hidden(pe)) continue;
      var st = cs(pe);
      var op = opacity(pe);
      if (op <= 0) continue;

      // quick reject if the whole node is off-screen
      range.selectNodeContents(node);
      var nb = range.getBoundingClientRect();
      if (nb.bottom < 0 || nb.top > H || nb.width === 0) continue;

      ctx.globalAlpha = op;
      ctx.fillStyle = st.color;
      ctx.font = st.fontStyle + ' ' + st.fontWeight + ' ' + st.fontSize + ' ' + st.fontFamily;
      ctx.textBaseline = 'alphabetic';
      var fm = ctx.measureText('Hg');
      var asc = fm.fontBoundingBoxAscent, desc = fm.fontBoundingBoxDescent;
      if (!(asc > 0)) { asc = parseFloat(st.fontSize) * 0.8; desc = parseFloat(st.fontSize) * 0.2; }
      var ls = parseFloat(st.letterSpacing) || 0;
      var tt = st.textTransform;
      var perChar = ls !== 0;

      var re = perChar ? /[^\s]/gu : /\S+/g, m;
      while ((m = re.exec(text))) {
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        var rects = range.getClientRects();
        if (!rects.length) continue;
        if (rects.length > 1 && !perChar) {
          // word broken across lines: draw it glyph by glyph
          for (var j = 0; j < m[0].length; j++) {
            range.setStart(node, m.index + j); range.setEnd(node, m.index + j + 1);
            var cr = range.getClientRects()[0];
            if (!cr) continue;
            var cb = cr.top + (cr.height - (asc + desc)) / 2 + asc;
            ctx.fillText(transformText(m[0][j], tt), cr.left, cb);
          }
          continue;
        }
        var rr = rects[0];
        if (rr.bottom < 0 || rr.top > H) continue;
        var base = rr.top + (rr.height - (asc + desc)) / 2 + asc;
        ctx.fillText(transformText(m[0], tt), rr.left, base);
      }

      // underlines, per line box of the text node
      if (st.textDecorationLine && st.textDecorationLine.indexOf('underline') > -1) {
        range.selectNodeContents(node);
        var lines = range.getClientRects();
        var fs = parseFloat(st.fontSize);
        var thick = parseFloat(st.textDecorationThickness) || Math.max(1, fs / 16);
        var off = parseFloat(st.textUnderlineOffset);
        if (isNaN(off)) off = fs * 0.12;
        ctx.fillStyle = st.textDecorationColor || st.color;
        for (var k = 0; k < lines.length; k++) {
          var lr = lines[k];
          if (lr.width < 1) continue;
          var lb = lr.top + (lr.height - (asc + desc)) / 2 + asc;
          ctx.fillRect(lr.left, lb + off, lr.width, thick);
        }
      }
    }
    ctx.globalAlpha = 1;
    range.detach && range.detach();
    return canvas;
  };
})();

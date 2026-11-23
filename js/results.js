/* results.js — the results sections of the page, drawn from model/results.json.
 *
 * model/results.json is written by tools/export_results.py from the companion code's fresh
 * evaluation of the manuscript checkpoint and from the training history recorded with it, so no
 * number in these sections is typed in by hand.  A number in the prose carries
 * data-r="path|format" and keeps its value in the HTML as well, so the text reads the same before
 * the file arrives; once it has, every bound number is set from the file, and
 * tools/test_results.js checks that the HTML and the file agree.  The tables, the charts and the
 * example cards are built here.
 *
 * The first part touches no DOM and is exported as RES, for the test; with a document, RES also
 * carries renderAll, which the test runs against a stand-in DOM.
 */
var RES = (function () {
  'use strict';

  // ----------------------------------------------------------- formatting --
  var MINUS = '−', TIMES = '×', NDASH = '–';
  var SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵',
              '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };

  /* 1234567 -> "1,234,567", with a true minus sign */
  function group(n) {
    var s = String(Math.abs(n)), out = '';
    while (s.length > 3) { out = ',' + s.slice(s.length - 3) + out; s = s.slice(0, s.length - 3); }
    return (n < 0 ? MINUS : '') + s + out;
  }
  function sup(n) { return String(n).split('').map(function (c) { return SUP[c]; }).join(''); }
  function fixed(x, d) { var t = Math.abs(x).toFixed(d); return (x < 0 && Number(t) !== 0 ? MINUS : '') + t; }
  /* 3e-4 -> "3×10⁻⁴", 1e-4 -> "10⁻⁴", 2.477e-15 -> "2.5×10⁻¹⁵" at two significant digits */
  function sci(x, digits) {
    if (x === 0) return '0';
    var e = Math.floor(Math.log10(Math.abs(x))), m = Number((x / Math.pow(10, e)).toPrecision(digits));
    if (Math.abs(m) >= 10) { m = Number((m / 10).toPrecision(digits)); e += 1; }
    else if (Math.abs(m) < 1) { m = Number((m * 10).toPrecision(digits)); e -= 1; }
    return (m === 1 ? '' : String(m).replace('-', MINUS) + TIMES) + '10' + sup(e);
  }

  var FORMATS = {
    raw: function (v) { return String(v); },
    int: function (v) { return group(Math.round(v)); },
    pct: function (v) { return v.toFixed(2) + '%'; },          // values stored as percentages
    num2: function (v) { return fixed(v, 2); },
    num3: function (v) { return fixed(v, 3); },
    num4: function (v) { return fixed(v, 4); },
    sci: function (v) { return sci(v, 3); },
    prob: function (v) { return v < 1e-3 ? sci(v, 2) : v.toFixed(3); }
  };

  function lookup(data, path) {
    var parts = path.split('.'), v = data;
    for (var i = 0; i < parts.length; i++) {
      if (v === null || typeof v !== 'object' || !(parts[i] in v)) throw new Error('model/results.json has no "' + path + '"');
      v = v[parts[i]];
    }
    return v;
  }
  /* "a.b" is a value; "a.b+c.d" is the sum of two (the only arithmetic a binding needs) */
  function value(data, expr) {
    if (expr.indexOf('+') < 0) return lookup(data, expr);
    return expr.split('+').reduce(function (sum, p) { return sum + lookup(data, p); }, 0);
  }
  /* The text of a binding "expr|format" */
  function text(data, spec) {
    var bar = spec.lastIndexOf('|'), expr = bar < 0 ? spec : spec.slice(0, bar), fmt = bar < 0 ? 'raw' : spec.slice(bar + 1);
    if (!FORMATS.hasOwnProperty(fmt)) throw new Error('unknown format "' + fmt + '" in data-r="' + spec + '"');
    var v = value(data, expr);
    if (fmt !== 'raw' && (typeof v !== 'number' || !isFinite(v))) throw new Error('"' + expr + '" is not a number');
    return FORMATS[fmt](v);
  }
  function pctOf(count, n) { return (100 * count / n).toFixed(2) + '%'; }
  /* Kasteleyn entry of a winding (nx, ny): x^nx y^ny */
  function monomial(w) {
    function p(v, n) { return n === 0 ? '' : n === 1 ? v : v + sup(n); }
    var t = [p('x', w[0]), p('y', w[1])].filter(Boolean).join(' ');
    return t || '1';
  }

  var api = { group: group, sup: sup, sci: sci, FORMATS: FORMATS, lookup: lookup, value: value, text: text,
              pctOf: pctOf, monomial: monomial };
  if (typeof document === 'undefined') return api;      // the jsc test: helpers only

  // ------------------------------------------------------------------ DOM --
  var doc = document, SVG_NS = 'http://www.w3.org/2000/svg';
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function $(id) { return doc.getElementById(id); }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  /* Children may be text, nodes, or arrays of either, nested to any depth: helpers such as
     edge() return arrays that go inside other arrays. */
  function append(el, kids) {
    if (kids === undefined || kids === null || kids === false || kids === '') return el;
    if (Array.isArray(kids)) { for (var i = 0; i < kids.length; i++) append(el, kids[i]); return el; }
    el.appendChild(typeof kids === 'string' || typeof kids === 'number' ? doc.createTextNode(String(kids)) : kids);
    return el;
  }
  /* h('td', {class: 'x'}, ['text', node]); text always goes in as a text node */
  function h(tag, attrs, kids) {
    var el = doc.createElement(tag);
    for (var k in attrs) if (attrs.hasOwnProperty(k) && attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) {
      el.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    return append(el, kids);
  }
  function s(tag, attrs, parent) {
    var el = doc.createElementNS(SVG_NS, tag);
    for (var k in attrs) if (attrs.hasOwnProperty(k) && attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }
  /* SVG text from runs [{t, sub}], subscripts by dy shifts as in app.js */
  function sText(parent, x, y, runs, attrs) {
    attrs = attrs || {}; attrs.x = x; attrs.y = y;
    var t = s('text', attrs, parent), shifted = false;
    if (typeof runs === 'string') runs = [{ t: runs }];
    for (var i = 0; i < runs.length; i++) {
      var a = {};
      if (runs[i].sub) { a['font-size'] = '75%'; if (!shifted) { a.dy = '0.4em'; shifted = true; } }
      else if (shifted) { a.dy = '-0.3em'; shifted = false; }
      s('tspan', a, t).appendChild(doc.createTextNode(runs[i].t));
    }
    return t;
  }
  /* <i>N<sub>D</sub></i> and friends */
  function sym(base, sub) { return h('i', null, [base, sub === undefined ? null : h('sub', null, sub)]); }
  function edge(w, b) { return ['(', sym('w', String(w)), ', ', sym('b', String(b)), ')']; }
  function cellNum(count, pct) { return [group(count), h('span', { 'class': 'r-pc' }, pct)]; }

  // -------------------------------------------------------------- tooltip --
  /* One tooltip for every chart.  Rows put the value first and the label after it, as the
     reader already knows the series and wants the number; a short line or dot keys the series. */
  var tip = null;
  /* `title` is text, or a function returning nodes (a node can only be shown in one place) */
  function showTip(title, rows, x, y) {
    if (!tip) { tip = h('div', { 'class': 'r-tip', 'aria-hidden': 'true' }); doc.body.appendChild(tip); }
    clear(tip);
    tip.appendChild(h('div', { 'class': 'r-tip__title' }, typeof title === 'function' ? title() : title));
    for (var i = 0; i < rows.length; i++) {
      tip.appendChild(h('div', { 'class': 'r-tip__row' }, [
        h('span', { 'class': 'r-key r-key--' + (rows[i].key || 'none') }),
        h('span', { 'class': 'r-tip__val' }, rows[i].value),
        h('span', { 'class': 'r-tip__label' }, rows[i].label)
      ]));
    }
    tip.style.display = 'block';
    var w = tip.offsetWidth, ht = tip.offsetHeight, sx = window.pageXOffset, sy = window.pageYOffset;
    var vw = doc.documentElement.clientWidth, left = x + 14, top = y - ht - 14;
    if (left + w > sx + vw - 8) left = x - w - 14;
    if (left < sx + 8) left = sx + 8;
    if (top < sy + 100) top = y + 18;                    // under the sticky navigation: show below
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function hideTip() { if (tip) tip.style.display = 'none'; }
  function pageXY(el, fx, fy) {
    var r = el.getBoundingClientRect();
    return [window.pageXOffset + r.left + r.width * fx, window.pageYOffset + r.top + r.height * fy];
  }
  /* Hover and keyboard focus show the same tooltip; `rows()` builds it on demand. */
  function tipOn(el, title, rows) {
    el.addEventListener('pointermove', function (ev) { showTip(title, rows(), ev.pageX, ev.pageY); });
    el.addEventListener('pointerleave', hideTip);
    el.addEventListener('focus', function () { var p = pageXY(el, 0.75, 0); showTip(title, rows(), p[0], p[1]); });
    el.addEventListener('blur', hideTip);
  }

  function legend(items, extraClass) {
    return h('ul', { 'class': 'r-legend' + (extraClass ? ' ' + extraClass : '') }, items.map(function (it) {
      return h('li', null, [h('span', { 'class': 'r-key r-key--' + it.key, 'aria-hidden': 'true' }), h('span', null, it.label)]);
    }));
  }
  function table(cls, head, body, foot, caption, colgroups) {
    var t = h('table', { 'class': 'r-table' + (cls ? ' ' + cls : '') });
    if (caption) t.appendChild(h('caption', { 'class': 'sr-only' }, caption));
    if (colgroups) append(t, colgroups);
    if (head) t.appendChild(h('thead', null, head));
    t.appendChild(h('tbody', null, body));
    if (foot) t.appendChild(h('tfoot', null, foot));
    return h('div', { 'class': 'r-table-wrap' }, t);
  }
  function host(id) {
    var el = $(id);
    if (el) clear(el);
    return el;
  }

  // -------------------------------------------------- bound numbers (prose) --
  function bindAll(data) {
    var els = doc.querySelectorAll('[data-r]'), changed = [];
    for (var i = 0; i < els.length; i++) {
      var spec = els[i].getAttribute('data-r'), t;
      try { t = text(data, spec); } catch (e) { changed.push(spec + ': ' + e.message); continue; }
      if (els[i].textContent !== t) { changed.push(spec + ': "' + els[i].textContent + '" -> "' + t + '"'); els[i].textContent = t; }
    }
    if (changed.length && window.console) {
      console.warn('results.js: ' + changed.length + ' number(s) in index.html differ from model/results.json ' +
                   'and now show the file\'s values (run tools/test_results.js):\n' + changed.join('\n'));
    }
  }

  // ------------------------------------------------------ training (Fig. 4) --
  function renderTraining(data) {
    var el = host('chart-training'), live = $('training-live');
    if (!el) return;
    var T = data.training, H = T.history, n = H.train_loss.length, best = T.best_epoch;
    var current = null, kbd = null, geo = null;     // kbd: the epoch the arrow keys last chose
    var svg = null, cross = null;

    function maxOf(a) { return Math.max.apply(null, a); }
    function rowsFor(e) {
      var i = e - 1;
      return [
        { key: 'none', value: sci(H.lr[i], 3), label: 'learning rate' },
        { key: 's1-line', value: H.train_loss[i].toFixed(4), label: 'training loss' },
        { key: 's2-line', value: H.val_loss[i].toFixed(4), label: 'validation loss' },
        { key: 's2-line', value: (100 * H.val_f1[i]).toFixed(2) + '%', label: 'validation F1-score' },
        { key: 'none', value: (100 * H.val_accuracy[i]).toFixed(2) + '%', label: 'validation accuracy' }
      ];
    }
    function titleFor(e) { return 'Epoch ' + e + (e === best ? ', the selected checkpoint' : ''); }

    function draw() {
      clear(el);
      var W = Math.max(300, Math.round(el.clientWidth || 640)), narrow = W < 560;
      var m = { l: 44, r: narrow ? 70 : 84, t: 28 }, h1 = narrow ? 170 : 210, gap = 52, h2 = narrow ? 120 : 150, bottom = 40;
      var Ht = m.t + h1 + gap + h2 + bottom, x0 = m.l, x1 = W - m.r, t2 = m.t + h1 + gap;
      var lossMax = Math.ceil(Math.max(maxOf(H.train_loss), maxOf(H.val_loss)) * 20) / 20;
      var X = function (e) { return x0 + (e - 1) / (n - 1) * (x1 - x0); };
      var Y1 = function (v) { return m.t + h1 * (1 - v / lossMax); };
      var Y2 = function (v) { return t2 + h2 * (1 - v); };
      geo = { X: X, Y1: Y1, Y2: Y2, x0: x0, x1: x1, top: m.t, bottom: t2 + h2 };
      svg = s('svg', { viewBox: '0 0 ' + W + ' ' + Ht, width: W, height: Ht, 'class': 'r-svg', 'aria-hidden': 'true', focusable: 'false' }, el);

      // panel titles
      sText(svg, x0, m.t - 14, 'binary cross-entropy loss', { 'class': 'r-axis-title' });
      sText(svg, x0, t2 - 14, [{ t: 'validation F' }, { t: '1', sub: true }, { t: '-score' }], { 'class': 'r-axis-title' });
      // grid and y ticks
      for (var v = 0; v <= lossMax + 1e-9; v += 0.1) {
        var yy = Y1(v);
        s('line', { x1: x0, x2: x1, y1: yy, y2: yy, 'class': v === 0 ? 'r-axis-line' : 'r-grid-line' }, svg);
        sText(svg, x0 - 8, yy + 4, v === 0 ? '0' : v.toFixed(1), { 'class': 'r-tick', 'text-anchor': 'end' });
      }
      [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
        var yy = Y2(f);
        s('line', { x1: x0, x2: x1, y1: yy, y2: yy, 'class': f === 0 ? 'r-axis-line' : 'r-grid-line' }, svg);
        sText(svg, x0 - 8, yy + 4, Math.round(100 * f) + '%', { 'class': 'r-tick', 'text-anchor': 'end' });
      });
      [1, 10, 20, 30, 40, 50].forEach(function (e) {
        if (e > n) return;
        s('line', { x1: X(e), x2: X(e), y1: t2 + h2, y2: t2 + h2 + 5, 'class': 'r-axis-line' }, svg);
        sText(svg, X(e), t2 + h2 + 19, String(e), { 'class': 'r-tick', 'text-anchor': 'middle' });
      });
      sText(svg, x1, t2 + h2 + 36, 'epoch', { 'class': 'r-tick', 'text-anchor': 'end' });

      // the selected checkpoint: one rule through both panels
      s('line', { x1: X(best), x2: X(best), y1: m.t - 4, y2: t2 + h2, 'class': 'r-rule' }, svg);

      function path(values, Y) {
        return values.map(function (val, i) { return (i ? 'L' : 'M') + X(i + 1).toFixed(2) + ',' + Y(val).toFixed(2); }).join('');
      }
      s('path', { d: path(H.train_loss, Y1), 'class': 'r-line r-line--s1' }, svg);
      s('path', { d: path(H.val_loss, Y1), 'class': 'r-line r-line--s2' }, svg);
      s('path', { d: path(H.val_f1, Y2), 'class': 'r-line r-line--s2' }, svg);

      // direct labels at the line ends, pushed apart if they would touch
      var ya = Y1(H.train_loss[n - 1]), yb = Y1(H.val_loss[n - 1]);
      if (Math.abs(ya - yb) < 14) { var mid = (ya + yb) / 2, sg = ya > yb ? 1 : -1; ya = mid + sg * 7; yb = mid - sg * 7; }
      sText(svg, x1 + 8, ya + 4, 'training', { 'class': 'r-end' });
      sText(svg, x1 + 8, yb + 4, 'validation', { 'class': 'r-end' });

      // the checkpoint's F1, labelled beside its dot
      var bx = X(best), by = Y2(H.val_f1[best - 1]);
      s('circle', { cx: bx, cy: by, r: 4.5, 'class': 'r-dot r-dot--s2' }, svg);
      sText(svg, bx - 9, by - 9, (100 * H.val_f1[best - 1]).toFixed(2) + '% at epoch ' + best,
            { 'class': 'r-end r-halo', 'text-anchor': 'end' });

      // crosshair, drawn on demand
      cross = s('g', { 'class': 'r-cross', style: 'display:none' }, svg);
      s('line', { y1: m.t - 4, y2: t2 + h2, 'class': 'r-cross__line' }, cross);
      ['s1', 's2', 's2'].forEach(function (k) { s('circle', { r: 4, 'class': 'r-dot r-dot--' + k }, cross); });

      var hit = s('rect', { x: x0 - 6, y: m.t - 6, width: x1 - x0 + 12, height: t2 + h2 - m.t + 12, 'class': 'r-hit' }, svg);
      function track(ev) {                      // the crosshair snaps to the nearest epoch
        var r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width;
        var e = Math.max(1, Math.min(n, Math.round((px - x0) / (x1 - x0) * (n - 1)) + 1));
        show(e, ev.pageX, ev.pageY);
      }
      hit.addEventListener('pointermove', track);
      hit.addEventListener('pointerdown', track);   // a tap, or the start of a sideways drag, on a touch screen
      /* A lifted finger leaves the chart too, so on a touch screen the readout stays until the
         chart loses focus: the lift focuses it (a drag does not on its own), and a tap elsewhere
         blurs it.  A vertical swipe scrolls the page instead and cancels the pointer. */
      hit.addEventListener('pointerup', function (ev) {
        if (ev.pointerType === 'touch' && doc.activeElement !== el) el.focus({ preventScroll: true });
      });
      hit.addEventListener('pointercancel', function () { hideCross(); });
      hit.addEventListener('pointerleave', function (ev) {
        if (ev.pointerType === 'touch') return;
        if (kbd !== null && doc.activeElement === el) show(kbd); else hideCross();   // back to the keyboard's epoch
      });
      if (current !== null) show(current);
    }

    function show(e, px, py) {
      current = e;
      var xs = geo.X(e), dots = cross.querySelectorAll('circle'), line = cross.querySelector('line');
      line.setAttribute('x1', xs); line.setAttribute('x2', xs);
      var ys = [geo.Y1(H.train_loss[e - 1]), geo.Y1(H.val_loss[e - 1]), geo.Y2(H.val_f1[e - 1])];
      for (var i = 0; i < 3; i++) { dots[i].setAttribute('cx', xs); dots[i].setAttribute('cy', ys[i]); }
      cross.style.display = '';
      if (px === undefined) {
        var r = svg.getBoundingClientRect(), k = r.width / svg.viewBox.baseVal.width;
        px = window.pageXOffset + r.left + xs * k; py = window.pageYOffset + r.top + geo.top * k;
      }
      showTip(titleFor(e), rowsFor(e), px, py);
    }
    function hideCross() { current = null; if (cross) cross.style.display = 'none'; hideTip(); }

    el.setAttribute('tabindex', '0');
    el.addEventListener('keydown', function (ev) {
      var e = current === null ? best : current;
      if (ev.key === 'ArrowLeft') e = Math.max(1, e - 1);
      else if (ev.key === 'ArrowRight') e = Math.min(n, e + 1);
      else if (ev.key === 'Home') e = 1;
      else if (ev.key === 'End') e = n;
      else if (ev.key === 'Escape') { kbd = null; hideCross(); return; }
      else return;
      ev.preventDefault();
      kbd = e;
      show(e);
      announce(e);
    });
    el.addEventListener('focus', function () { show(current === null ? best : current); announce(current); });
    el.addEventListener('blur', function () { kbd = null; hideCross(); });
    function announce(e) {
      if (!live || e === null) return;
      live.textContent = titleFor(e) + ': ' + rowsFor(e).map(function (r) { return r.label + ' ' + r.value; }).join(', ') + '.';
    }

    draw();
    var lastW = el.clientWidth, queued = false;
    /* Redrawn in the next frame rather than inside the observer: a redraw changes the chart's
       height, and a size change made in the callback is reported as a ResizeObserver loop error. */
    function onResize() {
      if (queued || Math.abs(el.clientWidth - lastW) <= 1) return;
      queued = true;
      window.requestAnimationFrame(function () { queued = false; lastW = el.clientWidth; draw(); });
    }
    if (window.ResizeObserver) new ResizeObserver(onResize).observe(el);
    else window.addEventListener('resize', onResize);

    // the table view
    var tv = host('table-training');
    if (tv) {
      var body = [];
      for (var i = 0; i < n; i++) {
        body.push(h('tr', i + 1 === best ? { 'class': 'is-marked' } : null, [
          h('th', { scope: 'row' }, String(i + 1)), h('td', null, sci(H.lr[i], 3)),
          h('td', null, H.train_loss[i].toFixed(4)), h('td', null, H.val_loss[i].toFixed(4)),
          h('td', null, (100 * H.val_f1[i]).toFixed(2) + '%'), h('td', null, (100 * H.val_accuracy[i]).toFixed(2) + '%')]));
      }
      tv.appendChild(table('r-table--dense', h('tr', null, [
        h('th', { scope: 'col' }, 'epoch'), h('th', { scope: 'col' }, 'learning rate'), h('th', { scope: 'col' }, 'training loss'),
        h('th', { scope: 'col' }, 'validation loss'), h('th', { scope: 'col' }, ['validation F', h('sub', null, '1')]),
        h('th', { scope: 'col' }, 'validation accuracy')]), body, null, 'Training history, one row per epoch'));
    }
  }

  // ------------------------------------------------ classification (Table I) --
  function renderConfusion(data) {
    var el = host('confusion');
    if (!el) return;
    var c = data.classification, P = c.tp + c.fn, N = c.fp + c.tn;
    function cell(count, of, cls) { return h('td', cls ? { 'class': cls } : null, cellNum(count, pctOf(count, of))); }
    /* a column total sits under the counts above it, so it keeps the share's (empty) slot */
    function total(count) { return h('td', null, [group(count), h('span', { 'class': 'r-pc', 'aria-hidden': 'true' })]); }
    el.appendChild(table('r-table--matrix', h('tr', null, [
      h('th', { scope: 'col' }, 'exact verdict'), h('th', { scope: 'col' }, 'CNN: consistent'),
      h('th', { scope: 'col' }, 'CNN: inconsistent'), h('th', { scope: 'col' }, 'tilings')]), [
      h('tr', null, [h('th', { scope: 'row' }, ['consistent, 2', sym('A'), ' = ', sym('N', 'G')]),
        cell(c.tp, P, 'is-hit'), cell(c.fn, P), h('td', null, group(P))]),
      h('tr', null, [h('th', { scope: 'row' }, 'inconsistent'),
        cell(c.fp, N), cell(c.tn, N, 'is-hit'), h('td', null, group(N))])
    ], h('tr', null, [h('th', { scope: 'row' }, 'all'), total(c.tp + c.fp), total(c.fn + c.tn),
      h('td', null, group(P + N))]), 'Confusion matrix of the CNN against the exact consistency criterion'));
  }

  // ------------------------------------------------------------ localisation --
  /* Where each row stands in the paper: the paper prints Top-1 and Top-3 only. */
  var SCOPES = [
    { id: 'all', label: 'all 729 components', note: 'Table II, total row' },
    { id: 'existing', label: 'components of present edges', note: 'base or diagonal; not in the paper' },
    { id: 'diagonal', label: 'components of present diagonals', note: 'in the paper’s text; what Remove this edge deletes' }
  ];
  function renderScopes(data) {
    var el = host('scope-table');
    if (!el) return;
    var L = data.localisation, n = L.n;
    var body = SCOPES.map(function (sc) {
      var st = L.scopes[sc.id];
      return h('tr', null, [h('th', { scope: 'row' }, [sc.label, h('span', { 'class': 'r-sub' }, sc.note)])].concat([1, 3, 5].map(function (k) {
        return h('td', null, cellNum(st['top' + k].count, pctOf(st['top' + k].count, n)));
      })));
    });
    body.push(h('tr', { 'class': 'is-baseline' }, [
      h('th', { scope: 'row' }, ['a present diagonal at random', h('span', { 'class': 'r-sub' }, ['matched baseline, the mean of ', sym('N', 'R'), '/', sym('N', 'D')])]),
      h('td', null, FORMATS.pct(data.dataset.random_baseline_percent)), h('td', null, NDASH), h('td', null, NDASH)]));
    el.appendChild(table(null, h('tr', null, [h('th', { scope: 'col' }, 'ranking over'), h('th', { scope: 'col' }, 'Top-1'),
      h('th', { scope: 'col' }, 'Top-3'), h('th', { scope: 'col' }, 'Top-5')]), body, null,
      'Top-k localisation accuracy over the ' + group(n) + ' 1-edge-fixable tilings by ranking scope'));
    el.appendChild(h('p', { 'class': 'r-note' }, 'The paper prints Top-1 and Top-3; the Top-5 column is the companion code’s.'));
  }

  function renderNDPlot(data) {
    var el = host('nd-plot');
    if (!el) return;
    var L = data.localisation, rows = {}, maxN = 0, nd;
    L.by_ND.forEach(function (r) { rows[r.ND] = r; maxN = Math.max(maxN, r.n); });
    el.appendChild(legend([
      { key: 's1', label: 'Top-1, all 729 components' },
      { key: 's2', label: 'Top-1, present diagonals' },
      { key: 'base', label: ['mean defect fraction ⟨', sym('N', 'R'), '/', sym('N', 'D'), '⟩'] }
    ]));

    var list = h('ul', { 'class': 'ndplot' });
    list.appendChild(h('li', { 'class': 'ndplot__row ndplot__row--head', 'aria-hidden': 'true' }, [
      h('span', null, sym('N', 'D')), h('span', null, 'tilings'), h('span', null, 'Top-1 accuracy and the mean defect fraction')]));

    function dotRow(label, r, isTotal) {
      var all = isTotal ? L.scopes.all : r.all, dg = isTotal ? L.scopes.diagonal : r.diagonal, n = isTotal ? L.n : r.n;
      var a = 100 * all.top1.count / n, d = 100 * dg.top1.count / n;
      var base = isTotal ? data.dataset.random_baseline_percent : r.defect_fraction_percent;
      var lo = Math.min(a, d, base), hi = Math.max(a, d, base);
      var title = isTotal ? 'All ' + group(n) + ' tilings'
                          : r.ND + ' diagonal' + (r.ND === 1 ? '' : 's') + ', ' + group(n) + ' tilings';
      var tipTitle = isTotal ? title : function () { return [sym('N', 'D'), ' = ' + r.ND + ' · ' + group(n) + ' tilings']; };
      var tipRows = function () {
        var t = [
          { key: 's1', value: pctOf(all.top1.count, n), label: 'Top-1, all 729 components' },
          { key: 's2', value: pctOf(dg.top1.count, n), label: 'Top-1, present diagonals' },
          { key: 'base', value: FORMATS.pct(base), label: isTotal ? 'matched random baseline' : 'mean defect fraction' },
          { key: 'none', value: pctOf(all.top3.count, n), label: 'Top-3, all 729 components' }
        ];
        if (!isTotal) t.push({ key: 'none', value: group(r.NR1) + ' / ' + group(r.NR2), label: 'tilings with one / two defects' });
        return t;
      };
      var li = h('li', {
        'class': 'ndplot__row' + (isTotal ? ' ndplot__row--total' : ''), tabindex: '0',
        'aria-label': title + ': Top-1 ' + pctOf(all.top1.count, n) + ' over all 729 components, ' + pctOf(dg.top1.count, n) +
          ' over present diagonals; ' + (isTotal ? 'matched random baseline ' : 'mean defect fraction ') + FORMATS.pct(base) + '.'
      }, [
        h('span', { 'class': 'ndplot__nd', 'aria-hidden': 'true' }, label),
        h('span', { 'class': 'ndplot__count', 'aria-hidden': 'true' }, [
          h('span', { 'class': 'ndplot__bartrack' },
            isTotal ? null : h('span', { 'class': 'ndplot__bar', style: 'width:' + (100 * n / maxN).toFixed(2) + '%' })),
          h('span', { 'class': 'ndplot__num' }, group(n))]),
        /* The two accuracies sit a little above and below the centre line, so equal values stay
           two visible dots; the reference diamond is hollow and drawn last, on top of both. */
        h('span', { 'class': 'ndplot__track', 'aria-hidden': 'true' }, [
          h('span', { 'class': 'ndplot__link', style: 'left:' + lo.toFixed(3) + '%;width:' + (hi - lo).toFixed(3) + '%' }),
          h('span', { 'class': 'ndplot__dot ndplot__dot--s1', style: 'left:' + a.toFixed(3) + '%' }),
          h('span', { 'class': 'ndplot__dot ndplot__dot--s2', style: 'left:' + d.toFixed(3) + '%' }),
          h('span', { 'class': 'ndplot__dot ndplot__dot--base', style: 'left:' + base.toFixed(3) + '%' })])
      ]);
      tipOn(li, tipTitle, tipRows);
      return li;
    }
    for (nd = 1; nd <= 9; nd++) {
      if (rows[nd]) list.appendChild(dotRow(String(nd), rows[nd], false));
      else list.appendChild(h('li', { 'class': 'ndplot__row ndplot__row--empty' }, [
        h('span', { 'class': 'ndplot__nd' }, String(nd)),
        h('span', { 'class': 'ndplot__count' }, [h('span', { 'class': 'ndplot__bartrack' }), h('span', { 'class': 'ndplot__num' }, '0')]),
        h('span', { 'class': 'ndplot__none' }, 'no 1-edge-fixable tilings')]));
    }
    list.appendChild(dotRow('all', null, true));
    list.appendChild(h('li', { 'class': 'ndplot__row ndplot__row--axis', 'aria-hidden': 'true' }, [h('span'), h('span'),
      h('span', { 'class': 'ndplot__ticks' }, [0, 25, 50, 75, 100].map(function (t) {
        return h('span', { style: 'left:' + t + '%' }, t + '%');
      }))]));
    el.appendChild(list);
  }

  function renderTable2(data) {
    var el = host('table2');
    if (!el) return;
    var L = data.localisation;
    function topCells(sc, n) { return [1, 3].map(function (k) { return h('td', null, cellNum(sc['top' + k].count, pctOf(sc['top' + k].count, n))); }); }
    var body = L.by_ND.map(function (r) {
      return h('tr', null, [h('th', { scope: 'row' }, String(r.ND)), h('td', null, group(r.n)), h('td', null, group(r.NR1)),
        h('td', null, group(r.NR2)), h('td', null, FORMATS.pct(r.defect_fraction_percent))]
        .concat(topCells(r.all, r.n), topCells(r.diagonal, r.n)));
    });
    var foot = h('tr', null, [h('th', { scope: 'row' }, 'all'), h('td', null, group(L.n)), h('td', null, group(data.dataset.NR1)),
      h('td', null, group(data.dataset.NR2)), h('td', null, FORMATS.pct(data.dataset.random_baseline_percent))]
      .concat(topCells(L.scopes.all, L.n), topCells(L.scopes.diagonal, L.n)));
    /* scope="colgroup" needs the column groups it names: five single columns, then two pairs */
    var cols = [h('colgroup', { span: '5' }), h('colgroup', { span: '2' }), h('colgroup', { span: '2' })];
    var head = [
      h('tr', null, [h('th', { scope: 'col', rowspan: '2' }, sym('N', 'D')), h('th', { scope: 'col', rowspan: '2' }, 'tilings'),
        h('th', { scope: 'col', rowspan: '2' }, [sym('N', 'R'), ' = 1']), h('th', { scope: 'col', rowspan: '2' }, [sym('N', 'R'), ' = 2']),
        h('th', { scope: 'col', rowspan: '2' }, ['⟨', sym('N', 'R'), '/', sym('N', 'D'), '⟩']),
        h('th', { scope: 'colgroup', colspan: '2', 'class': 'r-group' }, 'all 729 components'),
        h('th', { scope: 'colgroup', colspan: '2', 'class': 'r-group' }, 'present diagonals')]),
      h('tr', null, [h('th', { scope: 'col' }, 'Top-1'), h('th', { scope: 'col' }, 'Top-3'),
        h('th', { scope: 'col' }, 'Top-1'), h('th', { scope: 'col' }, 'Top-3')])
    ];
    el.appendChild(table('r-table--nd', head, body, foot,
      'Defect localisation by the number of diagonals; Table II of the paper with the ranking restricted to present diagonals alongside', cols));
  }

  function renderPlacement(data) {
    var el = host('placement');
    if (!el) return;
    var P = data.localisation.top1_placement;
    /* label() builds fresh nodes on each call: the bar and the table both show it */
    var GROUPS = [
      { key: 'all', label: function () { return 'all ' + group(P.all.n) + ' tilings'; }, name: 'All ' + group(P.all.n) + ' tilings' },
      { key: 'ND6', label: function () { return [sym('N', 'D'), ' = 6: ' + group(P.ND6.n) + ' tilings']; },
        name: 'The ' + group(P.ND6.n) + ' tilings with six diagonals' }
    ];
    function partsOf(p) {
      return [
        { count: p.diagonal.count, cls: 's1', name: 'a diagonal present in the tiling' },
        { count: p.absent.count, cls: 'muted', name: 'a component that carries no edge' },
        { count: p.base.count, cls: 'empty', name: 'a base edge' }
      ];
    }
    /* A key only for what a bar draws: the top component has never been a base edge so far. */
    var anyBase = GROUPS.some(function (g) { return P[g.key].base.count > 0; });
    el.appendChild(legend([
      { key: 's1-block', label: 'a diagonal present in the tiling' },
      { key: 'muted-block', label: 'a component that carries no edge' }
    ].concat(anyBase ? [{ key: 'empty-block', label: 'a base edge' }] : [])));
    GROUPS.forEach(function (g) {
      var p = P[g.key], parts = partsOf(p);
      var bar = h('div', { 'class': 'segbar', role: 'group', 'aria-label': g.name + ', by where the top component lands' });
      parts.forEach(function (q) {
        if (!q.count) return;                              // a part at zero draws nothing
        var block = h('span', { 'class': 'segbar__part segbar__part--' + q.cls, style: 'flex-grow:' + q.count, tabindex: '0',
          role: 'img', 'aria-label': group(q.count) + ' of ' + group(p.n) + ' (' + pctOf(q.count, p.n) + ') on ' + q.name },
          h('span', { 'class': 'segbar__label', 'aria-hidden': 'true' }, pctOf(q.count, p.n)));
        tipOn(block, 'Top-ranked component on ' + q.name, function () {
          return [{ key: q.cls + '-block', value: group(q.count) + ' of ' + group(p.n), label: pctOf(q.count, p.n) }];
        });
        bar.appendChild(block);
      });
      el.appendChild(h('div', { 'class': 'segrow' }, [h('span', { 'class': 'segrow__label' }, g.label()), bar]));
    });
    fitLabels(el);

    // the table view
    var rows = GROUPS.map(function (g) {
      var p = P[g.key];
      return h('tr', null, [h('th', { scope: 'row' }, g.label())].concat(partsOf(p).map(function (q) {
        return h('td', null, cellNum(q.count, pctOf(q.count, p.n)));
      })));
    });
    el.appendChild(h('details', { 'class': 'detk' }, [h('summary', null, 'The counts as a table'),
      table('r-table--compact', h('tr', null, [h('th', { scope: 'col' }, 'tilings'), h('th', { scope: 'col' }, 'present diagonal'),
        h('th', { scope: 'col' }, 'no edge'), h('th', { scope: 'col' }, 'base edge')]), rows, null,
        'Where the top-ranked of all 729 components lands')]));
  }
  /* A share is printed inside its block only when it fits with room to spare. */
  function fitLabels(root) {
    var labels = root.querySelectorAll('.segbar__label');
    for (var i = 0; i < labels.length; i++) {
      labels[i].style.visibility = '';
      var part = labels[i].parentNode;
      if (labels[i].offsetWidth + 14 > part.clientWidth) labels[i].style.visibility = 'hidden';
    }
  }

  function renderProjection(data) {
    var el = host('projection-links');
    if (!el) return;
    var idx = data.localisation.projection.different_indices;
    el.appendChild(h('ul', { 'class': 'r-links' }, idx.map(function (i) {
      return h('li', null, h('a', { href: '#' + i, 'data-lab': '', title: 'Open configuration ' + group(i) + ' in the laboratory' }, group(i)));
    })));
  }

  function renderExposure(data) {
    var el = host('exposure');
    if (!el) return;
    var E = data.localisation.exposure;
    /* the row labels finish the header: "1-edge-fixable tilings in the training set" */
    var groups = [['train', 'in the training set'], ['validation', 'in the validation set'],
                  ['exposed', 'exposed: in either set'], ['unexposed', 'unexposed: in neither']];
    var body = groups.map(function (g) {
      var e = E[g[0]];
      return h('tr', g[0] === 'exposed' ? { 'class': 'is-split' } : null, [h('th', { scope: 'row' }, g[1]), h('td', null, group(e.n)),
        h('td', null, e.mean_ND.toFixed(2)),
        h('td', null, cellNum(e.all.top1.count, pctOf(e.all.top1.count, e.n))),
        h('td', null, cellNum(e.all.top3.count, pctOf(e.all.top3.count, e.n)))]);
    });
    var d = E.exposed_minus_unexposed_pp;
    function pp(v) { return (v >= 0 ? '+' : MINUS) + Math.abs(v).toFixed(2) + ' pp'; }   // kept on one line
    var foot = h('tr', null, [h('th', { scope: 'row' }, 'exposed − unexposed'), h('td'), h('td'),
      h('td', null, pp(d.top1)), h('td', null, pp(d.top3))]);
    el.appendChild(table(null, h('tr', null, [h('th', { scope: 'col' }, '1-edge-fixable tilings'), h('th', { scope: 'col' }, 'tilings'),
      h('th', { scope: 'col' }, ['mean ', sym('N', 'D')]), h('th', { scope: 'col' }, 'Top-1'), h('th', { scope: 'col' }, 'Top-3')]),
      body, foot, 'Localisation accuracy, ranking all 729 components, by whether a tiling was in the training pool'));
  }

  // ------------------------------------------------------------ examples --
  function renderExamples(data) {
    var el = host('examples-grid');
    if (!el) return;
    data.examples.forEach(function (ex) {
      var rm = ex.removed, nR = ex.diagonals.filter(function (d) { return d.repair; }).length;
      var rows = [
        [sym('N', 'D'), String(ex.N_D[0]), String(ex.N_D[1])],
        [sym('N', 'G'), String(ex.N_G[0]), String(ex.N_G[1])],
        [['2', sym('A')], String(ex.twice_area[0]), String(ex.twice_area[1])],
        ['verdict', ex.consistent[0] ? 'consistent' : 'inconsistent', ex.consistent[1] ? 'consistent' : 'inconsistent'],
        ['CNN logit', fixed(ex.logit[0], 2), fixed(ex.logit[1], 2)],
        [['CNN ', sym('p'), '(consistent)'], FORMATS.prob(ex.probability[0]), FORMATS.prob(ex.probability[1])],
        ['peak saliency', ex.peak_saliency[0].toFixed(2), ex.peak_saliency[1].toFixed(2)]
      ];
      var ba = table('r-table--compact', h('tr', null, [h('th', { scope: 'col' }, h('span', { 'class': 'sr-only' }, 'quantity')),
        h('th', { scope: 'col' }, 'before'), h('th', { scope: 'col' }, 'after')]),
        rows.map(function (r, i) {
          var cls = i === 3 ? ['is-fail', 'is-ok'] : [null, null];
          if (i === 3 && ex.consistent[0]) cls[0] = 'is-ok';
          if (i === 3 && !ex.consistent[1]) cls[1] = 'is-fail';
          return h('tr', null, [h('th', { scope: 'row' }, r[0]), h('td', cls[0] ? { 'class': cls[0] } : null, r[1]),
            h('td', cls[1] ? { 'class': cls[1] } : null, r[2])]);
        }), null, 'Figure ' + ex.figure + ' before and after removing the top-ranked diagonal');

      var diags = ex.diagonals.slice().sort(function (p, q) { return q.S - p.S; });
      var meters = h('ul', { 'class': 'meters', 'aria-label': 'Saliency of each present diagonal, as a fraction of the peak' }, diags.map(function (d) {
        var isTop = d.w === rm.w && d.b === rm.b;
        return h('li', { 'class': 'meters__row' + (isTop ? ' is-top' : '') }, [
          h('span', { 'class': 'meters__name' }, ['face ' + d.face + ' ', edge(d.w, d.b)]),
          h('span', { 'class': 'meters__track', 'aria-hidden': 'true' }, h('span', { 'class': 'meters__bar', style: 'width:' + (100 * d.S).toFixed(2) + '%' })),
          h('span', { 'class': 'meters__val' }, d.S.toFixed(3))]);
      }));

      var removed = ex.diagonals.filter(function (d) { return d.w === rm.w && d.b === rm.b; })[0];
      var isDefect = !!(removed && removed.repair);
      var rank = ex.top_of_all_729_is_removed_edge && ex.top_present_diagonal_is_removed_edge
        ? 'It ranks first among all 729 components and among the present diagonals'
        : ex.top_present_diagonal_is_removed_edge ? 'It ranks first among the present diagonals'
        : 'It does not rank first among the present diagonals';
      var mono = monomial(rm.winding);
      el.appendChild(h('article', { 'class': 'card-item r-ex' }, h('div', { 'class': 'card-item__body' }, [
        h('div', { 'class': 'r-ex__head' }, [h('h3', { 'class': 'card-item__title' }, 'Figure ' + ex.figure),
          h('span', { 'class': 'pill' }, [nR + ' defect' + (nR === 1 ? '' : 's') + ' in ' + ex.N_D[0] + ' diagonals'])]),
        h('p', { 'class': 'r-ex__meta' }, ['configuration ' + group(ex.index) + ' · states ', h('code', null, ex.states.join(''))]),
        h('p', { 'class': 'r-ex__lead' }, ['The paper removes the diagonal ', edge(rm.w, rm.b), ' of face ' + rm.face +
          ', whose Kasteleyn entry is ', mono === '1' ? '1, with no winding' : ['the monomial ', h('i', null, mono)], '. ', rank,
          isDefect ? ', and removing it alone restores consistency.' : '.']),
        ba,
        h('p', { 'class': 'r-ex__sub' }, [sym('S', 'uvk'), ' of each present diagonal, as a fraction of the peak']),
        meters,
        h('p', { 'class': 'r-note' }, [
          'Higgsing this diagonal’s field lowers ', sym('N', 'G'), ' from ' + ex.N_G[0] + ' to ' + ex.N_G[1] + ' = 2', sym('A'),
          ex.toric_corners_unchanged ? '; the toric diagram keeps its corners' : '',
          '. The largest saliency left is ' + ex.after_peak_on_shared_scale.toFixed(3) + ' of the original peak.']),
        h('div', { 'class': 'card-item__foot' }, h('a', { 'class': 'btn btn-outline btn-compact', href: '#' + ex.index, 'data-lab': '' },
          'Open in the laboratory'))
      ])));
    });
  }

  // ------------------------------------------------------------ provenance --
  function renderProvenance(data) {
    var el = host('provenance-list');
    if (!el) return;
    var S = data.source, items = [
      ['checkpoint', S.checkpoint_sha256], ['dataset', S.dataset_sha256],
      ['single-edge repairs', S.repairs_sha256], ['training split', S.split_sha256],
      ['training history', S.history_sha256]
    ];
    el.appendChild(h('p', { 'class': 'r-note r-note--hash' }, 'The SHA-256 checksum of each input file, as evaluated:'));
    var dl = h('dl', { 'class': 'r-dl r-dl--hash' });
    items.forEach(function (it) { append(dl, [h('dt', null, it[0]), h('dd', null, h('code', null, it[1]))]); });
    append(dl, [h('dt', null, 'evaluated with'), h('dd', null, 'PyTorch ' + S.torch + ', NumPy ' + S.numpy + ', on ' + S.device.toUpperCase())]);
    el.appendChild(dl);
  }

  // --------------------------------------------------------------- links --
  /* The URL hash is the configuration on display (app.js keeps it so), so in-page links must
     not overwrite it.  A link to "#<index>" marked data-lab opens that configuration in the
     laboratory; the contents list and the skip link scroll to their target and move focus
     there, leaving the hash alone.  (Reduced motion: demo.css turns off site.css's smooth
     scrolling, so 'auto' jumps.) */
  function scrollToEl(target) {
    if (!target) return;
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }
  function focusEl(target) {
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }
  function openInLab(id) {
    if (location.hash !== '#' + id) location.hash = id;          // app.js loads it on the hash change
    else {
      /* Already on display, perhaps on a borrowed colour scale: load it again through the
         laboratory's own index box, which resets the scale as the preset buttons do. */
      var input = $('index-input'), form = $('index-form');
      if (input && form) { input.value = id; form.dispatchEvent(new Event('submit', { cancelable: true })); }
    }
    scrollToEl($('lab'));
    focusEl($('lab'));
  }
  function wireLinks() {
    /* Capture phase, and the event stops here: site.js's own document handler would otherwise
       run first, replace the hash with the section's id, and throw on "#<digits>", which is not
       a valid selector.  Every other link is left to it. */
    doc.addEventListener('click', function (ev) {
      if (ev.defaultPrevented || ev.button !== 0) return;
      var a = ev.target.closest ? ev.target.closest('a[href^="#"]') : null;
      if (!a) return;
      var id = a.getAttribute('href').slice(1);
      var isLab = a.hasAttribute('data-lab') && /^\d+$/.test(id);
      var isNav = !isLab && !!a.closest('.page-toc, .skip-link') && !!$(id);
      if (!isLab && !isNav) return;
      ev.stopPropagation();
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;   // a new tab or window: the browser's own
      ev.preventDefault();
      if (isLab) openInLab(id);
      else { scrollToEl($(id)); focusEl($(id)); }
    }, true);
  }

  // ---------------------------------------------------------------- start --
  /* a host that shares its card with an earlier host: on failure the earlier one carries the notice */
  var SECONDARY = { 'table-training': true, 'table2': true };
  function fail(err) {
    var hosts = doc.querySelectorAll('[data-results-host]'), chart = $('chart-training');
    if (chart) { chart.removeAttribute('aria-label'); chart.removeAttribute('role'); }
    for (var i = 0; i < hosts.length; i++) {
      clear(hosts[i]);
      if (SECONDARY[hosts[i].id]) continue;
      hosts[i].appendChild(h('p', { 'class': 'r-status is-error' },
        'The results could not be loaded from model/results.json' + (location.protocol === 'file:' ?
          ': browsers do not fetch files from a file:// page, so serve the folder over HTTP (see README.md).' : '.')));
    }
    if (window.console) console.error('results.js:', err);
  }
  /* Everything drawn from the file.  Each part is drawn on its own, so one failure cannot take
     the others with it, and a failure says so in its own place rather than leaving the section
     blank.  Returns the failures, as "host: message". */
  function renderAll(data) {
    var failures = [];
    bindAll(data);
    [[renderTraining, ['chart-training', 'table-training']], [renderConfusion, ['confusion']], [renderScopes, ['scope-table']],
     [renderNDPlot, ['nd-plot']], [renderTable2, ['table2']], [renderPlacement, ['placement']],
     [renderProjection, ['projection-links']], [renderExposure, ['exposure']], [renderExamples, ['examples-grid']],
     [renderProvenance, ['provenance-list']]].forEach(function (job) {
      try { job[0](data); } catch (e) {
        failures.push(job[1][0] + ': ' + e.message);
        job[1].forEach(function (id) {
          var el = $(id);
          if (el) { clear(el); el.appendChild(h('p', { 'class': 'r-status is-error' }, 'This part of the results could not be drawn: ' + e.message)); }
        });
        if (window.console) console.error('results.js: drawing #' + job[1][0] + ' failed', e);
      }
    });
    var pl = $('placement');
    if (pl) {
      if (window.ResizeObserver) new ResizeObserver(function () { fitLabels(pl); }).observe(pl);
      else window.addEventListener('resize', function () { fitLabels(pl); });
    }
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { if (pl) fitLabels(pl); });
    return failures;
  }
  function start() {
    wireLinks();
    fetch('model/results.json').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      if (data.format !== 'xai-brane-results') throw new Error('model/results.json is not a results file');
      renderAll(data);
    }).catch(fail);
  }
  api.renderAll = renderAll;
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
  return api;
})();

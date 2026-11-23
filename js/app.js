/* app.js — the interactive page: tiling (a), saliency map (b), toric diagram (c), quiver (d). */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var U = 44;                                  // px per lattice unit in panel (a)
  var NODE_R = 0.12 * U;                       // node disc radius, in the same units
  var DOMAIN_COLOR = '#32cd32';                // limegreen, as in the paper
  var GAUGE_GOLD = '#ffd300';                  // gauge-group discs of the group's brane tiling design files
  var DIAGONAL_RED = '#c0392b';                // a diagonal before the CNN has coloured it
  var $ = function (id) { return document.getElementById(id); };

  function svgEl(tag, attrs, parent) {
    var el = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) if (attrs.hasOwnProperty(k) && attrs[k] !== undefined && attrs[k] !== null) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function fmtInt(n) { return n.toLocaleString('en-US'); }
  function cool(t) {                           // matplotlib "cool": cyan -> magenta
    t = Math.max(0, Math.min(1, t));
    return 'rgb(' + Math.round(255 * t) + ',' + Math.round(255 * (1 - t)) + ',255)';
  }
  /* Text built from runs {t, sub, italic, bold}; subscripts use dy shifts, which every browser honours. */
  function mathText(parent, runs, attrs) {
    var t = svgEl('text', attrs, parent), shifted = false;
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i], a = {};
      if (r.sub) { a['font-size'] = '72%'; if (!shifted) { a.dy = '0.45em'; shifted = true; } }
      else if (shifted) { a.dy = '-0.32em'; shifted = false; }
      if (r.italic) a['font-style'] = 'italic';
      if (r.bold) a['font-weight'] = 700;
      var span = svgEl('tspan', a, t);
      span.appendChild(document.createTextNode(r.t));
    }
    return t;
  }
  /* "w3" -> text with a subscript, for node labels */
  function subLabel(parent, prefix, index, attrs) {
    return mathText(parent, [{ t: prefix }, { t: String(index), sub: true }], attrs);
  }

  var app = {
    states: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    history: [],
    modelReady: false,
    /* Colour-scale anchor, normally null: a map is normalised to its own peak, so its
        largest value reads 1.000, which is the paper's convention for a standalone map.
        A repair is the exception.  Deleting the edge saliency points at drops the peak
        gradient by an order of magnitude, and the paper's Figs. 7 and 8 put before and
        after on one shared maximum so that collapse is visible rather than normalised
        away.  Pressing "Remove this edge" therefore anchors the after-map to the peak of
        the tiling before it, and any edit can be put on that footing on demand. */
    anchor: null,                              // {peak, index, verify} or null
    previous: null,                            // the tiling edited away from, for comparison
    repairable: null, consistentList: null,
    consistentFlags: null,                     // Uint8Array over all indices, 1 where consistent
    consistencyMemo: {},                       // exact checks made before that list arrives
    result: null
  };

  /* The number of the face hexagon h is, as in the paper's Fig. 1(a); hexagons (and the
     digits of a configuration) run row by row, which is faces 4-9 and then 1-3. */
  function faceNo(h) { return BT.FACE_OF_HEX[h]; }

  /* Whether configuration `i` is consistent: a lookup in the list of the 1,387 consistent
     tilings once it has loaded, and the exact check itself until then. */
  function isConsistentIndex(i) {
    if (app.consistentFlags) return app.consistentFlags[i] === 1;
    if (!(i in app.consistencyMemo)) app.consistencyMemo[i] = BT.analyse(BT.decodeIndex(i), 'determinant').consistent;
    return app.consistencyMemo[i];
  }

  // ------------------------------------------------------------- model --
  function loadModel() {
    var status = $('model-status');
    status.textContent = 'Loading CNN weights (11 MB)…';
    fetch('model/cnn_meta.json').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (meta) {
      return fetch('model/cnn_weights.bin').then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var total = parseInt(r.headers.get('Content-Length') || '0', 10);
        if (!r.body || !r.body.getReader) return r.arrayBuffer();
        var reader = r.body.getReader(), chunks = [], received = 0;
        function pump() {
          return reader.read().then(function (res) {
            if (res.done) return null;
            chunks.push(res.value); received += res.value.length;
            if (total) status.textContent = 'Loading CNN weights… ' + Math.round(100 * received / total) + '%';
            return pump();
          });
        }
        return pump().then(function () {
          var out = new Uint8Array(received), off = 0;
          for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], off); off += chunks[i].length; }
          return out.buffer;
        });
      }).then(function (buf) {
        CNN.init(buf, meta);
        app.modelReady = true;
        status.textContent = 'CNN ready: manuscript checkpoint, epoch ' + meta.epoch + ', decision rule p > ' + meta.threshold + '.';
        render();
      });
    }).catch(function (err) {
      status.innerHTML = 'The CNN weights could not be loaded (' + err.message + '). ' +
        'If this page was opened from the file system, serve the folder over HTTP, for example ' +
        '<code>python3 -m http.server</code> in the website folder, then open <code>http://localhost:8000/</code>. ' +
        'The toric diagram and the exact consistency check work without the model.';
    });
    fetch('model/repairable.json').then(function (r) { return r.json(); }).then(function (a) { app.repairable = a; }).catch(function () {});
    fetch('model/consistent.json').then(function (r) { return r.json(); }).then(function (a) {
      var flags = new Uint8Array(BT.NUM_CONFIGS);
      for (var i = 0; i < a.length; i++) flags[a[i]] = 1;
      app.consistentList = a; app.consistentFlags = flags;
    }).catch(function () {});
  }

  // ----------------------------------------------------------- compute --
  function compute() {
    var states = app.states;
    var an = BT.analyse(states);
    var res = { an: an, sal: null, map: null, mapNorm: null, peak: 0, scalePeak: 0, top: null, topAll: null, prob: null, logit: null, repairs: [],
                fix: null, quiver: null, W: null };
    var h, i;
    /* The fewest diagonal deletions that restore consistency, and every set of that size
       that does: deletions only clear base-4 digits, so each candidate is an index looked
       up among the consistent tilings.  The single deletions that repair a 1-edge-fixable
       tiling are its sets of size one. */
    res.fix = BT.repairDistance(states, isConsistentIndex);
    if (res.fix && res.fix.k === 1) res.repairs = res.fix.sets.map(function (s) { return s[0]; }).sort(function (x, y) { return faceNo(x) - faceNo(y); });
    res.quiver = BT.quiver(states);
    res.W = BT.superpotential(states, res.quiver);
    if (app.modelReady) {
      if (app.anchor && app.anchor.verify) {
        /* A colour scale read from a file names its reference tiling.  The peak is a pure
           function of that tiling, so it is recomputed here rather than taken on trust. */
        var refMap = CNN.projectMap(CNN.saliency(BT.unsignedTensor(BT.decodeIndex(app.anchor.index))).saliency), refPeak = 0;
        for (i = 0; i < 81; i++) if (refMap[i] > refPeak) refPeak = refMap[i];
        if (refPeak > 0) app.anchor.peak = refPeak;
        app.anchor.verify = false;
      }
      var x = BT.unsignedTensor(states);
      var out = CNN.saliency(x);
      res.logit = out.logit; res.prob = out.prob; res.sal = out.saliency;
      res.map = CNN.projectMap(out.saliency);
      var peak = 0;
      for (i = 0; i < 81; i++) if (res.map[i] > peak) peak = res.map[i];
      res.peak = peak;
      // max() so a tiling whose saliency exceeds the anchor is still shown without clipping
      res.scalePeak = app.anchor ? Math.max(app.anchor.peak, peak) : peak;
      res.anchored = !!(app.anchor && app.anchor.index !== an.index);
      res.mapNorm = new Float64Array(81);
      for (i = 0; i < 81; i++) res.mapNorm[i] = res.scalePeak > 0 ? res.map[i] / res.scalePeak : 0;
      var diagCells = [];
      for (h = 0; h < 9; h++) if (states[h]) diagCells.push(BT.DIAG_CELLS[h][states[h]].cell);
      if (diagCells.length) {
        var c = CNN.argmaxCells(out.saliency, diagCells), d = BT.CELL_TO_DIAG[c], dc = BT.DIAG_CELLS[d.h][d.s];
        res.top = { cell: c, h: d.h, s: d.s, w: dc.w, b: dc.b, S: out.saliency[c],
                    Snorm: res.scalePeak > 0 ? out.saliency[c] / res.scalePeak : 0,
                    Mnorm: res.mapNorm[dc.w * 9 + dc.b],
                    repairs: isConsistentIndex(BT.encodeStates(BT.withoutDiagonal(states, d.h))) };
      }
      var all = [];
      for (i = 0; i < 729; i++) all.push(i);
      res.topAll = BT.cellOf(CNN.argmaxCells(out.saliency, all));
      /* The map is a maximum over the nine winding channels at each node pair, so its
         largest value can fall on a pair that carries no edge at all.  Record whether it
         does: the panel says so, because the boxed cell is then not the brightest one. */
      var pw = res.topAll[1], pb = res.topAll[2];
      res.topAllHasEdge = false;
      for (i = 0; i < 9; i++) if (x[BT.cellIndex(i, pw, pb)] !== 0) { res.topAllHasEdge = true; break; }
    }
    /* The colour scale this render was drawn on, kept with the result so that saving
       records what is on screen -- also before the model has loaded, when a scale read
       from a file is held but not yet applied. */
    res.scaleRef = app.anchor && app.anchor.index !== an.index ? { index: app.anchor.index, peak: app.anchor.peak } : null;
    return res;
  }

  // --------------------------------------------------------- panel (a) --
  function toSvg(p) { return [p[0] * U, -p[1] * U]; }

  /* Distance from a point to a line segment. */
  function segmentDistance(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    var t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }
  /* Distance from an axis-aligned box {x, y, hx, hy} to a point. */
  function boxPointDistance(box, px, py) {
    var dx = Math.abs(px - box.x) - box.hx, dy = Math.abs(py - box.y) - box.hy;
    if (dx <= 0 && dy <= 0) return Math.max(dx, dy);
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  }
  function boxBoxDistance(a, b) {
    var dx = Math.abs(a.x - b.x) - (a.hx + b.hx), dy = Math.abs(a.y - b.y) - (a.hy + b.hy);
    if (dx <= 0 && dy <= 0) return Math.max(dx, dy);
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  }
  function segmentsCross(ax, ay, bx, by, cx, cy, dx2, dy2) {
    function cross(ox, oy, px, py, qx, qy) { return (px - ox) * (qy - oy) - (py - oy) * (qx - ox); }
    var d1 = cross(cx, cy, dx2, dy2, ax, ay), d2 = cross(cx, cy, dx2, dy2, bx, by);
    var d3 = cross(ax, ay, bx, by, cx, cy), d4 = cross(ax, ay, bx, by, dx2, dy2);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }
  /* Exact distance between a box and a segment; 0 when they cross.  A box rather than a
     disc because a label is half again as wide as it is tall, and a disc large enough to
     contain it would push every label needlessly far from its node. */
  function boxSegmentDistance(box, x1, y1, x2, y2) {
    var x0 = box.x - box.hx, x3 = box.x + box.hx, y0 = box.y - box.hy, y3 = box.y + box.hy;
    var cs = [[x0, y0], [x3, y0], [x3, y3], [x0, y3]], i;
    for (i = 0; i < 4; i++) {
      var p = cs[i], q = cs[(i + 1) % 4];
      if (segmentsCross(x1, y1, x2, y2, p[0], p[1], q[0], q[1])) return 0;
    }
    var m = Math.min(boxPointDistance(box, x1, y1), boxPointDistance(box, x2, y2));
    for (i = 0; i < 4; i++) m = Math.min(m, segmentDistance(cs[i][0], cs[i][1], x1, y1, x2, y2));
    return m;
  }

  /* Measure one label, so the placement uses the glyphs actually rendered rather than an
     estimate.  A subscript shifts the run downwards, so the ink is not centred on the
     anchor point and the offset has to be carried into the collision test. */
  function labelMetrics(parent, fontSize) {
    var fallback = { dx: 0, dy: 0.05 * U, hx: 0.18 * U, hy: 0.15 * U };
    var probe = subLabel(parent, 'w', 9, { x: 0, y: 0, 'text-anchor': 'middle',
                                          'dominant-baseline': 'central', 'font-size': fontSize,
                                          'class': 'fig-label', visibility: 'hidden' });
    var b = null;
    try { b = probe.getBBox(); } catch (e) { b = null; }
    parent.removeChild(probe);
    if (!b || !b.width || !b.height) return fallback;
    // a thin margin on the measured ink, so a label sits close without quite touching
    return { dx: b.x + b.width / 2, dy: b.y + b.height / 2, hx: b.width / 2 + 0.35, hy: b.height / 2 + 0.35 };
  }

  /* Put each node label beside its node without touching an edge, a node, or another
     label.  The paper sets the labels in the white space next to the nodes rather than on
     them, and a diagonal runs straight through the space some of those labels would
     otherwise occupy -- so the position cannot be fixed, it has to be searched for every
     time the tiling changes.
       `targets`  nodes to label, in a stable order
       `segments` [x1, y1, x2, y2, halfWidth] of every drawn line
       `nodes`    [x, y] of every drawn node
       `boxes`    boxes already on the drawing (the saliency value labels)
       `m`        measured label box, relative to its anchor point
     Candidates are tried on rings of increasing radius, and the first ring that clears
     everything wins, so a label only moves as far from its node as it has to. */
  function placeNodeLabels(targets, segments, guides, nodes, boxes, view, m) {
    /* `clearEnough` is the gap a label settles for rather than moving further out, so it
       sets how close the labels sit: small enough to keep them beside their nodes, large
       enough that the ink never touches.  The rings start just outside the node disc and
       step finely, so the search can stop at the first distance that works. */
    var nodeR = NODE_R + 0.015 * U, clearEnough = 0.035 * U, steps = 48;
    var radii = [0.33 * U, 0.38 * U, 0.44 * U, 0.51 * U, 0.60 * U, 0.71 * U, 0.85 * U, 1.02 * U];
    var reach = Math.hypot(m.hx, m.hy);
    var placed = new Array(targets.length);

    /* Smallest gap between this label box and anything solid on the drawing; negative
       means overlap.  `self` is the label's own slot, which it is not compared against. */
    function clearance(box, self) {
      var clear = Infinity, j, d;
      for (j = 0; j < segments.length && clear > 0; j++) {
        var sg = segments[j];
        // cheap circular reject before the exact box-to-segment test
        if (segmentDistance(box.x, box.y, sg[0], sg[1], sg[2], sg[3]) - sg[4] - reach > clear) continue;
        d = boxSegmentDistance(box, sg[0], sg[1], sg[2], sg[3]) - sg[4];
        if (d < clear) clear = d;
      }
      for (j = 0; j < nodes.length && clear > 0; j++) {
        d = boxPointDistance(box, nodes[j][0], nodes[j][1]) - nodeR;
        if (d < clear) clear = d;
      }
      for (j = 0; j < boxes.length && clear > 0; j++) {
        d = boxBoxDistance(box, boxes[j]);
        if (d < clear) clear = d;
      }
      for (j = 0; j < placed.length && clear > 0; j++) {
        if (j === self || !placed[j]) continue;
        d = boxBoxDistance(box, placed[j].box);
        if (d < clear) clear = d;
      }
      return clear;
    }

    /* The fundamental-domain outline is a guide, not part of the graph, and near its
       corners it crowds three edges at once.  Treating it as solid there forces a label
       onto a real edge to dodge a dashed line, so it only breaks ties: the term is
       clamped either way, and so can never outweigh the gap to an edge or a node. */
    function guideClearance(box) {
      var clear = Infinity, j;
      for (j = 0; j < guides.length; j++) {
        var g = guides[j];
        var d = boxSegmentDistance(box, g[0], g[1], g[2], g[3]) - g[4];
        if (d < clear) clear = d;
      }
      return clear;
    }

    /* Best spot for label `i`: rings of candidates outwards from its node, stopping at the
       first ring that clears everything, so a label moves only as far as it has to. */
    function search(i) {
      var t = targets[i], best = null, ri, a;
      for (ri = 0; ri < radii.length; ri++) {
        for (a = 0; a < steps; a++) {
          // offset by half a step so the three honeycomb edge directions are never tried
          var ang = (a + 0.5) * 2 * Math.PI / steps;
          var ax = t.pos[0] + radii[ri] * Math.cos(ang), ay = t.pos[1] + radii[ri] * Math.sin(ang);
          var box = { x: ax + m.dx, y: ay + m.dy, hx: m.hx, hy: m.hy, ax: ax, ay: ay };
          if (box.x - box.hx < view[0] || box.x + box.hx > view[0] + view[2] ||
              box.y - box.hy < view[1] || box.y + box.hy > view[1] + view[3]) continue;
          var clear = clearance(box, i);
          var guide = guideClearance(box);
          /* An overlapping position is never worth taking for the sake of closeness, however
             far the alternative sits, so overlaps are scored on a scale of their own below
             every clear position.  Above zero the closest ring wins, since extra room beyond
             `clearEnough` buys nothing, and the guide only breaks ties. */
          var score = clear < 0
            ? clear - 1000
            : Math.min(clear, clearEnough)
              + 0.25 * Math.max(Math.min(guide, clearEnough), -clearEnough)
              - 0.30 * (radii[ri] - radii[0]);
          if (!best || score > best.score) best = { box: box, score: score, clear: clear, guide: guide };
        }
        if (best && best.clear >= clearEnough && best.guide >= 0) break;
      }
      return best;
    }

    var i, pass;
    for (i = 0; i < targets.length; i++) placed[i] = search(i);
    /* Placing them in order lets an early label box in a later one, which on a crowded
       tiling can leave the last label with nowhere clear to go.  Re-place each against the
       others' final positions until nothing improves; clearance only ever rises, so this
       terminates, and in practice one or two passes settle it. */
    for (pass = 0; pass < 4; pass++) {
      var improved = false;
      for (i = 0; i < targets.length; i++) {
        var current = clearance(placed[i].box, i), candidate = search(i);
        if (candidate && candidate.clear > current + 1e-6) { placed[i] = candidate; improved = true; }
      }
      if (!improved) break;
    }

    var out = [];
    for (i = 0; i < targets.length; i++) out.push({ target: targets[i], x: placed[i].box.ax, y: placed[i].box.ay });
    return out;
  }

  function drawTiling(svg, states, res, interactive, showLabels) {
    clear(svg);
    if (showLabels === undefined) showLabels = true;
    var corners = BT.domainCorners(0.25).map(toSvg);
    var xs = corners.map(function (p) { return p[0]; }), ys = corners.map(function (p) { return p[1]; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var mL = 1.45 * U, mR = 1.05 * U, mT = 0.85 * U, mB = 0.85 * U;
    var vx = minX - mL, vy = minY - mT, vw = maxX - minX + mL + mR, vh = maxY - minY + mT + mB;
    svg.setAttribute('viewBox', [vx, vy, vw, vh].join(' '));
    if (!interactive) svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    var gHex = svgEl('g', { 'class': 'layer-hex' }, svg);
    var gBase = svgEl('g', { 'pointer-events': 'none' }, svg);
    var gDiag = svgEl('g', {}, svg);
    var gDomain = svgEl('g', { 'pointer-events': 'none' }, svg);
    var gNodes = svgEl('g', { 'pointer-events': 'none' }, svg);
    var gTop = svgEl('g', { 'pointer-events': 'none' }, svg);
    var gLab = svgEl('g', { 'pointer-events': 'none' }, svg);
    var segments = [], guideSegments = [], valueBoxes = [];

    var lo = -1, hi = 4, r, c;
    // clickable hexagons; the face number lives in the tooltip rather than on the drawing
    for (r = lo; r < hi; r++) for (c = lo; c < hi; c++) {
      var h = BT.nodeIndex(r, c);
      var pts = BT.hexagonVertices(r, c).map(toSvg).map(function (p) { return p[0].toFixed(2) + ',' + p[1].toFixed(2); }).join(' ');
      var poly = svgEl('polygon', { points: pts, 'class': 'hex', 'data-h': h, tabindex: interactive ? 0 : null,
                                    role: interactive ? 'button' : null,
                                    'aria-label': interactive ? ('face ' + faceNo(h) + ', ' + BT.stateDescription(h, states[h])) : null }, gHex);
      if (interactive) {
        var title = svgEl('title', {}, poly);
        title.textContent = 'face ' + faceNo(h) + ': ' + (states[h] ? 'diagonal ' + BT.stateDescription(h, states[h]) : 'no diagonal') + ' — click to change';
        poly.addEventListener('click', onHexClick);
        poly.addEventListener('contextmenu', onHexContext);
        poly.addEventListener('keydown', onHexKey);
      }
    }

    // edges and nodes
    var whites = {}, blacks = {};
    var pe = BT.planeEdges(states, lo, hi);
    var topCopies = [];
    for (var i = 0; i < pe.length; i++) {
      var e = pe[i];
      var wp = toSvg(BT.whitePos(e.w[0], e.w[1])), bp = toSvg(BT.blackPos(e.b[0], e.b[1]));
      whites[e.w.join(',')] = { pos: wp, cell: e.w }; blacks[e.b.join(',')] = { pos: bp, cell: e.b };
      if (e.kind === 'base') {
        svgEl('line', { x1: wp[0], y1: wp[1], x2: bp[0], y2: bp[1], stroke: '#111', 'stroke-width': 1.5, 'stroke-linecap': 'round' }, gBase);
        segments.push([wp[0], wp[1], bp[0], bp[1], 0.75]);
      } else {
        var hh = BT.nodeIndex(e.hex[0], e.hex[1]);
        var wi = BT.nodeIndex(e.w[0], e.w[1]), bi = BT.nodeIndex(e.b[0], e.b[1]);
        var val = (res && res.mapNorm) ? res.mapNorm[wi * 9 + bi] : null;
        var color = val === null ? '#c0392b' : cool(val);
        var isTop = !!(res && res.top && res.top.h === hh);
        var line = svgEl('line', { x1: wp[0], y1: wp[1], x2: bp[0], y2: bp[1], stroke: color,
                                   'stroke-width': isTop ? 4.2 : 2.8, 'stroke-linecap': 'round', 'class': 'diag', 'data-h': hh }, gDiag);
        if (interactive) {
          var lt = svgEl('title', {}, line);
          lt.textContent = 'diagonal w' + (wi + 1) + ' – b' + (bi + 1) + ' in face ' + faceNo(hh) +
            (val === null ? '' : ', M = ' + val.toFixed(3)) + ' — click to change';
          line.addEventListener('click', onHexClick);
          line.addEventListener('contextmenu', onHexContext);
        }
        segments.push([wp[0], wp[1], bp[0], bp[1], isTop ? 2.1 : 1.4]);
        if (isTop && val !== null) topCopies.push({ mid: [(wp[0] + bp[0]) / 2, (wp[1] + bp[1]) / 2], dir: [bp[0] - wp[0], bp[1] - wp[1]], color: color, val: val });
      }
    }
    // value labels beside every visible copy of the highest-saliency diagonal (as in the paper)
    for (i = 0; i < topCopies.length; i++) {
      var tc = topCopies[i], len = Math.hypot(tc.dir[0], tc.dir[1]) || 1;
      var nx = -tc.dir[1] / len, ny = tc.dir[0] / len;              // unit normal
      var lx = tc.mid[0] + nx * 0.42 * U, ly = tc.mid[1] + ny * 0.42 * U;
      // skip labels that would be cut by the panel edge (text is about 0.9 U wide, 0.3 U tall)
      if (lx < vx + 0.5 * U || lx > vx + vw - 0.5 * U || ly < vy + 0.2 * U || ly > vy + vh - 0.2 * U) continue;
      var lab = svgEl('text', { x: lx, y: ly, 'text-anchor': 'middle', 'dominant-baseline': 'central',
                                'font-size': (0.27 * U).toFixed(1), 'font-weight': 600, fill: tc.color,
                                stroke: '#fff', 'stroke-width': 3, 'paint-order': 'stroke', 'class': 'fig-value-edge' }, gTop);
      lab.textContent = tc.val.toFixed(3);
      valueBoxes.push({ x: lx, y: ly, hx: 0.46 * U, hy: 0.17 * U });
    }
    // fundamental domain, which the labels also keep clear of
    svgEl('polygon', { points: corners.map(function (p) { return p[0].toFixed(2) + ',' + p[1].toFixed(2); }).join(' '),
                       fill: 'none', stroke: DOMAIN_COLOR, 'stroke-width': 2.2, 'stroke-dasharray': '7 5', 'stroke-linejoin': 'round' }, gDomain);
    for (i = 0; i < corners.length; i++) {
      var c1 = corners[i], c2 = corners[(i + 1) % corners.length];
      guideSegments.push([c1[0], c1[1], c2[0], c2[1], 1.1]);
    }

    // nodes: plain discs, as in the paper -- the labels sit beside them
    var rad = NODE_R, nodePoints = [], targets = [];
    function collect(map, fill, prefix) {
      var keys = Object.keys(map).sort();
      for (var k = 0; k < keys.length; k++) {
        var n = map[keys[k]], cr = n.cell[0], cc = n.cell[1];
        svgEl('circle', { cx: n.pos[0], cy: n.pos[1], r: rad, fill: fill, stroke: '#000', 'stroke-width': 1.0 }, gNodes);
        nodePoints.push(n.pos);
        if (showLabels && cr >= 0 && cr < 3 && cc >= 0 && cc < 3) {
          targets.push({ pos: n.pos, prefix: prefix, index: BT.nodeIndex(cr, cc) + 1 });
        }
      }
    }
    collect(whites, '#fff', 'w');
    collect(blacks, '#000', 'b');

    var labelSize = (0.25 * U).toFixed(1);
    var spots = placeNodeLabels(targets, segments, guideSegments, nodePoints, valueBoxes,
                                [vx, vy, vw, vh], labelMetrics(gLab, labelSize));
    for (i = 0; i < spots.length; i++) {
      var sp = spots[i];
      subLabel(gLab, sp.target.prefix, sp.target.index,
               { x: sp.x, y: sp.y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
                 'font-size': labelSize, fill: '#000', stroke: '#fff', 'stroke-width': 2.6,
                 'paint-order': 'stroke', 'class': 'fig-label' });
    }
  }

  // --------------------------------------------------------- panel (b) --
  function drawMap(svg, res) {
    clear(svg);
    var cell = 30, ox = 58, oy = 36, n = 9, grid = cell * n, u, v, s;
    // A tiling with no diagonal edges has nothing the saliency could rank: base edges are
    // not in the action space, so no cell of the map corresponds to a move.  Normalising
    // the gradient noise of such a tiling to its own peak would paint a full-colour map
    // that means nothing, so the map is drawn blank instead.
    var blank = !!(res && res.mapNorm && res.an.ND === 0);
    var cbX = ox + grid + 18, cbW = 14;
    var vw = cbX + cbW + 58, vh = oy + grid + 62;
    svg.setAttribute('viewBox', [0, 0, vw, vh].join(' '));
    mathText(svg, [{ t: 'saliency map ', bold: true }, { t: 'M', italic: true }, { t: 'uv', sub: true, italic: true }, { t: '(x)' }],
             { x: ox + grid / 2, y: 20, 'text-anchor': 'middle', 'font-size': 13, 'class': 'fig-text' });

    if (!res || !res.mapNorm) {
      svgEl('rect', { x: ox, y: oy, width: grid, height: grid, fill: '#f4f7f9', stroke: '#dfe5ea' }, svg);
      var ph = svgEl('text', { x: ox + grid / 2, y: oy + grid / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 12, 'class': 'fig-muted' }, svg);
      ph.textContent = app.modelReady ? 'no data' : 'loading the CNN…';
    } else if (blank) {
      svgEl('rect', { x: ox, y: oy, width: grid, height: grid, fill: '#fff' }, svg);
      for (u = 1; u < n; u++) {
        svgEl('line', { x1: ox + u * cell, y1: oy, x2: ox + u * cell, y2: oy + grid, stroke: '#eef2f5', 'stroke-width': 1 }, svg);
        svgEl('line', { x1: ox, y1: oy + u * cell, x2: ox + grid, y2: oy + u * cell, stroke: '#eef2f5', 'stroke-width': 1 }, svg);
      }
      svgEl('rect', { x: ox, y: oy, width: grid, height: grid, fill: 'none', stroke: '#c4cfd7', 'stroke-width': 1 }, svg);
    } else {
      var m = res.mapNorm;
      var order = [];
      for (u = 0; u < 81; u++) order.push(u);
      order.sort(function (a, b) { return m[b] - m[a] || a - b; });
      var top10 = {};
      for (u = 0; u < 10; u++) top10[order[u]] = true;
      for (u = 0; u < n; u++) for (v = 0; v < n; v++) {
        var val = m[u * 9 + v];
        var rect = svgEl('rect', { x: ox + v * cell, y: oy + u * cell, width: cell, height: cell, fill: cool(val), 'shape-rendering': 'crispEdges' }, svg);
        var t = svgEl('title', {}, rect);
        var present = app.states.some(function (s, h) { return s && BT.DIAG_CELLS[h][s].w === u && BT.DIAG_CELLS[h][s].b === v; });
        t.textContent = 'M(w' + (u + 1) + ', b' + (v + 1) + ') = ' + val.toFixed(3) + (present ? ' — diagonal edge present' : '');
      }
      for (u = 0; u < n; u++) for (v = 0; v < n; v++) {
        if (!top10[u * 9 + v]) continue;
        var lab = svgEl('text', { x: ox + v * cell + cell / 2, y: oy + u * cell + cell / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central',
                                  'font-size': 8.5, 'font-weight': 700, fill: '#fff', stroke: '#000', 'stroke-width': 1.6, 'paint-order': 'stroke', 'class': 'fig-value' }, svg);
        lab.textContent = m[u * 9 + v].toFixed(3);
      }
      if (res.top) {
        svgEl('rect', { x: ox + res.top.b * cell, y: oy + res.top.w * cell, width: cell, height: cell, fill: 'none', stroke: '#000',
                        'stroke-width': 2.4, 'stroke-dasharray': '5 3' }, svg);
      }
    }
    // ticks
    for (u = 0; u < n; u++) {
      subLabel(svg, 'w', u + 1, { x: ox - 6, y: oy + u * cell + cell / 2 + 1, 'text-anchor': 'end', 'dominant-baseline': 'central', 'font-size': 9.5, 'class': 'fig-tick' });
      subLabel(svg, 'b', u + 1, { x: ox + u * cell + cell / 2, y: oy + grid + 13, 'text-anchor': 'middle', 'font-size': 9.5, 'class': 'fig-tick' });
    }
    mathText(svg, [{ t: 'black nodes ', bold: true }, { t: 'b', italic: true }, { t: 'j', sub: true, italic: true }],
             { x: ox + grid / 2, y: oy + grid + 34, 'text-anchor': 'middle', 'font-size': 10.5, 'class': 'fig-text' });
    mathText(svg, [{ t: 'white nodes ', bold: true }, { t: 'w', italic: true }, { t: 'i', sub: true, italic: true }],
             { x: 14, y: oy + grid / 2, 'text-anchor': 'middle', 'font-size': 10.5, 'class': 'fig-text', transform: 'rotate(-90 14 ' + (oy + grid / 2) + ')' });
    // colour bar, which a blank map has no use for
    if (blank) return;
    var defs = svgEl('defs', {}, svg);
    var grad = svgEl('linearGradient', { id: 'cool-grad', x1: 0, y1: 1, x2: 0, y2: 0 }, defs);
    for (s = 0; s <= 10; s++) svgEl('stop', { offset: (s * 10) + '%', 'stop-color': cool(s / 10) }, grad);
    svgEl('rect', { x: cbX, y: oy, width: cbW, height: grid, fill: 'url(#cool-grad)', stroke: '#000', 'stroke-width': 0.8 }, svg);
    for (s = 0; s <= 5; s++) {
      var yy = oy + grid - s * grid / 5;
      svgEl('line', { x1: cbX + cbW, y1: yy, x2: cbX + cbW + 4, y2: yy, stroke: '#000', 'stroke-width': 0.8 }, svg);
      var tl = svgEl('text', { x: cbX + cbW + 7, y: yy, 'dominant-baseline': 'central', 'font-size': 9, 'class': 'fig-tick' }, svg);
      tl.textContent = (s / 5).toFixed(1);
    }
    var cl = svgEl('text', { x: cbX + cbW + 44, y: oy + grid / 2, 'text-anchor': 'middle', 'font-size': 9.5, 'class': 'cbar-label',
                             transform: 'rotate(90 ' + (cbX + cbW + 44) + ' ' + (oy + grid / 2) + ')' }, svg);
    cl.textContent = 'normalised saliency';
  }

  // --------------------------------------------------------- panel (c) --
  /* A multiplicity label goes inside one of the four grid cells that meet at its
     lattice point.  The offsets are built from the measured glyph box, so the label
     always clears the two grid lines crossing the point, and the quadrant is then
     chosen for the most room from the markers, the polygon edges, the remaining grid
     lines and the labels already placed.  An overlapping position scores below every
     clear one, so proximity is never bought with a collision. */
  function placeMultiplicity(size, cx, cy, discs, bars, placed, view) {
    var best = null, sx, sy, ai, bi, j, d;
    for (sx = -1; sx <= 1; sx += 2) for (sy = -1; sy <= 1; sy += 2) {
      for (ai = 0; ai < 3; ai++) for (bi = 0; bi < 3; bi++) {
        var ax = cx + sx * (size.hx + 3.5 + ai * 5.5);
        var ay = cy + sy * (size.hy + 3.5 + bi * 5.5);
        var box = { x: ax, y: ay, hx: size.hx, hy: size.hy };
        var outside = (box.x - box.hx < view[0] || box.x + box.hx > view[0] + view[2] ||
                       box.y - box.hy < view[1] || box.y + box.hy > view[1] + view[3]) ? 1 : 0;
        var clear = Infinity;
        for (j = 0; j < discs.length && clear > 0; j++) {
          d = boxPointDistance(box, discs[j].x, discs[j].y) - discs[j].r;
          if (d < clear) clear = d;
        }
        for (j = 0; j < bars.length && clear > 0; j++) {
          var sg = bars[j];
          d = boxSegmentDistance(box, sg[0], sg[1], sg[2], sg[3]) - sg[4];
          if (d < clear) clear = d;
        }
        for (j = 0; j < placed.length && clear > 0; j++) {
          d = boxBoxDistance(box, placed[j]);
          if (d < clear) clear = d;
        }
        var reach = Math.abs(ax - cx) + Math.abs(ay - cy);
        var score = (clear < 0 ? clear - 1000 : Math.min(clear, 2.5) - 0.06 * reach) - 50 * outside;
        if (!best || score > best.score) best = { box: box, score: score, clear: clear };
      }
    }
    return best;
  }

  function drawToric(svg, an) {
    clear(svg);
    var cell = 36, pad = 1;
    var R_CORNER = 6.5, R_POINT = 5, MARKER_STROKE = 1.2;
    var pts = an.points, i;
    var minx = 0, maxx = 0, miny = 0, maxy = 0;
    if (pts.length) {
      minx = Infinity; maxx = -Infinity; miny = Infinity; maxy = -Infinity;
      for (i = 0; i < pts.length; i++) { minx = Math.min(minx, pts[i][0]); maxx = Math.max(maxx, pts[i][0]); miny = Math.min(miny, pts[i][1]); maxy = Math.max(maxy, pts[i][1]); }
    }
    var x0 = minx - pad, x1 = maxx + pad, y0 = miny - pad, y1 = maxy + pad;
    var W = (x1 - x0) * cell, H = (y1 - y0) * cell, m = 22;
    svg.setAttribute('viewBox', [-m, -m, W + 2 * m, H + 2 * m].join(' '));
    var X = function (x) { return (x - x0) * cell; }, Y = function (y) { return (y1 - y) * cell; };

    // everything the labels have to keep clear of
    var bars = [], discs = [];

    for (var gx = x0; gx <= x1; gx++) {
      svgEl('line', { x1: X(gx), y1: Y(y0), x2: X(gx), y2: Y(y1), stroke: '#b9b9b9', 'stroke-width': 1 }, svg);
      bars.push([X(gx), Y(y0), X(gx), Y(y1), 0.5]);
    }
    for (var gy = y0; gy <= y1; gy++) {
      svgEl('line', { x1: X(x0), y1: Y(gy), x2: X(x1), y2: Y(gy), stroke: '#b9b9b9', 'stroke-width': 1 }, svg);
      bars.push([X(x0), Y(gy), X(x1), Y(gy), 0.5]);
    }
    if (an.hull.length >= 3) {
      svgEl('polygon', { points: an.hull.map(function (p) { return X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join(' '),
                         fill: 'none', stroke: '#000', 'stroke-width': 2.2, 'stroke-linejoin': 'round' }, svg);
      for (i = 0; i < an.hull.length; i++) {
        var h1 = an.hull[i], h2 = an.hull[(i + 1) % an.hull.length];
        bars.push([X(h1[0]), Y(h1[1]), X(h2[0]), Y(h2[1]), 1.1]);
      }
    }
    // missing interior lattice points (hollow, dashed red)
    for (i = 0; i < an.missingInterior.length; i++) {
      var mp = an.missingInterior[i];
      svgEl('circle', { cx: X(mp.x), cy: Y(mp.y), r: R_POINT, fill: '#fff', stroke: '#c0392b', 'stroke-width': MARKER_STROKE, 'stroke-dasharray': '2.5 2' }, svg);
      discs.push({ x: X(mp.x), y: Y(mp.y), r: R_POINT + MARKER_STROKE / 2 });
    }
    for (i = 0; i < pts.length; i++) {
      var p = pts[i], key = p[0] + ',' + p[1];
      var isCorner = !!an.cornerSet[key], onBoundary = !!an.boundarySet[key];
      var fill = isCorner ? '#000' : (onBoundary ? '#ffeb3b' : '#7ce87c');
      var rr = isCorner ? R_CORNER : R_POINT;
      var circ = svgEl('circle', { cx: X(p[0]), cy: Y(p[1]), r: rr, fill: fill, stroke: '#000', 'stroke-width': MARKER_STROKE }, svg);
      var tt = svgEl('title', {}, circ);
      tt.textContent = '(' + p[0] + ', ' + p[1] + '): multiplicity ' + an.mult[key] + (isCorner ? ' (corner)' : onBoundary ? ' (boundary)' : ' (interior)');
      discs.push({ x: X(p[0]), y: Y(p[1]), r: rr + MARKER_STROKE / 2 });
    }

    // the multiplicities go last, so they sit above the markers
    var gLab = svgEl('g', { 'pointer-events': 'none' }, svg);
    var view = [-m, -m, W + 2 * m, H + 2 * m], placed = [];
    for (i = 0; i < pts.length; i++) {
      var q = pts[i], qkey = q[0] + ',' + q[1];
      var t = svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central',
                              'font-size': 9, 'class': 'fig-text' }, gLab);
      t.textContent = String(an.mult[qkey]);
      var bb = null;
      try { bb = t.getBBox(); } catch (e) { bb = null; }
      var wide = bb && bb.width, tall = bb && bb.height;
      var size = { hx: wide ? bb.width / 2 + 1.2 : 6, hy: tall ? bb.height / 2 + 1.2 : 6 };
      var offx = wide ? bb.x + bb.width / 2 : 0, offy = tall ? bb.y + bb.height / 2 : 0;
      var spot = placeMultiplicity(size, X(q[0]), Y(q[1]), discs, bars, placed, view);
      t.setAttribute('x', (spot.box.x - offx).toFixed(2));
      t.setAttribute('y', (spot.box.y - offy).toFixed(2));
      placed.push(spot.box);
    }

    if (!pts.length) {
      var ph = svgEl('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 12, 'class': 'fig-muted' }, svg);
      ph.textContent = 'det K = 0';
    }
  }

  // --------------------------------------------------------- panel (d) --
  /* The layout depends on the tiling alone, so it is kept for the re-renders that change
     nothing but colours: the model arriving, the webfont landing, a change of scale. */
  var quiverLayouts = {}, quiverLayoutOrder = [];
  function quiverLayout(q, states, index) {
    if (!quiverLayouts[index]) {
      quiverLayouts[index] = QV.layout(q, states);
      quiverLayoutOrder.push(index);
      if (quiverLayoutOrder.length > 64) delete quiverLayouts[quiverLayoutOrder.shift()];
    }
    return quiverLayouts[index];
  }
  var SUB_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
  function subscript(s) { return String(s).replace(/[0-9]/g, function (d) { return SUB_DIGITS.charAt(+d); }); }
  /* X₁₂, X₅,₁₁: a field name for tooltips, where markup is not available. */
  function fieldText(a) { return 'X' + subscript(a.from > 9 || a.to > 9 ? a.from + ',' + a.to : '' + a.from + a.to); }
  function fieldHtml(a) { return '<i>X</i><sub>' + (a.from > 9 || a.to > 9 ? a.from + ',' + a.to : '' + a.from + a.to) + '</sub>'; }
  function edgeText(u, v) { return 'w' + subscript(u + 1) + '–b' + subscript(v + 1); }

  function gaugeGroupText(nd, states) {
    var face = faceNo(nd.hex);
    if (nd.half === 'whole') return 'face ' + face + ' of the tiling';
    var diag = 'its diagonal ' + BT.stateDescription(nd.hex, states[nd.hex]);
    return nd.half === 'upper' ? 'the part of face ' + face + ' above ' + diag
                               : 'the part of face ' + face + ' below ' + diag + ', the gauge group the diagonal adds';
  }

  function drawQuiver(svg, res) {
    clear(svg);
    var q = res.quiver, states = app.states, lay = quiverLayout(q, states, res.an.index), geo = QV.geometry(q, lay), i;
    svg.setAttribute('viewBox', lay.view.join(' '));
    var gArrows = svgEl('g', {}, svg), gNodes = svgEl('g', {}, svg);
    for (i = 0; i < geo.length; i++) {
      var it = geo[i], a = it.arrow, diag = a.kind === 'diagonal';
      var val = diag && res.mapNorm ? res.mapNorm[a.white * 9 + a.black] : null;
      var colour = !diag ? '#000' : (val === null ? DIAGONAL_RED : cool(val));
      var isTop = diag && !!res.top && res.top.h === a.hex;
      var g = svgEl('g', { 'class': 'q-arrow' }, gArrows);
      var p0 = lay.pos[a.from], p1 = lay.pos[a.to];
      // a wide invisible line under the drawn one, so a 3-unit field is easy to point at
      svgEl('line', { x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1], stroke: 'transparent', 'stroke-width': 10 }, g);
      var d = it.pieces.map(function (pc) {
        return 'M' + pc[0].toFixed(2) + ',' + pc[1].toFixed(2) + 'L' + pc[2].toFixed(2) + ',' + pc[3].toFixed(2);
      }).join('');
      if (d) svgEl('path', { d: d, fill: 'none', stroke: colour, 'stroke-width': isTop ? 4.6 : 3 }, g);
      svgEl('path', { d: QV.headPath(it.head), fill: colour }, g);
      var title = svgEl('title', {}, g);
      title.textContent = fieldText(a) + ', from gauge group ' + a.from + ' to ' + a.to + ': ' +
        (diag ? 'the diagonal ' + edgeText(a.white, a.black) + ' of face ' + faceNo(a.hex) +
                (val === null ? '' : ', saliency M = ' + val.toFixed(3)) +
                '. Higgsing it joins ' + a.from + ' and ' + a.to + ' back into face ' + faceNo(a.hex) + '.'
              : 'the edge ' + edgeText(a.white, a.black) + '.');
    }
    for (i = 0; i < q.nodes.length; i++) {
      var nd = q.nodes[i], p = lay.pos[nd.id];
      var gn = svgEl('g', { 'class': 'q-node', 'data-h': nd.hex, tabindex: 0, role: 'button',
                            'aria-label': 'gauge group ' + nd.id + ', ' + gaugeGroupText(nd, states) + '; changes the diagonal of face ' + faceNo(nd.hex) }, gNodes);
      svgEl('circle', { cx: p[0], cy: p[1], r: QV.NODE_R, fill: GAUGE_GOLD, stroke: '#000', 'stroke-width': 3 }, gn);
      var lab = svgEl('text', { x: p[0], y: p[1] + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central',
                                'font-size': nd.id > 9 ? 13.5 : 15, 'class': 'q-label' }, gn);
      lab.textContent = String(nd.id);
      var nt = svgEl('title', {}, gn);
      nt.textContent = 'U(N)' + subscript(nd.id) + ': ' + gaugeGroupText(nd, states) + ' — click to change the diagonal of face ' + faceNo(nd.hex);
      gn.addEventListener('click', onHexClick);
      gn.addEventListener('contextmenu', onHexContext);
      gn.addEventListener('keydown', onHexKey);
    }
  }

  /* The superpotential beside the quiver, and the panel's captions. */
  function renderQuiverText(res) {
    var an = res.an, topHex = res.top ? res.top.h : -1, plus = [], minus = [], NE = 27 + an.ND;
    for (var i = 0; i < res.W.length; i++) {
      var t = res.W[i];
      var fields = t.arrows.map(function (a) {
        return '<span class="wfield' + (a.kind === 'diagonal' && a.hex === topHex ? ' is-top' : '') + '">' + fieldHtml(a) + '</span>';
      }).join('');
      (t.sign > 0 ? plus : minus).push('<li><span class="wterm__node"><i>' + t.node.charAt(0) + '</i><sub>' + t.node.slice(1) + '</sub></span>' +
        '<span class="wterm__sign">' + (t.sign > 0 ? '+' : '&minus;') + '</span><span class="wterm__fields">' + fields + '</span></li>');
    }
    $('w-plus').innerHTML = plus.join('');
    $('w-minus').innerHTML = minus.join('');
    $('quiver-pill').innerHTML = 'N<sub>G</sub> = ' + an.NG + ' &middot; N<sub>E</sub> = ' + NE;
    $('w-summary').innerHTML = 'One term per node of the tiling, ' + res.W.length + ' in all: the fields around a white node, read clockwise, ' +
      'with a plus sign, and around a black node, read anticlockwise, with a minus sign. Each of the ' + NE + ' fields appears once with each sign.' +
      (topHex >= 0 ? ' Highlighted: the field of the highest-saliency diagonal.' : '');
    $('quiver-note').innerHTML = an.ND === 0
      ? 'The quiver of C<sup>3</sup>/(Z<sub>3</sub>&times;Z<sub>3</sub>): the nine gauge groups fall into three classes, and each has one field to every gauge group of the next. ' +
        'Every field is oriented clockwise around the white node of its edge in (a). Click a gauge group to split it with a diagonal.'
      : 'A diagonal splits gauge group <i>i</i> in two: the part above the diagonal keeps <i>i</i>, the part below is numbered from 10 on, and the diagonal&rsquo;s own field joins them' +
        (res.mapNorm ? ', coloured by its saliency as in (a), the highest-ranked drawn thickest' : '') +
        '. Every field is oriented clockwise around the white node of its edge.';
  }

  // ------------------------------------------------------------- stats --
  /* "face 7 (w3 – b7)", or "faces 2, 5 and 7" for a set of several. */
  function faceSetText(set, states) {
    if (set.length === 1) return 'face ' + faceNo(set[0]) + ' (' + BT.stateDescription(set[0], states[set[0]]) + ')';
    var names = set.map(faceNo).sort(function (x, y) { return x - y; }).map(String);
    return 'faces ' + names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }
  function repairSetsText(fx, states) {
    // in order of face numbers, so the list reads the same way as the tiling's labels
    var ordered = fx.sets.map(function (s) { return { set: s, key: s.map(faceNo).sort(function (x, y) { return x - y; }) }; })
      .sort(function (x, y) { for (var i = 0; i < x.key.length; i++) if (x.key[i] !== y.key[i]) return x.key[i] - y.key[i]; return 0; });
    var shown = ordered.slice(0, 3).map(function (o) { return faceSetText(o.set, states); }), more = fx.sets.length - shown.length;
    return (fx.sets.length === 1 ? 'The only way: ' : 'The ' + fx.sets.length + ' ways: ') + shown.join('; ') +
           (more ? '; and ' + more + ' more' : '') + '.';
  }

  function formatTerms(terms) {
    if (!terms.length) return '0';
    var t = terms.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    var parts = [];
    for (var i = 0; i < t.length; i++) {
      var c = t[i].coeff, mono = [];
      if (t[i].x) mono.push(t[i].x === 1 ? 'x' : 'x^' + t[i].x);
      if (t[i].y) mono.push(t[i].y === 1 ? 'y' : 'y^' + t[i].y);
      var body = mono.join(' ');
      var mag = Math.abs(c);
      var txt = body ? ((mag === 1 ? '' : mag + ' ') + body) : String(mag);
      parts.push((c < 0 ? '− ' : (i ? '+ ' : '')) + txt);
    }
    return parts.join(' ');
  }

  function renderStats(res) {
    var an = res.an, states = app.states;
    $('stat-index').textContent = fmtInt(an.index);
    $('stat-states').textContent = states.join('');
    $('stat-ng').textContent = String(an.NG);
    $('stat-nd').textContent = String(an.ND);
    $('tiling-pill').innerHTML = 'N<sub>D</sub> = ' + an.ND;
    $('stat-2a').textContent = an.degenerate ? '2A undefined' : '2A = ' + an.twiceArea;
    $('stat-area').innerHTML = an.degenerate ? 'det K is zero or its Newton polygon is degenerate'
      : 'A = ' + (an.twiceArea / 2) + ' &middot; deficit <i>N<sub>G</sub></i> &minus; 2A = ' + an.deficit;
    var verdict = $('stat-verdict');
    verdict.textContent = an.consistent ? 'consistent' : 'inconsistent';
    verdict.className = 'readout__num ' + (an.consistent ? 'is-ok' : 'is-fail');
    /* The paper's criterion, and the only one the verdict rests on. */
    var ul = $('stat-conditions'); ul.innerHTML = '';
    var areaOk = an.degenerate ? null : an.area;
    var li = document.createElement('li');
    li.innerHTML = '<span class="mark ' + (areaOk === null ? 'is-na' : areaOk ? 'is-ok' : 'is-fail') + '">' +
      (areaOk === null ? '–' : areaOk ? '✓' : '✗') + '</span>' +
      '<span>2<i>A</i> = <i>N<sub>G</sub></i>' +
      (an.degenerate ? '' : ' · ' + an.twiceArea + ' vs ' + an.NG) + '</span>';
    ul.appendChild(li);
    /* How far the tiling is from consistency, counted in diagonal deletions: the paper's
       1-edge-fixable tilings have k = 1, and the same count gives 2, 3, ... beyond them. */
    var fx = res.fix, fixEl = $('stat-fix'), fixSub = $('stat-fix-sub');
    if (!fx) {
      fixEl.textContent = '–'; fixEl.className = 'readout__num';
      fixSub.textContent = 'the fewest diagonal deletions that restore consistency';
    } else if (fx.k === 0) {
      fixEl.textContent = 'consistent'; fixEl.className = 'readout__num is-ok';
      fixSub.innerHTML = 'no diagonal needs removing: <i>k</i> = 0';
    } else {
      fixEl.textContent = fx.k + '-edge-fixable'; fixEl.className = 'readout__num';
      fixSub.innerHTML = (fx.k === 1 ? 'removing one diagonal restores consistency. '
                                     : 'removing ' + fx.k + ' diagonals restores consistency, and no fewer do. ') + repairSetsText(fx, states);
    }
    var tp = $('toric-pill');
    tp.innerHTML = an.degenerate ? 'degenerate' : (an.area ? '2A = N<sub>G</sub> = ' + an.NG : '2A = ' + an.twiceArea + ' &ne; N<sub>G</sub> = ' + an.NG);
    tp.className = 'pill ' + (an.consistent ? 'pill--ok' : 'pill--fail');
    var tv = $('toric-verdict');
    tv.innerHTML = '<strong class="' + (an.consistent ? 'is-ok' : 'is-fail') + '">' + (an.consistent ? 'consistent' : 'inconsistent') + '</strong>' +
      '<span>2<i>A</i> = ' + (an.degenerate ? '–' : an.twiceArea) + '</span><span><i>N<sub>G</sub></i> = ' + an.NG + '</span>';
    $('detk').textContent = 'P(x, y) = perm K(x, y) = ' + formatTerms(an.terms) +
      (an.residual > 1e-6 ? '\n(warning: DFT residual ' + an.residual.toExponential(2) + ')' : '');

    var prob = $('stat-prob'), pred = $('stat-pred'), mp = $('map-pill');
    if (res.prob === null) {
      prob.textContent = '–'; prob.className = 'readout__num';
      pred.textContent = app.modelReady ? '' : 'the CNN is still loading';
      mp.textContent = 'CNN'; mp.className = 'pill';
    } else {
      var thr = CNN.meta().threshold, isCons = res.prob > thr, agrees = isCons === an.consistent;
      // always four decimal places, never exponential notation
      prob.textContent = 'p = ' + res.prob.toFixed(4);
      prob.className = 'readout__num';
      pred.innerHTML = 'predicted <strong>' + (isCons ? 'consistent' : 'inconsistent') + '</strong> (p ' + (isCons ? '&gt;' : '&le;') + ' ' + thr + '), ' +
        (agrees ? 'agreeing with' : '<span style="color:var(--fail)">disagreeing with</span>') + ' the exact check · logit S = ' + res.logit.toFixed(3);
      mp.textContent = isCons ? 'CNN: consistent' : 'CNN: inconsistent';
      mp.className = 'pill ' + (agrees ? 'pill--brand' : 'pill--fail');
    }
    var top = $('stat-top'), topSub = $('stat-top-sub'), btnRepair = $('btn-repair');
    if (!res.top) {
      top.textContent = an.ND ? '–' : 'no diagonal edges';
      top.className = 'readout__num';
      topSub.textContent = an.ND ? (app.modelReady ? '' : 'waiting for the CNN') : 'add a diagonal by clicking a hexagon';
      btnRepair.disabled = true;
    } else {
      top.innerHTML = 'w<sub>' + (res.top.w + 1) + '</sub> – b<sub>' + (res.top.b + 1) + '</sub>';
      top.className = 'readout__num';
      var extra;
      if (an.consistent) extra = 'The tiling is already consistent; removing the edge ' + (res.top.repairs ? 'keeps it consistent.' : 'makes it inconsistent.');
      else extra = res.top.repairs ? '<span style="color:var(--ok)">Removing it restores consistency.</span>' : '<span style="color:var(--fail)">Removing it does not restore consistency.</span>';
      var rep = res.repairs.length ? ' Exact repairs: ' + res.repairs.map(function (h) { return 'face ' + faceNo(h) + ' (' + BT.stateDescription(h, states[h]) + ')'; }).join(', ') + '.' :
                (an.consistent ? '' : ' No single diagonal deletion repairs this tiling.');
      if (!an.consistent && res.fix && res.fix.k > 1) {
        /* Beyond one deletion the question is whether the top-ranked edge is part of a
           smallest repair.  If it is, removing it leaves a tiling exactly one deletion
           closer (k - 1); if it is in none, removing it cannot lower k at all.  Nothing is
           claimed about later presses: the next top-ranked edge may or may not be in the
           new tiling's smallest repair, and the cell says which once it is shown. */
        var k = res.fix.k, sets = res.fix.sets, inSets = sets.filter(function (s) { return s.indexOf(res.top.h) >= 0; }).length;
        rep += ' It is ' + k + '-edge-fixable, and this edge is ' +
          (inSets ? 'in ' + (sets.length === 1 ? 'its smallest repair'
                              : inSets === sets.length ? 'all ' + sets.length + ' of its smallest repairs'
                              : inSets + ' of its ' + sets.length + ' smallest repairs') +
                    ': removing it leaves a ' + (k - 1) + '-edge-fixable tiling, one deletion closer to consistency. After the press, this cell checks the next top-ranked edge in the same way.'
                  : (sets.length === 1 ? 'not in its smallest repair' : 'in none of its ' + sets.length + ' smallest repairs') +
                    ', so removing it brings the tiling no closer to consistency.');
      }
      topSub.innerHTML = 'face ' + faceNo(res.top.h) + ', S<sub>uvk</sub> = ' + res.top.Snorm.toFixed(3) + ' (M<sub>uv</sub> = ' + res.top.Mnorm.toFixed(3) + ') normalised to the ' +
        (res.anchored ? 'shared' : 'current') + ' peak |∂S/∂x| = ' + res.scalePeak.toExponential(3) + '. ' + extra + rep;
      btnRepair.disabled = false;
    }
    $('btn-undo').disabled = app.history.length === 0;
    $('index-input').placeholder = String(an.index);
    $('tiling-note').innerHTML = an.ND === 0
      ? 'Dashed green parallelogram: the fundamental domain on <i>T</i><sup>2</sup>. Click any hexagon to add a diagonal edge.'
      : 'Dashed green parallelogram: the fundamental domain on <i>T</i><sup>2</sup>. Diagonal edges are coloured by their normalised saliency <i>M<sub>uv</sub></i>.';
    $('map-note').innerHTML = an.ND === 0
      ? 'This tiling has no diagonal edges, so there is no edge the saliency could rank and the map is left blank. Base edges cannot be removed without leaving the space of hexagonal tilings. Click a hexagon to add a diagonal.'
      : res.anchored
      ? 'Colours are held on the scale of configuration ' + fmtInt(app.anchor.index) + ', whose peak is |∂<i>S</i>/∂<b>x</b>| = ' + app.anchor.peak.toExponential(3) +
        ', so this map is directly comparable with the one before the edit, as in the before/after pairs of Figs. 7 and 8. On its own scale this map would read 1.000, and its peak is ' +
        (res.peak || 0).toExponential(3) + '.'
      : '|∂<i>S</i>/∂<b>x</b><sub><i>uvk</i></sub>| maximised over the nine winding channels <i>k</i>, normalised to this tiling\'s own peak |∂<i>S</i>/∂<b>x</b>| = ' +
        (res.peak || 0).toExponential(3) + '. The dashed box marks the highest-saliency diagonal edge.';
    /* When the brightest cell is not the boxed one, say why: this is the distinction the
       paper draws between the projected map, which is for visualisation, and the ranking
       of the 729 components, which is what localises the defect. */
    if (res.top && res.topAll && (res.topAll[1] !== res.top.w || res.topAll[2] !== res.top.b)) {
      $('map-note').innerHTML += ' Its largest value is at (<i>w</i><sub>' + (res.topAll[1] + 1) +
        '</sub>,&nbsp;<i>b</i><sub>' + (res.topAll[2] + 1) + '</sub>), a node pair carrying ' +
        (res.topAllHasEdge ? 'no diagonal' : 'no edge at all') +
        ' in this tiling. The map keeps the maximum over all nine channels at each pair, including components that carry no edge, so it serves for visualisation only; the ranking that localises the defect runs over the 729 components <i>S<sub>uvk</sub></i> restricted to the diagonals actually present, which is the boxed cell.';
    }
    var btnScale = $('btn-scale');
    if (res.anchored) {
      btnScale.disabled = false;
      btnScale.textContent = 'Use this tiling\'s own scale';
    } else if (app.previous && app.previous.index !== an.index && an.ND > 0) {
      btnScale.disabled = false;
      btnScale.textContent = 'Compare with configuration ' + fmtInt(app.previous.index);
    } else {
      btnScale.disabled = true;
      btnScale.textContent = 'Scaled to this tiling';
    }
  }

  // ------------------------------------------------------------ render --
  function render() {
    var res = compute();
    app.result = res;
    drawTiling($('tiling-svg'), app.states, res, true);
    drawMap($('map-svg'), res);
    drawToric($('toric-svg'), res.an);
    drawQuiver($('quiver-svg'), res);
    renderQuiverText(res);
    renderStats(res);
    var idx = res.an.index;
    try { if (window.history && window.history.replaceState) window.history.replaceState(null, '', '#' + idx); } catch (e) { /* file:// or sandboxed frames */ }
    var buttons = document.querySelectorAll('#preset-bar [data-index]');
    for (var i = 0; i < buttons.length; i++) buttons[i].classList.toggle('is-active', parseInt(buttons[i].getAttribute('data-index'), 10) === idx);
  }

  function setStates(next, options) {
    options = options || {};
    setStatus('');
    if (options.remember !== false) { app.history.push(app.states.slice()); if (app.history.length > 100) app.history.shift(); }
    // remember what we are leaving, so its scale can be borrowed for a comparison
    if (app.result && app.result.peak > 0) app.previous = { index: app.result.an.index, peak: app.result.peak };
    if (!options.keepAnchor) app.anchor = null;
    app.states = next.slice();
    render();
  }
  function cycleHex(h, dir) {
    var next = app.states.slice();
    next[h] = (next[h] + dir + 4) % 4;
    setStates(next);
  }
  function onHexClick(ev) { ev.preventDefault(); cycleHex(parseInt(ev.currentTarget.getAttribute('data-h'), 10), 1); }
  function onHexContext(ev) { ev.preventDefault(); cycleHex(parseInt(ev.currentTarget.getAttribute('data-h'), 10), -1); }
  function onHexKey(ev) {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); cycleHex(parseInt(ev.currentTarget.getAttribute('data-h'), 10), ev.shiftKey ? -1 : 1); }
  }
  function loadIndex(idx) {
    idx = Math.floor(Number(idx));
    if (!(idx >= 0 && idx < BT.NUM_CONFIGS)) return false;
    setStates(BT.decodeIndex(idx));
    return true;
  }
  function randomFrom(list) { return list[Math.floor(Math.random() * list.length)]; }
  function resetAnchor() { app.anchor = null; }
  /* The colour scale is only reset once there is a tiling to show: a rejected index or hash
     leaves the page, scale included, exactly as it was drawn. */
  function jumpTo(idx) {
    var n = Math.floor(Number(idx));
    if (!(n >= 0 && n < BT.NUM_CONFIGS)) return false;
    resetAnchor();
    return loadIndex(n);
  }
  /* A uniformly random tiling with repair distance k, by rejection: draw any index and keep
     it if its fewest repairing deletions number exactly k.  For k = 3 about one draw in
     seven is kept (39,006 of 262,144), and each draw is at most 512 index lookups. */
  function randomWithRepairDistance(k) {
    for (var t = 0; t < 20000; t++) {
      var idx = Math.floor(Math.random() * BT.NUM_CONFIGS), r = BT.repairDistance(BT.decodeIndex(idx), isConsistentIndex);
      if (r && r.k === k) return idx;
    }
    return null;
  }

  // ---------------------------------------------------------------- files --
  function setStatus(msg, isError) {
    var el = $('io-status');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('is-error', !!isError);
  }
  function edgeRecord(u, v) { return { white: 'w' + (u + 1), black: 'b' + (v + 1) }; }

  /* Everything shown for the current tiling, as one JSON document.  Loading reads back only
     the configuration, and the colour scale under "view"; the results are a record. */
  function configurationRecord(res) {
    var an = res.an, states = app.states, q = res.quiver, thr = app.modelReady ? CNN.meta().threshold : null, h;
    var diagonals = [];
    for (h = 0; h < 9; h++) if (states[h]) {
      var dc = BT.DIAG_CELLS[h][states[h]];
      diagonals.push({ face: faceNo(h), digit: h + 1, state: states[h], edge: edgeRecord(dc.w, dc.b) });
    }
    return {
      format: 'xai-brane-tiling',
      version: 1,
      description: 'Hexagonal brane tiling for C^3/(Z_3 x Z_3) with orbifold action (0,1,2)(1,0,2) and added diagonal edges, ' +
                   'saved by the interactive companion to arXiv:2609.21867. "Load JSON" reads the configuration and the colour scale ' +
                   'under "view"; everything under "results" is recomputed on loading and kept here for reference.',
      saved: new Date().toISOString(),
      configuration: { index: an.index, states: states.slice(), digits: states.join(''), diagonals: diagonals },
      view: { colour_scale: res.scaleRef ? { mode: 'shared', reference_index: res.scaleRef.index, reference_peak: res.scaleRef.peak } : { mode: 'own' } },
      results: {
        N_D: an.ND, N_G: an.NG, N_E: 27 + an.ND,
        twice_area: an.degenerate ? null : an.twiceArea,
        consistent: an.consistent,
        fixability: res.fix ? { k: res.fix.k, smallest_repairs: res.fix.sets.map(function (s) { return s.map(faceNo).sort(function (x, y) { return x - y; }); }) } : null,
        newton_polynomial: an.terms.map(function (t) { return { x: t.x, y: t.y, coefficient: t.coeff }; }),
        cnn: res.prob === null ? null : {
          probability_consistent: res.prob, logit: res.logit, threshold: thr, predicted_consistent: res.prob > thr,
          peak_saliency: res.peak,
          top_diagonal: res.top ? { face: faceNo(res.top.h), edge: edgeRecord(res.top.w, res.top.b), saliency: res.top.S,
                                    normalised_saliency: res.top.Snorm, removal_restores_consistency: res.top.repairs } : null
        },
        quiver: {
          gauge_groups: q.nodes.map(function (n) { return { id: n.id, face: faceNo(n.hex), part: n.half }; }),
          fields: q.arrows.map(function (a) {
            return { name: BT.fieldName(a.from, a.to), from: a.from, to: a.to, edge: edgeRecord(a.white, a.black), diagonal: a.kind === 'diagonal' };
          })
        },
        superpotential: res.W.map(function (t) {
          return { node: t.node, sign: t.sign, fields: t.arrows.map(function (a) { return BT.fieldName(a.from, a.to); }) };
        })
      }
    };
  }
  function saveJSON() {
    var res = app.result;
    if (!res) return;
    var name = 'brane-tiling-' + res.an.index + '.json';
    var blob = new Blob([JSON.stringify(configurationRecord(res), null, 2) + '\n'], { type: 'application/json' });
    var url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = name; link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(function () { URL.revokeObjectURL(url); if (link.parentNode) link.parentNode.removeChild(link); }, 1000);
    setStatus('Saved configuration ' + fmtInt(res.an.index) + ' as ' + name + '.');
  }
  function onJSONFile(ev) {
    var input = ev.target, file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { input.value = ''; setStatus(file.name + ' is too large to be a saved configuration.', true); return; }
    var reader = new FileReader();
    reader.onload = function () {
      input.value = '';                        // so that choosing the same file again reloads it
      var cfg;
      try { cfg = BT.parseConfiguration(JSON.parse(String(reader.result))); }
      catch (e) {
        setStatus('Could not load ' + file.name + ': ' + (e instanceof SyntaxError ? 'it is not valid JSON' : e.message) + '.', true);
        return;
      }
      app.anchor = cfg.view && cfg.view.referenceIndex !== cfg.index
        ? { index: cfg.view.referenceIndex, peak: cfg.view.referencePeak, verify: true } : null;
      setStates(cfg.states, { keepAnchor: true });
      setStatus('Loaded configuration ' + fmtInt(cfg.index) + ' (states ' + cfg.states.join('') + ') from ' + file.name +
                (app.anchor ? ', on the colour scale of configuration ' + fmtInt(app.anchor.index) : '') + '.');
    };
    reader.onerror = function () { input.value = ''; setStatus('Could not read ' + file.name + '.', true); };
    reader.readAsText(file);
  }

  function wire() {
    var buttons = document.querySelectorAll('#preset-bar [data-index]');
    for (var i = 0; i < buttons.length; i++) buttons[i].addEventListener('click', function (ev) { jumpTo(ev.currentTarget.getAttribute('data-index')); });
    $('btn-random').addEventListener('click', function () { jumpTo(Math.floor(Math.random() * BT.NUM_CONFIGS)); });
    $('btn-random-fixable').addEventListener('click', function () { if (app.repairable) jumpTo(randomFrom(app.repairable)); });
    /* No list needed: until (or unless) model/consistent.json arrives, isConsistentIndex
       answers with the exact check, which is slower but gives the same draw. */
    $('btn-random-fixable3').addEventListener('click', function () {
      var idx = randomWithRepairDistance(3);
      if (idx !== null) jumpTo(idx);
    });
    $('btn-random-consistent').addEventListener('click', function () { if (app.consistentList) jumpTo(randomFrom(app.consistentList)); });
    $('btn-save-json').addEventListener('click', saveJSON);
    $('btn-load-json').addEventListener('click', function () { $('file-json').click(); });
    $('file-json').addEventListener('change', onJSONFile);
    $('index-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var v = $('index-input').value.replace(/[,\s]/g, '');
      if (v === '') return;
      if (/^[0-3]{9}$/.test(v)) { resetAnchor(); setStates(v.split('').map(Number)); }
      else if (!jumpTo(v)) { $('index-input').value = ''; $('index-input').placeholder = 'enter 0 – 262143'; return; }
      $('index-input').value = '';
    });
    $('btn-clear').addEventListener('click', function () { setStates([0, 0, 0, 0, 0, 0, 0, 0, 0]); });
    $('btn-undo').addEventListener('click', function () {
      if (!app.history.length) return;
      setStatus('');
      if (app.result && app.result.peak > 0) app.previous = { index: app.result.an.index, peak: app.result.peak };
      app.anchor = null;
      app.states = app.history.pop();
      render();
    });
    $('btn-repair').addEventListener('click', function () {
      var res = app.result;
      if (!res || !res.top) return;
      // the published before/after convention: both maps on the before-map's maximum
      if (res.peak > 0) app.anchor = { peak: res.peak, index: res.an.index };
      setStates(BT.withoutDiagonal(app.states, res.top.h), { keepAnchor: true });
    });
    $('btn-scale').addEventListener('click', function () {
      setStatus('');                           // a message about a loaded file's scale no longer holds
      if (app.anchor) app.anchor = null;
      else if (app.previous) app.anchor = { peak: app.previous.peak, index: app.previous.index };
      render();
    });
    window.addEventListener('hashchange', function () {
      var idx = parseInt(location.hash.replace('#', ''), 10);
      if (!isNaN(idx) && app.result && idx !== app.result.an.index) jumpTo(idx);
    });
  }

  function start() {
    // hero artwork: the base tiling (Fig. 1a of the paper) drawn by the same code.
    // No node labels: they are set in black with a white halo for the white panels, which
    // does not belong on the dark band, and the artwork carries no argument that needs them.
    var hero = $('hero-svg');
    if (hero) drawTiling(hero, [0, 0, 0, 0, 0, 0, 0, 0, 0], null, false, false);
    var idx = parseInt((location.hash || '').replace('#', ''), 10);
    if (!isNaN(idx) && idx >= 0 && idx < BT.NUM_CONFIGS) app.states = BT.decodeIndex(idx);
    wire();
    render();
    loadModel();
    // the labels are placed from measured glyphs, so re-place them once the webfont lands
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { render(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

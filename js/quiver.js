/* quiver.js — where panel (d) puts the nodes and arrows of the quiver.
 *
 * The drawing follows the group's brane tiling design files (OmniGraffle): gauge groups
 * are gold discs carrying their number, chiral fields are straight lines with the
 * arrowhead at mid-length, and a line that passes behind another line, or behind a node
 * it does not end on, is broken there.  No DOM access, so the layout runs in a plain JS
 * shell for testing; js/app.js turns the result into SVG.
 *
 * Layout.  The quiver of the bare hexagonal tiling is the McKay quiver of Z_3 x Z_3: the
 * nine faces fall into three classes by (column - row) mod 3, and every face has one
 * arrow to each face of the next class.  As in the design files, six gauge groups sit on
 * a regular hexagon, here with each class at a pair of opposite vertices, and three on an
 * inner triangle, one per class.  Which face takes which slot, and in which direction a
 * split face pulls apart, were chosen by a search over the whole family for the fewest
 * lines through nodes, overlapping nodes and crossings.
 *
 * A diagonal splits its face into two quadrilaterals, drawn as two nodes either side of
 * the face's home position and joined by the diagonal's chiral field.  The direction of
 * the split has a default per face and diagonal orientation; then, for the tiling at
 * hand, each split pair in turn tries 24 directions and three separations and keeps the
 * one that clears the drawing best, staying with the default when nothing is gained.
 * Deterministic: a tiling always gets the same picture.  Where that still leaves a line
 * through a node, a rescue search restarts from scattered placements (see layout()).
 * Over the whole family no line then passes through a node and no two nodes crowd each
 * other; tools/test_layout_all.js checks all 262,144 tilings.
 */
var QV = (function () {
  'use strict';

  var NODE_R = 15;                               // node disc radius, as in the design files (30 pt discs)
  /* Home position of each gauge group, indexed by hexagon h = 3r + c (not by face number):
     hexagons 8, 1, 3, 4, 5, 2 run clockwise round the outer hexagon from its top vertex,
     which are faces 3, 5, 7, 8, 9, 6, and hexagons 0, 7, 6 (faces 4, 2, 1) form the inner
     triangle. */
  var HOME = [[0, -66.6], [192.25, -111], [-192.25, -111], [192.25, 111], [0, 222],
              [-192.25, 111], [-57.67, 33.3], [57.67, 33.3], [0, -222]];
  /* Default direction, in degrees anticlockwise from the x axis, in which the half above
     the diagonal moves away from home; per hexagon, one entry per orientation 1, 2, 3. */
  var SPLIT_ANGLE = [[105, 60, 105], [30, 30, 270], [210, 330, 150], [225, 225, 270], [90, 195, 90],
                     [270, 150, 285], [45, 45, 60], [105, 345, 165], [210, 165, 345]];
  /* How far each half of a split face sits from home.  The widest separation leaves the
     diagonal's field long enough to read; the narrower ones are fallbacks for crowded
     tilings, and cost a little in the layout score so that they are used only then. */
  var SPLIT_DELTA = 36, DELTAS = [26, 31, 36], ANGLE_STEP = 15;
  /* Fixed for every tiling, so that the drawing does not rescale as faces split. */
  var VIEW = [-252, -282, 504, 564];
  var GAP = 5;                                   // half-width of the break where a line passes behind another
  var HEAD_L = 13, HEAD_W = 11;                  // arrowhead length and width

  // weights of the layout score: lines through or grazing nodes, crowded nodes, crossings
  var W_THROUGH = 400, W_GRAZE = 40, W_CLOSE = 400, W_CROSS = 1, W_HEAD = 10;

  function cross(ax, ay, bx, by, cx, cy) { return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); }
  /* Parameters (t, u) along p1->p2 and p3->p4 where the two segments cross, or null. */
  function crossing(p1, p2, p3, p4) {
    var d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
    if (Math.abs(d) < 1e-9) return null;
    var t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
    var u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
    return (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) ? [t, u] : null;
  }

  /* Score of a placement: positions P (one per node slot) and arrow end slots `ends`. */
  function penalty(P, ends) {
    var n = P.length, m = ends.length, total = 0, i, j, k, l;
    for (k = 0; k < m; k++) {
      var e0 = ends[k][0], e1 = ends[k][1], a = P[e0], b = P[e1];
      var dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      for (i = 0; i < n; i++) {
        if (i === e0 || i === e1) continue;
        var t = ((P[i][0] - a[0]) * dx + (P[i][1] - a[1]) * dy) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        var ex = P[i][0] - a[0] - t * dx, ey = P[i][1] - a[1] - t * dy, d2 = ex * ex + ey * ey;
        if (d2 < (NODE_R + 2.5) * (NODE_R + 2.5)) total += W_THROUGH;
        else if (d2 < (NODE_R + 7) * (NODE_R + 7)) total += W_GRAZE;
        var hx = P[i][0] - mx, hy = P[i][1] - my;
        if (hx * hx + hy * hy < (NODE_R + 9) * (NODE_R + 9)) total += W_HEAD;
      }
    }
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
      var qx = P[i][0] - P[j][0], qy = P[i][1] - P[j][1];
      if (qx * qx + qy * qy < (2 * NODE_R + 10) * (2 * NODE_R + 10)) total += W_CLOSE;
    }
    for (k = 0; k < m; k++) for (l = k + 1; l < m; l++) {
      var a0 = ends[k][0], a1 = ends[k][1], b0 = ends[l][0], b1 = ends[l][1];
      if (a0 === b0 || a0 === b1 || a1 === b0 || a1 === b1) continue;
      var p = P[a0], q = P[a1], r = P[b0], s = P[b1];
      var d1 = cross(r[0], r[1], s[0], s[1], p[0], p[1]), d2b = cross(r[0], r[1], s[0], s[1], q[0], q[1]);
      var d3 = cross(p[0], p[1], q[0], q[1], r[0], r[1]), d4 = cross(p[0], p[1], q[0], q[1], s[0], s[1]);
      if (((d1 > 0) !== (d2b > 0)) && ((d3 > 0) !== (d4 > 0))) total += W_CROSS;
    }
    return total;
  }

  /* Lines passing within NODE_R + 2.5 of the centre of a node they do not end on. */
  function throughCount(P, ends) {
    var count = 0, lim = (NODE_R + 2.5) * (NODE_R + 2.5);
    for (var k = 0; k < ends.length; k++) {
      var a = P[ends[k][0]], b = P[ends[k][1]], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      for (var i = 0; i < P.length; i++) {
        if (i === ends[k][0] || i === ends[k][1]) continue;
        var t = ((P[i][0] - a[0]) * dx + (P[i][1] - a[1]) * dy) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        var ex = P[i][0] - a[0] - t * dx, ey = P[i][1] - a[1] - t * dy;
        if (ex * ex + ey * ey < lim) count++;
      }
    }
    return count;
  }

  /* When moving one pair at a time leaves a line through a node -- nine tilings of the
     262,144 -- the way out needs several pairs moved together, often closer than usual.
     The rescue restarts the search from scattered placements, with a wider range of
     separations, until one ends with no line through a node.  The restarts are seeded by
     the tiling, so the picture is still the same every time. */
  var RESCUE_RESTARTS = 40, RESCUE_DELTAS = [26, 31, 36, 41];

  /* Node positions for quiver `q` (from BT.quiver) of the tiling `states`.
     Returns {pos: {id: [x, y]}, slots: [[x, y] per q.nodes entry], ends, view, score}. */
  function layout(q, states) {
    var n = q.nodes.length, slot = {}, i, h;
    for (i = 0; i < n; i++) slot[q.nodes[i].id] = i;
    var ends = q.arrows.map(function (a) { return [slot[a.from], slot[a.to]]; });
    var splits = [];
    for (h = 0; h < 9; h++) if (states[h]) splits.push(h);
    function place(choice) {
      var P = new Array(n);
      for (var k = 0; k < n; k++) {
        var nd = q.nodes[k], home = HOME[nd.hex];
        if (nd.half === 'whole') { P[k] = [home[0], home[1]]; continue; }
        var c = choice[nd.hex], rad = c.angle * Math.PI / 180, sg = nd.half === 'upper' ? 1 : -1;
        P[k] = [home[0] + sg * c.delta * Math.cos(rad), home[1] - sg * c.delta * Math.sin(rad)];
      }
      return P;
    }
    /* A small charge for leaving the default direction, so that ties keep the familiar
       picture, and for pulling a pair closer than the default separation. */
    function drift(choice) {
      var t = 0;
      for (var k = 0; k < splits.length; k++) {
        var hh = splits[k], d = Math.abs(choice[hh].angle - SPLIT_ANGLE[hh][states[hh] - 1]) % 360;
        t += 0.02 * Math.min(d, 360 - d) + 0.1 * Math.max(0, SPLIT_DELTA - choice[hh].delta);
      }
      return t;
    }
    /* Move one pair at a time to its best direction and separation, until nothing improves. */
    function refine(choice, deltas, passes) {
      var best = penalty(place(choice), ends) + drift(choice);
      for (var pass = 0; pass < passes && splits.length; pass++) {
        var improved = false;
        for (var si = 0; si < splits.length; si++) {
          var hh = splits[si], keep = choice[hh];
          for (var ang = 0; ang < 360; ang += ANGLE_STEP) for (var di = 0; di < deltas.length; di++) {
            choice[hh] = { angle: ang, delta: deltas[di] };
            var v = penalty(place(choice), ends) + drift(choice);
            if (v < best - 1e-9) { best = v; keep = choice[hh]; improved = true; }
          }
          choice[hh] = keep;
        }
        if (!improved) break;
      }
      return best;
    }
    var choice = {};
    for (i = 0; i < splits.length; i++) choice[splits[i]] = { angle: SPLIT_ANGLE[splits[i]][states[splits[i]] - 1], delta: SPLIT_DELTA };
    var best = refine(choice, DELTAS, 2), P = place(choice), through = throughCount(P, ends);
    if (through > 0) {
      var seed = 1;
      for (h = 0; h < 9; h++) seed = seed * 4 + states[h];
      var rnd = function () { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 2147483648; };
      for (var r = 0; r < RESCUE_RESTARTS && through > 0; r++) {
        var trial = {};
        for (i = 0; i < splits.length; i++)
          trial[splits[i]] = { angle: Math.floor(rnd() * 360 / ANGLE_STEP) * ANGLE_STEP, delta: RESCUE_DELTAS[Math.floor(rnd() * RESCUE_DELTAS.length)] };
        var score = refine(trial, RESCUE_DELTAS, 3), Pt = place(trial), th = throughCount(Pt, ends);
        if (th < through || (th === through && score < best)) { choice = trial; best = score; P = Pt; through = th; }
      }
    }
    var pos = {};
    for (i = 0; i < n; i++) pos[q.nodes[i].id] = P[i];
    return { pos: pos, slots: P, ends: ends, view: VIEW.slice(), score: best };
  }

  /* Merge intervals [a, b] and subtract them from [lo, hi]: the visible pieces. */
  function visiblePieces(lo, hi, cuts) {
    cuts = cuts.slice().sort(function (x, y) { return x[0] - y[0]; });
    var out = [], cur = lo;
    for (var i = 0; i < cuts.length; i++) {
      var c = cuts[i];
      if (c[1] <= cur) continue;
      if (c[0] >= hi) break;
      if (c[0] > cur) out.push([cur, Math.min(c[0], hi)]);
      cur = Math.max(cur, c[1]);
      if (cur >= hi) break;
    }
    if (cur < hi) out.push([cur, hi]);
    // a piece between two breaks shorter than two stroke widths would be a speck; a piece
    // that reaches a node is kept however short, so the line still meets its node
    return out.filter(function (pc) { return pc[1] - pc[0] > (pc[0] > lo && pc[1] < hi ? 6 : 1.5); });
  }

  /* What panel (d) draws, from a layout: every arrow's visible pieces and arrowhead, in
     drawing order.  Longer lines go first, so a long line passes behind a short one and
     carries the break, as in the design files; the diagonals' fields come last, on top.
     Pieces are [x1, y1, x2, y2]; a head is {x, y, ux, uy} with (x, y) its centre. */
  function geometry(q, lay) {
    var P = lay.slots, ends = lay.ends, m = q.arrows.length, n = P.length, k, l, i;
    var segs = [];
    for (k = 0; k < m; k++) {
      var a = P[ends[k][0]], b = P[ends[k][1]], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.sqrt(dx * dx + dy * dy);
      segs.push({ k: k, a: a, b: b, ux: dx / L, uy: dy / L, L: L, cuts: [], marks: [] });
    }
    var order = segs.slice().sort(function (s1, s2) {
      var d1 = q.arrows[s1.k].kind === 'diagonal', d2 = q.arrows[s2.k].kind === 'diagonal';
      if (d1 !== d2) return d1 ? 1 : -1;
      // lengths equal up to rounding (mirror-image fields) are a tie, decided by index, so
      // that every engine draws the same picture whatever the last bit of a square root
      var dL = s2.L - s1.L;
      return Math.abs(dL) > 1e-6 ? dL : s1.k - s2.k;
    });
    var rank = new Array(m);
    for (k = 0; k < m; k++) rank[order[k].k] = k;
    for (k = 0; k < m; k++) for (l = k + 1; l < m; l++) {
      var e = ends[k], f = ends[l];
      if (e[0] === f[0] || e[0] === f[1] || e[1] === f[0] || e[1] === f[1]) continue;
      var c = crossing(segs[k].a, segs[k].b, segs[l].a, segs[l].b);
      if (!c) continue;
      /* At a shallow crossing the other line stays close for a long way either side, so
         both the stretch an arrowhead must avoid and the break of the line underneath
         grow as the angle closes: the head keeps (HEAD_W/2 + 1.5) cot(angle) clear, and
         the broken ends of a 3-wide line clear the other line's stroke by 1.5. */
      var sinA = Math.abs(segs[k].ux * segs[l].uy - segs[k].uy * segs[l].ux);
      var cosA = Math.abs(segs[k].ux * segs[l].ux + segs[k].uy * segs[l].uy), sn = Math.max(sinA, 0.05);
      var win = HEAD_L / 2 + 3 + (HEAD_W / 2 + 1.5) * cosA / sn;
      segs[k].marks.push([c[0] * segs[k].L, win]); segs[l].marks.push([c[1] * segs[l].L, win]);
      var under = rank[k] < rank[l] ? k : l, tu = under === k ? c[0] : c[1];
      var gap = Math.min(24, Math.max(GAP, (3 + 1.5 * cosA) / sn));
      segs[under].cuts.push([tu * segs[under].L - gap, tu * segs[under].L + gap]);
    }
    // a line passing close to a node it does not end on is broken around that node
    var halo = NODE_R + 4.5;
    for (k = 0; k < m; k++) {
      var sg = segs[k];
      for (i = 0; i < n; i++) {
        if (i === ends[k][0] || i === ends[k][1]) continue;
        var px = P[i][0] - sg.a[0], py = P[i][1] - sg.a[1];
        var along = px * sg.ux + py * sg.uy, off = Math.abs(px * sg.uy - py * sg.ux);
        if (off >= halo || along < -halo || along > sg.L + halo) continue;
        var half = Math.sqrt(halo * halo - off * off);
        sg.cuts.push([along - half, along + half]);
      }
    }
    var heads = [], headOf = new Array(m), oi, s;
    for (oi = 0; oi < m; oi++) { s = order[oi]; headOf[s.k] = placeHead(s, ends[s.k], P, heads); }
    /* Where an arrowhead could not get clear of another line -- a short field crossed near
       its middle has nowhere else to put it -- that line is broken around the arrowhead, as
       around a node, so the head reads as lying on top.  Lines meeting the head's field at
       a node are left alone.  If the break would fall under the line's own arrowhead, that
       arrowhead moves out of the way instead, and the breaks are worked out again. */
    var halo2 = HEAD_REACH + 1.5 + 1, haloCuts = [];
    for (var round = 0; round < 4; round++) {
      var moved = false;
      haloCuts = [];
      for (k = 0; k < m; k++) {
        var ek = ends[k];
        for (l = 0; l < m; l++) {
          var el = ends[l], hk = headOf[k];
          if (l === k || el[0] === ek[0] || el[0] === ek[1] || el[1] === ek[0] || el[1] === ek[1]) continue;
          var sl = segs[l], qx = hk.x - sl.a[0], qy = hk.y - sl.a[1];
          var at = qx * sl.ux + qy * sl.uy, off2 = Math.abs(qx * sl.uy - qy * sl.ux);
          if (off2 >= halo2 || at < -halo2 || at > sl.L + halo2) continue;
          var hw2 = Math.sqrt(halo2 * halo2 - off2 * off2), cut = [at - hw2, at + hw2], own = headOf[l];
          var ownAt = (own.x - sl.a[0]) * sl.ux + (own.y - sl.a[1]) * sl.uy;
          if (cut[1] > ownAt - HEAD_L / 2 - 1 && cut[0] < ownAt + HEAD_L / 2 + 1) {
            sl.cuts.push(cut);                       // the break stays; the head finds another spot
            heads.splice(heads.indexOf(own), 1);
            headOf[l] = placeHead(sl, el, P, heads);
            moved = true;
          } else haloCuts.push([l, cut]);
        }
      }
      if (!moved) break;
    }
    for (i = 0; i < haloCuts.length; i++) segs[haloCuts[i][0]].cuts.push(haloCuts[i][1]);
    var out = [];
    for (oi = 0; oi < m; oi++) {
      s = order[oi];
      var sa = s, pieces = visiblePieces(NODE_R, s.L - NODE_R, s.cuts).map(function (pc) {
        return [sa.a[0] + sa.ux * pc[0], sa.a[1] + sa.uy * pc[0], sa.a[0] + sa.ux * pc[1], sa.a[1] + sa.uy * pc[1]];
      });
      out.push({ arrow: q.arrows[s.k], index: s.k, pieces: pieces, head: headOf[s.k] });
    }
    return out;
  }

  /* The arrowhead goes at mid-length unless that spot is broken, sits on or near a
     crossing, or crowds a node or another arrowhead; then the nearest clear spot along the
     line, first on a coarse grid and then, if every grid point has a conflict, unit by
     unit.  Stacking two heads is the worst conflict, then a break, a node, a crossing. */
  var HEAD_REACH = Math.sqrt(HEAD_L * HEAD_L / 4 + HEAD_W * HEAD_W / 4);   // centre to back corner
  function placeHead(s, end, P, heads) {
    var lo = NODE_R + HEAD_L / 2 + 2, hi = s.L - NODE_R - HEAD_L / 2 - 2, mid = s.L / 2;
    var nodeClear = NODE_R + 1.5 + HEAD_REACH + 1;                         // clear of a node's outline
    function conflicts(c) {
      var bad = 0, i;
      for (i = 0; i < s.cuts.length; i++) if (c + HEAD_L / 2 + 2 > s.cuts[i][0] && c - HEAD_L / 2 - 2 < s.cuts[i][1]) bad += 4;
      for (i = 0; i < s.marks.length; i++) if (Math.abs(c - s.marks[i][0]) < s.marks[i][1]) bad += 2;
      var x = s.a[0] + s.ux * c, y = s.a[1] + s.uy * c;
      for (i = 0; i < P.length; i++) {
        if (i === end[0] || i === end[1]) continue;
        var dx = P[i][0] - x, dy = P[i][1] - y;
        if (dx * dx + dy * dy < nodeClear * nodeClear) bad += 3;
      }
      for (i = 0; i < heads.length; i++) {
        var hx = heads[i].x - x, hy = heads[i].y - y;
        if (hx * hx + hy * hy < 15 * 15) bad += 8;
      }
      return bad;
    }
    var best = null, step = Math.max(4, 0.07 * (s.L - 2 * NODE_R)), j, c, bad;
    for (j = 0; j < 9; j++) {
      c = mid + (j % 2 ? 1 : -1) * Math.ceil(j / 2) * step;
      if (j && (c < lo || c > hi)) continue;
      bad = conflicts(c);
      if (!best || bad < best.bad) best = { bad: bad, c: c };
      if (!bad) break;
    }
    for (j = 1; best.bad && j <= s.L; j++) {
      var tried = false;
      for (var sgn = -1; sgn <= 1; sgn += 2) {
        c = mid + sgn * j;
        if (c < lo || c > hi) continue;
        tried = true;
        bad = conflicts(c);
        if (bad < best.bad) best = { bad: bad, c: c };
        if (!bad) break;
      }
      if (!tried) break;
    }
    // a line too short for a full-size head (a crowded split pair) gets a smaller one
    var visible = s.L - 2 * NODE_R;
    var head = { x: s.a[0] + s.ux * best.c, y: s.a[1] + s.uy * best.c, ux: s.ux, uy: s.uy,
                 scale: visible >= 34 ? 1 : Math.max(0.7, visible / 34) };
    heads.push(head);
    return head;
  }

  /* Outline of an arrowhead centred at (x, y) pointing along (ux, uy): a filled
     triangle with a shallow notch at the back, like the design files' stick arrows. */
  function headPath(h) {
    var sc = h.scale || 1, hl = HEAD_L * sc, hw = HEAD_W * sc;
    var tipx = h.x + h.ux * hl / 2, tipy = h.y + h.uy * hl / 2;
    var bx = h.x - h.ux * hl / 2, by = h.y - h.uy * hl / 2;
    var nx = -h.uy * hw / 2, ny = h.ux * hw / 2;
    var notchx = bx + h.ux * 3 * sc, notchy = by + h.uy * 3 * sc;
    function f(v) { return v.toFixed(2); }
    return 'M' + f(tipx) + ',' + f(tipy) + 'L' + f(bx + nx) + ',' + f(by + ny) + 'L' + f(notchx) + ',' + f(notchy) +
           'L' + f(bx - nx) + ',' + f(by - ny) + 'Z';
  }

  return { NODE_R: NODE_R, HOME: HOME, SPLIT_ANGLE: SPLIT_ANGLE, VIEW: VIEW, HEAD_L: HEAD_L, HEAD_W: HEAD_W,
           layout: layout, geometry: geometry, headPath: headPath, penalty: penalty, crossing: crossing,
           throughCount: throughCount };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = QV;

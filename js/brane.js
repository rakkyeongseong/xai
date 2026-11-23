/* brane.js — hexagonal brane tilings on T^2 for the C^3/(Z_3 x Z_3) family.
 *
 * Pure JavaScript port of the geometry, the Kasteleyn tensor, det K, and the
 * four toric consistency conditions used in the paper's pipeline
 * (brane/tiling.py, brane/kasteleyn.py, brane/toric.py), plus the quiver and
 * superpotential of a tiling, the exact repair distance, and the reader for
 * saved configurations.  No DOM access, so the same file runs in the browser
 * and in a plain JS shell for testing.
 *
 * Conventions (identical to the Python code):
 *   hexagon h = r*3 + c carries a state in {0,1,2,3}
 *     0 : no diagonal
 *     1 : w(r,c)     -- b(r+1,c-1)
 *     2 : w(r+1,c-1) -- b(r,c)
 *     3 : w(r,c-1)   -- b(r+1,c)
 *   a configuration is the base-4 integer with digits state[0..8] (row-major).
 *   node index u = r*3 + c (0-based); labels w_{u+1}, b_{v+1}.
 *   tensor cell = channel*81 + white*9 + black, channel = (dx+1)*3 + (dy+1).
 */
var BT = (function () {
  'use strict';

  var N = 3, NH = 9, NN = 9, NC = 9, SS = 81, NCELLS = 729;
  var SQ3 = Math.sqrt(3);
  var DIAG_OFFSETS = { 1: [[0, 0], [1, -1]], 2: [[1, -1], [0, 0]], 3: [[0, -1], [1, 0]] };

  function mod(a, n) { return ((a % n) + n) % n; }
  function nodeIndex(r, c) { return mod(r, N) * N + mod(c, N); }
  function channelIndex(dx, dy) { return (dx + 1) * 3 + (dy + 1); }
  function channelOffsets(k) { return [Math.floor(k / 3) - 1, (k % 3) - 1]; }
  function cellIndex(k, w, b) { return k * SS + w * NN + b; }
  function cellOf(i) { return [Math.floor(i / SS), Math.floor((i % SS) / NN), i % NN]; }

  // ---------------------------------------------------------------- index --
  function decodeIndex(index) {
    var s = new Array(NH);
    for (var h = NH - 1; h >= 0; h--) { s[h] = index % 4; index = Math.floor(index / 4); }
    return s;
  }
  function encodeStates(states) {
    var i = 0;
    for (var h = 0; h < NH; h++) i = i * 4 + (states[h] | 0);
    return i;
  }
  function numDiagonals(states) {
    var n = 0;
    for (var h = 0; h < NH; h++) if (states[h]) n++;
    return n;
  }

  // ---------------------------------------------------------------- graph --
  function makeEdge(sr, sc, tr, tc, kind, hex) {
    return {
      white: nodeIndex(sr, sc), black: nodeIndex(tr, tc),
      dx: Math.floor(tc / N) - Math.floor(sc / N),
      dy: Math.floor(tr / N) - Math.floor(sr / N),
      kind: kind, hex: hex
    };
  }
  function diagonalEndpoints(r, c, state) {
    if (!state) return null;
    var o = DIAG_OFFSETS[state];
    return [[r + o[0][0], c + o[0][1]], [r + o[1][0], c + o[1][1]]];
  }
  /* The 27 base edges followed by one edge per diagonal (same order as Python). */
  function edges(states) {
    var out = [], r, c;
    for (r = 0; r < N; r++) for (c = 0; c < N; c++) {
      out.push(makeEdge(r, c, r, c, 'base', [r, c]));
      out.push(makeEdge(r, c, r + 1, c, 'base', [r, c]));
      out.push(makeEdge(r, c, r, c + 1, 'base', [r, c]));
    }
    for (r = 0; r < N; r++) for (c = 0; c < N; c++) {
      var ep = diagonalEndpoints(r, c, states[r * N + c]);
      if (ep) out.push(makeEdge(ep[0][0], ep[0][1], ep[1][0], ep[1][1], 'diagonal', [r, c]));
    }
    return out;
  }
  /* Periodic copies of every edge over the cells lo <= r,c < hi (absolute coordinates). */
  function planeEdges(states, lo, hi) {
    var out = [];
    for (var r = lo; r < hi; r++) for (var c = lo; c < hi; c++) {
      out.push({ kind: 'base', w: [r, c], b: [r, c], hex: [r, c] });
      out.push({ kind: 'base', w: [r, c], b: [r + 1, c], hex: [r, c] });
      out.push({ kind: 'base', w: [r, c], b: [r, c + 1], hex: [r, c] });
      var s = states[nodeIndex(r, c)];
      var ep = diagonalEndpoints(r, c, s);
      if (ep) out.push({ kind: 'diagonal', w: ep[0], b: ep[1], hex: [r, c], state: s });
    }
    return out;
  }

  // --------------------------------------------------------------- tensor --
  /* Signed Kasteleyn tensor: +1 per base edge, -1 per diagonal (physical checker). */
  function signedTensor(states) {
    var T = new Int8Array(NCELLS);
    var es = edges(states);
    for (var i = 0; i < es.length; i++) {
      var e = es[i];
      T[cellIndex(channelIndex(e.dx, e.dy), e.white, e.black)] += (e.kind === 'diagonal' ? -1 : 1);
    }
    return T;
  }
  /* Unsigned CNN input: |signed tensor|, every present edge is +1 (manuscript encoding). */
  function unsignedTensor(states) {
    var T = signedTensor(states), U = new Float64Array(NCELLS);
    for (var i = 0; i < NCELLS; i++) U[i] = Math.abs(T[i]);
    return U;
  }
  /* DIAG_CELLS[h][s] = {k, w, b, cell} for hexagon h and state s in 1..3. */
  var DIAG_CELLS = (function () {
    var t = [];
    for (var h = 0; h < NH; h++) {
      t.push([null, null, null, null]);
      for (var s = 1; s <= 3; s++) {
        var st = [0, 0, 0, 0, 0, 0, 0, 0, 0]; st[h] = s;
        var es = edges(st), e = null;
        for (var i = 0; i < es.length; i++) if (es[i].kind === 'diagonal') { e = es[i]; break; }
        var k = channelIndex(e.dx, e.dy);
        t[h][s] = { k: k, w: e.white, b: e.black, cell: cellIndex(k, e.white, e.black), dx: e.dx, dy: e.dy };
      }
    }
    return t;
  })();
  /* cell -> {h, s} for every possible diagonal cell. */
  var CELL_TO_DIAG = (function () {
    var m = {};
    for (var h = 0; h < NH; h++) for (var s = 1; s <= 3; s++) m[DIAG_CELLS[h][s].cell] = { h: h, s: s };
    return m;
  })();

  // ----------------------------------------------------------- det K(x,y) --
  var M = 2 * N + 1, HALF = N;
  var COS = [], SIN = [];                       // omega^e = exp(-2 pi i e / M)
  for (var e = 0; e < M; e++) { COS.push(Math.cos(2 * Math.PI * e / M)); SIN.push(-Math.sin(2 * Math.PI * e / M)); }

  /* Determinant of an n x n complex matrix (re, im, row-major) by LU with partial pivoting. */
  function complexDet(re, im, n) {
    var dre = 1, dim = 0, col, r, k;
    for (col = 0; col < n; col++) {
      var piv = col, best = re[col * n + col] * re[col * n + col] + im[col * n + col] * im[col * n + col];
      for (r = col + 1; r < n; r++) {
        var m2 = re[r * n + col] * re[r * n + col] + im[r * n + col] * im[r * n + col];
        if (m2 > best) { best = m2; piv = r; }
      }
      if (best === 0) return [0, 0];
      if (piv !== col) {
        for (k = 0; k < n; k++) {
          var t1 = re[col * n + k]; re[col * n + k] = re[piv * n + k]; re[piv * n + k] = t1;
          var t2 = im[col * n + k]; im[col * n + k] = im[piv * n + k]; im[piv * n + k] = t2;
        }
        dre = -dre; dim = -dim;
      }
      var pr = re[col * n + col], pi = im[col * n + col];
      var nr = dre * pr - dim * pi, ni = dre * pi + dim * pr; dre = nr; dim = ni;
      var inv = 1 / (pr * pr + pi * pi), ipr = pr * inv, ipi = -pi * inv;
      for (r = col + 1; r < n; r++) {
        var ar = re[r * n + col], ai = im[r * n + col];
        if (ar === 0 && ai === 0) continue;
        var fr = ar * ipr - ai * ipi, fi = ar * ipi + ai * ipr;
        for (k = col; k < n; k++) {
          var br = re[col * n + k], bi = im[col * n + k];
          re[r * n + k] -= fr * br - fi * bi;
          im[r * n + k] -= fr * bi + fi * br;
        }
      }
    }
    return [dre, dim];
  }

  /* Permanent of an n x n complex matrix by Ryser's formula,
       perm(A) = (-1)^n * sum over subsets S of (-1)^|S| * prod_i sum_{j in S} a_ij,
     walked in Gray-code order so consecutive subsets differ in one column and the row
     sums are updated rather than rebuilt.  n = 9 here, so 512 subsets.  Unlike the
     determinant the permanent has no LU shortcut, which is why this is the slow one. */
  function complexPermanent(re, im, n) {
    var rowRe = new Float64Array(n), rowIm = new Float64Array(n);
    var totalRe = 0, totalIm = 0, gray = 0, parity = 0;
    var subsets = 1 << n, k, i;
    for (k = 1; k < subsets; k++) {
      // the column entering or leaving: the position of the lowest set bit of k
      var j = 0, t = k;
      while ((t & 1) === 0) { t >>= 1; j++; }
      var mask = 1 << j, entering = (gray & mask) === 0;
      gray ^= mask;
      parity ^= 1;
      for (i = 0; i < n; i++) {
        if (entering) { rowRe[i] += re[i * n + j]; rowIm[i] += im[i * n + j]; }
        else { rowRe[i] -= re[i * n + j]; rowIm[i] -= im[i * n + j]; }
      }
      var pr = 1, pi = 0;
      for (i = 0; i < n; i++) {
        var ar = rowRe[i], ai = rowIm[i];
        var nr = pr * ar - pi * ai;
        pi = pr * ai + pi * ar;
        pr = nr;
      }
      if (parity) { totalRe -= pr; totalIm -= pi; } else { totalRe += pr; totalIm += pi; }
    }
    if (n & 1) { totalRe = -totalRe; totalIm = -totalIm; }
    return [totalRe, totalIm];
  }

  /* Evaluate the Kasteleyn matrix on the M x M grid of roots of unity, reduce each
     sample with `reduce` (the permanent or the determinant), then invert the 2-D DFT to
     recover the Laurent coefficients.  Exact after rounding; `residual` reports how far
     the recovered coefficients sat from integers, so numerical trouble is visible
     rather than silently rounded away. */
  function gridCoefficients(T, reduce) {
    var Dre = new Float64Array(M * M), Dim = new Float64Array(M * M);
    var re = new Float64Array(SS), im = new Float64Array(SS);
    var cells = [], i, a, b;
    for (i = 0; i < NCELLS; i++) if (T[i]) cells.push([i, Math.floor(i / SS), i % SS]);
    for (a = 0; a < M; a++) for (b = 0; b < M; b++) {
      re.fill(0); im.fill(0);
      for (i = 0; i < cells.length; i++) {
        var cIdx = cells[i][0], k = cells[i][1], uv = cells[i][2];
        var dx = Math.floor(k / 3) - 1, dy = (k % 3) - 1;
        var ph = mod(a * dx + b * dy, M);
        re[uv] += T[cIdx] * COS[ph]; im[uv] += T[cIdx] * SIN[ph];
      }
      var v = reduce(re, im, NN);
      Dre[a * M + b] = v[0]; Dim[a * M + b] = v[1];
    }
    var terms = [], residual = 0, p, q;
    for (p = -HALF; p <= HALF; p++) for (q = -HALF; q <= HALF; q++) {
      var cr = 0, ci = 0;
      for (a = 0; a < M; a++) for (b = 0; b < M; b++) {
        var ph2 = mod(a * p + b * q, M);
        var wr = COS[ph2], wi = -SIN[ph2];               // exp(+2 pi i ph / M)
        var dr = Dre[a * M + b], di = Dim[a * M + b];
        cr += dr * wr - di * wi; ci += dr * wi + di * wr;
      }
      cr /= M * M; ci /= M * M;
      var rounded = Math.round(cr);
      residual = Math.max(residual, Math.abs(cr - rounded), Math.abs(ci));
      if (rounded !== 0) terms.push({ x: p, y: q, coeff: rounded });
    }
    return { terms: terms, residual: residual };
  }

  /* The Newton polynomial P(x, y) = perm K(x, y).  Taken with unit edge weights, so
     every coefficient counts the perfect matchings carrying that monomial and is a
     non-negative integer: exactly the multiplicities the toric diagram is labelled
     with.  This is the object the paper defines the toric diagram from. */
  function permanentTerms(T) { return gridCoefficients(T, complexPermanent); }

  /* det K(x, y) with the Kasteleyn signs.  A correct Kasteleyn orientation makes the
     magnitudes of its coefficients equal those of the permanent, so this is kept as the
     fast cross-check: an LU costs far less than 512 Ryser subsets. */
  function determinantTerms(T) { return gridCoefficients(T, complexDet); }

  // -------------------------------------------------------- toric diagram --
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = a % b; a = b; b = t; } return a; }
  function binom(n, k) { var r = 1; for (var i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r); }
  function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }

  /* Strict convex hull (no collinear boundary points), counter-clockwise. */
  function convexHull(points) {
    var pts = points.slice().sort(function (p, q) { return p[0] - q[0] || p[1] - q[1]; });
    if (pts.length < 3) return pts;
    var lower = [], upper = [], i;
    for (i = 0; i < pts.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) lower.pop();
      lower.push(pts[i]);
    }
    for (i = pts.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
      upper.push(pts[i]);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  /* The four conditions of brane.toric.analyse_toric_diagram. */
  function toricConditions(terms, NG) {
    var mult = {}, points = [], i;
    for (i = 0; i < terms.length; i++) {
      if (terms[i].coeff === 0) continue;
      var key = terms[i].x + ',' + terms[i].y;
      mult[key] = Math.abs(terms[i].coeff);
      points.push([terms[i].x, terms[i].y]);
    }
    var base = { NG: NG, twiceArea: 0, area: false, corners: false, interior: false, edges: false,
                 consistent: false, degenerate: true, points: points, mult: mult, hull: [],
                 badCorners: [], missingInterior: [], badEdgePoints: [], cornerSet: {}, boundarySet: {}, interiorSet: {} };
    if (points.length < 3) return base;
    var hull = convexHull(points);
    if (hull.length < 3) return base;
    var twice = 0;
    for (i = 0; i < hull.length; i++) {
      var p1 = hull[i], p2 = hull[(i + 1) % hull.length];
      twice += p1[0] * p2[1] - p2[0] * p1[1];
    }
    twice = Math.abs(twice);
    if (twice === 0) return base;

    var cornerSet = {}, badCorners = [];
    for (i = 0; i < hull.length; i++) {
      var ck = hull[i][0] + ',' + hull[i][1];
      cornerSet[ck] = true;
      var m = mult[ck] || 0;
      if (m !== 1) badCorners.push({ x: hull[i][0], y: hull[i][1], mult: m });
    }
    // boundary lattice points and the binomial-edge condition
    var boundarySet = {}, badEdgePoints = [];
    for (i = 0; i < hull.length; i++) {
      var a = hull[i], b = hull[(i + 1) % hull.length];
      var dx = b[0] - a[0], dy = b[1] - a[1], len = gcd(dx, dy);
      if (len === 0) continue;
      var sx = dx / len, sy = dy / len;
      for (var j = 0; j <= len; j++) {
        var px = a[0] + j * sx, py = a[1] + j * sy, pk = px + ',' + py;
        boundarySet[pk] = true;
        var want = binom(len, j), got = mult[pk] || 0;
        if (got !== want) badEdgePoints.push({ x: px, y: py, got: got, want: want });
      }
    }
    // interior lattice points (strictly inside the CCW hull)
    var minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (i = 0; i < hull.length; i++) {
      minx = Math.min(minx, hull[i][0]); maxx = Math.max(maxx, hull[i][0]);
      miny = Math.min(miny, hull[i][1]); maxy = Math.max(maxy, hull[i][1]);
    }
    var interiorSet = {}, missing = [];
    for (var x = minx; x <= maxx; x++) for (var y = miny; y <= maxy; y++) {
      var inside = true;
      for (i = 0; i < hull.length && inside; i++) {
        if (cross(hull[i], hull[(i + 1) % hull.length], [x, y]) <= 0) inside = false;
      }
      if (!inside) continue;
      var ik = x + ',' + y;
      interiorSet[ik] = true;
      if (!mult[ik]) missing.push({ x: x, y: y });
    }
    var res = base;
    res.degenerate = false;
    res.hull = hull; res.twiceArea = twice;
    res.area = (twice === NG);
    /* The paper's criterion for geometric consistency is 2A = N_G: twice the area of
       the toric diagram equals the number of gauge groups.  It is stated there as the
       condition equivalent to the existence of an isoradial embedding and to properly
       ordered, non-self-intersecting zig-zag paths, and it is what decides the verdict
       here. */
    res.consistent = res.area;
    /* Three further statements about the Newton polygon that the companion code also
       checks.  They are not part of the paper's criterion; over the whole 3x3 family
       they accept exactly the same 1,387 tilings the area condition does, so they are
       carried as diagnostics rather than as part of the verdict. */
    res.corners = badCorners.length === 0;
    res.interior = missing.length === 0;
    res.edges = badEdgePoints.length === 0;
    res.badCorners = badCorners; res.missingInterior = missing; res.badEdgePoints = badEdgePoints;
    res.cornerSet = cornerSet; res.boundarySet = boundarySet; res.interiorSet = interiorSet;
    return res;
  }

  /* Everything the page needs about one configuration.  `backend` picks how the Newton
     polynomial is obtained: the permanent, which is what the paper defines it as, or the
     signed determinant, which gives the same multiplicities far more cheaply and is what
     the exhaustive cross-check uses. */
  function analyse(states, backend) {
    var T = signedTensor(states);
    var poly = backend === 'determinant'
      ? determinantTerms(T)
      : permanentTerms(unsignedTensor(states));
    var ND = numDiagonals(states), NG = NH + ND;
    var toric = toricConditions(poly.terms, NG);
    toric.index = encodeStates(states);
    toric.states = states.slice();
    toric.ND = ND;
    toric.terms = poly.terms;
    toric.residual = poly.residual;
    toric.deficit = NG - toric.twiceArea;
    toric.signedTensor = T;
    return toric;
  }

  /* Remove the diagonal in hexagon h: returns the new state array. */
  function withoutDiagonal(states, h) { var s = states.slice(); s[h] = 0; return s; }

  // ------------------------------------------------------- repair distance --
  var POW4 = [];
  for (var p4 = 0; p4 < NH; p4++) POW4.push(Math.pow(4, NH - 1 - p4));

  /* The fewest diagonal deletions that make the tiling consistent, and every set of that
     size that does it.  `isConsistent(index)` answers for any configuration index: a
     lookup in the list of the 1,387 consistent tilings, or the exact check itself.
     Deleting diagonals only clears base-4 digits, so each candidate is pure index
     arithmetic.  k = 0 for a consistent tiling, and the paper's 1-edge-fixable tilings
     are exactly those with k = 1; every tiling has k <= N_D, since deleting all of its
     diagonals returns the consistent base tiling.  Sets are lists of hexagon indices. */
  function repairDistance(states, isConsistent) {
    var support = [], index = encodeStates(states), h, j;
    for (h = 0; h < NH; h++) if (states[h]) support.push(h);
    var n = support.length, bySize = [], mask;
    for (j = 0; j <= n; j++) bySize.push([]);
    for (mask = 0; mask < (1 << n); mask++) {
      var bits = 0;
      for (j = 0; j < n; j++) if (mask & (1 << j)) bits++;
      bySize[bits].push(mask);
    }
    for (var size = 0; size <= n; size++) {
      var sets = [];
      for (var t = 0; t < bySize[size].length; t++) {
        var idx = index, faces = [];
        for (j = 0; j < n; j++) if (bySize[size][t] & (1 << j)) { h = support[j]; idx -= states[h] * POW4[h]; faces.push(h); }
        if (isConsistent(idx)) sets.push(faces);
      }
      if (sets.length) return { k: size, sets: sets };
    }
    return null;   // only when the predicate rejects even the base tiling
  }

  // --------------------------------------------------------------- quiver --
  /* Hexagon (r, c) has its vertices, counter-clockwise from the east,
       w(r,c) E, b(r+1,c) NE, w(r+1,c-1) NW, b(r+1,c-1) W, w(r,c-1) SW, b(r,c) SE,
     as offsets from (r, c); boundary edge i joins vertex i to vertex i+1.  Walking the
     boundary counter-clockwise keeps the hexagon on the left, so it lies on the left of
     white -> black for even i (the walk runs white to black) and on the right for odd i. */
  var HEX_VERTS = [[0, 0], [1, 0], [1, -1], [1, -1], [0, -1], [0, 0]];
  /* A diagonal splits its hexagon into two quadrilaterals.  The one above the diagonal
     keeps the face number; these are its three boundary edges. */
  var UPPER_EDGES = { 1: [0, 1, 2], 2: [5, 0, 1], 3: [1, 2, 3] };
  /* Whether the half above the diagonal lies on the left of the diagonal's white -> black
     direction: E -> W puts it on the right, NW -> SE and SW -> NE on the left. */
  var UPPER_ON_LEFT = { 1: false, 2: true, 3: true };

  /* Face numbers are those of the paper's Fig. 1(a): face i is the hexagon with b_i at its
     upper-right (NE) vertex, b(r+1, c) for hexagon (r, c).  Hexagons, and with them the
     digits of a configuration, run row by row, so hexagon h = 3r + c is face
     FACE_OF_HEX[h] and the nine digits belong to faces 4, 5, 6, 7, 8, 9, 1, 2, 3. */
  var FACE_OF_HEX = [], HEX_OF_FACE = [];
  for (var fh = 0; fh < NH; fh++) {
    FACE_OF_HEX[fh] = nodeIndex(Math.floor(fh / N) + 1, fh % N) + 1;
    HEX_OF_FACE[FACE_OF_HEX[fh]] = fh;
  }

  /* The quiver of the tiling: a node per face (gauge group U(N)_i) and an arrow per edge
     (bifundamental chiral field X_ij).  Each arrow runs from the face on the left of its
     edge, read from the white node to the black one, to the face on the right -- clockwise
     around white nodes and counter-clockwise around black ones, the brane tiling
     convention.  A gauge group carries its face's number; a diagonal splits the face into
     the half above the diagonal, which keeps the number, and the half below, which becomes
     gauge group 10, 11, ... in the order of the face numbers, so N_G = 9 + N_D.  Nodes come
     in order of their numbers; arrows in the order of edges(): the 27 base edges, then one
     per diagonal.  Every edge sits on its own node pair (w_u, b_v) in this family, so
     (u, v) names it. */
  function quiver(states) {
    var nodes = [], upper = [], lower = [], extra = 0, h, i, f;
    for (f = 1; f <= NH; f++) {
      h = HEX_OF_FACE[f];
      upper[h] = f;
      nodes.push({ id: f, hex: h, half: states[h] ? 'upper' : 'whole' });
    }
    for (f = 1; f <= NH; f++) {
      h = HEX_OF_FACE[f];
      if (!states[h]) continue;
      lower[h] = NH + (++extra);
      nodes.push({ id: lower[h], hex: h, half: 'lower' });
    }
    var side = {};                                   // u*9 + v -> {left, right}
    for (h = 0; h < NH; h++) {
      var r = Math.floor(h / N), c = h % N, s = states[h];
      for (i = 0; i < 6; i++) {
        var a = HEX_VERTS[i], b = HEX_VERTS[(i + 1) % 6];
        var wv = (i % 2 === 0) ? a : b, bv = (i % 2 === 0) ? b : a;
        var key = nodeIndex(r + wv[0], c + wv[1]) * NN + nodeIndex(r + bv[0], c + bv[1]);
        var face = (s && UPPER_EDGES[s].indexOf(i) < 0) ? lower[h] : upper[h];
        if (!side[key]) side[key] = {};
        side[key][i % 2 === 0 ? 'left' : 'right'] = face;
      }
      if (s) {
        var d = DIAG_CELLS[h][s];
        side[d.w * NN + d.b] = UPPER_ON_LEFT[s] ? { left: upper[h], right: lower[h] } : { left: lower[h], right: upper[h] };
      }
    }
    var es = edges(states), arrows = [];
    for (i = 0; i < es.length; i++) {
      var e = es[i], sd = side[e.white * NN + e.black];
      arrows.push({ from: sd.left, to: sd.right, white: e.white, black: e.black, kind: e.kind,
                    hex: e.kind === 'diagonal' ? nodeIndex(e.hex[0], e.hex[1]) : -1,
                    cell: cellIndex(channelIndex(e.dx, e.dy), e.white, e.black) });
    }
    return { nodes: nodes, arrows: arrows };
  }

  /* "X_{1,2}"-style name of the chiral field from gauge group i to j; the comma is only
     needed once a label has two digits. */
  function fieldName(from, to) { return 'X' + (from > 9 || to > 9 ? from + ',' + to : '' + from + to); }

  /* The superpotential: one term per node of the tiling, the product of the fields on its
     edges in cyclic order -- clockwise around a white node, with a plus sign, and
     counter-clockwise around a black node, with a minus sign.  Each term is then a closed
     loop of arrows in the quiver, and every field appears once with each sign (the toric
     condition).  Terms start at their lowest-numbered gauge group; white nodes come first. */
  function superpotential(states, q) {
    q = q || quiver(states);
    var byPair = {}, around = {}, i;
    for (i = 0; i < q.arrows.length; i++) byPair[q.arrows[i].white * NN + q.arrows[i].black] = q.arrows[i];
    // every edge at a node of the fundamental cell, with its direction in the plane drawing
    var pe = planeEdges(states, -1, N + 1);
    for (i = 0; i < pe.length; i++) {
      var e = pe[i], wp = whitePos(e.w[0], e.w[1]), bp = blackPos(e.b[0], e.b[1]);
      var arrow = byPair[nodeIndex(e.w[0], e.w[1]) * NN + nodeIndex(e.b[0], e.b[1])];
      if (e.w[0] >= 0 && e.w[0] < N && e.w[1] >= 0 && e.w[1] < N)
        (around['w' + nodeIndex(e.w[0], e.w[1])] = around['w' + nodeIndex(e.w[0], e.w[1])] || [])
          .push({ arrow: arrow, angle: Math.atan2(bp[1] - wp[1], bp[0] - wp[0]) });
      if (e.b[0] >= 0 && e.b[0] < N && e.b[1] >= 0 && e.b[1] < N)
        (around['b' + nodeIndex(e.b[0], e.b[1])] = around['b' + nodeIndex(e.b[0], e.b[1])] || [])
          .push({ arrow: arrow, angle: Math.atan2(wp[1] - bp[1], wp[0] - bp[0]) });
    }
    function term(kind, n) {
      var list = around[kind + n].slice().sort(function (x, y) { return kind === 'w' ? y.angle - x.angle : x.angle - y.angle; });
      var start = 0;
      for (var j = 1; j < list.length; j++) if (list[j].arrow.from < list[start].arrow.from) start = j;
      var arrows = [];
      for (j = 0; j < list.length; j++) arrows.push(list[(start + j) % list.length].arrow);
      return { sign: kind === 'w' ? 1 : -1, node: kind + (n + 1), arrows: arrows };
    }
    var terms = [];
    for (i = 0; i < NN; i++) terms.push(term('w', i));
    for (i = 0; i < NN; i++) terms.push(term('b', i));
    return terms;
  }

  // ------------------------------------------------------ saved configurations --
  /* Read a configuration from parsed JSON: the page's own save format
     {configuration: {index, states, digits}, view: {...}}, or simply {states}, {digits} or
     {index}, a list of nine digits, a nine-digit string, or an index.  Returns
     {states, index, view}, where view is {referenceIndex, referencePeak} when the file
     holds the map on another configuration's colour scale, else null.  Throws an Error
     with a readable message when nothing usable is found or the fields disagree. */
  function parseConfiguration(data) {
    var src = data, states = null, index = null, digits = null;
    function bad(msg) { throw new Error(msg); }
    function readStates(v) {
      if (typeof v === 'string') v = v.replace(/[\s,]/g, '').split('');
      if (!Array.isArray(v) || v.length !== NH) bad('the states must be nine digits, one per face');
      var out = [];
      for (var k = 0; k < NH; k++) {
        var x = typeof v[k] === 'string' && /^[0-3]$/.test(v[k]) ? Number(v[k]) : v[k];
        if (x !== 0 && x !== 1 && x !== 2 && x !== 3) bad('every state must be 0, 1, 2 or 3 (face ' + (k + 1) + ' has ' + JSON.stringify(v[k]) + ')');
        out.push(x);
      }
      return out;
    }
    function readIndex(v) {
      var x = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
      if (typeof x !== 'number' || !isFinite(x) || Math.floor(x) !== x || x < 0 || x >= Math.pow(4, NH))
        bad('the index must be a whole number from 0 to ' + (Math.pow(4, NH) - 1));
      return x;
    }
    if (src === null || src === undefined) bad('the file is empty');
    if (Array.isArray(src)) states = readStates(src);
    else if (typeof src === 'string') {
      if (/^\s*[0-3]{9}\s*$/.test(src)) states = readStates(src.trim()); else index = readIndex(src);
    } else if (typeof src === 'number') index = readIndex(src);
    else if (typeof src === 'object') {
      var cfg = (src.configuration && typeof src.configuration === 'object') ? src.configuration : src;
      if (cfg.states !== undefined) states = readStates(cfg.states);
      if (cfg.digits !== undefined) { digits = readStates(String(cfg.digits)); }
      if (cfg.index !== undefined) index = readIndex(cfg.index);
    } else bad('unrecognised content');
    if (states && digits && states.join('') !== digits.join('')) bad('the states ' + states.join('') + ' and the digits ' + digits.join('') + ' disagree');
    if (!states && digits) states = digits;
    if (!states && index === null) bad('no configuration found: expected "states" (nine digits 0-3) or "index"');
    if (states && index !== null && encodeStates(states) !== index)
      bad('the index ' + index + ' does not match the states ' + states.join('') + ' (which encode ' + encodeStates(states) + ')');
    if (!states) states = decodeIndex(index);
    var view = null, cs = src && typeof src === 'object' && !Array.isArray(src) && src.view && src.view.colour_scale;
    if (cs && cs.mode === 'shared') {
      var ri = cs.reference_index, rp = cs.reference_peak;
      if (typeof ri === 'number' && Math.floor(ri) === ri && ri >= 0 && ri < Math.pow(4, NH) && typeof rp === 'number' && isFinite(rp) && rp > 0)
        view = { referenceIndex: ri, referencePeak: rp };
    }
    return { states: states, index: encodeStates(states), view: view };
  }

  // ------------------------------------------------------- plane geometry --
  /* Embedding used by the manuscript figures: rows run vertically, columns
   * run up and to the right, hexagons are flat-topped.  Unit edge length,
   * y axis pointing up (flip for SVG). */
  var VEC_ROW = [0, SQ3], VEC_COL = [1.5, SQ3 / 2], WHITE_OFFSET = [0.5, SQ3 / 2], FACE_OFFSET = [-0.5, SQ3 / 2];
  function blackPos(r, c) { return [r * VEC_ROW[0] + c * VEC_COL[0], r * VEC_ROW[1] + c * VEC_COL[1]]; }
  function whitePos(r, c) { var p = blackPos(r, c); return [p[0] + WHITE_OFFSET[0], p[1] + WHITE_OFFSET[1]]; }
  function faceCenter(r, c) { var p = blackPos(r, c); return [p[0] + FACE_OFFSET[0], p[1] + FACE_OFFSET[1]]; }
  function hexagonVertices(r, c) {
    var o = faceCenter(r, c), cx = o[0], cy = o[1], h = SQ3 / 2;
    return [[cx + 1, cy], [cx + 0.5, cy + h], [cx - 0.5, cy + h], [cx - 1, cy], [cx - 0.5, cy - h], [cx + 0.5, cy - h]];
  }
  function domainCorners(eps) {
    if (eps === undefined) eps = 0.25;
    var o = [-eps * (VEC_COL[0] + VEC_ROW[0]), -eps * (VEC_COL[1] + VEC_ROW[1])];
    var a = [N * VEC_COL[0], N * VEC_COL[1]], b = [N * VEC_ROW[0], N * VEC_ROW[1]];
    return [o, [o[0] + a[0], o[1] + a[1]], [o[0] + a[0] + b[0], o[1] + a[1] + b[1]], [o[0] + b[0], o[1] + b[1]]];
  }

  function stateDescription(h, s) {
    if (!s) return 'no diagonal';
    var d = DIAG_CELLS[h][s];
    return 'w' + (d.w + 1) + ' – b' + (d.b + 1);
  }

  return {
    N: N, NH: NH, NN: NN, NC: NC, SS: SS, NCELLS: NCELLS, NUM_CONFIGS: Math.pow(4, NH),
    mod: mod, nodeIndex: nodeIndex, channelIndex: channelIndex, channelOffsets: channelOffsets,
    cellIndex: cellIndex, cellOf: cellOf,
    decodeIndex: decodeIndex, encodeStates: encodeStates, numDiagonals: numDiagonals,
    edges: edges, planeEdges: planeEdges, diagonalEndpoints: diagonalEndpoints,
    signedTensor: signedTensor, unsignedTensor: unsignedTensor,
    DIAG_CELLS: DIAG_CELLS, CELL_TO_DIAG: CELL_TO_DIAG,
    determinantTerms: determinantTerms, permanentTerms: permanentTerms,
    convexHull: convexHull, toricConditions: toricConditions,
    analyse: analyse, withoutDiagonal: withoutDiagonal,
    repairDistance: repairDistance, quiver: quiver, fieldName: fieldName, superpotential: superpotential,
    FACE_OF_HEX: FACE_OF_HEX, HEX_OF_FACE: HEX_OF_FACE,
    faceOfHex: function (h) { return FACE_OF_HEX[h]; },
    parseConfiguration: parseConfiguration,
    VEC_ROW: VEC_ROW, VEC_COL: VEC_COL, WHITE_OFFSET: WHITE_OFFSET, FACE_OFFSET: FACE_OFFSET,
    blackPos: blackPos, whitePos: whitePos, faceCenter: faceCenter, hexagonVertices: hexagonVertices,
    domainCorners: domainCorners, stateDescription: stateDescription
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = BT;

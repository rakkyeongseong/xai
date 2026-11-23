/* cnn.js — the paper's CNN (DeepTopologicalCNN) in plain JavaScript, with the
 * input gradient needed for saliency.
 *
 * Architecture (BatchNorm already folded into the convolution weights):
 *   conv 9->32 (3x3, circular pad 1) ReLU
 *   conv 32->64                      ReLU
 *   conv 64->128                     ReLU
 *   flatten (128*9*9 = 10368) -> linear 256 -> ReLU -> (dropout: identity in eval) -> linear 1
 * Input: unsigned Kasteleyn tensor, cell = k*81 + u*9 + v.
 * Saliency: S_uvk = |d logit / d x_uvk|, computed by an explicit backward pass.
 */
var CNN = (function () {
  'use strict';
  var S = 9, SS = 81, CIN = 9, C1 = 32, C2 = 64, C3 = 128, HID = 256, FLAT = C3 * SS;
  var W = null, META = null;

  // wrapped neighbour index tables: WRAP[y*3+ky] = (y+ky-1) mod 9
  var WRAP = new Int32Array(S * 3);
  for (var y = 0; y < S; y++) for (var k = 0; k < 3; k++) WRAP[y * 3 + k] = (y + k - 1 + S) % S;

  function init(arrayBuffer, meta) {
    META = meta;
    var all = new Float32Array(arrayBuffer);
    W = {};
    for (var i = 0; i < meta.layers.length; i++) {
      var L = meta.layers[i];
      W[L.name] = all.subarray(L.offset, L.offset + L.size);
    }
    var need = ['conv1_w', 'conv1_b', 'conv2_w', 'conv2_b', 'conv3_w', 'conv3_b', 'fc1_w', 'fc1_b', 'fc2_w', 'fc2_b'];
    for (var j = 0; j < need.length; j++) if (!W[need[j]]) throw new Error('missing weights: ' + need[j]);
    if (W.fc1_w.length !== HID * FLAT) throw new Error('unexpected fc1 size ' + W.fc1_w.length);
    return true;
  }
  function ready() { return W !== null; }

  /* Circularly padded 3x3 cross-correlation (what torch.nn.Conv2d computes). */
  function conv(inp, cin, w, b, cout) {
    var out = new Float64Array(cout * SS);
    for (var o = 0; o < cout; o++) {
      var bo = b[o], obase = o * SS, wobase = o * cin * 9;
      for (var y = 0; y < S; y++) {
        var y0 = WRAP[y * 3], y1 = WRAP[y * 3 + 1], y2 = WRAP[y * 3 + 2];
        for (var x = 0; x < S; x++) {
          var x0 = WRAP[x * 3], x1 = WRAP[x * 3 + 1], x2 = WRAP[x * 3 + 2];
          var acc = bo;
          for (var i = 0; i < cin; i++) {
            var wb = wobase + i * 9, ib = i * SS;
            var r0 = ib + y0 * S, r1 = ib + y1 * S, r2 = ib + y2 * S;
            acc += w[wb] * inp[r0 + x0] + w[wb + 1] * inp[r0 + x1] + w[wb + 2] * inp[r0 + x2]
                 + w[wb + 3] * inp[r1 + x0] + w[wb + 4] * inp[r1 + x1] + w[wb + 5] * inp[r1 + x2]
                 + w[wb + 6] * inp[r2 + x0] + w[wb + 7] * inp[r2 + x1] + w[wb + 8] * inp[r2 + x2];
          }
          out[obase + y * S + x] = acc;
        }
      }
    }
    return out;
  }
  /* Gradient of the same convolution with respect to its input. */
  function convBackward(gout, cout, w, cin) {
    var gin = new Float64Array(cin * SS);
    for (var o = 0; o < cout; o++) {
      var obase = o * SS, wobase = o * cin * 9;
      for (var y = 0; y < S; y++) {
        var y0 = WRAP[y * 3], y1 = WRAP[y * 3 + 1], y2 = WRAP[y * 3 + 2];
        for (var x = 0; x < S; x++) {
          var g = gout[obase + y * S + x];
          if (g === 0) continue;
          var x0 = WRAP[x * 3], x1 = WRAP[x * 3 + 1], x2 = WRAP[x * 3 + 2];
          for (var i = 0; i < cin; i++) {
            var wb = wobase + i * 9, ib = i * SS;
            var r0 = ib + y0 * S, r1 = ib + y1 * S, r2 = ib + y2 * S;
            gin[r0 + x0] += w[wb] * g;     gin[r0 + x1] += w[wb + 1] * g; gin[r0 + x2] += w[wb + 2] * g;
            gin[r1 + x0] += w[wb + 3] * g; gin[r1 + x1] += w[wb + 4] * g; gin[r1 + x2] += w[wb + 5] * g;
            gin[r2 + x0] += w[wb + 6] * g; gin[r2 + x1] += w[wb + 7] * g; gin[r2 + x2] += w[wb + 8] * g;
          }
        }
      }
    }
    return gin;
  }
  function reluInPlace(a) { for (var i = 0; i < a.length; i++) if (a[i] < 0) a[i] = 0; return a; }

  function forward(x) {
    if (!W) throw new Error('CNN weights not loaded');
    var a1 = reluInPlace(conv(x, CIN, W.conv1_w, W.conv1_b, C1));
    var a2 = reluInPlace(conv(a1, C1, W.conv2_w, W.conv2_b, C2));
    var a3 = reluInPlace(conv(a2, C2, W.conv3_w, W.conv3_b, C3));
    var h = new Float64Array(HID), fw = W.fc1_w, fb = W.fc1_b;
    for (var k = 0; k < HID; k++) {
      var acc = fb[k], base = k * FLAT;
      for (var j = 0; j < FLAT; j++) acc += fw[base + j] * a3[j];
      h[k] = acc > 0 ? acc : 0;
    }
    var logit = W.fc2_b[0];
    for (k = 0; k < HID; k++) logit += W.fc2_w[k] * h[k];
    return { logit: logit, prob: 1 / (1 + Math.exp(-logit)), a1: a1, a2: a2, a3: a3, h: h };
  }

  /* logit, probability, signed input gradient and saliency |gradient| (729 cells). */
  function saliency(x) {
    var f = forward(x);
    var gh = new Float64Array(HID), k, j;
    for (k = 0; k < HID; k++) gh[k] = f.h[k] > 0 ? W.fc2_w[k] : 0;
    var g3 = new Float64Array(FLAT), fw = W.fc1_w;
    for (k = 0; k < HID; k++) {
      var gk = gh[k];
      if (gk === 0) continue;
      var base = k * FLAT;
      for (j = 0; j < FLAT; j++) g3[j] += fw[base + j] * gk;
    }
    for (j = 0; j < FLAT; j++) if (f.a3[j] <= 0) g3[j] = 0;
    var g2 = convBackward(g3, C3, W.conv3_w, C2);
    for (j = 0; j < g2.length; j++) if (f.a2[j] <= 0) g2[j] = 0;
    var g1 = convBackward(g2, C2, W.conv2_w, C1);
    for (j = 0; j < g1.length; j++) if (f.a1[j] <= 0) g1[j] = 0;
    var g0 = convBackward(g1, C1, W.conv1_w, CIN);
    var sal = new Float64Array(g0.length);
    for (j = 0; j < g0.length; j++) sal[j] = Math.abs(g0[j]);
    return { logit: f.logit, prob: f.prob, grad: g0, saliency: sal };
  }

  /* Projected map M_uv = max_k S_uvk (81 values, u*9+v). */
  function projectMap(sal) {
    var m = new Float64Array(SS);
    for (var k = 0; k < CIN; k++) for (var uv = 0; uv < SS; uv++) {
      var v = sal[k * SS + uv];
      if (v > m[uv]) m[uv] = v;
    }
    return m;
  }

  /* Highest-saliency cell among `allowed` cells (array of cell indices), stable ties. */
  function argmaxCells(sal, allowed) {
    var best = -1, bestVal = -Infinity;
    var order = allowed.slice().sort(function (a, b) { return a - b; });
    for (var i = 0; i < order.length; i++) {
      var v = sal[order[i]];
      if (v > bestVal) { bestVal = v; best = order[i]; }
    }
    return best;
  }

  return { init: init, ready: ready, forward: forward, saliency: saliency, projectMap: projectMap,
           argmaxCells: argmaxCells, meta: function () { return META; } };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = CNN;

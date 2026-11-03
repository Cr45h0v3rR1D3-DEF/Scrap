'use strict';
/* ================= Scrapline · the rest of Terra =================
   Beyond the pad's neighbourhood the planner spreads a city, towns, villages and farms over the whole planet,
   joins them with highways (bridges over narrow water, tunnels through ridges), lays railways with stations
   for trains that run by themselves, and marks the highest peak and the deepest sea floor.
   Routes are found on a cube-sphere grid of about 150 m cells that wraps the whole world. */
const GLOBE = { N: 0, n: 0, dir: null, H: null, nb: null, sites: [], roads: [], rails: [], lines: [], marks: {}, cellM: 150 };
const GB_TAN = Math.PI / 4;
/* face f, cell (i, j) -> unit direction (fractional indices allowed, they spill onto the next face) */
function gbDir(f, i, j, N, out) {
  const a = Math.tan(((i + 0.5) / N * 2 - 1) * GB_TAN), b = Math.tan(((j + 0.5) / N * 2 - 1) * GB_TAN);
  switch (f) {
    case 0: out.set(1, a, b); break; case 1: out.set(-1, b, a); break;
    case 2: out.set(b, 1, a); break; case 3: out.set(a, -1, b); break;
    case 4: out.set(a, b, 1); break; default: out.set(b, a, -1);
  }
  return out.normalize();
}
function gbCell(x, y, z) {
  const N = GLOBE.N, ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let f, a, b;
  if (ax >= ay && ax >= az) { if (x > 0) { f = 0; a = y / ax; b = z / ax; } else { f = 1; a = z / ax; b = y / ax; } }
  else if (ay >= az) { if (y > 0) { f = 2; a = z / ay; b = x / ay; } else { f = 3; a = x / ay; b = z / ay; } }
  else { if (z > 0) { f = 4; a = x / az; b = y / az; } else { f = 5; a = y / az; b = x / az; } }
  const i = clamp(Math.floor((Math.atan(a) / GB_TAN + 1) / 2 * N), 0, N - 1), j = clamp(Math.floor((Math.atan(b) / GB_TAN + 1) / 2 * N), 0, N - 1);
  return (f * N + j) * N + i;
}
const gbCellD = d => gbCell(d.x, d.y, d.z);
function globeGrid() {
  const N = GLOBE.N = Math.round(PLANET.R * Math.PI / 2 / GLOBE.cellM), n = GLOBE.n = 6 * N * N;
  const D = GLOBE.dir = new Float32Array(n * 3), H = GLOBE.H = new Float32Array(n), NB = GLOBE.nb = new Int32Array(n * 8), d = new V3();
  const NL = GLOBE.nl = new Float32Array(n * 8);
  for (let f = 0; f < 6; f++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const c = (f * N + j) * N + i;
    gbDir(f, i, j, N, d); D[c * 3] = d.x; D[c * 3 + 1] = d.y; D[c * 3 + 2] = d.z;
    H[c] = planetHeight(d.x, d.y, d.z);
    let k = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      gbDir(f, i + di, j + dj, N, d); NB[c * 8 + k++] = gbCell(d.x, d.y, d.z);
    }
  }
  for (let c = 0; c < n; c++) for (let k = 0; k < 8; k++) NL[c * 8 + k] = gbAng(c, NB[c * 8 + k]) * PLANET.R;
}
const gbV = (c, out = new V3()) => out.set(GLOBE.dir[c * 3], GLOBE.dir[c * 3 + 1], GLOBE.dir[c * 3 + 2]);
const gbAng = (a, b) => { const D = GLOBE.dir; return Math.acos(clamp(D[a * 3] * D[b * 3] + D[a * 3 + 1] * D[b * 3 + 1] + D[a * 3 + 2] * D[b * 3 + 2], -1, 1)); };
const arcM = (a, b) => Math.acos(clamp(a.dot(b), -1, 1)) * PLANET.R;
/* cheapest route between two cells: A* with a straight-line heuristic (a chord is never longer than the arc);
   cost(a, b, len) prices one step. The heap is a pair of typed arrays, grown as needed */
let GB_HK = new Float64Array(1 << 16), GB_HV = new Int32Array(1 << 16);
function gbRoute(start, goal, cost, limit = Infinity) {
  const n = GLOBE.n, R = PLANET.R, NB = GLOBE.nb, NL = GLOBE.nl, D = GLOBE.dir;
  const g = new Float32Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  const gx = D[goal * 3], gy = D[goal * 3 + 1], gz = D[goal * 3 + 2];
  const heur = c => { const dx = D[c * 3] - gx, dy = D[c * 3 + 1] - gy, dz = D[c * 3 + 2] - gz; return Math.sqrt(dx * dx + dy * dy + dz * dz) * R; };
  let hn = 0, hk = GB_HK, hv = GB_HV;
  const push = (f, c) => {
    if (hn >= hk.length) { const k2 = new Float64Array(hk.length * 2), v2 = new Int32Array(hk.length * 2); k2.set(hk); v2.set(hv); GB_HK = hk = k2; GB_HV = hv = v2; }
    let k = hn++;
    while (k > 0) { const p = (k - 1) >> 1; if (hk[p] <= f) break; hk[k] = hk[p]; hv[k] = hv[p]; k = p; }
    hk[k] = f; hv[k] = c;
  };
  const pop = () => {
    const c = hv[0]; hn--;
    if (hn > 0) {
      const f = hk[hn], v = hv[hn]; let k = 0;
      for (;;) { const l = 2 * k + 1; if (l >= hn) break; const r = l + 1, m = r < hn && hk[r] < hk[l] ? r : l; if (hk[m] >= f) break; hk[k] = hk[m]; hv[k] = hv[m]; k = m; }
      hk[k] = f; hv[k] = v;
    }
    return c;
  };
  g[start] = 0; push(heur(start), start);
  let it = 0;
  while (hn && it++ < 600000) {
    const a = pop(); if (done[a]) continue; done[a] = 1;
    if (a === goal) { const path = []; for (let k = a; k >= 0; k = from[k]) path.push(k); path.reverse(); path.cost = g[a]; return path; }
    const ga = g[a];
    for (let k = 0; k < 8; k++) {
      const b = NB[a * 8 + k]; if (b === a || done[b]) continue;
      const c = cost(a, b, NL[a * 8 + k]); if (!(c < Infinity)) continue;
      const ng = ga + c;
      if (ng < g[b]) { const f = ng + heur(b); if (f > limit) continue; g[b] = ng; from[b] = a; push(f, b); }
    }
  }
  return null;
}
/* ---------- paths on the sphere: densify, smooth, resample, and give them a height profile ---------- */
function slerpTo(a, b, t, out) { const w = Math.acos(clamp(a.dot(b), -1, 1)); if (w < 1e-9) return out.copy(a); const s = Math.sin(w); return out.copy(a).multiplyScalar(Math.sin((1 - t) * w) / s).addScaledVector(b, Math.sin(t * w) / s); }
function resampleD(P, step) {
  const out = [P[0].clone()]; let carry = 0;
  for (let i = 0; i < P.length - 1; i++) {
    const L = arcM(P[i], P[i + 1]); let t = step - carry;
    while (t <= L) { out.push(slerpTo(P[i], P[i + 1], t / L, new V3())); t += step; }
    carry = L - (t - step);
  }
  const last = P[P.length - 1];
  if (arcM(last, out[out.length - 1]) > step * 0.4) out.push(last.clone()); else out[out.length - 1] = last.clone();
  return out;
}
/* Laplacian smoothing on the sphere; points within leadA / leadB metres of the ends stay put */
function smoothD(P, step, leadA, leadB, it) {
  const n = P.length, L = (n - 1) * step;
  const free = P.map((_, i) => i * step > leadA && i * step < L - leadB);
  for (let k = 0; k < it; k++) {
    const Q = P.map(p => p.clone());
    for (let i = 1; i < n - 1; i++) if (free[i]) Q[i].copy(P[i - 1]).addScaledVector(P[i], 2).add(P[i + 1]).normalize();
    P = Q;
  }
  return P;
}
/* resample a typed path (xyz per point, unit directions) to even steps of `step` metres */
function resampleArr(A, step) {
  const n = A.length / 3, R = PLANET.R, out = [A[0], A[1], A[2]];
  let carry = 0;
  for (let i = 0; i < n - 1; i++) {
    const ax = A[i * 3], ay = A[i * 3 + 1], az = A[i * 3 + 2], bx = A[i * 3 + 3], by = A[i * 3 + 4], bz = A[i * 3 + 5];
    const ex = bx - ax, ey = by - ay, ez = bz - az, L = Math.sqrt(ex * ex + ey * ey + ez * ez) * R; let t = step - carry;
    while (t <= L) { const f = t / L, x = ax + (bx - ax) * f, y = ay + (by - ay) * f, z = az + (bz - az) * f, l = Math.sqrt(x * x + y * y + z * z); out.push(x / l, y / l, z / l); t += step; }
    carry = L - (t - step);
  }
  const k = out.length - 3, lx = A[n * 3 - 3], ly = A[n * 3 - 2], lz = A[n * 3 - 1];
  if (Math.hypot(lx - out[k], ly - out[k + 1], lz - out[k + 2]) * R > step * 0.4) out.push(lx, ly, lz); else { out[k] = lx; out[k + 1] = ly; out[k + 2] = lz; }
  return Float64Array.from(out);
}
/* ease any bend tighter than minR, a little at a time, outside the leads */
function easeArr(A, step, leadA, leadB, minR) {
  for (let pass = 0; pass < 40; pass++) {
    A = resampleArr(A, step);
    const n = A.length / 3; if (n < 7) return A;
    // (a bend that will not ease out in a narrow stretch gets a wider one, pass by pass)
    const mark = new Uint8Array(n), L = (n - 1) * step, w = 6 + (pass >> 2); let any = false;
    // the turn over two pieces each side (a bend) and over one (a jog): either tighter than 0.8 minR
    const turn = (j, s) => {
      const a = j - s * 3, b = j + s * 3;
      const ux = A[j] - A[a], uy = A[j + 1] - A[a + 1], uz = A[j + 2] - A[a + 2], vx = A[b] - A[j], vy = A[b + 1] - A[j + 1], vz = A[b + 2] - A[j + 2];
      return Math.acos(clamp((ux * vx + uy * vy + uz * vz) / (Math.sqrt((ux * ux + uy * uy + uz * uz) * (vx * vx + vy * vy + vz * vz)) || 1), -1, 1));
    };
    for (let i = 2; i < n - 2; i++) {
      const j = i * 3;
      if (turn(j, 2) * minR * 0.8 > 2 * step || turn(j, 1) * minR * 0.8 > step) for (let k = Math.max(1, i - w); k <= Math.min(n - 2, i + w); k++) if (k * step > leadA && k * step < L - leadB) { mark[k] = 1; any = true; }
    }
    if (!any) break;
    A = smoothArr(A, mark, 12);
  }
  return resampleArr(A, step);
}
function easeD(P, step, leadA, leadB, minR) { return fromArr(easeArr(toArr(P), step, leadA, leadB, minR)); }
const _ge1 = new V3(), _ge2 = new V3();
/* heights along a path: smooth, a grade limit, bridges over water (and viaducts over deep valleys when o.fill is set),
   roofed cuts through ridges. o.pins: Map index -> height where it crosses a road already built (they meet level) */
function profileD(P, step, o) {
  const n = P.length, hp = P.map(d => planetHeight(d.x, d.y, d.z)), water = hp.map(h => h < 0.6), pins = o.pins || new Map();
  let h = hp.map((v, i) => water[i] ? 0 : v);
  const fa = o.hA !== undefined ? o.hA : h[0], fb = o.hB !== undefined ? o.hB : h[n - 1];
  const fix = new Uint8Array(n); fix[0] = fix[n - 1] = 1;
  for (const [i, v] of pins) { h[i] = v; fix[i] = 1; }
  h[0] = fa; h[n - 1] = fb;
  const relax = it => { for (let k = 0; k < it; k++) { const q = h.slice(); for (let i = 1; i < n - 1; i++) if (!fix[i] && !water[i]) q[i] = (h[i - 1] + 2 * h[i] + h[i + 1]) / 4; h = q; } };
  relax(o.fill ? 120 : 60);
  for (let i = 0; i < n; i++) {
    if (!water[i] || fix[i]) continue;
    let j = i; while (j < n && water[j] && !fix[j]) j++;
    const a = i > 0 ? h[i - 1] : o.deck, b = j < n ? h[j] : a;
    for (let k = i; k < j; k++) { const t = (k - i + 1) / (j - i + 1); h[k] = Math.max(o.deck, lerp(a, b, t)); }
    i = j;
  }
  for (let i = 1; i < n - 1; i++) if (!water[i] && !fix[i]) h[i] = Math.max(h[i], 1.2);
  const gmax = Math.max(o.grade * step, Math.abs(fb - fa) / (n - 1) * 1.05);
  for (let pass = 0; pass < 10; pass++) {
    for (let i = 1; i < n - 1; i++) if (!fix[i]) h[i] = clamp(h[i], h[i - 1] - gmax, h[i - 1] + gmax);
    for (let i = n - 2; i >= 1; i--) if (!fix[i]) h[i] = clamp(h[i], h[i + 1] - gmax, h[i + 1] + gmax);
  }
  // crests and dips rounded off (see roundCrests)
  const round = () => roundCrests(h, fix, step, o.vr);
  // a line rounded down into the sea is held at its lowest allowed height there, and rounded again round that
  if (o.vr) for (let it = 0; it < 3; it++) {
    round();
    let low = false;
    for (let i = 1; i < n - 1; i++) { const f = 1.2; if (!fix[i] && h[i] < f) { h[i] = f; fix[i] = 1; low = true; } }
    if (!low) break;
  }
  for (let i = 1; i < n - 1; i++) if (!fix[i]) h[i] = Math.max(h[i], 1.2);
  // runs of at least `len` points where test holds; shorter gaps between runs are closed, shorter runs dropped
  const runs = (test, gap, len, keep) => {
    const f = h.map((_, i) => !fix[i] && test(i));
    for (let i = 1; i < n; i++) if (!f[i] && f[i - 1]) { let j = i; while (j < n && !f[j]) j++; if (j < n && j - i <= gap) for (let k = i; k < j; k++) if (!fix[k] && keep(k)) f[k] = true; i = j; }
    for (let i = 0; i < n; i++) if (f[i]) { let j = i; while (j < n && f[j]) j++; if (j - i < len) for (let k = i; k < j; k++) f[k] = false; i = j; }
    return f;
  };
  const tunnel = runs(i => !water[i] && hp[i] - h[i] > o.cut, 6, 6, k => !water[k] && hp[k] - h[k] > 4);
  // a viaduct where the line runs high over a valley
  const via = o.fill ? runs(i => !water[i] && h[i] - hp[i] > o.fill, 5, 5, k => h[k] - hp[k] > 3) : null;
  const bridge = water.map((w, i) => w || (via && via[i]));
  return { h, water, bridge, tunnel, ground: hp };
}
/* ---------- where the settlements go ---------- */
const TOWN_NAMES = { city: ['Grand Metro'], town: ['Millbrook', 'Copper Ridge', 'Fairhaven'], village: ['Oakley', 'Stonebridge', 'Little Hollow', 'Pinecrest', 'Dunmore'], farm: ['Sunfield Farm', 'Red Barn Farm', 'Windmill Farm', 'Hilltop Farm'] };
const TOWN_SIZE = { city: [235, 235, 18], town: [135, 135, 26], village: [72, 72, 30], farm: [125, 90, 30] };
/* how flat a rectangle round a direction is, for a few turns of it */
function fitAt(C, a, b) {
  const t1 = new V3(), t2 = new V3(); tangentBasis(C.x, C.y, C.z, t1, t2);
  let best = null; const q = new V3();
  for (let k = 0; k < 6; k++) {
    const ang = k * Math.PI / 6, ca = Math.cos(ang), sa = Math.sin(ang);
    const e1 = t1.clone().multiplyScalar(ca).addScaledVector(t2, sa), e3 = new V3().crossVectors(e1, C).normalize();
    let sum = 0, n = 0, mn = 1e9, mx = -1e9;
    for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
      expDir(C, e1, e3, PLANET.R, (a + 25) * i / 3, (b + 25) * j / 3, q);
      const h = planetHeight(q.x, q.y, q.z); sum += h; n++; mn = Math.min(mn, h); mx = Math.max(mx, h);
    }
    const mean = sum / n, dev = Math.max(mx - mean, mean - mn);
    if (!best || dev < best.dev) best = { dev, mean, mn, e1, e3, ang };
  }
  return best;
}
function planSettlements() {
  const n = GLOBE.n, H = GLOBE.H, NB = GLOBE.nb, R = PLANET.R, up = WP.up;
  // candidate cells: dry, gently sloped, well away from the pad's own neighbourhood
  const cand = [];
  const d = new V3();
  for (let c = 0; c < n; c++) {
    const h = H[c]; if (h < 4 || h > 300) continue;
    let rough = 0, dry = true;
    for (let k = 0; k < 8; k++) { const hb = H[NB[c * 8 + k]]; if (hb < 2) { dry = false; break; } rough = Math.max(rough, Math.abs(hb - h)); }
    if (!dry || rough > 30) continue;
    gbV(c, d); if (Math.acos(clamp(d.dot(up), -1, 1)) * R < 4300) continue;
    cand.push({ c, rough, h });
  }
  const chosen = [{ d: up.clone(), r: 3600 }];
  for (const s of WP.sites) chosen.push({ d: s.C.clone(), r: 400 });
  const order = ['city', 'town', 'town', 'town', 'village', 'village', 'village', 'village', 'village', 'farm', 'farm', 'farm', 'farm'];
  const used = { city: 0, town: 0, village: 0, farm: 0 };
  const sites = [];
  for (const kind of order) {
    const [a, b, maxDev] = TOWN_SIZE[kind], rad = Math.hypot(a, b);
    // the farthest good spot from everything placed so far, among the smoothest candidates
    const pool = cand.filter(x => x.rough < maxDev * 0.7);
    let best = null, bs = -1;
    for (const x of pool) {
      gbV(x.c, d);
      let mind = 1e9; for (const o of chosen) mind = Math.min(mind, arcM(d, o.d) - o.r - rad);
      if (mind < 1800) continue;
      const sc = mind - x.rough * 40;
      if (sc > bs) { bs = sc; best = x; }
    }
    if (!best) continue;
    const C = gbV(best.c, new V3()), fit = fitAt(C, a, b);
    if (fit.dev > maxDev * 1.6 || fit.mn < 1.5) { cand.splice(cand.indexOf(best), 1); continue; }
    const name = TOWN_NAMES[kind][used[kind]++];
    const s = { name: 'g_' + name.toLowerCase().replace(/\W+/g, '_'), label: name, kind, C, E1: fit.e1, E3: fit.e3, h: Math.max(4, fit.mean), a, b, dev: fit.dev, rad, global: true };
    sites.push(s); chosen.push({ d: C, r: rad });
  }
  // flatten them, with a ground colour that suits each
  const SURF = { city: [0.42, 0.45, 0.4], town: [0.4, 0.55, 0.3], village: [0.42, 0.56, 0.3], farm: null };
  for (const s of sites) s.zone = wsZone(PLANET.ws, s.C, s.E1, s.E3, s.a, s.b, s.h, 50, SURF[s.kind], s.kind === 'farm' ? 'fields' : null);
  GLOBE.sites = sites;
  return sites;
}
/* ---------- highways ---------- */
// each kind of place's ways in, in its own (u, v): a point outside it, then where the road stops inside
const G_ENTRY = {
  city: [[[0, 280], [0, 226]], [[0, -280], [0, -226]], [[280, 0], [226, 0]], [[-280, 0], [-226, 0]], [[90, 280], [90, 226]], [[-90, -280], [-90, -226]]],
  town: [[[0, 180], [0, 136]], [[0, -180], [0, -136]], [[180, 0], [136, 0]], [[-180, 0], [-136, 0]]],
  village: [[[115, 0], [70, 0]], [[-115, 0], [-70, 0]], [[0, 115], [0, 70]], [[0, -115], [0, -70]]],
  farm: [[[-170, 0], [-112, 0]], [[-85, 135], [-85, 88]], [[-85, -135], [-85, -88]]],
  airport: [[[-15, 155], [-15, 70]], [[-620, 45], [-290, 45]], [[620, 85], [165, 85]]]
};
const sDir = (s, u, v, out = new V3()) => expDir(s.C, s.E1, s.E3, PLANET.R, u, v, out);
function inRect(s, d, m) {
  // (only on the place's own side of the planet: straight through it, its far side would count as inside too)
  if (d.x * s.C.x + d.y * s.C.y + d.z * s.C.z < 0.98) return false;
  const dx = d.x - s.C.x, dy = d.y - s.C.y, dz = d.z - s.C.z, R = PLANET.R;
  return Math.abs((dx * s.E1.x + dy * s.E1.y + dz * s.E1.z) * R) < s.a + m && Math.abs((dx * s.E3.x + dy * s.E3.y + dz * s.E3.z) * R) < s.b + m;
}
/* the entry of node A that best faces node B */
function pickEntry(A, B) {
  const ents = G_ENTRY[A.ekind], t = new V3().subVectors(B.site.C, A.site.C); t.addScaledVector(A.site.C, -t.dot(A.site.C)).normalize();
  let best = -1, bs = -2;
  ents.forEach((e, i) => {
    if (A.used.has(i)) return;
    const o = sDir(A.site, ...e[0]).sub(sDir(A.site, ...e[1])).normalize(), sc = o.dot(t);
    if (sc > bs) { bs = sc; best = i; }
  });
  if (best < 0) return null;
  A.used.add(best);
  return ents[best];
}
/* typed-array path tools: n points, xyz each */
function toArr(L) { const A = new Float64Array(L.length * 3); L.forEach((p, i) => { A[i * 3] = p.x; A[i * 3 + 1] = p.y; A[i * 3 + 2] = p.z; }); return A; }
function fromArr(A) { const L = []; for (let i = 0; i < A.length; i += 3) L.push(new V3(A[i], A[i + 1], A[i + 2])); return L; }
function smoothArr(A, free, it) {
  const n = A.length / 3; let B = new Float64Array(A.length), S = A;
  for (let k = 0; k < it; k++) {
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      if (!free[i] || i === 0 || i === n - 1) { B[j] = S[j]; B[j + 1] = S[j + 1]; B[j + 2] = S[j + 2]; continue; }
      const x = S[j - 3] + 2 * S[j] + S[j + 3], y = S[j - 2] + 2 * S[j + 1] + S[j + 4], z = S[j - 1] + 2 * S[j + 2] + S[j + 5], l = Math.sqrt(x * x + y * y + z * z);
      B[j] = x / l; B[j + 1] = y / l; B[j + 2] = z / l;
    }
    const t = S === A ? new Float64Array(A.length) : S; S = B; B = t;
  }
  return S;
}
/* where a fixed straight lead meets the smoothed path there can be a corner (smoothing leaves a straight run from a fixed
   point alone): replace the start of the free part with a curve that leaves along the lead, long enough to turn gently */
function filletStart(P, F, step, minR) {
  const n = P.length; if (F < 1 || F > n - 8) return 0;
  const R = PLANET.R, tan = (a, b) => { const t = new V3().subVectors(b, a); return t.addScaledVector(a, -t.dot(a)).normalize(); };
  const T0 = tan(P[F - 1], P[F]);
  // long enough that a curve turning the whole way round fits: along the path, and straight across (a road that
  // doubles back has gone a long way but is still close by)
  // (an arc of radius r turning by th moves r(1 - cos th) sideways and r sin th along the way it set out)
  const Nm = new V3().crossVectors(T0, P[F]).normalize(), rel = new V3();
  let K = 4;
  for (; K < 90 && F + K + 3 < n; K++) {
    const T1 = tan(P[F + K], P[F + K + 2]), C = tan(P[F], P[F + K]);
    const ang = Math.acos(clamp(T0.dot(C), -1, 1)) + Math.acos(clamp(C.dot(T1), -1, 1)), th = Math.acos(clamp(T0.dot(T1), -1, 1));
    rel.subVectors(P[F + K], P[F]).multiplyScalar(R);
    const side = Math.abs(rel.dot(Nm)), ahead = rel.dot(T0);
    if (K * step >= minR * ang * 1.7 + 2 * step && side >= minR * 1.4 * (1 - Math.cos(th)) && (th > Math.PI / 2 || ahead >= minR * 1.4 * Math.sin(th))) break;
  }
  if (F + K + 2 >= n) return 0;
  // a cubic from the lead's end to there, its handles as long as a circular arc's for the turn between the two ends
  const A = P[F], B = P[F + K], T1 = tan(P[F + K], P[F + K + 2]), ch = arcM(A, B), th = Math.acos(clamp(T0.dot(T1), -1, 1));
  const Lc = (th < 0.05 ? ch / 3 : ch / (2 * Math.sin(th / 2)) * 4 / 3 * Math.tan(th / 4)) / R;
  const c1 = A.clone().addScaledVector(T0, Lc).normalize(), c2 = B.clone().addScaledVector(T1, -Lc).normalize();
  const q = [new V3(), new V3(), new V3(), new V3(), new V3(), new V3()];
  const bez = (t, out) => {
    q[0].copy(A).lerp(c1, t); q[1].copy(c1).lerp(c2, t); q[2].copy(c2).lerp(B, t);
    q[3].copy(q[0]).lerp(q[1], t); q[4].copy(q[1]).lerp(q[2], t);
    return out.copy(q[3]).lerp(q[4], t).normalize();
  };
  // the curve, as K evenly spaced pieces along it
  const S = 400, cum = new Float64Array(S + 1), pv = A.clone(), cv = new V3();
  for (let j = 1; j <= S; j++) { bez(j / S, cv); cum[j] = cum[j - 1] + pv.distanceTo(cv) * R; pv.copy(cv); }
  const len = cum[S];
  for (let j = 1, s = 0; j < K; j++) {
    const want = len * j / K; while (s < S && cum[s + 1] < want) s++;
    const t = (s + (want - cum[s]) / ((cum[s + 1] - cum[s]) || 1)) / S;
    P[F + j] = bez(t, new V3());
  }
  return len;
}
/* the same job done by driving it: from the end of the lead, steer (never tighter than radius r) for a point a little
   way along the path until running on it, then join it there. Whatever the path does near the lead (even doubling
   straight back) the way out is a curve that can be driven. Gives the new path and how much of the curve to leave
   alone (up to where it starts to blend onto the path, so the join itself can still be eased), or null */
function pursueStart(P, F, step, r, sites, T0, clear) {
  const n = P.length; if (F < 1 || F > n - 12) return null;
  const R = PLANET.R, tan = (a, b) => { const t = new V3().subVectors(b, a); return t.addScaledVector(a, -t.dot(a)).normalize(); };
  // setting out the way the lead runs (as given: the points about its end may have been moved a little)
  const p = P[F].clone(), t = T0 ? T0.clone().addScaledVector(p, -T0.dot(p)).normalize() : tan(P[F - 1], P[F]), out = [], cr = new V3(), tp = new V3();
  const look = Math.max(6, Math.round(r * 0.8 / step)), B = Math.max(8, Math.ceil(1.5 * r / step)), E = Math.max(6, r * 0.08);
  // how sharply the path turns at each point (over two pieces each side); it is joined only where it runs on with no
  // bend sharper than the easing after this would take out
  const bend = new Float32Array(n), lim = 2 * step * 1.3 / (r * 0.8), M = Math.max(6, Math.ceil(0.3 * r / step));
  for (let i = 2; i < n - 2; i++) bend[i] = Math.acos(clamp(tan(P[i - 2], P[i]).dot(tan(P[i], P[i + 2])), -1, 1));
  const gentle = (j, m) => { for (let k = j; k < Math.min(n - 2, j + m); k++) if (bend[k] > lim) return false; return true; };
  let j = F;
  // the nearest point of the path, never going back along it
  const near = () => { let bd = Infinity, bj = j; for (let k = j; k < Math.min(n, j + 40); k++) { const d = arcM(p, P[k]); if (d < bd) { bd = d; bj = k; } } j = bj; return bd; };
  // steer for a point a little way on along the path (hard over if it is behind), turn about the local up, step on
  const ahead = new V3(), toC = new V3();
  const drive = () => {
    const tg = P[Math.min(n - 1, j + look)], want = tan(p, tg), Ld = Math.max(arcM(p, tg), step);
    const a = Math.atan2(cr.crossVectors(t, want).dot(p), t.dot(want));
    let th = (Math.abs(a) > Math.PI / 2 ? Math.sign(a) / r : clamp(2 * Math.sin(a) / Ld, -1 / r, 1 / r)) * step;
    // about to run into a place: turn away from it as hard as allowed
    ahead.copy(p).addScaledVector(t, step * 4 / R).normalize();
    if (sites) for (const s of sites) if (inRect(s, ahead, 12)) { toC.subVectors(s.C, p); th = -Math.sign(cr.crossVectors(t, toC).dot(p) || 1) * step / r; break; }
    // or along a road, close beside it: away from it (crossing one is fine)
    if (clear) {
      const nr = ridxNear(ahead, clear);
      if (nr) {
        const q = nr.road.pts, tr = towardD(q[Math.max(0, nr.i - 1)].d, q[Math.min(q.length - 1, nr.i + 1)].d);
        if (Math.abs(cr.crossVectors(tr, t).dot(p)) < 0.5) { toC.subVectors(q[nr.i].d, p); th = -Math.sign(cr.crossVectors(t, toC).dot(p) || 1) * step / r; }
      }
    }
    cr.crossVectors(p, t); t.multiplyScalar(Math.cos(th)).addScaledVector(cr, Math.sin(th));
    p.addScaledVector(t, step / R).normalize(); t.addScaledVector(p, -t.dot(p)).normalize();
  };
  for (let it = 0; it < 800; it++) {
    const bd = near();
    if (j + look + B + 3 > n) return null;
    tp.subVectors(P[j + 1], P[j]).addScaledVector(p, -tp.dot(p)).normalize();
    if (it > 1 && bd < E && t.dot(tp) > 0.985 && gentle(j, B + M)) {
      // close and running the same way: ease across onto the path over the next stretch, then follow it
      const j0 = j, kept = out.length;
      for (let b = 1; b <= B; b++) {
        near(); drive();
        const w = b / B, s = w * w * (3 - 2 * w);
        out.push(p.clone().lerp(P[j0 + b], s).normalize());
      }
      return { P: [...P.slice(0, F + 1), ...out, ...P.slice(j0 + B + 1)], len: kept * step };
    }
    drive(); out.push(p.clone());
  }
  return null;
}
/* a smooth road on the sphere through these directions. The first nA and last nB list points are straight leads
   (into a place, along a platform) that stay exactly as given; leadA / leadB are their lengths in metres */
function shapePath(list, step, leadA, leadB, iters, minR, sites, nA = 2, nB = 2, clear = 0) {
  // the middle, from the end of one lead to the start of the other, smoothed on a path three times coarser
  // (nine times fewer passes for the same effect), then a little at full detail; its two ends stay put
  const mid = list.slice(nA, list.length - nB);
  let A = toArr(resampleD(mid, step * 3));
  const ends = (n, k) => { const f = new Uint8Array(n).fill(1); for (let i = 0; i < k && i < n; i++) f[i] = f[n - 1 - i] = 0; return f; };
  A = smoothArr(A, ends(A.length / 3, 1), Math.ceil(iters / 9));
  A = resampleArr(A, step);
  A = smoothArr(A, ends(A.length / 3, 1), 12);
  const M = fromArr(A);
  // the whole road: lead, middle, lead, evenly spaced
  let P = resampleD([...list.slice(0, nA), ...M, ...list.slice(list.length - nB)], step);
  const FA = Math.floor(leadA / step), FB = Math.floor(leadB / step);
  if (sites) P = keepOut(P, step, leadA, leadB, sites);
  if (clear) P = keepClear(P, step, leadA, leadB, clear);
  P = cutLoops(P, step, leadA, leadB, minR);
  // curves out of the leads, then ease whatever bends are left between them
  const lead = (F, T) => { const q = pursueStart(P, F, step, minR * 1.3, sites, T, clear); if (q) { P = q.P; return q.len; } return filletStart(P, F, step, minR); };
  const finish = () => {
    const KA = lead(FA, towardD(list[0], list[1]));
    P.reverse(); const KB = lead(FB, towardD(list[list.length - 1], list[list.length - 2])); P.reverse();
    const la = FA * step + KA + 1, lb = FB * step + KB + 1;
    P = easeD(P, step, la, lb, minR);
    // last, cut out any fold or hairpin left (a few points turning sharply), then ease again
    for (let pass = 0; pass < 6; pass++) {
      const n = P.length, L = (n - 1) * step, drop = new Uint8Array(n); let any = false;
      for (let i = 1; i < n - 1; i++) {
        if (i * step <= Math.min(la, FA * step + 1) || i * step >= L - Math.min(lb, FB * step + 1)) continue;
        const a = P[i - 1], b = P[i], c = P[i + 1];
        const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - b.x, vy = c.y - b.y, vz = c.z - b.z;
        const cs = (ux * vx + uy * vy + uz * vz) / (Math.sqrt((ux * ux + uy * uy + uz * uz) * (vx * vx + vy * vy + vz * vz)) || 1);
        if (cs < 0.6) { for (let k = Math.max(1, i - 2); k <= Math.min(n - 2, i + 2); k++) drop[k] = 1; any = true; }
      }
      if (!any) break;
      P = easeD(resampleD(P.filter((_, i) => !drop[i]), step), step, la, lb, minR);
    }
  };
  finish();
  // if the curves out of the leads cut the corner of a place after all, or came to run along a road, move that stretch
  // out of the way and lay the curves again
  let Q = P;
  if (sites) Q = keepOut(Q, step, leadA, leadB, sites);
  if (clear) Q = keepClear(Q, step, leadA, leadB, clear);
  if (Q !== P) { P = Q; finish(); }
  return P;
}
const HW_STEP = 8;
/* push any stretch of road that cuts a corner of a place back out past its edge (the leads into the place stay) */
function keepOut(P, step, leadA, leadB, sites) {
  const R = PLANET.R, IA = P[0].clone(), IB = P[P.length - 1].clone();
  // the leads, by where they are rather than by count (the spacing shifts as points move)
  const inLead = q => arcM(q, IA) < leadA + 6 || arcM(q, IB) < leadB + 6;
  for (let pass = 0; pass < 4; pass++) {
    const n = P.length, hit = new Uint8Array(n); let any = false;
    for (let k = 0; k < n; k++) {
      if (inLead(P[k])) continue;
      for (const s of sites) {
        if (!inRect(s, P[k], 10)) continue;
        const dx = P[k].x - s.C.x, dy = P[k].y - s.C.y, dz = P[k].z - s.C.z;
        let u = (dx * s.E1.x + dy * s.E1.y + dz * s.E1.z) * R, v = (dx * s.E3.x + dy * s.E3.y + dz * s.E3.z) * R;
        if (Math.abs(u) / s.a > Math.abs(v) / s.b) u = Math.sign(u) * (s.a + 16); else v = Math.sign(v) * (s.b + 16);
        P[k] = sDir(s, u, v); hit[k] = 1; any = true;
      }
    }
    if (!any) break;
    // smooth round the moved points, then even the spacing out again
    const free = new Uint8Array(n); for (let k = 0; k < n; k++) if (!inLead(P[k])) for (let j = -14; j <= 14; j++) if (hit[k + j]) { free[k] = 1; break; }
    P = fromArr(resampleArr(smoothArr(toArr(P), free, 20), step));
  }
  return P;
}
/* move any stretch that runs alongside a road already built (closer than clear metres, and nearly parallel to it) out
   to one side of it, so the two do not lie on top of each other; crossings are left alone */
function keepClear(P, step, leadA, leadB, clear) {
  const R = PLANET.R, IA = P[0].clone(), IB = P[P.length - 1].clone();
  const inLead = q => arcM(q, IA) < leadA + 6 || arcM(q, IB) < leadB + 6;
  const cr = new V3();
  for (let pass = 0; pass < 5; pass++) {
    const n = P.length, hit = new Uint8Array(n), info = new Array(n); let any = false;
    for (let k = 1; k < n - 1; k++) {
      if (inLead(P[k])) continue;
      const near = ridxNear(P[k], clear); if (!near) continue;
      const q = near.road.pts, i = near.i, tr = towardD(q[Math.max(0, i - 1)].d, q[Math.min(q.length - 1, i + 1)].d), tp = towardD(P[k - 1], P[k + 1]);
      if (Math.abs(cr.crossVectors(tr, tp).dot(P[k])) > 0.5) continue;
      const nrm = new V3().crossVectors(P[k], tr).normalize();
      info[k] = { o: q[i].d, nrm, off: new V3().subVectors(P[k], q[i].d).dot(nrm) * R, road: near.road };
      hit[k] = 1; any = true;
    }
    if (!any) break;
    // each stretch alongside a road goes wholly to one side of it: the side most of it is on already
    for (let k = 1; k < n - 1; k++) {
      if (!hit[k]) continue;
      let e = k; while (e + 1 < n - 1 && (hit[e + 1] || (hit[e + 2] && e + 2 < n - 1))) e++;
      let sum = 0; for (let j = k; j <= e; j++) if (hit[j]) sum += info[j].off * (info[j].nrm.dot(info[k].nrm) > 0 ? 1 : -1);
      const side = sum >= 0 ? 1 : -1;
      for (let j = k; j <= e; j++) if (hit[j]) {
        const f = info[j], sg = side * (f.nrm.dot(info[k].nrm) > 0 ? 1 : -1);
        P[j] = f.o.clone().addScaledVector(f.nrm, sg * (clear + 4) / R).normalize();
      }
      k = e;
    }
    const free = new Uint8Array(n); for (let k = 0; k < n; k++) if (!inLead(P[k])) for (let j = -14; j <= 14; j++) if (hit[k + j]) { free[k] = 1; break; }
    P = fromArr(resampleArr(smoothArr(toArr(P), free, 20), step));
  }
  return P;
}
/* wherever the path doubles back on itself (a stretch much longer than the straight line across it: a hairpin tighter
   than it can take, or a route that leaves a place the wrong way and turns straight back) that stretch is cut out and
   the line goes straight across, in a cutting or on a viaduct if it has to */
function cutLoops(P, step, leadA, leadB, minR) {
  const W = Math.ceil(Math.PI * minR * 1.2 / step);
  for (let pass = 0; pass < 12; pass++) {
    const n = P.length, L = (n - 1) * step; let cut = null;
    for (let i = 1; i < n - 1 && !cut; i++) {
      if (i * step < leadA - step) continue;
      if (i * step > L - leadB + step) break;
      for (let j = Math.min(n - 2, i + W); j > i + 4; j--) {
        if (j * step > L - leadB + step) continue;
        if (arcM(P[i], P[j]) < (j - i) * step * 0.45) { cut = [i, j]; break; }
      }
    }
    if (!cut) break;
    P = resampleD([...P.slice(0, cut[0] + 1), ...P.slice(cut[1])], step);
  }
  return P;
}
/* every road point built so far, filed by grid cell, so a new road or railway can find where it crosses one */
const RIDX = new Map();
function ridxAdd(road) { road.pts.forEach((p, i) => { const c = gbCellD(p.d); let l = RIDX.get(c); if (!l) RIDX.set(c, l = []); l.push(road, i); }); }
function ridxNear(d, r) {
  const c = gbCellD(d), NB = GLOBE.nb; let best = null, bd = r;
  for (let m = -1; m < 8; m++) {
    const l = RIDX.get(m < 0 ? c : NB[c * 8 + m]); if (!l) continue;
    for (let k = 0; k < l.length; k += 2) { const q = l[k].pts[l[k + 1]], dd = arcM(d, q.d); if (dd < bd) { bd = dd; best = { road: l[k], i: l[k + 1], dist: dd }; } }
  }
  return best;
}
const pathLen = path => { let L = 0; for (let i = 1; i < path.length; i++) L += gbAng(path[i - 1], path[i]) * PLANET.R; return L; };
/* the grid cells a road covers, and which of them must not be crossed (bridges and roofed cuts) */
function markRoad(mark, road, normal) {
  for (const p of road.pts) {
    const c = gbCellD(p.d), v = p.bridge || p.tunnel ? 3 : normal;
    if (mark[c] < v) mark[c] = v;
    if (v === 3) for (let k = 0; k < 8; k++) { const b = GLOBE.nb[c * 8 + k]; if (mark[b] < 1) mark[b] = 1; }
  }
}
/* a new road meets the ones already built level where it crosses them; neither has walls or rails there */
function crossPins(P, step) {
  const pins = new Map(), hits = [];
  for (let k = 1; k < P.length - 1; k++) {
    const near = ridxNear(P[k], 7); if (!near) continue;
    pins.set(k, near.road.pts[near.i].h); hits.push(k, near);
  }
  return { pins, hits };
}
function openCrossings(road, hits, step) {
  const span = Math.ceil(22 / step);
  for (let m = 0; m < hits.length; m += 2) {
    const k = hits[m], near = hits[m + 1];
    for (let j = Math.max(0, k - span); j <= Math.min(road.pts.length - 1, k + span); j++) { road.pts[j].open = true; road.pts[j].tunnel = false; road.pts[j].cross = true; }
    const q = near.road.pts, sp = Math.ceil(22 / (near.road.highway || near.road.rail ? HW_STEP : ROAD_STEP));
    for (let j = Math.max(0, near.i - sp); j <= Math.min(q.length - 1, near.i + sp); j++) { q[j].open = true; q[j].tunnel = false; q[j].cross = true; }
  }
}
/* where a new road or railway crosses the ones already built: one entry per crossing, at its closest point */
function crossings(hits) {
  const out = [];
  for (let m = 0; m < hits.length; m += 2) {
    const k = hits[m], near = hits[m + 1], prev = out[out.length - 1];
    if (prev && prev.road === near.road && Math.abs(prev.i - near.i) < 6) { if (near.dist < prev.dist) Object.assign(prev, { k, i: near.i, dist: near.dist }); continue; }
    out.push({ k, road: near.road, i: near.i, dist: near.dist });
  }
  return out;
}
const bendSpan = (road, d) => { const step = road.rail || road.highway ? HW_STEP : ROAD_STEP; return Math.ceil(Math.max(40, Math.abs(d) / (road.rail ? 0.03 : 0.045)) / step); };
/* whether a road can rise or dip by d around point i without upsetting a crossing, bridge or cut there, or its ends,
   or dipping below the sea */
function canBend(road, i, d) {
  if (Math.abs(d) < 0.05) return true;
  const pts = road.pts, n = bendSpan(road, d);
  if (i - n < 2 || i + n > pts.length - 3) return false;
  for (let j = i - n; j <= i + n; j++) {
    const p = pts[j]; if (p.cross || p.bridge || p.tunnel) return false;
    // nor down into the sea
    if (p.h + d * (0.5 + 0.5 * Math.cos(Math.PI * Math.abs(j - i) / n)) < 1.2) return false;
  }
  return true;
}
/* ---------- how a new road or railway crosses one already built ----------
   level (the old road bends a little to meet it, or it was pinned to the old road's height), over the old road on a short
   bridge, or under it (the old road gets the bridge). Heights that fit none of these are pinned so that one does fit */
const SEP_OVER = 6.6, SEP_OVER_T = 9.2, SEP_UNDER = 8.8;
const pathHalf = road => road.rail ? 3.6 : ROAD_FLAT;
const pathStep = road => road.rail || road.highway ? HW_STEP : ROAD_STEP;
// the sine of the angle two paths cross at (never taken as less than 0.35: a very shallow crossing is not bridged
// any longer than that)
function crossSin(P, k, road, i) {
  const q = road.pts, t1 = towardD(P[Math.max(0, k - 1)], P[Math.min(P.length - 1, k + 1)]), t2 = towardD(q[Math.max(0, i - 1)].d, q[Math.min(q.length - 1, i + 1)].d);
  return Math.max(0.35, new V3().crossVectors(t1, t2).length());
}
function canBridge(road, i, n) {
  const q = road.pts; if (i - n < 2 || i + n > q.length - 3) return false;
  for (let j = i - n; j <= i + n; j++) if (q[j].tunnel || q[j].cross) return false;
  return true;
}
/* what each crossing c (from crossings()) does for a new path at heights h: a kind, or a height to pin the path to */
function crossKind(c, h, bmax) {
  const q = c.road.pts[c.i], d = h - q.h;
  if (Math.abs(d) < 0.3 && !q.bridge && !q.tunnel) return { kind: 'level' };
  if (!q.bridge && !q.tunnel && Math.abs(d) <= bmax && canBend(c.road, c.i, d)) return { kind: 'bend' };
  if (d >= (q.tunnel ? SEP_OVER_T : SEP_OVER)) return { kind: 'over' };
  if (d <= -SEP_UNDER && (q.bridge || canBridge(c.road, c.i, c.nOld))) return { kind: 'under' };
  // otherwise: up over it, down under it, or level with it, whichever is the smaller change and can be done
  const up = q.h + (q.tunnel ? SEP_OVER_T : SEP_OVER) + 0.4, down = q.h - SEP_UNDER - 0.4;
  const opts = [up];
  if (down >= 1.2 && (q.bridge || canBridge(c.road, c.i, c.nOld))) opts.push(down);
  if (!q.bridge && !q.tunnel) opts.push(q.h);
  opts.sort((a, b) => Math.abs(a - h) - Math.abs(b - h));
  return { pin: opts[0] };
}
/* the profile for a new path P with its crossings settled: returns the profile and each crossing's kind */
function settleCrossings(P, step, prof, basePins, cx, bmax, half) {
  for (const c of cx) { c.sin = crossSin(P, c.k, c.road, c.i); c.nOld = Math.ceil((half + 4) / c.sin / pathStep(c.road)); }
  let pins = basePins, pr = prof(pins);
  for (let pass = 0; ; pass++) {
    const add = [];
    for (const c of cx) { c.res = crossKind(c, pr.h[c.k], bmax); if (c.res.pin !== undefined && !(basePins && basePins.has(c.k))) add.push(c); }
    if (!add.length || pass === 2) break;
    pins = new Map(pins || []);
    for (const c of add) for (let j = Math.max(1, c.k - 1); j <= Math.min(P.length - 2, c.k + 1); j++) pins.set(j, c.res.pin);
    pr = prof(pins);
  }
  return pr;
}
/* carry out what was settled: pts are the new path's points (with h, bridge, tunnel), half its own half width */
function applyCrossings(pts, step, cx, half) {
  const mine = { pts };
  for (const c of cx) {
    const r = c.res || {}, q = c.road.pts;
    if (r.kind === 'over') {
      // a short bridge over the old road, with no pier standing on it
      const n = Math.ceil((pathHalf(c.road) + 4) / c.sin / step), np = Math.ceil((pathHalf(c.road) + 2) / c.sin / step);
      for (let j = Math.max(1, c.k - n); j <= Math.min(pts.length - 2, c.k + n); j++) { pts[j].bridge = true; pts[j].tunnel = false; if (Math.abs(j - c.k) <= np) pts[j].nopier = true; }
    } else if (r.kind === 'under') {
      // the old road gets the bridge; nothing roofs this one over beneath it
      const so = pathStep(c.road), n = c.nOld, np = Math.ceil((half + 2) / c.sin / so), hw = c.road.highway || c.road.rail;
      for (let j = c.i - n; j <= c.i + n; j++) { q[j].bridge = true; if (Math.abs(j - c.i) <= np) q[j].nopier = true; }
      for (let j = c.i - n - 1; j <= c.i + n; j++) { const a = q[j], b = q[j + 1]; if (a.seg) a.seg.bridge = hw ? a.bridge && b.bridge : a.bridge || b.bridge; }
      const m = Math.ceil((pathHalf(c.road) + 3) / c.sin / step);
      for (let j = Math.max(0, c.k - m); j <= Math.min(pts.length - 1, c.k + m); j++) pts[j].tunnel = false;
    } else {
      // level: the old road bends to meet it (only a little, unless nothing else would do), and neither has walls
      // or rails across the other
      bendRoad(c.road, c.i, pts[c.k].h);
      pts[c.k].tunnel = false;
      openCrossings(mine, [c.k, { road: c.road, i: c.i }], step);
    }
  }
}
/* a road (or railway) already laid rises or dips around point i to meet height h there, smoothly, and its ground follows */
function bendRoad(road, i, h) {
  const pts = road.pts, d = h - pts[i].h; if (Math.abs(d) < 0.05) return;
  const n = bendSpan(road, d);
  const j0 = Math.max(0, i - n), j1 = Math.min(pts.length - 1, i + n);
  for (let j = j0; j <= j1; j++) { const t = Math.min(1, Math.abs(j - i) / n); pts[j].h += d * (0.5 + 0.5 * Math.cos(Math.PI * t)); }
  for (let j = Math.max(0, j0 - 1); j <= j1; j++) { const p = pts[j]; if (p.seg && pts[j + 1]) { p.seg.h0 = p.h; p.seg.h1 = pts[j + 1].h; } }
}
function planHighways() {
  const R = PLANET.R, H = GLOBE.H, n = GLOBE.n;
  // what each cell is: inside a place (which), near the pad, near a road (1), on a highway (2), on a bridge or in a cut (3)
  const occ = GLOBE.occ = new Int16Array(n), mark = GLOBE.mark = new Uint8Array(n), d = new V3();
  const allSites = GLOBE.allSites = [...WP.sites, ...GLOBE.sites];
  for (let c = 0; c < n; c++) {
    gbV(c, d);
    if (arcM(d, WP.up) < 320) { occ[c] = -1; continue; }
    for (let k = 0; k < allSites.length; k++) if (inRect(allSites[k], d, 60)) { occ[c] = k + 1; break; }
  }
  for (const r of WP.roads) { markRoad(mark, r, 1); ridxAdd(r); }
  // nodes: every new place, plus the towns and the airport near the pad
  const nodes = GLOBE.sites.map(s => ({ site: s, ekind: s.kind, used: new Set() }));
  for (const s of WP.sites) if (s.name === 'town1' || s.name === 'town2' || s.name === 'airport') {
    const node = { site: s, ekind: s.name === 'airport' ? 'airport' : 'town', used: new Set(), local: true };
    // their entries already taken by the local roads
    if (s.entry) G_ENTRY[node.ekind].forEach((e, i) => { const l = Math.hypot(...e[0]) * Math.hypot(s.entry.u, s.entry.v); if ((e[0][0] * s.entry.u + e[0][1] * s.entry.v) / l > 0.95) node.used.add(i); });
    nodes.push(node);
  }
  const N = nodes.length, dist = (a, b) => arcM(nodes[a].site.C, nodes[b].site.C);
  // which places can reach each other at all (over land, or water shallow enough to bridge): no point searching otherwise
  const comp = new Int32Array(n).fill(-1), NB = GLOBE.nb;
  for (let c0 = 0, id = 0; c0 < n; c0++) {
    if (comp[c0] >= 0 || occ[c0] === -1 || H[c0] < -70) continue;
    const st = [c0]; comp[c0] = id;
    while (st.length) { const a = st.pop(); for (let k = 0; k < 8; k++) { const b = NB[a * 8 + k]; if (comp[b] < 0 && occ[b] !== -1 && H[b] >= -70) { comp[b] = id; st.push(b); } } }
    id++;
  }
  const reach = (a, b) => { const ca = comp[gbCellD(nodes[a].site.C)], cb = comp[gbCellD(nodes[b].site.C)]; return ca >= 0 && ca === cb; };
  const parent = nodes.map((_, i) => i), find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const route = (ia, ib, maxLen) => {
    const A = nodes[ia], B = nodes[ib], dd = dist(ia, ib);
    const ea = pickEntry(A, B), eb = pickEntry(B, A);
    const undo = () => { if (ea) A.used.delete(G_ENTRY[A.ekind].indexOf(ea)); if (eb) B.used.delete(G_ENTRY[B.ekind].indexOf(eb)); return false; };
    if (!ea || !eb) return undo();
    const IA = sDir(A.site, ...ea[1]), EA = sDir(A.site, ...ea[0]), EB = sDir(B.site, ...eb[0]), IB = sDir(B.site, ...eb[1]);
    const sa = allSites.indexOf(A.site) + 1, sb = allSites.indexOf(B.site) + 1;
    const cost = (a, b, len) => {
      const o = occ[b]; if (o === -1) return Infinity;
      const hb = H[b], sl = Math.abs(hb - H[a]) / len, m = mark[b];
      let c = len * (1 + (sl / 0.07) ** 2 * 2);
      if (m === 3) c *= 30;
      if (hb < 0.5) { if (hb < -70) return Infinity; c *= 5 + -hb * 0.2; }
      if (hb > 450) c *= 1.6;
      // through a place (even its own, past the way in) only if there is no other way
      if (o > 0) c *= 40;
      if (m === 1) c *= 4; else if (m === 2) c *= 3;
      return c;
    };
    const path = gbRoute(gbCellD(EA), gbCellD(EB), cost);
    // a road that would have to go the long way round is not worth building
    if (!path || pathLen(path) > (maxLen || dd * 2 + 2500)) return undo();
    // straight in from each place: the leads run 20 m on past the edge point before the route may turn
    const ext = (I, E) => E.clone().addScaledVector(towardD(I, E), 20 / PLANET.R).normalize();
    const pts = [IA, EA, ext(IA, EA), ...path.slice(1, -1).map(c => gbV(c)), ext(IB, EB), EB, IB];
    const leadA = arcM(IA, EA) + 19, leadB = arcM(IB, EB) + 19;
    const P = shapePath(pts, HW_STEP, leadA, leadB, 160, 70, allSites);
    // where it crosses a road already built: level (the old road bending a little to meet it), over or under it
    const { hits } = crossPins(P, HW_STEP), cx = crossings(hits), PO = { grade: 0.08, deck: 7, cut: 12, vr: 300 };
    const pr = settleCrossings(P, HW_STEP, pins => profileD(P, HW_STEP, { ...PO, pins }), null, cx, 5, ROAD_FLAT);
    const road = { name: `${A.site.label || A.site.name} – ${B.site.label || B.site.name}`, highway: true, pts: P.map((p, i) => ({ d: p, h: pr.h[i], bridge: pr.bridge[i], tunnel: pr.tunnel[i] })) };
    applyCrossings(road.pts, HW_STEP, cx, ROAD_FLAT);
    // the ground is shaped to every piece of road except the ones wholly on a bridge
    for (let i = 0; i < road.pts.length - 1; i++) { const a = road.pts[i], b = road.pts[i + 1]; a.seg = wsSeg(PLANET.ws, a.d, b.d, a.h, b.h, ROAD_FLAT, ROAD_BLEND, a.bridge && b.bridge); }
    markRoad(mark, road, 2); ridxAdd(road);
    GLOBE.roads.push(road);
    return true;
  };
  // join the places shortest first, skipping any pair already joined (Kruskal), then a few short cross links
  const pairs = [];
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { const dd = dist(i, j); if (dd < 15000) pairs.push([i, j, dd]); }
  pairs.sort((a, b) => a[2] - b[2]);
  const linked = new Set();
  // the places near the pad are joined already, by the roads out from it
  const loc = nodes.map((nd, i) => nd.local ? i : -1).filter(i => i >= 0);
  for (const i of loc) parent[find(i)] = find(loc[0]);
  for (const [i, j] of pairs) {
    if (find(i) === find(j) || !reach(i, j)) continue;
    if (route(i, j)) { parent[find(i)] = find(j); linked.add(i + ',' + j); }
  }
  let extra = 0;
  for (const [i, j, dd] of pairs) {
    if (extra >= 3 || dd > 9000 || linked.has(i + ',' + j) || !reach(i, j) || (nodes[i].local && nodes[j].local)) continue;
    if (route(i, j, dd * 1.5 + 1500)) { extra++; linked.add(i + ',' + j); }
  }
}
/* ---------- railways: lines of stations, each with one train running back and forth ---------- */
const RAIL_STEP = 8, PLAT_L = 130, PLAT_HALF = 70;
const RAIL_LINES = [
  { name: 'Northern Line', stops: ['spaceport', 'g_stonebridge', 'g_millbrook'], col: 0xc8432f },
  { name: 'Southern Line', stops: ['spaceport', 'g_pinecrest', 'g_windmill_farm'], col: 0x2f6f9f },
  { name: 'Metro Line', stops: ['g_grand_metro', 'g_sunfield_farm', 'g_oakley'], col: 0x2f8f86 }
];
/* tangent-plane direction from C toward D */
const towardD = (C, D) => { const t = new V3().subVectors(D, C); return t.addScaledVector(C, -t.dot(C)).normalize(); };
/* a flat, clear strip for a station: centre direction, along t, half length a, half width b */
function stationFit(C, t, a, b) {
  const e3 = new V3().crossVectors(t, C).normalize(), q = new V3();
  let mn = 1e9, mx = -1e9, sum = 0, n = 0, wet = false;
  for (let i = -4; i <= 4; i++) for (let j = -1; j <= 1; j++) { expDir(C, t, e3, PLANET.R, (a + 20) * i / 4, (b + 15) * j, q); const h = planetHeight(q.x, q.y, q.z); if (h < 2) wet = true; sum += h; n++; mn = Math.min(mn, h); mx = Math.max(mx, h); }
  const mean = sum / n;
  return { dev: wet ? 1e9 : Math.max(mx - mean, mean - mn), mean, e3 };
}
function planStations(lines) {
  const R = PLANET.R, stations = new Map();
  const siteBy = name => GLOBE.sites.find(s => s.name === name);
  // which lines stop at each place, and which way they go from it
  for (const L of lines) L.stops.forEach((k, i) => {
    let st = stations.get(k); if (!st) stations.set(k, st = { key: k, uses: [] });
    st.uses.push({ line: L, i, prev: L.stops[i - 1], next: L.stops[i + 1] });
  });
  const centre = k => k === 'spaceport' ? WP.up : siteBy(k).C;
  for (const st of stations.values()) {
    const C = centre(st.key);
    // the way through: from the previous stop toward the next; a terminus points out along its only line
    const t = new V3();
    for (const u of st.uses) {
      if (u.prev && u.next) t.add(towardD(C, centre(u.next))).sub(towardD(C, centre(u.prev)));
      else t.add(towardD(C, centre(u.next || u.prev)));
    }
    t.addScaledVector(C, -t.dot(C)).normalize();
    st.tracks = st.uses.length;
    const b = st.tracks > 1 ? 16 : 10;
    let best = null;
    if (st.key === 'spaceport') {
      // a clear patch near the pad, off the roads and away from the other sites
      const t1 = new V3(), t2 = new V3(); tangentBasis(C.x, C.y, C.z, t1, t2);
      for (let r = 560; r <= 1600; r += 80) for (let k = 0; k < 36; k++) {
        const D = expDir(C, t1, t2, R, Math.cos(k / 36 * TAU) * r, Math.sin(k / 36 * TAU) * r, new V3());
        if (WP.sites.some(s => inRect(s, D, 170)) || ridxNear(D, 60)) continue;
        // turn the station toward the first stop a little at most, so the platform sits on easy ground
        for (const turn of [0, -0.4, 0.4, -0.8, 0.8]) {
          const tt = towardD(D, centre(st.uses[0].next)).applyAxisAngle(D, turn);
          const f = stationFit(D, tt, PLAT_L + 40, b);
          const sc = f.dev + r * 0.01 + Math.abs(turn) * 4;
          if (!best || sc < best.sc) best = { sc, C: D, t: tt, f };
        }
      }
    } else {
      const s = siteBy(st.key);
      for (const sd of [-1, 1]) for (const turn of [0, -0.3, 0.3, -0.6, 0.6]) for (const extra of [0, 60, 140]) {
        const tt = t.clone().applyAxisAngle(C, turn), n = new V3().crossVectors(tt, C).normalize().multiplyScalar(sd);
        const sup = s.a * Math.abs(n.dot(s.E1)) + s.b * Math.abs(n.dot(s.E3)) + 50 + b + extra;
        const D = C.clone().addScaledVector(n, sup / R).normalize();
        // the strip must not cut a corner of the place, nor sit on a road
        let clash = false; const e3 = new V3().crossVectors(tt, D).normalize();
        for (let u = -PLAT_L - 40; u <= PLAT_L + 40; u += 16) for (const v of [-b - 4, 0, b + 4]) { const q = expDir(D, tt, e3, R, u, v, new V3()); if (inRect(s, q, 25) || ridxNear(q, 14)) clash = true; }
        if (clash) continue;
        const f = stationFit(D, tt, PLAT_L + 40, b), sc = f.dev + Math.abs(turn) * 6 + extra * 0.05;
        if (!best || sc < best.sc) best = { sc, C: D, t: tt, f };
      }
    }
    if (!best || best.f.dev > 40) { stations.delete(st.key); continue; }
    st.C = best.C; st.E1 = best.t; st.E3 = new V3().crossVectors(best.t, best.C).normalize(); st.h = Math.max(3, best.f.mean); st.b = b;
    st.label = st.key === 'spaceport' ? 'Spaceport Station' : siteBy(st.key).label + ' Station';
    st.name = 'st_' + st.key;
    st.a = PLAT_L + 30;
    st.zone = wsZone(PLANET.ws, st.C, st.E1, st.E3, st.a, b + 6, st.h, 35, [0.5, 0.48, 0.44]);
    // each line has its own track: side by side, an island platform between them
    st.uses.forEach((u, k) => { u.off = st.tracks > 1 ? (k ? 5.5 : -5.5) : 0; });
  }
  return stations;
}
function planRails() {
  const R = PLANET.R, H = GLOBE.H, occ = GLOBE.occ, mark = GLOBE.mark;
  const lines = RAIL_LINES.map(L => ({ ...L, stops: L.stops.filter(k => k === 'spaceport' || GLOBE.sites.some(s => s.name === k)) })).filter(L => L.stops.length > 1);
  const stations = planStations(lines);
  GLOBE.stations = [...stations.values()];
  // stations are places too: nothing else crosses them
  const stIdx = new Map(); let base = GLOBE.allSites.length + 1;
  for (const st of stations.values()) { const id = base++; stIdx.set(st, id); const d = new V3(); for (let c = 0; c < GLOBE.n; c++) if (!occ[c]) { gbV(c, d); if (inRect(st, d, 20)) occ[c] = id; } }
  const own = (st) => { const ids = [stIdx.get(st)]; const s = GLOBE.sites.find(x => x.name === st.key); if (s) ids.push(GLOBE.allSites.indexOf(s) + 1); return ids; };
  for (const L0 of lines) {
    const L = { name: L0.name, col: L0.col, stops: [], pts: [] };
    const sts = L0.stops.map(k => stations.get(k)).filter(Boolean);
    if (sts.length < 2) continue;
    const use = st => st.uses.find(u => u.line.name === L0.name);
    // a point on a station's own track, u metres along it
    const tp = (st, u) => expDir(st.C, st.E1, st.E3, R, u, use(st).off, new V3());
    // which way along each station the line runs (+1: the way it was laid out)
    const sgn = sts.map((st, i) => { const o = sts[i + 1] || sts[i - 1], dir = towardD(st.C, o.C).dot(st.E1) > 0 ? 1 : -1; return i + 1 < sts.length ? dir : -dir; });
    let all = [];
    for (let i = 0; i < sts.length - 1; i++) {
      const A = sts[i], B = sts[i + 1], sa = sgn[i], sb = sgn[i + 1];
      const EA = tp(A, sa * (PLAT_L + 60)), EB = tp(B, -sb * (PLAT_L + 60));
      const okA = own(A), okB = own(B);
      // the line leaves each station straight ahead: near it, cells off to the sides or behind are out of bounds
      const cones = [{ C: tp(A, 0), dir: A.E1.clone().multiplyScalar(sa) }, { C: tp(B, 0), dir: B.E1.clone().multiplyScalar(-sb) }];
      const offCone = c => {
        for (const k of cones) {
          const dx = GLOBE.dir[c * 3] - k.C.x, dy = GLOBE.dir[c * 3 + 1] - k.C.y, dz = GLOBE.dir[c * 3 + 2] - k.C.z, l = Math.hypot(dx, dy, dz);
          if (l * R < 520 && (dx * k.dir.x + dy * k.dir.y + dz * k.dir.z) < l * Math.cos(0.6)) return true;
        }
        return false;
      };
      let coneOn = true;
      const cost = (a, b, len) => {
        const o = occ[b]; if (o === -1) return Infinity;
        if (coneOn && offCone(b)) return Infinity;
        if (o > 0 && !okA.includes(o) && !okB.includes(o)) return Infinity;
        const hb = H[b], sl = Math.abs(hb - H[a]) / len, m = mark[b];
        let c = len * (1 + (sl / 0.05) ** 2 * 1.5);
        if (hb < 0.5) { if (hb < -40) return Infinity; c *= 6 + -hb * 0.25; }
        if (hb > 450) c *= 1.5;
        if (m === 1 || m === 2) c *= 8; else if (m === 3) c *= 30; else if (m === 4) c *= 6;
        if (o > 0) c *= 3;
        return c;
      };
      let path = gbRoute(gbCellD(EA), gbCellD(EB), cost);
      if (!path) { coneOn = false; path = gbRoute(gbCellD(EA), gbCellD(EB), cost); }
      if (!path) { console.warn('no railway', A.label, B.label); continue; }
      const pts = [tp(A, 0), tp(A, sa * PLAT_L), EA, ...path.slice(1, -1).map(c => gbV(c)), EB, tp(B, -sb * PLAT_L), tp(B, 0)];
      const P = shapePath(pts, RAIL_STEP, PLAT_L + 15, PLAT_L + 15, 260, 220, null, 2, 2, 22);
      // level through the stations; level with any road it crosses
      const { hits } = crossPins(P, RAIL_STEP), pins = new Map();
      const n = P.length;
      // where it crosses another railway it meets it level (the gentle rounding below eases it in)
      for (let m = 0; m < hits.length; m += 2) if (hits[m + 1].road.rail) pins.set(hits[m], hits[m + 1].road.pts[hits[m + 1].i].h);
      for (let k = 0; k < n; k++) { if (k * RAIL_STEP <= PLAT_L + 25) pins.set(k, A.h); if ((n - 1 - k) * RAIL_STEP <= PLAT_L + 25) pins.set(k, B.h); }
      const PO = { grade: 0.05, deck: 8, cut: 12, fill: 12, hA: A.h, hB: B.h, vr: 1500 };
      // roads it crosses: level (the road bending a little to meet it), over them on a bridge, or under them
      const cx = crossings(hits).filter(c => !c.road.rail);
      const pr = settleCrossings(P, RAIL_STEP, pp => profileD(P, RAIL_STEP, { ...PO, pins: pp }), pins, cx, 4, 3.6);
      const seg = P.map((p, k) => ({ d: p, h: pr.h[k], bridge: pr.bridge[k], tunnel: pr.tunnel[k] }));
      applyCrossings(seg, RAIL_STEP, cx, 3.6);
      // where it crosses another railway the two meet level
      for (const c of crossings(hits).filter(c => c.road.rail)) { seg[c.k].tunnel = false; openCrossings({ rail: true, pts: seg }, [c.k, { road: c.road, i: c.i }], RAIL_STEP); }
      if (!all.length) all = seg; else all = all.concat(seg.slice(1));
    }
    if (all.length < 10) continue;
    // buffer stops: the track runs on a little past each end's platform
    const first = sts[0], last = sts[sts.length - 1];
    const stub = (st, sg) => { const out = []; for (let u = 8; u <= PLAT_L - 20; u += RAIL_STEP) out.push({ d: tp(st, -sg * u), h: st.h, bridge: false, tunnel: false }); return out; };
    all = [...stub(first, sgn[0]).reverse(), ...all, ...stub(last, -sgn[sts.length - 1])];
    L.pts = all;
    L.stations = sts;
    for (let i = 0; i < all.length - 1; i++) { const a = all[i], b = all[i + 1]; a.seg = wsSeg(PLANET.ws, a.d, b.d, a.h, b.h, 3.6, 10, a.bridge && b.bridge, RAIL_COL); a.seg.rail = L; a.seg.ri = i; }
    markRoad(mark, L, 4); ridxAdd(L);
    L.rail = true;
    GLOBE.rails.push(L);
  }
}
const RAIL_COL = [0.42, 0.38, 0.34];
/* ---------- the highest peak and the deepest sea floor ---------- */
function planLandmarks() {
  const H = GLOBE.H, n = GLOBE.n, NB = GLOBE.nb;
  // the grid's own peaks and pits, the 30 most extreme of each, each refined: the true extremes may sit between cells
  const ext = sgn => { const L = []; for (let c = 0; c < n; c++) { let ok = true; for (let k = 0; k < 8; k++) if (H[NB[c * 8 + k]] * sgn > H[c] * sgn) { ok = false; break; } if (ok) L.push(c); } return L.sort((a, b) => (H[b] - H[a]) * sgn).slice(0, 30); };
  // refine on a finer grid round each
  const refine = (c, sgn) => {
    let best = gbV(c), bh = planetHeight(best.x, best.y, best.z) * sgn;
    for (let step = 60; step >= 4; step /= 2) for (let it = 0; it < 6; it++) {
      const t1 = new V3(), t2 = new V3(); tangentBasis(best.x, best.y, best.z, t1, t2); let moved = false;
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { const q = expDir(best, t1, t2, PLANET.R, i * step, j * step, new V3()), h = planetHeight(q.x, q.y, q.z) * sgn; if (h > bh) { bh = h; best = q; moved = true; } }
      if (!moved) break;
    }
    return { C: best, h: bh * sgn };
  };
  const pick = sgn => ext(sgn).map(c => refine(c, sgn)).sort((a, b) => (b.h - a.h) * sgn)[0];
  const top = pick(1), deep = pick(-1);
  // the ground is solid all the way up: nothing above maxH is checked against it
  PLANET.maxH = Math.max(PLANET.maxH, top.h + 40);
  const mk = (m, a, h, surf) => {
    const t1 = new V3(), t2 = new V3(); tangentBasis(m.C.x, m.C.y, m.C.z, t1, t2);
    m.E1 = t1; m.E3 = new V3().crossVectors(t1, m.C).normalize(); m.a = m.b = a; m.peak = m.h; m.h = h;
    m.zone = wsZone(PLANET.ws, m.C, m.E1, m.E3, a, a, h, 30, surf);
    return m;
  };
  GLOBE.marks.summit = mk(top, 34, top.h - 4, [0.6, 0.6, 0.6]);
  GLOBE.marks.deep = mk(deep, 48, deep.h + 2, [0.32, 0.36, 0.38]);
}
function planGlobe() {
  const t0 = performance.now();
  globeGrid();
  const t1 = performance.now();
  planSettlements();
  const t2 = performance.now();
  planHighways();
  const t3 = performance.now();
  planRails();
  const t4 = performance.now();
  planLandmarks();
  console.log(`globe planned: grid ${(t1 - t0).toFixed(0)} ms (${GLOBE.n} cells), places ${(t2 - t1).toFixed(0)} ms (${GLOBE.sites.map(s => s.label + ' dev ' + s.dev.toFixed(0)).join(', ')}), highways ${(t3 - t2).toFixed(0)} ms (${GLOBE.roads.length} roads, ${(GLOBE.roads.reduce((s, r) => s + r.pts.length, 0) * HW_STEP / 1000).toFixed(1)} km), railways ${(t4 - t3).toFixed(0)} ms (${GLOBE.rails.map(r => r.name + ' ' + (r.pts.length * RAIL_STEP / 1000).toFixed(1) + ' km').join(', ')}; stations ${GLOBE.stations.map(s => s.label).join(', ')}; tunnels ${GLOBE.rails.map(r => r.pts.filter(p => p.tunnel).length * RAIL_STEP).join('/')} m, bridges ${GLOBE.rails.map(r => r.pts.filter(p => p.bridge).length * RAIL_STEP).join('/')} m), summit ${GLOBE.marks.summit.peak.toFixed(0)} m, deep ${GLOBE.marks.deep.peak.toFixed(0)} m`);
}

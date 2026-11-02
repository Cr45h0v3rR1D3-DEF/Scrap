'use strict';
/* ================= Scrapline · the built world: where things go =================
   Around the launch pad the planner lays out two towns, an airport, a race and stunt park and a harbor,
   flattens the ground under each, and routes roads between them over the hills (bridges over water,
   covered cuts through ridges). It all comes from the same seeded terrain, so it is the same every visit. */
const WP = { up: null, X: null, Z: null, half: 3600, cell: 40, n: 0, H: null, sites: [], roads: [], spawns: {} };
/* the tangent map around the pad: x along the pad's right, z toward the sea, both in metres along the ground */
function expDir(C, E1, E3, R, x, z, out) {
  const r = Math.hypot(x, z);
  if (r < 1e-9) return out.copy(C);
  const s = Math.sin(r / R) / r, c = Math.cos(r / R);
  return out.set(C.x * c + (E1.x * x + E3.x * z) * s, C.y * c + (E1.y * x + E3.y * z) * s, C.z * c + (E1.z * x + E3.z * z) * s).normalize();
}
const wpDir = (x, z, out = new V3()) => expDir(WP.up, WP.X, WP.Z, PLANET.R, x, z, out);
function wpMap(d) { const a = Math.acos(clamp(d.dot(WP.up), -1, 1)) * PLANET.R, px = d.dot(WP.X), pz = d.dot(WP.Z), l = Math.hypot(px, pz) || 1; return [px / l * a, pz / l * a]; }
/* height grid (with the pad flattened, before any site) */
function wpH(x, z) {
  const n = WP.n, c = WP.cell, fi = (x + WP.half) / c, fj = (z + WP.half) / c;
  const i = clamp(Math.floor(fi), 0, n - 2), j = clamp(Math.floor(fj), 0, n - 2), tx = clamp(fi - i, 0, 1), tz = clamp(fj - j, 0, 1), H = WP.H;
  return lerp(lerp(H[j * n + i], H[j * n + i + 1], tx), lerp(H[(j + 1) * n + i], H[(j + 1) * n + i + 1], tx), tz);
}
/* a rectangle on the map: how flat and dry it is */
function rectFit(cx, cz, ang, a, b) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  let sum = 0, n = 0, mn = 1e9, mx = -1e9;
  for (let i = -3; i <= 3; i++) for (let j = -2; j <= 2; j++) {
    const u = a * i / 3, v = b * j / 2, x = cx + u * ca - v * sa, z = cz + u * sa + v * ca;
    const h = wpH(x, z); sum += h; n++; if (h < mn) mn = h; if (h > mx) mx = h;
  }
  const mean = sum / n;
  return { mean, dev: Math.max(mx - mean, mean - mn), mn, mx };
}
function siteClear(cx, cz, rad) {
  if (Math.hypot(cx, cz) < rad + 230) return false;
  for (const s of WP.sites) if (Math.hypot(cx - s.x, cz - s.z) < rad + s.rad + 70) return false;
  return true;
}
function bestRect(name, a, b, dmin, dmax, angs, prefD) {
  let best = null, bs = -1e9;
  const rad = Math.hypot(a, b);
  for (let x = -WP.half + rad; x <= WP.half - rad; x += 60) for (let z = -WP.half + rad; z <= WP.half - rad; z += 60) {
    const d = Math.hypot(x, z); if (d < dmin || d > dmax) continue;
    if (!siteClear(x, z, rad)) continue;
    for (const ang of angs) {
      const f = rectFit(x, z, ang, a + 30, b + 30);
      if (f.mn < 2.5 || f.mean > 260) continue;
      const sc = -f.dev - Math.abs(d - prefD) * 0.01 - Math.max(0, f.mean - 120) * 0.05;
      if (sc > bs) { bs = sc; best = { name, x, z, ang, a, b, h: Math.max(4, f.mean), dev: f.dev, rad }; }
    }
  }
  return best;
}
/* the harbor sits where the land meets the sea: dry ground on one side, water on the other */
function bestHarbor() {
  let best = null, bs = -1e9;
  for (let x = -WP.half + 300; x <= WP.half - 300; x += 40) for (let z = -WP.half + 300; z <= WP.half - 300; z += 40) {
    const d = Math.hypot(x, z); if (d < 260 || d > 2600) continue;
    const h0 = wpH(x, z); if (h0 < 0.5 || h0 > 9) continue;
    for (let k = 0; k < 16; k++) {
      const ang = k * TAU / 16, sx = Math.cos(ang), sz = Math.sin(ang);      // seaward
      let wet = 0, dry = 0, deep = 0;
      for (let t = 40; t <= 180; t += 35) { const h = wpH(x + sx * t, z + sz * t); if (h < -2) wet++; if (h < -8) deep++; }
      for (let t = -100; t <= -10; t += 30) for (const s of [-90, 0, 90]) { const h = wpH(x + sx * t - sz * s, z + sz * t + sx * s); if (h > 0.8 && h < 30) dry++; }
      if (wet < 4 || dry < 10) continue;
      if (!siteClear(x - sx * 50, z - sz * 50, 150)) continue;
      const sc = wet * 2 + deep + dry - d * 0.004;
      if (sc > bs) { bs = sc; best = { name: 'harbor', x, z, sea: ang, rad: 150 }; }
    }
  }
  return best;
}
/* ---------- roads: cheapest path over the height grid, then smoothed and given a gentle profile ---------- */
function roadPath(start, goals, avoid) {
  const n = WP.n, c = WP.cell, N = n * n, H = WP.H;
  const g = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const heap = [], push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  g[start] = 0; push(0, start);
  const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (heap.length) {
    const [, a] = pop(); if (done[a]) continue; done[a] = 1;
    if (goals.has(a)) { const path = []; for (let k = a; k >= 0; k = from[k]) path.push(k); path.reverse(); path.cost = g[a]; return path; }
    const ai = a % n, aj = (a / n) | 0, ha = H[a];
    for (const [di, dj] of D8) {
      const bi = ai + di, bj = aj + dj; if (bi < 1 || bj < 1 || bi >= n - 1 || bj >= n - 1) continue;
      const b = bj * n + bi; if (done[b]) continue;
      const hb = H[b], len = c * (di && dj ? 1.414 : 1), sl = Math.abs(hb - ha) / len;
      let cost = len * (1 + (sl / 0.07) ** 2 * 2);
      if (hb < 0.5) cost *= hb < -25 ? 14 : 5;
      if (hb > 320) cost *= 2;
      cost *= avoid(bi, bj);
      if (cost === Infinity) continue;
      const ng = g[a] + cost;
      if (ng < g[b]) { g[b] = ng; from[b] = a; push(ng, b); }
    }
  }
  return null;
}
const cellXZ = k => [(k % WP.n) * WP.cell - WP.half, ((k / WP.n) | 0) * WP.cell - WP.half];
const xzCell = (x, z) => clamp(Math.round((z + WP.half) / WP.cell), 1, WP.n - 2) * WP.n + clamp(Math.round((x + WP.half) / WP.cell), 1, WP.n - 2);
function simplify(P, tol) {
  if (P.length < 3) return P;
  let md = 0, mi = 0; const [a, b] = [P[0], P[P.length - 1]], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
  for (let i = 1; i < P.length - 1; i++) { const d = Math.abs((P[i][0] - a[0]) * dz - (P[i][1] - a[1]) * dx) / L; if (d > md) { md = d; mi = i; } }
  if (md < tol) return [a, b];
  return [...simplify(P.slice(0, mi + 1), tol).slice(0, -1), ...simplify(P.slice(mi), tol)];
}
function chaikin(P, it) {
  for (let k = 0; k < it; k++) {
    const Q = [P[0]];
    for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1]; Q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
    Q.push(P[P.length - 1]); P = Q;
  }
  return P;
}
function resample(P, step) {
  const out = [P[0]]; let carry = 0;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = step - carry;
    while (t <= L) { out.push([a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L]); t += step; }
    carry = L - (t - step);
  }
  const last = P[P.length - 1], pl = out[out.length - 1];
  if (Math.hypot(last[0] - pl[0], last[1] - pl[1]) > step * 0.4) out.push(last); else out[out.length - 1] = last;
  return out;
}
const ROAD_W = 5, ROAD_FLAT = 6.5, ROAD_BLEND = 14, ROAD_STEP = 6;
/* round off every change of grade (crests and dips) so nothing is thrown in the air going over them: the rise per step
   may change only a little from one step to the next (a vertical curve of radius vr); each free run between fixed
   points then gets what it is short of spread over it as a gentle bump, so it still arrives where it must */
function roundCrests(h, fix, step, vr) {
  const n = h.length, c = step * step / vr, g = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) g[i] = h[i + 1] - h[i];
  const held = i => fix[i] && fix[i + 1];
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < n - 1; i++) if (!held(i)) g[i] = clamp(g[i], g[i - 1] - c, g[i - 1] + c);
    for (let i = n - 3; i >= 0; i--) if (!held(i)) g[i] = clamp(g[i], g[i + 1] - c, g[i + 1] + c);
  }
  let i0 = 0;
  while (i0 < n - 1) {
    let i1 = i0 + 1; while (i1 < n - 1 && !fix[i1]) i1++;
    const m = i1 - i0;
    if (m > 1) {
      let sum = 0; for (let k = i0; k < i1; k++) sum += g[k];
      const res = h[i1] - h[i0] - sum; let ws = 0; for (let k = 0; k < m; k++) ws += Math.sin(Math.PI * (k + 0.5) / m);
      let y = h[i0];
      for (let k = i0; k < i1 - 1; k++) { y += g[k] + res * Math.sin(Math.PI * (k - i0 + 0.5) / m) / ws; h[k + 1] = y; }
    }
    i0 = i1;
  }
}
/* the height profile: smooth, at most a 9% grade, bridges where it crosses water, roofed cuts through ridges */
function roadProfile(P) {
  const n = P.length, d = new V3();
  const hp = P.map(p => PLANET.heightL(...wpDir(p[0], p[1], d).toArray()));
  const ground = hp.slice(), water = hp.map(h => h < 0.6);
  let h = hp.map((v, i) => water[i] ? 0 : v);
  const fixedA = h[0], fixedB = h[n - 1];
  for (let it = 0; it < 40; it++) {
    const q = h.slice();
    for (let i = 1; i < n - 1; i++) q[i] = water[i] ? h[i] : (h[i - 1] + 2 * h[i] + h[i + 1]) / 4;
    h = q; h[0] = fixedA; h[n - 1] = fixedB;
  }
  // bridge decks: at least 6 m over the sea, joining the land on each side
  for (let i = 0; i < n; i++) {
    if (!water[i]) continue;
    let j = i; while (j < n && water[j]) j++;
    const a = i > 0 ? h[i - 1] : 6, b = j < n ? h[j] : a;
    for (let k = i; k < j; k++) { const t = (k - i + 1) / (j - i + 1); h[k] = Math.max(6, lerp(a, b, t)); }
    i = j;
  }
  // gentle grades both ways
  // the ends stay exactly where they meet a site or another road
  const gmax = Math.max(0.09 * ROAD_STEP, Math.abs(fixedB - fixedA) / (n - 1) * 1.05);
  h[0] = fixedA; h[n - 1] = fixedB;
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 1; i < n - 1; i++) h[i] = clamp(h[i], h[i - 1] - gmax, h[i - 1] + gmax);
    for (let i = n - 2; i >= 1; i--) h[i] = clamp(h[i], h[i + 1] - gmax, h[i + 1] + gmax);
  }
  for (let i = 1; i < n - 1; i++) if (!water[i]) h[i] = Math.max(h[i], 1.2);
  // crests and dips rounded off (bridge decks and the ends held), never down into the sea
  const fix = new Uint8Array(n); fix[0] = fix[n - 1] = 1; for (let i = 0; i < n; i++) if (water[i]) fix[i] = 1;
  for (let it = 0; it < 3; it++) {
    roundCrests(h, fix, ROAD_STEP, 160);
    let low = false;
    for (let i = 1; i < n - 1; i++) if (!fix[i] && h[i] < 1.2) { h[i] = 1.2; fix[i] = 1; low = true; }
    if (!low) break;
  }
  // deep cuts get a roof: a tunnel through the ridge, where the road is not bending hard
  const turn = P.map((p, i) => { if (i < 2 || i > n - 3) return 0; const a = P[i - 2], b = P[i + 2]; return Math.abs(Math.atan2((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]), (p[0] - a[0]) * (b[0] - p[0]) + (p[1] - a[1]) * (b[1] - p[1]))); });
  const tunnel = ground.map((g, i) => !water[i] && g - h[i] > 9 && turn[i] < 0.9);
  // close short gaps between two tunnels, then drop stubs too short to be worth a roof
  for (let i = 1; i < n; i++) if (!tunnel[i] && tunnel[i - 1]) { let j = i; while (j < n && !tunnel[j]) j++; if (j < n && j - i <= 6) for (let k = i; k < j; k++) if (!water[k] && ground[k] - h[k] > 4) tunnel[k] = true; i = j; }
  for (let i = 0; i < n; i++) if (tunnel[i]) { let j = i; while (j < n && tunnel[j]) j++; if (j - i < 6) for (let k = i; k < j; k++) tunnel[k] = false; i = j; }
  return { h, water, tunnel, ground };
}
/* smooth a road into sweeping bends: the straight leads at each end (leadA, leadB metres) stay put */
function smoothRoad(P, leadA, leadB, it) {
  const n = P.length, d = [0];
  for (let i = 1; i < n; i++) d.push(d[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const L = d[n - 1], free = d.map(v => v > leadA + 1 && v < L - leadB - 1);
  for (let k = 0; k < it; k++) {
    const Q = P.map(p => p.slice());
    for (let i = 1; i < n - 1; i++) if (free[i]) { Q[i][0] = (P[i - 1][0] + 2 * P[i][0] + P[i + 1][0]) / 4; Q[i][1] = (P[i - 1][1] + 2 * P[i][1] + P[i + 1][1]) / 4; }
    P = Q;
  }
  return P;
}
/* then ease any bend still tighter than about 45 m, a little at a time, until none is left (a hairpin gets cut off) */
function easeBends(P, leadA, leadB) {
  for (let pass = 0; pass < 40; pass++) {
    P = resample(P, ROAD_STEP);
    const n = P.length; if (n < 7) return P;
    const L = (n - 1) * ROAD_STEP, mark = new Uint8Array(n); let any = false;
    for (let i = 2; i < n - 2; i++) {
      const a = P[i - 2], p = P[i], b = P[i + 2];
      const ang = Math.abs(Math.atan2((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]), (p[0] - a[0]) * (b[0] - p[0]) + (p[1] - a[1]) * (b[1] - p[1])));
      if (ang * 45 > 4 * ROAD_STEP) { any = true; for (let k = Math.max(1, i - 6); k <= Math.min(n - 2, i + 6); k++) { const d = k * ROAD_STEP; if (d > leadA && d < L - leadB) mark[k] = 1; } }
    }
    if (!any) break;
    for (let it = 0; it < 12; it++) { const Q = P.map(p => p.slice()); for (let i = 1; i < n - 1; i++) if (mark[i]) { Q[i][0] = (P[i - 1][0] + 2 * P[i][0] + P[i + 1][0]) / 4; Q[i][1] = (P[i - 1][1] + 2 * P[i][1] + P[i + 1][1]) / 4; } P = Q; }
  }
  return resample(P, ROAD_STEP);
}
function addRoad(path, name, leadA = 0, leadB = 0) {
  let P = simplify(path, 14);
  P = resample(P, ROAD_STEP);
  P = smoothRoad(P, leadA, leadB, 160);
  P = easeBends(P, leadA, leadB);
  if (P.length < 3) return null;
  const prof = roadProfile(P), d0 = new V3(), d1 = new V3(), ws = PLANET.ws;
  const pts = P.map((p, i) => ({ x: p[0], z: p[1], d: wpDir(p[0], p[1], new V3()), h: prof.h[i], bridge: prof.water[i], tunnel: prof.tunnel[i] }));
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    a.seg = wsSeg(ws, a.d, b.d, a.h, b.h, ROAD_FLAT, ROAD_BLEND, a.bridge || b.bridge);
  }
  const road = { name, pts };
  WP.roads.push(road);
  return road;
}
/* ---------- the plan ---------- */
function planWorld() {
  const t0 = performance.now();
  WP.up = WORLD.padUp.clone(); WP.X = WORLD.padRight.clone(); WP.Z = WORLD.padFwd.clone();
  const n = WP.n = Math.round(2 * WP.half / WP.cell) + 1, H = WP.H = new Float32Array(n * n), d = new V3();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { wpDir(i * WP.cell - WP.half, j * WP.cell - WP.half, d); H[j * n + i] = planetHeight(d.x, d.y, d.z); }
  const ws = PLANET.ws = makeWS(PLANET, 64);
  const quarter = [0, Math.PI / 6, Math.PI / 3], full = [];
  for (let k = 0; k < 12; k++) full.push(k * Math.PI / 12);
  const airport = bestRect('airport', 560, 110, 900, 3300, full, 1800); if (airport) WP.sites.push(airport);
  const race = bestRect('race', 240, 170, 600, 2800, full.filter((_, k) => k % 2 === 0), 1300); if (race) WP.sites.push(race);
  const town1 = bestRect('town1', 130, 130, 450, 1900, quarter, 900); if (town1) WP.sites.push(town1);
  const town2 = bestRect('town2', 130, 130, 900, 3300, quarter, 2200); if (town2) WP.sites.push(town2);
  const harbor = bestHarbor(); if (harbor) WP.sites.push(harbor);
  // flatten each site; surfaces: grass for towns and the airfield, packed dirt for the race park, concrete at the harbor
  const SURF = { airport: [0.42, 0.56, 0.3], race: [0.55, 0.47, 0.34], town1: [0.4, 0.55, 0.3], town2: [0.4, 0.55, 0.3] };
  for (const s of WP.sites) {
    if (s.name === 'harbor') {
      const sx = Math.cos(s.sea), sz = Math.sin(s.sea);
      s.ang = s.sea + Math.PI / 2; s.a = 110; s.b = 48; s.h = 3;
      s.cx = s.x - sx * 50; s.cz = s.z - sz * 50;
    } else { s.cx = s.x; s.cz = s.z; }
    const C = wpDir(s.cx, s.cz, new V3()), ca = Math.cos(s.ang), sa = Math.sin(s.ang);
    // directions on the ground at the site centre
    // (the same handedness as the pad's own frame: along x, up, then z = x × up)
    const e1 = wpDir(s.cx + ca, s.cz + sa, new V3()).sub(C).normalize(), e3 = new V3().crossVectors(e1, C).normalize();
    s.C = C; s.E1 = e1; s.E3 = e3;
    s.zone = wsZone(ws, C, e1, e3, s.a, s.b, s.h, s.name === 'harbor' ? 22 : 45, s.name === 'harbor' ? [0.6, 0.6, 0.58] : SURF[s.name]);
  }
  ws.on = true;
  // roads: a tree from the pad, each new site joining the nearest road already built
  const inSite = (x, z, s, m) => { const dx = x - s.cx, dz = z - s.cz, ca = Math.cos(s.ang), sa = Math.sin(s.ang); return Math.abs(dx * ca + dz * sa) < s.a + m && Math.abs(-dx * sa + dz * ca) < s.b + m; };
  // the pad's road leaves its flat ground on the side away from the sea, between the assembly building and the fuel farm;
  // nothing else may cross the space port, other sites are off limits, and a road leaves its own site straight away
  const padExit = [0, -175];
  const avoidFor = (own, hard) => (i, j) => {
    const x = i * WP.cell - WP.half, z = j * WP.cell - WP.half;
    if (Math.hypot(x, z) < 205 && !(Math.abs(x) < 30 && z < -90)) return Infinity;
    for (const s of WP.sites) if (inSite(x, z, s, 20)) return s === own ? 40 : hard ? Infinity : 40;
    return 1;
  };
  // each site's ways in, in its own (u, v): a point just outside it, then where the road ends inside
  const ENTRY = {
    airport: [[[-15, 155], [-15, 70]], [[-620, 45], [-290, 45]], [[620, 85], [165, 85]]],   // between the hangars and the terminal, or along either end of the apron
    race: [[[70, -215], [70, -115]], [[-70, -215], [-70, -115]], [[0, 215], [0, 115]]],       // beside the pits, or behind the far straight
    town: [[[0, 175], [0, 136]], [[0, -175], [0, -136]], [[175, 0], [136, 0]], [[-175, 0], [-136, 0]]],   // onto a main street
    harbor: [[[-21, 92], [-21, -12]], [[-155, -24], [-96, -24]]]                                // between the warehouses to the quay, or to the boat ramp
  };
  const net = new Set();
  const order = WP.sites.slice().sort((a, b) => Math.hypot(a.cx, a.cz) - Math.hypot(b.cx, b.cz));
  for (const s of order) {
    const ca = Math.cos(s.ang), sa = Math.sin(s.ang), toMap = ([u, v]) => [s.cx + u * ca - v * sa, s.cz + u * sa + v * ca];
    const goals = net.size ? new Set(net) : new Set([xzCell(...padExit)]);
    let best = null;
    for (const [edge, inner] of ENTRY[s.name.replace(/\d$/, '')] || []) {
      // the road leaves the site square to its edge; a way in that would have to double straight back costs more
      const E = toMap(edge), I = toMap(inner), l = Math.hypot(E[0] - I[0], E[1] - I[1]);
      const path = roadPath(xzCell(...E), goals, avoidFor(s, true)) || roadPath(xzCell(...E), goals, avoidFor(s, false));
      if (!path) continue;
      const far = cellXZ(path[Math.min(path.length - 1, 3)]), fx = far[0] - E[0], fz = far[1] - E[1], fl = Math.hypot(fx, fz) || 1;
      const back = ((E[0] - I[0]) * fx + (E[1] - I[1]) * fz) / l / fl;
      const cost = path.cost + l + (back < 0.5 ? 3000 * (0.5 - back) : 0);
      if (!best || cost < best.cost) best = { cost, path, E, I, edge };
    }
    if (!best) continue;
    s.entry = { u: best.edge[0], v: best.edge[1] };
    let pts = [best.I, best.E, ...best.path.slice(1).map(cellXZ)], leadB = 0;
    const leadA = Math.hypot(best.E[0] - best.I[0], best.E[1] - best.I[1]);
    if (!net.size) { pts.push(padExit, [0, -95]); leadB = 80; }
    else {
      // stop where the new road first comes near one already built, and meet it square on, not alongside
      const dense = resample(simplify(pts, 14), 6);
      let cut = -1, bp = null;
      for (let k = 0; k < dense.length && cut < 0; k++) {
        const [x, z] = dense[k];
        for (const r of WP.roads) for (const p of r.pts) if (Math.abs(p.x - x) < 26 && Math.abs(p.z - z) < 26) { const dd = Math.hypot(p.x - x, p.z - z); if (dd < 26 && (!bp || dd < bp.dd)) bp = { p, dd }; }
        if (bp) cut = k;
      }
      if (bp) pts = [...dense.slice(0, Math.max(2, cut)), [bp.p.x, bp.p.z]];
    }
    addRoad(pts, s.name, leadA * 0.6, leadB);
    for (const k of best.path) net.add(k);
    net.add(xzCell(...padExit));
  }
  // where one road joins another, neither has tunnel walls or bridge rails in the way
  for (const r of WP.roads.slice(1)) {
    const e = r.pts[r.pts.length - 1];
    for (const q of WP.roads) for (const p of q.pts) if (Math.hypot(p.x - e.x, p.z - e.z) < 22) { p.tunnel = false; p.open = true; }
  }
  console.log(`world planned in ${(performance.now() - t0).toFixed(0)} ms: ${WP.sites.map(s => `${s.name}@${Math.round(Math.hypot(s.cx, s.cz))}m dev ${s.dev ? s.dev.toFixed(0) : '-'}`).join(', ')}; roads ${WP.roads.map(r => r.pts.length * ROAD_STEP + 'm').join(' ')}`);
}

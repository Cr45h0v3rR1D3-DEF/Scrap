'use strict';
/* ================= Scrapline · core: math, noise, worlds ================= */
const CELL = 0.5, TAU = Math.PI * 2, G0 = 9.81, VE = 1200, RHO0 = 1.225, RHO_W = 1000;
const V3 = THREE.Vector3, Quat = THREE.Quaternion;
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function smooth(e0, e1, x) { let t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : (t > 1 ? 1 : t); return t * t * (3 - 2 * t); }
function mulberry32(a) {
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function makeSimplex(seed) {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256); for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512), pm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm[i] = (perm[i] % 12) * 3; }
  const g = new Float32Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);
  const F3 = 1 / 3, G3 = 1 / 6;
  return function (x, y, z) {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0, tt, gi;
    tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (tt > 0) { gi = pm[ii + perm[jj + perm[kk]]]; tt *= tt; n += tt * tt * (g[gi] * x0 + g[gi + 1] * y0 + g[gi + 2] * z0); }
    tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (tt > 0) { gi = pm[ii + i1 + perm[jj + j1 + perm[kk + k1]]]; tt *= tt; n += tt * tt * (g[gi] * x1 + g[gi + 1] * y1 + g[gi + 2] * z1); }
    tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (tt > 0) { gi = pm[ii + i2 + perm[jj + j2 + perm[kk + k2]]]; tt *= tt; n += tt * tt * (g[gi] * x2 + g[gi + 1] * y2 + g[gi + 2] * z2); }
    tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (tt > 0) { gi = pm[ii + 1 + perm[jj + 1 + perm[kk + 1]]]; tt *= tt; n += tt * tt * (g[gi] * x3 + g[gi + 1] * y3 + g[gi + 2] * z3); }
    return 32 * n;
  };
}
const nA = makeSimplex(11), nB = makeSimplex(23), nC = makeSimplex(37), nD = makeSimplex(51), nE = makeSimplex(63), nM = makeSimplex(71), nM2 = makeSimplex(83);

/* ---------- celestial bodies ---------- */
const PLANET = { name: 'Terra', R: 10000, mu: G0 * 1e8, maxH: 980, center: new V3(), vel: new V3(), blurb: 'Home. Seas, mountains and the launch pad.' };
const MOON = { name: 'Moon', R: 2200, mu: 1.62 * 2200 * 2200, maxH: 280, center: new V3(), vel: new V3(), blurb: 'Terra\'s grey moon, one-sixth gravity.' };

const spawnFlat = { on: false, x: 0, y: 1, z: 0, h: 20, cos1: 1, r0: 70, r1: 150 };

function planetHeightRaw(x, y, z) {
  const c = nA(x * 1.1, y * 1.1, z * 1.1) * 0.62 + nA(x * 2.3 + 5.2, y * 2.3, z * 2.3) * 0.30 + nB(x * 4.7, y * 4.7 + 1.3, z * 4.7) * 0.15 + nB(x * 9.6, y * 9.6, z * 9.6 - 2.1) * 0.07 + 0.03;
  let h = c > 0 ? c * 330 : c * 720;
  if (c > 0) {
    const land = smooth(0, 0.06, c);
    const mm = nC(x * 1.7 + 3.1, y * 1.7, z * 1.7) * 0.7 + nC(x * 3.9, y * 3.9, z * 3.9 + 7.7) * 0.3;
    const mask = smooth(0.0, 0.32, mm) * smooth(0.02, 0.14, c);
    if (mask > 0.002) {
      let r = 0, a = 1, f = 5.5, ws = 0;
      for (let i = 0; i < 5; i++) { let v = 1 - Math.abs(nD(x * f, y * f, z * f)); v *= v; r += v * a; ws += a; a *= 0.5; f *= 2.07; }
      r /= ws;
      h += mask * Math.pow(r, 1.7) * 1050;
    }
    h += land * (nB(x * 18, y * 18, z * 18) * 24 + nC(x * 46, y * 46, z * 46) * 9);
  }
  h += nA(x * 150, y * 150, z * 150) * 2.2 + nD(x * 400, y * 400, z * 400) * 0.6;
  return h;
}
function planetHeight(x, y, z) {
  let h = planetHeightRaw(x, y, z);
  if (spawnFlat.on) {
    const d = x * spawnFlat.x + y * spawnFlat.y + z * spawnFlat.z;
    if (d > spawnFlat.cos1) {
      const ang = Math.acos(d > 1 ? 1 : d) * PLANET.R;
      const t = 1 - smooth(spawnFlat.r0, spawnFlat.r1, ang);
      h = lerp(h, spawnFlat.h, t);
    }
  }
  if (PLANET.ws && PLANET.ws.on) h = wsApply(PLANET.ws, x, y, z, h);
  return h;
}

/* ---------- the built world: flat sites and roads carved into the ground ----------
   Each world can carry a list of flat zones (towns, the airport, the race park, the harbor, the Moon base)
   and road segments. They are filed in a coarse grid over the unit sphere, so a height lookup only
   checks what is near it. Zones flatten to their height; roads flatten a strip to their own profile. */
function makeWS(cel, cellM) { return { on: false, cel, R: cel.R, cell: cellM / cel.R, grid: new Map(), zones: [], segs: [] }; }
function wsKey(ws, x, y, z) { const c = ws.cell; return ((Math.floor(x / c) + 2048) * 4096 + (Math.floor(y / c) + 2048)) * 4096 + (Math.floor(z / c) + 2048); }
function wsInsert(ws, it, x, y, z, radM) {
  const c = ws.cell, r = radM / ws.R + c * 0.01;
  for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++)
    for (let j = Math.floor((y - r) / c); j <= Math.floor((y + r) / c); j++)
      for (let k = Math.floor((z - r) / c); k <= Math.floor((z + r) / c); k++) {
        const key = ((i + 2048) * 4096 + (j + 2048)) * 4096 + (k + 2048);
        let l = ws.grid.get(key); if (!l) ws.grid.set(key, l = []);
        if (!l.includes(it)) l.push(it);
      }
}
/* a flat zone: centre direction, along and across directions, half sizes (m), height and a blend margin */
function wsZone(ws, dir, u, v, a, b, h, m, surf, pattern) {
  const z = { zone: true, cx: dir.x, cy: dir.y, cz: dir.z, ux: u.x, uy: u.y, uz: u.z, vx: v.x, vy: v.y, vz: v.z, a, b, h, m, surf: surf || null, pattern: pattern || null };
  ws.zones.push(z);
  // cover the rectangle with grid entries
  const step = ws.cell * ws.R * 0.5, ex = a + m, ey = b + m;
  for (let s = -ex; s <= ex + 0.01; s += step) for (let t = -ey; t <= ey + 0.01; t += step) {
    const px = dir.x + (u.x * s + v.x * t) / ws.R, py = dir.y + (u.y * s + v.y * t) / ws.R, pz = dir.z + (u.z * s + v.z * t) / ws.R;
    const l = Math.hypot(px, py, pz); wsInsert(ws, z, px / l, py / l, pz / l, step);
  }
  return z;
}
/* a road segment between two surface directions with heights at each end */
function wsSeg(ws, p0, p1, h0, h1, w, m, bridge, col) {
  const g = { road: true, x0: p0.x, y0: p0.y, z0: p0.z, ex: p1.x - p0.x, ey: p1.y - p0.y, ez: p1.z - p0.z, h0, h1, w, m, bridge: !!bridge, col: col || null };
  g.l2 = g.ex * g.ex + g.ey * g.ey + g.ez * g.ez || 1e-12;
  ws.segs.push(g);
  const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2, mz = (p0.z + p1.z) / 2, half = Math.sqrt(g.l2) * ws.R / 2;
  wsInsert(ws, g, mx, my, mz, half + w + m);
  return g;
}
function wsApply(ws, x, y, z, h) {
  const list = ws.grid.get(wsKey(ws, x, y, z)); if (!list) return h;
  const R = ws.R;
  let rw = 0, sb = 0, sh = 0;
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (it.zone) {
      const dx = x - it.cx, dy = y - it.cy, dz = z - it.cz;
      const u = Math.abs(dx * it.ux + dy * it.uy + dz * it.uz) * R, v = Math.abs(dx * it.vx + dy * it.vy + dz * it.vz) * R;
      if (u >= it.a + it.m || v >= it.b + it.m) continue;
      h = lerp(h, it.h, (1 - smooth(it.a, it.a + it.m, u)) * (1 - smooth(it.b, it.b + it.m, v)));
    } else if (!it.bridge) {
      let t = ((x - it.x0) * it.ex + (y - it.y0) * it.ey + (z - it.z0) * it.ez) / it.l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = it.x0 + it.ex * t - x, qy = it.y0 + it.ey * t - y, qz = it.z0 + it.ez * t - z;
      const d = Math.sqrt(qx * qx + qy * qy + qz * qz) * R;
      // every piece of road in reach pulls toward its own height, the nearest hardest, so a bend or a junction stays smooth
      if (d >= it.w + it.m) continue;
      const w = 1 - smooth(it.w, it.w + it.m, d), b = w / (d * d + 0.5);
      if (w > rw) rw = w;
      sb += b; sh += b * (it.h0 + (it.h1 - it.h0) * t);
    }
  }
  return rw > 0 ? lerp(h, sh / sb, rw) : h;
}
/* what the ground is made of here: road asphalt, or a site's own surface colour */
const ROAD_COL = [0.3, 0.3, 0.31];
const FIELD_COL = [[0.5, 0.48, 0.32], [0.8, 0.7, 0.36], [0.36, 0.55, 0.2], [0.46, 0.34, 0.22], [0.55, 0.66, 0.3]];
const FIELD_SH = [[0.72, 0.62, 0.3], [0.3, 0.47, 0.17], [0.46, 0.34, 0.22], [0.48, 0.58, 0.26]];
function wsSurface(ws, x, y, z, o) {
  const list = ws.grid.get(wsKey(ws, x, y, z)); if (!list) return 0;
  const R = ws.R; let k = 0;
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (it.zone) {
      if (!it.surf && !it.pattern) continue;
      const dx = x - it.cx, dy = y - it.cy, dz = z - it.cz;
      const su = (dx * it.ux + dy * it.uy + dz * it.uz) * R, sv = (dx * it.vx + dy * it.vy + dz * it.vz) * R, u = Math.abs(su), v = Math.abs(sv);
      const w = (1 - smooth(it.a - 6, it.a + 4, u)) * (1 - smooth(it.b - 6, it.b + 4, v));
      if (w <= 0) continue;
      let c = it.surf;
      if (it.pattern === 'fields') {
        // a farmyard at one end, then fields of wheat, crops and ploughed earth in long strips
        if (su < -it.a + 78) c = FIELD_COL[0];
        else { const f = Math.floor((su + it.a) / 34) + (sv > 0 ? 1 : 0); c = FIELD_COL[1 + ((f % 4) + 4) % 4]; if (Math.floor(Math.abs(sv) / 2.5) % 2) c = c === FIELD_COL[3] ? FIELD_COL[3] : FIELD_SH[((f % 4) + 4) % 4]; }
      }
      o[0] = lerp(o[0], c[0], w); o[1] = lerp(o[1], c[1], w); o[2] = lerp(o[2], c[2], w); k = Math.max(k, w);
    } else {
      let t = ((x - it.x0) * it.ex + (y - it.y0) * it.ey + (z - it.z0) * it.ez) / it.l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = it.x0 + it.ex * t - x, qy = it.y0 + it.ey * t - y, qz = it.z0 + it.ez * t - z;
      const d = Math.sqrt(qx * qx + qy * qy + qz * qz) * R;
      const w = 1 - smooth(it.w - 1.5, it.w + 2.5, d);
      if (w > 0) { const c = it.col || ROAD_COL; o[0] = lerp(o[0], c[0], w); o[1] = lerp(o[1], c[1], w); o[2] = lerp(o[2], c[2], w); k = Math.max(k, w); }
    }
  }
  return k;
}
function planetColor(h, slope, x, y, z, o) {
  const v = nE(x * 70, y * 70, z * 70) * 0.5 + 0.5, v2 = nE(x * 260 + 3, y * 260, z * 260) * 0.5 + 0.5;
  let r, g, b;
  if (h < -1.2) { const t = clamp(-h / 140, 0, 1); r = lerp(0.74, 0.25, t); g = lerp(0.69, 0.35, t); b = lerp(0.5, 0.38, t); }
  else if (h < 3.5 + v * 4) { r = 0.86; g = 0.79; b = 0.58; }
  else {
    const t = clamp((h - 4) / 420, 0, 1);
    r = lerp(0.40, 0.48, t) + (v - 0.5) * 0.08; g = lerp(0.58, 0.5, t) + (v - 0.5) * 0.1; b = lerp(0.26, 0.33, t);
    const f = smooth(0.55, 0.75, v2 * 0.6 + v * 0.4) * (1 - t);
    r = lerp(r, 0.24, f * 0.6); g = lerp(g, 0.4, f * 0.6); b = lerp(b, 0.2, f * 0.6);
  }
  const rock = Math.max(smooth(0.16, 0.3, slope), h > 3 ? smooth(480, 640, h + v * 80) * 0.7 : 0);
  if (rock > 0) { const rr = 0.46 + (v2 - 0.5) * 0.08; r = lerp(r, rr + 0.03, rock); g = lerp(g, rr - 0.01, rock); b = lerp(b, rr - 0.05, rock); }
  const snow = smooth(560, 640, h + (v - 0.5) * 120) * (1 - smooth(0.35, 0.55, slope));
  if (snow > 0) { r = lerp(r, 0.94, snow); g = lerp(g, 0.95, snow); b = lerp(b, 0.97, snow); }
  if (spawnFlat.on) {
    const d = x * spawnFlat.x + y * spawnFlat.y + z * spawnFlat.z;
    if (d > 0.999995) {
      const ang = Math.acos(Math.min(1, d)) * PLANET.R;
      if (ang < 27) {
        if (ang > 24.4 && ang < 25.8) { r = 0.9; g = 0.63; b = 0.17; }
        else { const c = 0.58 + (v2 - 0.5) * 0.05; r = c; g = c + 0.01; b = c + 0.015; }
      }
    }
  }
  o[0] = r; o[1] = g; o[2] = b;
  if (PLANET.ws && PLANET.ws.on && h > -1) wsSurface(PLANET.ws, x, y, z, o);
}

const craters = [];
(function () {
  const r = mulberry32(5);
  for (let i = 0; i < 240; i++) {
    const u = r() * 2 - 1, th = r() * TAU, s = Math.sqrt(1 - u * u);
    const rad = Math.pow(r(), 2.6) * 520 + 25;
    craters.push({ x: s * Math.cos(th), y: u, z: s * Math.sin(th), rad, depth: rad * (0.16 + r() * 0.08), rim: rad * 0.05, cosLim: Math.cos(rad * 1.6 / MOON.R) });
  }
})();
function moonHeight(x, y, z) {
  let h = nM(x * 1.6, y * 1.6, z * 1.6) * 90 + nM2(x * 4, y * 4, z * 4) * 35 + nM(x * 14, y * 14, z * 14) * 8 + nM2(x * 60, y * 60, z * 60) * 2;
  for (let i = 0; i < craters.length; i++) {
    const c = craters[i];
    const d = x * c.x + y * c.y + z * c.z;
    if (d < c.cosLim) continue;
    const q = Math.acos(d > 1 ? 1 : d) * MOON.R / c.rad;
    if (q < 1) h += c.depth * (q * q - 1);
    const e = (q - 1) * 3.5;
    h += c.rim * Math.exp(-e * e);
  }
  if (MOON.ws && MOON.ws.on) h = wsApply(MOON.ws, x, y, z, h);
  return h;
}
function moonColor(h, slope, x, y, z, o) {
  const v = nM2(x * 90, y * 90, z * 90) * 0.5 + 0.5;
  let c = 0.5 + clamp(h / 600, -0.15, 0.15) + (v - 0.5) * 0.1;
  c -= smooth(0.2, 0.45, slope) * 0.08;
  o[0] = c; o[1] = c * 0.985; o[2] = c * 0.96;
  if (MOON.ws && MOON.ws.on) wsSurface(MOON.ws, x, y, z, o);
}
PLANET.height = planetHeight; PLANET.color = planetColor;
MOON.height = moonHeight; MOON.color = moonColor;

/* tangent basis at a unit direction */
function tangentBasis(dx, dy, dz, t1, t2) {
  if (Math.abs(dy) < 0.9) t1.set(dz, 0, -dx); else t1.set(0, -dz, dy);
  t1.normalize();
  t2.set(dy * t1.z - dz * t1.y, dz * t1.x - dx * t1.z, dx * t1.y - dy * t1.x);
}
const _sn1 = new V3(), _sn2 = new V3();
function surfaceNormal(cel, dx, dy, dz, h0, out) {
  tangentBasis(dx, dy, dz, _sn1, _sn2);
  const e = 0.8 / cel.R, R = cel.R;
  let ax = dx + _sn1.x * e, ay = dy + _sn1.y * e, az = dz + _sn1.z * e; let l = Math.hypot(ax, ay, az); ax /= l; ay /= l; az /= l;
  let bx = dx + _sn2.x * e, by = dy + _sn2.y * e, bz = dz + _sn2.z * e; l = Math.hypot(bx, by, bz); bx /= l; by /= l; bz /= l;
  const h1 = cel.height(ax, ay, az), h2 = cel.height(bx, by, bz);
  const r0 = R + h0, r1 = R + h1, r2 = R + h2;
  const ux = ax * r1 - dx * r0, uy = ay * r1 - dy * r0, uz = az * r1 - dz * r0;
  const vx = bx * r2 - dx * r0, vy = by * r2 - dy * r0, vz = bz * r2 - dz * r0;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  if (nx * dx + ny * dy + nz * dz < 0) { nx = -nx; ny = -ny; nz = -nz; }
  out.set(nx, ny, nz);
  return out;
}
/* move along a sphere surface from unit dir by dist (m) along bearing ang in basis t1/t2 */
function offsetDir(d, t1, t2, dist, ang, R, out) {
  const a = dist / R, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(ang), sb = Math.sin(ang);
  out.set(d.x * ca + (t1.x * cb + t2.x * sb) * sa, d.y * ca + (t1.y * cb + t2.y * sb) * sa, d.z * ca + (t1.z * cb + t2.z * sb) * sa).normalize();
  return out;
}

/* ---------- world setup: find a launch pad near sea and mountains ---------- */
const WORLD = { padUp: new V3(), padFwd: new V3(), padRight: new V3(), padEast: new V3(), padH: 0, sunDir: new V3(), locs: {}, L: null };
const TERRA_DAY = 600;
/* Terra turns: the pad's directions in space follow it (WORLD.L holds them in Terra's own frame) */
function syncPad() {
  const L = WORLD.L; if (!L) return;
  fromSpin(PLANET, L.up, WORLD.padUp); fromSpin(PLANET, L.fwd, WORLD.padFwd); fromSpin(PLANET, L.right, WORLD.padRight); fromSpin(PLANET, L.east, WORLD.padEast);
}
function setupWorld() {
  const rnd = mulberry32(2024);
  const d = new V3(), t1 = new V3(), t2 = new V3(), o = new V3();
  let best = null, bs = -1e9;
  for (let i = 0; i < 2600; i++) {
    const u = rnd() * 2 - 1, th = rnd() * TAU, s = Math.sqrt(1 - u * u);
    d.set(s * Math.cos(th), u, s * Math.sin(th));
    const h = planetHeightRaw(d.x, d.y, d.z);
    if (h < 12 || h > 70) continue;
    tangentBasis(d.x, d.y, d.z, t1, t2);
    let dev = 0;
    for (let k = 0; k < 8; k++) { offsetDir(d, t1, t2, 75, k * TAU / 8, PLANET.R, o); dev = Math.max(dev, Math.abs(planetHeightRaw(o.x, o.y, o.z) - h)); if (dev > 14) break; }
    if (dev > 14) continue;
    let seaDist = 1e9, seaAng = 0;
    outer: for (const dist of [300, 450, 600, 800, 1000, 1200]) {
      for (let k = 0; k < 12; k++) { const a = k * TAU / 12; offsetDir(d, t1, t2, dist, a, PLANET.R, o); if (planetHeightRaw(o.x, o.y, o.z) < -6) { seaDist = dist; seaAng = a; break outer; } }
    }
    if (seaDist > 1200) continue;
    let mt = -1e9; const mtDir = new V3();
    for (const dist of [1200, 1800, 2400, 3000, 3600]) {
      for (let k = 0; k < 16; k++) { offsetDir(d, t1, t2, dist, k * TAU / 16, PLANET.R, o); const hh = planetHeightRaw(o.x, o.y, o.z); if (hh > mt) { mt = hh; mtDir.copy(o); } }
    }
    const score = -dev * 2 - Math.abs(seaDist - 550) * 0.012 + Math.min(mt, 700) * 0.05 - (mt < 300 ? 30 : 0);
    if (score > bs) { bs = score; best = { d: d.clone(), h, seaAng, seaDist, mtDir, mt, t1: t1.clone(), t2: t2.clone() }; }
  }
  if (!best) { // relaxed fallback
    for (let i = 0; i < 4000 && !best; i++) {
      const u = rnd() * 2 - 1, th = rnd() * TAU, s = Math.sqrt(1 - u * u);
      d.set(s * Math.cos(th), u, s * Math.sin(th));
      const h = planetHeightRaw(d.x, d.y, d.z);
      if (h > 8 && h < 120) { tangentBasis(d.x, d.y, d.z, t1, t2); best = { d: d.clone(), h, seaAng: 0, seaDist: 800, mtDir: d.clone(), mt: h, t1: t1.clone(), t2: t2.clone() }; }
    }
  }
  const up = best.d;
  WORLD.padH = best.h;
  Object.assign(spawnFlat, { on: true, x: up.x, y: up.y, z: up.z, h: best.h, cos1: Math.cos(spawnFlat.r1 / PLANET.R) });
  WORLD.padUp.copy(up);
  const fwd = new V3().copy(best.t1).multiplyScalar(Math.cos(best.seaAng)).addScaledVector(best.t2, Math.sin(best.seaAng)).normalize();
  WORLD.padFwd.copy(fwd);
  WORLD.padRight.crossVectors(up, fwd).normalize();
  // sun behind the default camera, high in the sky
  WORLD.sunDir.copy(up).multiplyScalar(0.74).addScaledVector(fwd, -0.48).addScaledVector(WORLD.padRight, 0.47).normalize();
  // moon rising low over the sea direction
  const e1 = new V3().copy(up).multiplyScalar(0.33).addScaledVector(fwd, 0.94).normalize();
  const nrm = new V3().copy(WORLD.padRight).addScaledVector(up, 0.25).normalize();
  const e2 = new V3().crossVectors(nrm, e1).normalize();
  MOON.orbitRef = e1.clone(); MOON.orbitPlaneN = new V3().crossVectors(e1, e2).normalize();
  // highlands: flattest high spot near the tallest sampled peak
  let hl = best.mtDir.clone(), hlScore = -1e9;
  { const tt1 = new V3(), tt2 = new V3(); tangentBasis(best.mtDir.x, best.mtDir.y, best.mtDir.z, tt1, tt2);
    for (let k = 0; k < 40; k++) {
      offsetDir(best.mtDir, tt1, tt2, 40 + k * 9, k * 2.399, PLANET.R, o);
      const h = planetHeightRaw(o.x, o.y, o.z);
      let dev = 0; const q1 = new V3(), q2 = new V3(), q = new V3(); tangentBasis(o.x, o.y, o.z, q1, q2);
      for (let j = 0; j < 6; j++) { offsetDir(o, q1, q2, 12, j * TAU / 6, PLANET.R, q); dev = Math.max(dev, Math.abs(planetHeightRaw(q.x, q.y, q.z) - h)); }
      const sc = h * 0.02 - dev;
      if (h > 250 && sc > hlScore) { hlScore = sc; hl = o.clone(); }
    }
  }
  // open sea: beyond the coast along the forward bearing
  let sea = null;
  for (let dist = best.seaDist + 250; dist < best.seaDist + 3000; dist += 150) {
    offsetDir(up, best.t1, best.t2, dist, best.seaAng, PLANET.R, o);
    if (planetHeightRaw(o.x, o.y, o.z) < -18) { sea = o.clone(); break; }
  }
  if (!sea) { offsetDir(up, best.t1, best.t2, best.seaDist + 200, best.seaAng, PLANET.R, o); sea = o.clone(); }
  WORLD.locs = {
    pad: { name: 'Launch pad', kind: 'ground', dir: up.clone() },
    highlands: { name: 'Highlands', kind: 'ground', dir: hl },
    sea: { name: 'Open sea', kind: 'sea', dir: sea },
    orbit: { name: 'Low orbit (9 km)', kind: 'orbit', alt: 9000 },
    moon: { name: 'The Moon', kind: 'moon' },
  };
  // towns, the airport, the race park and the harbor, with roads between them
  if (typeof planWorld === 'function') planWorld();
}

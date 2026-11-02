'use strict';
/* ================= Scrapline · the wider Terra =================
   The city, towns, villages and farms the globe planner placed, the highways and railways between them
   (drawn in chunks that only show near the camera), the stations, the two landmarks, and the trains
   that run by themselves: each train car is a moving solid you can park a vehicle on. */

/* ---------- fast geometry straight into a GB (no three.js geometry objects) ---------- */
const _fc = new THREE.Color();
function fquad(g, a, b, c, d, nx, ny, nz, col) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const flip = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz < 0;
  _fc.set(col);
  for (const v of flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d]) { g.P.push(v[0], v[1], v[2]); g.N.push(nx, ny, nz); g.C.push(_fc.r, _fc.g, _fc.b); }
}
function fbox(g, w, h, d, x, y, z, col, bottom = false) {
  const x0 = x - w / 2, x1 = x + w / 2, y0 = y - h / 2, y1 = y + h / 2, z0 = z - d / 2, z1 = z + d / 2;
  fquad(g, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], 1, 0, 0, col);
  fquad(g, [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], -1, 0, 0, col);
  fquad(g, [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], 0, 1, 0, col);
  if (bottom) fquad(g, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0, -1, 0, col);
  fquad(g, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1, col);
  fquad(g, [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], 0, 0, -1, col);
}
/* a flat panel facing +z (or -z) in the object frame */
function fpanel(g, w, h, x, y, z, col, back) {
  const n = back ? -1 : 1;
  fquad(g, [x - w / 2, y - h / 2, z], [x + w / 2, y - h / 2, z], [x + w / 2, y + h / 2, z], [x - w / 2, y + h / 2, z], 0, 0, n, col);
}
/* ribbon windows, one strip a floor, on all four faces of a w × d block from y0 to y1 */
function ribbons(gl, w, d, y0, y1, fh, lit, rng, x = 0, z = 0, dark = 0x1d2833) {
  for (let y = y0 + fh * 0.5; y < y1 - fh * 0.3; y += fh) {
    const hh = fh * 0.5;
    const c = () => rng() < lit ? 0xffd27a : dark;
    fquad(gl, [x - w / 2 + 0.6, y - hh / 2, z + d / 2 + 0.05], [x + w / 2 - 0.6, y - hh / 2, z + d / 2 + 0.05], [x + w / 2 - 0.6, y + hh / 2, z + d / 2 + 0.05], [x - w / 2 + 0.6, y + hh / 2, z + d / 2 + 0.05], 0, 0, 1, c());
    fquad(gl, [x - w / 2 + 0.6, y - hh / 2, z - d / 2 - 0.05], [x + w / 2 - 0.6, y - hh / 2, z - d / 2 - 0.05], [x + w / 2 - 0.6, y + hh / 2, z - d / 2 - 0.05], [x - w / 2 + 0.6, y + hh / 2, z - d / 2 - 0.05], 0, 0, -1, c());
    fquad(gl, [x + w / 2 + 0.05, y - hh / 2, z - d / 2 + 0.6], [x + w / 2 + 0.05, y - hh / 2, z + d / 2 - 0.6], [x + w / 2 + 0.05, y + hh / 2, z + d / 2 - 0.6], [x + w / 2 + 0.05, y + hh / 2, z - d / 2 + 0.6], 1, 0, 0, c());
    fquad(gl, [x - w / 2 - 0.05, y - hh / 2, z - d / 2 + 0.6], [x - w / 2 - 0.05, y - hh / 2, z + d / 2 - 0.6], [x - w / 2 - 0.05, y + hh / 2, z + d / 2 - 0.6], [x - w / 2 - 0.05, y + hh / 2, z - d / 2 + 0.6], -1, 0, 0, c());
  }
}
/* text on a board: a canvas texture on its own little mesh, riding with its site */
const TEXT_TEX = new Map();
function textTexture(text, o = {}) {
  const key = text + '|' + (o.bg || '') + '|' + (o.fg || '') + '|' + (o.aspect || 4);
  if (TEXT_TEX.has(key)) return TEXT_TEX.get(key);
  const asp = o.aspect || 4, H = 64, Wd = Math.round(H * asp);
  const cv = document.createElement('canvas'); cv.width = Wd; cv.height = H;
  const x = cv.getContext('2d');
  x.fillStyle = o.bg || '#1f4f7a'; x.fillRect(0, 0, Wd, H);
  if (o.border !== false) { x.strokeStyle = o.fg || '#ffffff'; x.lineWidth = 4; x.strokeRect(5, 5, Wd - 10, H - 10); }
  x.fillStyle = o.fg || '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  let fs = 40; x.font = `700 ${fs}px system-ui, sans-serif`;
  while (x.measureText(text).width > Wd - 24 && fs > 10) { fs -= 2; x.font = `700 ${fs}px system-ui, sans-serif`; }
  x.fillText(text, Wd / 2, H / 2 + 2);
  const t = new THREE.CanvasTexture(cv); t.anisotropy = 4;
  if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
  TEXT_TEX.set(key, t);
  return t;
}
const SIGN_GEO = new THREE.PlaneGeometry(1, 1);
Site.prototype.sign = function (M, text, w, h, o = {}) {
  // a board on a post or a wall: the text on both faces
  const mat = new THREE.MeshBasicMaterial({ map: textTexture(text, { aspect: w / h, ...o }) });
  for (const back of [false, true]) {
    const m = new THREE.Mesh(SIGN_GEO, mat); m.matrixAutoUpdate = false;
    const L = M.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, back ? -0.06 : 0.06)).multiply(new THREE.Matrix4().makeRotationY(back ? Math.PI : 0)).multiply(new THREE.Matrix4().makeScale(w, h, 1));
    m.matrix.copy(L); (this.extra = this.extra || []).push(m);
  }
  const g = new GB(); fbox(g, w + 0.2, h + 0.2, 0.1, 0, 0, 0, 0x3a4148); this.put(g, M);
};
/* a solid between eight corners (world-own frame): drawn into the site, and a collider unless told not to */
const HEX_F = BOX_F;
Site.prototype.hex = function (V, col, glow, collide = true, internal = [0, 1]) {
  if (collide && !glow) makeCollider(V, HEX_F, this.cel, null, internal);
  const c = new V3(); for (const v of V) c.add(v); c.multiplyScalar(1 / 8);
  const acc = glow ? this.glow : this.solid, cc = typeof col === 'number' ? rgb(col) : col, O = this.O;
  const fcn = new V3(), n = new V3(), e1 = new V3(), e2 = new V3();
  for (const f of HEX_F) {
    const a = V[f[0]], b = V[f[1]], cq = V[f[2]], d = V[f[3]];
    e1.subVectors(cq, a); e2.subVectors(d, b); n.crossVectors(e1, e2);
    if (n.lengthSq() < 1e-10) continue;
    n.normalize(); fcn.copy(a).add(b).add(cq).add(d).multiplyScalar(0.25).sub(c); if (n.dot(fcn) < 0) n.negate();
    acc.quad(a.clone().sub(O), b.clone().sub(O), cq.clone().sub(O), d.clone().sub(O), cc, n);
  }
};

/* ---------- roads and railways along a path of {d, h}: drawn in chunks ---------- */
function pathSides(pts) {
  const n = pts.length;
  return pts.map((p, i) => { const a = pts[Math.max(0, i - 1)].d, b = pts[Math.min(n - 1, i + 1)].d, t = new V3().subVectors(b, a); t.addScaledVector(p.d, -t.dot(p.d)).normalize(); return new V3().crossVectors(t, p.d).normalize(); });
}
function pathSite(name, pts, i0, i1, cull) {
  const m = pts[(i0 + i1) >> 1].d, e1 = new V3(), e3 = new V3(); tangentBasis(m.x, m.y, m.z, e1, e3);
  const s = new Site(name, PLANET, m, e1, e3, 0); s.cull = cull; s.chunk = true;
  return s;
}
/* a flat band along the path at a sideways offset: into the site's decals */
function bandD(s, pts, side, i0, i1, off, w, col, lift, skip) {
  const R = PLANET.R, O = s.O, a = new V3(), b = new V3(), c = new V3(), d = new V3();
  for (let i = i0; i < i1; i++) {
    if (skip && skip(i)) continue;
    const p = pts[i], q = pts[i + 1];
    a.copy(p.d).multiplyScalar(R + p.h + lift).addScaledVector(side[i], off - w / 2).sub(O);
    b.copy(p.d).multiplyScalar(R + p.h + lift).addScaledVector(side[i], off + w / 2).sub(O);
    c.copy(q.d).multiplyScalar(R + q.h + lift).addScaledVector(side[i + 1], off + w / 2).sub(O);
    d.copy(q.d).multiplyScalar(R + q.h + lift).addScaledVector(side[i + 1], off - w / 2).sub(O);
    s.decal.quad(a, b, c, d, col, p.d);
  }
}
/* the side of a rail: a vertical strip from lift y0 to y1 at offset off, facing outward (sgn) */
function wallD(s, pts, side, i0, i1, off, y0, y1, col, sgn, skip) {
  const R = PLANET.R, O = s.O, a = new V3(), b = new V3(), c = new V3(), d = new V3(), n = new V3();
  for (let i = i0; i < i1; i++) {
    if (skip && skip(i)) continue;
    const p = pts[i], q = pts[i + 1];
    a.copy(p.d).multiplyScalar(R + p.h + y0).addScaledVector(side[i], off).sub(O);
    b.copy(q.d).multiplyScalar(R + q.h + y0).addScaledVector(side[i + 1], off).sub(O);
    c.copy(q.d).multiplyScalar(R + q.h + y1).addScaledVector(side[i + 1], off).sub(O);
    d.copy(p.d).multiplyScalar(R + p.h + y1).addScaledVector(side[i], off).sub(O);
    s.decal.quad(a, b, c, d, col, n.copy(side[i]).multiplyScalar(sgn));
  }
}
/* sleepers across a track, a few on every step */
function sleepersD(s, pts, side, i0, i1, col, skip) {
  const R = PLANET.R, O = s.O, u = new V3(), sd = new V3(), t = new V3(), p0 = new V3(), a = new V3(), b = new V3(), c = new V3(), d = new V3();
  for (let i = i0; i < i1; i++) {
    if (skip && skip(i)) continue;
    const p = pts[i], q = pts[i + 1];
    for (let k = 0; k < 4; k++) {
      const f = (k + 0.5) / 4, h = lerp(p.h, q.h, f);
      u.copy(p.d).lerp(q.d, f).normalize(); sd.copy(side[i]).lerp(side[i + 1], f).normalize();
      t.subVectors(q.d, p.d).normalize().multiplyScalar(0.16);
      p0.copy(u).multiplyScalar(R + h + 0.13);
      a.copy(p0).addScaledVector(sd, -1.3).sub(t).sub(O); b.copy(p0).addScaledVector(sd, 1.3).sub(t).sub(O);
      c.copy(p0).addScaledVector(sd, 1.3).add(t).sub(O); d.copy(p0).addScaledVector(sd, -1.3).add(t).sub(O);
      s.decal.quad(a, b, c, d, col, u);
    }
  }
}
/* bridges (deck, parapets, piers) and roofed cuts (walls and roof), piece by piece so they bend with the path */
function pathSolids(s, pts, side, i0, i1, o) {
  const R = PLANET.R;
  const corner = (i, sd, y) => pts[i].d.clone().multiplyScalar(R + pts[i].h + y).addScaledVector(side[i], sd);
  const piece = (i, s0, s1, y0, y1, col, glow, collide = true) => {
    // on a tight bend the inside edge folds back on itself: leave that piece out
    const ab = new V3().subVectors(pts[i + 1].d, pts[i].d);
    for (const sd of [s0, s1]) if (corner(i + 1, sd, 0).sub(corner(i, sd, 0)).dot(ab) <= 0) return;
    const V = []; for (let k = 0; k < 8; k++) V.push(corner(k & 4 ? i + 1 : i, k & 1 ? s1 : s0, k & 2 ? y1 : y0));
    s.hex(V, col, glow, collide);
  };
  for (let i = i0; i < i1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a.bridge || b.bridge) {
      piece(i, -o.deck - 0.2, o.deck + 0.2, -1.2, 0, o.deckCol || COLS.concrete);
      if (!a.open && !b.open) for (const sd of [-1, 1]) piece(i, sd * o.deck, sd * (o.deck + 0.4), 0, o.par, 0xd8d6cf);
      if (i % 4 === 0 && !a.nopier) {
        // a pier down to the ground or the sea floor
        const gh = planetHeight(a.d.x, a.d.y, a.d.z), depth = a.h - Math.min(gh, a.h) + 3;
        const X = new V3().subVectors(b.d, a.d).normalize(), M = new THREE.Matrix4().makeBasis(X, a.d, new V3().crossVectors(X, a.d)).setPosition(a.d.clone().multiplyScalar(R + a.h));
        const g = new GB(); fbox(g, 2.2, depth, o.deck * 1.1, 0, -depth / 2 - 1.2, 0, 0xa9a7a0); s.put(g, M); s.boxCol(M, 2.2, depth, o.deck * 1.1, 0, -depth / 2 - 1.2, 0);
      }
    }
    if (a.tunnel && b.tunnel) {
      for (const sd of [-1, 1]) piece(i, sd * o.tun, sd * (o.tun + 1), -0.5, o.tunH, 0x9a9890);
      piece(i, -o.tun - 1, o.tun + 1, o.tunH, o.tunH + 1, 0x8d8b84);
      if (i % 3 === 0) piece(i, -0.3, 0.3, o.tunH - 0.2, o.tunH, 0xfff1c4, true);
      // portals: a darker, thicker face where the cut starts and ends
      if (!pts[i - 1] || !pts[i - 1].tunnel || !pts[i + 2] || !pts[i + 2].tunnel) piece(i, -o.tun - 1.6, o.tun + 1.6, o.tunH, o.tunH + 2.4, 0x6f6d68);
    }
  }
}
const HW_SOLID = { deck: ROAD_W + 0.5, par: 1, tun: ROAD_W + 2, tunH: 6.8 };
const RAIL_SOLID = { deck: 2.7, par: 0.8, tun: 3.3, tunH: 6.6, deckCol: 0xa8a49a };
const CHUNK = 60;
function roadChunk(r, ri, i0, i1) {
  const asph = rgb(0x34363a), line = rgb(0xe9e6dc), yel = rgb(0xe8b83a), pts = r.pts, side = r.side;
  const s = pathSite(`hw${ri}_${i0}`, pts, i0, i1, 4200);
  bandD(s, pts, side, i0, i1, 0, ROAD_W * 2, asph, 0.09);
  bandD(s, pts, side, i0, i1, 0, 0.25, yel, 0.11, i => i % 2 === 1 || pts[i].cross);
  bandD(s, pts, side, i0, i1, 4.4, 0.2, line, 0.1, i => pts[i].cross); bandD(s, pts, side, i0, i1, -4.4, 0.2, line, 0.1, i => pts[i].cross);
  pathSolids(s, pts, side, i0, i1, HW_SOLID);
  s.finish();
}
function railChunk(L, li, i0, i1) {
  const ballast = rgb(0x6f6760), sleeper = rgb(0x4a3a2c), steel = rgb(0xa7aeb5), steelD = rgb(0x5d636a), pts = L.pts, side = L.side;
  const onRoad = i => pts[i].cross && !pts[i].bridge;
  const s = pathSite(`rl${li}_${i0}`, pts, i0, i1, 4200);
  bandD(s, pts, side, i0, i1, 0, 3.4, ballast, 0.07, onRoad);
  sleepersD(s, pts, side, i0, i1, sleeper, onRoad);
  for (const g of [-0.75, 0.75]) {
    bandD(s, pts, side, i0, i1, g, 0.1, steel, 0.27);
    wallD(s, pts, side, i0, i1, g + Math.sign(g) * 0.05, 0.12, 0.27, steelD, Math.sign(g));
  }
  pathSolids(s, pts, side, i0, i1, RAIL_SOLID);
  s.finish();
}
/* ---------- the places ---------- */
function gsite(gs, cull) { const s = new Site(gs.name, PLANET, gs.C, gs.E1, gs.E3, gs.h); s.cull = cull; return s; }
function lampPost(s, u, v, ang, h = 7) { lamp(s, u, v, ang, h); }
/* a tower block in tiers, each narrower than the one below, with ribbon windows */
function tower(s, u, v, ang, w, d, h, o = {}) {
  const M = s.frame(u, v, ang), g = new GB(), gl = new GB(), rng = s.rng, fh = o.fh || 3.6;
  const body = o.col ?? 0x7d93a6, trim = o.trim ?? 0x4d5a66, dark = o.dark ?? 0x22313d;
  const tiers = o.tiers || (h > 90 ? 3 : h > 45 ? 2 : 1);
  let y = 0, tw = w, td = d;
  for (let t = 0; t < tiers; t++) {
    const th = t === tiers - 1 ? h - y : h * (t === 0 ? (tiers === 3 ? 0.55 : 0.65) : 0.3);
    fbox(g, tw, th, td, 0, y + th / 2, 0, body);
    fbox(g, tw + 0.4, 0.6, td + 0.4, 0, y + th + 0.3, 0, trim);
    ribbons(gl, tw, td, y + (t ? 0.6 : 3.5), y + th, fh, o.lit ?? 0.4, rng, 0, 0, dark);
    s.boxCol(M, tw, th + 0.6, td, 0, y + (th + 0.6) / 2, 0);
    y += th + 0.6; tw *= 0.78; td *= 0.78;
  }
  // ground floor: a darker lobby with a door
  fbox(g, w + 0.2, 3.4, d + 0.2, 0, 1.7, 0, o.lobby ?? 0x3c4650);
  fbox(gl, 3.2, 2.6, 0.1, 0, 1.3, d / 2 + 0.15, 0xffe7a8);
  if (o.spire) { fbox(g, 1.2, o.spire, 1.2, 0, y + o.spire / 2, 0, 0xc9cfd4); fbox(gl, 0.6, 0.6, 0.6, 0, y + o.spire + 0.3, 0, 0xff3b2b); }
  else if (!o.helipad) { fbox(g, tw * 0.5, 2.4, td * 0.4, tw * 0.15, y + 1.2, 0, 0x8a949c); fbox(g, 1.6, 4, 1.6, -tw * 0.25, y + 2, td * 0.15, 0x6f7a82); }
  if (o.helipad) {
    // a pad on the roof: a big H in a ring
    const yy = y + 0.02;
    fquad(g, [-tw / 2 + 1, yy, -td / 2 + 1], [tw / 2 - 1, yy, -td / 2 + 1], [tw / 2 - 1, yy, td / 2 - 1], [-tw / 2 + 1, yy, td / 2 - 1], 0, 1, 0, 0x4d5157);
    for (const x of [-2.6, 2.6]) fquad(g, [x - 0.5, yy + 0.02, -4], [x + 0.5, yy + 0.02, -4], [x + 0.5, yy + 0.02, 4], [x - 0.5, yy + 0.02, 4], 0, 1, 0, 0xeeeeea);
    fquad(g, [-2.6, yy + 0.02, -0.5], [2.6, yy + 0.02, -0.5], [2.6, yy + 0.02, 0.5], [-2.6, yy + 0.02, 0.5], 0, 1, 0, 0xeeeeea);
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; fbox(gl, 0.4, 0.25, 0.4, Math.cos(a) * (tw / 2 - 1.5), yy + 0.12, Math.sin(a) * (td / 2 - 1.5), 0x52ff7a); }
    // a low wall round the edge so you don't just roll off
    for (const sg of [-1, 1]) { fbox(g, tw, 1, 0.4, 0, y + 0.5, sg * (td / 2 - 0.2), trim); fbox(g, 0.4, 1, td, sg * (tw / 2 - 0.2), y + 0.5, 0, trim); s.boxCol(M, tw, 1, 0.4, 0, y + 0.5, sg * (td / 2 - 0.2)); s.boxCol(M, 0.4, 1, td, sg * (tw / 2 - 0.2), y + 0.5, 0); }
  }
  s.put(g, M); s.put(gl, M, true);
  return { M, top: y };
}
function trafficLight(s, u, v, ang) {
  const M = s.frame(u, v, ang), g = new GB(), gl = new GB();
  fbox(g, 0.25, 5, 0.25, 0, 2.5, 0, 0x3a4148); fbox(g, 0.5, 1.4, 0.4, 0, 4.6, 0.3, 0x2b3137);
  fbox(gl, 0.3, 0.3, 0.05, 0, 5.0, 0.52, 0xff3b2b); fbox(gl, 0.3, 0.3, 0.05, 0, 4.6, 0.52, 0x3a2a10); fbox(gl, 0.3, 0.3, 0.05, 0, 4.2, 0.52, 0x52ff7a);
  s.put(g, M); s.put(gl, M, true); s.boxCol(M, 0.3, 5, 0.3, 0, 2.5, 0);
}
function buildCity(gs) {
  const s = gsite(gs, 16000), rng = s.rng;
  const asph = rgb(0x34363a), walk = rgb(0xa9a8a2), line = rgb(0xe9e6dc), white = rgb(0xeeeeea);
  const ST = [-180, -90, 0, 90, 180], E = 229;
  for (const k of ST) { s.rect(0, k, 2 * E, 18, 0, walk); s.rect(k, 0, 18, 2 * E, 0, walk); }
  for (const k of ST) { s.rect(0, k, 2 * E, 12, 0, asph, 0.1); s.rect(k, 0, 12, 2 * E, 0, asph, 0.1); }
  const nearX = t => ST.some(k => Math.abs(t - k) < 11);
  for (const k of ST) for (let t = -E + 8; t < E - 6; t += 12) if (!nearX(t)) { s.rect(t, k, 5, 0.25, 0, line, 0.12); s.rect(k, t, 0.25, 5, 0, line, 0.12); }
  // zebra crossings at every junction
  for (const a of ST) for (const b of ST) for (const [du, dv, along] of [[11, 0, 1], [-11, 0, 1], [0, 11, 0], [0, -11, 0]]) {
    for (let k = -2; k <= 2; k++) along ? s.rect(a + du, b + k * 2.2, 3, 1.1, 0, white, 0.13) : s.rect(a + k * 2.2, b + dv, 1.1, 3, 0, white, 0.13);
  }
  const PAL = [0x7d93a6, 0x93a7b3, 0x5f7f99, 0xa9a39a, 0xc2b8a3, 0x6d7f8c, 0x8e8478, 0xb7c3c9];
  const blockAt = (bu, bv) => {
    const key = bu + ',' + bv;
    if (key === '45,-45') {
      tower(s, bu, bv, 0, 40, 40, METRO_H, { col: 0x4f7088, trim: 0x2f3f4c, tiers: 3, helipad: true, lit: 0.5 });
      return;
    }
    if (key === '-45,45') {
      // the city park: lawns, a pond, paths and trees
      s.rect(bu, bv, 72, 72, 0, rgb(0x4f8f3a), 0.06);
      s.rect(bu, bv, 72, 4, 0, rgb(0xc9b896), 0.08); s.rect(bu, bv, 4, 72, 0, rgb(0xc9b896), 0.08);
      s.disc(bu + 18, bv + 18, 0, 11, rgb(0x3b7fa6), 0.09);
      for (let i = 0; i < 18; i++) { const a = rng() * TAU, r = 10 + rng() * 22; const tu = bu + Math.cos(a) * r, tv = bv + Math.sin(a) * r; if (Math.abs(tu - bu) > 4 && Math.abs(tv - bv) > 4 && Math.hypot(tu - bu - 18, tv - bv - 18) > 13) tree(s, tu, tv, 1.1); }
      const M = s.frame(bu, bv), g = new GB(), gl = new GB(); g.cyl(4, 4.4, 0.8, 18, 0, 0.4, 0, 0xcfcac0); gl.cyl(3.6, 3.6, 0.05, 18, 0, 0.75, 0, 0x6fb7d9); g.cyl(0.4, 0.6, 3, 10, 0, 1.5, 0, 0xcfcac0); s.put(g, M); s.put(gl, M, true); s.geoCol(new THREE.CylinderGeometry(4.4, 4.4, 0.8, 10).translate(0, 0.4, 0), M);
      return;
    }
    if (key === '135,135') {
      // a car park
      s.rect(bu, bv, 70, 70, 0, rgb(0x45474b), 0.09);
      for (let k = -3; k <= 3; k++) { s.rect(bu - 18, bv + k * 9, 14, 0.2, 0, white, 0.11); s.rect(bu + 18, bv + k * 9, 14, 0.2, 0, white, 0.11); }
      for (let i = 0; i < 8; i++) s.loose('cone', bu - 4 + (i % 2) * 8, bv - 28 + i * 8);
      return;
    }
    if (key === '-135,-135') {
      // a square with a statue
      s.rect(bu, bv, 70, 70, 0, rgb(0xb5aa95), 0.08);
      const M = s.frame(bu, bv), g = new GB(); g.box(6, 2, 6, 0, 1, 0, 0x9b968c); g.cyl(0.9, 1.1, 5, 10, 0, 4.5, 0, 0x5e7a6a); g.sph(1.2, 0, 7.6, 0, 0x5e7a6a); s.put(g, M); s.boxCol(M, 6, 2, 6, 0, 1, 0); s.boxCol(M, 2, 5, 2, 0, 4.5, 0);
      for (const [a, b] of [[-25, -25], [25, -25], [-25, 25], [25, 25]]) tree(s, bu + a, bv + b);
      return;
    }
    const central = Math.abs(bu) === 45 && Math.abs(bv) === 45;
    for (const i of [-1, 1]) for (const j of [-1, 1]) {
      const u = bu + i * 18, v = bv + j * 18, face = Math.round(Math.atan2(-j, -i) / (Math.PI / 2)) * Math.PI / 2;
      const h = central ? 70 + rng() * 90 : 18 + rng() * 42;
      tower(s, u, v, face, central ? 28 : 30, central ? 28 : 30, h, { col: PAL[Math.floor(rng() * PAL.length)], lit: 0.35 + rng() * 0.3, spire: central && rng() < 0.4 ? 10 + rng() * 14 : 0 });
    }
  };
  for (const bu of [-135, -45, 45, 135]) for (const bv of [-135, -45, 45, 135]) blockAt(bu, bv);
  // the edge band: warehouses and low shops facing the outer streets, trees in the corners
  for (const t of [-135, -45, 45, 135]) for (const [u, v, ang] of [[t, 211, Math.PI], [t, -211, 0], [211, t, -Math.PI / 2], [-211, t, Math.PI / 2]]) {
    if (rng() < 0.25) { tree(s, u - 12, v); tree(s, u + 12, v); continue; }
    building(s, u, v, ang, 52, 22, 7 + rng() * 7, { wall: [0xc9c4b6, 0x9fb0bc, 0xc9b089, 0xb4bcc2][Math.floor(rng() * 4)], floors: 1, lit: 0.3, trim: 0x5a636a, awning: rng() < 0.5 ? [0xc8432f, 0x2f8f86, 0xe8a33d][Math.floor(rng() * 3)] : null });
  }
  for (const a of [-211, 211]) for (const b of [-211, 211]) { tree(s, a - 6, b); tree(s, a + 6, b + 4); tree(s, a, b - 6); }
  // street lights and traffic lights
  for (const k of ST) for (let t = -200; t <= 200; t += 45) { if (!nearX(t)) { lamp(s, t, k + 8, -Math.PI / 2); lamp(s, k - 8, t, Math.PI); } }
  for (const a of [-90, 0, 90]) for (const b of [-90, 0, 90]) trafficLight(s, a + 8, b + 8, Math.PI * 0.75);
  s.finish();
}
function buildVillage(gs) {
  const s = gsite(gs, 8000), rng = s.rng;
  const asph = rgb(0x3a3c40), verge = rgb(0xa49c88);
  s.rect(0, 0, 144, 11, 0, verge, 0.08); s.rect(0, 0, 11, 144, 0, verge, 0.08);
  s.rect(0, 0, 144, 8, 0, asph, 0.1); s.rect(0, 0, 8, 144, 0, asph, 0.1);
  // the green with its oak, a bench and a well
  s.rect(38, 38, 52, 52, 0, rgb(0x5a9a40), 0.07);
  tree(s, 38, 38, 1.8);
  { const M = s.frame(26, 30, 0), g = new GB(); g.box(3, 0.15, 0.8, 0, 0.6, 0, 0x7a5a3a); g.box(3, 0.6, 0.12, 0, 0.95, -0.4, 0x7a5a3a); for (const x of [-1.3, 1.3]) g.box(0.12, 0.6, 0.7, x, 0.3, 0, 0x3a3a3a); s.put(g, M); s.boxCol(M, 3, 0.8, 0.8, 0, 0.4, 0); }
  { const M = s.frame(52, 24), g = new GB(); g.cyl(1.4, 1.5, 1.1, 14, 0, 0.55, 0, 0x9b968c); g.box(0.2, 2.6, 0.2, -1.2, 1.3, 0, 0x6b4a2f); g.box(0.2, 2.6, 0.2, 1.2, 1.3, 0, 0x6b4a2f); g.add(new THREE.ConeGeometry(2, 1, 4), COLS.roof, 0, 3, 0, 0, Math.PI / 4, 0); s.put(g, M); s.geoCol(new THREE.CylinderGeometry(1.5, 1.5, 1.1, 8).translate(0, 0.55, 0), M); }
  // the church, its door to the road and its spire over the village
  {
    const M = building(s, -38, 40, Math.PI / 2, 22, 12, 8, { roof: 'gable', wall: 0xe6e2d6, roofCol: 0x4a4f55, lit: 0.25 });
    const g = new GB(); g.box(5, 15, 5, -12, 7.5, 0, 0xe6e2d6); g.cone(3.4, 10, 4, -12, 20, 0, 0x4a4f55, 0, Math.PI / 4, 0); s.put(g, M); s.boxCol(M, 5, 15, 5, -12, 7.5, 0);
    for (let i = 0; i < 6; i++) { const M2 = s.frame(-56 + (i % 3) * 4, 52 + Math.floor(i / 3) * 4), g2 = new GB(); g2.box(0.6, 0.9, 0.2, 0, 0.45, 0, 0x9b968c); s.put(g2, M2); }
  }
  // a shop and a pub at the corner
  building(s, 22, -24, 0, 14, 10, 5.5, { wall: 0xcfb08a, awning: 0x2f8f86, floors: 1, lit: 0.8, roof: 'gable', roofCol: 0x6b3a2a });
  building(s, 42, -22, 0, 16, 11, 6, { wall: 0xe0c3b0, awning: 0xc8432f, floors: 1, lit: 0.8, roof: 'gable', roofCol: 0x4a4f55, chimney: true });
  const walls = [0xe6dcc8, 0xd9c7a8, 0xc9d6dc, 0xe0c3b0, 0xf0ead8, 0xe8d8b8];
  const house = (u, v, ang) => { building(s, u, v, ang, 9 + rng() * 2, 8 + rng() * 2, 3.4 + (rng() < 0.4 ? 3 : 0), { roof: 'gable', wall: walls[Math.floor(rng() * walls.length)], roofCol: [0x6b3a2a, 0x4a4f55, 0x7a3b30][Math.floor(rng() * 3)], chimney: rng() < 0.6, lit: 0.45 }); if (rng() < 0.7) tree(s, u + (rng() - 0.5) * 6, v + 10 * Math.sign(v || 1), 0.8); };
  for (const u of [-62, -46, -26, 62]) house(u, -17, 0);
  for (const u of [-62]) house(u, 17, Math.PI);
  for (const v of [-62, -44]) { house(17, v, Math.PI / 2); house(-17, v, -Math.PI / 2); }
  for (const v of [60]) house(17, v + 2, Math.PI / 2);
  // a pond, hedges and trees round the edge
  s.disc(-50, -50, 0, 7, rgb(0x3b7fa6), 0.09);
  for (let i = 0; i < 14; i++) { const a = i / 14 * TAU + rng() * 0.2, r = 64 + rng() * 6, u = Math.cos(a) * r, v = Math.sin(a) * r; if (Math.abs(u) > 9 && Math.abs(v) > 9) tree(s, u, v, 0.9 + rng() * 0.4); }
  for (const [u, v] of [[-20, 8], [20, 8], [-8, -20], [8, 20], [8, -60]]) lamp(s, u, v, 0, 6);
  s.finish();
}
function buildFarm(gs) {
  const s = gsite(gs, 8000), rng = s.rng, gravel = rgb(0x9c8f78), lane = rgb(0x8b7d66);
  // the yard at the -u end, the fields beyond
  s.rect(-86, 0, 72, 120, 0, gravel, 0.07);
  s.rect(-118, 0, 16, 7, 0, lane, 0.08); s.rect(-85, 74, 7, 30, 0, lane, 0.08); s.rect(-85, -74, 7, 30, 0, lane, 0.08);
  s.rect(-40, 0, 20, 6, 0, lane, 0.08);   // a track out into the fields
  // farmhouse, barn, silos and a machine shed
  building(s, -106, 36, Math.PI, 13, 10, 6, { roof: 'gable', wall: 0xf0ead8, roofCol: 0x6b3a2a, chimney: true, lit: 0.5 });
  const red = gs.label.startsWith('Red') ? 0xb0322a : 0x9c3a2e;
  {
    const big = gs.label.startsWith('Red') ? 1.25 : 1;
    const M = s.frame(-70, 30, Math.PI / 2), g = new GB(), W = 18 * big, D = 28 * big, H = 7 * big, rh = 6 * big;
    // walls on three sides and an open front, so you can drive in
    g.box(W, H, 0.5, 0, H / 2, -D / 2, red); s.boxCol(M, W, H, 0.5, 0, H / 2, -D / 2);
    for (const x of [-1, 1]) { g.box(0.5, H, D, x * W / 2, H / 2, 0, red); s.boxCol(M, 0.5, H, D, x * W / 2, H / 2, 0); }
    g.box(W, 1.2, 0.5, 0, H - 0.6, D / 2, red);
    g.poly({ V: [[-W / 2 - 0.4, 0, -D / 2 - 0.4], [W / 2 + 0.4, 0, -D / 2 - 0.4], [W / 2 + 0.4, 0, D / 2 + 0.4], [-W / 2 - 0.4, 0, D / 2 + 0.4], [0, rh, -D / 2 - 0.4], [0, rh, D / 2 + 0.4]], F: [[0, 1, 2, 3], [0, 3, 5, 4], [1, 2, 5, 4], [0, 1, 4], [3, 2, 5]] }, 0x5a5f63, 0, H, 0);
    for (const x of [-W / 4, W / 4]) g.box(0.3, H * 0.8, 0.1, x, H * 0.4, D / 2 + 0.3, 0xe8ebe7);
    s.put(g, M); s.boxCol(M, W, 1, D, 0, H + 0.5, 0, 'roof');
    s.polyCol(M, [[-W / 2, H + 1, -D / 2], [W / 2, H + 1, -D / 2], [W / 2, H + 1, D / 2], [-W / 2, H + 1, D / 2], [0, H + rh, -D / 2], [0, H + rh, D / 2]], [[0, 1, 2, 3], [0, 3, 5, 4], [1, 2, 5, 4], [0, 1, 4], [3, 2, 5]]);
  }
  for (const [u, v, r, h] of [[-58, -24, 3.6, 16], [-58, -34, 3.6, 16], [-50, -29, 2.6, 12]]) {
    const M = s.frame(u, v), g = new GB(); g.cyl(r, r, h, 16, 0, h / 2, 0, 0xc8ccd0); g.add(new THREE.SphereGeometry(r, 16, 6, 0, TAU, 0, Math.PI / 2), 0x9aa4aa, 0, h, 0);
    for (let y = 2; y < h; y += 3) g.cyl(r + 0.05, r + 0.05, 0.25, 16, 0, y, 0, 0x8c99a3);
    s.put(g, M); s.geoCol(new THREE.CylinderGeometry(r, r, h, 10).translate(0, h / 2, 0), M);
  }
  {
    const M = s.frame(-104, -34, 0), g = new GB();
    for (const [x, z] of [[-8, -5], [8, -5], [-8, 5], [8, 5], [0, 5], [0, -5]]) { g.box(0.4, 4.5, 0.4, x, 2.25, z, 0x6b4a2f); s.boxCol(M, 0.4, 4.5, 0.4, x, 2.25, z); }
    g.box(17.6, 0.3, 11.4, 0, 4.6, 0, 0x7d878d); s.boxCol(M, 17.6, 0.3, 11.4, 0, 4.6, 0); g.box(17, 4.5, 0.3, 0, 2.25, -5.6, 0x8a6a4a); s.boxCol(M, 17, 4.5, 0.3, 0, 2.25, -5.6);
    s.put(g, M);
    for (let i = 0; i < 4; i++) s.loose('barrel', -110 + i * 1.2, -30);
  }
  // a fence along the edge of the fields, with a gap for the track
  {
    const g = new GB(), M = s.frame(-47, 0, Math.PI / 2);
    for (let z = -88; z <= 88; z += 4) if (Math.abs(z) > 5) g.box(0.15, 1.3, 0.15, z, 0.65, 0, 0x6b4a2f);
    for (const [a, b] of [[-88, -5], [5, 88]]) for (const y of [0.55, 1.1]) g.box(b - a, 0.12, 0.06, (a + b) / 2, y, 0, 0x8a6a4a);
    s.put(g, M);
    for (const [a, b] of [[-88, -5], [5, 88]]) s.boxCol(M, b - a, 1.2, 0.2, (a + b) / 2, 0.6, 0);
  }
  // hay bales out in the fields
  for (let k = 0; k < 4; k++) {
    const cu = -20 + rng() * 120, cv = (rng() - 0.5) * 140;
    for (let i = 0; i < 3 + Math.floor(rng() * 3); i++) {
      const u = cu + (rng() - 0.5) * 14, v = cv + (rng() - 0.5) * 14, M = s.frame(u, v, rng() * TAU), g = new GB();
      g.cyl(0.8, 0.8, 1.3, 12, 0, 0.8, 0, 0xd9b45a, Math.PI / 2, 0, 0); s.put(g, M); s.boxCol(M, 1.3, 1.6, 1.4, 0, 0.8, 0);
    }
  }
  // a windmill on Windmill Farm, sails turning in the wind; a water pump on the others
  if (gs.label.startsWith('Windmill')) {
    const M = s.frame(-110, -62, Math.PI / 2), g = new GB(), H = 15;
    g.cyl(2.8, 4.2, H, 8, 0, H / 2, 0, 0xe6e2d6); g.cone(3.4, 4, 8, 0, H + 2, 0, 0x6b3a2a); g.box(1.4, 2.4, 0.2, 0, 1.2, 4.1, 0x4a3426);
    s.put(g, M); s.geoCol(new THREE.CylinderGeometry(3.4, 4.2, H, 8).translate(0, H / 2, 0), M);
    // the sails: their own little mesh, turned each frame
    const sg = new GB(); sg.cyl(0.5, 0.5, 1.6, 10, 0, 0, 0, 0x5a4636, Math.PI / 2, 0, 0);
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; sg.box(0.35, 7.5, 0.15, Math.sin(a) * 4, Math.cos(a) * 4, 0.5, 0x6b4a2f, 0, 0, -a); sg.box(1.6, 6.2, 0.08, Math.sin(a) * 4.6 + Math.cos(a) * 0.9, Math.cos(a) * 4.6 - Math.sin(a) * 0.9, 0.55, 0xe8e2d0, 0, 0, -a); }
    SITES.anim.push({ kind: 'spin', site: s, M: M.clone().multiply(new THREE.Matrix4().makeTranslation(0, H + 0.8, 3.6)), gb: sg, speed: 0.7 });
  } else {
    const M = s.frame(-62, 62), g = new GB(), H = 10;
    for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) g.box(0.15, H, 0.15, x * (1 - 0), H / 2, z, 0x8c99a3);
    g.box(0.3, 0.3, 1.2, 0, H + 0.2, -0.4, 0x8c99a3);
    s.put(g, M); s.boxCol(M, 2.6, H, 2.6, 0, H / 2, 0);
    const sg = new GB(); for (let k = 0; k < 12; k++) { const a = k / 12 * TAU; sg.box(0.25, 1.5, 0.05, Math.sin(a) * 0.9, Math.cos(a) * 0.9, 0, 0xc9cfd4, 0, 0, -a); }
    SITES.anim.push({ kind: 'spin', site: s, M: M.clone().multiply(new THREE.Matrix4().makeTranslation(0, H + 0.2, 0.4)), gb: sg, speed: 1.6 });
  }
  // a pond for the cows that aren't here
  s.disc(-104, 64, 0, 6, rgb(0x3b7fa6), 0.09);
  for (const [u, v] of [[-120, 52], [-92, 50], [-120, -50]]) tree(s, u, v, 1);
  s.finish();
}
/* ---------- stations ---------- */
function buildStation(st) {
  const s = new Site(st.name, PLANET, st.C, st.E1, st.E3, st.h); s.cull = 6000;
  const two = st.tracks > 1, PH = 1.15, PL = 2 * PLAT_HALF;
  // the platform: an island between two tracks, or alongside one
  const pv = two ? 0 : 4.6, pw = two ? 7.6 : 5.6;
  {
    const M = s.frame(0, pv, 0), g = new GB();
    fbox(g, PL, PH, pw, 0, PH / 2, 0, 0xb9b8b2); fbox(g, PL, 0.05, 0.5, 0, PH + 0.02, pw / 2 - 0.35, 0xf2c230); if (two) fbox(g, PL, 0.05, 0.5, 0, PH + 0.02, -pw / 2 + 0.35, 0xf2c230);
    s.put(g, M); s.boxCol(M, PL, PH, pw, 0, PH / 2, 0);
    // ramps at both ends to drive up
    wedge(s, s.frame(-PL / 2 - 12, pv, 0), 12, pw, PH, 0xa9a8a2);
    wedge(s, s.frame(PL / 2 + 12, pv, Math.PI), 12, pw, PH, 0xa9a8a2);
  }
  // a canopy over the middle, benches, lamps and the name boards
  {
    const M = s.frame(0, pv, 0), g = new GB(), gl = new GB(), cw = pw - 1.2;
    for (const x of [-16, -8, 0, 8, 16]) { fbox(g, 0.3, 3.4, 0.3, x, PH + 1.7, 0, 0x5a636a); s.boxCol(M, 0.3, 3.4, 0.3, x, PH + 1.7, 0); }
    fbox(g, 38, 0.35, cw + 1, 0, PH + 3.55, 0, 0x2f6f9f); s.boxCol(M, 38, 0.35, cw + 1, 0, PH + 3.55, 0);
    fbox(gl, 34, 0.08, 0.4, 0, PH + 3.33, 0, 0xfff1c4);
    for (const x of [-12, -4, 4, 12]) { fbox(g, 2.4, 0.12, 0.6, x, PH + 0.5, 0, 0x7a5a3a); fbox(g, 2.4, 0.5, 0.1, x, PH + 0.8, -0.3, 0x7a5a3a); }
    s.put(g, M); s.put(gl, M, true);
    for (const x of [-50, -30, 30, 50]) { const Ml = s.frame(x, pv, 0), g2 = new GB(), gl2 = new GB(); fbox(g2, 0.2, 5, 0.2, 0, PH + 2.5, 0, 0x5a636a); fbox(gl2, 0.6, 0.3, 0.6, 0, PH + 5, 0, 0xfff1c4); s.put(g2, Ml); s.put(gl2, Ml, true); s.boxCol(Ml, 0.2, 5, 0.2, 0, PH + 2.5, 0); }
    for (const x of [-24, 24]) s.sign(s.frame(x, pv, 0).multiply(new THREE.Matrix4().makeTranslation(0, PH + 2.6, 0)), st.label, 7, 1.1, { bg: '#1f4f7a' });
  }
  // a little ticket hall on the town side, the line's colour on its roof
  {
    const v0 = two ? 16 + 9 : pv + pw / 2 + 7;
    building(s, 0, v0, 0, 18, 9, 4.5, { wall: 0xe6e2d6, floors: 1, lit: 0.7, trim: st.uses[0].line.col, awning: st.uses[0].line.col });
    s.rect(0, v0 - 7, 10, 5, 0, rgb(0xa9a8a2), 0.1);
  }
  // buffer stops where a line ends here
  for (const u of st.uses) if (!u.prev || !u.next) {
    const L = GLOBE.rails.find(r => r.name === u.line.name); if (!L) continue;
    // the end of the track on this side: its far point past the platform
    const end = u.prev ? L.pts[L.pts.length - 1] : L.pts[0], [eu] = siteUV(s, end.d);
    const sg = Math.sign(eu) || 1, M = s.frame(eu + sg * 2, u.off, 0), g = new GB();
    fbox(g, 1.2, 1.2, 3.2, 0, 0.9, 0, 0xc8432f); for (const z of [-0.8, 0.8]) fbox(g, 0.3, 0.5, 0.5, -sg * 0.75, 1.2, z, 0xe8ebe7);
    s.put(g, M); s.boxCol(M, 1.2, 1.5, 3.2, 0, 0.75, 0);
  }
  s.finish();
}
/* where a direction sits in a site's own (u, v) */
function siteUV(s, d) { const a = Math.acos(clamp(d.dot(s.C), -1, 1)) * s.R, px = d.dot(s.E1), pz = d.dot(s.E3), l = Math.hypot(px, pz) || 1; return [px / l * a, pz / l * a]; }
/* ---------- the landmarks ---------- */
function buildSummit(m) {
  const s = new Site('summit', PLANET, m.C, m.E1, m.E3, m.h); s.cull = 9000;
  s.rect(0, 0, 66, 66, 0, rgb(0x9a9890), 0.06);
  // the helipad
  s.disc(-14, -6, 0, 10, rgb(0x5d6066)); s.disc(-14, -6, 8.6, 9.3, rgb(0xeeeeea), 0.12);
  s.rect(-16.6, -6, 1, 8, 0, rgb(0xeeeeea), 0.12); s.rect(-11.4, -6, 1, 8, 0, rgb(0xeeeeea), 0.12); s.rect(-14, -6, 5.2, 1, 0, rgb(0xeeeeea), 0.12);
  { const gl = new GB(); for (let k = 0; k < 12; k++) { const a = k / 12 * TAU; fbox(gl, 0.4, 0.25, 0.4, Math.cos(a) * 10.4, 0.13, Math.sin(a) * 10.4, 0xff9a3b); } s.put(gl, s.frame(-14, -6), true); }
  // the observatory: a drum with a white dome and a dark slit
  {
    const M = s.frame(12, 12, 0.4), g = new GB(), gl = new GB();
    g.cyl(7, 7, 6, 20, 0, 3, 0, 0xd8d6cf); g.add(new THREE.SphereGeometry(7.2, 20, 8, 0, TAU, 0, Math.PI / 2), 0xf2f2ee, 0, 6, 0);
    g.box(1.8, 6.5, 0.6, 0, 9.2, 4.2, 0x2b3137, -0.55, 0, 0); fbox(g, 1.8, 2.4, 0.2, 0, 1.2, 7.0, 0x4a3426);
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + 0.3; fbox(gl, 0.9, 0.6, 0.1, Math.cos(a) * 7.05, 3.6, Math.sin(a) * 7.05, 0xffd27a); }
    s.put(g, M); s.put(gl, M, true); s.geoCol(new THREE.CylinderGeometry(7, 7, 6, 10).translate(0, 3, 0), M); s.geoCol(new THREE.SphereGeometry(7.2, 10, 5, 0, TAU, 0, Math.PI / 2).translate(0, 6, 0), M);
  }
  // the radio mast: a lattice with red lights all the way up
  {
    const M = s.frame(16, -18), g = new GB(), gl = new GB(), H = 64;
    for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) fbox(g, 0.25, H, 0.25, x, H / 2, z, COLS.red);
    for (let y = 3; y < H; y += 3) { fbox(g, 2.6, 0.12, 0.12, 0, y, -1.2, 0xe8ebe7); fbox(g, 2.6, 0.12, 0.12, 0, y, 1.2, 0xe8ebe7); fbox(g, 0.12, 0.12, 2.6, -1.2, y, 0, 0xe8ebe7); fbox(g, 0.12, 0.12, 2.6, 1.2, y, 0, 0xe8ebe7); }
    for (const y of [20, 42, H]) fbox(gl, 0.5, 0.5, 0.5, 0, y + 0.4, 0, 0xff3b2b);
    g.add(new THREE.SphereGeometry(2, 12, 5, 0, TAU, 0, 1.1), 0xe8ebe7, 0, 30, 2.2, -1.2, 0, 0);
    s.put(g, M); s.put(gl, M, true); s.boxCol(M, 2.6, H, 2.6, 0, H / 2, 0);
  }
  // the hut, a bench and the sign with the height
  building(s, -16, 20, 0, 9, 7, 3.4, { roof: 'gable', wall: 0x8a6a4a, roofCol: 0x4a4f55, lit: 0.6, chimney: true });
  s.sign(s.frame(-2, -24, 0).multiply(new THREE.Matrix4().makeTranslation(0, 2.2, 0)), `Summit Station  ·  ${Math.round(m.peak)} m`, 8, 1.4, { bg: '#7a2f24' });
  { const M = s.frame(-2, -24, 0), g = new GB(); for (const x of [-3.6, 3.6]) fbox(g, 0.2, 2.2, 0.2, x, 1.1, 0, 0x5a4636); s.put(g, M); s.boxCol(M, 8, 0.4, 0.4, 0, 2.2, 0); }
  // a flag on the very top
  { const M = s.frame(0, 0), g = new GB(); fbox(g, 0.12, 8, 0.12, 0, 4, 0, 0xd8d6cf); fbox(g, 2.4, 1.4, 0.04, 1.2, 7.2, 0, 0xc8432f); s.put(g, M); s.boxCol(M, 0.2, 8, 0.2, 0, 4, 0); }
  s.finish();
}
function buildDeepBase(m) {
  const s = new Site('deepbase', PLANET, m.C, m.E1, m.E3, m.h); s.cull = 4000;
  s.rect(0, 0, 90, 90, 0, rgb(0x5a6266), 0.06);
  const dome = (u, v, r, col) => {
    const M = s.frame(u, v), g = new GB(), gl = new GB();
    g.add(new THREE.SphereGeometry(r, 20, 8, 0, TAU, 0, Math.PI / 2), col); g.cyl(r + 0.4, r + 0.4, 1, 20, 0, 0.5, 0, 0x5d6970);
    for (let k = 0; k < 10; k++) { const a = k / 10 * TAU; fbox(gl, 1.1, 0.7, 0.1, Math.cos(a) * r * 0.86, r * 0.42, Math.sin(a) * r * 0.86, 0x7fe0ff); }
    fbox(gl, 0.8, 0.8, 0.8, 0, r + 0.2, 0, 0xffd27a);
    s.put(g, M); s.put(gl, M, true); s.geoCol(new THREE.SphereGeometry(r, 10, 5, 0, TAU, 0, Math.PI / 2), M);
  };
  dome(0, 14, 11, 0xd9e2e6); dome(-24, 20, 7, 0xc9d6dc); dome(22, 24, 7, 0xc9d6dc); dome(-4, 36, 5, 0xe6ecef);
  for (const [u0, v0, u1, v1] of [[-17, 18, -10, 16], [10, 17, 16, 21], [-3, 25, -3, 31]]) { const ang = Math.atan2(v1 - v0, u1 - u0), L = Math.hypot(u1 - u0, v1 - v0), M = s.frame((u0 + u1) / 2, (v0 + v1) / 2, ang), g = new GB(); g.cyl(1.5, 1.5, L + 3, 12, 0, 1.7, 0, 0xb4c0c6, 0, 0, Math.PI / 2); s.put(g, M); s.geoCol(new THREE.CylinderGeometry(1.5, 1.5, L + 3, 8).rotateZ(Math.PI / 2).translate(0, 1.7, 0), M); }
  // the docking pad, ringed with lights
  s.disc(0, -18, 0, 13, rgb(0x6d7275)); s.disc(0, -18, 11.2, 12, rgb(0xf2c230), 0.12);
  { const gl = new GB(); for (let k = 0; k < 16; k++) { const a = k / 16 * TAU; fbox(gl, 0.5, 0.3, 0.5, Math.cos(a) * 13.4, 0.15, Math.sin(a) * 13.4, 0x52ff7a); } s.put(gl, s.frame(0, -18), true); }
  // a beacon tower, floodlights and a few crates of samples
  { const M = s.frame(30, -20), g = new GB(), gl = new GB(), H = 26; for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) fbox(g, 0.3, H, 0.3, x, H / 2, z, 0xe8692c); for (let y = 2; y < H; y += 3) fbox(g, 2.2, 0.15, 2.2, 0, y, 0, 0x8c99a3); fbox(gl, 1, 1, 1, 0, H + 0.6, 0, 0xffe25a); s.put(g, M); s.put(gl, M, true); s.boxCol(M, 2.3, H, 2.3, 0, H / 2, 0); }
  for (const [u, v] of [[-34, -30], [34, 4], [-30, 40]]) { const M = s.frame(u, v, Math.atan2(-v, -u)), g = new GB(), gl = new GB(); fbox(g, 0.4, 8, 0.4, 0, 4, 0, 0x8c99a3); fbox(g, 2, 1.2, 0.6, 0, 8, 0, 0x2b3137); fbox(gl, 1.8, 1, 0.1, 0, 8, 0.32, 0xfff6d8); s.put(g, M); s.put(gl, M, true); s.boxCol(M, 0.4, 8, 0.4, 0, 4, 0); }
  for (let i = 0; i < 4; i++) s.loose('crate', 18 + i * 1.1, -4);
  s.sign(s.frame(0, -36, 0).multiply(new THREE.Matrix4().makeTranslation(0, 2.4, 0)), `Deep Sea Base  ·  ${Math.round(m.peak)} m`, 8, 1.4, { bg: '#16485e' });
  { const M = s.frame(0, -36, 0), g = new GB(); for (const x of [-3.6, 3.6]) fbox(g, 0.25, 2.4, 0.25, x, 1.2, 0, 0x5d6970); s.put(g, M); }
  s.finish();
}
/* ---------- build it all: lazily, a piece at a time as the camera comes near ----------
   Only the trains and every place's spawn spots are made at load; each town, chunk of road or railway, station and
   landmark is built the first time the camera (or a vehicle placed there) comes within reach of it. */
const LAZY = { jobs: [], built: 0 };
function lazyJob(cel, C, h, r, name, fn) { LAZY.jobs.push({ cel, O: C.clone().multiplyScalar(cel.R + h), r, name, fn, done: false }); }
function runJob(j) {
  j.done = true; LAZY.built++;
  const n0 = SITES.loose.length;
  j.fn();
  if (SITES.loose.length > n0 && typeof spawnLoose === 'function') spawnLoose(n0);
}
/* build whatever is due near the camera: the nearest job first, a few milliseconds a frame */
const _lzp = new V3();
function runLazy(budgetMs) {
  const t0 = performance.now();
  for (;;) {
    let best = null, bd = Infinity;
    for (const j of LAZY.jobs) {
      if (j.done) continue;
      toSpin(j.cel, _lzp.subVectors(camera.position, j.cel.center), _lzp);
      const d = _lzp.distanceTo(j.O); if (d < j.r && d < bd) { bd = d; best = j; }
    }
    if (!best) return;
    runJob(best);
    if (performance.now() - t0 > budgetMs) return;
  }
}
/* everything within rad of a point in space, built now (before a vehicle is put there) */
function ensureBuiltNear(xw, rad = 2500) {
  for (const j of LAZY.jobs) {
    if (j.done) continue;
    toSpin(j.cel, _lzp.subVectors(xw, j.cel.center), _lzp);
    if (_lzp.distanceTo(j.O) < rad + (j.reach || 400)) runJob(j);
  }
}
/* a site's frame without building anything: enough for a spawn spot */
function frameSite(C, E1, E3, H) { return { H, dir: (u, v, out = new V3()) => expDir(C, E1, E3, PLANET.R, u, v, out) }; }
function globeSpawns() {
  for (const gs of GLOBE.sites) {
    const fs = frameSite(gs.C, gs.E1, gs.E3, gs.h);
    const at = { city: [0, -205, Math.PI / 2], town: [0, -70, Math.PI / 2], village: [-40, 0, 0], farm: [-118, -8, 0] }[gs.kind];
    WP.spawns[gs.name] = { name: gs.label, u: at[0], v: at[1], ang: at[2], site: fs, group: 'Towns' };
    if (gs.kind === 'city') WP.spawns.g_metro_tower = { name: 'Metro Tower roof', u: 45, v: -47, ang: Math.PI / 2, site: fs, group: 'Towns', y: METRO_H + 1.8 + 0.1 };
  }
  for (const st of GLOBE.stations) WP.spawns[st.name] = { name: st.label, u: -40, v: st.tracks > 1 ? 0 : 4.6, ang: 0, site: frameSite(st.C, st.E1, st.E3, st.h), group: 'Railways', y: 1.2 };
  const m = GLOBE.marks;
  if (m.summit) WP.spawns.summit = { name: `Summit Station (${Math.round(m.summit.peak)} m)`, u: -14, v: -6, ang: 0, site: frameSite(m.summit.C, m.summit.E1, m.summit.E3, m.summit.h), group: 'Landmarks' };
  if (m.deep) WP.spawns.deepbase = { name: `Deep Sea Base (${Math.round(m.deep.peak)} m)`, u: 0, v: -18, ang: Math.PI / 2, site: frameSite(m.deep.C, m.deep.E1, m.deep.E3, m.deep.h), group: 'Landmarks', y: 0.05 };
}
const METRO_H = 205;
function buildGlobe() {
  if (!GLOBE.sites.length && !GLOBE.roads.length) return;
  const t0 = performance.now();
  globeSpawns();
  for (const gs of GLOBE.sites) {
    const reach = gs.kind === 'city' ? 17500 : 10000;
    lazyJob(PLANET, gs.C, gs.h, reach, gs.label, () => {
      if (gs.kind === 'city') buildCity(gs);
      else if (gs.kind === 'town') { buildTown(gs.name, gs.label, 'small'); const s = SITES.list[SITES.list.length - 1]; if (s && s.name === gs.name) s.cull = 9000; }
      else if (gs.kind === 'village') buildVillage(gs);
      else buildFarm(gs);
    });
    LAZY.jobs[LAZY.jobs.length - 1].reach = Math.hypot(gs.a, gs.b);
  }
  const chunks = (list, pre, cull) => list.forEach((r, ri) => {
    const pts = r.pts, n = pts.length;
    for (let i0 = 0; i0 < n - 1; i0 += CHUNK) {
      const i1 = Math.min(n - 1, i0 + CHUNK), mid = pts[(i0 + i1) >> 1];
      lazyJob(PLANET, mid.d, mid.h, cull + 1300, pre + ri, () => { if (!r.side) r.side = pathSides(pts); (r.rail ? railChunk : roadChunk)(r, ri, i0, i1); });
      LAZY.jobs[LAZY.jobs.length - 1].reach = CHUNK * HW_STEP / 2 + 20;
    }
  });
  chunks(GLOBE.roads, 'hw', 4200); chunks(GLOBE.rails, 'rl', 4200);
  for (const st of GLOBE.stations) { lazyJob(PLANET, st.C, st.h, 7300, st.label, () => buildStation(st)); LAZY.jobs[LAZY.jobs.length - 1].reach = 200; }
  if (GLOBE.marks.summit) { const m = GLOBE.marks.summit; lazyJob(PLANET, m.C, m.h, 10500, 'summit', () => buildSummit(m)); }
  if (GLOBE.marks.deep) { const m = GLOBE.marks.deep; lazyJob(PLANET, m.C, m.h, 5300, 'deep', () => buildDeepBase(m)); }
  buildTrains();
  console.log(`globe ready in ${(performance.now() - t0).toFixed(0)} ms: ${LAZY.jobs.length} pieces to build as they come near`);
}
/* ================= trains =================
   Each line has one train shuttling between its end stations, stopping at every station on the way.
   Its cars are boxes that move with it; anything standing on a car is carried along by friction. */
const TRAIN = { list: [], VMAX: 38, ACC: 0.7, BRAKE: 0.9, DWELL: 22, ALAT: 1.6 };
const CAR_SPEC = { loco: { L: 16, h0: 0.55, h1: 4.4 }, coach: { L: 15, h0: 0.55, h1: 4.2 }, flat: { L: 13, h0: 0.5, h1: 1.35 } };
const TRAIN_W = 3.0, CAR_GAP = 1.2;
W.movers = [];
function buildTrains() {
  const R = PLANET.R;
  GLOBE.rails.forEach((L, li) => {
    const pts = L.pts, n = pts.length;
    const P = new Float64Array(n * 3), S = new Float64Array(n);
    for (let i = 0; i < n; i++) { const r = R + pts[i].h + 0.27; P[i * 3] = pts[i].d.x * r; P[i * 3 + 1] = pts[i].d.y * r; P[i * 3 + 2] = pts[i].d.z * r; if (i) S[i] = S[i - 1] + Math.hypot(P[i * 3] - P[i * 3 - 3], P[i * 3 + 1] - P[i * 3 - 2], P[i * 3 + 2] - P[i * 3 - 1]); }
    // where each station's middle is along the line
    const stops = L.stations.map(st => {
      const u = st.uses.find(x => x.line.name === L.name), D = expDir(st.C, st.E1, st.E3, R, 0, u.off, new V3());
      let bi = 0, bd = 1e9; for (let i = 0; i < n; i++) { const dd = pts[i].d.distanceToSquared(D); if (dd < bd) { bd = dd; bi = i; } }
      return S[bi];
    });
    // the speed each point of the line can be taken at: gentle on bends and over crests and dips
    const vlim = new Float32Array(n).fill(TRAIN.VMAX), q = i => new V3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    for (let i = 2; i < n - 2; i++) {
      const a = q(i - 2), b = q(i), c = q(i + 2), t1 = b.clone().sub(a), t2 = c.clone().sub(b), l = (t1.length() + t2.length()) / 2;
      const k = Math.acos(clamp(t1.normalize().dot(t2.normalize()), -1, 1)) / (l || 1);
      if (k > 1e-6) vlim[i] = Math.min(TRAIN.VMAX, Math.sqrt(TRAIN.ALAT / k));
    }
    const kinds = ['loco', 'flat', 'coach', 'flat', 'loco'];
    let len = 0; const offs = kinds.map(k => { const o = len + CAR_SPEC[k].L / 2; len += CAR_SPEC[k].L + CAR_GAP; return o; }); len -= CAR_GAP;
    const tr = { line: L, P, S, n, stops, vlim, k: 0, tgt: 1, dir: 1, s: stops[0], v: 0, dwell: 30 + li * 25, len, cars: [], idx: li };
    tr.cars = kinds.map((k, j) => {
      const spec = CAR_SPEC[k], hx = spec.L / 2, hy = (spec.h1 - spec.h0) / 2, hz = TRAIN_W / 2;
      const pr = { c: new V3(), r: Math.hypot(hx, hy, hz), planes: [0, 1, 2, 3, 4, 5].map(() => ({ nx: 0, ny: 0, nz: 0, d: 0, int: 0 })), cel: PLANET, tag: 'train', mu: 0.9, _s: 0, mover: true,
        mv: new V3(), mw: new V3(), base: new V3(), X: new V3(1, 0, 0), Y: new V3(0, 1, 0), Z: new V3(0, 0, 1), hx, hy, hz, h0: spec.h0, spec, kind: k, off: offs[j] - len / 2, flip: j === kinds.length - 1, prevC: null, prevX: new V3() };
      W.movers.push(pr);
      return pr;
    });
    trainPose(tr, 0);
    trainMeshes(tr);
    TRAIN.list.push(tr);
  });
}
/* a point on the line at distance s along it */
function railAt(tr, s, out) {
  const S = tr.S, n = tr.n, P = tr.P;
  s = clamp(s, 0, S[n - 1]);
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
  const t = (s - S[lo]) / ((S[hi] - S[lo]) || 1);
  // a Catmull-Rom curve through the points, so the cars turn smoothly rather than in little jerks at each one
  const a = Math.max(0, lo - 1), d = Math.min(n - 1, hi + 1), t2 = t * t, t3 = t2 * t;
  const w0 = -0.5 * t3 + t2 - 0.5 * t, w1 = 1.5 * t3 - 2.5 * t2 + 1, w2 = -1.5 * t3 + 2 * t2 + 0.5 * t, w3 = 0.5 * t3 - 0.5 * t2;
  return out.set(P[a * 3] * w0 + P[lo * 3] * w1 + P[hi * 3] * w2 + P[d * 3] * w3, P[a * 3 + 1] * w0 + P[lo * 3 + 1] * w1 + P[hi * 3 + 1] * w2 + P[d * 3 + 1] * w3, P[a * 3 + 2] * w0 + P[lo * 3 + 2] * w1 + P[hi * 3 + 2] * w2 + P[d * 3 + 2] * w3);
}
const _tf = new V3(), _tr = new V3(), _tc = new V3(), _tu = new V3();
/* place every car of a train on the rails; dt > 0 also gives each car its velocity */
function trainPose(tr, dt) {
  for (const c of tr.cars) {
    const sc = tr.s + c.off, b = c.spec.L * 0.36;
    railAt(tr, sc + b, _tf); railAt(tr, sc - b, _tr);
    _tc.addVectors(_tf, _tr).multiplyScalar(0.5);
    c.X.subVectors(_tf, _tr).normalize();
    _tu.copy(_tc).normalize();
    c.Y.copy(_tu).addScaledVector(c.X, -_tu.dot(c.X)).normalize();
    c.Z.crossVectors(c.X, c.Y);
    if (dt > 0 && c.prevC) {
      c.mv.subVectors(_tc, c.prevC).divideScalar(dt);
      c.mw.crossVectors(c.prevX, c.X).divideScalar(dt);
    } else { c.mv.set(0, 0, 0); c.mw.set(0, 0, 0); }
    c.prevC = (c.prevC || new V3()).copy(_tc); c.prevX.copy(c.X);
    c.base.copy(_tc);
    // the collider: a box from h0 to h1 above the rails
    c.c.copy(_tc).addScaledVector(c.Y, c.h0 + c.hy);
    const pl = c.planes, ax = [c.X, c.Y, c.Z], hh = [c.hx, c.hy, c.hz];
    for (let a = 0; a < 3; a++) for (let sg = 0; sg < 2; sg++) {
      const p = pl[a * 2 + sg], v = ax[a], k = sg ? -1 : 1;
      p.nx = v.x * k; p.ny = v.y * k; p.nz = v.z * k; p.d = (v.x * c.c.x + v.y * c.c.y + v.z * c.c.z) * k + hh[a];
    }
  }
}
/* the velocity of a train car at a point (world-own frame) */
function moverVel(pr, p, out) { const r = _mvr.subVectors(p, pr.c); return out.copy(pr.mv).add(_mvw.crossVectors(pr.mw, r)); }
const _mvr = new V3(), _mvw = new V3();
function trainsStep(dt) {
  for (const tr of TRAIN.list) {
    if (tr.dwell > 0) {
      tr.dwell -= dt; tr.v = 0;
      if (tr.dwell <= 0) {
        if (tr.k + tr.dir < 0 || tr.k + tr.dir >= tr.stops.length) tr.dir = -tr.dir;
        tr.tgt = tr.k + tr.dir;
        if (typeof SND !== 'undefined') SND.at('trainhorn', fromSpin(PLANET, tr.cars[tr.dir > 0 ? tr.cars.length - 1 : 0].base, _tn).add(PLANET.center), 4);
      }
    } else {
      const dist = (tr.stops[tr.tgt] - tr.s) * tr.dir;
      const vb = Math.sqrt(2 * TRAIN.BRAKE * Math.max(0, dist));
      tr.v = Math.min(TRAIN.VMAX, tr.v + TRAIN.ACC * dt, vb, trainLimit(tr));
      tr.s += tr.v * tr.dir * dt;
      if (dist - tr.v * dt <= 0.02 || (tr.v < 0.03 && dist < 0.5)) { tr.s = tr.stops[tr.tgt]; tr.v = 0; tr.k = tr.tgt; tr.dwell = TRAIN.DWELL; }
    }
    trainPose(tr, dt);
    // anything asleep on or against a moving train wakes up, so it rides along or gets shoved
    if (tr.v > 0.01) for (const b of W.bodies) if (b.asleep && !b.dead && trainNear(tr, b.x, b.radius + 4)) b.wake();
  }
}
/* the fastest the train may go now: no car over its bend's limit, and able to slow in time for the next */
function trainLimit(tr) {
  const S = tr.S, n = tr.n, V = tr.vlim, B2 = 2 * TRAIN.BRAKE * 0.8;
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= tr.s) lo = m; else hi = m; }
  let v = TRAIN.VMAX;
  const span = Math.ceil(tr.len / 2 / RAIL_STEP) + 1;
  for (let i = Math.max(0, lo - span); i <= Math.min(n - 1, lo + span); i++) v = Math.min(v, V[i]);
  // ahead: everything within braking distance of full speed
  const reach = Math.ceil((TRAIN.VMAX * TRAIN.VMAX / B2 + tr.len / 2) / RAIL_STEP);
  for (let k = 1; k <= reach; k++) {
    const i = lo + tr.dir * k; if (i < 0 || i >= n) break;
    const d = Math.max(0, Math.abs(S[i] - tr.s) - tr.len / 2);
    v = Math.min(v, Math.sqrt(V[i] * V[i] + B2 * d));
  }
  return Math.max(v, 2);
}
const _tn = new V3();
function trainNear(tr, xw, rad) {
  toSpin(PLANET, _tn.subVectors(xw, PLANET.center), _tn);
  for (const c of tr.cars) if (_tn.distanceTo(c.c) < c.r + rad) return true;
  return false;
}
/* ---------- how the cars look ---------- */
const TRAIN_GEO = {};
function carGeo(kind, col) {
  const key = kind + col; if (TRAIN_GEO[key]) return TRAIN_GEO[key];
  const g = new GB(), gl = new GB(), sp = CAR_SPEC[kind], L = sp.L, hx = L / 2, w = TRAIN_W;
  // bogies and wheels
  for (const x of [-hx * 0.72, hx * 0.72]) {
    fbox(g, 3.2, 0.5, 2.4, x, 0.55, 0, 0x2b3137);
    for (const dx of [-0.9, 0.9]) for (const z of [-0.78, 0.78]) g.cyl(0.42, 0.42, 0.14, 12, x + dx, 0.42, z, 0x3a3f44, Math.PI / 2, 0, 0);
  }
  if (kind === 'flat') {
    fbox(g, L, 0.45, w, 0, 0.95, 0, 0x2f3539, true);
    fbox(g, L, 0.4, w, 0, 1.15 + 0.0, 0, 0x7a5a3a);
    for (let x = -hx + 0.6; x < hx; x += 1.2) fbox(g, 0.06, 0.02, w, x, 1.36, 0, 0x5a4636);
    for (const z of [-1, 1]) fbox(g, L, 0.25, 0.12, 0, 1.0, z * (w / 2 + 0.02), col);
  } else if (kind === 'coach') {
    fbox(g, L, 0.5, w, 0, 0.85, 0, 0x2f3539, true);
    fbox(g, L, 3.0, w, 0, 2.6, 0, 0xe8e2d0);
    fbox(g, L + 0.02, 0.45, w + 0.02, 0, 1.6, 0, col);
    fbox(g, L - 0.4, 0.3, w - 0.3, 0, 4.25, 0, 0x8a949c);
    for (let x = -hx + 1.8; x < hx - 1.2; x += 1.9) for (const z of [-1, 1]) fbox(gl, 1.3, 0.9, 0.04, x, 2.9, z * (w / 2 + 0.02), 0xffd98a);
    for (const z of [-1, 1]) for (const x of [-hx + 0.9, hx - 0.9]) fbox(g, 0.9, 2.2, 0.05, x, 2.2, z * (w / 2 + 0.03), 0x5a636a);
  } else {
    fbox(g, L, 0.5, w, 0, 0.85, 0, 0x2f3539, true);
    fbox(g, L - 3, 2.9, w, -1.5, 2.55, 0, col);
    fbox(g, L - 3, 0.3, w + 0.02, -1.5, 2.2, 0, 0xf2f2ee);
    fbox(g, 3, 2.3, w, hx - 1.5, 2.25, 0, col);
    fbox(g, 2.4, 0.6, w - 0.4, hx - 2.0, 3.7, 0, shade(col, 0.7));
    fbox(gl, 0.05, 0.9, w - 0.8, hx + 0.01, 2.85, 0, 0x9fd4ff);
    for (const z of [-0.9, 0.9]) { fbox(gl, 0.05, 0.3, 0.4, hx + 0.02, 1.55, z, 0xfff6d8); fbox(gl, 0.05, 0.25, 0.3, -hx - 0.02, 1.55, z, 0xff3b2b); }
    for (let x = -hx + 1.5; x < hx - 4; x += 2.2) for (const z of [-1, 1]) fbox(g, 1.2, 1.2, 0.04, x, 3.0, z * (w / 2 + 0.02), 0x8a949c);
    fbox(g, L - 5, 0.4, 1.4, -2, 4.2, 0, 0x5a636a);
  }
  return (TRAIN_GEO[key] = { body: g.geometry(), glow: gl.P.length ? gl.geometry() : null });
}
function trainMeshes(tr) {
  const grp = SITES.groups.get(PLANET) || (() => { const g = new THREE.Group(); scene.add(g); SITES.groups.set(PLANET, g); return g; })();
  for (const c of tr.cars) {
    const geo = carGeo(c.kind, tr.line.col);
    c.mesh = new THREE.Mesh(geo.body, MAT.site); c.mesh.matrixAutoUpdate = false; c.mesh.castShadow = true; c.mesh.receiveShadow = true;
    grp.add(c.mesh);
    if (geo.glow) { c.gmesh = new THREE.Mesh(geo.glow, MAT.glow); c.gmesh.matrixAutoUpdate = false; grp.add(c.gmesh); }
  }
}
const _tm = new THREE.Matrix4(), _tflip = new THREE.Matrix4().makeRotationY(Math.PI);
function drawTrains(camL) {
  for (const tr of TRAIN.list) {
    const vis = camL.distanceTo(tr.cars[2].base) < 6000;
    for (const c of tr.cars) {
      c.mesh.visible = vis; if (c.gmesh) c.gmesh.visible = vis;
      if (!vis) continue;
      _tm.makeBasis(c.X, c.Y, c.Z).setPosition(c.base);
      if (c.flip) _tm.multiply(_tflip);
      c.mesh.matrix.copy(_tm); c.mesh.matrixWorldNeedsUpdate = true;
      if (c.gmesh) { c.gmesh.matrix.copy(_tm); c.gmesh.matrixWorldNeedsUpdate = true; }
    }
  }
}
/* a ride on a train: the vehicle starts on the train's middle flat car, moving with it */
function spawnOnTrain(b, li) {
  const tr = TRAIN.list[li]; if (!tr) return null;
  const c = tr.cars[1];
  const up = fromSpin(PLANET, c.Y, new V3()), fwd = fromSpin(PLANET, c.X, new V3());
  const fr = frameAt(up, fwd);
  const top = fromSpin(PLANET, c.base.clone().addScaledVector(c.Y, c.spec.h1), new V3()).add(PLANET.center);
  const vel = surfaceVel(PLANET, top, new V3()).add(fromSpin(PLANET, c.mv, new V3()));
  placeBody(b, fr, top, vel, 0.25);
  spinVec(PLANET, b.w);
  if (b.v.length() > 0) syncMachine(b);
  return fr;
}

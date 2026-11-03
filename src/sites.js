'use strict';
/* ================= Scrapline · the built world: buildings, roads, tracks and loose props =================
   Every site is drawn as a few merged meshes that ride along with their world (cheap on a Chromebook),
   and gets solid convex colliders for its buildings, ramps and decks. Cones, barrels and crates are real
   little bodies you can knock over; they go back in place when you return to the builder. */
const SITES = { groups: new Map(), list: [], loose: [], looseBodies: [], gates: [], race: null, anim: [], mats: null };
const BOX_F = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]];
const _sv1 = new V3(), _sv3 = new V3();
/* a growing pile of triangles (positions relative to the site origin) */
class Acc {
  constructor() { this.P = []; this.N = []; this.C = []; this.G = []; this.anyG = false; }
  // ground: true when gb is in an object frame with its floor at y = 0 (so its base can be shaded darker)
  addGB(gb, M, ground) {
    const e = M.elements, P = gb.P, N = gb.N;
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      this.P.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
      const nx = N[i], ny = N[i + 1], nz = N[i + 2];
      this.N.push(e[0] * nx + e[4] * ny + e[8] * nz, e[1] * nx + e[5] * ny + e[9] * nz, e[2] * nx + e[6] * ny + e[10] * nz);
      this.G.push(ground ? y + 10 : 0);
    }
    if (ground) this.anyG = true;
    for (const c of gb.C) this.C.push(c);
  }
  quad(a, b, c, d, col, n) {   // a b c d around the quad; wound to face n whichever way they were given
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    const flip = (uy * vz - uz * vy) * n.x + (uz * vx - ux * vz) * n.y + (ux * vy - uy * vx) * n.z < 0;
    for (const v of flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d]) { this.P.push(v.x, v.y, v.z); this.N.push(n.x, n.y, n.z); this.C.push(col[0], col[1], col[2]); this.G.push(0); }
  }
  mesh(mat, shadow) {
    if (!this.P.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    if (this.anyG) g.setAttribute('gy', new THREE.Float32BufferAttribute(this.G, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.castShadow = !!shadow; m.receiveShadow = true;
    return m;
  }
}
const rgb = h => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
class Site {
  constructor(name, cel, C, E1, E3, H) {
    this.name = name; this.cel = cel; this.R = cel.R; this.C = C.clone(); this.E1 = E1.clone(); this.E3 = E3.clone(); this.H = H;
    this.O = C.clone().multiplyScalar(cel.R + H);
    this.solid = new Acc(); this.decal = new Acc(); this.glow = new Acc();
    this.rng = mulberry32(name.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0);
    SITES.list.push(this);
  }
  dir(u, v, out = new V3()) { return expDir(this.C, this.E1, this.E3, this.R, u, v, out); }
  at(u, v, y = 0, out = new V3()) { return this.dir(u, v, out).multiplyScalar(this.R + this.H + y); }
  /* object frame at (u, v): x along angle ang (0 = the site's along-axis), y up, z = x × y; returns world-own-frame matrix */
  frame(u, v, ang = 0, y = 0) {
    const up = this.dir(u, v), p = up.clone().multiplyScalar(this.R + this.H + y);
    const X = this.dir(u + Math.cos(ang), v + Math.sin(ang)).sub(up); X.addScaledVector(up, -X.dot(up)).normalize();
    const Z = new V3().crossVectors(X, up);
    return new THREE.Matrix4().makeBasis(X, up, Z).setPosition(p);
  }
  /* add an object built in its own frame */
  put(gb, M, glow) { const L = this.local(M); (glow ? this.glow : this.solid).addGB(gb, L, !glow); }
  local(M) { const L = M.clone(); L.elements[12] -= this.O.x; L.elements[13] -= this.O.y; L.elements[14] -= this.O.z; return L; }
  /* a solid box: drawn and collided */
  box(M, w, h, d, x, y, z, col, collide = true, draw = true) {
    if (draw) { const g = new GB(); g.box(w, h, d, x, y, z, col); this.put(g, M); }
    if (collide) this.boxCol(M, w, h, d, x, y, z);
  }
  boxCol(M, w, h, d, x, y, z, tag) {
    const V = [];
    for (let i = 0; i < 8; i++) V.push(new V3(x + (i & 4 ? w : -w) / 2, y + (i & 2 ? h : -h) / 2, z + (i & 1 ? d : -d) / 2).applyMatrix4(M));
    return makeCollider(V, BOX_F, this.cel, tag);
  }
  /* any convex shape from a three.js geometry, placed by M (object frame) and offset/rotated by T */
  geoCol(geo, M) {
    const g = geo.index ? geo.toNonIndexed() : geo, P = g.attributes.position, V = [], F = [];
    for (let i = 0; i < P.count; i++) V.push(new V3().fromBufferAttribute(P, i).applyMatrix4(M));
    for (let i = 0; i < P.count; i += 3) F.push([i, i + 1, i + 2]);
    return makeCollider(V, F, this.cel);
  }
  polyCol(M, pts, faces, internal) { return makeCollider(pts.map(p => new V3(p[0], p[1], p[2]).applyMatrix4(M)), faces, this.cel, null, internal); }
  /* a flat painted strip on the ground following (u, v) points: width w, lifted a little above the surface */
  strip(pts, w, col, lift = 0.09, dashed = 0) {
    const L = pts.length; if (L < 2) return;
    const up = new V3(), tg = new V3(), side = new V3(), a = new V3(), b = new V3(), c = new V3(), d = new V3();
    const P = pts.map(p => this.dir(p[0], p[1]));
    for (let i = 0; i < L - 1; i++) {
      if (dashed && (i % 2)) continue;
      const pa = pts[i], pb = pts[i + 1], ha = pa[2] || 0, hb = pb[2] || 0;
      const edge = (k, h, out1, out2) => {
        up.copy(P[k]); tg.subVectors(P[Math.min(L - 1, k + 1)], P[Math.max(0, k - 1)]).addScaledVector(up, -0).normalize();
        side.crossVectors(tg, up).normalize();
        const r = this.R + this.H + h + lift;
        out1.copy(up).addScaledVector(side, -w / 2 / this.R).normalize().multiplyScalar(r).sub(this.O);
        out2.copy(up).addScaledVector(side, w / 2 / this.R).normalize().multiplyScalar(r).sub(this.O);
      };
      edge(i, ha, a, b); edge(i + 1, hb, d, c);
      const n = new V3().copy(P[i]);
      this.decal.quad(a, b, c, d, col, n);
    }
  }
  /* a filled disc or ring on the ground */
  disc(u, v, r0, r1, col, lift = 0.1, seg = 32) {
    const n = this.dir(u, v), rr = this.R + this.H + lift;
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU;
      const p = (r, a) => this.dir(u + Math.cos(a) * r, v + Math.sin(a) * r).multiplyScalar(rr).sub(this.O);
      this.decal.quad(p(r0, a0), p(r1, a0), p(r1, a1), p(r0, a1), col, n);
    }
  }
  /* a filled rectangle on the ground (centre u, v; size along, across; turned by ang) */
  rect(u, v, la, lb, ang, col, lift = 0.08) {
    const ca = Math.cos(ang), sa = Math.sin(ang), n = this.dir(u, v), rr = this.R + this.H + lift;
    const nu = Math.max(1, Math.ceil(la / 12)), nv = Math.max(1, Math.ceil(lb / 12));
    const pt = (s, t) => { const x = (s - 0.5) * la, z = (t - 0.5) * lb; return this.dir(u + x * ca - z * sa, v + x * sa + z * ca).multiplyScalar(rr).sub(this.O); };
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) this.decal.quad(pt(i / nu, j / nv), pt((i + 1) / nu, j / nv), pt((i + 1) / nu, (j + 1) / nv), pt(i / nu, (j + 1) / nv), col, n);
  }
  loose(t, u, v, ang = 0, y = 0) { const M = this.frame(u, v, ang, y); SITES.loose.push({ t, M, cel: this.cel }); }
  finish() {
    let grp = SITES.groups.get(this.cel);
    if (!grp) { grp = new THREE.Group(); scene.add(grp); SITES.groups.set(this.cel, grp); }
    const ms = [this.solid.mesh(MAT.site, true), this.decal.mesh(MAT.decal, false), this.glow.mesh(MAT.glow, false)];
    for (const m of ms) if (m) { m.position.copy(this.O); grp.add(m); }
    // signs and the like: already placed in the world's own frame
    for (const m of this.extra || []) { grp.add(m); ms.push(m); }
    this.meshes = ms.filter(m => m);
    this.solid = this.decal = this.glow = null;
  }
}
/* ---------- little builders (object frame: x along, y up, z across; ground at y = 0) ---------- */
const COLS = { concrete: 0xb9b8b2, asphalt: 0x3a3c40, glass: 0x5f7f99, dark: 0x2b3137, white: 0xe8ebe7, red: 0xc8432f, orange: 0xe8692c, yellow: 0xf2c230, steel: 0x8c99a3, roof: 0x6b3a2a, green: 0x3f7a3a, trunk: 0x6b4a2f, brick: 0xa45a3c, sand: 0xc9ad78, blue: 0x2f6f9f, navy: 0x22344f };
function winRows(g, glow, w, d, h, floors, col, lit, rng, x0 = 0, z0 = 0) {
  // windows on all four faces (single quads): dark glass by day, some lit at night
  const fh = h / floors;
  for (let f = 0; f < floors; f++) {
    const y = fh * (f + 0.55);
    for (const [len, ry, ox, oz] of [[w, 0, 0, d / 2 + 0.04], [w, Math.PI, 0, -d / 2 - 0.04], [d, Math.PI / 2, w / 2 + 0.04, 0], [d, -Math.PI / 2, -w / 2 - 0.04, 0]]) {
      const n = Math.max(1, Math.floor(len / 3.2));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n * len - len / 2, c = rng() < lit ? 0xffd27a : 0x1d2833;
        const x = ry === 0 ? t : ry === Math.PI ? -t : ox, z = ry === 0 || ry === Math.PI ? oz : (ry > 0 ? -t : t);
        glow.add(new THREE.PlaneGeometry(1.6, fh * 0.5), c, x0 + (ry === 0 || ry === Math.PI ? x : ox), y, z0 + z, 0, ry, 0);
      }
    }
  }
}
function building(site, u, v, ang, w, d, h, opt = {}) {
  const mk = structMark(site);
  const M = site.frame(u, v, ang), g = new GB(), gl = new GB(), rng = site.rng;
  const wall = opt.wall ?? 0xd8d2c4, floors = opt.floors || Math.max(1, Math.round(h / 3.4));
  g.box(w, h, d, 0, h / 2, 0, wall);
  g.box(w + 0.3, 0.4, d + 0.3, 0, h + 0.2, 0, opt.trim ?? 0x8a8f93);
  if (opt.roof === 'gable') {
    const rh = opt.rh || Math.min(w, d) * 0.35;
    g.poly({ V: [[-w / 2 - 0.3, 0, -d / 2 - 0.3], [w / 2 + 0.3, 0, -d / 2 - 0.3], [w / 2 + 0.3, 0, d / 2 + 0.3], [-w / 2 - 0.3, 0, d / 2 + 0.3], [-w / 2 - 0.3, rh, 0], [w / 2 + 0.3, rh, 0]], F: [[0, 1, 2, 3], [0, 1, 5, 4], [3, 2, 5, 4], [0, 3, 4], [1, 2, 5]] }, opt.roofCol ?? COLS.roof, 0, h + 0.4, 0);
    site.polyCol(M, [[-w / 2, 0, -d / 2], [w / 2, 0, -d / 2], [w / 2, 0, d / 2], [-w / 2, 0, d / 2], [-w / 2, h, -d / 2], [w / 2, h, -d / 2], [w / 2, h, d / 2], [-w / 2, h, d / 2], [-w / 2, h + rh, 0], [w / 2, h + rh, 0]],
      [[0, 1, 2, 3], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 8, 4], [1, 2, 6, 9, 5], [4, 5, 9, 8], [7, 6, 9, 8]]);
    if (opt.chimney) g.box(0.8, 2, 0.8, w * 0.25, h + rh * 0.6, -d * 0.15, 0x7b4636);
  } else {
    site.boxCol(M, w, h, d, 0, h / 2, 0);
    if (h > 12) { g.box(2, 1.2, 1.5, w * 0.2, h + 0.9, 0, 0x9aa4aa); g.box(1.2, 2.5, 1.2, -w * 0.25, h + 1.4, d * 0.2, 0x7d878d); }
  }
  if (opt.door !== false) g.box(1.6, 2.4, 0.1, 0, 1.2, d / 2 + 0.05, 0x4a3426);
  if (opt.awning) { g.box(w * 0.9, 0.2, 2.2, 0, 3.6, d / 2 + 1.1, opt.awning); g.box(w * 0.7, 1.2, 0.2, 0, h - 1.2, d / 2 + 0.12, opt.sign ?? 0xc8432f); }
  winRows(gl, gl, w, d, h, floors, wall, opt.lit ?? 0.35, rng);
  site.put(g, M); site.put(gl, M, true);
  // it can be knocked down (wreck.js)
  structAdd(site, mk, M, [{ w, h, d, x: 0, y: h / 2, z: 0 }], { wall, top: opt.roof === 'gable' ? wall : (opt.trim ?? 0x8a8f93), roof: opt.roof === 'gable' ? { rh: opt.rh || Math.min(w, d) * 0.35, col: opt.roofCol ?? COLS.roof } : null });
  return M;
}
function tree(site, u, v, s = 1) {
  const M = site.frame(u, v, site.rng() * TAU), g = new GB(), k = 0.8 + site.rng() * 0.5;
  g.cyl(0.22 * s, 0.3 * s, 3 * s * k, 7, 0, 1.5 * s * k, 0, COLS.trunk);
  if (site.rng() < 0.5) { g.cone(2.2 * s, 6 * s * k, 9, 0, 5.4 * s * k, 0, 0x2f5f33); g.cone(1.6 * s, 4 * s * k, 9, 0, 7.2 * s * k, 0, 0x386b3b); }
  else g.sph(2.4 * s, 0, 4.8 * s * k, 0, 0x3f7a3a, 1, 0.9, 1, 9, 6);
  site.put(g, M); site.boxCol(M, 0.5 * s, 3 * s * k, 0.5 * s, 0, 1.5 * s * k, 0);
}
function lamp(site, u, v, ang, h = 7) {
  const mk = structMark(site);
  const M = site.frame(u, v, ang), g = new GB(), gl = new GB();
  g.cyl(0.1, 0.14, h, 6, 0, h / 2, 0, 0x5a636a); g.box(1.4, 0.12, 0.12, 0.6, h, 0, 0x5a636a);
  gl.box(0.5, 0.15, 0.3, 1.2, h - 0.12, 0, 0xfff1c4);
  site.put(g, M); site.put(gl, M, true); site.boxCol(M, 0.3, h, 0.3, 0, h / 2, 0);
  structAdd(site, mk, M, [{ w: 0.3, h, d: 0.3, x: 0, y: h / 2, z: 0 }], { pole: true, wall: 0x5a636a });
}
/* a ramp (wedge) rising along x from 0 to height h over length L, width w */
function wedge(site, M, L, w, h, col, x0 = 0) {
  const V = [[x0, 0, -w / 2], [x0, 0, w / 2], [x0 + L, 0, -w / 2], [x0 + L, 0, w / 2], [x0 + L, h, -w / 2], [x0 + L, h, w / 2]];
  const F = [[0, 1, 3, 2], [2, 3, 5, 4], [0, 1, 5, 4], [0, 2, 4], [1, 3, 5]];
  const g = new GB(); g.poly({ V, F }, col); site.put(g, M);
  site.polyCol(M, V.map(p => [p[0], p[1] - 0.4 * (p[1] === 0 ? 1 : 0), p[2]]), F);
}
/* an arc of slabs: a curved surface around the z axis of the object frame (centre cx, cy), from angle a0 to a1 */
function arcSlabs(site, M, cx, cy, r, a0, a1, n, w, th, col, zf) {
  const g = new GB();
  for (let i = 0; i < n; i++) {
    const t0 = a0 + (a1 - a0) * i / n, t1 = a0 + (a1 - a0) * (i + 1) / n;
    const z0 = zf ? zf(t0) : 0, z1 = zf ? zf(t1) : 0;
    const p = (t, rr, z, s) => [cx + Math.sin(t) * rr, cy - Math.cos(t) * rr, z + s * w / 2];
    const V = [p(t0, r, z0, -1), p(t0, r, z0, 1), p(t1, r, z1, -1), p(t1, r, z1, 1), p(t0, r + th, z0, -1), p(t0, r + th, z0, 1), p(t1, r + th, z1, -1), p(t1, r + th, z1, 1)];
    const F = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]];
    g.poly({ V, F }, i % 2 ? col : shade(col, 0.88));
    site.polyCol(M, V, F, [2, 3]);
  }
  site.put(g, M);
}

/* ---------- ground over tunnels ----------
   The terrain makes room for a tunnel by cutting a trench (it is a height map, it cannot hold a hole), so a tunnel is
   walls and a roof down in that cut. Over it goes a sheet of hillside at the land's own height and colour, solid earth
   under that sheet so you can drive over the top, and a concrete headwall at each mouth. pts/side: the path and its
   sideways directions; o.tun: the walls' half spacing, o.tunH: the roof's underside, o.half: how wide the cut is. */
function tunnelCover(site, pts, side, i0, i1, o) {
  const isT = i => pts[i] && pts[i + 1] && pts[i].tunnel && pts[i + 1].tunnel;
  for (let i = i0; i < i1; i++) {
    if (!isT(i)) continue;
    let j = i; while (j < i1 && isT(j)) j++;
    coverRun(site, pts, side, i, j, o, !isT(i - 1), !isT(j));
    i = j;
  }
}
function coverRun(site, pts, side, i, j, o, mouthA, mouthB) {
  const R = PLANET.R, O = site.O, half = o.half + 1.5, roof = o.tun + 1, top = o.tunH + 1;
  // across the cut: finer for the sheet you see, and the walls' line, the roof's edges and the middle for the solid earth
  // the sheet reaches a little past the cut, a hand's width over the land there (the land right at a cut's edge is
  // coloured as bare rock), then tucks under it
  const ext = half + 6, NL = 16, offs = []; for (let k = 0; k <= NL; k++) offs.push(-ext + 2 * ext * k / NL);
  const colOffs = [-half, -(half + roof) / 2, -roof, 0, roof, (half + roof) / 2, half];
  const at = (r, sd, y, out = new V3()) => out.copy(pts[r].d).multiplyScalar(R + pts[r].h + y).addScaledVector(side[r], sd);
  const dir = new V3();
  // the land's own height there, and never lower than just over the roof above the tunnel itself
  const coverH = (r, sd) => {
    at(r, sd, 0, dir).normalize();
    const hn = planetHeightRaw(dir.x, dir.y, dir.z), floor = pts[r].h + top + 0.4;
    return Math.abs(sd) <= roof + 0.5 ? Math.max(hn, floor) : Math.max(hn, Math.min(floor, pts[r].h + 0.5)) + (Math.abs(sd) > half - 2 ? 0.15 : 0);
  };
  const rows = j - i + 1, W = NL + 3;   // each row: a skirt, the samples, a skirt
  const P = new Float32Array(rows * W * 3), C = new Float32Array(rows * W * 3), TL = new Float32Array(rows * W * 3), Hs = [];
  const ws = PLANET.ws, wasOn = ws && ws.on; if (ws) ws.on = false;   // the land's own colours, not the road's
  const oc = [0, 0, 0], q = new V3();
  for (let r = 0; r < rows; r++) {
    const pr = i + r, hr = offs.map(sd => coverH(pr, sd)); Hs.push(hr);
    for (let k = 0; k < W; k++) {
      // the outermost samples on each side tuck just under the land, so the sheet's edge never shows as a lip
      const kk = clamp(k - 1, 0, NL), rim = k === 0 || k === W - 1, sd = rim ? Math.sign(offs[kk]) * (ext + 4) : offs[kk];
      at(pr, sd, 0, dir).normalize();
      q.copy(dir).multiplyScalar(R + (rim ? planetHeightRaw(dir.x, dir.y, dir.z) - 0.7 : hr[kk]));
      const v = (r * W + k) * 3;
      TL[v] = q.x; TL[v + 1] = q.y; TL[v + 2] = q.z; P[v] = q.x - O.x; P[v + 1] = q.y - O.y; P[v + 2] = q.z - O.z;
      const sl = kk > 0 && kk < NL ? Math.abs(hr[kk + 1] - hr[kk - 1]) / (offs[kk + 1] - offs[kk - 1]) : 0;
      planetColor(hr[kk], clamp(sl * 0.6, 0, 1), dir.x, dir.y, dir.z, oc);
      C[v] = oc[0]; C[v + 1] = oc[1]; C[v + 2] = oc[2];
    }
  }
  if (ws) ws.on = wasOn;
  const idx = [];
  for (let r = 0; r < rows - 1; r++) for (let k = 0; k < W - 1; k++) { const a = r * W + k, b = a + 1, c = a + W, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.setAttribute('tl', new THREE.BufferAttribute(TL, 3));
  g.setIndex(idx); g.computeVertexNormals();
  // make sure the sheet faces up (its winding depends on which way the path runs)
  { const N = g.attributes.normal, k = (Math.floor(rows / 2) * W + (W >> 1)) * 3; at(i + (rows >> 1), 0, 0, dir).normalize();
    if (N.array[k] * dir.x + N.array[k + 1] * dir.y + N.array[k + 2] * dir.z < 0) { for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = x; } g.setIndex(idx); g.computeVertexNormals(); } }
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, MAT.terrain); mesh.position.copy(O); mesh.receiveShadow = true;
  (site.extra || (site.extra = [])).push(mesh);
  // solid earth under the sheet, two path steps at a time: over the roof down to the roof, beside it well into the hill
  const ci = colOffs.map(sd => offs.reduce((b, x, k) => Math.abs(x - sd) < Math.abs(offs[b] - sd) ? k : b, 0));
  for (let r = 0; r < rows - 1; r += 2) {
    const r2 = Math.min(rows - 1, r + 2);
    for (let k = 0; k < colOffs.length - 1; k++) {
      const s0 = colOffs[k], s1 = colOffs[k + 1], overRoof = Math.abs(s0) <= roof + 0.01 && Math.abs(s1) <= roof + 0.01;
      const tops = [[r, k], [r, k + 1], [r2, k], [r2, k + 1]].map(([rr, kk]) => Hs[rr][ci[kk]] - pts[i + rr].h);
      const y0 = overRoof ? top : Math.min(...tops) - 5;
      const V = [];
      for (let m = 0; m < 8; m++) { const rr = m & 4 ? r2 : r, kk = m & 1 ? k + 1 : k; V.push(at(i + rr, colOffs[kk], m & 2 ? Math.max(Hs[rr][ci[kk]] - pts[i + rr].h, y0 + 0.3) : y0)); }
      makeCollider(V, BOX_F, PLANET, null, [0, 1]);
    }
  }
  // headwalls: concrete across the cut at each mouth, from the track up to the hillside, open over the tunnel itself
  const wall = (r, toward) => {
    const r2 = r + toward, f = 1.2 / Math.max(1, at(r, 0, 0).distanceTo(at(r2, 0, 0)));
    const lerpAt = (sd, y) => at(r, sd, y).lerp(at(r2, sd, y), f);
    for (let k = 0; k < colOffs.length - 1; k++) {
      const s0 = colOffs[k], s1 = colOffs[k + 1], overRoof = Math.abs(s0) <= roof + 0.01 && Math.abs(s1) <= roof + 0.01;
      // its top follows the hillside across the cut
      const t0 = Hs[r - i][ci[k]] - pts[r].h + 0.3, t1 = Hs[r - i][ci[k + 1]] - pts[r].h + 0.3;
      const y0 = overRoof ? o.tunH : -0.5;
      if (Math.max(t0, t1) <= y0 + 0.3) continue;
      const V = []; for (let m = 0; m < 8; m++) { const sd = m & 1 ? s1 : s0, y = m & 2 ? Math.max(m & 1 ? t1 : t0, y0 + 0.3) : y0; V.push(m & 4 ? lerpAt(sd, y) : at(r, sd, y)); }
      site.hex(V, 0x8a8880, false, true, [0, 1]);
    }
  };
  if (mouthA) wall(i, 1);
  if (mouthB) wall(j, -1);
}
/* ---------- roads ---------- */
const IDENT4 = new THREE.Matrix4();
function buildRoads() {
  if (!WP.roads.length) return;
  const site = new Site('roads', PLANET, WP.up, WP.X, WP.Z, 0);
  const asph = rgb(0x34363a), line = rgb(0xe9e6dc), yel = rgb(0xe8b83a);
  for (const r of WP.roads) {
    const P = r.pts.map(p => [p.x, p.z, p.h]);
    site.strip(P, ROAD_W * 2, asph, 0.09);
    site.strip(P.map(p => p), 0.25, yel, 0.11, 1);
    // edge lines
    const off = (k) => P.map((p, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [p[0] - dz / l * k, p[1] + dx / l * k, p[2]]; });
    site.strip(off(4.4), 0.2, line, 0.1); site.strip(off(-4.4), 0.2, line, 0.1);
    // bridges and tunnels follow the road piece by piece, so they bend with it
    const pts = r.pts, n = pts.length, R = PLANET.R;
    const side = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)].d, b = pts[Math.min(n - 1, i + 1)].d, t = new V3().subVectors(b, a); t.addScaledVector(p.d, -t.dot(p.d)).normalize(); return new V3().crossVectors(t, p.d).normalize(); });
    const corner = (i, sd, y) => pts[i].d.clone().multiplyScalar(R + pts[i].h + y).addScaledVector(side[i], sd);
    // a solid between two road points: across from s0 to s1, up from y0 to y1
    const piece = (i, s0, s1, y0, y1, col, glow) => {
      // on a tight bend the inside edge folds back on itself: leave that piece out
      const ab = new V3().subVectors(pts[i + 1].d, pts[i].d);
      for (const sd of [s0, s1]) if (corner(i + 1, sd, 0).sub(corner(i, sd, 0)).dot(ab) <= 0) return;
      const V = [];
      for (let k = 0; k < 8; k++) V.push(corner(k & 4 ? i + 1 : i, k & 1 ? s1 : s0, k & 2 ? y1 : y0));
      if (!glow) makeCollider(V, BOX_F, PLANET, null, [0, 1]);
      const g = new GB(); g.poly({ V: V.map(v => [v.x - site.O.x, v.y - site.O.y, v.z - site.O.z]), F: BOX_F }, col);
      (glow ? site.glow : site.solid).addGB(g, IDENT4);
    };
    const W0 = ROAD_W + 0.5, TW = ROAD_W + 2;   // bridge rails hug the road; tunnel walls leave room to scrape past
    for (let i = 0; i < n - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (a.bridge || b.bridge) {
        piece(i, -W0 - 0.2, W0 + 0.2, -1.2, 0, COLS.concrete);
        if (!a.open && !b.open) for (const sd of [-1, 1]) piece(i, sd * W0, sd * (W0 + 0.4), 0, 1, 0xd8d6cf);
        if (i % 4 === 0 && !a.nopier) {
          // a pier down to the sea floor (or the ground, but never onto a road passing beneath)
          const gh = PLANET.heightL(a.d.x, a.d.y, a.d.z), depth = a.h - Math.min(gh, 0) + 2;
          const X = new V3().subVectors(b.d, a.d).normalize(), M = new THREE.Matrix4().makeBasis(X, a.d, new V3().crossVectors(X, a.d)).setPosition(a.d.clone().multiplyScalar(R + a.h));
          site.box(M, 2.2, depth, 6, 0, -depth / 2 - 1.2, 0, 0xa9a7a0);
        }
      }
      if (a.tunnel && b.tunnel) {
        for (const sd of [-1, 1]) piece(i, sd * TW, sd * (TW + 1), -0.5, 6.8, 0x9a9890);
        piece(i, -TW - 1, TW + 1, 6.8, 7.8, 0x8d8b84);
        if (i % 3 === 0) piece(i, -0.3, 0.3, 6.6, 6.8, 0xfff1c4, true);
      }
    }
    tunnelCover(site, pts, side, 0, n - 1, { tun: TW, tunH: 6.8, half: ROAD_FLAT + ROAD_BLEND });
  }
  site.finish();
}
/* ---------- the space port around the launch pad ---------- */
function buildSpacePort() {
  const L = WORLD.L, s = new Site('spaceport', PLANET, L.up, L.right, L.fwd, WORLD.padH);
  // the old drive-test ramps
  wedge(s, s.frame(16, 6, Math.PI / 2), 12, 6, 3.2, 0x8d9296);
  wedge(s, s.frame(-18, 8, Math.PI / 2), 6, 5, 2.2, 0xc98f3a);
  wedge(s, s.frame(0, 38, Math.PI / 2), 22, 9, 6.5, 0x8d9296);
  // launch tower beside the pad: a lattice of posts and braces, with two service arms
  {
    const M = s.frame(-14, 2, 0), g = new GB(), gl = new GB(), H = 46;
    for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) g.box(0.45, H, 0.45, x, H / 2, z, COLS.red);
    for (let y = 3; y < H; y += 4) { g.box(4.4, 0.25, 0.25, 0, y, -2, COLS.steel); g.box(4.4, 0.25, 0.25, 0, y, 2, COLS.steel); g.box(0.25, 0.25, 4.4, -2, y, 0, COLS.steel); g.box(0.25, 0.25, 4.4, 2, y, 0, COLS.steel); }
    for (const y of [20, 35]) g.box(6, 0.8, 1.6, 5, y, 0, COLS.dark);
    g.cyl(0.08, 0.08, 8, 6, 0, H + 4, 0, COLS.steel); gl.sph(0.35, 0, H + 8, 0, 0xff3b2b);
    s.put(g, M); s.put(gl, M, true); s.boxCol(M, 4.5, H, 4.5, 0, H / 2, 0);
  }
  // vehicle assembly building, its door facing the pad
  building(s, -85, -75, Math.atan2(75, 85) + Math.PI / 2, 46, 40, 50, { wall: 0xdedcd5, floors: 1, lit: 0, door: false, trim: 0x4b5157 });
  { const M = s.frame(-85, -75, Math.atan2(75, 85) + Math.PI / 2), g = new GB(); g.box(14, 40, 0.3, 0, 20, 20.2, 0x3b4148); g.box(10, 8, 0.32, -14, 38, 20.2, COLS.navy); g.box(10, 2, 0.34, -14, 34, 20.2, COLS.red); s.put(g, M); }
  // control centre and its dishes
  building(s, -62, 58, 0.4, 32, 18, 9, { wall: 0xc9c4b6, lit: 0.6 });
  { const M = s.frame(-62, 58, 0.4), g = new GB(); for (const x of [-9, 9]) { g.cyl(0.25, 0.25, 3, 8, x, 10.5, 0, COLS.steel); g.add(new THREE.SphereGeometry(2.4, 14, 6, 0, TAU, 0, 1.1), COLS.white, x, 12.6, 0, -0.8, 0, 0); } s.put(g, M); }
  // fuel farm: three white spheres on legs
  for (const [u, v] of [[72, -58], [88, -58], [80, -74]]) {
    const M = s.frame(u, v), g = new GB();
    g.sph(6, 0, 9, 0, COLS.white, 1, 1, 1, 16, 10); for (const [x, z] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) g.cyl(0.3, 0.3, 6, 6, x, 3, z, COLS.steel);
    s.put(g, M); s.boxCol(M, 8.4, 8.4, 8.4, 0, 9, 0); s.boxCol(M, 9, 5, 9, 0, 2.5, 0);
  }
  // landing zones for returning rockets
  for (const v of [18, 50]) { s.disc(78, v, 0, 10, rgb(0x9a9890)); s.disc(78, v, 8.6, 9.4, rgb(0xf2c230), 0.12); s.rect(78, v, 10, 1, 0, rgb(0xe8ebe7), 0.12); s.rect(78, v, 1, 10, 0, rgb(0xe8ebe7), 0.12); }
  // floodlight towers
  for (const [u, v] of [[40, -40], [-40, -40], [40, 30], [-40, 30]]) { const M = s.frame(u, v, Math.atan2(-v, -u)), g = new GB(), gl = new GB(); g.box(0.6, 24, 0.6, 0, 12, 0, COLS.steel); g.box(3, 1.4, 0.6, 0, 24, 0, COLS.dark); gl.box(2.6, 1, 0.1, 0, 24, 0.32, 0xfff6d8); s.put(g, M); s.put(gl, M, true); s.boxCol(M, 0.6, 24, 0.6, 0, 12, 0); }
  for (const [u, v] of [[-24, 20], [-22, 24], [-26, 23], [24, -18]]) s.loose('barrel', u, v);
  s.finish();
}
/* ---------- the airport ---------- */
function siteOf(name) { const w = WP.sites.find(s => s.name === name) || GLOBE.sites.find(s => s.name === name); return w ? new Site(name, PLANET, w.C, w.E1, w.E3, w.h) : null; }
function buildAirport() {
  const s = siteOf('airport'); if (!s) return;
  const RV = -45, HL = 500;
  const conc = rgb(0x8d8f8c), white = rgb(0xeeeeea), yel = rgb(0xe8b83a);
  s.rect(0, RV, 2 * HL + 40, 40, 0, conc);
  for (let u = -HL + 60; u < HL - 60; u += 50) s.rect(u, RV, 28, 1, 0, white, 0.1);
  for (const e of [-1, 1]) {
    for (let k = -3; k <= 3; k++) if (k) s.rect(e * (HL - 8), RV + k * 4.6, 24, 2.2, 0, white, 0.1);
    s.rect(e * (HL - 70), RV - 8, 30, 3, 0, white, 0.1); s.rect(e * (HL - 70), RV + 8, 30, 3, 0, white, 0.1);
  }
  s.rect(0, RV - 19, 2 * HL, 0.6, 0, white, 0.1); s.rect(0, RV + 19, 2 * HL, 0.6, 0, white, 0.1);
  // taxiway and its links, the apron
  s.rect(-40, 12, 2 * HL - 40, 16, 0, conc); s.rect(-40, 12, 2 * HL - 40, 0.4, 0, yel, 0.1);
  for (const u of [-440, 0, 360]) { s.rect(u, -18, 16, 46, 0, conc); s.rect(u, -18, 0.4, 46, 0, yel, 0.1); }
  s.rect(-60, 62, 440, 74, 0, conc);
  // edge lights
  { const M = s.frame(0, 0), gl = new GB(); for (let u = -HL; u <= HL; u += 50) for (const v of [RV - 21, RV + 21]) { const P = s.at(u, v, 0.25); const Mx = s.frame(u, v); const g2 = new GB(); g2.box(0.4, 0.3, 0.4, 0, 0.15, 0, u === -HL || u === HL ? 0x52ff7a : 0xfff1c4); s.put(g2, Mx, true); } }
  // hangars: an open one to park in, two closed
  [-230, -160, -90].forEach((u, i) => {
    const M = s.frame(u, 110, 0), g = new GB(), W = 50, D = 40, H = 14, col = i === 0 ? 0x9aa6ae : 0xb4bcc2;
    const vault = (gg, c) => { for (let k = 0; k < 8; k++) { const a0 = Math.PI * k / 8, a1 = Math.PI * (k + 1) / 8, r = D / 2; gg.poly({ V: [[-W / 2, H + Math.sin(a0) * 6, -Math.cos(a0) * r], [W / 2, H + Math.sin(a0) * 6, -Math.cos(a0) * r], [W / 2, H + Math.sin(a1) * 6, -Math.cos(a1) * r], [-W / 2, H + Math.sin(a1) * 6, -Math.cos(a1) * r], [-W / 2, H, 0], [W / 2, H, 0]], F: [[0, 1, 2, 3], [0, 1, 5, 4], [3, 2, 5, 4], [0, 3, 4], [1, 2, 5]] }, k % 2 ? c : shade(c, 0.93)); } };
    vault(g, col);
    if (i === 0) {
      // open front: back wall, two side walls and the roof are separate solids
      g.box(W, H, 0.6, 0, H / 2, D / 2 - 0.3, col); s.boxCol(M, W, H, 0.6, 0, H / 2, D / 2 - 0.3);
      for (const x of [-1, 1]) { g.box(0.6, H, D, x * (W / 2 - 0.3), H / 2, 0, col); s.boxCol(M, 0.6, H, D, x * (W / 2 - 0.3), H / 2, 0); }
      s.boxCol(M, W, 1, D, 0, H + 0.5, 0);
      s.rect(u, 110, W - 2, D - 2, 0, rgb(0x6f716f), 0.1);
    } else {
      g.box(W, H, D, 0, H / 2, 0, col); s.boxCol(M, W, H, D, 0, H / 2, 0);
      g.box(W * 0.8, H * 0.85, 0.2, 0, H * 0.425, -D / 2 - 0.1, 0x59626a);
    }
    g.box(10, 2.4, 0.3, 0, H + 3.5, -D / 2 + 1, [COLS.red, COLS.blue, COLS.yellow][i]);
    s.put(g, M); s.boxCol(M, W, 6, D, 0, H + 3, 0, 'roof');
  });
  // terminal and control tower
  building(s, 80, 115, 0, 90, 24, 12, { wall: 0xc9d3d8, floors: 2, lit: 0.6, trim: 0x2f6f9f });
  {
    const M = s.frame(190, 100), g = new GB(), gl = new GB();
    g.cyl(3, 3.6, 30, 8, 0, 15, 0, 0xd8d6cf); g.cyl(6, 4.5, 2, 10, 0, 31, 0, 0x8a8f93);
    gl.cyl(6, 6, 4, 12, 0, 34, 0, 0x7fd0ff); g.cyl(6.6, 6.6, 0.8, 12, 0, 36.4, 0, COLS.dark); g.cyl(0.1, 0.1, 6, 6, 0, 39.5, 0, COLS.steel);
    s.put(g, M); s.put(gl, M, true); s.geoCol(new THREE.CylinderGeometry(3.6, 3.6, 30, 8).translate(0, 15, 0), M); s.geoCol(new THREE.CylinderGeometry(6.6, 6, 6.8, 10).translate(0, 33.4, 0), M);
  }
  // windsock
  { const M = s.frame(420, -5, 0.5), g = new GB(); g.cyl(0.12, 0.15, 8, 6, 0, 4, 0, 0xe8ebe7); for (let k = 0; k < 4; k++) g.cyl(0.55 - k * 0.1, 0.45 - k * 0.1, 1, 10, 0.8 + k, 7.6, 0, k % 2 ? 0xe8ebe7 : 0xe8692c, 0, 0, Math.PI / 2); s.put(g, M); s.boxCol(M, 0.3, 8, 0.3, 0, 4, 0); }
  // helipads
  for (const u of [250, 290]) { s.disc(u, 60, 0, 11, rgb(0x5d6066)); s.disc(u, 60, 9.4, 10.2, rgb(0xeeeeea), 0.12); s.rect(u - 2.6, 60, 1, 8, 0, white, 0.12); s.rect(u + 2.6, 60, 1, 8, 0, white, 0.12); s.rect(u, 60, 5.2, 1, 0, white, 0.12); }
  for (let k = 0; k < 8; k++) s.loose('cone', -300 + k * 10, 70);
  for (const [u, v] of [[-275, 92], [-272, 95], [-278, 96]]) s.loose('barrel', u, v);
  WP.spawns.airport = { name: 'Airport runway', u: -HL + 25, v: RV, ang: 0, site: s };
  s.finish();
}
/* ---------- towns ---------- */
function buildTown(name, label, style) {
  const s = siteOf(name); if (!s) return;
  const asph = rgb(0x3a3c40), walk = rgb(0xa9a8a2), line = rgb(0xe9e6dc), rng = s.rng;
  const ST = [-90, 0, 90];
  for (const k of ST) { s.rect(0, k, 270, 14, 0, walk); s.rect(k, 0, 14, 270, 0, walk); }
  for (const k of ST) { s.rect(0, k, 270, 10, 0, asph, 0.1); s.rect(k, 0, 10, 270, 0, asph, 0.1); }
  for (const k of ST) for (let t = -125; t < 125; t += 12) { s.rect(t, k, 5, 0.25, 0, line, 0.12); s.rect(k, t, 0.25, 5, 0, line, 0.12); }
  // plaza and fountain in the middle
  s.disc(0, 0, 0, 13, rgb(0xb5aa95), 0.13);
  { const M = s.frame(0, 0), g = new GB(), gl = new GB(); g.cyl(5, 5.3, 0.8, 20, 0, 0.4, 0, 0xcfcac0); gl.cyl(4.6, 4.6, 0.05, 20, 0, 0.75, 0, 0x6fb7d9); g.cyl(0.5, 0.7, 2.6, 10, 0, 1.3, 0, 0xcfcac0); s.put(g, M); s.put(gl, M, true); s.geoCol(new THREE.CylinderGeometry(5.3, 5.3, 0.8, 10).translate(0, 0.4, 0), M); }
  // blocks: centre blocks are taller, outer strips are houses
  const lot = (cu, cv, half, kind) => {
    const n = kind === 'house' ? 3 : 2;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const u = cu + (i - (n - 1) / 2) * (half * 2 / n), v = cv + (j - (n - 1) / 2) * (half * 2 / n), face = Math.atan2(-v, -u);
      const ang = Math.round(face / (Math.PI / 2)) * Math.PI / 2;
      const r = rng();
      if (kind === 'house') {
        if (r < 0.15) { tree(s, u, v); tree(s, u + 3, v - 3, 0.8); continue; }
        // sized to leave a gap to the next house (the plots are about 10.7 m apart)
        building(s, u, v, ang, 7.6 + rng() * 1.6, 7 + rng() * 1.4, 3.4 + (rng() < 0.3 ? 3.4 : 0), { roof: 'gable', wall: [0xe6dcc8, 0xd9c7a8, 0xc9d6dc, 0xe0c3b0, 0xf0ead8][Math.floor(rng() * 5)], roofCol: [0x6b3a2a, 0x4a4f55, 0x7a3b30][Math.floor(rng() * 3)], chimney: rng() < 0.5, lit: 0.4 });
        tree(s, u + 5.3, v + 5.3, 0.6);
      } else if (kind === 'shop') {
        building(s, u, v, ang, 16, 12, 5 + rng() * 2, { wall: [0xd8d2c4, 0xcfb08a, 0xb9c9c4][Math.floor(rng() * 3)], awning: [0xc8432f, 0x2f8f86, 0xe8a33d][Math.floor(rng() * 3)], floors: 1, lit: 0.8 });
      } else {
        const h = style === 'big' ? 18 + rng() * 30 : 12 + rng() * 14;
        building(s, u, v, ang, 18, 18, h, { wall: [0xc9c4b6, 0x9fb0bc, 0xb8a089, 0xd0ccc4][Math.floor(rng() * 4)], lit: 0.45, trim: 0x5a636a });
      }
    }
  };
  for (const cu of [-45, 45]) for (const cv of [-45, 45]) lot(cu, cv, 32, (cu > 0) === (cv > 0) ? 'tall' : 'shop');
  for (const k of [-1, 1]) for (const t of [-45, 45]) { lot(k * 112, t, 16, 'house'); lot(t, k * 112, 16, 'house'); }
  // gas station on a corner and a water tower on another
  {
    const u = 112, v = 112, M = s.frame(u, v, Math.PI), g = new GB(), gl = new GB();
    g.box(16, 0.8, 10, 0, 5.2, 0, 0xe8ebe7); g.box(16.2, 0.4, 10.2, 0, 4.7, 0, 0xc8432f); gl.box(14, 0.05, 8, 0, 4.48, 0, 0xfff6d8);
    for (const [x, z] of [[-6, -3], [6, -3], [-6, 3], [6, 3]]) { g.box(0.5, 4.8, 0.5, x, 2.4, z, 0x8c99a3); s.boxCol(M, 0.5, 4.8, 0.5, x, 2.4, z); }
    for (const x of [-3, 3]) { g.box(1, 1.6, 0.6, x, 0.8, 0, 0x3a4148); s.boxCol(M, 1, 1.6, 0.6, x, 0.8, 0); }
    s.boxCol(M, 16, 0.8, 10, 0, 5.2, 0); s.put(g, M); s.put(gl, M, true);
    building(s, u + 4, v + 12, Math.PI, 10, 6, 3.6, { wall: 0xe8ebe7, awning: 0xc8432f, floors: 1, lit: 0.9 });
    s.rect(u, v, 20, 16, 0, rgb(0x4a4c50), 0.11);
    for (const [a, b] of [[-9, -7], [-10, -6], [9, 7]]) s.loose('barrel', u + a, v + b);
  }
  {
    const M = s.frame(-112, -112), g = new GB(), H = 22;
    for (const [x, z] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) { g.box(0.5, H, 0.5, x, H / 2, z, 0x8c99a3); s.boxCol(M, 0.5, H, 0.5, x, H / 2, z); }
    g.cyl(5, 5, 7, 16, 0, H + 3.5, 0, style === 'big' ? 0x9fc3d6 : 0xe0d7c0); g.cone(5.3, 2.4, 16, 0, H + 8.2, 0, 0x6b6f73);
    s.geoCol(new THREE.CylinderGeometry(5, 5, 7, 8).translate(0, H + 3.5, 0), M); s.put(g, M);
  }
  if (style !== 'big') {
    // a church with a spire
    const M = building(s, -112, 112, -Math.PI / 4, 12, 22, 9, { roof: 'gable', wall: 0xe6e2d6, roofCol: 0x4a4f55, lit: 0.2, door: true });
    const g = new GB(); g.box(5, 16, 5, 0, 8, -12, 0xe6e2d6); g.cone(3.4, 10, 4, 0, 21, -12, 0x4a4f55, 0, Math.PI / 4, 0); s.put(g, M); s.boxCol(M, 5, 16, 5, 0, 8, -12);
  }
  // street lights
  for (const k of ST) for (let t = -120; t <= 120; t += 30) { lamp(s, t, k + 6.5, -Math.PI / 2); lamp(s, k - 6.5, t, Math.PI); }
  for (let i = 0; i < 6; i++) s.loose('cone', -60 + i * 4, -84);
  if (!WP.spawns[name]) WP.spawns[name] = { name: label, u: 0, v: -70, ang: Math.PI / 2, site: s, group: 'Towns' };
  s.finish();
}
/* ---------- the race and stunt park ---------- */
function buildRace() {
  const s = siteOf('race'); if (!s) return;
  const RAD = 100, SX = 135, TW = 14;
  // the circuit's centre line: a stadium, run anticlockwise starting mid-straight
  const P = [], N = 220;
  const per = 4 * SX + TAU * RAD;
  for (let i = 0; i <= N; i++) {
    let d = (i / N) * per, u, v;
    if (d < SX) { u = d; v = -RAD; }
    else if ((d -= SX) < Math.PI * RAD) { const a = -Math.PI / 2 + d / RAD; u = SX + Math.cos(a) * RAD; v = Math.sin(a) * RAD; }
    else if ((d -= Math.PI * RAD) < 2 * SX) { u = SX - d; v = RAD; }
    else if ((d -= 2 * SX) < Math.PI * RAD) { const a = Math.PI / 2 + d / RAD; u = -SX + Math.cos(a) * RAD; v = Math.sin(a) * RAD; }
    else { d -= Math.PI * RAD; u = -SX + d; v = -RAD; }
    P.push([u, v, 0]);
  }
  s.strip(P, TW, rgb(0x34363a), 0.09);
  const off = k => P.map((p, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [p[0] - dz / l * k, p[1] + dx / l * k, 0]; });
  // red and white kerbs, white edge lines
  for (const k of [TW / 2 + 0.6, -TW / 2 - 0.6]) { const Q = off(k); s.strip(Q, 1.2, rgb(0xc8432f), 0.1, 1); s.strip(Q.slice(1), 1.2, rgb(0xeeeeea), 0.1, 1); }
  s.strip(off(TW / 2 - 0.4), 0.25, rgb(0xeeeeea), 0.11); s.strip(off(-TW / 2 + 0.4), 0.25, rgb(0xeeeeea), 0.11);
  // start line chequers
  for (let i = 0; i < 14; i++) for (let j = 0; j < 2; j++) s.rect(-0.5 + j, -RAD - TW / 2 + 0.5 + i, 1, 1, 0, (i + j) % 2 ? rgb(0x15181b) : rgb(0xeeeeea), 0.12);
  for (let k = 1; k <= 4; k++) for (const z of [-3.5, 3.5]) s.rect(-12 * k, -RAD + z, 5, 0.3, 0, rgb(0xeeeeea), 0.11);
  // checkpoint gates around the lap; the first is the start and finish
  const NG = 8, gates = [];
  for (let k = 0; k < NG; k++) {
    const i = Math.round(k / NG * N), p = P[i], q = P[Math.min(N, i + 1)], dx = q[0] - p[0], dz = q[1] - p[1], ang = Math.atan2(dz, dx);
    const M = s.frame(p[0], p[1], ang), g = new GB(), gl = new GB(), w = TW / 2 + 2.2;
    for (const z of [-w, w]) { g.box(0.6, 6.6, 0.6, 0, 3.3, z, k ? COLS.orange : 0x15181b); s.boxCol(M, 0.6, 6.6, 0.6, 0, 3.3, z); }
    g.box(0.4, 1.4, 2 * w, 0, 6.2, 0, k ? COLS.orange : 0xeeeeea);
    for (let c = 0; c < 10; c++) gl.box(0.42, 0.5, 1, 0, 6.2, -w + 1.4 + c * (2 * w - 2.8) / 9, k ? 0xffd27a : (c % 2 ? 0x15181b : 0xeeeeea));
    s.put(g, M); s.put(gl, M, true);
    const pos = s.at(p[0], p[1], 0), fwd = new V3().setFromMatrixColumn(M, 0);
    gates.push({ p: pos, n: fwd, w: w + 1 });
  }
  SITES.race = { gates, site: s, line: P.map(p => s.dir(p[0], p[1])) };
  // grandstand along the start straight and a pit building
  {
    const M = s.frame(0, -RAD - 26, 0), g = new GB();
    for (let k = 0; k < 6; k++) g.box(70, 1, 2.2, 0, 0.5 + k, -k * 2.2 + 5, k % 2 ? 0x9aa4aa : 0x8a939a);
    g.box(72, 0.4, 16, 0, 9, -1, 0x2f6f9f); for (const x of [-35, 0, 35]) g.box(0.4, 9, 0.4, x, 4.5, -8, 0x5a636a);
    s.polyCol(M, [[-35, 0, 6], [35, 0, 6], [-35, 0, -8], [35, 0, -8], [-35, 6, -8], [35, 6, -8]], [[0, 1, 3, 2], [2, 3, 5, 4], [0, 1, 5, 4], [0, 2, 4], [1, 3, 5]]);
    s.put(g, M);
    building(s, 0, -RAD - 50, Math.PI, 60, 12, 7, { wall: 0xe8ebe7, floors: 2, lit: 0.7, trim: 0xc8432f });
  }
  // tyre walls on the outside of the bends
  for (const sx of [-1, 1]) for (let k = -3; k <= 3; k++) {
    const a = k * 0.32, r = RAD + TW / 2 + 9, u = sx * (SX + Math.cos(a) * r), v = Math.sin(a) * r, M = s.frame(u, v, sx > 0 ? a : Math.PI - a), g = new GB();
    for (let t = -3; t <= 3; t++) for (let y = 0; y < 3; y++) g.cyl(0.45, 0.45, 0.35, 10, 0, 0.18 + y * 0.36, t * 0.9, 0x1d2024);
    s.put(g, M); s.boxCol(M, 1, 1.1, 6.3, 0, 0.55, 0);
  }
  // ---- stunt park in the infield ----
  const ramp = (u, v, ang, L, w, h, col) => wedge(s, s.frame(u, v, ang), L, w, h, col);
  ramp(-118, 40, 0, 7, 6, 1.4, 0xe8a33d);                       // kicker
  ramp(-70, 52, 0, 22, 10, 5, 0x8d9296); ramp(-14, 52, Math.PI, 26, 10, 5, 0x8d9296);   // big gap jump: up, 22 m gap, down
  ramp(70, -66, Math.PI, 8, 8, 2.2, 0xe8a33d); ramp(40, -66, 0, 8, 8, 2.2, 0xe8a33d);
  // whoops: a row of bumps
  for (let k = 0; k < 8; k++) { const M = s.frame(-60 + k * 7, -62, 0); s.polyCol(M, [[-3, 0, -4], [3, 0, -4], [-3, 0, 4], [3, 0, 4], [0, 1, -4], [0, 1, 4]], [[0, 1, 3, 2], [0, 4, 5, 2], [1, 4, 5, 3], [0, 1, 4], [2, 3, 5]]); const g = new GB(); g.poly({ V: [[-3, 0, -4], [3, 0, -4], [-3, 0, 4], [3, 0, 4], [0, 1, -4], [0, 1, 4]], F: [[0, 1, 3, 2], [0, 4, 5, 2], [1, 4, 5, 3], [0, 1, 4], [2, 3, 5]] }, k % 2 ? 0xc9ad78 : 0xb89a66); s.put(g, M); }
  // half-pipe: two curved walls facing each other
  { const M = s.frame(80, 25, 0);
    // walls along x, curving up toward ±z
    for (const sd of [-1, 1]) {
      const Mw = M.clone().multiply(new THREE.Matrix4().makeRotationY(sd > 0 ? Math.PI / 2 : -Math.PI / 2)).multiply(new THREE.Matrix4().makeTranslation(-4, 0, 0));
      // in Mw, x points out across the pipe; slabs curve up from the floor to vertical over a quarter circle
      const g2 = new GB();
      for (let i = 0; i < 9; i++) {
        const t0 = i / 9 * Math.PI / 2, t1 = (i + 1) / 9 * Math.PI / 2, r = 6.5, th = 0.6, len = 40;
        const pt = (t, rr, z) => [-Math.sin(t) * rr, r - Math.cos(t) * rr, z];
        const V = [pt(t0, r, -len / 2), pt(t0, r, len / 2), pt(t1, r, -len / 2), pt(t1, r, len / 2), pt(t0, r + th, -len / 2), pt(t0, r + th, len / 2), pt(t1, r + th, -len / 2), pt(t1, r + th, len / 2)];
        const Mo = Mw.clone().multiply(new THREE.Matrix4().makeTranslation(-6.5, 0, 0));
        const F = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]];
        g2.poly({ V: V.map(p => [p[0] - 6.5, p[1], p[2]]), F }, i % 2 ? 0xb9b8b2 : 0xa9a8a2);
        s.polyCol(Mw, V.map(p => [p[0] - 6.5, p[1], p[2]]), F, [2, 3]);
      }
      g2.cyl(0.18, 0.18, 40, 8, -13.2, 6.6, 0, 0x8c99a3, Math.PI / 2, 0, 0);
      s.put(g2, Mw);
    }
    s.rect(80, 25, 40, 8, 0, rgb(0xa9a8a2), 0.1);
  }
  // quarter pipe in a corner
  { const M = s.frame(122, 60, 0), g = new GB();
    for (let i = 0; i < 8; i++) { const t0 = i / 8 * Math.PI / 2, t1 = (i + 1) / 8 * Math.PI / 2, r = 7, th = 0.6, w = 12;
      const pt = (t, rr, z) => [Math.sin(t) * rr - r, r - Math.cos(t) * rr, z];
      const V = [pt(t0, r, -w / 2), pt(t0, r, w / 2), pt(t1, r, -w / 2), pt(t1, r, w / 2), pt(t0, r + th, -w / 2), pt(t0, r + th, w / 2), pt(t1, r + th, -w / 2), pt(t1, r + th, w / 2)];
      const F = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]];
      g.poly({ V, F }, i % 2 ? 0xe8a33d : 0xd8932d); s.polyCol(M, V, F, [2, 3]); }
    s.put(g, M); }
  // loop-the-loop: a twisting ring with low rails that walk you over to the exit lane
  const loop = buildLoop(s, -40, -24);
  // a crate wall to smash, and a cone slalom
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) s.loose('crate', 40 + i * 1.05, 70, 0, j * 1.02);
  for (let i = 0; i < 10; i++) s.loose('cone', -100 + i * 9, 72 + (i % 2) * 3);
  // spawn spots: the start grid, and the stunt park entrance
  WP.spawns.race = { name: 'Race track start', u: -24, v: -RAD, ang: 0, site: s };
  // the stunt park spot is at the start of the loop's run-up, lined up with it
  WP.spawns.stunt = { name: 'Stunt park', u: loop.u0 - 140 * Math.cos(loop.ang), v: loop.v0 - 140 * Math.sin(loop.ang), ang: loop.ang, site: s };
  s.finish();
}
/* the loop: a clothoid loop like a real one, gentle where it leaves the ground and tight at the top, so a fast car's
   suspension can take it. The track drifts 12 m sideways as it goes round, so the way out passes beside the way in. */
const LOOP_SHIFT = 12;
function loopPath(Rt, Rb, Ls) {
  const P = [], ds = 0.25;
  let x = 0, y = 0, th = 0, s = 0, k = 0, phase = 0, kEnd = 0, sEnd = 0;
  const r = t => Rt + (Rb - Rt) * (1 + Math.cos(t)) / 2;
  P.push({ x, y, th, s });
  for (let guard = 0; guard < 20000; guard++) {
    if (phase === 0) { k = s / Ls / Rb; if (s >= Ls) phase = 1; }
    if (phase === 1) { k = 1 / r(th); if (th >= TAU - Ls / (2 * Rb)) { phase = 2; kEnd = k; sEnd = s; } }
    if (phase === 2) { k = kEnd * Math.max(0, 1 - (s - sEnd) / Ls); if (s - sEnd >= Ls) break; }
    th += k * ds; x += Math.cos(th) * ds; y += Math.sin(th) * ds; s += ds;
    P.push({ x, y, th, s });
  }
  // land exactly back on the ground
  const N = P.length, e = P[N - 1];
  for (const p of P) p.y -= e.y * p.x / e.x;
  // drift sideways in step with the distance run: unrolled flat, the track is a straight strip, so a car whose
  // tyres grip follows it round without steering
  const out = P.map(p => ({ x: p.x, y: p.y, th: p.th, s: p.s, z: -LOOP_SHIFT / 2 + LOOP_SHIFT * p.s / e.s })).filter((_, i) => i % 6 === 0 || i === N - 1);
  out.slope = LOOP_SHIFT / e.s;
  return out;
}
function buildLoop(s, u, v) {
  const M = s.frame(u, v, 0), g = new GB(), W = 7, th = 0.6, F = BOX_F;
  const P = loopPath(7, 16, 10), n = P.length, end = P[n - 1], slope = P.slope;
  // a point on the track (across = -1 or 1 for the edges), lifted off the surface by o along its normal
  const at = (p, side, o) => { const nx = -Math.sin(p.th), ny = Math.cos(p.th); return [p.x + nx * o, p.y + ny * o, p.z + side * W / 2]; };
  for (let i = 0; i < n - 1; i++) {
    const a = P[i], b = P[i + 1];
    const V = [at(a, -1, 0), at(a, 1, 0), at(b, -1, 0), at(b, 1, 0), at(a, -1, -th), at(a, 1, -th), at(b, -1, -th), at(b, 1, -th)];
    // polished steel: a car scraping round it slides rather than grinds to a halt
    g.poly({ V, F }, i % 2 ? 0x2f6f9f : 0x3b7fb0); s.polyCol(M, V, F, [2, 3]).mu = 0.12;
    // low rails once it starts to climb
    if (a.th > 0.35 && a.th < TAU - 0.35) for (const sd of [-1, 1]) {
      const q = (p, o, dz) => { const c = at(p, sd, o); c[2] += dz; return c; };
      const R = [q(a, 0, 0), q(b, 0, 0), q(a, 1.2, 0), q(b, 1.2, 0), q(a, 0, sd * 0.3), q(b, 0, sd * 0.3), q(a, 1.2, sd * 0.3), q(b, 1.2, sd * 0.3)];
      g.poly({ V: R, F }, 0xe8ebe7); s.polyCol(M, R, F, [2, 3]).mu = 0.12;
    }
  }
  // posts holding up the tall sides
  for (const p of P.filter(p => Math.abs(p.th - Math.PI / 2) < 0.08 || Math.abs(p.th - 3 * Math.PI / 2) < 0.08)) {
    const h = p.y; for (const sd of [-1, 1]) g.box(0.6, h, 0.6, p.x, h / 2, p.z + sd * (W / 2 + 1), 0x8c99a3);
  }
  s.put(g, M);
  // the run-up and the run-out are painted on the ground at the track's own slant
  const ang = Math.atan(slope), ca = Math.cos(ang), sa = Math.sin(ang);
  s.rect(u - 30 * ca, v - LOOP_SHIFT / 2 - 30 * sa, 60, W, ang, rgb(0x2f6f9f), 0.1);
  s.rect(u + end.x + 20 * ca, v + LOOP_SHIFT / 2 + 20 * sa, 40, W, ang, rgb(0x2f6f9f), 0.1);
  return { ang, u0: u, v0: v - LOOP_SHIFT / 2 };
}
/* ---------- the harbor ---------- */
function buildHarbor() {
  const w = WP.sites.find(x => x.name === 'harbor'); if (!w) return;
  // v grows inland here; the shore is at v = -50
  const s = new Site('harbor', PLANET, w.C, w.E1, w.E3, 3), SH = -50;
  s.rect(0, SH + 25, 220, 50, 0, rgb(0x8f8e88), 0.08);
  { const M = s.frame(0, SH, 0); s.box(M, 220, 12, 2, 0, -6.05, 0, 0x9a9890); }
  // the pier, on piles
  { const M = s.frame(-30, SH - 80, Math.PI / 2), g = new GB();
    for (let x = -80; x < 80; x += 20) { g.box(20.2, 1, 9, x + 10, -0.5, 0, 0x8a6a4a); s.boxCol(M, 20.2, 1, 9, x + 10, -0.5, 0); for (const z of [-4, 4]) g.cyl(0.35, 0.35, 12, 8, x, -6, z, 0x5a4636); }
    g.box(9, 1, 32, 82, -0.5, 0, 0x8a6a4a); s.boxCol(M, 9, 1, 32, 82, -0.5, 0);
    for (let x = -70; x < 85; x += 15) for (const z of [-4.2, 4.2]) g.cyl(0.25, 0.3, 0.6, 8, x, 0.3, z, 0x2b3137);
    s.put(g, M); }
  // breakwater with a lighthouse at its end
  { const M = s.frame(85, SH - 60, -Math.PI / 2), g = new GB();
    for (let x = 0; x < 110; x += 11) { const hgt = 6 + (x % 22 ? 0.6 : 0); g.box(11.5, hgt + 4, 10, x + 5.5, hgt / 2 - 4, 0, x % 22 ? 0x7b7d7a : 0x6f716e); s.boxCol(M, 11.5, hgt + 4, 10, x + 5.5, hgt / 2 - 4, 0); }
    s.put(g, M);
    const Ml = s.frame(85, SH - 175, 0), gl = new GB(), lt = new GB();
    gl.cyl(3, 4, 4, 14, 0, 2, 0, 0x7b7d7a);
    for (let k = 0; k < 6; k++) gl.cyl(2.6 - k * 0.15, 2.75 - k * 0.15, 3.6, 14, 0, 5.8 + k * 3.6, 0, k % 2 ? 0xe8ebe7 : 0xc8432f);
    gl.cyl(2.2, 2.2, 0.5, 14, 0, 27.6, 0, COLS.dark); lt.cyl(1.4, 1.4, 2.4, 12, 0, 29, 0, 0xfff1c4); gl.cone(2, 2, 12, 0, 31.2, 0, COLS.dark);
    s.put(gl, Ml); s.put(lt, Ml, true); s.geoCol(new THREE.CylinderGeometry(3, 4, 28, 10).translate(0, 14, 0), Ml);
    SITES.anim.push({ kind: 'beam', site: s, M: Ml, y: 29 });
  }
  // boat ramp
  wedge(s, s.frame(-85, SH + 10, -Math.PI / 2), 50, 10, 0.01, 0x8f8e88);
  { const M = s.frame(-85, SH - 12, -Math.PI / 2), V = [[0, 0.1, -5], [0, 0.1, 5], [42, -6, -5], [42, -6, 5], [0, -2, -5], [0, -2, 5], [42, -8, -5], [42, -8, 5]]; s.polyCol(M, V, BOX_F.map(f => f)); const g = new GB(); g.poly({ V, F: BOX_F }, 0x8f8e88); s.put(g, M); }
  // warehouses, a crane and stacked containers
  building(s, -55, 15, 0, 40, 22, 12, { wall: 0x9fb0bc, floors: 1, lit: 0.2, trim: 0x2f6f9f, door: false });
  building(s, 15, 20, 0, 46, 22, 14, { wall: 0xc9b089, floors: 1, lit: 0.2, trim: 0x7b4636, door: false });
  for (const u of [-55, 15]) { const M = s.frame(u, -2, 0), g = new GB(); g.box(14, 9, 0.3, 0, 4.5, 0, 0x59626a); s.put(g, M); }
  { const M = s.frame(55, SH + 6, 0), g = new GB(), H = 24;
    for (const [x, z] of [[-6, -5], [6, -5], [-6, 5], [6, 5]]) { g.box(1, H, 1, x, H / 2, z, COLS.yellow); s.boxCol(M, 1, H, 1, x, H / 2, z); }
    g.box(14, 2, 12, 0, H + 1, 0, COLS.yellow); g.box(4, 1.6, 36, 0, H + 2.6, -18, COLS.yellow); g.box(4, 3, 4, 0, H + 4, 0, COLS.dark);
    s.put(g, M); }
  const cc = [0xc8432f, 0x2f6f9f, 0x2f8f86, 0xe8a33d, 0x6b6f73];
  for (let i = 0; i < 3; i++) for (let k = 0; k < 2 + (i % 2); k++) { const M = s.frame(70 + i * 3.2, 25, Math.PI / 2, k * 2.65), g = new GB(); g.box(12, 2.6, 2.5, 0, 1.3, 0, cc[(i * 3 + k) % 5]); for (let x = -5.5; x <= 5.5; x += 0.6) g.box(0.08, 2.4, 2.56, x, 1.3, 0, shade(cc[(i * 3 + k) % 5], 0.8)); s.put(g, M); s.boxCol(M, 12, 2.6, 2.5, 0, 1.3, 0); }
  for (let i = 0; i < 6; i++) s.loose('barrel', -20 + (i % 3) * 1.1, SH + 8 + Math.floor(i / 3) * 1.1);
  for (let i = 0; i < 3; i++) s.loose('crate', 30 + i * 1.1, SH + 10);
  WP.spawns.harbor = { name: 'Harbor', u: -70, v: SH - 110, ang: -Math.PI / 2, site: s, sea: true };
  s.finish();
}
/* ---------- the Moon base, on the side that always faces Terra ---------- */
function planMoon() {
  const near = toSpin(MOON, new V3().subVectors(PLANET.center, MOON.center), new V3()).normalize();
  const t1 = new V3(), t2 = new V3(); tangentBasis(near.x, near.y, near.z, t1, t2);
  let best = null, bs = -1e9; const d = new V3(), q = new V3();
  for (let r = 0; r <= 420; r += 35) for (let k = 0; k < (r ? 12 : 1); k++) {
    expDir(near, t1, t2, MOON.R, Math.cos(k * 0.52) * r, Math.sin(k * 0.52) * r, d);
    let mn = 1e9, mx = -1e9, sum = 0, n = 0;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { const tt1 = new V3(), tt2 = new V3(); tangentBasis(d.x, d.y, d.z, tt1, tt2); expDir(d, tt1, tt2, MOON.R, i * 40, j * 40, q); const h = moonHeight(q.x, q.y, q.z); mn = Math.min(mn, h); mx = Math.max(mx, h); sum += h; n++; }
    const sc = -(mx - mn) - r * 0.02;
    if (sc > bs) { bs = sc; best = { d: d.clone(), h: sum / n }; }
  }
  const C = best.d, e1 = new V3(), e3 = new V3(); tangentBasis(C.x, C.y, C.z, e1, e3); e3.negate();   // x, up, z = x × up, like every other site
  const ws = MOON.ws = makeWS(MOON, 64);
  wsZone(ws, C, e1, e3, 85, 85, best.h, 40, [0.62, 0.61, 0.58]);
  ws.on = true;
  WP.moon = { C, E1: e1, E3: e3, h: best.h };
  WORLD.locs.moon.base = true;
}
function buildMoonBase() {
  const m = WP.moon; if (!m) return;
  const s = new Site('moonbase', MOON, m.C, m.E1, m.E3, m.h);
  const dome = (u, v, r, col) => { const M = s.frame(u, v), g = new GB(), gl = new GB(); g.add(new THREE.SphereGeometry(r, 20, 8, 0, TAU, 0, Math.PI / 2), col); g.cyl(r + 0.3, r + 0.3, 0.8, 20, 0, 0.4, 0, 0x8c99a3); for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; gl.box(0.9, 0.5, 0.08, Math.cos(a) * r * 0.82, r * 0.5, Math.sin(a) * r * 0.82, 0xffd27a, 0, -a + Math.PI / 2, 0); } s.put(g, M); s.put(gl, M, true); s.geoCol(new THREE.SphereGeometry(r, 10, 5, 0, TAU, 0, Math.PI / 2), M); };
  dome(0, 0, 9, 0xe6e2d6); dome(-26, 6, 6, 0xd8d2c4); dome(22, 10, 6, 0xd8d2c4);
  // tubes linking them
  for (const [u0, u1, v0, v1] of [[-20, -8, 5, 2], [8, 16, 2, 8]]) { const ang = Math.atan2(v1 - v0, u1 - u0), L = Math.hypot(u1 - u0, v1 - v0), M = s.frame((u0 + u1) / 2, (v0 + v1) / 2, ang), g = new GB(); g.cyl(1.4, 1.4, L + 2, 12, 0, 1.6, 0, 0xcfcac0, 0, 0, Math.PI / 2); s.put(g, M); s.geoCol(new THREE.CylinderGeometry(1.4, 1.4, L + 2, 8).rotateZ(Math.PI / 2).translate(0, 1.6, 0), M); }
  // landing pads with lights
  for (const [u, v] of [[0, -48], [40, -40]]) { s.disc(u, v, 0, 12, rgb(0x6d6f72)); s.disc(u, v, 10.4, 11.2, rgb(0xf2c230), 0.12); const gl = new GB(); for (let k = 0; k < 12; k++) { const a = k / 12 * TAU; gl.box(0.4, 0.25, 0.4, Math.cos(a) * 12.4, 0.13, Math.sin(a) * 12.4, 0x52ff7a); } s.put(gl, s.frame(u, v), true); }
  // solar farm and an antenna mast with a dish
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const M = s.frame(-40 + i * 9, 36 + j * 9, 0), g = new GB(); g.box(0.2, 1.6, 0.2, 0, 0.8, 0, 0x8c99a3); g.box(7, 0.12, 4, 0, 1.8, 0, 0x1d3c6e, 0.5, 0, 0); s.put(g, M); s.boxCol(M, 0.4, 1.6, 0.4, 0, 0.8, 0); }
  { const M = s.frame(34, 32), g = new GB(), gl = new GB(); g.box(0.6, 22, 0.6, 0, 11, 0, 0xe8ebe7); g.add(new THREE.SphereGeometry(3, 14, 6, 0, TAU, 0, 1.1), 0xe8ebe7, 0, 22, 2, -1, 0, 0); gl.sph(0.3, 0, 22.5, 0, 0xff3b2b); s.put(g, M); s.put(gl, M, true); s.boxCol(M, 0.6, 22, 0.6, 0, 11, 0); }
  // rover garage, open at the front
  { const M = s.frame(-30, -30, Math.PI / 2), g = new GB(); g.box(16, 6, 0.5, 0, 3, 7, 0xb4bcc2); s.boxCol(M, 16, 6, 0.5, 0, 3, 7); for (const x of [-8, 8]) { g.box(0.5, 6, 14, x, 3, 0, 0xb4bcc2); s.boxCol(M, 0.5, 6, 14, x, 3, 0); } g.box(16.5, 0.5, 14.5, 0, 6.2, 0, 0x8c99a3); s.boxCol(M, 16.5, 0.5, 14.5, 0, 6.2, 0); s.put(g, M); }
  for (let i = 0; i < 4; i++) s.loose('crate', 14 + i * 1.1, -20);
  WP.spawns.moon = { name: 'The Moon base', u: 0, v: -48, ang: 0, site: s };
  s.finish();
}
/* ---------- build everything, then turn the spawn spots into locations ---------- */
function buildWorld() {
  const t0 = performance.now();
  SITES.mats = true;
  MAT.site = shine(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 12, specular: 0x111111 }), 'site', 0.5, { windows: true, ao: true });
  MAT.decal = new THREE.MeshLambertMaterial({ vertexColors: true });
  MAT.glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  buildSpacePort(); buildRoads(); buildAirport(); buildTown('town1', 'Liftoff', 'small'); buildTown('town2', 'Rocket City', 'big'); buildRace(); buildHarbor(); buildMoonBase();
  buildGlobe();
  // the lighthouse beam and the windmill sails turn (their matrices are in the world's own frame)
  for (const a of SITES.anim) {
    let mesh;
    if (a.kind === 'beam') {
      const geo = new THREE.CylinderGeometry(0.3, 6, 60, 12, 1, true); geo.translate(0, 30, 0); geo.rotateZ(-Math.PI / 2 + 0.05);
      mesh = new THREE.Mesh(geo, MAT.beam); mesh.renderOrder = 5; a.base = a.M.clone().multiply(new THREE.Matrix4().makeTranslation(0, a.y, 0));
    } else { mesh = new THREE.Mesh(a.gb.geometry(), MAT.site); mesh.castShadow = true; a.base = a.M.clone(); a.gb = null; }
    mesh.matrixAutoUpdate = false; a.mesh = mesh;
    SITES.groups.get(a.site.cel).add(mesh);
  }
  const L = WORLD.locs;
  for (const [k, sp] of Object.entries(WP.spawns)) {
    const S = sp.site, d = S.dir(sp.u, sp.v), f = S.dir(sp.u + Math.cos(sp.ang), sp.v + Math.sin(sp.ang)).sub(d); f.addScaledVector(d, -f.dot(d)).normalize();
    if (k === 'moon') { Object.assign(L.moon, { dir: d, fwd: f }); continue; }
    L[k] = { name: sp.name, kind: sp.sea ? 'sea' : 'ground', dir: d, fwd: f, group: sp.group || 'Places', cel: PLANET };
    if (sp.y !== undefined) L[k].hAbs = S.H + sp.y;
  }
  // a ride on each train
  TRAIN.list.forEach((tr, i) => { L['train' + i] = { name: `Ride the ${tr.line.name} train`, kind: 'train', line: i, group: 'Railways', cel: PLANET }; });
  console.log(`world built in ${(performance.now() - t0).toFixed(0)} ms: ${W.props.length} solids, ${SITES.loose.length} loose props`);
}
/* each frame: the sites ride with their worlds; far worlds' sites are hidden */
const _wq = new V3();
const _camL = new V3();
function updateSites(dt) {
  for (const [cel, g] of SITES.groups) {
    g.position.copy(cel.center); g.quaternion.copy(cel.spinQ);
    g.visible = camera.position.distanceTo(cel.center) - cel.R < 60000;
  }
  // far sites, road and rail chunks are hidden
  for (const s of SITES.list) {
    if (!s.meshes) continue;
    toSpin(s.cel, _camL.subVectors(camera.position, s.cel.center), _camL);
    const vis = _camL.distanceTo(s.O) < (s.cull || 12000);
    if (vis !== s.vis) { s.vis = vis; for (const m of s.meshes) m.visible = vis; }
  }
  if (LAZY.jobs.length) runLazy(6);
  const night = LIGHTS.on;
  if (MAT.glow) MAT.glow.color.setRGB(night ? 1 : 0.42, night ? 1 : 0.46, night ? 1 : 0.5);
  for (const a of SITES.anim) if (a.mesh) {
    if (a.kind === 'beam') { a.t = (a.t || 0) + dt * 0.9; a.mesh.visible = night && a.site.vis !== false; a.mesh.matrix.copy(a.base).multiply(_m4r.makeRotationY(a.t)); }
    else { a.t = (a.t || 0) + dt * a.speed; a.mesh.visible = a.site.vis !== false; a.mesh.matrix.copy(a.base).multiply(_m4r.makeRotationZ(a.t)); }
    a.mesh.matrixWorldNeedsUpdate = true;
  }
  toSpin(PLANET, _camL.subVectors(camera.position, PLANET.center), _camL);
  drawTrains(_camL);
}
const _m4r = new THREE.Matrix4();
/* ---------- loose props: real bodies, asleep until something hits them ---------- */
function spawnLoose(from = 0) {
  if (!from) { for (const b of SITES.looseBodies) if (!b.dead) removeBody(b); SITES.looseBodies = []; }
  const q = new Quat(), pos = new V3(), sc = new V3();
  for (const L of SITES.loose.slice(from)) {
    if (!PD[L.t]) continue;
    const p = new PartInst(L.t, [0, 0, 0], [1, 0, 0, 0, 1, 0, 0, 0, 1], PD[L.t].dc);
    const b = new Body([p], { name: PD[L.t].name });
    b.loose = true;
    L.M.decompose(pos, q, sc);
    b.q.copy(L.cel.spinQ).multiply(q); b.updR();
    // sit it on the ground: its lowest cell's bottom at the frame origin
    const lo = designBottom([{ t: L.t, a: [0, 0, 0], m: [1, 0, 0, 0, 1, 0, 0, 0, 1] }]);
    const up = new V3().setFromMatrixColumn(L.M, 1);
    const at = fromSpin(L.cel, pos.clone().addScaledVector(up, -lo + 0.02), new V3()).add(L.cel.center);
    b.x.copy(at).addScaledVector(b.dirW(b.comD.x, b.comD.y, b.comD.z, new V3()), 1);
    b.toWorld(0, 0, 0, _wq); b.x.add(at.sub(_wq));
    surfaceVel(L.cel, b.x, b.v); spinVec(L.cel, b.w);
    W.bodies.push(b); b.pin(L.cel, false);
    SITES.looseBodies.push(b);
  }
}
/* ---------- race timing: gates in order, start and finish at the first ---------- */
const RACE = { next: 0, lapStart: 0, best: 0, last: 0, on: false, prevSide: [] };
const _rp = new V3(), _rn = new V3();
function updateRace() {
  const R = SITES.race, b = G.player, box = $('raceBox');
  if (!R || !b || b.dead || G.mode !== 'drive') { box.hidden = true; return; }
  const g0 = R.gates[0], cel = PLANET;
  const lp = toSpin(cel, _rp.subVectors(b.x, cel.center), _rp);
  const near = lp.distanceTo(g0.p) < 450;
  if (!near && !RACE.on) { box.hidden = true; return; }
  // crossing a gate: the side of its plane flips while inside its width
  for (let i = 0; i < R.gates.length; i++) {
    const g = R.gates[i], d = _rn.subVectors(lp, g.p), side = Math.sign(d.dot(g.n));
    const lateral = Math.sqrt(Math.max(0, d.lengthSq() - d.dot(g.n) ** 2));
    const prev = RACE.prevSide[i]; RACE.prevSide[i] = side;
    if (prev === -1 && side === 1 && lateral < g.w && i === RACE.next) {
      if (i === 0) {
        if (RACE.on && RACE.next === 0) { RACE.last = W.time - RACE.lapStart; if (!RACE.best || RACE.last < RACE.best) { RACE.best = RACE.last; toast(`Best lap! ${fmtLap(RACE.last)}`, 2600); } else toast(`Lap ${fmtLap(RACE.last)}`, 2200); SND.play('beep'); }
        RACE.on = true; RACE.lapStart = W.time; RACE.next = 1;
        if (!RACE.last) toast('Lap started: drive through every orange gate', 2200);
      } else { RACE.next = (i + 1) % R.gates.length; SND.play('tick'); }
    }
  }
  if (!near && RACE.on && lp.distanceTo(g0.p) > 900) RACE.on = false;
  box.hidden = false;
  box.innerHTML = RACE.on ? `<span>Lap <b>${fmtLap(W.time - RACE.lapStart)}</b></span><span>Gate <b>${RACE.next === 0 ? 'finish' : RACE.next + '/' + (R.gates.length - 1)}</b></span>${RACE.best ? `<span>Best <b>${fmtLap(RACE.best)}</b></span>` : ''}`
    : `<span>Race track: cross the start line to start a lap</span>${RACE.best ? `<span>Best <b>${fmtLap(RACE.best)}</b></span>` : ''}`;
}
function fmtLap(t) { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; }

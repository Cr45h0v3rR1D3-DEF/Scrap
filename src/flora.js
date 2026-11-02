'use strict';
/* ================= Scrapline · trees, bushes and crystals ================= */
/* Plants grow only near the camera. Each cube face of a world is cut into tiles about 48 m across, laid out the same
   way as the terrain patches; a tile's plants come from a hash of the tile, so the same tree is always in the same place.
   Every kind is drawn as one instanced mesh in its world's own frame, set onto the terrain mesh actually being shown,
   so trees neither float nor sink as the ground's detail changes. A vehicle that hits a trunk fast knocks it over. */
const FLORA = { cel: null, tiles: new Map(), queue: [], want: new Set(), center: new V3(1e9, 0, 0), meshes: new Map(), kinds: [],
  radius: 650, tries: 10, nearR: 190, max: 3500, maxNear: 1200, shadows: false, falling: [], felled: new Set(), dirty: false, builtVer: -1, lastBuild: 0, alt: 0 };
const FL_TILE = 48;

/* ---- the plants: a few low-poly shapes. Trunks carry their own colour; leaves are white and take each plant's colour ---- */
function flPiece(geo, col, m) {
  const g = geo.index ? geo.toNonIndexed() : geo; if (m) g.applyMatrix4(m);
  const n = g.attributes.position.count, c = new Float32Array(n * 3), lf = new Float32Array(n), cc = new THREE.Color(col == null ? 0xffffff : col);
  for (let i = 0; i < n; i++) { c[i * 3] = cc.r; c[i * 3 + 1] = cc.g; c[i * 3 + 2] = cc.b; lf[i] = col == null ? 1 : 0; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setAttribute('leaf', new THREE.BufferAttribute(lf, 1));
  return g;
}
function flMerge(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3), L = new Float32Array(n); let o = 0;
  for (const g of list) {
    g.computeVertexNormals();
    P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); C.set(g.attributes.color.array, o * 3); L.set(g.attributes.leaf.array, o);
    o += g.attributes.position.count; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('color', new THREE.BufferAttribute(C, 3)); out.setAttribute('leaf', new THREE.BufferAttribute(L, 1));
  out.computeBoundingSphere(); return out;
}
const flT = (x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0, ry = 0) => new THREE.Matrix4().compose(new V3(x, y, z), new Quat().setFromEuler(new THREE.Euler(rx, ry, rz)), new V3(sx, sy, sz));
// trunks reach well below the ground so a tree on a slope never shows a gap under it; they are open tubes (their ends are
// hidden in the ground and the crown). Each kind also has a far shape of a few triangles, used beyond a short distance.
const flTube = (r0, r1, h, n, col, m) => flPiece(new THREE.CylinderGeometry(r0, r1, h, n, 1, true), col, m);
function flFrond(m) {   // a flat leaf, seen from both sides
  const g = new THREE.BufferGeometry(), P = [0, 0, -0.38, 3.2, 0, -0.12, 3.2, 0, 0.12, 0, 0, 0.38];
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2].flatMap(i => P.slice(i * 3, i * 3 + 3)), 3));
  return flPiece(g, null, m);
}
const FL_KINDS = {
  pine: { h: 9, trunk: 0.3,
    build: () => flMerge([flTube(0.2, 0.32, 4.4, 6, 0x5e4230, flT(0, 0.2, 0)),
      flPiece(new THREE.ConeGeometry(2.3, 3.4, 7), null, flT(0, 3.4, 0)), flPiece(new THREE.ConeGeometry(1.8, 2.9, 7), null, flT(0, 5.3, 0, 1, 1, 1, 0, 0, 0.4)),
      flPiece(new THREE.ConeGeometry(1.15, 2.5, 7), null, flT(0, 7.3, 0, 1, 1, 1, 0, 0, 0.9))]),
    far: () => flMerge([flTube(0.22, 0.32, 3.4, 3, 0x5e4230, flT(0, 0.3, 0)), flPiece(new THREE.ConeGeometry(2.2, 4.4, 5, 1, true), null, flT(0, 3.8, 0)),
      flPiece(new THREE.ConeGeometry(1.5, 3.8, 5, 1, true), null, flT(0, 6.6, 0, 1, 1, 1, 0, 0, 0.6))]) },
  oak: { h: 7.5, trunk: 0.38,
    build: () => flMerge([flTube(0.24, 0.4, 5, 6, 0x6a4c32, flT(0, 0.5, 0)), flTube(0.1, 0.16, 2, 4, 0x6a4c32, flT(0.6, 3.4, 0, 1, 1, 1, 0, -0.7)),
      flPiece(new THREE.IcosahedronGeometry(2.5, 0), null, flT(0, 4.9, 0, 1, 0.82, 1)), flPiece(new THREE.IcosahedronGeometry(1.75, 0), null, flT(1.4, 5.5, 0.5, 1, 0.8, 1)),
      flPiece(new THREE.IcosahedronGeometry(1.6, 0), null, flT(-1.1, 5.7, -0.7, 1, 0.8, 1))]),
    far: () => flMerge([flTube(0.26, 0.4, 4.4, 3, 0x6a4c32, flT(0, 0.8, 0)), flPiece(new THREE.IcosahedronGeometry(2.9, 0), null, flT(0.2, 5.1, 0, 1.1, 0.82, 1.05))]) },
  bush: { h: 1.6, trunk: 0,
    build: () => flMerge([flPiece(new THREE.IcosahedronGeometry(1.1, 0), null, flT(0, 0.45, 0, 1.25, 0.8, 1)), flPiece(new THREE.IcosahedronGeometry(0.8, 0), null, flT(0.8, 0.45, 0.35, 1, 0.8, 1))]),
    far: () => flMerge([flPiece(new THREE.OctahedronGeometry(1.25, 0), null, flT(0.3, 0.5, 0.1, 1.3, 0.7, 1.1))]) },
  palm: { h: 8, trunk: 0.26,
    build() {
      const parts = [flTube(0.24, 0.26, 2.2, 6, 0x8a6a44, flT(0, -0.6, 0))];
      for (let i = 0; i < 4; i++) parts.push(flTube(0.17, 0.23, 2.15, 6, 0x8a6a44, flT(i * i * 0.13, 1 + i * 2, 0, 1, 1, 1, 0, -i * 0.09)));
      // each frond leans out and droops from the crown
      for (let k = 0; k < 7; k++) parts.push(flFrond(new THREE.Matrix4().makeTranslation(1.95, 7.9, 0).multiply(new THREE.Matrix4().makeRotationY(k / 7 * TAU)).multiply(flT(0, 0, 0, 1, 1, 1, 0, -0.38))));
      return flMerge(parts); },
    far() {
      const parts = [flTube(0.2, 0.26, 8.6, 3, 0x8a6a44, flT(0.8, 3.6, 0, 1, 1, 1, 0, -0.2))];
      for (let k = 0; k < 4; k++) parts.push(flFrond(new THREE.Matrix4().makeTranslation(1.95, 7.9, 0).multiply(new THREE.Matrix4().makeRotationY(k / 4 * TAU + 0.4)).multiply(flT(0, 0, 0, 1, 1, 1.6, 0, -0.38))));
      return flMerge(parts); } },
  blob: { h: 6, trunk: 0.36,
    build: () => flMerge([flTube(0.22, 0.42, 5.2, 6, 0x3a2a34, flT(0, 0.8, 0)),
      flPiece(new THREE.SphereGeometry(2.4, 8, 4, 0, TAU, 0, Math.PI / 2), null, flT(0, 3.3, 0, 1, 0.65, 1)),
      flPiece(new THREE.SphereGeometry(1.3, 7, 4, 0, TAU, 0, Math.PI / 2), null, flT(0.4, 4.6, -0.3, 1, 0.8, 1))]),
    far: () => flMerge([flTube(0.24, 0.42, 4.4, 3, 0x3a2a34, flT(0, 1.2, 0)), flPiece(new THREE.SphereGeometry(2.4, 5, 2, 0, TAU, 0, Math.PI / 2), null, flT(0, 3.3, 0, 1, 0.75, 1))]) },
  crystal: { h: 5, trunk: 0.5, glow: true,
    build: () => flMerge([flPiece(new THREE.ConeGeometry(0.6, 6, 5, 1, true), null, flT(0, 2, 0)), flPiece(new THREE.ConeGeometry(0.4, 3.6, 5, 1, true), null, flT(0.7, 1.1, 0.2, 1, 1, 1, 0.2, -0.45)),
      flPiece(new THREE.ConeGeometry(0.35, 3, 5, 1, true), null, flT(-0.6, 0.8, -0.3, 1, 1, 1, -0.3, 0.5))]),
    far: () => flMerge([flPiece(new THREE.ConeGeometry(0.7, 6, 4, 1, true), null, flT(0, 2, 0)), flPiece(new THREE.ConeGeometry(0.45, 3.4, 3, 1, true), null, flT(0.7, 1.1, 0.2, 1, 1, 1, 0.2, -0.45))]) }
};
/* Terra: oaks and bushes low down, pines higher up; thick woods where the ground is darkest green, scattered trees elsewhere */
PLANET.flora = { kinds: ['oak', 'pine', 'bush'],
  dens(h, slope, x, y, z) {
    if (h < 4.5 || h > 620 || slope > 0.3) return 0;
    const v = nE(x * 70, y * 70, z * 70) * 0.5 + 0.5, v2 = nE(x * 260 + 3, y * 260, z * 260) * 0.5 + 0.5, t = clamp((h - 4) / 460, 0, 1);
    return 0.05 + smooth(0.55, 0.75, v2 * 0.6 + v * 0.4) * (1 - t * 0.5) * 0.9;
  },
  pick: (h, r) => h > 300 ? (r < 0.8 ? 'pine' : 'bush') : h > 150 ? (r < 0.45 ? 'pine' : r < 0.82 ? 'oak' : 'bush') : (r < 0.14 ? 'pine' : r < 0.72 ? 'oak' : 'bush'),
  cols: [[0.2, 0.38, 0.17], [0.26, 0.44, 0.2], [0.17, 0.32, 0.16], [0.32, 0.46, 0.21]] };
MIRE.flora = { kinds: ['oak', 'bush'], scale: 1.4, dens: (h, slope) => h < 3.5 || h > 330 || slope > 0.32 ? 0 : 0.6, pick: (h, r) => r < 0.7 ? 'oak' : 'bush',
  cols: [[0.13, 0.32, 0.13], [0.17, 0.38, 0.15], [0.11, 0.26, 0.11], [0.2, 0.34, 0.12]] };
for (const c of ROCKY) if (c.flora) { c.flora.top = c.maxH + 12; if (!c.flora.pick) { const K = c.flora.kinds; c.flora.pick = (h, r) => K.length > 1 && r > 0.7 ? K[1] : K[0]; } }

/* ---- where plants may not grow: on roads and railways, in towns and other built places, round the launch pad ---- */
function wsNear(ws, x, y, z, margin) {
  if (!ws || !ws.on) return false;
  const list = ws.grid.get(wsKey(ws, x, y, z)); if (!list) return false;
  const R = ws.R;
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (it.zone) {
      const dx = x - it.cx, dy = y - it.cy, dz = z - it.cz;
      if (Math.abs(dx * it.ux + dy * it.uy + dz * it.uz) * R < it.a + margin && Math.abs(dx * it.vx + dy * it.vy + dz * it.vz) * R < it.b + margin) return true;
    } else {
      let t = ((x - it.x0) * it.ex + (y - it.y0) * it.ey + (z - it.z0) * it.ez) / it.l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = it.x0 + it.ex * t - x, qy = it.y0 + it.ey * t - y, qz = it.z0 + it.ez * t - z;
      if (Math.sqrt(qx * qx + qy * qy + qz * qz) * R < it.w + margin) return true;
    }
  }
  return false;
}
/* a direction -> its cube face and the face coordinates the terrain uses (the inverse of faceDir) */
const _flab = [0, 0, 0];
function flFaceAB(x, y, z, out) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  const f = ax >= ay && ax >= az ? (x > 0 ? 0 : 1) : ay >= az ? (y > 0 ? 2 : 3) : (z > 0 ? 4 : 5), F = FACES[f];
  const sa = x * F[1][0] + y * F[1][1] + z * F[1][2], sb = x * F[2][0] + y * F[2][1] + z * F[2][2];
  let a = sa * Math.SQRT2, b = sb * Math.SQRT2;
  for (let k = 0; k < 6; k++) { a = sa / Math.sqrt(0.5 - b * b / 6); b = sb / Math.sqrt(0.5 - a * a / 6); }
  out[0] = f; out[1] = a < -1 ? -1 : a > 1 ? 1 : a; out[2] = b < -1 ? -1 : b > 1 ? 1 : b;
  return out;
}
const flKey = (f, a, b, N) => (f * N + Math.min(N - 1, Math.floor((a + 1) / 2 * N))) * N + Math.min(N - 1, Math.floor((b + 1) / 2 * N));
const _fla = new V3(), _flb = new V3(), _flc = new V3(), _fld = new V3(), _fle = [0, 0, 0];
/* the plants in one tile, worked out once and kept while the tile is near */
function flGrow(c, key, N) {
  const F = c.flora, rnd = mulberry32((key * 2654435761 + Math.round(c.R) * 97) % 4294967296), list = [], R = c.R;
  const j = key % N, i = ((key - j) / N) % N, f = Math.floor(key / (N * N)), cosPad = Math.cos(260 / R);
  for (let k = 0; k < FLORA.tries; k++) {
    const a = (i + rnd()) / N * 2 - 1, b = (j + rnd()) / N * 2 - 1, r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd(), r5 = rnd();
    faceDir(f, a, b, _fle); const x = _fle[0], y = _fle[1], z = _fle[2];
    if (c === PLANET && WORLD.L && x * WORLD.L.up.x + y * WORLD.L.up.y + z * WORLD.L.up.z > cosPad) continue;
    const h = c.heightL(x, y, z);
    if (F.dens(h, 0, x, y, z) <= 0) continue;
    // the slope from two nearby heights
    _fla.set(x, y, z); tangentBasis(x, y, z, _flb, _flc);
    _fld.copy(_fla).addScaledVector(_flb, 2.5 / R).normalize(); const h1 = c.heightL(_fld.x, _fld.y, _fld.z);
    _fld.copy(_fla).addScaledVector(_flc, 2.5 / R).normalize(); const h2 = c.heightL(_fld.x, _fld.y, _fld.z);
    const slope = Math.hypot(h1 - h, h2 - h) / 2.5;
    if (r1 > F.dens(h, slope, x, y, z)) continue;
    if (c === PLANET && wsNear(PLANET.ws, x, y, z, 6)) continue;
    const kind = F.pick(h, r2), col = F.cols[Math.floor(r3 * F.cols.length)], tint = 0.86 + r5 * 0.28;
    const id = c.name + ':' + key + ':' + k, s = (0.72 + r4 * 0.7) * (F.scale || 1) * (kind === 'bush' ? 0.9 : 1);
    const t = { id, f, a, b, d: new V3(x, y, z), p: new V3(x, y, z).multiplyScalar(R + h), h, kind, col: [col[0] * tint, col[1] * tint, col[2] * tint], s, yaw: r2 * 997 % TAU,
      fallen: 0, fall: null, mesh: null, idx: -1, show: 1 };
    if (FLORA.felled.has(id)) { t.fallen = 1; t.fall = new V3().crossVectors(t.d, _flb).normalize(); }
    list.push(t);
  }
  return list;
}
/* set a plant onto the terrain mesh being shown where it stands (that mesh is coarser far away than the true ground) */
const _flP0 = new V3();
function flSnap(c, t) {
  let n = c.ter.roots[t.f];
  while (n && !(n.mesh && n.mesh.visible) && n.children) { const s = n.size / 2; n = n.children[(t.a >= n.a0 + s ? 1 : 0) + (t.b >= n.b0 + s ? 2 : 0)]; }
  if (!n || !n.mesh) { t.p.copy(t.d).multiplyScalar(c.R + t.h); return; }
  const P = n.mesh.geometry.attributes.position.array, W = TN + 1;
  const fi = clamp((t.a - n.a0) / n.size * TN, 0, TN - 1e-6), fj = clamp((t.b - n.b0) / n.size * TN, 0, TN - 1e-6);
  const i0 = Math.floor(fi), j0 = Math.floor(fj), u = fi - i0, v = fj - j0;
  const A = (j0 * W + i0) * 3, B = A + 3, C = A + W * 3, D = C + 3;
  // the patch is two triangles per cell: (i,j)(i+1,j)(i+1,j+1) and (i,j)(i+1,j+1)(i,j+1)
  if (u >= v) for (let q = 0; q < 3; q++) _flP0.setComponent(q, P[A + q] + u * (P[B + q] - P[A + q]) + v * (P[D + q] - P[B + q]));
  else for (let q = 0; q < 3; q++) _flP0.setComponent(q, P[A + q] + u * (P[D + q] - P[C + q]) + v * (P[C + q] - P[A + q]));
  t.p.copy(_flP0).add(n.c);
}

/* ---- the instanced meshes ---- */
function flMaterial(glow) {
  const m = glow ? new THREE.MeshBasicMaterial({ vertexColors: true }) : new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute float leaf;\n' + sh.vertexShader.replace('#include <color_vertex>', THREE.ShaderChunk.color_vertex.replace('vColor.xyz *= instanceColor.xyz;', 'vColor.xyz *= mix(vec3(1.0), instanceColor.xyz, leaf);'));
  };
  return m;
}
// key: the kind for its full shape, or kind + '~' for its far shape
function flMeshFor(key) {
  const far = key.endsWith('~'), cap = far ? FLORA.max : FLORA.maxNear;
  let m = FLORA.meshes.get(key);
  if (!m || m.cap !== cap) {
    if (m) { if (m.parent) m.parent.remove(m); if (m.dispose) m.dispose(); }
    const K = FL_KINDS[far ? key.slice(0, -1) : key];
    const geo = far ? K.farGeo || (K.farGeo = K.far()) : K.geo || (K.geo = K.build());
    m = new THREE.InstancedMesh(geo, K.mat || (K.mat = flMaterial(K.glow)), cap);
    m.cap = cap; m.far = far; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.frustumCulled = false;
    m.receiveShadow = !K.glow; m.castShadow = FLORA.shadows && !K.glow && !far;
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    FLORA.meshes.set(key, m);
  }
  return m;
}
/* Fast keeps a thin ring of plants close by; Balanced and Sharp reach further and show the full shapes further out,
   and only Sharp has them cast shadows */
function setFloraQuality(q) {
  const T = { low: [300, 6, 110, 1500, 600], balanced: [650, 10, 190, 3500, 1200], high: [1100, 12, 300, 7000, 2600] }[q] || [650, 10, 190, 3500, 1200];
  [FLORA.radius, FLORA.tries, FLORA.nearR, FLORA.max, FLORA.maxNear] = T;
  FLORA.shadows = q === 'high';
  flReset();
}
function flReset() {
  for (const m of FLORA.meshes.values()) { m.count = 0; if (m.parent) m.parent.remove(m); }
  FLORA.cel = null; FLORA.tiles.clear(); FLORA.queue.length = 0; FLORA.want.clear(); FLORA.center.set(1e9, 0, 0); FLORA.rad = 0; FLORA.falling.length = 0; FLORA.builtVer = -1;
}
const _flM = new THREE.Matrix4(), _flQ = new Quat(), _flQ2 = new Quat(), _flS = new V3(), _flU = new V3(0, 1, 0), _flCol = new THREE.Color();
function flMatrix(t, out) {
  _flQ.setFromUnitVectors(_flU, t.d); _flQ2.setFromAxisAngle(_flU, t.yaw); _flQ.multiply(_flQ2);
  if (t.fallen > 0) { _flQ2.setFromAxisAngle(t.fall, t.fallen * 1.42); _flQ.premultiply(_flQ2); }
  _flS.setScalar(t.s * t.show);
  return out.compose(t.p, _flQ, _flS);
}
/* the rocky world near the camera that has plants, if it is close enough to see them */
function floraWorld() {
  for (const w of ROCKY) if (w.flora && w.ter && !w.ter.skip && w.ter.camD < FLORA.radius + w.maxH) return w;
  return null;
}
function updateFlora(dt) {
  // on the map the plants are kept as they are, just not drawn, so they are all there again when it closes
  const hide = !!G.map;
  if (FLORA.hidden !== hide) { FLORA.hidden = hide; for (const m of FLORA.meshes.values()) m.visible = !hide; }
  if (hide) return;
  const c = floraWorld();
  if (c !== FLORA.cel) {
    flReset(); FLORA.cel = c;
    if (c) { FLORA.kinds = c.flora.kinds.flatMap(k => [k, k + '~']); for (const k of FLORA.kinds) c.ter.group.add(flMeshFor(k)); }
  }
  if (!c) return;
  const N = Math.ceil(Math.PI / 2 * c.R / FL_TILE), R = c.R;
  const lc = toSpin(c, _fla.subVectors(camera.position, c.center), new V3()), r = lc.length(); lc.divideScalar(r);
  const alt = Math.max(0, r - R - Math.max(0, c.heightL(lc.x, lc.y, lc.z))); FLORA.alt = alt;
  // when the camera has moved on, work out which tiles are near and queue the new ones, nearest first
  const rad = Math.sqrt(Math.max(0, FLORA.radius * FLORA.radius - alt * alt));
  if (lc.distanceTo(FLORA.center) * R > 40 || Math.abs(rad - FLORA.rad) > 40) {
    FLORA.center.copy(lc); FLORA.rad = rad; FLORA.want.clear(); FLORA.queue.length = 0;
    if (rad > 30) {
      tangentBasis(lc.x, lc.y, lc.z, _flb, _fld);
      const st = FL_TILE * 0.5, n = Math.ceil(rad / st), q = new V3();
      for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
        const d2 = (i * i + j * j) * st * st; if (d2 > (rad + st) * (rad + st)) continue;
        q.copy(lc).addScaledVector(_flb, i * st / R).addScaledVector(_fld, j * st / R).normalize();
        flFaceAB(q.x, q.y, q.z, _flab); const k = flKey(_flab[0], _flab[1], _flab[2], N);
        if (FLORA.want.has(k)) continue;
        FLORA.want.add(k); if (!FLORA.tiles.has(k)) FLORA.queue.push([k, d2]);
      }
    }
    FLORA.queue.sort((a, b) => a[1] - b[1]);
    for (const k of FLORA.tiles.keys()) if (!FLORA.want.has(k)) FLORA.tiles.delete(k);
    FLORA.dirty = true;
  }
  // grow a few tiles a frame
  const t0 = performance.now();
  while (FLORA.queue.length && performance.now() - t0 < 2.5) {
    const [k] = FLORA.queue.shift();
    if (!FLORA.tiles.has(k)) { FLORA.tiles.set(k, flGrow(c, k, N)); FLORA.dirty = true; }
  }
  // knocked trees tip over
  for (let i = FLORA.falling.length - 1; i >= 0; i--) {
    const t = FLORA.falling[i]; t.fallen = Math.min(1, t.fallen + dt * (0.4 + t.fallen * 2.6));
    if (t.mesh && t.idx >= 0) { t.mesh.setMatrixAt(t.idx, flMatrix(t, _flM)); t.mesh.instanceMatrix.needsUpdate = true; }
    if (t.fallen >= 1) FLORA.falling.splice(i, 1);
  }
  // lay out the instances again when tiles came or went, or the terrain under them changed its detail
  const now = performance.now();
  if (!(FLORA.dirty || c.ter.verV !== FLORA.builtVer) || now - FLORA.lastBuild < 250) return;
  FLORA.dirty = false; FLORA.builtVer = c.ter.verV; FLORA.lastBuild = now;
  const counts = new Map(); for (const k of FLORA.kinds) counts.set(k, 0);
  for (const list of FLORA.tiles.values()) for (const t of list) {
    t.mesh = null; t.idx = -1;
    // grow in from nothing at the edge, so moving along does not make trees pop up
    const e = FLORA.center.distanceTo(t.d) * R; t.show = 1 - smooth(rad * 0.8, rad, e);
    if (t.show <= 0.02) continue;
    // the full shape near by, the simple one further out
    let key = e > FLORA.nearR ? t.kind + '~' : t.kind, m = FLORA.meshes.get(key), n = counts.get(key);
    if (m && n >= m.cap && !m.far) { key = t.kind + '~'; m = FLORA.meshes.get(key); n = counts.get(key); }
    if (!m || n >= m.cap) continue;
    flSnap(c, t);
    m.setMatrixAt(n, flMatrix(t, _flM));
    _flCol.setRGB(t.col[0], t.col[1], t.col[2]); m.setColorAt(n, _flCol);
    t.mesh = m; t.idx = n; counts.set(key, n + 1);
  }
  for (const [k, n] of counts) { const m = FLORA.meshes.get(k); if (!m) continue; m.count = n; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
}
/* the player's vehicle against tree trunks: slowly, it is stopped by them; fast, the tree goes over and the vehicle loses a little speed */
const _flv = new V3(), _flr = new V3(), _flw = new V3(), _flx = new V3(), _fln = new V3();
function floraContacts() {
  const c = FLORA.cel; if (!c || !FLORA.tiles.size || !G.player || G.player.dead) return;
  const N = Math.ceil(Math.PI / 2 * c.R / FL_TILE), R = c.R;
  for (const o of machineOf(G.player)) {
    if (o.dead || (o.asleep && o.frozen) || !o.cellsB) continue;
    const lp = toSpin(c, _fla.subVectors(o.x, c.center), new V3()), rr = lp.length(), dir = lp.clone().divideScalar(rr);
    if (rr - R > c.flora.top + o.radius) continue;
    // the tiles under the vehicle and round it
    const keys = new Set(); tangentBasis(dir.x, dir.y, dir.z, _flb, _flc);
    for (const [ka, kb] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      _fld.copy(dir).addScaledVector(_flb, ka * (o.radius + 4) / R).addScaledVector(_flc, kb * (o.radius + 4) / R).normalize();
      flFaceAB(_fld.x, _fld.y, _fld.z, _flab); keys.add(flKey(_flab[0], _flab[1], _flab[2], N));
    }
    for (const k of keys) {
      const list = FLORA.tiles.get(k); if (!list) continue;
      for (const t of list) {
        const K = FL_KINDS[t.kind]; if (!K.trunk || t.fallen > 0 || t.idx < 0) continue;
        const tr = K.trunk * t.s, top = K.h * t.s;
        // a quick test against the whole vehicle first
        _flr.subVectors(lp, t.p); const up0 = _flr.dot(t.d);
        if (up0 < -o.radius - 1 || up0 > top + o.radius) continue;
        _flr.addScaledVector(t.d, -up0); if (_flr.length() > o.radius + tr + 0.3) continue;
        // then each block: the one deepest into the trunk
        const cb = o.cellsB; let best = 0;
        const step = cb.length > 1600 ? 8 : 4;
        for (let i = 0; i < cb.length; i += step) {
          o.toWorld(cb[i], cb[i + 1], cb[i + 2], _flw); toSpin(c, _flw.sub(c.center), _flx);
          _flx.sub(t.p); const up = _flx.dot(t.d); if (up < -0.3 || up > top) continue;
          _flx.addScaledVector(t.d, -up); const dd = _flx.length(), pen = tr + 0.28 - dd;
          if (pen > best) { best = pen; _fln.copy(_flx).divideScalar(dd || 1); }
        }
        if (best <= 0) continue;
        // the vehicle's speed over the ground, in the world's own frame
        _flv.subVectors(o.v, surfaceVel(c, o.x, _flw)); toSpin(c, _flv, _flw);
        const into = -_flw.dot(_fln), sp = _flw.length();
        if (sp > 4.5 && t.kind !== 'crystal' && o.mass > 150) {
          // over it goes, the way the vehicle was heading
          const hv = _flw.clone().addScaledVector(t.d, -_flw.dot(t.d)); if (hv.lengthSq() < 1e-6) hv.copy(_fln).negate();
          t.fall = new V3().crossVectors(t.d, hv.normalize()).normalize(); t.fallen = 0.001; FLORA.falling.push(t); FLORA.felled.add(t.id);
          o.v.sub(_flv.multiplyScalar(Math.min(0.15, top * 36 / Math.max(o.mass, 200))));
          SND.at('crash', o.x, clamp(sp / 30, 0.25, 0.7));
        } else if (into > -0.5) {
          // solid: push the vehicle out of the trunk and stop it moving into it
          const wn = fromSpin(c, _fln, new V3());
          o.x.addScaledVector(wn, best * 0.8);
          if (into > 0) o.v.addScaledVector(wn, into * 1.05);
        }
      }
    }
  }
}
/* back in the builder: every knocked-over tree stands again */
function floraStandUp() {
  FLORA.felled.clear(); FLORA.falling.length = 0;
  for (const list of FLORA.tiles.values()) for (const t of list) if (t.fallen) { t.fallen = 0; t.fall = null; FLORA.dirty = true; }
  FLORA.lastBuild = 0;
}

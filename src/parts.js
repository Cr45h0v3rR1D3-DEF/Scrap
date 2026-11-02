'use strict';
/* ================= Scrapline · parts catalog, geometry, orientation ================= */
const PALETTE = [
  { name: 'Steel', hex: 0x8c99a3 }, { name: 'Amber', hex: 0xe8a33d }, { name: 'Signal red', hex: 0xc8432f },
  { name: 'Harbor blue', hex: 0x2f6f9f }, { name: 'Graphite', hex: 0x3a4148 }, { name: 'Bone', hex: 0xe6e2d6 },
  { name: 'Moss', hex: 0x5f8a4a }, { name: 'Navy', hex: 0x22344f }, { name: 'Sky', hex: 0x8fc3e0 }, { name: 'Sand', hex: 0xc9ad78 },
  { name: 'Teal', hex: 0x2f8f86 }];
const COL = { tire: 0x23272b, side: 0x30363b, rim: 0xa7b0b5, metal: 0x9aa4aa, dark: 0x2b3137, black: 0x15181b, haz: 0xf2c230, white: 0xe8ebe7, orange: 0xe8692c, red: 0xbf3a2b, bone: 0xe6dcc8, copper: 0xb7743f, navy: 0x23344c, amber: 0xf0a32b };
function shade(c, f) { return new THREE.Color(c).multiplyScalar(f); }
function mixc(a, b, t) { return new THREE.Color(a).lerp(new THREE.Color(b), t); }

/* ---------- convex polyhedron with auto-ordered faces ---------- */
function polyGeo(V, F) {
  let cx = 0, cy = 0, cz = 0; for (const v of V) { cx += v[0]; cy += v[1]; cz += v[2]; } cx /= V.length; cy /= V.length; cz /= V.length;
  const pos = [], nor = [];
  for (const f of F) {
    let fx = 0, fy = 0, fz = 0; for (const i of f) { fx += V[i][0]; fy += V[i][1]; fz += V[i][2]; } fx /= f.length; fy /= f.length; fz /= f.length;
    let nx = 0, ny = 0, nz = 0;
    search: for (let a = 1; a < f.length; a++) for (let b = a + 1; b < f.length; b++) {
      const p0 = V[f[0]], p1 = V[f[a]], p2 = V[f[b]];
      const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
      nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
      if (nx * nx + ny * ny + nz * nz > 1e-14) break search;
    }
    let l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (nx * (fx - cx) + ny * (fy - cy) + nz * (fz - cz) < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const p0 = V[f[0]]; let ux = p0[0] - fx, uy = p0[1] - fy, uz = p0[2] - fz; l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
    const wx = ny * uz - nz * uy, wy = nz * ux - nx * uz, wz = nx * uy - ny * ux;
    const ang = i => { const v = V[i], dx = v[0] - fx, dy = v[1] - fy, dz = v[2] - fz; return Math.atan2(dx * wx + dy * wy + dz * wz, dx * ux + dy * uy + dz * uz); };
    const ord = f.slice().sort((i, j) => ang(i) - ang(j));
    for (let k = 1; k < ord.length - 1; k++) for (const i of [ord[0], ord[k], ord[k + 1]]) { pos.push(V[i][0], V[i][1], V[i][2]); nor.push(nx, ny, nz); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
function chamferVF(sx, sy, sz, b) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2, V = [], F = [];
  const id = (i, j, k, t) => ((i * 2 + j) * 2 + k) * 3 + t;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
    const s0 = i ? 1 : -1, s1 = j ? 1 : -1, s2 = k ? 1 : -1;
    V.push([s0 * hx, s1 * (hy - b), s2 * (hz - b)], [s0 * (hx - b), s1 * hy, s2 * (hz - b)], [s0 * (hx - b), s1 * (hy - b), s2 * hz]);
  }
  for (let i = 0; i < 2; i++) F.push([id(i, 0, 0, 0), id(i, 0, 1, 0), id(i, 1, 0, 0), id(i, 1, 1, 0)]);
  for (let j = 0; j < 2; j++) F.push([id(0, j, 0, 1), id(0, j, 1, 1), id(1, j, 0, 1), id(1, j, 1, 1)]);
  for (let k = 0; k < 2; k++) F.push([id(0, 0, k, 2), id(0, 1, k, 2), id(1, 0, k, 2), id(1, 1, k, 2)]);
  for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) F.push([id(0, j, k, 1), id(0, j, k, 2), id(1, j, k, 1), id(1, j, k, 2)]);
  for (let i = 0; i < 2; i++) for (let k = 0; k < 2; k++) F.push([id(i, 0, k, 0), id(i, 0, k, 2), id(i, 1, k, 0), id(i, 1, k, 2)]);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) F.push([id(i, j, 0, 0), id(i, j, 0, 1), id(i, j, 1, 0), id(i, j, 1, 1)]);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) F.push([id(i, j, k, 0), id(i, j, k, 1), id(i, j, k, 2)]);
  return { V, F };
}
/* prism between two quads: root at y0 (x half-width t0, z range z0a..z0b) and tip at y1 */
function plateVF(y0, z0a, z0b, t0, y1, z1a, z1b, t1) {
  const V = [[-t0, y0, z0a], [t0, y0, z0a], [t0, y0, z0b], [-t0, y0, z0b], [-t1, y1, z1a], [t1, y1, z1a], [t1, y1, z1b], [-t1, y1, z1b]];
  const F = [[0, 1, 2, 3], [4, 5, 6, 7], [1, 2, 6, 5], [0, 3, 7, 4], [2, 3, 7, 6], [0, 1, 5, 4]];
  return { V, F };
}

/* ---------- geometry builder with vertex colors ---------- */
const _gm4 = new THREE.Matrix4(), _gq = new Quat(), _ge = new THREE.Euler(), _gv = new V3(), _gs = new V3(), _gc = new THREE.Color(), _gn3 = new THREE.Matrix3();
class GB {
  constructor() { this.P = []; this.N = []; this.C = []; }
  add(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, order = 'XYZ') {
    const g = geo.index ? geo.toNonIndexed() : geo;
    _gm4.compose(_gv.set(x, y, z), _gq.setFromEuler(_ge.set(rx, ry, rz, order)), _gs.set(sx, sy, sz));
    _gn3.getNormalMatrix(_gm4);
    const p = g.attributes.position, n = g.attributes.normal; _gc.set(color);
    for (let i = 0; i < p.count; i++) {
      _gv.fromBufferAttribute(p, i).applyMatrix4(_gm4); this.P.push(_gv.x, _gv.y, _gv.z);
      _gv.fromBufferAttribute(n, i).applyMatrix3(_gn3).normalize(); this.N.push(_gv.x, _gv.y, _gv.z);
      this.C.push(_gc.r, _gc.g, _gc.b);
    }
    if (g !== geo) g.dispose(); geo.dispose();
  }
  box(w, h, d, x, y, z, c, rx = 0, ry = 0, rz = 0) { this.add(new THREE.BoxGeometry(w, h, d), c, x, y, z, rx, ry, rz); }
  cyl(rt, rb, h, seg, x, y, z, c, rx = 0, ry = 0, rz = 0, open = false) { this.add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), c, x, y, z, rx, ry, rz); }
  cone(r, h, seg, x, y, z, c, rx = 0, ry = 0, rz = 0) { this.add(new THREE.ConeGeometry(r, h, seg), c, x, y, z, rx, ry, rz); }
  sph(r, x, y, z, c, sx = 1, sy = 1, sz = 1, ws = 16, hs = 10) { this.add(new THREE.SphereGeometry(r, ws, hs), c, x, y, z, 0, 0, 0, sx, sy, sz); }
  torus(r, t, x, y, z, c, rx = 0, ry = 0, rz = 0) { this.add(new THREE.TorusGeometry(r, t, 8, 24), c, x, y, z, rx, ry, rz); }
  poly(vf, c, x = 0, y = 0, z = 0) { this.add(polyGeo(vf.V, vf.F), c, x, y, z); }
  chamfer(sx, sy, sz, b, c, x = 0, y = 0, z = 0) { this.poly(chamferVF(sx, sy, sz, b), c, x, y, z); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/* ---------- integer orientation ---------- */
function mmul(A, B) { const C = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return C.map(v => v + 0); }
function mapply(M, v) { return [M[0] * v[0] + M[1] * v[1] + M[2] * v[2] + 0, M[3] * v[0] + M[4] * v[1] + M[5] * v[2] + 0, M[6] * v[0] + M[7] * v[1] + M[8] * v[2] + 0]; }
const RY = [[1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 1, 0, 1, 0, -1, 0, 0], [-1, 0, 0, 0, 1, 0, 0, 0, -1], [0, 0, -1, 0, 1, 0, 1, 0, 0]];
const RX = [[1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 0, 0, 0, 0, -1, 0, 1, 0], [1, 0, 0, 0, -1, 0, 0, 0, -1], [1, 0, 0, 0, 0, 1, 0, -1, 0]];
function mountBase(n) {
  const Y = n, Z = Math.abs(n[2]) > 0.5 ? [0, 1, 0] : [0, 0, 1];
  const X = [Y[1] * Z[2] - Y[2] * Z[1], Y[2] * Z[0] - Y[0] * Z[2], Y[0] * Z[1] - Y[1] * Z[0]];
  return [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]].map(v => v + 0);
}
function orient(n, k = 0, t = 0) { return mmul(mmul(mountBase(n), RY[((k % 4) + 4) % 4]), RX[((t % 4) + 4) % 4]); }
function mEq(a, b) { for (let i = 0; i < 9; i++) if (a[i] !== b[i]) return false; return true; }
function mirrorM(M, def) { const S = M.slice(); S[0] = -S[0]; S[1] = -S[1]; S[2] = -S[2]; return mmul(S, def.mirrorP); }
const ckey = (x, y, z) => ((x + 32768) * 65536 + (y + 32768)) * 65536 + (z + 32768);
function footprint(def, a, m) { return def.cells.map(f => { const r = mapply(m, f); return [a[0] + r[0], a[1] + r[1], a[2] + r[2]]; }); }
function m4From(m, a) { return new THREE.Matrix4().set(m[0], m[1], m[2], a[0] * CELL, m[3], m[4], m[5], a[1] * CELL, m[6], m[7], m[8], a[2] * CELL, 0, 0, 0, 1); }
function cellsBox(x0, x1, y0, y1, z0, z1) { const a = []; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) a.push([x, y, z]); return a; }

/* ---------- part definitions ---------- */
const PARTS = [], PD = {};
const CATS = ['Blocks', 'Shapes', 'Land', 'Air', 'Sea', 'Space', 'Moving', 'Gadgets', 'Weapons', 'Decor', 'Control', 'Logic'];
function defPart(d) {
  d.cells = d.cells || [[0, 0, 0]]; d.attach = d.attach || 'all'; d.buoy = d.buoy ?? 0.25; d.hp = d.hp || 40; d.dyn = d.dyn || [];
  d.mirrorP = d.mirrorP || [-1, 0, 0, 0, 1, 0, 0, 0, 1]; d.dc = d.dc ?? 0; d.kind = d.kind || 'block';
  PARTS.push(d); PD[d.id] = d;
}
const WEDGE = { V: [[-.25, -.25, -.25], [.25, -.25, -.25], [.25, -.25, .25], [-.25, -.25, .25], [-.25, .25, -.25], [.25, .25, -.25]], F: [[0, 1, 2, 3], [0, 1, 5, 4], [3, 2, 5, 4], [0, 3, 4], [1, 2, 5]] };
const CORNER = { V: [[-.25, -.25, -.25], [.25, -.25, -.25], [.25, -.25, .25], [-.25, -.25, .25], [-.25, .25, -.25]], F: [[0, 1, 2, 3], [0, 1, 4], [0, 3, 4], [1, 2, 4], [2, 3, 4]] };
const BOW = { V: [[-.25, -.25, -.25], [.25, -.25, -.25], [.25, -.25, .25], [-.25, -.25, .25], [0, .25, -.06], [0, .25, .25]], F: [[0, 1, 2, 3], [0, 3, 5, 4], [1, 2, 5, 4], [0, 1, 4], [3, 2, 5]] };

// Blocks
defPart({ id: 'block', name: 'Block', cat: 'Blocks', mass: 25, hp: 45, buoy: 0.17, desc: 'Standard structural cube.', build(g, P) { g.chamfer(.5, .5, .5, .035, P); } });
defPart({ id: 'light_block', name: 'Light Frame', cat: 'Blocks', mass: 9, hp: 22, buoy: 0.7, dc: 5, desc: 'Hollow frame. Light and floaty, but fragile.',
  build(g, P) { g.box(.44, .44, .44, 0, 0, 0, shade(P, 0.62)); const t = .075, o = .2125; for (const a of [-1, 1]) for (const b of [-1, 1]) { g.box(.5, t, t, 0, a * o, b * o, P); g.box(t, .5, t, a * o, 0, b * o, P); g.box(t, t, .5, a * o, b * o, 0, P); } } });
defPart({ id: 'heavy_block', name: 'Heavy Block', cat: 'Blocks', mass: 70, hp: 130, buoy: 0.12, dc: 4, desc: 'Dense steel. Tough, and it sinks.',
  build(g, P) { g.chamfer(.5, .5, .5, .05, shade(P, 0.8)); g.box(.3, .506, .3, 0, 0, 0, P); g.box(.506, .3, .3, 0, 0, 0, P); g.box(.3, .3, .506, 0, 0, 0, P); } });
defPart({ id: 'armor_block', name: 'Armor Block', cat: 'Blocks', mass: 150, hp: 420, buoy: 0.06, dc: 4, desc: 'Plated armor. Shrugs off hard crashes.', build(g, P) { g.chamfer(.5, .5, .5, .1, mixc(P, 0x30363c, 0.35)); } });
defPart({ id: 'wedge', name: 'Wedge', cat: 'Shapes', mass: 15, hp: 35, buoy: 0.12, desc: 'Sloped block for noses and hoods. T tilts it.', build(g, P) { g.poly(WEDGE, P); } });
defPart({ id: 'corner', name: 'Corner Slope', cat: 'Shapes', mass: 9, hp: 30, buoy: 0.08, mirrorP: [0, 0, 1, 0, 1, 0, 1, 0, 0], desc: 'Pyramid corner for rounding off edges.', build(g, P) { g.poly(CORNER, P); } });
defPart({ id: 'beam', name: 'Beam', cat: 'Blocks', mass: 28, hp: 70, buoy: 0.07, cells: cellsBox(0, 0, 0, 2, 0, 0), desc: 'Three-cell strut. Frames and landing gear in one click.', build(g, P) { g.chamfer(.38, 1.5, .38, .03, P, 0, .5, 0); } });
defPart({ id: 'round', name: 'Round Block', cat: 'Shapes', mass: 20, hp: 40, buoy: 0.15, desc: 'Cylindrical block.', build(g, P) { g.cyl(.25, .25, .5, 20, 0, 0, 0, P); g.cyl(.18, .18, .506, 16, 0, 0, 0, shade(P, .75)); } });
defPart({ id: 'plate', name: 'Plate', cat: 'Blocks', mass: 7, hp: 22, buoy: 0.05, desc: 'Thin panel. Light cladding.', build(g, P) { g.chamfer(.5, .12, .5, .02, P, 0, -.19, 0); } });

// Land
function wheelGeo(g, r, w, hub) {
  g.cyl(r, r, w, 28, 0, 0, 0, COL.tire);
  for (let i = 0; i < 14; i++) { const a = i / 14 * TAU; g.box(w * .9, r * .09, r * .22, Math.cos(a) * r, 0, Math.sin(a) * r, COL.side, 0, -a, Math.PI / 2); }
  g.cyl(r * .78, r * .78, w + .012, 24, 0, 0, 0, COL.side);
  g.cyl(r * .58, r * .58, w + .026, 20, 0, 0, 0, COL.rim);
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; g.box(r * .5, .02, r * .1, Math.cos(a) * r * .3, s * (w / 2 + .016), Math.sin(a) * r * .3, shade(COL.rim, .7), 0, -a, 0); }
  g.cyl(r * .2, r * .2, w + .06, 12, 0, 0, 0, hub);
}
/* a wheel presses toward its local -Z (the little arrow on the hub). R in the builder turns it about the axle,
   so wheels can push down on the road, or sideways and up to grip walls and trusses */
const WHEEL_DN = [0, 0, -1];
function wheelSpringK(n, dir) {
  for (let k = 0; k < 4; k++) { const v = mapply(orient(n, k), WHEEL_DN); if (v[0] === dir[0] && v[1] === dir[1] && v[2] === dir[2]) return k; }
  return -1;
}
function wheelDownK(n) { const k = wheelSpringK(n, [0, -1, 0]); return k < 0 ? 0 : k; }
/* designs from before wheels could turn: every wheel pressed straight down, whatever its rotation */
function fixWheelM(m) {
  const ax = [m[1], m[4], m[7]];
  if (Math.abs(ax[1]) > 0.5) return m.slice();
  return orient(ax, wheelDownK(ax));
}
const DIR_NAMES = [[[0, -1, 0], 'down'], [[0, 1, 0], 'up'], [[0, 0, 1], 'forward'], [[0, 0, -1], 'back'], [[1, 0, 0], 'left'], [[-1, 0, 0], 'right']];
function dirName(v) { for (const [d, nm] of DIR_NAMES) if (d[0] === v[0] && d[1] === v[1] && d[2] === v[2]) return nm; return 'sideways'; }
function wheelDef(id, name, r, w, cells, hubY, mass, power, vmax, L, steer, hp, opt = {}) {
  defPart({ id, name, cat: 'Land', mass, hp, buoy: 0.05, attach: 'base', kind: 'wheel', cells,
    wheel: { r, w, hubY, power, vmax, L, steer, grip: opt.grip || 1.05, stiff: opt.stiff || 1 },
    desc: opt.desc || (steer ? 'Steering wheel' : 'Drive wheel') + ` with a ${Math.round(power / 1000)} kW motor. Mount on a side face. R turns which way it presses: down for roads, sideways to grip a truss.`,
    build(g, P) {
      g.cyl(.07, .07, hubY + .25, 10, 0, (-.25 + hubY) / 2, 0, COL.dark);
      // press-direction arrow just outside the hub cap
      const y = hubY + w / 2 + .05, a = Math.max(.16, r * .42);
      g.box(.05, .025, a * .62, 0, y, -a * .31, COL.haz);
      g.cone(.075, .13, 3, 0, y, -a * .62 - .05, COL.haz, -Math.PI / 2, 0, 0);
    },
    dyn: [{ type: 'wheel', pivot: [0, hubY, 0], build(g, P) { wheelGeo(g, r, w, opt.hub || (steer ? COL.amber : COL.dark)); } }] });
}
wheelDef('wheel_s', 'Small Wheel', .3, .24, [[0, 0, 0]], 0, 14, 7000, 30, .2, 0, 40);
wheelDef('wheel_s_steer', 'Small Steering Wheel', .3, .24, [[0, 0, 0]], 0, 14, 7000, 30, .2, .6, 40);
wheelDef('wheel_m', 'Wheel', .55, .36, cellsBox(-1, 1, 0, 0, -1, 1), 0, 30, 15000, 40, .3, 0, 80);
wheelDef('wheel_m_steer', 'Steering Wheel', .55, .36, cellsBox(-1, 1, 0, 0, -1, 1), 0, 30, 15000, 40, .3, .55, 80);
wheelDef('wheel_l', 'Big Wheel', .75, .6, cellsBox(-1, 1, 0, 1, -1, 1), .25, 55, 26000, 42, .42, 0, 120);
wheelDef('wheel_l_steer', 'Big Steering Wheel', .75, .6, cellsBox(-1, 1, 0, 1, -1, 1), .25, 55, 26000, 42, .42, .5, 120);
wheelDef('wheel_x', 'Monster Wheel', 1.15, .86, cellsBox(-2, 2, 0, 1, -2, 2), .25, 120, 45000, 34, .65, 0, 220);
wheelDef('wheel_x_steer', 'Monster Steering Wheel', 1.15, .86, cellsBox(-2, 2, 0, 1, -2, 2), .25, 120, 45000, 34, .65, .45, 220);
// racing wheels: low and stiff, grippy tyres, a high top speed
wheelDef('wheel_race', 'Racing Wheel', .42, .34, cellsBox(-1, 1, 0, 0, -1, 1), 0, 24, 22000, 75, .2, 0, 70, { grip: 1.4, stiff: 3.5, hub: COL.red, desc: 'Grippy, stiffly sprung race tyre with a 22 kW motor and a 270 km/h top speed. Corners hard and takes a loop.' });
wheelDef('wheel_race_steer', 'Racing Steering Wheel', .42, .34, cellsBox(-1, 1, 0, 0, -1, 1), 0, 24, 22000, 75, .2, .45, 70, { grip: 1.4, stiff: 3.5, hub: COL.haz, desc: 'Steering race tyre: grippy, stiffly sprung, 270 km/h.' });
defPart({ id: 'anchor', name: 'Ground Anchor', cat: 'Land', mass: 300, hp: 900, buoy: 0.05, attach: 'base', kind: 'anchor', cells: cellsBox(-1, 1, 0, 0, -1, 1), dc: 4,
  desc: 'Locks to the ground when its spikes touch, so towers stand on their own. Mount it under the base. {undock} lets go.',
  build(g, P) {
    g.chamfer(1.5, .3, 1.5, .05, P, 0, -.1, 0);
    for (const s of [-1, 1]) { g.box(1.506, .08, .2, 0, -.1, s * .55, COL.haz); g.box(.2, .08, 1.506, s * .55, -.1, 0, COL.haz); }
    for (const [x, z] of [[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5], [0, 0]]) g.cone(.1, .5, 8, x, .3, z, COL.metal);
  } });
defPart({ id: 'engine', name: 'Engine', cat: 'Land', mass: 65, hp: 70, buoy: 0.2, kind: 'engine', power: 40000, dc: 2, desc: 'Adds 40 kW shared across all drive wheels.',
  build(g, P) { g.chamfer(.5, .38, .5, .04, COL.dark, 0, -.06, 0); g.box(.36, .1, .42, 0, .18, 0, P); for (const x of [-.1, .1]) g.cyl(.05, .05, .14, 10, x, .28, .1, COL.metal); g.box(.4, .04, .06, 0, .245, -.17, COL.black); } });

// Air
function propGeo(g, R, n, P, hub) {
  g.cone(hub, hub * 2.2, 14, 0, hub * 1.1, 0, P);
  for (let i = 0; i < n; i++) { const a = i / n * TAU; g.add(new THREE.BoxGeometry(R, .028, R * .13), COL.dark, Math.cos(a) * R / 2, 0, -Math.sin(a) * R / 2, .38, a, 0, 1, 1, 1, 'YXZ'); }
}
defPart({ id: 'prop', name: 'Propeller', cat: 'Air', mass: 24, hp: 30, buoy: 0.3, attach: 'base', kind: 'prop', cells: cellsBox(-1, 1, 0, 0, -1, 1), thrust: 2600, dc: 1,
  desc: '2.6 kN. Pulls toward its blades. Needs air.',
  build(g, P) { g.cyl(.16, .2, .3, 14, 0, -.1, 0, COL.dark); },
  dyn: [{ type: 'spin', pivot: [0, .1, 0], build(g, P) { propGeo(g, .68, 2, P, .1); } }] });
defPart({ id: 'prop_big', name: 'Big Propeller', cat: 'Air', mass: 60, hp: 55, buoy: 0.3, attach: 'base', kind: 'prop', cells: cellsBox(-2, 2, 0, 0, -2, 2), thrust: 7000, dc: 1,
  desc: '7 kN. Big pull at low speed. Works as a helicopter rotor too.',
  build(g, P) { g.cyl(.22, .26, .32, 16, 0, -.09, 0, COL.dark); },
  dyn: [{ type: 'spin', pivot: [0, .12, 0], build(g, P) { propGeo(g, 1.18, 3, P, .16); } }] });
defPart({ id: 'jet', name: 'Jet Engine', cat: 'Air', mass: 110, hp: 70, buoy: 0.3, attach: 'base', kind: 'jet', cells: cellsBox(0, 0, 0, 1, 0, 0), thrust: 7500, nozzle: [0, .88, 0], dc: 0,
  desc: '7.5 kN. Pushes away from its exhaust. Needs air.',
  build(g, P) { g.cyl(.25, .25, .16, 18, 0, -.17, 0, COL.dark); g.cyl(.23, .23, .66, 18, 0, .26, 0, P); g.cyl(.236, .236, .07, 18, 0, .1, 0, COL.dark); g.cyl(.16, .215, .2, 16, 0, .69, 0, COL.dark); g.cyl(.12, .12, .1, 12, 0, .79, 0, COL.black); },
  dyn: [{ type: 'flame', pivot: [0, .8, 0], len: 1.5, rad: .15, col: 0x8fd0ff }] });
function wingDef(id, name, span, z0, z1, rootA, rootB, tipA, tipB, th, mass, hp, area, desc) {
  defPart({ id, name, cat: 'Air', mass, hp, buoy: 0.35, kind: 'wing', area, cells: cellsBox(0, 0, 0, span - 1, z0, z1), dc: 5, desc,
    build(g, P) { const tipY = span * .5 - .25; g.poly(plateVF(-.25, rootA, rootB, th / 2, tipY, tipA, tipB, th * .3), P); g.poly(plateVF(-.25, rootB - .06, rootB + .002, th / 2 + .004, tipY, tipB - .05, tipB + .002, th * .3 + .004), shade(P, .78)); } });
}
wingDef('wing_s', 'Small Wing', 2, 0, 0, -.25, .25, -.13, .2, .07, 8, 25, .5, 'Lift surface, 0.5 m². Good for tails and canards.');
wingDef('wing', 'Wing', 4, -1, 0, -.75, .25, -.38, .2, .09, 24, 50, 2.0, 'Lift surface, 2 m². Mount on a side face.');
wingDef('wing_l', 'Big Wing', 6, -1, 1, -.75, .75, -.32, .45, .11, 46, 80, 4.5, 'Lift surface, 4.5 m². Two of these carry a small plane.');
defPart({ id: 'fin', name: 'Tail Fin', cat: 'Air', mass: 9, hp: 25, buoy: 0.35, kind: 'wing', area: .8, cells: cellsBox(0, 0, 0, 1, -1, 0), dc: 2,
  desc: 'Swept stabilizer. Keeps planes and rockets pointing forward.',
  build(g, P) { g.poly(plateVF(-.25, -.75, .25, .03, .75, -.75, -.32, .012), P); } });
defPart({ id: 'flap', name: 'Control Flap', cat: 'Air', mass: 10, hp: 25, buoy: 0.3, attach: 'base', kind: 'flap', area: .75, cells: cellsBox(-1, 1, 0, 0, 0, 0), dc: 1,
  desc: 'Moves with pitch, roll and yaw. Place behind wings and fins. R turns it.',
  build(g, P) { g.cyl(.035, .035, 1.46, 8, 0, -.22, 0, COL.dark, 0, 0, Math.PI / 2); },
  dyn: [{ type: 'flap', pivot: [0, -.22, 0], build(g, P) { g.poly({ V: [[-.73, 0, -.03], [.73, 0, -.03], [.73, 0, .03], [-.73, 0, .03], [-.7, .46, -.008], [.7, .46, -.008], [.7, .46, .008], [-.7, .46, .008]], F: [[0, 1, 2, 3], [4, 5, 6, 7], [1, 2, 6, 5], [0, 3, 7, 4], [2, 3, 7, 6], [0, 1, 5, 4]] }, P); } }] });
defPart({ id: 'nose', name: 'Nose Cone', cat: 'Air', mass: 6, hp: 25, buoy: 0.3, attach: 'base', dc: 2, desc: 'Streamlined cap for planes and rockets.', build(g, P) { g.cone(.25, .5, 22, 0, 0, 0, P); } });

// Sea
defPart({ id: 'float', name: 'Float', cat: 'Sea', mass: 7, hp: 25, buoy: 4, kind: 'float', desc: 'Pontoon. Floats four times its own volume.',
  build(g, P) { g.cyl(.22, .22, .3, 16, 0, 0, 0, COL.orange, Math.PI / 2); g.sph(.22, 0, 0, .15, COL.orange, 1, 1, .45); g.sph(.22, 0, 0, -.15, COL.orange, 1, 1, .45); g.cyl(.226, .226, .08, 16, 0, 0, 0, COL.white, Math.PI / 2); } });
defPart({ id: 'float_big', name: 'Big Float', cat: 'Sea', mass: 20, hp: 50, buoy: 3.6, kind: 'float', cells: cellsBox(0, 0, 0, 0, -1, 1), desc: 'Long pontoon. Outriggers for boats and seaplanes.',
  build(g, P) { g.cyl(.24, .24, 1.1, 18, 0, 0, 0, COL.orange, Math.PI / 2); g.sph(.24, 0, 0, .55, COL.orange, 1, 1, .7); g.sph(.24, 0, 0, -.55, COL.orange, 1, 1, .7); for (const z of [-.3, .3]) g.cyl(.246, .246, .09, 18, 0, 0, z, COL.white, Math.PI / 2); } });
defPart({ id: 'hull', name: 'Hull Block', cat: 'Sea', mass: 16, hp: 50, buoy: 1.5, dc: 3, desc: 'Buoyant hull section. Floats with weight on top.',
  build(g, P) { g.chamfer(.5, .5, .5, .04, P); g.box(.506, .1, .506, 0, -.15, 0, COL.red); } });
defPart({ id: 'hull_bow', name: 'Hull Bow', cat: 'Sea', mass: 11, hp: 40, buoy: 1.2, dc: 3, desc: 'Pointed bow. Mount on the front face of a hull.', build(g, P) { g.poly(BOW, P); } });
defPart({ id: 'boat_prop', name: 'Boat Propeller', cat: 'Sea', mass: 35, hp: 40, buoy: 0.3, attach: 'base', kind: 'boatprop', thrust: 3800, dc: 4,
  desc: '3.8 kN. Pushes forward when underwater. Mount on a back face.',
  build(g, P) { g.cyl(.1, .12, .3, 12, 0, -.1, 0, COL.dark); g.torus(.21, .03, 0, .12, 0, COL.metal, Math.PI / 2); },
  dyn: [{ type: 'spin', pivot: [0, .12, 0], build(g, P) { propGeo(g, .19, 3, COL.copper, .06); } }] });
defPart({ id: 'rudder', name: 'Rudder', cat: 'Sea', mass: 12, hp: 35, buoy: 0.3, attach: 'base', kind: 'rudder', area: .3, dc: 4,
  desc: 'Steers boats with A and D. Hang it under the stern.',
  build(g, P) { g.box(.16, .1, .16, 0, -.2, 0, COL.dark); },
  dyn: [{ type: 'rudder', pivot: [0, 0, 0], build(g, P) { g.box(.05, .42, .4, 0, .04, 0, P); } }] });
defPart({ id: 'ballast', name: 'Ballast', cat: 'Sea', mass: 160, hp: 160, buoy: 0.04, dc: 4, desc: 'Dead weight. Keeps boats upright and the center of mass low.',
  build(g, P) { g.chamfer(.5, .5, .5, .05, shade(P, .85)); g.box(.506, .1, .506, 0, 0, 0, COL.amber); } });

// Space
function rocketGeo(g, P, k) {
  g.cyl(.22 * k, .22 * k, .22, 16, 0, -.14, 0, COL.metal); g.cyl(.235 * k, .235 * k, .05, 16, 0, -.03, 0, P);
  g.cyl(.11 * k, .15 * k, .3, 14, 0, .15, 0, COL.dark);
  g.cyl(.24 * k, .1 * k, .42, 22, 0, .54, 0, COL.copper, 0, 0, 0, true); g.cyl(.22 * k, .085 * k, .4, 22, 0, .55, 0, COL.black, 0, 0, 0, true);
}
defPart({ id: 'rocket', name: 'Rocket Engine', cat: 'Space', mass: 70, hp: 70, buoy: 0.2, attach: 'ends', kind: 'rocket', cells: cellsBox(0, 0, 0, 1, 0, 0), thrust: 16000, nozzle: [0, .78, 0], dc: 2,
  desc: '16 kN. Burns tank fuel. Works in space. Z for full throttle, X to cut.',
  build(g, P) { rocketGeo(g, P, 1); }, dyn: [{ type: 'flame', pivot: [0, .74, 0], len: 2.2, rad: .21, col: 0xffa040 }] });
defPart({ id: 'rocket_big', name: 'Big Rocket Engine', cat: 'Space', mass: 320, hp: 180, buoy: 0.2, attach: 'ends', kind: 'rocket', cells: cellsBox(-1, 1, 0, 1, -1, 1), thrust: 70000, nozzle: [0, .8, 0], dc: 2,
  desc: '70 kN. Lifts heavy stacks. Needs big tanks.',
  build(g, P) { g.cyl(.62, .62, .26, 24, 0, -.12, 0, COL.metal); g.cyl(.64, .64, .06, 24, 0, .02, 0, P); g.cyl(.3, .42, .3, 18, 0, .2, 0, COL.dark); g.cyl(.72, .3, .5, 28, 0, .55, 0, COL.copper, 0, 0, 0, true); g.cyl(.68, .27, .48, 28, 0, .56, 0, COL.black, 0, 0, 0, true); },
  dyn: [{ type: 'flame', pivot: [0, .78, 0], len: 4.2, rad: .62, col: 0xffa040 }] });
defPart({ id: 'tank', name: 'Fuel Tank', cat: 'Space', mass: 14, hp: 35, buoy: 0.6, kind: 'tank', fuel: 60, dc: 2,
  desc: 'Holds 60 kg of rocket fuel. Explodes if destroyed.',
  build(g, P) { g.cyl(.235, .235, .42, 18, 0, 0, 0, COL.white); g.cyl(.24, .24, .1, 18, 0, 0, 0, P); g.cyl(.2, .235, .04, 18, 0, .23, 0, COL.metal); g.cyl(.235, .2, .04, 18, 0, -.23, 0, COL.metal); } });
defPart({ id: 'tank_big', name: 'Big Fuel Tank', cat: 'Space', mass: 120, hp: 130, buoy: 0.6, kind: 'tank', fuel: 1000, cells: cellsBox(-1, 1, 0, 2, -1, 1), dc: 2,
  desc: 'Holds 1000 kg of fuel. A very large bang if destroyed.',
  build(g, P) { g.cyl(.72, .72, 1.36, 28, 0, .5, 0, COL.white); for (const y of [.05, .95]) g.cyl(.728, .728, .16, 28, 0, y, 0, P); g.cyl(.66, .72, .06, 28, 0, 1.21, 0, COL.metal); g.cyl(.72, .66, .06, 28, 0, -.21, 0, COL.metal); } });
defPart({ id: 'decoupler', name: 'Decoupler', cat: 'Space', mass: 18, hp: 40, buoy: 0.3, kind: 'decoupler', dc: 4,
  desc: '{stage} splits the vehicle here, outermost stage first. Use it between rocket stages, or give it a key of its own.',
  build(g, P) { g.box(.5, .16, .5, 0, 0, 0, COL.haz); for (const x of [-.17, -.03, .11]) { g.box(.06, .166, .506, x, 0, 0, COL.black); g.box(.506, .166, .06, 0, 0, x, COL.black); } g.box(.46, .17, .46, 0, .165, 0, COL.metal); g.box(.46, .17, .46, 0, -.165, 0, COL.metal); } });
defPart({ id: 'gyro', name: 'Gyroscope', cat: 'Space', mass: 45, hp: 55, buoy: 0.2, kind: 'gyro', torque: 5000, dc: 4,
  desc: 'Turns the vehicle with the pitch, roll and yaw keys and holds it steady. SAS ({sas}) uses it to point the craft.',
  build(g, P) { g.chamfer(.5, .44, .5, .05, P, 0, -.03, 0); g.cyl(.2, .2, .05, 24, 0, .22, 0, COL.amber); g.torus(.15, .025, 0, .25, 0, COL.metal, Math.PI / 2); } });
defPart({ id: 'rcs', name: 'RCS Block', cat: 'Space', mass: 12, hp: 25, buoy: 0.3, kind: 'rcs', torque: 1800, dc: 5,
  desc: 'Thrusters for turning in space. {rcs} switches the steering keys to sliding the craft. Sips fuel.',
  build(g, P) { g.chamfer(.38, .38, .38, .03, P); for (const [x, z, ry] of [[.23, 0, -Math.PI / 2], [-.23, 0, Math.PI / 2], [0, .23, 0], [0, -.23, Math.PI]]) g.cone(.05, .1, 8, x, 0, z, COL.dark, Math.PI / 2, 0, ry); } });
defPart({ id: 'dock', name: 'Docking Port', cat: 'Space', mass: 30, hp: 90, buoy: 0.3, attach: 'base', kind: 'dock', dc: 4,
  desc: 'Latches onto another port or a skyhook grapple when it touches. Face it up toward the hook. {undock} lets go.',
  build(g, P) { g.cyl(.24, .24, .08, 20, 0, -.21, 0, COL.dark); g.cyl(.17, .21, .24, 20, 0, -.06, 0, P); g.torus(.19, .04, 0, .08, 0, COL.haz, Math.PI / 2); for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; g.box(.07, .14, .1, Math.cos(a) * .15, .17, Math.sin(a) * .15, COL.metal); } } });
defPart({ id: 'leg', name: 'Landing Leg', cat: 'Space', mass: 25, hp: 60, buoy: 0.3, attach: 'base', kind: 'leg', leg: { r: .2, L: .8, drop: 1.7 }, dc: 4,
  desc: 'Sprung leg that reaches below the vehicle. For landers.',
  build(g, P) { g.box(.3, .16, .3, 0, -.17, 0, COL.metal); } });

// Control
defPart({ id: 'seat', name: 'Seat', cat: 'Control', mass: 60, hp: 170, buoy: 0.4, kind: 'seat', dc: 1, desc: 'The pilot. Every vehicle has exactly one.',
  build(g, P) { g.chamfer(.48, .12, .46, .02, COL.dark, 0, -.19, 0); g.box(.44, .4, .08, 0, .02, -.19, P); g.box(.05, .1, .3, .21, -.09, 0, COL.dark); g.box(.05, .1, .3, -.21, -.09, 0, COL.dark); g.box(.22, .2, .14, 0, -.03, -.07, COL.navy); g.sph(.085, 0, .15, -.06, COL.bone); g.box(.13, .045, .03, 0, .16, .02, COL.black); } });
defPart({ id: 'canopy', name: 'Canopy', cat: 'Control', mass: 12, hp: 25, buoy: 0.5, attach: 'base', kind: 'canopy', dc: 4, desc: 'Glass bubble. Purely for looks.',
  build(g, P) { g.torus(.21, .025, 0, -.22, 0, P, Math.PI / 2); },
  dyn: [{ type: 'glass', pivot: [0, -.24, 0], build(g, P) { g.add(new THREE.SphereGeometry(.23, 20, 10, 0, TAU, 0, Math.PI / 2), 0x9fd3f0, 0, 0, 0, 0, 0, 0, 1, 1.35, 1); } }] });
defPart({ id: 'light', name: 'Headlight', cat: 'Control', mass: 4, hp: 15, buoy: 0.4, attach: 'base', kind: 'light', dc: 4, desc: 'Glowing lamp. Mount on any face.',
  build(g, P) { g.box(.34, .14, .34, 0, -.18, 0, P); },
  dyn: [{ type: 'lens', pivot: [0, -.1, 0], build(g, P) { g.cyl(.13, .13, .03, 18, 0, 0, 0, 0xfff1c4); } }] });
defPart({ id: 'explosive', name: 'Explosive', cat: 'Control', mass: 20, hp: 18, buoy: 0.4, kind: 'explosive', power: 480, radius: 9, dc: 2,
  desc: 'Blows up on a hard hit. Wrecks anything nearby.',
  build(g, P) { g.cyl(.21, .21, .44, 18, 0, 0, 0, COL.red); for (const y of [-.13, .13]) g.cyl(.215, .215, .05, 18, 0, y, 0, COL.haz); g.cyl(.16, .16, .02, 14, 0, .225, 0, COL.black); } });

/* ---------- geometry caches & materials ---------- */
/* ================= more blocks ================= */
// Shapes
defPart({ id: 'big_block', name: 'Big Block', cat: 'Blocks', mass: 200, hp: 360, buoy: 0.17, cells: cellsBox(0, 1, 0, 1, 0, 1), dc: 0, desc: 'One-metre cube. Builds big things fast.',
  build(g, P) { g.chamfer(1, 1, 1, .06, P, .25, .25, .25); } });
defPart({ id: 'long_block', name: 'Long Block', cat: 'Blocks', mass: 100, hp: 180, buoy: 0.17, cells: cellsBox(0, 0, 0, 3, 0, 0), desc: 'Two-metre block. Chassis rails and posts.',
  build(g, P) { g.chamfer(.5, 2, .5, .035, P, 0, .75, 0); } });
defPart({ id: 'slab', name: 'Half Block', cat: 'Blocks', mass: 13, hp: 25, buoy: 0.17, desc: 'Half-height block for floors and steps.',
  build(g, P) { g.chamfer(.5, .25, .5, .025, P, 0, -.125, 0); } });
const SLOPE2 = { V: [[-.25, -.25, -.25], [.25, -.25, -.25], [.25, -.25, .75], [-.25, -.25, .75], [-.25, .25, .75], [.25, .25, .75]], F: [[0, 1, 2, 3], [0, 1, 5, 4], [3, 2, 5, 4], [0, 3, 4], [1, 2, 5]] };
defPart({ id: 'slope_long', name: 'Long Slope', cat: 'Shapes', mass: 26, hp: 55, buoy: 0.12, cells: [[0, 0, 0], [0, 0, 1]], desc: 'Gentle two-cell ramp. T tilts it.', build(g, P) { g.poly(SLOPE2, P); } });
function quarterVF(n) {
  const V = [], F = [[], []], N = n + 1;
  for (const y of [-.25, .25]) { V.push([-.25, y, -.25]); for (let i = 0; i <= n; i++) { const t = i / n * Math.PI / 2; V.push([-.25 + Math.cos(t) * .5, y, -.25 + Math.sin(t) * .5]); } }
  for (let i = 0; i <= N; i++) { F[0].push(i); F[1].push(i + N + 1); }
  for (let i = 1; i < N; i++) F.push([i, i + 1, i + N + 2, i + N + 1]);
  F.push([0, 1, N + 2, N + 1], [0, N, N + N + 1, N + 1]);
  return { V, F };
}
defPart({ id: 'quarter', name: 'Rounded Corner', cat: 'Shapes', mass: 18, hp: 38, buoy: 0.15, desc: 'Quarter-round block for smooth edges. R turns it.', build(g, P) { g.poly(quarterVF(8), P); } });
defPart({ id: 'pipe', name: 'Pipe', cat: 'Shapes', mass: 8, hp: 30, buoy: 0.5, desc: 'Hollow tube section. Light and stiff.',
  build(g, P) { g.cyl(.24, .24, .5, 18, 0, 0, 0, P, 0, 0, 0, true); g.cyl(.17, .17, .5, 18, 0, 0, 0, shade(P, .6), 0, 0, 0, true); for (const y of [-.25, .25]) g.add(new THREE.RingGeometry(.17, .24, 18), shade(P, .85), 0, y, 0, y > 0 ? -Math.PI / 2 : Math.PI / 2); } });
defPart({ id: 'dome', name: 'Dome', cat: 'Shapes', mass: 30, hp: 70, buoy: 0.3, attach: 'base', cells: cellsBox(-1, 1, 0, 0, -1, 1), dc: 0, desc: 'Rounded cap, 1.5 m across. Noses, roofs and cockpits.',
  build(g, P) { g.add(new THREE.SphereGeometry(.75, 24, 10, 0, TAU, 0, Math.PI / 2), P, 0, -.25, 0, 0, 0, 0, 1, .66, 1); g.add(new THREE.CircleGeometry(.75, 24), shade(P, .7), 0, -.25, 0, Math.PI / 2); } });
defPart({ id: 'cyl_big', name: 'Big Cylinder', cat: 'Shapes', mass: 160, hp: 260, buoy: 0.2, cells: cellsBox(-1, 1, 0, 1, -1, 1), desc: 'Thick round section, 1.5 m across. Fuselages and towers.',
  build(g, P) { g.cyl(.75, .75, 1, 28, 0, .25, 0, P); for (const y of [-.2, .7]) g.cyl(.76, .76, .06, 28, 0, y, 0, shade(P, .72)); } });
/* lattice trusses: long and light, wind blows through them */
function trussGeo(g, len, P, bay) {
  const t = .07, o = .19, y0 = -.25, n = Math.max(1, Math.round(len / bay));
  for (const a of [-1, 1]) for (const b of [-1, 1]) g.box(t, len, t, a * o, y0 + len / 2, b * o, P);
  const step = len / n, d = Math.hypot(step, o * 2);
  for (let i = 0; i < n; i++) {
    const yc = y0 + step * (i + .5), ang = Math.atan2(o * 2, step);
    g.box(t * .7, d, t * .7, 0, yc, -o, shade(P, .8), 0, 0, (i % 2 ? 1 : -1) * ang);
    g.box(t * .7, d, t * .7, 0, yc, o, shade(P, .8), 0, 0, (i % 2 ? -1 : 1) * ang);
    g.box(t * .7, d, t * .7, -o, yc, 0, shade(P, .8), (i % 2 ? 1 : -1) * ang, 0, 0);
    g.box(t * .7, d, t * .7, o, yc, 0, shade(P, .8), (i % 2 ? -1 : 1) * ang, 0, 0);
  }
  for (let i = 0; i <= n; i++) g.box(o * 2 + t, t, o * 2 + t, 0, y0 + step * i, 0, shade(P, .7));
}
defPart({ id: 'truss_5', name: 'Truss 5 m', cat: 'Blocks', mass: 120, hp: 120, buoy: 0.3, cells: cellsBox(0, 0, 0, 9, 0, 0), dc: 1, lattice: true,
  desc: 'Open lattice girder, 5 m long. Wind blows through it.', build(g, P) { trussGeo(g, 5, P, .5); } });
defPart({ id: 'truss_50', name: 'Truss 50 m', cat: 'Blocks', mass: 1200, hp: 400, buoy: 0.3, cells: cellsBox(0, 0, 0, 99, 0, 0), dc: 1, lattice: true,
  desc: '50 m lattice girder for towers, bridges and skyhooks. Copy it to go further.', build(g, P) { trussGeo(g, 50, P, 5); } });
// the first Sky Truss (120 m) stays loadable for builds that used it, but the palette shows the 215 m one
defPart({ id: 'truss_120', name: 'Sky Truss 120 m', cat: 'Hidden', mass: 2880, hp: 600, buoy: 0.3, cells: cellsBox(0, 0, 0, 239, 0, 0), dc: 1, lattice: true,
  desc: '120 m girder. Wheels pressed against a truss grip it hard.', build(g, P) { trussGeo(g, 120, P, 6); } });
defPart({ id: 'truss_215', name: 'Sky Truss 215 m', cat: 'Blocks', mass: 5160, hp: 700, buoy: 0.3, cells: cellsBox(0, 0, 0, 429, 0, 0), dc: 1, lattice: true,
  desc: '215 m girder. Fifty stacked reach 10.75 km: geostationary height, where the top keeps pace with an orbit. Wheels pressed against a truss grip it hard.', build(g, P) { trussGeo(g, 215, P, 12); } });

// Land
defPart({ id: 'gear', name: 'Landing Gear', cat: 'Land', mass: 30, hp: 90, buoy: 0.2, attach: 'base', kind: 'gear', dc: 4, gear: { r: .32, w: .2, drop: 1.05, L: .35 },
  desc: 'Free-rolling wheel on a strut. {gear} folds it away, {back} brakes it. Mount under a plane.',
  build(g, P) { g.box(.36, .14, .36, 0, -.18, 0, COL.dark); g.box(.4, .04, .4, 0, -.1, 0, P); },
  dyn: [{ type: 'gear', pivot: [0, 0, 0], build(g, P) { g.cyl(.045, .045, 1, 8, 0, .5, 0, COL.metal); wheelGeoX(g, .32, .2); } }] });
function wheelGeoX(g, r, w) {
  g.add(new THREE.CylinderGeometry(r, r, w, 22), COL.tire, 0, 1, 0, 0, 0, Math.PI / 2);
  g.add(new THREE.CylinderGeometry(r * .6, r * .6, w + .02, 16), COL.rim, 0, 1, 0, 0, 0, Math.PI / 2);
}

// Air
defPart({ id: 'jet_big', name: 'Turbofan', cat: 'Air', mass: 320, hp: 180, buoy: 0.3, attach: 'base', kind: 'jet', cells: cellsBox(-1, 1, 0, 2, -1, 1), thrust: 20000, nozzle: [0, 1.38, 0], dc: 0,
  desc: '20 kN. Big jet for heavy planes. Needs air.',
  build(g, P) { g.cyl(.72, .72, .2, 28, 0, -.15, 0, COL.dark); g.cyl(.68, .68, 1.2, 28, 0, .55, 0, P); g.cyl(.6, .6, .05, 24, 0, -.04, 0, COL.metal); for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; g.box(.5, .02, .1, Math.cos(a) * .3, -.02, Math.sin(a) * .3, COL.metal, 0, -a, .3); } g.cyl(.45, .6, .25, 22, 0, 1.25, 0, COL.dark); },
  dyn: [{ type: 'flame', pivot: [0, 1.32, 0], len: 2.6, rad: .4, col: 0x8fd0ff }] });
defPart({ id: 'chute', name: 'Parachute', cat: 'Air', mass: 15, hp: 30, buoy: 0.4, attach: 'base', kind: 'chute', area: 45, dc: 2,
  desc: '{chute} opens it, {chute} again cuts it loose. Opens below about 300 km/h.',
  build(g, P) { g.cyl(.2, .22, .34, 16, 0, -.08, 0, P); g.cyl(.16, .16, .04, 16, 0, .11, 0, COL.white); },
  dyn: [{ type: 'chute', pivot: [0, .1, 0], build(g, P) {
    g.add(new THREE.SphereGeometry(3.4, 20, 8, 0, TAU, 0, Math.PI / 2), COL.orange, 0, 7.2, 0, 0, 0, 0, 1, .55, 1);
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, L = 7.6, ang = Math.atan2(3.3, 7.2); g.box(.03, L, .03, Math.cos(a) * 1.65, 3.6, Math.sin(a) * 1.65, COL.white, Math.sin(a) * ang, 0, -Math.cos(a) * ang); }
    for (let i = 0; i < 8; i += 2) { const a = (i + .5) / 8 * TAU; g.add(new THREE.SphereGeometry(3.42, 4, 6, a - .2, .4, 0, Math.PI / 2), COL.white, 0, 7.2, 0, 0, 0, 0, 1, .56, 1); }
  } }] });

// Space
defPart({ id: 'rocket_s', name: 'Small Rocket', cat: 'Space', mass: 25, hp: 40, buoy: 0.3, attach: 'ends', kind: 'rocket', thrust: 5000, ve: 1100, nozzle: [0, .45, 0], dc: 2,
  desc: '5 kN. Light thruster for probes and landers.',
  build(g, P) { g.cyl(.18, .18, .16, 14, 0, -.17, 0, COL.metal); g.cyl(.08, .1, .14, 12, 0, -.02, 0, COL.dark); g.cyl(.17, .07, .26, 18, 0, .17, 0, COL.copper, 0, 0, 0, true); },
  dyn: [{ type: 'flame', pivot: [0, .3, 0], len: 1.1, rad: .14, col: 0xffa040 }] });
defPart({ id: 'rocket_vac', name: 'Vacuum Engine', cat: 'Space', mass: 140, hp: 90, buoy: 0.2, attach: 'ends', kind: 'rocket', cells: cellsBox(0, 0, 0, 1, 0, 0), thrust: 24000, ve: 2000, vac: true, nozzle: [0, .95, 0], dc: 2,
  desc: '24 kN with far better fuel economy, but weak in air. For upper stages.',
  build(g, P) { g.cyl(.22, .22, .2, 16, 0, -.15, 0, COL.metal); g.cyl(.1, .14, .25, 14, 0, .05, 0, COL.dark); g.cyl(.24, .1, .7, 24, 0, .55, 0, COL.copper, 0, 0, 0, true); g.cyl(.23, .09, .68, 24, 0, .56, 0, COL.black, 0, 0, 0, true); },
  dyn: [{ type: 'flame', pivot: [0, .9, 0], len: 2.6, rad: .22, col: 0xffc070 }] });
defPart({ id: 'star_drive', name: 'Star Drive', cat: 'Space', mass: 180, hp: 120, buoy: 0.2, attach: 'ends', kind: 'rocket', cells: cellsBox(0, 0, 0, 1, 0, 0), thrust: 30000, ve: 9000, vac: true, nozzle: [0, .95, 0], dc: 2,
  desc: '30 kN with nine times the fuel economy of a Rocket Engine: built for the trip to another star. Weak in air.',
  build(g, P) {
    g.cyl(.27, .27, .26, 20, 0, -.13, 0, COL.metal); g.cyl(.29, .29, .05, 20, 0, .02, 0, P); g.cyl(.17, .21, .3, 18, 0, .2, 0, COL.dark);
    for (const y of [.1, .24]) g.cyl(.225, .225, .03, 20, 0, y, 0, 0xa98bff);
    g.cyl(.29, .13, .6, 26, 0, .62, 0, COL.metal, 0, 0, 0, true); g.cyl(.27, .115, .58, 26, 0, .63, 0, COL.black, 0, 0, 0, true);
  },
  dyn: [{ type: 'flame', pivot: [0, .92, 0], len: 3.4, rad: .25, col: 0xa98bff }] });
defPart({ id: 'ion', name: 'Ion Engine', cat: 'Space', mass: 50, hp: 60, buoy: 0.3, attach: 'ends', kind: 'rocket', thrust: 600, ve: 15000, ion: true, nozzle: [0, .3, 0], dc: 3,
  desc: '0.6 kN, sips fuel. Only works in space, in sunlight, with a Solar Panel for each ion engine.',
  build(g, P) { g.cyl(.22, .22, .3, 18, 0, -.1, 0, COL.dark); g.cyl(.24, .24, .06, 18, 0, .07, 0, P); g.add(new THREE.CircleGeometry(.18, 18), 0x6fc3ff, 0, .105, 0, -Math.PI / 2); },
  dyn: [{ type: 'flame', pivot: [0, .1, 0], len: 1.6, rad: .17, col: 0x6fb6ff }] });
defPart({ id: 'solar', name: 'Solar Panel', cat: 'Space', mass: 15, hp: 20, buoy: 0.5, attach: 'base', kind: 'solar', cells: cellsBox(-2, 2, 0, 0, -1, 1), dc: 3,
  desc: 'Powers Ion Engines in sunlight.',
  build(g, P) { g.box(.1, .3, .1, 0, -.1, 0, COL.metal); g.box(2.4, .04, 1.4, 0, .07, 0, COL.metal); g.box(2.32, .05, 1.32, 0, .08, 0, 0x1d3c6e); for (let i = -2; i <= 2; i++) g.box(.02, .055, 1.32, i * .46, .085, 0, 0x8fa8c8); } });
defPart({ id: 'heatshield', name: 'Heat Shield', cat: 'Space', mass: 90, hp: 500, buoy: 0.3, attach: 'base', kind: 'heatshield', cells: cellsBox(-1, 1, 0, 0, -1, 1), dc: 4,
  desc: 'Shrugs off heat from fast entries and the Sun. Each shield cuts heat damage, up to three.',
  build(g, P) { g.cyl(.74, .74, .1, 28, 0, -.2, 0, COL.dark); g.add(new THREE.SphereGeometry(.76, 28, 6, 0, TAU, 0, .5), 0x3b2a22, 0, -.6, 0); } });
defPart({ id: 'tank_long', name: 'Slim Tank', cat: 'Space', mass: 30, hp: 70, buoy: 0.6, kind: 'tank', fuel: 180, cells: cellsBox(0, 0, 0, 2, 0, 0), dc: 2,
  desc: 'Holds 180 kg of fuel in a 1.5 m tube.',
  build(g, P) { g.cyl(.235, .235, 1.4, 18, 0, .5, 0, COL.white); for (const y of [0, 1]) g.cyl(.24, .24, .08, 18, 0, y, 0, P); } });
defPart({ id: 'tank_huge', name: 'Huge Fuel Tank', cat: 'Space', mass: 500, hp: 320, buoy: 0.6, kind: 'tank', fuel: 6000, cells: cellsBox(-2, 2, 0, 5, -2, 2), dc: 2,
  desc: 'Holds 6000 kg of fuel. For interplanetary rockets.',
  build(g, P) { g.cyl(1.22, 1.22, 2.9, 32, 0, 1.25, 0, COL.white); for (const y of [.1, 1.25, 2.4]) g.cyl(1.23, 1.23, .2, 32, 0, y, 0, P); } });
defPart({ id: 'grapple', name: 'Grapple Claw', cat: 'Space', mass: 150, hp: 400, buoy: 0.2, attach: 'base', kind: 'grapple', cells: cellsBox(-1, 1, 0, 1, -1, 1), dc: 4,
  desc: 'Skyhook tip. Reaches about 25 m to grab a Docking Port that faces it and reels it in.',
  build(g, P) { g.cyl(.7, .75, .5, 20, 0, -.05, 0, COL.haz); g.cyl(.55, .7, .3, 20, 0, .33, 0, COL.dark); g.torus(.55, .1, 0, .55, 0, COL.dark, Math.PI / 2);
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; g.box(.14, .5, .22, Math.cos(a) * .58, .75, Math.sin(a) * .58, COL.metal, Math.sin(a) * .3, 0, -Math.cos(a) * .3); } } });
defPart({ id: 'counterweight', name: 'Counterweight', cat: 'Space', mass: 16000, hp: 1200, buoy: 0.01, cells: cellsBox(0, 1, 0, 1, 0, 1), dc: 4,
  desc: 'Sixteen tonnes of tungsten. Balances skyhooks.',
  build(g, P) { g.chamfer(1, 1, 1, .08, 0x4a4f55, .25, .25, .25); for (const y of [0, .5]) g.box(1.01, .1, 1.01, .25, y, .25, COL.haz); } });

// Moving parts: the part sits on its base; whatever is built on its top face moves
defPart({ id: 'hinge', name: 'Hinge', cat: 'Moving', mass: 25, hp: 140, buoy: 0.3, attach: 'ends', kind: 'joint', joint: { type: 'hinge', torque: 40000 }, dc: 4,
  desc: 'Swings what is built on top. {hinge_a} and {hinge_b} move it. R turns which way it swings.',
  build(g, P) { g.box(.5, .14, .5, 0, -.18, 0, COL.dark); for (const x of [-.18, .18]) g.box(.12, .3, .2, x, -.04, 0, P); g.cyl(.06, .06, .5, 10, 0, 0, 0, COL.metal, 0, 0, Math.PI / 2); },
  dyn: [{ type: 'jtop', pivot: [0, 0, 0], build(g, P) { g.box(.22, .3, .2, 0, .04, 0, shade(P, .8)); g.box(.5, .14, .5, 0, .18, 0, COL.dark); } }] });
defPart({ id: 'rotor', name: 'Rotor', cat: 'Moving', mass: 30, hp: 140, buoy: 0.3, attach: 'ends', kind: 'joint', joint: { type: 'rotor', torque: 30000 }, dc: 4,
  desc: 'Turns what is built on top. {rotor_l} and {rotor_r} spin it. Turrets, cranes and rotors.',
  build(g, P) { g.cyl(.25, .25, .25, 22, 0, -.125, 0, COL.dark); g.cyl(.18, .18, .06, 18, 0, .02, 0, P); },
  dyn: [{ type: 'jtop', pivot: [0, 0, 0], build(g, P) { g.cyl(.24, .24, .18, 22, 0, .16, 0, P); g.box(.06, .02, .2, 0, .255, .1, COL.haz); } }] });
defPart({ id: 'piston', name: 'Piston', cat: 'Moving', mass: 40, hp: 160, buoy: 0.3, attach: 'ends', kind: 'joint', joint: { type: 'piston', force: 60000, travel: 2 }, dc: 4,
  desc: 'Pushes what is built on top up to 2 m out. {piston_out} extends it, {piston_in} pulls it back.',
  build(g, P) { g.chamfer(.46, .4, .46, .03, COL.dark, 0, -.05, 0); g.box(.48, .06, .48, 0, -.2, 0, P); },
  dyn: [{ type: 'jrod', pivot: [0, 0, 0], build(g, P) { g.cyl(.09, .09, 1, 12, 0, .5, 0, COL.metal); } },
        { type: 'jtop', pivot: [0, 0, 0], build(g, P) { g.chamfer(.46, .1, .46, .02, P, 0, .2, 0); } }] });
defPart({ id: 'suspension', name: 'Suspension', cat: 'Moving', mass: 20, hp: 120, buoy: 0.3, attach: 'ends', kind: 'joint', joint: { type: 'susp', travel: .4, k: 45000, c: 3500 }, dc: 4,
  desc: 'Spring and damper. Whatever is on top bounces on it.',
  build(g, P) { g.box(.46, .1, .46, 0, -.2, 0, COL.dark); g.cyl(.06, .06, .3, 8, 0, -.05, 0, COL.metal); },
  dyn: [{ type: 'jrod', pivot: [0, 0, 0], build(g, P) { for (let i = 0; i < 6; i++) g.add(new THREE.TorusGeometry(.16, .025, 6, 16), COL.red, 0, (i + .5) / 6, 0, Math.PI / 2); } },
        { type: 'jtop', pivot: [0, 0, 0], build(g, P) { g.box(.46, .1, .46, 0, .2, 0, P); } }] });

// Gadgets
defPart({ id: 'claw', name: 'Grabber Claw', cat: 'Gadgets', mass: 40, hp: 140, buoy: 0.3, attach: 'base', kind: 'claw', cells: [[0, 0, 0], [0, 1, 0]], dc: 4,
  desc: '{grab} grabs whatever the jaws touch and holds on. {grab} again lets go.',
  build(g, P) { g.cyl(.22, .25, .3, 16, 0, -.1, 0, COL.dark); g.cyl(.12, .12, .3, 12, 0, .2, 0, P); },
  dyn: [{ type: 'claw', pivot: [0, .35, 0], build(g, P) { for (const s of [-1, 1]) { g.box(.06, .4, .14, s * .14, .2, 0, COL.metal, 0, 0, s * .25); g.box(.06, .2, .14, s * .17, .45, 0, COL.haz, 0, 0, -s * .3); } } }] });
defPart({ id: 'winch', name: 'Winch', cat: 'Gadgets', mass: 50, hp: 140, buoy: 0.3, attach: 'base', kind: 'winch', dc: 4,
  desc: 'Drops a hook on a cable. The hook latches onto what it touches. {winch_in} reels in, {winch_out} lets out, {grab} lets go.',
  build(g, P) { g.box(.48, .12, .48, 0, -.19, 0, COL.dark); g.cyl(.17, .17, .38, 16, 0, -.02, 0, P, 0, 0, Math.PI / 2); g.cyl(.12, .12, .4, 12, 0, -.02, 0, COL.black, 0, 0, Math.PI / 2); g.box(.06, .2, .06, 0, .15, 0, COL.metal); } });
defPart({ id: 'winch_hook', name: 'Winch Hook', cat: 'Hidden', mass: 25, hp: 250, buoy: 0.1, kind: 'hook', dc: 4, desc: 'The end of a winch cable.',
  build(g, P) { g.cyl(.18, .18, .2, 14, 0, .12, 0, COL.haz); g.torus(.13, .045, 0, -.1, 0, COL.metal); g.cyl(.04, .04, .16, 8, 0, .27, 0, COL.dark); } });
defPart({ id: 'crate', name: 'Cargo Crate', cat: 'Gadgets', mass: 150, hp: 120, buoy: 0.5, cells: cellsBox(0, 1, 0, 1, 0, 1), dc: 9, desc: 'One-metre crate of cargo. Haul it, hook it, drop it.',
  build(g, P) { g.box(1, 1, 1, .25, .25, .25, P); for (const [a, b] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) { g.box(.08, 1.02, .08, .25 + a * .46, .25, .25 + b * .46, shade(P, .6)); g.box(1.02, .08, .08, .25, .25 + a * .46, .25 + b * .46, shade(P, .6)); g.box(.08, .08, 1.02, .25 + a * .46, .25 + b * .46, .25, shade(P, .6)); } g.box(.7, .08, .02, .25, .25, .76, shade(P, .6), 0, 0, .78); } });
defPart({ id: 'spotlight', name: 'Spotlight', cat: 'Gadgets', mass: 8, hp: 20, buoy: 0.4, attach: 'base', kind: 'spot', dc: 4, desc: 'Bright lamp that switches on when it gets dark.',
  build(g, P) { g.box(.3, .12, .3, 0, -.19, 0, COL.dark); g.cyl(.17, .13, .24, 16, 0, -.02, 0, P); },
  dyn: [{ type: 'lens', pivot: [0, .1, 0], build(g, P) { g.cyl(.16, .16, .02, 18, 0, 0, 0, 0xfff6d8); } }, { type: 'beam', pivot: [0, .11, 0], build(g, P) { g.add(new THREE.CylinderGeometry(.16, 2.6, 14, 20, 1, true), 0xfff2c4, 0, 7, 0); } }] });

// Control
defPart({ id: 'pseat', name: 'Passenger Seat', cat: 'Control', mass: 55, hp: 150, buoy: 0.4, kind: 'passenger', dc: 3, desc: 'A seat for a passenger. Only the Seat drives.',
  build(g, P) { g.chamfer(.48, .12, .46, .02, COL.dark, 0, -.19, 0); g.box(.44, .4, .08, 0, .02, -.19, P); g.box(.22, .2, .14, 0, -.03, -.07, 0x6b3a2a); g.sph(.085, 0, .15, -.06, 0xd8b48c); g.box(.13, .045, .03, 0, .16, .02, COL.black); } });


// Logic: blocks that press keys by themselves (Configure sets what they listen to and what they press)
function logicBase(g, P) { g.chamfer(.5, .2, .5, .03, COL.dark, 0, -.15, 0); g.box(.42, .03, .42, 0, -.04, 0, P); }
defPart({ id: 'sensor', name: 'Sensor', cat: 'Logic', mass: 4, hp: 25, buoy: 0.4, kind: 'logic', logic: 'sensor', dc: 10,
  desc: 'Measures height, speed, climb, tilt, distance ahead or fuel, and presses a key while the reading is past your value.',
  build(g, P) { logicBase(g, P); g.cyl(.15, .19, .1, 18, 0, .02, 0, COL.metal); g.cyl(.1, .1, .05, 16, 0, .08, 0, 0x9fe8ff); g.box(.04, .04, .04, .17, -.01, .17, 0x6fcfa1); } });
defPart({ id: 'timer', name: 'Timer', cat: 'Logic', mass: 4, hp: 25, buoy: 0.4, kind: 'logic', logic: 'timer', dc: 1,
  desc: 'Waits, then presses a key for as long as you set. Starts when its start key is pressed, or as soon as you drive.',
  build(g, P) { logicBase(g, P); g.cyl(.17, .17, .04, 24, 0, -.01, 0, COL.white); g.cyl(.18, .18, .03, 24, 0, -.025, 0, P); g.box(.025, .012, .12, 0, .015, .05, COL.black); g.box(.09, .012, .025, .04, .015, 0, COL.black); g.cyl(.02, .02, .02, 8, 0, .02, 0, COL.red); } });
defPart({ id: 'gate', name: 'Logic Gate', cat: 'Logic', mass: 4, hp: 25, buoy: 0.4, kind: 'logic', logic: 'gate', dc: 3,
  desc: 'AND, OR, XOR, NOT, NAND or NOR: presses its key when its two inputs agree with the rule.',
  build(g, P) { logicBase(g, P); g.box(.3, .07, .3, 0, -.0, 0, COL.black); for (const z of [-.09, 0, .09]) for (const x of [-.18, .18]) g.box(.06, .03, .03, x, -.02, z, COL.metal); g.cyl(.04, .04, .02, 10, -.08, .04, -.08, P); } });
defPart({ id: 'toggle', name: 'Toggle Switch', cat: 'Logic', mass: 4, hp: 25, buoy: 0.4, kind: 'logic', logic: 'toggle', dc: 2,
  desc: 'Each press of its key flips it on or off. While on, it keeps pressing its own key for you.',
  build(g, P) { logicBase(g, P); g.box(.28, .05, .2, 0, -.005, 0, P); g.box(.05, .18, .05, .04, .07, 0, COL.metal, 0, 0, -.45); g.sph(.04, .08, .15, 0, COL.red); } });

// loose props around the world (also buildable)
defPart({ id: 'cone', name: 'Traffic Cone', cat: 'Gadgets', mass: 3, hp: 400, buoy: 0.6, attach: 'base', dc: 1,
  desc: 'Light plastic cone. Knock it flying.', build(g, P) { g.box(.46, .05, .46, 0, -.225, 0, COL.orange); g.cone(.19, .44, 14, 0, 0, 0, COL.orange); g.cyl(.12, .15, .06, 14, 0, .02, 0, COL.white); } });
defPart({ id: 'barrel', name: 'Barrel', cat: 'Gadgets', mass: 40, hp: 120, buoy: 0.8, cells: [[0, 0, 0], [0, 1, 0]], dc: 2,
  desc: 'Steel drum, two cells tall.', build(g, P) { g.cyl(.23, .23, .95, 16, 0, .25, 0, P); for (const y of [-.12, .25, .62]) g.cyl(.24, .24, .04, 16, 0, y, 0, shade(P, .7)); } });

/* ================= Version 12: more Trailmakers blocks ================= */
// Shapes
const sc3 = (V, k, o) => V.map(v => [v[0] * k + o, v[1] * k + o, v[2] * k + o]);
const INNER = { V: [[-.25, -.25, -.25], [.25, -.25, -.25], [.25, -.25, .25], [-.25, -.25, .25], [.25, .25, -.25], [.25, .25, .25], [-.25, .25, .25]], F: [[0, 1, 2, 3], [4, 5, 6], [1, 2, 5, 4], [2, 3, 6, 5], [0, 3, 6], [0, 1, 4], [0, 4, 6]] };
defPart({ id: 'inner_corner', name: 'Inner Corner', cat: 'Shapes', mass: 21, hp: 40, buoy: 0.15, desc: 'A block with one corner sliced off. Fills the inside of rounded-off edges.', build(g, P) { g.poly(INNER, P); } });
defPart({ id: 'wedge_low', name: 'Low Wedge', cat: 'Shapes', mass: 8, hp: 25, buoy: 0.12, desc: 'Half-height slope for spoilers and gentle noses.',
  build(g, P) { g.poly({ V: [[-.25, -.25, -.25], [.25, -.25, -.25], [.25, -.25, .25], [-.25, -.25, .25], [-.25, 0, -.25], [.25, 0, -.25]], F: WEDGE.F }, P); } });
defPart({ id: 'wedge_big', name: 'Big Wedge', cat: 'Shapes', mass: 110, hp: 200, buoy: 0.12, cells: cellsBox(0, 1, 0, 1, 0, 1), desc: 'One-metre slope. Ramps, ploughs and big noses.', build(g, P) { g.poly({ V: sc3(WEDGE.V, 2, .25), F: WEDGE.F }, P); } });
defPart({ id: 'corner_big', name: 'Big Corner Slope', cat: 'Shapes', mass: 65, hp: 150, buoy: 0.08, cells: cellsBox(0, 1, 0, 1, 0, 1), mirrorP: [0, 0, 1, 0, 1, 0, 1, 0, 0], desc: 'One-metre pyramid corner.', build(g, P) { g.poly({ V: sc3(CORNER.V, 2, .25), F: CORNER.F }, P); } });
defPart({ id: 'cone_big', name: 'Big Cone', cat: 'Shapes', mass: 60, hp: 120, buoy: 0.2, attach: 'base', cells: cellsBox(-1, 1, 0, 2, -1, 1), desc: 'A 1.5 m cone. Rocket noses, towers and party hats.',
  build(g, P) { g.cone(.75, 1.5, 28, 0, .5, 0, P); g.add(new THREE.CircleGeometry(.75, 28), shade(P, .7), 0, -.25, 0, Math.PI / 2); } });
function halfRoundVF(n) {
  const V = [], F = [[], []];
  for (const x of [-.25, .25]) for (let i = 0; i <= n; i++) { const t = i / n * Math.PI; V.push([x, -.25 + Math.sin(t) * .25, Math.cos(t) * .25]); }
  const N = n + 1;
  for (let i = 0; i < N; i++) { F[0].push(i); F[1].push(i + N); }
  for (let i = 0; i < n; i++) F.push([i, i + 1, i + N + 1, i + N]);
  F.push([0, n, n + N, N]);
  return { V, F };
}
defPart({ id: 'half_round', name: 'Half Round', cat: 'Shapes', mass: 10, hp: 30, buoy: 0.15, desc: 'Half a cylinder lying flat. Fenders, humps and arches.', build(g, P) { g.poly(halfRoundVF(10), P); } });
defPart({ id: 'ball', name: 'Ball', cat: 'Shapes', mass: 13, hp: 35, buoy: 0.2, desc: 'A round ball. Knobs, heads and wheels that do not drive.', build(g, P) { g.sph(.25, 0, 0, 0, P, 1, 1, 1, 20, 14); } });
defPart({ id: 'rounded', name: 'Rounded Block', cat: 'Shapes', mass: 22, hp: 42, buoy: 0.17, desc: 'A block with soft, bevelled edges.', build(g, P) { g.chamfer(.5, .5, .5, .12, P); } });
defPart({ id: 'panel', name: 'Panel 2×2', cat: 'Shapes', mass: 26, hp: 70, buoy: 0.05, cells: cellsBox(0, 1, 0, 0, 0, 1), desc: 'A thin one-metre panel. Floors, walls and bodywork.', build(g, P) { g.chamfer(1, .12, 1, .02, P, .25, -.19, .25); } });
defPart({ id: 'elbow', name: 'Pipe Elbow', cat: 'Shapes', mass: 7, hp: 28, buoy: 0.5, desc: 'A pipe bent through a right angle, from the bottom face round to the front one.',
  build(g, P) { g.add(new THREE.TorusGeometry(.25, .2, 12, 14, Math.PI / 2), P, 0, -.25, .25, 0, Math.PI / 2, 0); } });
defPart({ id: 'window', name: 'Glass Window', cat: 'Shapes', mass: 6, hp: 18, buoy: 0.3, desc: 'A framed pane of glass. Cockpits, cabins and greenhouses.',
  build(g, P) { for (const s of [-1, 1]) { g.box(.5, .06, .08, 0, s * .22, 0, P); g.box(.06, .5, .08, s * .22, 0, 0, P); } },
  dyn: [{ type: 'glass', pivot: [0, 0, 0], build(g, P) { g.box(.44, .44, .03, 0, 0, 0, 0x9fd3f0); } }] });

// Flight
defPart({ id: 'thruster', name: 'Thruster', cat: 'Air', mass: 20, hp: 35, buoy: 0.3, attach: 'base', kind: 'jet', thrust: 2500, any: true, nozzle: [0, .3, 0], dc: 3,
  desc: '2.5 kN, needs no fuel. Works in air and under water, but not in space. Pushes away from its nozzle.',
  build(g, P) { g.cyl(.22, .24, .2, 16, 0, -.15, 0, COL.dark); g.cyl(.19, .19, .2, 16, 0, .03, 0, P); g.cyl(.12, .17, .14, 14, 0, .19, 0, COL.metal, 0, 0, 0, true); },
  dyn: [{ type: 'flame', pivot: [0, .26, 0], len: .9, rad: .11, col: 0xb8e0ff }] });
defPart({ id: 'jet_s', name: 'Small Jet', cat: 'Air', mass: 45, hp: 45, buoy: 0.3, attach: 'base', kind: 'jet', thrust: 3500, nozzle: [0, .45, 0], dc: 0,
  desc: '3.5 kN. A light jet for small planes and hover bikes. Needs air.',
  build(g, P) { g.cyl(.2, .2, .12, 16, 0, -.19, 0, COL.dark); g.cyl(.18, .18, .4, 16, 0, .03, 0, P); g.cyl(.12, .16, .14, 14, 0, .3, 0, COL.dark); },
  dyn: [{ type: 'flame', pivot: [0, .38, 0], len: 1.1, rad: .11, col: 0x8fd0ff }] });
defPart({ id: 'jet_ab', name: 'Afterburner Jet', cat: 'Air', mass: 160, hp: 90, buoy: 0.3, attach: 'base', kind: 'jet', cells: cellsBox(0, 0, 0, 2, 0, 0), thrust: 9000, ab: 2.2, nozzle: [0, 1.3, 0], dc: 0,
  desc: '9 kN, and {boost} lights the afterburner for 20 kN while held. Needs air.',
  build(g, P) { g.cyl(.26, .26, .16, 18, 0, -.17, 0, COL.dark); g.cyl(.24, .24, 1.1, 18, 0, .45, 0, P); for (const y of [.1, .7]) g.cyl(.246, .246, .06, 18, 0, y, 0, COL.dark); g.cyl(.17, .23, .3, 16, 0, 1.12, 0, COL.copper, 0, 0, 0, true); g.cyl(.14, .14, .08, 12, 0, 1.24, 0, COL.black); },
  dyn: [{ type: 'flame', pivot: [0, 1.22, 0], len: 1.7, rad: .17, col: 0xffa860 }] });
defPart({ id: 'heli', name: 'Helicopter Rotor', cat: 'Air', mass: 140, hp: 120, buoy: 0.3, attach: 'base', kind: 'prop', heli: true, cells: cellsBox(-1, 1, 0, 0, -1, 1), thrust: 15000, dc: 0,
  desc: '15 kN of lift. Flies itself level: {fwd} climbs, {descend} sinks, let go to hover. {pitch_dn} {pitch_up} {roll_l} {roll_r} tilt it to fly, {left} {right} turn.',
  build(g, P) { g.cyl(.62, .7, .32, 20, 0, -.09, 0, COL.dark); g.cyl(.18, .22, .5, 14, 0, .2, 0, P); },
  dyn: [{ type: 'spin', pivot: [0, .45, 0], build(g, P) { g.cyl(.2, .2, .14, 14, 0, 0, 0, COL.metal); for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; g.add(new THREE.BoxGeometry(2.7, .04, .26), COL.dark, Math.cos(a) * 1.4, 0, -Math.sin(a) * 1.4, .08, a, 0, 1, 1, 1, 'YXZ'); g.box(.3, .045, .27, Math.cos(a) * 2.6, 0, -Math.sin(a) * 2.6, COL.haz, 0, a, 0); } } }] });
defPart({ id: 'balloon', name: 'Balloon', cat: 'Air', mass: 12, hp: 25, buoy: 0.5, attach: 'base', kind: 'balloon', balloon: { h: 2.4, lift: 1250 }, dc: 2,
  desc: 'Lifts about 125 kg at sea level, less as the air thins, so it finds its own ceiling. Give it a key with Configure to let it go.',
  build(g, P) { g.cyl(.18, .22, .2, 14, 0, -.15, 0, COL.dark); g.box(.03, 1.7, .03, 0, .85, 0, COL.white); g.sph(1.1, 0, 2.4, 0, P, 1, 1.15, 1, 22, 14); g.cone(.18, .3, 12, 0, 1.15, 0, shade(P, .8), Math.PI, 0, 0); } });
defPart({ id: 'wing_delta', name: 'Delta Wing', cat: 'Air', mass: 30, hp: 60, buoy: 0.35, kind: 'wing', area: 3.4, cells: cellsBox(0, 0, 0, 3, -3, 0), dc: 5,
  desc: 'Triangular lift surface, 3.4 m². Fast jets and paper planes.',
  build(g, P) { g.poly(plateVF(-.25, -1.75, .25, .05, 1.75, -1.75, -1.5, .015), P); g.poly(plateVF(-.25, -1.75, -1.6, .055, 1.75, -1.75, -1.7, .02), shade(P, .78)); } });
defPart({ id: 'wing_tip', name: 'Wing Tip', cat: 'Air', mass: 4, hp: 20, buoy: 0.35, kind: 'wing', area: .3, cells: cellsBox(0, 0, 0, 0, -1, 0), dc: 5,
  desc: 'Rounded end cap for a wing, 0.3 m².', build(g, P) { g.poly(plateVF(-.25, -.75, .25, .045, .25, -.45, -.05, .02), P); } });
defPart({ id: 'flap_big', name: 'Big Flap', cat: 'Air', mass: 22, hp: 45, buoy: 0.3, attach: 'base', kind: 'flap', area: 1.7, cells: cellsBox(-2, 2, 0, 0, 0, 0), dc: 1,
  desc: 'A wide control flap for big wings and tails. R turns it.',
  build(g, P) { g.cyl(.04, .04, 2.46, 8, 0, -.22, 0, COL.dark, 0, 0, Math.PI / 2); },
  dyn: [{ type: 'flap', pivot: [0, -.22, 0], build(g, P) { g.poly({ V: [[-1.23, 0, -.035], [1.23, 0, -.035], [1.23, 0, .035], [-1.23, 0, .035], [-1.2, .7, -.01], [1.2, .7, -.01], [1.2, .7, .01], [-1.2, .7, .01]], F: [[0, 1, 2, 3], [4, 5, 6, 7], [1, 2, 6, 5], [0, 3, 7, 4], [2, 3, 7, 6], [0, 1, 5, 4]] }, P); } }] });

// Gadgets
defPart({ id: 'servo', name: 'Servo', cat: 'Moving', mass: 22, hp: 140, buoy: 0.3, attach: 'ends', kind: 'joint', joint: { type: 'rotor', torque: 26000, servo: true }, dc: 4,
  desc: 'Turns what is built on top to an angle while a key is held, and back to straight when you let go. Steering axles and flaps.',
  build(g, P) { g.chamfer(.48, .25, .48, .03, COL.dark, 0, -.125, 0); g.box(.3, .04, .06, 0, .01, .17, COL.haz); },
  dyn: [{ type: 'jtop', pivot: [0, 0, 0], build(g, P) { g.chamfer(.44, .2, .44, .03, P, 0, .12, 0); g.box(.05, .02, .18, 0, .23, .1, COL.haz); } }] });
defPart({ id: 'magnet', name: 'Magnet', cat: 'Gadgets', mass: 45, hp: 160, buoy: 0.2, attach: 'base', kind: 'magnet', dc: 1,
  desc: '{grab} switches it on: it pulls in whatever is in front of it, up to 4 m away, and holds on. {grab} again lets go.',
  build(g, P) { g.cyl(.24, .24, .3, 18, 0, -.1, 0, COL.dark); g.box(.46, .12, .2, 0, .1, 0, COL.red); for (const x of [-.17, .17]) g.box(.12, .1, .2, x, .2, 0, COL.metal); } });
defPart({ id: 'horn', name: 'Horn', cat: 'Gadgets', mass: 3, hp: 20, buoy: 0.4, attach: 'base', kind: 'horn', dc: 2,
  desc: '{horn} honks it. Every horn on board sounds together.',
  build(g, P) { g.box(.3, .1, .3, 0, -.2, 0, COL.dark); g.cyl(.07, .2, .32, 14, 0, .0, 0, P, 0, 0, 0, true); g.cyl(.05, .05, .1, 8, 0, -.12, 0, COL.metal); } });
defPart({ id: 'bumper', name: 'Bumper', cat: 'Gadgets', mass: 10, hp: 120, buoy: 0.4, bounce: 0.75, desc: 'Rubber block. Anything that hits it bounces off.',
  build(g, P) { g.chamfer(.5, .5, .5, .1, 0x2a2d31); g.box(.506, .1, .506, 0, 0, 0, COL.haz); } });

// Weapons: they fire with {fire} (a click in drive mode, or Enter); the shot leaves out of the top face
function gunBase(g, P) { g.chamfer(.5, .22, .5, .03, COL.dark, 0, -.14, 0); }
defPart({ id: 'cannon', name: 'Cannon', cat: 'Weapons', mass: 120, hp: 160, buoy: 0.2, attach: 'base', kind: 'gun', cells: cellsBox(0, 0, 0, 2, 0, 0), dc: 4,
  gun: { type: 'shell', speed: 150, reload: 1.4, power: 260, radius: 4.5, recoil: 900, muz: 1.3, life: 6, snd: 'cannon' },
  desc: '{fire} fires an exploding shell at 540 km/h, every 1.4 s. Kicks back when it fires.',
  build(g, P) { gunBase(g, P); g.cyl(.2, .22, .3, 16, 0, .05, 0, P); g.cyl(.09, .1, 1.1, 14, 0, .7, 0, COL.dark); g.cyl(.12, .12, .1, 14, 0, 1.22, 0, COL.black); } });
defPart({ id: 'mgun', name: 'Machine Gun', cat: 'Weapons', mass: 30, hp: 70, buoy: 0.3, attach: 'base', kind: 'gun', cells: cellsBox(0, 0, 0, 1, 0, 0), dc: 4,
  gun: { type: 'bullet', speed: 330, reload: 0.09, dmg: 12, recoil: 25, muz: .78, life: 2.5, snd: 'mg' },
  desc: 'Eleven rounds a second while {fire} is held. Chews through blocks, not armor.',
  build(g, P) { gunBase(g, P); g.box(.2, .22, .3, 0, .06, 0, P); g.cyl(.04, .045, .6, 10, 0, .45, 0, COL.dark); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; g.cyl(.012, .012, .5, 6, Math.cos(a) * .065, .45, Math.sin(a) * .065, COL.black); } } });
defPart({ id: 'missile', name: 'Missile Launcher', cat: 'Weapons', mass: 80, hp: 110, buoy: 0.3, attach: 'base', kind: 'gun', cells: cellsBox(0, 0, 0, 2, 0, 0), dc: 4,
  gun: { type: 'missile', speed: 30, reload: 3, power: 340, radius: 6.5, recoil: 80, muz: 1.3, life: 9, snd: 'missile' },
  desc: '{fire} fires a missile that steers itself at the vehicle nearest its aim, every 3 s.',
  build(g, P) { gunBase(g, P); g.box(.44, .4, .44, 0, .18, 0, P); for (const x of [-.11, .11]) for (const z of [-.11, .11]) { g.cyl(.08, .08, 1, 12, x, .82, z, COL.white); g.cone(.08, .16, 10, x, 1.4, z, COL.red); } } });
defPart({ id: 'bombrack', name: 'Bomb Rack', cat: 'Weapons', mass: 60, hp: 90, buoy: 0.3, attach: 'base', kind: 'gun', dc: 4,
  gun: { type: 'bomb', speed: 2, reload: 1.6, power: 480, radius: 8.5, recoil: 0, muz: .5, life: 30, snd: 'bombdrop' },
  desc: '{fire} drops a bomb out of its open face, every 1.6 s. Mount it under a plane, facing down.',
  build(g, P) { g.box(.5, .12, .5, 0, -.19, 0, COL.dark); for (const x of [-.2, .2]) g.box(.05, .3, .4, x, -.02, 0, COL.metal); g.sph(.17, 0, .08, 0, 0x3a4148, 1, 1.6, 1); g.cone(.12, .14, 4, 0, .34, 0, COL.haz); } });
defPart({ id: 'armor_plate', name: 'Armor Plate', cat: 'Weapons', mass: 40, hp: 300, buoy: 0.05, dc: 4, desc: 'Thin steel armor that soaks up shots and blasts.',
  build(g, P) { g.chamfer(.5, .14, .5, .03, mixc(P, 0x30363c, 0.4), 0, -.18, 0); for (const x of [-.17, .17]) for (const z of [-.17, .17]) g.cyl(.03, .03, .02, 6, x, -.1, z, COL.metal); } });

/* ================= Version 13: tracks, more wheels, tools, engines and decor ================= */
// Tracks: a belt round road wheels. Each road wheel is a sprung contact; the two sides drive at different speeds to turn
function trackGeo(g, half, rr, w, hubY, P, n) {
  // the belt: tread plates all the way round a stadium shape, in the x-z plane, w wide along the axle (y)
  const per = 4 * half + TAU * rr, step = per / n;
  for (let i = 0; i < n; i++) {
    let s = (i + .5) * step, x, z, th;
    if (s < 2 * half) { x = -half + s; z = -rr; th = 0; }
    else if ((s -= 2 * half) < Math.PI * rr) { const a = s / rr - Math.PI / 2; x = half + Math.cos(a) * rr; z = Math.sin(a) * rr; th = a + Math.PI / 2; }
    else if ((s -= Math.PI * rr) < 2 * half) { x = half - s; z = rr; th = Math.PI; }
    else { s -= 2 * half; const a = s / rr + Math.PI / 2; x = -half + Math.cos(a) * rr; z = Math.sin(a) * rr; th = a + Math.PI / 2; }
    g.box(step * .8, w, .07, x, hubY, z, i % 2 ? COL.tire : COL.side, 0, -th, 0);
  }
  for (const sx of [-1, 1]) { g.cyl(rr * .85, rr * .85, w * .6, 16, sx * half, hubY, 0, COL.dark); g.cyl(rr * .35, rr * .35, w * .62, 10, sx * half, hubY, 0, P); }
  g.box(2 * half, w * .5, .05, 0, hubY, -rr + .07, COL.black); g.box(2 * half, w * .5, .05, 0, hubY, rr - .07, COL.black);
  g.box(2 * half - rr, .08, rr * .9, 0, hubY + w / 2 - .02, 0, P);   // the side skirt over the wheels
  g.cyl(.07, .07, hubY + .25, 10, 0, (-.25 + hubY) / 2, 0, COL.dark);
}
function trackDef(id, name, half, rr, w, hubY, xs, cells, mass, power, vmax, hp, desc) {
  defPart({ id, name, cat: 'Land', mass, hp, buoy: 0.05, attach: 'base', kind: 'wheel', cells,
    wheel: { r: rr, w, hubY, power, vmax, L: .32, steer: 0, grip: 1.35, stiff: 1.6, track: { xs } }, desc,
    build(g, P) { trackGeo(g, half, rr, w, hubY, P, Math.round((4 * half + TAU * rr) / .24)); },
    dyn: xs.map((x, wi) => ({ type: 'wheel', wi, pivot: [x, hubY, 0], build(g, P) { g.cyl(rr * .72, rr * .72, w * .55, 18, 0, 0, 0, COL.side); g.cyl(rr * .3, rr * .3, w * .58, 10, 0, 0, 0, COL.rim); } })) });
}
trackDef('track', 'Track', 1.25, .6, .9, .25, [-1.25, -.42, .42, 1.25], cellsBox(-3, 3, 0, 1, -1, 1), 180, 30000, 14, 260,
  'A tank track with a 30 kW motor. Goes almost anywhere, slowly. The steering keys turn by driving the two sides at different speeds. Mount one on each side.');
trackDef('track_s', 'Small Track', .8, .45, .45, 0, [-.8, 0, .8], cellsBox(-2, 2, 0, 0, -1, 1), 70, 12000, 9, 140,
  'A narrow track with a 12 kW motor, for small diggers and robots. Turns like a tank.');
// more wheels
wheelDef('wheel_tiny', 'Tiny Wheel', .18, .14, [[0, 0, 0]], 0, 5, 2500, 22, .12, 0, 25, { desc: 'A little 2.5 kW wheel for karts, robots and toys.' });
wheelDef('wheel_tiny_steer', 'Tiny Steering Wheel', .18, .14, [[0, 0, 0]], 0, 5, 2500, 22, .12, .6, 25, { hub: COL.amber, desc: 'A little steering wheel for karts, robots and toys.' });
wheelDef('wheel_offroad', 'Offroad Wheel', .65, .5, cellsBox(-1, 1, 0, 1, -1, 1), .25, 45, 22000, 36, .8, 0, 120, { grip: 1.25, stiff: .55, hub: COL.orange, desc: 'Knobbly tyre on long, soft suspension with a 22 kW motor. Soaks up rocks and jumps.' });
wheelDef('wheel_offroad_steer', 'Offroad Steering Wheel', .65, .5, cellsBox(-1, 1, 0, 1, -1, 1), .25, 45, 22000, 36, .8, .5, 120, { grip: 1.25, stiff: .55, hub: COL.haz, desc: 'Steering offroad tyre on long, soft suspension.' });
wheelDef('wheel_giant', 'Giant Wheel', 1.65, 1.2, cellsBox(-3, 3, 0, 2, -3, 3), .5, 300, 80000, 30, 1, 0, 450, { grip: 1.15, desc: 'A 3.3 m monster tyre with an 80 kW motor. Drives over cars.' });
wheelDef('wheel_giant_steer', 'Giant Steering Wheel', 1.65, 1.2, cellsBox(-3, 3, 0, 2, -3, 3), .5, 300, 80000, 30, 1, .4, 450, { grip: 1.15, desc: 'A 3.3 m steering monster tyre.' });

// Moving parts and tools
defPart({ id: 'detacher', name: 'Detacher', cat: 'Moving', mass: 12, hp: 40, buoy: 0.3, kind: 'decoupler', detacher: true, dc: 4,
  desc: '{detach} lets go of whatever is built on it, on its own key: drop cargo, shed a booster, launch a glider.',
  build(g, P) { g.box(.5, .2, .5, 0, -.15, 0, COL.dark); for (let i = 0; i < 5; i++) g.box(.506, .21, .06, 0, -.15, -.2 + i * .1, i % 2 ? COL.white : COL.red); g.box(.46, .14, .46, 0, .05, 0, P); g.cyl(.07, .07, .05, 12, .15, .14, .15, COL.red); } });
defPart({ id: 'ball_joint', name: 'Ball Joint', cat: 'Moving', mass: 18, hp: 140, buoy: 0.3, attach: 'ends', kind: 'joint', joint: { type: 'ball' }, dc: 4,
  desc: 'Swivels freely every way. Whatever is built on top flops and swings: trailers, tails, ragdolls.',
  build(g, P) { g.box(.46, .14, .46, 0, -.18, 0, COL.dark); g.cyl(.08, .1, .2, 10, 0, -.05, 0, COL.metal); g.sph(.14, 0, .06, 0, COL.metal); },
  dyn: [{ type: 'jtop', pivot: [0, 0, 0], build(g, P) { g.cyl(.17, .2, .14, 14, 0, .12, 0, P); g.box(.46, .1, .46, 0, .2, 0, P); } }] });
defPart({ id: 'coupler', name: 'Coupler', cat: 'Moving', mass: 20, hp: 160, buoy: 0.3, attach: 'base', kind: 'coupler', dc: 4,
  desc: 'Tow hitch. When two couplers on different vehicles touch, they lock together on a swivel. {undock} lets go.',
  build(g, P) { g.box(.46, .12, .46, 0, -.19, 0, COL.dark); g.box(.16, .24, .16, 0, -.03, 0, P); g.torus(.12, .04, 0, .14, 0, COL.haz, Math.PI / 2); g.sph(.08, 0, .14, 0, COL.metal); } });
defPart({ id: 'drill', name: 'Drill', cat: 'Moving', mass: 70, hp: 200, buoy: 0.2, attach: 'base', kind: 'drill', cells: [[0, 0, 0], [0, 1, 0]], dc: 4,
  desc: 'Hold {fire} to spin it. Grinds through any part it touches, of any vehicle.',
  build(g, P) { g.cyl(.24, .24, .3, 16, 0, -.1, 0, COL.dark); g.cyl(.2, .22, .2, 16, 0, .12, 0, P); },
  dyn: [{ type: 'drill', pivot: [0, .22, 0], build(g, P) { g.cone(.17, .7, 12, 0, .35, 0, COL.metal); for (let i = 0; i < 6; i++) { const y = .05 + i * .1, r = .17 * (1 - (y) / .72); g.box(r * 2.2, .03, .04, 0, y, 0, COL.dark, 0, i * .9, 0); } } }] });
defPart({ id: 'claw_big', name: 'Big Grabber', cat: 'Gadgets', mass: 110, hp: 300, buoy: 0.3, attach: 'base', kind: 'claw', claw: { pos: 1.7, r: 1.35 }, cells: cellsBox(-1, 1, 0, 2, -1, 1), dc: 4,
  desc: 'A crane claw that closes on anything big. {grab} grabs and holds, {grab} again lets go.',
  build(g, P) { g.cyl(.5, .6, .4, 18, 0, -.05, 0, COL.dark); g.cyl(.3, .3, .5, 14, 0, .4, 0, P); },
  dyn: [{ type: 'claw', pivot: [0, .6, 0], build(g, P) { for (let k = 0; k < 3; k++) { const a = k / 3 * TAU, c = Math.cos(a), s = Math.sin(a); g.box(.12, .8, .24, c * .38, .38, s * .38, COL.metal, s * .3, 0, -c * .3); g.box(.12, .45, .24, c * .5, .92, s * .5, COL.haz, -s * .35, 0, c * .35); } } }] });
defPart({ id: 'hinge_big', name: 'Big Hinge', cat: 'Moving', mass: 60, hp: 320, buoy: 0.3, attach: 'ends', kind: 'joint', joint: { type: 'hinge', torque: 180000 }, dc: 4,
  desc: 'A heavy-duty hinge with four times the strength. Diggers, drawbridges and dump trucks.',
  build(g, P) { g.box(.5, .16, .5, 0, -.17, 0, COL.dark); for (const x of [-.2, .2]) g.box(.1, .34, .3, x, -.02, 0, COL.haz); g.cyl(.1, .1, .52, 12, 0, 0, 0, COL.metal, 0, 0, Math.PI / 2); },
  dyn: [{ type: 'jtop', pivot: [0, 0, 0], build(g, P) { g.box(.28, .34, .3, 0, .04, 0, shade(P, .8)); g.box(.5, .16, .5, 0, .17, 0, COL.dark); } }] });
defPart({ id: 'piston_long', name: 'Long Piston', cat: 'Moving', mass: 70, hp: 200, buoy: 0.3, attach: 'ends', kind: 'joint', joint: { type: 'piston', force: 90000, travel: 5 }, dc: 4,
  desc: 'Pushes what is built on top up to 5 m out. {piston_out} extends it, {piston_in} pulls it back.',
  build(g, P) { g.chamfer(.48, .44, .48, .03, COL.dark, 0, -.03, 0); g.box(.5, .06, .5, 0, -.2, 0, P); g.box(.5, .06, .5, 0, .1, 0, COL.haz); },
  dyn: [{ type: 'jrod', pivot: [0, 0, 0], build(g, P) { g.cyl(.12, .12, 1, 12, 0, .5, 0, COL.metal); } },
        { type: 'jtop', pivot: [0, 0, 0], build(g, P) { g.chamfer(.48, .1, .48, .02, P, 0, .2, 0); } }] });
defPart({ id: 'piston_s', name: 'Small Piston', cat: 'Moving', mass: 15, hp: 120, buoy: 0.3, attach: 'ends', kind: 'joint', joint: { type: 'piston', force: 30000, travel: .5 }, dc: 4,
  desc: 'A short, quick piston: half a metre of push. Latches, kickers and hopping robots.',
  build(g, P) { g.chamfer(.4, .3, .4, .03, COL.dark, 0, -.1, 0); g.box(.42, .05, .42, 0, -.22, 0, P); },
  dyn: [{ type: 'jrod', pivot: [0, 0, 0], build(g, P) { g.cyl(.07, .07, 1, 10, 0, .5, 0, COL.metal); } },
        { type: 'jtop', pivot: [0, 0, 0], build(g, P) { g.chamfer(.4, .1, .4, .02, P, 0, .2, 0); } }] });
defPart({ id: 'rotor_big', name: 'Big Rotor', cat: 'Moving', mass: 70, hp: 320, buoy: 0.3, attach: 'ends', kind: 'joint', joint: { type: 'rotor', torque: 140000 }, dc: 4,
  desc: 'A heavy turntable with four times the strength. Cranes, big turrets and fairground rides.',
  build(g, P) { g.cyl(.25, .25, .25, 24, 0, -.125, 0, COL.dark); g.cyl(.27, .27, .05, 24, 0, -.2, 0, COL.haz); g.cyl(.2, .2, .06, 18, 0, .02, 0, P); },
  dyn: [{ type: 'jtop', pivot: [0, 0, 0], build(g, P) { g.cyl(.25, .25, .2, 24, 0, .15, 0, P); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; g.cyl(.025, .025, .03, 6, Math.cos(a) * .18, .26, Math.sin(a) * .18, COL.metal); } } }] });
defPart({ id: 'spinner', name: 'Spinner', cat: 'Moving', mass: 25, hp: 140, buoy: 0.3, attach: 'ends', kind: 'joint', joint: { type: 'rotor', torque: 14000, spinner: true }, dc: 4,
  desc: '{spin} switches it on and it keeps spinning what is built on top: windmills, merry-go-rounds and spinning blades.',
  build(g, P) { g.cyl(.25, .25, .25, 22, 0, -.125, 0, COL.dark); g.cyl(.18, .18, .06, 18, 0, .02, 0, COL.haz); },
  dyn: [{ type: 'jtop', pivot: [0, 0, 0], build(g, P) { g.cyl(.24, .24, .18, 22, 0, .16, 0, P); for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; g.box(.2, .02, .05, Math.cos(a) * .12, .255, Math.sin(a) * .12, COL.haz, 0, -a, 0); } } }] });

// Engines and thrusters
defPart({ id: 'hover', name: 'Hover Pad', cat: 'Land', mass: 40, hp: 90, buoy: 0.4, attach: 'base', kind: 'hover', cells: cellsBox(-1, 1, 0, 0, -1, 1), dc: 3,
  desc: 'Floats on a cushion of air up to 2 m over ground or water. Mount pads under the vehicle, facing down. Needs no fuel.',
  build(g, P) { g.chamfer(1.5, .2, 1.5, .08, P, 0, -.15, 0); g.cyl(.62, .66, .14, 24, 0, .02, 0, COL.dark); g.add(new THREE.CircleGeometry(.56, 24), 0x7fe0ff, 0, .095, 0, -Math.PI / 2); for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + Math.PI / 4; g.box(.1, .05, .4, Math.cos(a) * .55, -.02, Math.sin(a) * .55, COL.haz, 0, -a, 0); } } });
defPart({ id: 'outboard', name: 'Outboard Motor', cat: 'Sea', mass: 45, hp: 60, buoy: 0.4, attach: 'base', kind: 'boatprop', thrust: 5000, steer: .55, dc: 1,
  desc: '5 kN, and it turns with the steering keys to steer the boat. Mount it on the back, below the waterline.',
  build(g, P) { g.box(.32, .12, .32, 0, -.19, 0, COL.dark); g.chamfer(.3, .28, .36, .06, P, 0, -.02, .02); g.box(.1, .1, .3, 0, .12, 0, COL.dark); },
  dyn: [{ type: 'spin', pivot: [0, .2, 0], build(g, P) { propGeo(g, .2, 3, COL.copper, .06); } }] });
defPart({ id: 'boat_prop_big', name: 'Big Boat Propeller', cat: 'Sea', mass: 90, hp: 90, buoy: 0.3, attach: 'base', kind: 'boatprop', thrust: 13000, cells: cellsBox(-1, 1, 0, 0, -1, 1), dc: 4,
  desc: '13 kN for ships, tugs and submarines. Pushes forward under water. Mount on a back face.',
  build(g, P) { g.cyl(.2, .26, .32, 14, 0, -.1, 0, COL.dark); g.torus(.6, .06, 0, .16, 0, COL.metal, Math.PI / 2); },
  dyn: [{ type: 'spin', pivot: [0, .16, 0], build(g, P) { propGeo(g, .56, 4, COL.copper, .12); } }] });
defPart({ id: 'heli_big', name: 'Big Helicopter Rotor', cat: 'Air', mass: 360, hp: 260, buoy: 0.3, attach: 'base', kind: 'prop', heli: true, cells: cellsBox(-2, 2, 0, 0, -2, 2), thrust: 42000, dc: 0,
  desc: '42 kN of lift for heavy choppers and sky cranes. Flies itself level like the Helicopter Rotor.',
  build(g, P) { g.cyl(.95, 1.05, .34, 22, 0, -.08, 0, COL.dark); g.cyl(.24, .3, .6, 14, 0, .22, 0, P); },
  dyn: [{ type: 'spin', pivot: [0, .55, 0], build(g, P) { g.cyl(.3, .3, .18, 14, 0, 0, 0, COL.metal); for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; g.add(new THREE.BoxGeometry(4.4, .05, .36), COL.dark, Math.cos(a) * 2.25, 0, -Math.sin(a) * 2.25, .07, a, 0, 1, 1, 1, 'YXZ'); g.box(.4, .055, .37, Math.cos(a) * 4.3, 0, -Math.sin(a) * 4.3, COL.haz, 0, a, 0); } } }] });
defPart({ id: 'plasma', name: 'Plasma Thruster', cat: 'Space', mass: 160, hp: 120, buoy: 0.3, attach: 'base', kind: 'jet', thrust: 6000, any: true, plasma: true, cells: cellsBox(0, 0, 0, 1, 0, 0), nozzle: [0, .8, 0], dc: 6,
  desc: '6 kN that works anywhere: in air, under water and out in space, with no fuel at all. Heavy for what it gives.',
  build(g, P) { g.cyl(.24, .24, .18, 18, 0, -.16, 0, COL.dark); g.cyl(.22, .22, .5, 18, 0, .18, 0, P); for (const y of [.02, .3]) g.torus(.23, .03, 0, y, 0, 0xc78bff, Math.PI / 2); g.cyl(.14, .2, .2, 16, 0, .55, 0, COL.dark); g.cyl(.12, .12, .05, 14, 0, .66, 0, 0xc78bff); },
  dyn: [{ type: 'flame', pivot: [0, .66, 0], len: 1.6, rad: .14, col: 0xc77dff }] });

// Decor and lights
defPart({ id: 'plate_number', name: 'Number Plate', cat: 'Decor', mass: 1, hp: 15, buoy: 0.5, attach: 'base', kind: 'text', text: { w: .9, h: .24, y: -.21, bg: '#f2f0e6', fg: '#15181b', def: 'SCRAP 1', max: 10, border: true }, cells: [[0, 0, 0], [1, 0, 0]], dc: 2,
  desc: 'A number plate with your own text on it (Configure it).',
  build(g, P) { g.box(.96, .04, .3, .25, -.235, 0, COL.dark); },
  dyn: [{ type: 'text', pivot: [.25, -.21, 0] }] });
defPart({ id: 'sign', name: 'Sign', cat: 'Decor', mass: 6, hp: 30, buoy: 0.4, attach: 'base', kind: 'text', text: { w: 1.4, h: .45, y: -.2, def: 'HELLO', max: 16, paint: true }, cells: cellsBox(-1, 1, 0, 0, 0, 0), dc: 6,
  desc: 'A board with your own words on it (Configure it). Its paint colour is the background.',
  build(g, P) { g.box(1.5, .06, .55, 0, -.22, 0, COL.dark); },
  dyn: [{ type: 'text', pivot: [0, -.185, 0] }] });
defPart({ id: 'flag', name: 'Flag', cat: 'Decor', mass: 4, hp: 20, buoy: 0.5, attach: 'base', cells: [[0, 0, 0], [0, 1, 0], [0, 2, 0], [0, 3, 0]], dc: 0,
  desc: 'A flag on a 2 m pole, in its paint colour. Flutters in the wind.',
  build(g, P) { g.cyl(.08, .1, .1, 10, 0, -.2, 0, COL.dark); g.cyl(.03, .03, 2, 8, 0, .75, 0, COL.metal); g.sph(.05, 0, 1.78, 0, COL.haz); },
  dyn: [{ type: 'flag', pivot: [0, 1.5, 0], build(g, P) { for (let i = 0; i < 6; i++) g.box(.15, .5, .015, .075 + i * .15, 0, Math.sin(i * .9) * .04, i % 2 ? P : shade(P, .9)); } }] });
defPart({ id: 'light_color', name: 'Coloured Light', cat: 'Decor', mass: 3, hp: 15, buoy: 0.4, attach: 'base', kind: 'light', dc: 1,
  desc: 'A lamp that glows in its paint colour. Tail lights, indicators and party lights.',
  build(g, P) { g.box(.3, .12, .3, 0, -.19, 0, COL.dark); },
  dyn: [{ type: 'lensc', pivot: [0, -.1, 0], build(g, P) { g.cyl(.12, .12, .05, 16, 0, 0, 0, P); g.sph(.1, 0, .02, 0, P, 1, .5, 1); } }] });
defPart({ id: 'lightbar', name: 'Light Bar', cat: 'Decor', mass: 8, hp: 25, buoy: 0.4, attach: 'base', kind: 'lightbar', cells: cellsBox(-1, 1, 0, 0, 0, 0), dc: 2,
  desc: '{lights} switches on the flashing red and blue lights. Police cars, fire engines and tow trucks.',
  build(g, P) { g.box(1.4, .1, .32, 0, -.2, 0, COL.dark); g.box(.3, .16, .3, 0, -.08, 0, P); },
  dyn: [{ type: 'flashA', pivot: [-.4, -.08, 0], build(g, P) { g.box(.46, .16, .28, 0, 0, 0, 0xff2a2a); } }, { type: 'flashB', pivot: [.4, -.08, 0], build(g, P) { g.box(.46, .16, .28, 0, 0, 0, 0x2a6bff); } },
        { type: 'dimA', pivot: [-.4, -.08, 0], build(g, P) { g.box(.45, .15, .27, 0, 0, 0, 0x5a1414); } }, { type: 'dimB', pivot: [.4, -.08, 0], build(g, P) { g.box(.45, .15, .27, 0, 0, 0, 0x14245a); } }] });
// more seats: the same pilot, different looks
defPart({ id: 'seat_race', name: 'Racing Seat', cat: 'Control', mass: 50, hp: 160, buoy: 0.4, kind: 'seat', dc: 7, desc: 'A bucket seat with a harness. The pilot: every vehicle has exactly one seat.',
  build(g, P) { g.chamfer(.48, .1, .46, .02, COL.dark, 0, -.2, 0); g.chamfer(.44, .5, .1, .03, P, 0, .03, -.19); for (const x of [-.2, .2]) g.box(.06, .22, .4, x, -.06, -.02, P); g.box(.06, .3, .03, -.08, .02, -.13, COL.red); g.box(.06, .3, .03, .08, .02, -.13, COL.red); g.box(.22, .18, .14, 0, -.05, -.07, COL.black); g.sph(.085, 0, .15, -.06, COL.bone); g.sph(.11, 0, .17, -.06, COL.white, 1, .9, 1); } });
defPart({ id: 'seat_saddle', name: 'Saddle', cat: 'Control', mass: 40, hp: 150, buoy: 0.4, kind: 'seat', dc: 2, desc: 'A rider astride: bikes, quads and jet skis. The pilot: every vehicle has exactly one seat.',
  build(g, P) { g.chamfer(.3, .14, .46, .05, P, 0, -.17, 0); g.box(.12, .2, .12, -.16, -.12, .12, COL.dark); g.box(.12, .2, .12, .16, -.12, .12, COL.dark); g.box(.2, .26, .14, 0, -.0, -.02, COL.navy); g.sph(.085, 0, .2, -.01, COL.bone); g.sph(.11, 0, .22, -.01, COL.red, 1, .9, 1); for (const x of [-.13, .13]) g.box(.05, .05, .2, x, .06, .12, COL.navy); } });
defPart({ id: 'seat_cabin', name: 'Cabin', cat: 'Control', mass: 70, hp: 200, buoy: 0.5, kind: 'seat', dc: 0, desc: 'An enclosed driver\'s cab with windows all round. The pilot: every vehicle has exactly one seat.',
  build(g, P) { g.chamfer(.5, .5, .5, .03, P); for (const [w, d, x, z] of [[.4, .02, 0, .251], [.4, .02, 0, -.251], [.02, .36, .251, 0], [.02, .36, -.251, 0]]) g.box(w, .2, d, x, .08, z, 0x9fd3f0); g.sph(.07, 0, .06, 0, COL.bone); } });

const geoCache = new Map();
function pcol(ci) { return new THREE.Color(PALETTE[ci] ? PALETTE[ci].hex : 0x8c99a3); }
function staticGeo(t, ci) { const k = t + '|' + ci; let g = geoCache.get(k); if (!g) { const gb = new GB(); PD[t].build(gb, pcol(ci)); g = gb.geometry(); geoCache.set(k, g); } return g; }
function dynGeo(t, i, ci) { const k = t + '|d' + i + '|' + ci; let g = geoCache.get(k); if (!g) { const gb = new GB(); PD[t].dyn[i].build(gb, pcol(ci)); g = gb.geometry(); geoCache.set(k, g); } return g; }
function flameGeo(len, rad) {
  const k = 'flame|' + len + '|' + rad; let g = geoCache.get(k);
  if (!g) { g = new THREE.ConeGeometry(rad, len, 16, 1, true); g.translate(0, len / 2, 0); geoCache.set(k, g); }
  return g;
}
const MAT = {};
function initMaterials() {
  MAT.veh = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 26, specular: 0x1c1c1c, side: THREE.DoubleSide });
  MAT.hl = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 26, specular: 0x1c1c1c, side: THREE.DoubleSide, emissive: 0x7a1d10 });
  MAT.paint = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 26, specular: 0x1c1c1c, side: THREE.DoubleSide, emissive: 0x2a3e55 });
  MAT.move = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 26, specular: 0x1c1c1c, side: THREE.DoubleSide, emissive: 0x1d5a3c });
  MAT.sel = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 26, specular: 0x1c1c1c, side: THREE.DoubleSide, emissive: 0x0d5b80 });
  MAT.glass = new THREE.MeshPhongMaterial({ color: 0x9fd3f0, transparent: true, opacity: .38, shininess: 90, specular: 0xffffff, depthWrite: false, side: THREE.DoubleSide });
  MAT.lens = new THREE.MeshBasicMaterial({ color: 0xfff1c4 });
  MAT.lensV = new THREE.MeshBasicMaterial({ vertexColors: true });
  MAT.ghostOk = new THREE.MeshBasicMaterial({ color: 0x6fe0a8, transparent: true, opacity: .45, depthWrite: false });
  MAT.ghostBad = new THREE.MeshBasicMaterial({ color: 0xff5a40, transparent: true, opacity: .45, depthWrite: false });
  MAT.ghostMirror = new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: .3, depthWrite: false });
  MAT.terrain = new THREE.MeshLambertMaterial({ vertexColors: true });
  MAT.moon = new THREE.MeshLambertMaterial({ vertexColors: true, fog: false });
  MAT.water = new THREE.MeshPhongMaterial({ color: 0x1f6d8c, specular: 0x9ec9dc, shininess: 85, transparent: true, opacity: .84, depthWrite: false });
  MAT.flames = {};
  MAT.strut = new THREE.MeshPhongMaterial({ color: 0x9aa4aa, shininess: 60 });
  MAT.foot = new THREE.MeshPhongMaterial({ color: 0x3a4148, shininess: 20 });
  MAT.prop = new THREE.MeshPhongMaterial({ color: 0x8b8f8c, shininess: 10 });
  MAT.locked = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 26, specular: 0x1c1c1c, side: THREE.DoubleSide, emissive: 0x6a120a });
  MAT.beam = new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: .13, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  MAT.girderLine = new THREE.LineBasicMaterial({ color: 0xb8c2c8, fog: false, transparent: true, opacity: .8 });
}
function flameMat(col) {
  let m = MAT.flames[col];
  if (!m) { m = MAT.flames[col] = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }); }
  return m;
}
/* leg strut + foot geometries (design frame, pointing down) */
const LEG_STRUT = new THREE.CylinderGeometry(.06, .06, 1, 10); LEG_STRUT.translate(0, -.5, 0);
const LEG_FOOT = new THREE.CylinderGeometry(.22, .26, .1, 16);

/* Full rest-pose object for one part (builder, thumbnails). Returns a Group in part-local space unless designFrame given. */
function partObject(t, ci, M, a, matOverride, cfg) {
  const def = PD[t];
  const root = new THREE.Group();
  const body = new THREE.Group();
  if (M) { body.matrixAutoUpdate = false; body.matrix.copy(m4From(M, a || [0, 0, 0])); }
  root.add(body);
  const om = matOverride || MAT.veh;
  body.add(new THREE.Mesh(staticGeo(t, ci), om));
  def.dyn.forEach((d, i) => {
    if (d.type === 'flame' || d.type === 'chute' || d.type === 'beam' || d.type === 'flashA' || d.type === 'flashB') return;
    if (d.type === 'text') { const m = textMesh(def, ci, cfg, matOverride); m.position.set(d.pivot[0], d.pivot[1], d.pivot[2]); body.add(m); return; }
    const mat = matOverride || (d.type === 'glass' ? MAT.glass : d.type === 'lens' ? MAT.lens : d.type === 'lensc' ? MAT.lensV : MAT.veh);
    const m = new THREE.Mesh(dynGeo(t, i, ci), mat);
    m.position.set(d.pivot[0], d.pivot[1], d.pivot[2]);
    if (d.type === 'jrod') { m.position.y -= 0.15; m.scale.y = 0.35; }
    body.add(m);
  });
  if (def.lattice && def.cells.length > 40) {
    // long girders also draw as a line so they show up from far away
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute([0, -.25, 0, 0, def.cells.length * CELL - .25, 0], 3));
    body.add(new THREE.LineSegments(lg, MAT.girderLine));
  }
  if (def.kind === 'leg') {
    const L = def.leg, ax = (a ? a[0] : 0) * CELL, ay = (a ? a[1] : 0) * CELL, az = (a ? a[2] : 0) * CELL;
    const s = new THREE.Mesh(LEG_STRUT, matOverride || MAT.strut); s.position.set(ax, ay, az); s.scale.y = L.drop; root.add(s);
    const f = new THREE.Mesh(LEG_FOOT, matOverride || MAT.foot); f.position.set(ax, ay - L.drop, az); root.add(f);
  }
  return root;
}
/* a part's own words, on a plane lying on its face (part frame: the face looks along +y) */
const TEXT_GEO = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2).rotateZ(Math.PI);
const TEXT_MAT = new Map();
function textMesh(def, ci, cfg, matOverride) {
  const T = def.text, txt = (cfg && typeof cfg.text === 'string' ? cfg.text : T.def) || ' ';
  const bg = T.paint ? '#' + pcol(ci).getHexString() : T.bg, fg = T.paint ? '#ffffff' : T.fg;
  const key = txt + '|' + bg + '|' + fg + '|' + T.w + 'x' + T.h;
  let mat = matOverride || TEXT_MAT.get(key);
  if (!mat) { mat = new THREE.MeshBasicMaterial({ map: textTexture(txt, { aspect: T.w / T.h, bg, fg, border: T.border !== false }) }); TEXT_MAT.set(key, mat); }
  const m = new THREE.Mesh(TEXT_GEO, mat); m.scale.set(T.w, 1, T.h);
  return m;
}

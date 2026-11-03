'use strict';
/* ================= Scrapline · wrecking: buildings that break, trains that derail =================
   Buildings, towers, street lights and traffic lights are drawn as part of their site's merged mesh, like
   everything else. The first hard knock "wakes" one: its share of the merged mesh is hidden and it is rebuilt
   as a grid of chunks (a shell of block-sized boxes, plus roof pieces), each with its own collider. Crashes,
   blasts and bullets then knock chunks loose; whatever is left with nothing under it falls, and once enough
   is gone the rest comes down in a heap. Loose chunks tumble in the building's own frame (up is y, the
   ground is y = 0) and settle as rubble.
   Trains run on rails by themselves (towns.js) until a hard enough ram, a blast, or something big left on
   the track throws them off: then each car is a heavy box that slides and tumbles to a stop.
   A few minutes later, once you are well away, the building stands again and a fresh train sets out. */
const WRECK = { list: [], active: new Set(), hits: new Map(), trainHits: [], drop: new Set(), mats: null, geo: null, rgeo: null };
const CHUNK_E = 1600;          // energy (J) per cubic metre to knock a chunk loose
const WRECK_BACK = 180;        // seconds before a wrecked building is put back (once you are away)
const TRAIN_BACK = 120;        // seconds before a derailed train is replaced
const DERAIL_J = 5e4;          // a push this hard (N·s) throws a train off its rails
const _wkA = new V3(), _wkB = new V3(), _wkC = new V3(), _wkD = new V3(), _wkQ = new THREE.Quaternion(), _wkM = new THREE.Matrix4(), _wkS = new V3();

/* ---------- registering: called round the code that builds a building ---------- */
function structMark(site) { return site && site.solid ? { s0: site.solid.P.length / 3, g0: site.glow.P.length / 3, p0: W.props.length } : null; }
/* boxes: the building's bulk as boxes in its own frame M ({w, h, d, x, y, z}, y = 0 the ground)
   o: wall, top (colour of the top row), low (colour of the bottom row), roof ({rh, col, over} for a gable),
      pole (a post: no windows, snaps easily), cs (chunk size) */
function structAdd(site, mk, M, boxes, o = {}) {
  if (!mk) return null;
  const st = { site, cel: site.cel, M: M.clone(), Mi: M.clone().invert(), boxes, o, s0: mk.s0, s1: site.solid.P.length / 3, g0: mk.g0, g1: site.glow.P.length / 3,
    cols: W.props.slice(mk.p0), state: 0, t: 0, chip: 0, c: new V3(), r: 0, cells: null };
  for (const c of st.cols) c.st = st;
  // where it is and how big (world-own frame), for blasts and the repair check
  let r = 0; for (const b of boxes) r = Math.max(r, Math.hypot(Math.abs(b.x) + b.w / 2, b.y + b.h / 2, Math.abs(b.z) + b.d / 2));
  if (o.roof) r += o.roof.rh;
  st.c.set(0, (boxes[0].y + boxes[0].h / 2) * 0.5, 0).applyMatrix4(st.M); st.r = r;
  st.cs = o.cs || chunkSize(boxes, o);
  st.cellE = o.pole ? 12000 : CHUNK_E * st.cs * st.cs * st.cs;
  WRECK.list.push(st);
  return st;
}
/* chunk size: about a storey for a house, coarser for big towers so there are never too many */
function chunkSize(boxes, o) {
  if (o.pole) return 2.4;
  let cs = 3.1;
  for (let k = 0; k < 20; k++) { if (shellCount(boxes, cs) <= 520) break; cs *= 1.15; }
  return cs;
}
function shellCount(boxes, cs) {
  let n = 0;
  for (const b of boxes) {
    const nx = Math.max(1, Math.round(b.w / cs)), ny = Math.max(1, Math.round(b.h / cs)), nz = Math.max(1, Math.round(b.d / cs));
    n += nx * nz * ny - Math.max(0, nx - 2) * Math.max(0, nz - 2) * Math.max(0, ny - 1);
  }
  return n;
}

/* ---------- looks: one box and one roof wedge, instanced, with a facade texture ---------- */
function wreckMats() {
  if (WRECK.mats) return WRECK.mats;
  const tex = (wins) => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 64, 64);
    x.fillStyle = '#d9d9d9'; x.fillRect(0, 0, 64, 2); x.fillRect(0, 0, 2, 64); x.fillRect(0, 62, 64, 2); x.fillRect(62, 0, 2, 64);
    x.fillStyle = '#2c3843';
    if (wins === 1) x.fillRect(20, 18, 24, 22);
    if (wins === 4) for (const a of [10, 38]) for (const b of [8, 36]) x.fillRect(a, b, 16, 18);
    const t = new THREE.CanvasTexture(c); t.anisotropy = 2; return t;
  };
  const mk = map => new THREE.MeshPhongMaterial({ map, shininess: 12, specular: 0x111111 });
  WRECK.mats = { one: mk(tex(1)), four: mk(tex(4)), plain: mk(tex(0)) };
  // a unit box whose top and bottom faces show only the plain wall corner of the texture
  const g = new THREE.BoxGeometry(1, 1, 1), uv = g.attributes.uv;
  for (let i = 8; i < 16; i++) uv.setXY(i, 0.5, 0.97);
  WRECK.geo = g;
  // a unit gable centred on its middle: floor 1 × 1 at y = -0.5, ridge along x at y = 0.5
  const V = [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5], [-.5, .5, 0], [.5, .5, 0]];
  const F = [[0, 1, 5, 4], [3, 4, 5, 2], [0, 4, 3], [1, 2, 5], [0, 3, 2, 1]];
  const pos = [], nor = [], uvs = [];
  for (const f of F) {
    const a = new V3(...V[f[0]]), b = new V3(...V[f[1]]), c = new V3(...V[f[2]]), n = new V3().subVectors(b, a).cross(new V3().subVectors(c, a)).normalize();
    for (let i = 1; i < f.length - 1; i++) for (const k of [f[0], f[i], f[i + 1]]) { pos.push(...V[k]); nor.push(n.x, n.y, n.z); uvs.push(0.5, 0.97); }
  }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); rg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  WRECK.rgeo = rg;
  return WRECK.mats;
}

/* ---------- colliders that can come and go ---------- */
function dropCollider(pr) {
  if (pr.off) return; pr.off = true; WRECK.drop.add(pr);
  const ci = CELS.indexOf(pr.cel), s = PG.size, c = pr.c, r = pr.r;
  for (let a = Math.floor((c.x - r) / s); a <= Math.floor((c.x + r) / s); a++)
    for (let b = Math.floor((c.y - r) / s); b <= Math.floor((c.y + r) / s); b++)
      for (let k = Math.floor((c.z - r) / s); k <= Math.floor((c.z + r) / s); k++) {
        const l = PG.map.get(pgKey(ci, a, b, k)); if (!l) continue;
        const j = l.indexOf(pr); if (j >= 0) l.splice(j, 1);
      }
}
function restoreCollider(pr) { if (!pr.off) return; pr.off = false; if (WRECK.drop.has(pr)) WRECK.drop.delete(pr); else W.props.push(pr); pgInsert(pr); }
function flushDropped() {
  if (!WRECK.drop.size) return;
  let j = 0; for (let i = 0; i < W.props.length; i++) { const p = W.props[i]; if (!WRECK.drop.has(p)) W.props[j++] = p; }
  W.props.length = j; WRECK.drop.clear();
}

/* ---------- waking a building: from merged mesh to chunks ---------- */
function hideRange(mesh, a, b) {
  if (!mesh || b <= a) return null;
  const A = mesh.geometry.attributes.position, arr = A.array, save = arr.slice(a * 3, b * 3);
  for (let i = a * 3; i < b * 3; i += 3) { arr[i] = arr[a * 3]; arr[i + 1] = arr[a * 3 + 1]; arr[i + 2] = arr[a * 3 + 2]; }
  A.needsUpdate = true;
  return save;
}
function showRange(mesh, a, save) { if (!mesh || !save) return; const A = mesh.geometry.attributes.position; A.array.set(save, a * 3); A.needsUpdate = true; }
function structWake(st) {
  if (st.state) return;
  const site = st.site; if (!site.meshes) return;
  st.state = 1; st.t = 0; WRECK.active.add(st);
  st.saveS = hideRange(site.meshes.find(m => m.material === MAT.site), st.s0, st.s1);
  st.saveG = hideRange(site.meshes.find(m => m.material === MAT.glow), st.g0, st.g1);
  for (const c of st.cols) dropCollider(c);
  const mats = wreckMats(), o = st.o, cs = st.cs, cells = [], idx = new Map();
  const wall = new THREE.Color(o.wall ?? 0xd8d2c4), top = new THREE.Color(o.top ?? o.wall ?? 0xd8d2c4), low = new THREE.Color(o.low ?? o.wall ?? 0xd8d2c4);
  st.boxes.forEach((B, bi) => {
    const nx = Math.max(1, Math.round(B.w / cs)), ny = Math.max(1, Math.round(B.h / cs)), nz = Math.max(1, Math.round(B.d / cs));
    const cw = B.w / nx, ch = B.h / ny, cd = B.d / nz;
    B.n = [nx, ny, nz];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
      if (!(o.pole || i === 0 || k === 0 || i === nx - 1 || k === nz - 1 || j === ny - 1)) continue;
      const col = (j === ny - 1 && bi === st.boxes.length - 1 ? top : j === 0 && bi === 0 ? low : wall).clone().multiplyScalar(0.94 + Math.random() * 0.1);
      const c = { bi, i, j, k, x: B.x - B.w / 2 + (i + 0.5) * cw, y: B.y - B.h / 2 + (j + 0.5) * ch, z: B.z - B.d / 2 + (k + 0.5) * cd, hx: cw / 2, hy: ch / 2, hz: cd / 2, col, alive: true, roof: false, e: CHUNK_E * cw * ch * cd, dmg: 0, links: [] };
      if (o.pole) c.e = st.cellE;
      idx.set(bi + ',' + i + ',' + j + ',' + k, c); cells.push(c);
    }
  });
  // a gable roof in slices along the ridge, each resting on the top row of wall below it
  const roofs = [];
  if (o.roof) {
    const B = st.boxes[0], [nx, ny, nz] = B.n, cw = B.w / nx, ov = o.roof.over ?? 0.3, rc = new THREE.Color(o.roof.col ?? COLS.roof);
    for (let i = 0; i < nx; i++) {
      const c = { roof: true, bi: 0, i, x: B.x - B.w / 2 + (i + 0.5) * cw, y: B.y + B.h / 2 + (o.roof.rh + 0.4) / 2, z: B.z, hx: cw / 2 + (i === 0 || i === nx - 1 ? ov / 2 : 0), hy: (o.roof.rh + 0.4) / 2, hz: B.d / 2 + ov, col: rc.clone().multiplyScalar(0.95 + Math.random() * 0.08), alive: true, e: CHUNK_E * cw * B.d * o.roof.rh * 0.5, dmg: 0, links: [] };
      if (i === 0) c.x -= ov / 2; if (i === nx - 1) c.x += ov / 2;
      for (let k = 0; k < nz; k++) { const s = idx.get('0,' + i + ',' + (ny - 1) + ',' + k); if (s) c.links.push(s); }
      roofs.push(c);
    }
  }
  // what holds what up: neighbours in the same block, and the block below for a tier's bottom row
  for (const c of cells) {
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const n = idx.get(c.bi + ',' + (c.i + di) + ',' + (c.j + dj) + ',' + (c.k + dk)); if (n) c.links.push(n); }
    const B = st.boxes[c.bi];
    c.ground = c.j === 0 && B.y - B.h / 2 < 0.5;
    if (c.j === 0 && !c.ground) for (const d of cells) {
      if (d.bi === c.bi) continue; const Bd = st.boxes[d.bi];
      if (d.j === Bd.n[1] - 1 && Math.abs(d.y + d.hy - (c.y - c.hy)) < 1.2 && Math.abs(d.x - c.x) < d.hx + 0.01 && Math.abs(d.z - c.z) < d.hz + 0.01) { c.links.push(d); d.links.push(c); }
    }
  }
  st.cells = cells; st.roofs = roofs;
  // draw them: one instanced mesh for the chunks, one for the roof slices, in the building's own frame
  const grp = SITES.groups.get(st.cel);
  const mat = o.pole ? mats.plain : cs > 4.6 ? mats.four : mats.one;
  st.mesh = new THREE.InstancedMesh(WRECK.geo, mat, cells.length);
  st.mesh.castShadow = true; st.mesh.receiveShadow = true; st.mesh.matrixAutoUpdate = false; st.mesh.matrix.copy(st.M); st.mesh.frustumCulled = false;
  cells.forEach((c, n) => { c.n = n; st.mesh.setColorAt(n, c.col); placeChunk(st.mesh, n, c); });
  st.mesh.instanceColor.needsUpdate = true;
  grp.add(st.mesh);
  if (roofs.length) {
    st.rmesh = new THREE.InstancedMesh(WRECK.rgeo, mats.plain, roofs.length);
    st.rmesh.castShadow = true; st.rmesh.receiveShadow = true; st.rmesh.matrixAutoUpdate = false; st.rmesh.matrix.copy(st.M); st.rmesh.frustumCulled = false;
    roofs.forEach((c, n) => { c.n = n; st.rmesh.setColorAt(n, c.col); placeChunk(st.rmesh, n, c); });
    st.rmesh.instanceColor.needsUpdate = true;
    grp.add(st.rmesh);
  }
  // each piece is solid
  for (const c of [...cells, ...roofs]) c.pr = chunkCollider(st, c);
}
function placeChunk(mesh, n, c) {
  _wkM.compose(c.dyn ? c.dyn.p : _wkA.set(c.x, c.y, c.z), c.dyn ? c.dyn.q : _wkQ.identity(), _wkS.set(c.hx * 2, c.hy * 2, c.hz * 2));
  mesh.setMatrixAt(n, _wkM);
}
/* a settled piece of rubble is solid too (low enough for big wheels to climb) */
function rubbleCollider(st, c) {
  const D = c.dyn, V = [];
  for (let i = 0; i < 8; i++) V.push(new V3(i & 4 ? c.hx : -c.hx, i & 2 ? c.hy : -c.hy, i & 1 ? c.hz : -c.hz).applyQuaternion(D.q).add(D.p).applyMatrix4(st.M));
  return makeCollider(V, BOX_F, st.cel, 'rubble');
}
function chunkCollider(st, c) {
  const V = [];
  if (c.roof) {
    const y0 = c.y - c.hy, y1 = c.y + c.hy;
    for (const p of [[-c.hx, y0, -c.hz], [c.hx, y0, -c.hz], [c.hx, y0, c.hz], [-c.hx, y0, c.hz], [-c.hx, y1, 0], [c.hx, y1, 0]]) V.push(new V3(c.x + p[0], p[1], c.z + p[2]).applyMatrix4(st.M));
    const pr = makeCollider(V, [[0, 1, 2, 3], [0, 1, 5, 4], [3, 2, 5, 4], [0, 3, 4], [1, 2, 5]], st.cel, 'chunk');
    pr.st = st; pr.chunk = c; return pr;
  }
  for (let i = 0; i < 8; i++) V.push(new V3(c.x + (i & 4 ? c.hx : -c.hx), c.y + (i & 2 ? c.hy : -c.hy), c.z + (i & 1 ? c.hz : -c.hz)).applyMatrix4(st.M));
  const pr = makeCollider(V, BOX_F, st.cel, 'chunk');
  pr.st = st; pr.chunk = c; return pr;
}

/* ---------- breaking ---------- */
/* knock loose the chunks nearest p (building frame) that energy E can break; returns the energy used */
function breakNear(st, p, E, dir, push, radius = Infinity, outK = 0.4) {
  if (!st.cells) return 0;
  const all = [...st.cells, ...st.roofs].filter(c => c.alive);
  for (const c of all) c._d = Math.hypot(Math.max(0, Math.abs(p.x - c.x) - c.hx), Math.max(0, Math.abs(p.y - c.y) - c.hy), Math.max(0, Math.abs(p.z - c.z) - c.hz));
  all.sort((a, b) => a._d - b._d);
  let used = 0; const broke = [];
  const reach = all.length ? Math.min(radius, all[0]._d + st.cs * 2.5) : 0;
  for (const c of all) {
    if (c._d > reach) break;
    const need = Math.max(0, c.e - c.dmg);
    // one it cannot break takes some of the blow; the next one along may still go
    if (E < need) { c.dmg += E * 0.3; continue; }
    E -= need; used += need; broke.push(c);
    if (broke.length > 60) break;
  }
  if (broke.length) loosen(st, broke, p, dir, push, outK);
  return used;
}
function loosen(st, list, from, dir, push, outK = 0.4) {
  for (const c of list) {
    if (!c.alive) continue;
    c.alive = false;
    if (c.pr) { dropCollider(c.pr); c.pr = null; }
    const out = _wkB.set(c.x - from.x, c.y - from.y, c.z - from.z); const l = out.length() || 1; out.divideScalar(l);
    const v = new V3().copy(dir).multiplyScalar(push * (0.6 + Math.random() * 0.6)).addScaledVector(out, push * outK);
    v.x += (Math.random() - 0.5) * 2; v.y += Math.random() * 2; v.z += (Math.random() - 0.5) * 2;
    startFall(st, c, v);
  }
  settleSupport(st, dir);
  st.t = 0;
  dust(st, from, list.length);
}
function startFall(st, c, v) {
  c.alive = false;
  c.dyn = { p: new V3(c.x, c.y, c.z), v, q: new THREE.Quaternion(), w: new V3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3), rest: 0 };
  (st.moving || (st.moving = new Set())).add(c);
}
/* anything no longer joined to the ground falls; past a point, the whole thing comes down */
function settleSupport(st, dir) {
  const all = [...st.cells, ...st.roofs];
  for (const c of all) c._k = false;
  const stack = [];
  for (const c of st.cells) if (c.alive && c.ground) { c._k = true; stack.push(c); }
  while (stack.length) { const c = stack.pop(); for (const n of c.links) if (n.alive && !n._k && !n.roof) { n._k = true; stack.push(n); } }
  for (const r of st.roofs) if (r.alive && r.links.some(n => n._k)) r._k = true;
  const alive = all.filter(c => c.alive), total = all.length;
  const gone = total - alive.length;
  const base = st.cells.filter(c => c.ground), baseLeft = base.filter(c => c.alive).length;
  const collapse = !st.o.pole && (gone / total > 0.42 || baseLeft < base.length * 0.35);
  let fell = 0;
  for (const c of alive) {
    if (c._k && !collapse) continue;
    if (c.pr) { dropCollider(c.pr); c.pr = null; }
    // lean away from the blow, more the higher up it is, as it goes
    const k = Math.min(1, c.y / 30), v = new V3().copy(dir).multiplyScalar((collapse ? 1.5 : 3) * k + Math.random() * 0.5);
    v.x += (Math.random() - 0.5) * 1.2; v.z += (Math.random() - 0.5) * 1.2;
    startFall(st, c, v); fell++;
    // a post topples over the way it was hit, its top swinging fastest
    if (st.o.pole) { c.dyn.v.copy(dir).multiplyScalar(0.8 * c.y + 0.5); c.dyn.w.set(dir.z, 0, -dir.x).multiplyScalar(1.3); }
  }
  if (collapse && st.state === 1) {
    st.state = 2;
    if (typeof SND !== 'undefined') SND.at('rubble', fromSpin(st.cel, st.c, _wkD).add(st.cel.center), clamp(st.r / 40, 0.5, 1.6));
  } else if (fell > 2 && typeof SND !== 'undefined') SND.at('rubble', fromSpin(st.cel, st.c, _wkD).add(st.cel.center), 0.5);
}
function dust(st, p, n) {
  if (typeof FX === 'undefined' || !n) return;
  _wkD.copy(p).applyMatrix4(st.M); fromSpin(st.cel, _wkD, _wkD).add(st.cel.center);
  FX.cel = st.cel;
  for (let i = 0; i < Math.min(3, Math.ceil(n / 3)); i++) FX.puff(_wkD);
  if (typeof SND !== 'undefined') SND.at('crash', _wkD, clamp(0.3 + n * 0.08, 0.3, 1));
}

/* ---------- what hits them (called from physics and weapons) ---------- */
/* a vehicle point touching a building's collider or one of its chunks */
function structTouch(b, pr, pw, pl, n, sv) {
  if (b.diorama) return;   // (the title screen's parked vehicles never wreck anything)
  b.velAt(pw, _wkC).sub(sv);
  const vn = -_wkC.dot(n); if (vn < 3) return;
  let h = WRECK.hits.get(b);
  if (!h || h.vn < vn) { if (!h) WRECK.hits.set(b, h = { p: new V3(), n: new V3() }); h.st = pr.st; h.vn = vn; h.p.copy(pl); h.n.copy(n); }
}
/* a vehicle touching a train car */
function trainTouch(b, pr, pw, n, sv) {
  if (!pr.tr || b.diorama) return;
  b.velAt(pw, _wkC).sub(sv);
  const vn = -_wkC.dot(n); if (vn < 4) return;
  let m = 0; for (const o of machineOf(b)) m += o.mass;
  const J = Math.min(m, 8e4) * vn; if (J < DERAIL_J * 0.5) return;
  WRECK.trainHits.push({ tr: pr.tr, car: pr, J, n: n.clone() });
}
/* an explosion: chunks near it fly, train cars near it come off */
function wreckBlast(e) {
  for (const st of WRECK.list) {
    const cel = st.cel; toSpin(cel, _wkD.subVectors(e.pos, cel.center), _wkD);
    if (_wkD.distanceTo(st.c) > st.r + e.radius) continue;
    const p = _wkA.copy(_wkD).applyMatrix4(st.Mi);
    if (!st.state) {
      // a blast right against it wakes it; only then do its pieces count
      const inside = st.boxes.some(B => Math.abs(p.x - B.x) < B.w / 2 + e.radius * 0.8 && Math.abs(p.z - B.z) < B.d / 2 + e.radius * 0.8 && p.y < B.y + B.h / 2 + e.radius * 0.8);
      if (!inside) continue;
      structWake(st);
    }
    breakNear(st, p.clone(), e.power * 2800, new V3(0, 0.25, 0), 9, e.radius * 0.9, 1);
  }
  for (const tr of TRAIN.list) for (const c of tr.cars) {
    toSpin(PLANET, _wkD.subVectors(e.pos, PLANET.center), _wkD);
    const d = _wkD.distanceTo(c.c), R = e.radius + Math.max(c.hy, c.hz) + 1;
    if (d > R) continue;
    const f = 1 - d / R; if (f < 0.25) continue;
    const away = _wkB.subVectors(c.c, _wkD).normalize();
    derailTrain(tr, c, away.multiplyScalar(e.power * f / 28).addScaledVector(c.Y, 2.5));
  }
}
/* a bullet: chips build up until a chunk gives */
function wreckChip(pr, posW, dmg) {
  const st = pr.st; if (!st) return;
  const cel = st.cel, E = dmg * 700;
  const p = toSpin(cel, _wkD.subVectors(posW, cel.center), _wkD).applyMatrix4(st.Mi).clone();
  if (!st.state) { st.chip += E; if (st.chip < st.cellE * 0.6) return; const Ec = Math.max(st.chip, st.cellE); st.chip = 0; structWake(st); breakNear(st, p, Ec, new V3(), 2); return; }
  const c = pr.chunk; if (!c || !c.alive) return;
  c.dmg += E; st.t = 0;
  if (c.dmg >= c.e) loosen(st, [c], p, new V3(), 2);
}

/* street lights and traffic lights are too thin for a vehicle's contact points to be sure of hitting:
   anything moving that passes over one knocks it flat */
const _psL = new V3(), _psV = new V3();
function poleSweep() {
  for (const b of W.bodies) {
    if (b.asleep || b.dead || b.dock || b.diorama || b.mass < 250 || !b.groundCel) continue;
    const cel = b.groundCel; if (!PG.cels.includes(cel)) continue;
    surfaceVel(cel, b.x, _psV); _psV.subVectors(b.v, _psV); const sp = _psV.length(); if (sp < 4) continue;
    toSpin(cel, _psL.subVectors(b.x, cel.center), _psL);
    const reach = b.radius * 0.6 + 0.3;
    pgQuery(cel, _psL, reach + 1, pr => {
      const st = pr.st; if (!st || !st.o.pole || st.state || WRECK.hits.has(b)) return;
      const O = _wkA.setFromMatrixPosition(st.M), Y = _wkB.setFromMatrixColumn(st.M, 1);
      const t = clamp(_wkC.subVectors(_psL, O).dot(Y), 0, st.boxes[0].h);
      if (_wkC.subVectors(_psL, O).addScaledVector(Y, -t).length() > reach) return;
      WRECK.hits.set(b, { st, vn: sp, p: O.clone().addScaledVector(Y, Math.min(t, 1)), n: _psV.clone().divideScalar(-sp), pole: true });
    });
  }
}
/* ---------- every physics step ---------- */
function wreckStep(dt) {
  poleSweep();
  // crashes into buildings: break what the blow can, and let the vehicle carry on through with what is left
  if (WRECK.hits.size) {
    for (const [b, h] of WRECK.hits) {
      const st = h.st; if (b.dead) continue;
      const E = 0.5 * Math.min(b.mass, 6e4) * h.vn * h.vn;
      if (E < st.cellE * 0.6) continue;
      if (!st.state) structWake(st);
      const p = _wkA.copy(h.p).applyMatrix4(st.Mi).clone();
      const nl = toSpin(st.cel, _wkB.copy(h.n), _wkB).transformDirection(st.Mi).clone().negate();   // into the wall, building frame
      if (h.pole) { const base = st.cells.filter(c => c.alive).sort((a, b) => a.y - b.y)[0]; if (base) loosen(st, [base], p, nl, h.vn * 0.5); continue; }
      const used = breakNear(st, p.addScaledVector(nl, 0.3), E, nl, h.vn * 0.55);
      if (used > 0) {
        const keep = Math.sqrt(clamp(1 - used / E, 0, 1)) * 0.85;
        b.v.addScaledVector(h.n, -h.vn * keep);
        b.wake();
      }
    }
    WRECK.hits.clear();
  }
  // rams and blocked tracks
  if (WRECK.trainHits.length) {
    for (const h of WRECK.trainHits) if (h.J > DERAIL_J || (h.tr.off && h.J > DERAIL_J * 0.5)) {
      const dl = toSpin(PLANET, h.n.clone().negate(), new V3());
      derailTrain(h.tr, h.car, dl.multiplyScalar(h.J / 2.5e4).addScaledVector(h.car.Y, 1.5));
    }
    WRECK.trainHits.length = 0;
  }
  // falling chunks
  for (const st of WRECK.active) {
    st.t += dt;
    if (st.moving && st.moving.size) {
      const g = st.cel.mu / (st.cel.R * st.cel.R);
      for (const c of st.moving) {
        const D = c.dyn;
        D.v.y -= g * dt; D.p.addScaledVector(D.v, dt);
        const wl = D.w.length();
        if (wl > 1e-4) { _wkQ.setFromAxisAngle(_wkB.copy(D.w).divideScalar(wl), wl * dt); D.q.premultiply(_wkQ); }
        // how far the piece reaches down from its centre, as it is turned
        _wkM.makeRotationFromQuaternion(D.q); const m = _wkM.elements;
        const ey = Math.abs(m[1]) * c.hx + Math.abs(m[5]) * c.hy + Math.abs(m[9]) * c.hz;
        if (D.p.y - ey < 0) {
          // a hard landing breaks a chunk up into a low slab of rubble
          if (D.v.y < -5 && !c.crumbled) { c.crumbled = true; c.hy *= 0.42; c.hx *= 0.92; c.hz *= 0.92; }
          D.p.y = ey;
          if (D.v.y < 0) D.v.y = -D.v.y * 0.22;
          D.v.x *= 0.82; D.v.z *= 0.82; D.w.multiplyScalar(0.8);
          // slow enough: it tips over onto its nearest flat side
          if (D.v.lengthSq() < 9) {
            const k = Math.abs(m[1]) > Math.abs(m[5]) ? (Math.abs(m[1]) > Math.abs(m[9]) ? 0 : 2) : (Math.abs(m[5]) > Math.abs(m[9]) ? 1 : 2);
            const ax = _wkB.set(m[k * 4], m[k * 4 + 1], m[k * 4 + 2]); if (ax.y < 0) ax.negate();
            _wkQ.setFromUnitVectors(ax.normalize(), _wkC.set(0, 1, 0)).multiply(D.q); D.q.slerp(_wkQ, 0.25); D.w.multiplyScalar(0.6);
          }
          if (D.v.lengthSq() < 0.09 && D.w.lengthSq() < 0.05) { D.rest += dt; if (D.rest > 0.4) { D.v.set(0, 0, 0); D.w.set(0, 0, 0); st.moving.delete(c); c.rpr = rubbleCollider(st, c); } }
        }
        placeChunk(c.roof ? st.rmesh : st.mesh, c.n, c);
      }
      st.mesh.instanceMatrix.needsUpdate = true; if (st.rmesh) st.rmesh.instanceMatrix.needsUpdate = true;
    }
  }
  // derailed trains
  for (const tr of TRAIN.list) if (tr.off) trainWreckStep(tr, dt);
  flushDropped();
}
/* every frame: show and hide with the site; put things back once enough time has passed and you are away */
function wreckFrame(dt) {
  if (!WRECK.active.size && !TRAIN.list.some(t => t.off)) return;
  for (const st of WRECK.active) {
    const vis = st.site.vis !== false;
    if (st.mesh.visible !== vis) { st.mesh.visible = vis; if (st.rmesh) st.rmesh.visible = vis; }
    if (st.t < WRECK_BACK) continue;
    toSpin(st.cel, _wkD.subVectors(camera.position, st.cel.center), _wkD);
    if (_wkD.distanceTo(st.c) > 700 + st.r) structRepair(st);
  }
  for (const tr of TRAIN.list) {
    if (!tr.off || tr.off.t < TRAIN_BACK) continue;
    toSpin(PLANET, _wkD.subVectors(camera.position, PLANET.center), _wkD);
    if (tr.cars.every(c => _wkD.distanceTo(c.c) > 800)) trainReturn(tr);
  }
}
function structRepair(st) {
  for (const c of [...st.cells, ...st.roofs]) { if (c.pr) dropCollider(c.pr); if (c.rpr) dropCollider(c.rpr); }
  flushDropped();
  for (const m of [st.mesh, st.rmesh]) if (m) { m.parent && m.parent.remove(m); m.dispose && m.dispose(); }
  const site = st.site;
  showRange(site.meshes.find(m => m.material === MAT.site), st.s0, st.saveS);
  showRange(site.meshes.find(m => m.material === MAT.glow), st.g0, st.saveG);
  for (const c of st.cols) restoreCollider(c);
  st.mesh = st.rmesh = null; st.cells = st.roofs = null; st.moving = null; st.state = 0; st.t = 0; st.chip = 0;
  WRECK.active.delete(st);
}
/* everything back as it was (a fresh world, or the title screen) */
function wreckResetAll() {
  for (const st of [...WRECK.active]) structRepair(st);
  for (const tr of TRAIN.list) if (tr.off) trainReturn(tr);
}

/* ---------- trains off the rails ---------- */
const CAR_MASS = { loco: 60000, coach: 38000, flat: 22000 };
function derailTrain(tr, hitCar, kick) {
  if (tr.off) { const d = hitCar.dyn; if (d && kick) { d.v.add(kick.clone().multiplyScalar(0.4)); d.sleep = false; d.rest = 0; } return; }
  tr.off = { t: 0 };
  tr.v = 0;
  tr.cars.forEach((c, i) => {
    const m = CAR_MASS[c.kind] || 30000, hx = c.hx, hy = c.hy, hz = c.hz;
    c.dyn = { m, I: [m * (hy * hy + hz * hz) / 3, m * (hx * hx + hz * hz) / 3, m * (hx * hx + hy * hy) / 3], v: c.mv.clone(), w: new V3(), rest: 0 };
    // each one slews off its own way and some roll, so they fold up rather than slide off in a row
    const sp = c.mv.length(), side = (i % 2 ? 1 : -1) * (Math.random() < 0.2 ? -1 : 1);
    c.dyn.v.addScaledVector(c.Z, side * (1.2 + Math.random() * 1.5 + sp * 0.12)).addScaledVector(c.Y, 0.4 + Math.random() * 0.6);
    c.dyn.w.copy(c.Y).multiplyScalar(side * (0.15 + Math.random() * 0.25 + sp * 0.01)).addScaledVector(c.X, -side * (0.2 + Math.random() * 0.5) * Math.min(1, sp / 15));
  });
  if (kick) { hitCar.dyn.v.add(kick); hitCar.dyn.w.addScaledVector(hitCar.X, (Math.random() - 0.5) * 0.8).addScaledVector(hitCar.Y, (Math.random() - 0.5) * 0.6); }
  if (typeof SND !== 'undefined') SND.at('crash', fromSpin(PLANET, hitCar.c, _wkD).add(PLANET.center), 1);
  if (G && G.mode === 'drive') { toSpin(PLANET, _wkD.subVectors(camera.position, PLANET.center), _wkD); if (_wkD.distanceTo(hitCar.c) < 600) toast(`The ${tr.line.name} train is off the rails!`, 2600); }
}
const _cw1 = new V3(), _cw2 = new V3(), _cw3 = new V3(), _cw4 = new V3(), _cw5 = new V3();
function trainWreckStep(tr, dt) {
  tr.off.t += dt;
  const g = PLANET.mu / (PLANET.R * PLANET.R);
  for (const c of tr.cars) {
    const D = c.dyn; if (!D) continue;
    if (D.sleep) { c.mv.set(0, 0, 0); c.mw.set(0, 0, 0); continue; }
    const up = _cw1.copy(c.c).normalize();
    D.v.addScaledVector(up, -g * dt);
    // corners against the ground (and anything fixed: platforms, bridge decks, the rails)
    let touching = 0;
    for (let k = 0; k < 8; k++) {
      const p = _cw2.copy(c.c).addScaledVector(c.X, k & 1 ? c.hx : -c.hx).addScaledVector(c.Y, k & 2 ? c.hy : -c.hy).addScaledVector(c.Z, k & 4 ? c.hz : -c.hz);
      const o = fromSpin(PLANET, _cw3.copy(p).addScaledVector(up, 0.9), _cw3).add(PLANET.center), dn = fromSpin(PLANET, _cw4.copy(up).negate(), _cw4);
      const hit = groundRay(o, dn, 1.8, false, true); if (!hit) continue;
      const pen = 0.9 - hit.t; if (pen <= 0) continue;
      touching++;
      const n = toSpin(PLANET, _cw5.copy(hit.n), _cw5);
      const r = _cw4.subVectors(p, c.c);
      const vp = _cw3.crossVectors(D.w, r).add(D.v), vn = vp.dot(n);
      if (vn < 0) {
        const rn = new V3().crossVectors(r, n), k1 = 1 / D.m + n.dot(new V3().crossVectors(carIinv(c, rn), r));
        const j = -1.15 * vn / k1;
        carImpulse(c, n, j, r);
        // friction: steel on dirt, it slides to a stop
        const vt = _cw3.crossVectors(D.w, r).add(D.v); vt.addScaledVector(n, -vt.dot(n));
        const vtl = vt.length();
        if (vtl > 1e-3) { const jt = Math.min(0.55 * j, vtl * D.m * 0.3); carImpulse(c, vt.divideScalar(-vtl), jt, r); }
      }
      c.c.addScaledVector(n, pen * 0.25);
    }
    // move and turn
    c.c.addScaledVector(D.v, dt);
    const wl = D.w.length();
    if (wl > 1e-5) { const ax = _cw2.copy(D.w).divideScalar(wl), a = wl * dt; c.X.applyAxisAngle(ax, a); c.Y.applyAxisAngle(ax, a); }
    c.X.normalize(); c.Y.addScaledVector(c.X, -c.Y.dot(c.X)).normalize(); c.Z.crossVectors(c.X, c.Y);
    if (touching) D.w.multiplyScalar(Math.exp(-dt * 0.8));
    // asleep once it has stopped
    if (D.v.lengthSq() < 0.04 && D.w.lengthSq() < 0.003 && touching) { D.rest += dt; if (D.rest > 1.5) { D.sleep = true; D.v.set(0, 0, 0); D.w.set(0, 0, 0); } } else D.rest = 0;
    c.mv.copy(D.v); c.mw.copy(D.w);
    c.base.copy(c.c).addScaledVector(c.Y, -(c.h0 + c.hy));
    carPlanes(c);
  }
  // the cars push apart where they run into each other
  for (let i = 0; i + 1 < tr.cars.length; i++) {
    const a = tr.cars[i], b = tr.cars[i + 1]; if (!a.dyn || !b.dyn) continue;
    const d = _cw1.subVectors(b.c, a.c), l = d.length(), min = (a.hx + b.hx) * 0.85;
    if (l < min && l > 1e-3) {
      d.divideScalar(l); const push = (min - l) * 0.5;
      a.c.addScaledVector(d, -push); b.c.addScaledVector(d, push);
      const rv = _cw2.subVectors(b.dyn.v, a.dyn.v).dot(d);
      if (rv < 0) { const j = -rv / (1 / a.dyn.m + 1 / b.dyn.m); a.dyn.v.addScaledVector(d, -j / a.dyn.m); b.dyn.v.addScaledVector(d, j / b.dyn.m); a.dyn.sleep = b.dyn.sleep = false; }
    }
  }
}
function carIinv(c, v) { const I = c.dyn.I; return new V3().addScaledVector(c.X, c.X.dot(v) / I[0]).addScaledVector(c.Y, c.Y.dot(v) / I[1]).addScaledVector(c.Z, c.Z.dot(v) / I[2]); }
function carImpulse(c, n, j, r) { const D = c.dyn; D.v.addScaledVector(n, j / D.m); D.w.add(carIinv(c, new V3().crossVectors(r, n).multiplyScalar(j))); }
/* the car's collider planes from where it is */
function carPlanes(c) {
  const pl = c.planes, ax = [c.X, c.Y, c.Z], hh = [c.hx, c.hy, c.hz];
  for (let a = 0; a < 3; a++) for (let sg = 0; sg < 2; sg++) {
    const p = pl[a * 2 + sg], v = ax[a], k = sg ? -1 : 1;
    p.nx = v.x * k; p.ny = v.y * k; p.nz = v.z * k; p.d = (v.x * c.c.x + v.y * c.c.y + v.z * c.c.z) * k + hh[a];
  }
}
/* a fresh train sets out from the station it last stopped at */
function trainReturn(tr) {
  tr.off = null; tr.v = 0; tr.s = tr.stops[tr.k]; tr.dwell = 15;
  for (const c of tr.cars) { c.dyn = null; c.prevC = null; }
  trainPose(tr, 0);
}

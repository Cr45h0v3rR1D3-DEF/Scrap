'use strict';
/* ================= Scrapline · wrecking: buildings that come down, trains that derail =================
   Buildings, towers, street lights and traffic lights are drawn as part of their site's merged mesh, like
   everything else. One big enough hit (a hard crash, or a blast against it) brings a building down: its share of
   the merged mesh is lifted out into a mesh of its own, which sinks into the ground with a lurch toward the blow
   while dust billows out round its foot, and a rubble pile rises in its place (solid: you can drive up onto it).
   A post or a light is simply knocked flat. Smaller hits do nothing.
   Trains run on rails by themselves (towns.js) until a hard enough ram, a blast, or something big left on
   the track throws them off: then each car is a heavy box that slides and tumbles to a stop.
   A few minutes later, once you are well away, the building stands again and a fresh train sets out. */
const WRECK = { list: [], active: new Set(), hits: new Map(), trainHits: [], drop: new Set() };
const WRECK_BACK = 180;        // seconds before a wrecked building is put back (once you are away)
const TRAIN_BACK = 120;        // seconds before a derailed train is replaced
const DERAIL_J = 5e4;          // a push this hard (N·s) throws a train off its rails
const BLAST_E = 6000;          // a blast's power, in J of hit per unit, right against a wall
const _wkA = new V3(), _wkB = new V3(), _wkC = new V3(), _wkD = new V3(), _wkQ = new THREE.Quaternion(), _wkM = new THREE.Matrix4(), _wkM2 = new THREE.Matrix4(), _wkS = new V3();

/* ---------- registering: called round the code that builds a building ---------- */
function structMark(site) { return site && site.solid ? { s0: site.solid.P.length / 3, g0: site.glow.P.length / 3, p0: W.props.length } : null; }
/* boxes: the building's bulk as boxes in its own frame M ({w, h, d, x, y, z}, y = 0 the ground)
   o: wall (colour), roof ({rh, col} for a gable), pole (a post or a light: it is knocked flat, not piled up) */
function structAdd(site, mk, M, boxes, o = {}) {
  if (!mk) return null;
  const st = { site, cel: site.cel, M: M.clone(), Mi: M.clone().invert(), boxes, o, s0: mk.s0, s1: site.solid.P.length / 3, g0: mk.g0, g1: site.glow.P.length / 3,
    cols: W.props.slice(mk.p0), state: 0, t: 0, blast: 0, blastT: 0, c: new V3(), r: 0 };
  for (const c of st.cols) c.st = st;
  let r = 0, vol = 0, top = 0;
  for (const b of boxes) { r = Math.max(r, Math.hypot(Math.abs(b.x) + b.w / 2, b.y + b.h / 2, Math.abs(b.z) + b.d / 2)); vol += b.w * b.h * b.d; top = Math.max(top, b.y + b.h / 2); }
  if (o.roof) { r += o.roof.rh; top += o.roof.rh; }
  st.c.set(0, top * 0.5, 0).applyMatrix4(st.M); st.r = r; st.top = top;
  // how big a hit brings it down: a house falls to a car at highway speed or a cannon shell, a shop or a
  // warehouse needs a heavy truck or a bomb, a tower block a bomb right against it, a skyscraper a crashing rocket
  st.need = o.pole ? 1.5e4 : Math.max(1.5e5, 3000 * Math.pow(vol, 0.75));
  WRECK.list.push(st);
  return st;
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

/* ---------- lifting a building out of its site's merged mesh ---------- */
function siteMesh(site, mat) { return site.meshes && site.meshes.find(m => m.material === mat); }
/* copy vertices a..b of a merged mesh into a mesh of their own, and squash them out of the merged one */
function liftRange(mesh, a, b) {
  if (!mesh || b <= a) return null;
  const G = mesh.geometry, g = new THREE.BufferGeometry(), saves = {};
  for (const name of Object.keys(G.attributes)) {
    const A = G.attributes[name], k = A.itemSize;
    g.setAttribute(name, new THREE.Float32BufferAttribute(A.array.slice(a * k, b * k), k));
  }
  const P = G.attributes.position, arr = P.array; saves.pos = arr.slice(a * 3, b * 3);
  for (let i = a * 3; i < b * 3; i += 3) { arr[i] = arr[a * 3]; arr[i + 1] = arr[a * 3 + 1]; arr[i + 2] = arr[a * 3 + 2]; }
  P.needsUpdate = true;
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mesh.material); m.castShadow = mesh.castShadow; m.receiveShadow = true; m.matrixAutoUpdate = false; m.frustumCulled = false;
  return { mesh: m, save: saves.pos, a };
}
function putBack(mesh, lift) { if (!mesh || !lift) return; const P = mesh.geometry.attributes.position; P.array.set(lift.save, lift.a * 3); P.needsUpdate = true; }

/* ---------- the rubble pile: a low mound with broken slabs and beams on it, in the building's colours ---------- */
function rubbleGeo(st) {
  const g = new GB(), o = st.o, rng = mulberry32((st.s0 * 7919 + st.g0) >>> 0);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of st.boxes) { x0 = Math.min(x0, b.x - b.w / 2); x1 = Math.max(x1, b.x + b.w / 2); z0 = Math.min(z0, b.z - b.d / 2); z1 = Math.max(z1, b.z + b.d / 2); }
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // as high as a fifth of the building, never a mountain
  const H = st.rh = clamp(st.top * 0.2, 1.4, 4 + Math.sqrt(st.top) * 0.9);
  const W2 = w * 0.58 + 1.5, D2 = d * 0.58 + 1.5, w2 = w * 0.18, d2 = d * 0.18;
  st.pile = { cx, cz, W2, D2, w2, d2, H };
  const wall = new THREE.Color(o.wall ?? 0xd8d2c4), dusty = new THREE.Color(0x8b8378), roofc = new THREE.Color(o.roof ? o.roof.col : 0x6b6f73);
  const mix = (c, k) => c.clone().lerp(dusty, k).multiplyScalar(0.85 + rng() * 0.2).getHex();
  // the mound
  g.poly({ V: [[-W2, 0, -D2], [W2, 0, -D2], [W2, 0, D2], [-W2, 0, D2], [-w2, H, -d2], [w2, H, -d2], [w2, H, d2], [-w2, H, d2]],
    F: [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]] }, mix(wall, 0.55), cx, 0, cz);
  // slabs, lumps and the odd beam lying on it
  const n = Math.round(clamp(w * d / 9, 10, 70));
  for (let i = 0; i < n; i++) {
    const u = (rng() * 2 - 1), v = (rng() * 2 - 1), k = 1 - Math.max(Math.abs(u), Math.abs(v));
    const x = cx + u * (W2 - 0.6), z = cz + v * (D2 - 0.6), y = H * k * 0.92;
    const s = 0.6 + rng() * Math.min(2.6, 0.4 + Math.sqrt(st.top) * 0.35), kind = rng();
    const col = o.roof && rng() < 0.3 ? mix(roofc, 0.25) : mix(wall, 0.15 + rng() * 0.4);
    if (kind < 0.12) g.box(s * 2.6, 0.25, 0.25, x, y + 0.15, z, 0x5a5650, rng() * 0.5, rng() * TAU, rng() * 0.5);
    else g.box(s * (0.8 + rng()), s * (0.3 + rng() * 0.4), s * (0.8 + rng()), x, y + s * 0.15, z, col, (rng() - 0.5) * 0.9, rng() * TAU, (rng() - 0.5) * 0.9);
  }
  return g.geometry();
}
function rubbleCollider(st) {
  const P = st.pile, V = [[-P.W2, -0.3, -P.D2], [P.W2, -0.3, -P.D2], [P.W2, -0.3, P.D2], [-P.W2, -0.3, P.D2], [-P.w2, P.H, -P.d2], [P.w2, P.H, -P.d2], [P.w2, P.H, P.d2], [-P.w2, P.H, P.d2]]
    .map(p => new V3(p[0] + P.cx, p[1], p[2] + P.cz).applyMatrix4(st.M));
  return makeCollider(V, [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]], st.cel, 'rubble');
}

/* ---------- bringing it down ---------- */
/* dir: which way the blow pushed, in the building's own frame */
function structFall(st, dir) {
  if (st.state || !st.site.meshes) return;
  st.state = 1; st.t = 0; WRECK.active.add(st);
  const site = st.site, grp = SITES.groups.get(st.cel);
  st.lift = liftRange(siteMesh(site, MAT.site), st.s0, st.s1);
  st.liftG = liftRange(siteMesh(site, MAT.glow), st.g0, st.g1);
  for (const L of [st.lift, st.liftG]) if (L) grp.add(L.mesh);
  for (const c of st.cols) dropCollider(c);
  // the building's frame relative to the site's mesh origin (where the merged mesh's vertices are measured from)
  st.L = st.M.clone(); st.L.elements[12] -= site.O.x; st.L.elements[13] -= site.O.y; st.L.elements[14] -= site.O.z; st.Li = st.L.clone().invert();
  const dl = Math.hypot(dir.x, dir.z) > 1e-3 ? new V3(dir.x, 0, dir.z).normalize() : new V3(1, 0, 0).applyAxisAngle(new V3(0, 1, 0), Math.random() * TAU);
  st.axis = new V3(dl.z, 0, -dl.x);    // it leans over toward where the blow was going
  if (st.o.pole) { st.dur = 1.1 + st.top * 0.06; st.lean = Math.PI / 2 - 0.06; }
  else {
    st.dur = clamp(1.6 + st.top * 0.028, 1.8, 5.5); st.lean = clamp(0.16 - st.top * 0.0006, 0.06, 0.16);
    st.pileMesh = new THREE.Mesh(rubbleGeo(st), MAT.site); st.pileMesh.castShadow = true; st.pileMesh.receiveShadow = true;
    st.pileMesh.matrixAutoUpdate = false; st.pileMesh.frustumCulled = false; st.pileMesh.visible = false; grp.add(st.pileMesh);
  }
  st.dustT = 0;
  fallPose(st, 0);
  const at = fromSpin(st.cel, st.c, _wkD).add(st.cel.center);
  if (typeof SND !== 'undefined') SND.at(st.o.pole ? 'crash' : 'rubble', at, st.o.pole ? 0.6 : clamp(0.5 + st.top / 40, 0.6, 1.8));
  if (!st.o.pole) dustBurst(st, 0);
}
const ease = t => t * t * (3 - 2 * t);
/* where everything is t seconds into the fall */
function fallPose(st, t) {
  const k = clamp(t / st.dur, 0, 1);
  if (st.o.pole) {
    // a post swings over from its foot, faster and faster, and lies there
    const a = st.lean * k * k;
    _wkM.makeRotationAxis(st.axis, a);
  } else {
    // a building shudders, then drops into its own footprint, leaning a little toward the blow
    const sh = t < 0.35 ? Math.sin(t * 70) * 0.12 * (1 - t / 0.35) : 0;
    const sink = st.top * 1.05 * Math.pow(clamp((t - 0.15) / (st.dur - 0.15), 0, 1), 1.7);
    _wkM.makeRotationAxis(st.axis, st.lean * ease(k)).premultiply(_wkM2.makeTranslation(sh, -sink, 0));
    if (st.pileMesh) {
      const g = clamp((t - st.dur * 0.2) / (st.dur * 0.8), 0, 1);
      st.pileMesh.matrix.copy(st.M).multiply(_wkM2.makeScale(1, Math.max(0.01, ease(g)), 1));
      st.pileMesh.matrixWorldNeedsUpdate = true;
    }
  }
  // site origin × building frame × the fall × back out of the building frame
  _wkM2.makeTranslation(st.site.O.x, st.site.O.y, st.site.O.z).multiply(st.L).multiply(_wkM).multiply(st.Li);
  for (const L of [st.lift, st.liftG]) if (L) { L.mesh.matrix.copy(_wkM2); L.mesh.matrixWorldNeedsUpdate = true; }
}
/* dust: phase 0, a thick ring rolling out from the foot as it gives way; phase 1, the cloud boiling up out of the
   footprint as it goes down (from about where its top is now); phase 2, the last big billow as it hits bottom */
function dustBurst(st, phase) {
  if (typeof FX === 'undefined') return;
  const P = st.pile || { cx: 0, cz: 0, W2: 3, D2: 3 }, cel = st.cel;
  const upW = fromSpin(cel, _wkB.setFromMatrixColumn(st.M, 1).normalize(), new V3());
  const area = P.W2 * P.D2, big = clamp(Math.sqrt(area) / 6, 0.9, 3.2);
  const n = phase === 1 ? Math.round(clamp(area / 5, 10, 40)) : Math.round(clamp(area / (phase === 0 ? 1.5 : 2.5), 30, phase === 0 ? 170 : 110));
  const k = clamp(st.t / st.dur, 0, 1), topNow = Math.max(1, st.top * (1 - Math.pow(k, 1.7)));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, edge = phase !== 1 || Math.random() < 0.35, r = edge ? 0.85 + Math.random() * 0.3 : Math.random() * 0.85;
    const lx = P.cx + Math.cos(a) * P.W2 * r, lz = P.cz + Math.sin(a) * P.D2 * r;
    const ly = phase === 1 && !edge ? Math.random() * topNow : 0.4 + Math.random() * 1.5;
    const pw = fromSpin(cel, _wkA.set(lx, ly, lz).applyMatrix4(st.M), new V3()).add(cel.center);
    const V = surfaceVel(cel, pw, _wkC);
    const out = fromSpin(cel, _wkA.set(Math.cos(a), 0, Math.sin(a)).transformDirection(st.M), new V3());
    const sp = edge ? (phase === 0 ? 7 : 4) + Math.random() * 7 * big : 0.5 + Math.random() * 2.5;
    const rise = edge ? 0.5 + Math.random() * 2 : 2.5 + Math.random() * 4;
    const g = 0.56 + Math.random() * 0.1, life = 5 + Math.random() * 4 * big;
    FX.spawn(pw.x, pw.y, pw.z, V.x + out.x * sp + upW.x * rise, V.y + out.y * sp + upW.y * rise, V.z + out.z * sp + upW.z * rise,
      life, (3 + Math.random() * 2.5) * big, (11 + Math.random() * 7) * big, g + 0.07, g + 0.03, g - 0.04, g - 0.02, g - 0.04, g - 0.07, 0.85, -0.03, 0.8);
  }
}

/* ---------- what hits them (called from physics and weapons) ---------- */
/* a vehicle point touching a building's collider */
function structTouch(b, pr, pw, pl, n, sv) {
  if (b.diorama || !pr.st || pr.st.state) return;   // (the title screen's parked vehicles never wreck anything)
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
/* an explosion: a building it goes off against takes the blow (blasts going off together add up), train cars near it come off */
function wreckBlast(e) {
  for (const st of WRECK.list) {
    if (st.state) continue;
    const cel = st.cel; toSpin(cel, _wkD.subVectors(e.pos, cel.center), _wkD);
    if (_wkD.distanceTo(st.c) > st.r + e.radius) continue;
    const p = _wkA.copy(_wkD).applyMatrix4(st.Mi);
    // how far the blast is from the building's walls and roof
    let gap = Infinity;
    for (const B of st.boxes) gap = Math.min(gap, Math.hypot(Math.max(0, Math.abs(p.x - B.x) - B.w / 2), Math.max(0, Math.abs(p.y - B.y) - B.h / 2 - (st.o.roof ? st.o.roof.rh : 0)), Math.max(0, Math.abs(p.z - B.z) - B.d / 2)));
    if (gap > e.radius) continue;
    const f = 1 - gap / e.radius;
    if (W.time - st.blastT > 0.3) st.blast = 0;
    st.blast += e.power * BLAST_E * f * f; st.blastT = W.time;
    if (st.blast >= st.need) structFall(st, new V3(-p.x, 0, -p.z));
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
      const t = clamp(_wkC.subVectors(_psL, O).dot(Y), 0, st.top);
      if (_wkC.subVectors(_psL, O).addScaledVector(Y, -t).length() > reach) return;
      WRECK.hits.set(b, { st, vn: sp, p: O.clone().addScaledVector(Y, Math.min(t, 1)), n: _psV.clone().divideScalar(-sp), pole: true });
    });
  }
}
/* ---------- every physics step ---------- */
function wreckStep(dt) {
  poleSweep();
  // crashes: one hard enough brings the building down, and the vehicle carries on into it
  if (WRECK.hits.size) {
    for (const [b, h] of WRECK.hits) {
      const st = h.st; if (b.dead || st.state) continue;
      let m = 0; for (const o of machineOf(b)) m += o.mass;
      const E = 0.5 * Math.min(m, 2e5) * h.vn * h.vn;
      if (E < st.need && !(h.pole && h.vn > 4)) continue;
      const dl = toSpin(st.cel, _wkB.copy(h.n), _wkB).transformDirection(st.Mi).clone().negate();   // into the wall, building frame
      structFall(st, dl);
      // what it took to knock it down comes off the vehicle's speed
      const keep = Math.sqrt(clamp(1 - st.need / E, 0, 1)) * 0.9;
      b.v.addScaledVector(h.n, -h.vn * keep); b.wake();
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
  // derailed trains
  for (const tr of TRAIN.list) if (tr.off) trainWreckStep(tr, dt);
  flushDropped();
}
/* every frame: the falls play out; things are put back once enough time has passed and you are away */
function wreckFrame(dt) {
  if (!WRECK.active.size && !TRAIN.list.some(t => t.off)) return;
  for (const st of WRECK.active) {
    st.t += dt;
    if (st.state === 1) {
      fallPose(st, st.t);
      if (!st.o.pole) { st.dustT -= dt; if (st.dustT <= 0 && st.t < st.dur) { st.dustT = 0.15; dustBurst(st, 1); } }
      if (st.t >= st.dur) {
        st.state = 2;
        if (st.o.pole) { if (typeof FX !== 'undefined') { const tip = fromSpin(st.cel, _wkA.set(0, st.top, 0).applyMatrix4(_wkM.makeRotationAxis(st.axis, st.lean)).applyMatrix4(st.M), new V3()).add(st.cel.center); FX.cel = FX.cel || st.cel; FX.puff(tip); } }
        else { st.rubble = rubbleCollider(st); dustBurst(st, 2); for (const L of [st.lift, st.liftG]) if (L) L.mesh.visible = false; }
      }
    }
    // shown with the rest of its site (the falling building until it is down, the pile once it has started to rise)
    const vis = st.site.vis !== false, up = st.state === 1 || st.o.pole;
    for (const L of [st.lift, st.liftG]) if (L) L.mesh.visible = vis && up;
    if (st.pileMesh) st.pileMesh.visible = vis && st.t > st.dur * 0.2;
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
  if (st.rubble) dropCollider(st.rubble);
  flushDropped();
  for (const m of [st.lift && st.lift.mesh, st.liftG && st.liftG.mesh, st.pileMesh]) if (m) { m.parent && m.parent.remove(m); m.geometry.dispose(); }
  const site = st.site;
  putBack(siteMesh(site, MAT.site), st.lift); putBack(siteMesh(site, MAT.glow), st.liftG);
  for (const c of st.cols) restoreCollider(c);
  st.lift = st.liftG = st.pileMesh = st.rubble = null; st.state = 0; st.t = 0; st.blast = 0;
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

'use strict';
/* ================= Scrapline · builder =================
   Trailmakers-style: Build places parts, Select picks groups (click, Shift-click, drag a box) to move, turn,
   copy, mirror, paint or delete them, Configure sets each part's keys and settings, Paint colours parts.
   Building tools: Mirror, centre of mass, Forces view, Air drag view and the part keys view. Undo and redo. */
const B = {
  design: null, group: null, objs: [], pickables: [], occ: new Map(), insts: [],
  sel: 'block', tool: 'build', mirror: true, rotK: 0, tilt: 0, color: -1,
  undo: [], redo: [], ghost: null, ghost2: null, ghostKey: '', target: null, clip: null, pasting: false, moving: null,
  selSet: new Set(), hoverPi: -1, lastClick: { pi: -1, t: 0 },
  cam: { yaw: 0.8, pitch: 0.42, dist: 11, tgt: new V3() },
  lowest: 0, gridObj: null, com: null, ovl: null, needsHover: false, ndc: new THREE.Vector2(), hoverOK: false, padPoint: new V3(),
  labels: [], forces: null, air: null
};
function bInit() {
  B.group = new THREE.Group(); scene.add(B.group);
  const m = new THREE.Matrix4().makeBasis(WORLD.padRight, WORLD.padUp, WORLD.padFwd);
  B.group.quaternion.setFromRotationMatrix(m);
  B.padPoint.copy(WORLD.padUp).multiplyScalar(PLANET.R + WORLD.padH).add(PLANET.center);
  const g = new THREE.GridHelper(30, 60, 0xb7c8d2, 0x5b6c77);
  g.material.transparent = true; g.material.opacity = 0.32; g.material.depthWrite = false;
  g.position.set(0.25, 0, 0.25); B.group.add(g); B.gridObj = g;
  B.com = ballMarker(0xf0a32b, 0.16); B.group.add(B.com);
  B.ovl = new THREE.Group(); B.group.add(B.ovl);
}
function ballMarker(color, r) {
  const g = new THREE.Group();
  const s1 = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
  const s2 = new THREE.Mesh(new THREE.TorusGeometry(r * 1.6, r * 0.16, 6, 24), new THREE.MeshBasicMaterial({ color: 0x15181b, depthTest: false, transparent: true, opacity: 0.8 }));
  s1.renderOrder = s2.renderOrder = 10; s1.userData.own = s2.userData.own = true; g.add(s1, s2); return g;
}
function bLoad(design, resetCam = true) {
  B.design = cloneDesign(design);
  B.undo = []; B.redo = []; B.selSet.clear(); endPaste(false);
  bRebuild();
  if (resetCam) bFocus(true);
  const dn = document.getElementById('designName'); if (dn) dn.value = B.design.name;
}
function bRebuild() {
  for (const o of B.objs) B.group.remove(o);
  B.objs = []; B.pickables = [];
  B.insts = B.design.parts.map(p => new PartInst(p.t, p.a, p.m, p.c, 0, p.cfg || null));
  B.occ = new Map();
  B.insts.forEach((pi, i) => { for (const k of pi.keys) B.occ.set(k, i); });
  for (const i of [...B.selSet]) if (i >= B.design.parts.length) B.selSet.delete(i);
  B.design.parts.forEach((p, i) => {
    const obj = partObject(p.t, p.c, p.m, p.a, null, p.cfg);
    obj.traverse(m => { if (m.isMesh) { m.userData.pi = i; m.userData.mat = m.material; if (m.material === MAT.veh) m.castShadow = true; B.pickables.push(m); } });
    B.group.add(obj); B.objs.push(obj);
  });
  // moving parts that can't move glow red
  B.locked = lockedJoints(B.insts);
  for (const [i] of B.locked) B.objs[i].traverse(m => { if (m.isMesh && m.userData.mat === MAT.veh) { m.material = MAT.locked; m.userData.mat = MAT.locked; } });
  B.size = bCenter(_bp);
  B.lowest = designBottom(B.design.parts);
  // the pad turns with Terra, so the builder follows it there
  B.padPoint.copy(WORLD.padUp).multiplyScalar(PLANET.R + WORLD.padH).add(PLANET.center);
  B.group.quaternion.setFromRotationMatrix(_bm4.makeBasis(WORLD.padRight, WORLD.padUp, WORLD.padFwd));
  B.group.position.copy(B.padPoint).addScaledVector(WORLD.padUp, -B.lowest + 0.03);
  B.gridObj.position.y = B.lowest + 0.004;
  B.hoverPi = -1;
  refreshHighlights();
  bOverlays();
  B.group.updateMatrixWorld(true);
  B.ghostKey = ''; B.needsHover = true;
  uiStats();
  if (typeof renderCtx === 'function') renderCtx();
  saveCurrent();
}
function bCenter(out) {
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const pi of B.insts) for (const c of pi.cells) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], c[i]); mx[i] = Math.max(mx[i], c[i]); }
  if (mn[0] > mx[0]) { B.bmin = [-1, -1, -1]; B.bmax = [1, 1, 1]; return out.set(0, 0, 0); }
  B.bmin = mn.map(v => v * CELL); B.bmax = mx.map(v => v * CELL);
  out.set((mn[0] + mx[0]) / 2 * CELL, (mn[1] + mx[1]) / 2 * CELL, (mn[2] + mx[2]) / 2 * CELL);
  return Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) * CELL + CELL;
}
function bFocus(resetAngles) {
  const size = B.size = bCenter(B.cam.tgt);
  B.cam.dist = clamp(size * 1.7 + 4, 7, Math.max(60, size * 1.2));
  // kilometre-long builds: start at the seat, where the building happens (scroll out to see it all)
  const seat = size > 300 && B.insts.find(p => p.def.kind === 'seat');
  if (seat) { B.cam.tgt.set(seat.cen[0], seat.cen[1], seat.cen[2]); B.cam.dist = 26; }
  // a selection: look at that
  if (!seat && B.selSet.size && B.selSet.size < B.insts.length) {
    const c = new V3(); for (const i of B.selSet) c.add(_bn.fromArray(B.insts[i].cen)); c.divideScalar(B.selSet.size); B.cam.tgt.copy(c);
  }
  if (resetAngles) { B.cam.yaw = 0.8; B.cam.pitch = 0.42; }
}

/* ---------- undo and redo ---------- */
const snap = () => JSON.stringify(B.design.parts);
function pushUndo() { B.undo.push(snap()); if (B.undo.length > 120) B.undo.shift(); B.redo.length = 0; }
function bUndo() {
  if (B.pasting) { cancelPaste(); return; }
  const s = B.undo.pop(); if (!s) { toast('Nothing to undo', 1000); return; }
  B.redo.push(snap()); B.design.parts = JSON.parse(s); B.selSet.clear(); bRebuild(); sfx('click');
}
function bRedo() {
  const s = B.redo.pop(); if (!s) { toast('Nothing to redo', 1000); return; }
  B.undo.push(snap()); B.design.parts = JSON.parse(s); B.selSet.clear(); bRebuild(); sfx('click');
}
const sfx = n => { if (typeof SND !== 'undefined') SND.play(n); };

/* ---------- highlights: selection stays lit, hover lights up what a click would hit ---------- */
function partMeshes(i, fn) { if (B.objs[i]) B.objs[i].traverse(m => { if (m.isMesh && (m.userData.mat === MAT.veh || m.userData.mat === MAT.locked)) fn(m); }); }
function refreshHighlights() {
  for (let i = 0; i < B.objs.length; i++) partMeshes(i, m => { m.material = m.userData.mat; });
  for (const i of B.selSet) partMeshes(i, m => { m.material = MAT.sel; });
  const h = B.hoverPi; if (h < 0 || B.pasting) return;
  const mat = B.tool === 'paint' ? MAT.paint : B.tool === 'build' ? MAT.hl : MAT.move;
  const list = [h];
  if (B.mirror && (B.tool === 'paint' || B.tool === 'config' || B.tool === 'build')) { const j = findMirror(h); if (j >= 0) list.push(j); }
  if (B.tool === 'build') return;
  for (const i of list) partMeshes(i, m => { m.material = mat; });
}
function setHover(pi) { if (pi === B.hoverPi) return; B.hoverPi = pi; refreshHighlights(); }
function partColorFor(def) { return B.color >= 0 ? B.color : def.dc; }
function setGhost(key, build) {
  if (key === B.ghostKey) return;
  B.ghostKey = key;
  if (B.ghost) { B.group.remove(B.ghost); B.ghost = null; }
  if (B.ghost2) { B.group.remove(B.ghost2); B.ghost2 = null; }
  if (build) build();
}
function findMirror(pi) {
  const p = B.design.parts[pi]; if (!p) return -1;
  const def = PD[p.t], ma = [-p.a[0], p.a[1], p.a[2]], mM = mirrorM(p.m, def);
  if (ma[0] === p.a[0]) return -1;
  return B.design.parts.findIndex((q, i) => i !== pi && q.t === p.t && q.a[0] === ma[0] && q.a[1] === ma[1] && q.a[2] === ma[2] && mEq(q.m, mM));
}
const _bm4 = new THREE.Matrix4();
const _bq = new Quat(), _bn = new V3(), _bp = new V3(), _bplane = new THREE.Plane(), _bpn = new V3(), _bpp = new V3();
const isPlacing = () => B.tool === 'build' && !B.pasting;
const isStamping = () => B.pasting && !!B.clip;

/* placement target for the selected part against a face (n) of a cell; works for faces and the empty grid */
function placementTarget(cell, n, faceOK) {
  const anchor = [cell[0] + n[0], cell[1] + n[1], cell[2] + n[2]];
  const def = PD[B.sel];
  // wheels: rotation 0 presses down, each R turns the press direction a quarter about the axle
  const M = def.kind === 'wheel' && !def.wheel.bogie && Math.abs(n[1]) < 0.5 ? orient(n, (B.rotK + wheelDownK(n)) % 4) : orient(n, B.rotK, def.attach === 'all' ? B.tilt : 0);
  const fp = footprint(def, anchor, M);
  const free = fp.every(c => !B.occ.has(ckey(c[0], c[1], c[2])));
  let valid = faceOK && free, mir = null, reason = !faceOK ? 'face' : !free ? 'blocked' : '';
  if (valid && B.mirror && anchor[0] !== 0) {
    const ma = [-anchor[0], anchor[1], anchor[2]], mM = mirrorM(M, def), mfp = footprint(def, ma, mM);
    const clash = mfp.some(c => B.occ.has(ckey(c[0], c[1], c[2])) || fp.some(d => d[0] === c[0] && d[1] === c[1] && d[2] === c[2]));
    const md = mapply(mM, [0, -1, 0]), mc = [ma[0] + md[0], ma[1] + md[1], ma[2] + md[2]];
    const mi = B.occ.get(ckey(mc[0], mc[1], mc[2]));
    const mok = (mi !== undefined && B.insts[mi].allows(ckey(mc[0], mc[1], mc[2]), [-md[0], -md[1], -md[2]]));
    if (!clash && mok) mir = { anchor: ma, M: mM };
  }
  return { valid, anchor, M, mirror: mir, reason };
}
function showTarget(t) {
  B.target = t;
  const ci = partColorFor(PD[B.sel]);
  const key = [B.sel, t.anchor.join(','), t.M.join(','), t.valid, t.mirror ? 1 : 0, ci].join('|');
  setGhost(key, () => {
    B.ghost = partObject(B.sel, ci, t.M, t.anchor, t.valid ? MAT.ghostOk : MAT.ghostBad);
    B.ghost.traverse(m => { if (m.isMesh) m.renderOrder = 5; });
    B.group.add(B.ghost);
    if (t.mirror) { B.ghost2 = partObject(B.sel, ci, t.mirror.M, t.mirror.anchor, MAT.ghostMirror); B.group.add(B.ghost2); }
    if (PD[B.sel].kind === 'wheel' && typeof uiRot === 'function') uiRot();
  });
}
function pickPart() {
  camera.updateMatrixWorld(); raycaster.setFromCamera(B.ndc, camera);
  raycaster.ray.origin.sub(RO);
  const hits = B.hoverOK ? raycaster.intersectObjects(B.pickables, false) : [];
  return hits.find(h => h.object.userData.pi !== undefined) || null;
}
function bHover() {
  B.needsHover = false;
  const hit = pickPart();
  if (!hit) {
    setHover(-1);
    // an empty build: place the first part straight on the grid
    if (B.hoverOK && !B.insts.length && (isPlacing() || isStamping())) {
      B.group.updateMatrixWorld(true);
      _bpn.copy(WORLD.padUp); _bpp.set(0, -CELL / 2, 0); B.group.localToWorld(_bpp);
      _bplane.setFromNormalAndCoplanarPoint(_bpn, _bpp);
      if (raycaster.ray.intersectPlane(_bplane, _bp)) {
        B.group.worldToLocal(_bp);
        const gc = [Math.round(_bp.x / CELL), -1, Math.round(_bp.z / CELL)];
        if (isStamping()) showClipTarget(clipTarget(gc, [0, 1, 0], true)); else showTarget(placementTarget(gc, [0, 1, 0], true));
        return;
      }
    }
    B.target = null; setGhost('', null); return;
  }
  const pi = hit.object.userData.pi;
  if (!isPlacing() && !isStamping()) { setHover(pi); B.target = { pi }; setGhost('', null); return; }
  setHover(isPlacing() ? pi : -1);
  const inst = B.insts[pi];
  const pD = B.group.worldToLocal(_bp.copy(hit.point));
  _bn.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).applyQuaternion(_bq.copy(B.group.quaternion).invert());
  const ax = Math.abs(_bn.x), ay = Math.abs(_bn.y), az = Math.abs(_bn.z);
  const n = ax >= ay && ax >= az ? [Math.sign(_bn.x), 0, 0] : ay >= az ? [0, Math.sign(_bn.y), 0] : [0, 0, Math.sign(_bn.z)];
  let cell = [Math.round((pD.x - n[0] * 0.06) / CELL), Math.round((pD.y - n[1] * 0.06) / CELL), Math.round((pD.z - n[2] * 0.06) / CELL)];
  if (!inst.keys.includes(ckey(cell[0], cell[1], cell[2]))) {
    let bd = 1e9, bc = inst.cells[0];
    for (const c of inst.cells) { const d = (c[0] * CELL - pD.x) ** 2 + (c[1] * CELL - pD.y) ** 2 + (c[2] * CELL - pD.z) ** 2; if (d < bd) { bd = d; bc = c; } }
    cell = bc.slice();
  }
  const fOK = inst.allows(ckey(cell[0], cell[1], cell[2]), n);
  if (isStamping()) showClipTarget(clipTarget(cell, n, fOK)); else showTarget(placementTarget(cell, n, fOK));
}
const REASONS = { face: 'That face has no mounting point. Attach to a block instead.', blocked: 'Something is in the way. Try R to rotate.' };

/* ---------- clicks ---------- */
function bClick(button, shift) {
  const t = B.target;
  if (button === 2) {
    if (B.pasting) { cancelPaste(); return; }
    if (B.tool === 'build') { if (B.hoverPi >= 0) bDelete(B.hoverPi, B.mirror); }
    else if (B.selSet.size) { B.selSet.clear(); refreshHighlights(); renderCtx(); }
    return;
  }
  if (B.pasting) { bStamp(); return; }
  const pi = t && t.pi !== undefined ? t.pi : B.hoverPi;
  switch (B.tool) {
    case 'build': {
      if (!t || t.pi !== undefined) return;
      if (!t.valid) { toast(REASONS[t.reason] || 'Can\'t place that here'); sfx('nope'); return; }
      pushUndo();
      const ci = partColorFor(PD[B.sel]);
      B.design.parts.push({ t: B.sel, a: t.anchor, m: t.M, c: ci });
      if (t.mirror) B.design.parts.push({ t: B.sel, a: t.mirror.anchor, m: t.mirror.M, c: ci });
      bRebuild(); sfx('place');
      if (B.sel === 'seat' && B.design.parts.filter(p => p.t === 'seat').length > 1) toast('More than one seat: the first one placed is the pilot.');
      return;
    }
    case 'paint': if (pi >= 0) bPaint(pi); return;
    case 'select': case 'config': {
      if (pi < 0) { if (!shift && B.selSet.size) { B.selSet.clear(); refreshHighlights(); renderCtx(); } return; }
      const now = performance.now(), dbl = B.lastClick.pi === pi && now - B.lastClick.t < 380;
      B.lastClick = { pi, t: now };
      if (dbl) { for (const i of copyGroup(pi).idx) B.selSet.add(i); }
      else if (shift) { if (B.selSet.has(pi)) B.selSet.delete(pi); else B.selSet.add(pi); }
      else {
        B.selSet.clear(); B.selSet.add(pi);
        if (B.tool === 'config' && B.mirror) { const j = findMirror(pi); if (j >= 0) B.selSet.add(j); }
      }
      refreshHighlights(); renderCtx(); sfx('tick');
      return;
    }
  }
}
/* box select: everything whose centre lands inside the rectangle (client pixels) */
function bBoxSelect(x0, y0, x1, y1, add) {
  const r = $('view').getBoundingClientRect(), lo = [Math.min(x0, x1), Math.min(y0, y1)], hi = [Math.max(x0, x1), Math.max(y0, y1)];
  if (!add) B.selSet.clear();
  B.group.updateMatrixWorld(true); camera.updateMatrixWorld();
  B.insts.forEach((p, i) => {
    _bp.fromArray(p.cen); B.group.localToWorld(_bp).add(RO);
    _bp.project(camera); if (_bp.z > 1) return;
    const sx = r.left + (_bp.x + 1) / 2 * r.width, sy = r.top + (1 - _bp.y) / 2 * r.height;
    if (sx >= lo[0] && sx <= hi[0] && sy >= lo[1] && sy <= hi[1]) B.selSet.add(i);
  });
  refreshHighlights(); renderCtx();
  if (B.selSet.size) sfx('tick');
}
function bSelectAll() { if (B.tool !== 'select' && B.tool !== 'config') setTool('select'); B.design.parts.forEach((_, i) => B.selSet.add(i)); refreshHighlights(); renderCtx(); }

/* ---------- copy, move and paste: a group is carried as a ghost and stamped on a face ---------- */
const ROT24 = [];
(function () {
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const pm of perms) for (let sg = 0; sg < 8; sg++) {
    const M = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let r = 0; r < 3; r++) M[r * 3 + pm[r]] = (sg >> r) & 1 ? -1 : 1;
    const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
    if (det === 1) ROT24.push(M);
  }
})();
function rotAbout(n) { // 90° about axis n: [n]x + n nT
  return [n[0] * n[0], -n[2] + n[0] * n[1], n[1] + n[0] * n[2], n[2] + n[1] * n[0], n[1] * n[1], -n[0] + n[1] * n[2], -n[1] + n[2] * n[0], n[0] + n[2] * n[1], n[2] * n[2]];
}
/* a part and everything built onto it, away from the seat (double-click in Select) */
function copyGroup(pi) {
  const insts = B.insts, root = insts[pi];
  const seat = insts.find(p => p.def.kind === 'seat');
  const rest = insts.filter((_, i) => i !== pi);
  let rootComp = [];
  if (seat && seat !== root && rest.length) {
    const comps = partComponents(rest);
    rootComp = comps.find(c => c.includes(seat)) || [];
  }
  const rootSet = new Set(rootComp);
  const adj = partAdjacency(insts), seen = new Set([root]), st = [root];
  while (st.length) { const q = st.pop(); for (const r of adj.get(q) || []) if (!seen.has(r) && !rootSet.has(r)) { seen.add(r); st.push(r); } }
  if (!rootSet.size) for (const q of insts) seen.add(q);
  const idx = []; insts.forEach((q, i) => { if (seen.has(q)) idx.push(i); });
  return { idx };
}
/* the clip of a selection: which cell and face of it gets stuck onto whatever you point at */
function clipOf(idx) {
  const insts = B.insts, inSel = new Set(idx.map(i => insts[i]));
  const grid = new Map(); for (const p of insts) if (!inSel.has(p)) for (const k of p.keys) grid.set(k, p);
  let c0 = null, d = null, root = idx[0];
  outer: for (const i of idx) {
    const p = insts[i];
    for (let ci = 0; ci < p.cells.length; ci++) {
      const c = p.cells[ci];
      for (let di = 0; di < 6; di++) {
        const dd = DIRS[di]; if (!p.allows(p.keys[ci], dd)) continue;
        const nk = ckey(c[0] + dd[0], c[1] + dd[1], c[2] + dd[2]), q = grid.get(nk);
        if (q && q.allows(nk, NDIRS[di])) { c0 = c.slice(); d = dd.slice(); root = i; break outer; }
      }
    }
  }
  if (!c0) {
    // nothing outside it: stick it down by its lowest part's bottom face
    let lo = Infinity;
    for (const i of idx) { const p = insts[i]; for (const c of p.cells) if (c[1] < lo) { lo = c[1]; root = i; } }
    const p = insts[root];
    d = p.def.attach === 'all' ? [0, -1, 0] : p.mountDir.slice();
    c0 = p.cells.reduce((a, c) => (c[0] * d[0] + c[1] * d[1] + c[2] * d[2] > a[0] * d[0] + a[1] * d[1] + a[2] * d[2] ? c : a), p.cells[0]).slice();
  }
  const parts = idx.map(i => clonePart(B.design.parts[i]));
  return { parts, c0, d, root: idx.indexOf(root) };
}
function bCopySel() {
  if (!B.selSet.size) { toast('Select parts first, then copy them', 1600); return; }
  B.clip = clipOf([...B.selSet].sort((a, b) => a - b));
  startPaste(null);
  toast(`Copied ${B.clip.parts.length} part${B.clip.parts.length > 1 ? 's' : ''}. Click faces to stamp copies, R turns them, Esc stops.`, 3000);
}
function bMoveSel() {
  if (!B.selSet.size) { toast('Select parts first, then move them', 1600); return; }
  const before = snap();
  B.clip = clipOf([...B.selSet].sort((a, b) => a - b));
  pushUndo();
  B.design.parts = B.design.parts.filter((_, i) => !B.selSet.has(i));
  B.selSet.clear(); bRebuild();
  startPaste(before);
  toast('Carrying the selection. Click a face to set it down, R turns it, Esc puts it back.', 3000);
}
function bPasteMode() { if (!B.clip) { toast('Copy something first (select parts, then C)', 1600); return; } startPaste(null); }
function startPaste(movingSnap) {
  if (B.tool !== 'select' && B.tool !== 'config') { B.tool = 'select'; syncTools(); }
  B.pasting = true; B.moving = movingSnap; B.rotK = 0; B.ghostKey = ''; B.needsHover = true; setHover(-1);
  if (typeof uiRot === 'function') uiRot(); renderCtx();
}
function endPaste(redraw = true) { B.pasting = false; B.moving = null; setGhost('', null); B.needsHover = true; if (redraw) { if (typeof uiRot === 'function') uiRot(); renderCtx(); } }
function cancelPaste() {
  if (B.moving) { B.undo.pop(); B.design.parts = JSON.parse(B.moving); B.moving = null; bRebuild(); toast('Put back', 1000); }
  endPaste();
}
function clipTransform(cell, n, k) {
  const cl = B.clip, want = [-n[0], -n[1], -n[2]];
  let best = null, bt = -9;
  for (const Q of ROT24) { const v = mapply(Q, cl.d); if (v[0] === want[0] && v[1] === want[1] && v[2] === want[2]) { const tr = Q[0] + Q[4] + Q[8]; if (tr > bt) { bt = tr; best = Q; } } }
  let Q = best; const Rn = rotAbout(n);
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) Q = mmul(Rn, Q);
  const target = [cell[0] + n[0], cell[1] + n[1], cell[2] + n[2]];
  return cl.parts.map(p => { const r = mapply(Q, [p.a[0] - cl.c0[0], p.a[1] - cl.c0[1], p.a[2] - cl.c0[2]]); const q = clonePart(p); q.a = [target[0] + r[0], target[1] + r[1], target[2] + r[2]]; q.m = mmul(Q, p.m); return q; });
}
function clipTarget(cell, n, faceOK) {
  const placed = clipTransform(cell, n, B.rotK);
  const occ = new Set(), all = [];
  let free = true;
  for (const p of placed) for (const c of footprint(PD[p.t], p.a, p.m)) { const k = ckey(c[0], c[1], c[2]); if (B.occ.has(k) || occ.has(k)) free = false; occ.add(k); all.push(c); }
  const root = placed[B.clip.root], ri = new PartInst(root.t, root.a, root.m, root.c);
  const target = [cell[0] + n[0], cell[1] + n[1], cell[2] + n[2]];
  const rootOK = !B.insts.length || ri.allows(ckey(target[0], target[1], target[2]), [-n[0], -n[1], -n[2]]);
  const valid = faceOK && free && rootOK;
  let mirror = null;
  if (valid && B.mirror && !B.moving && !all.some(c => c[0] === 0) && all.every(c => Math.sign(c[0]) === Math.sign(all[0][0]))) {
    const mp = placed.map(p => { const q = clonePart(p); q.a = [-p.a[0], p.a[1], p.a[2]]; q.m = mirrorM(p.m, PD[p.t]); return q; });
    let mfree = true;
    for (const p of mp) for (const c of footprint(PD[p.t], p.a, p.m)) { const k = ckey(c[0], c[1], c[2]); if (B.occ.has(k) || occ.has(k)) mfree = false; }
    const mc = [-cell[0], cell[1], cell[2]], mi = B.occ.get(ckey(mc[0], mc[1], mc[2])), mn = [-n[0], n[1], n[2]];
    const mok = B.insts.length ? (mi !== undefined && B.insts[mi].allows(ckey(mc[0], mc[1], mc[2]), mn)) : true;
    if (mfree && mok) mirror = mp;
  }
  return { valid, placed, mirror, reason: !faceOK ? 'face' : !free ? 'blocked' : !rootOK ? 'face' : '', clip: true };
}
function showClipTarget(t) {
  B.target = t;
  const key = 'clip|' + t.placed.map(p => p.a.join(',') + p.m.join('')).join(';') + t.valid + (t.mirror ? 1 : 0);
  setGhost(key, () => {
    const mk = (list, mat) => { const g = new THREE.Group(); for (const p of list) { const o = partObject(p.t, p.c, p.m, p.a, mat); o.traverse(m => { if (m.isMesh) m.renderOrder = 5; }); g.add(o); } return g; };
    B.ghost = mk(t.placed, t.valid ? MAT.ghostOk : MAT.ghostBad); B.group.add(B.ghost);
    if (t.mirror) { B.ghost2 = mk(t.mirror, MAT.ghostMirror); B.group.add(B.ghost2); }
  });
}
function bStamp() {
  const t = B.target;
  if (!t || !t.clip) { toast('Point at a face to set it down. Esc stops.'); return; }
  if (!t.valid) { toast(REASONS[t.reason] || 'No room there. Try R to turn it.'); sfx('nope'); return; }
  if (!B.moving) pushUndo();
  const n0 = B.design.parts.length;
  for (const p of t.placed) B.design.parts.push(p);
  if (t.mirror) for (const p of t.mirror) B.design.parts.push(p);
  B.selSet.clear();
  for (let i = n0; i < B.design.parts.length; i++) B.selSet.add(i);
  const moved = !!B.moving;
  if (moved) endPaste(false);
  bRebuild(); sfx('place');
  if (moved) { if (typeof uiRot === 'function') uiRot(); }
  else if (B.clip.parts.some(p => p.t === 'seat')) toast('That copy has its own seat: the first seat placed is the pilot.');
}

/* ---------- group edits in place ---------- */
function selIdx() { return [...B.selSet].sort((a, b) => a - b); }
/* would these replacement parts fit among the parts left out of the selection? */
function fitsWithout(idx, repl) {
  const keep = new Set(idx), occ = new Set();
  B.insts.forEach((p, i) => { if (!keep.has(i)) for (const k of p.keys) occ.add(k); });
  const mine = new Set();
  for (const p of repl) for (const c of footprint(PD[p.t], p.a, p.m)) { const k = ckey(c[0], c[1], c[2]); if (occ.has(k) || mine.has(k)) return false; mine.add(k); }
  return true;
}
function replaceSel(idx, repl, msg) {
  if (!fitsWithout(idx, repl)) { toast(msg || 'Something is in the way', 1400); sfx('nope'); return false; }
  pushUndo();
  idx.forEach((i, k) => { B.design.parts[i] = repl[k]; });
  bRebuild(); sfx('tick');
  return true;
}
function bNudge(dx, dy, dz) {
  const idx = selIdx(); if (!idx.length) return;
  const repl = idx.map(i => { const q = clonePart(B.design.parts[i]); q.a = [q.a[0] + dx, q.a[1] + dy, q.a[2] + dz]; return q; });
  replaceSel(idx, repl, 'Can\'t slide that way: something is in the way');
}
/* turn the selection a quarter about a design axis, around its middle */
function bTurnSel(axis, dir = 1) {
  const idx = selIdx(); if (!idx.length) return;
  let Q = rotAbout(axis); if (dir < 0) Q = mmul(Q, mmul(Q, Q));
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const i of idx) for (const c of B.insts[i].cells) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], c[k]); mx[k] = Math.max(mx[k], c[k]); }
  const pv = [0, 1, 2].map(k => Math.round((mn[k] + mx[k]) / 2));
  const repl = idx.map(i => { const p = B.design.parts[i], q = clonePart(p), r = mapply(Q, [p.a[0] - pv[0], p.a[1] - pv[1], p.a[2] - pv[2]]); q.a = [pv[0] + r[0], pv[1] + r[1], pv[2] + r[2]]; q.m = mmul(Q, p.m); return q; });
  replaceSel(idx, repl, 'No room to turn it here: move it clear first');
}
function bDeleteSel() {
  const idx = selIdx(); if (!idx.length) return;
  const hadSeat = idx.some(i => B.design.parts[i].t === 'seat');
  pushUndo();
  B.design.parts = B.design.parts.filter((_, i) => !B.selSet.has(i));
  B.selSet.clear(); bRebuild(); sfx('pop');
  if (hadSeat && !B.design.parts.some(q => q.t === 'seat')) toast('Seat removed. Without it the vehicle won\'t respond to controls.', 3200);
}
function bMirrorSel() {
  const idx = selIdx(); if (!idx.length) return;
  const add = [];
  for (const i of idx) {
    const p = B.design.parts[i], q = clonePart(p);
    q.a = [-p.a[0], p.a[1], p.a[2]]; q.m = mirrorM(p.m, PD[p.t]);
    const fp = footprint(PD[q.t], q.a, q.m).map(c => c.join()).sort().join(';'), own = B.insts[i].cells.map(c => c.join()).sort().join(';');
    if (fp === own) continue;   // sits on the middle line: it is its own mirror
    add.push(q);
  }
  if (!add.length) { toast('The selection sits on the middle line: it is already symmetric', 2000); return; }
  if (!fitsWithout([], add)) { toast('No room on the other side for a mirrored copy', 2000); sfx('nope'); return; }
  pushUndo();
  const n0 = B.design.parts.length; B.design.parts.push(...add);
  B.selSet.clear(); for (let i = n0; i < B.design.parts.length; i++) B.selSet.add(i);
  bRebuild(); sfx('place');
  toast(`Mirrored ${add.length} part${add.length > 1 ? 's' : ''} to the other side`, 1600);
}
function bPaintSel() {
  const idx = selIdx(); if (!idx.length) return;
  pushUndo();
  for (const i of idx) { const p = B.design.parts[i]; p.c = B.color >= 0 ? B.color : PD[p.t].dc; }
  bRebuild(); sfx('tick');
}
function bDelete(pi, withTwin) {
  const p = B.design.parts[pi]; if (!p) return;
  pushUndo();
  const rm = new Set([pi]);
  if (withTwin) { const j = findMirror(pi); if (j >= 0) rm.add(j); }
  B.design.parts = B.design.parts.filter((_, i) => !rm.has(i));
  B.selSet.clear(); bRebuild(); sfx('pop');
  if (p.t === 'seat' && !B.design.parts.some(q => q.t === 'seat')) toast('Seat removed. Without it the vehicle won\'t respond to controls.', 3200);
}
function bPaint(pi) {
  const p = B.design.parts[pi]; if (!p) return;
  const ci = B.color >= 0 ? B.color : PD[p.t].dc;
  const j = B.mirror ? findMirror(pi) : -1;
  if (p.c === ci && (j < 0 || B.design.parts[j].c === ci)) return;
  pushUndo();
  p.c = ci; if (j >= 0) B.design.parts[j].c = ci;
  bRebuild(); sfx('tick');
}
function bNew() {
  pushUndo();
  B.design = { name: 'New vehicle', parts: [{ t: 'seat', a: [0, 0, 0], m: orient([0, 1, 0]), c: 1 }], wv: 2 };
  document.getElementById('designName').value = B.design.name;
  B.selSet.clear(); endPaste(false);
  bRebuild(); bFocus(true);
}
/* settings changes from the Configure panel (no geometry changes, so no full rebuild) */
function bSetCfg(idx, id, value) {
  pushUndo();
  for (const i of idx) {
    const p = B.design.parts[i], f = cfgField(PD[p.t], id); if (!f) continue;
    const cfg = p.cfg ? { ...p.cfg } : {};
    if (value === undefined) delete cfg[id];
    else cfg[id] = f.type === 'num' ? clamp(+value, f.min, f.max) : value;
    if (Object.keys(cfg).length) p.cfg = cfg; else delete p.cfg;
    B.insts[i].cfg = p.cfg || null; B.insts[i]._kc = null;
  }
  // new words on a sign have to be drawn again
  if (idx.some(i => PD[B.design.parts[i].t].kind === 'text')) bRebuild();
  saveCurrent(); uiStats(); bOverlays(); renderCtx();
}

/* ---------- tools and building views ---------- */
function setTool(t) {
  if (B.pasting && t !== 'select' && t !== 'config') cancelPaste();
  if (t === 'build' || t === 'paint') { B.selSet.clear(); }
  B.tool = t; setHover(-1); setGhost('', null); B.needsHover = true;
  if (typeof syncTools === 'function') syncTools();
}
const VIEW_NAMES = { forces: 'Forces view', air: 'Air drag view', keys: 'Part keys view', com: 'Centre of mass', mirror: 'Mirror' };
function toggleView(v) {
  if (v === 'mirror') { B.mirror = !B.mirror; B.needsHover = true; B.ghostKey = ''; refreshHighlights(); }
  else { G.settings.views[v] = !G.settings.views[v]; LS.set('scrapline.settings', G.settings); bOverlays(); }
  const on = v === 'mirror' ? B.mirror : G.settings.views[v];
  toast(`${VIEW_NAMES[v]} ${on ? 'on' : 'off'}`, 1000); sfx('tick');
  if (typeof syncTools === 'function') syncTools();
}

/* Forces: centre of mass, centre and direction of thrust, centre of lift and of buoyancy, with what they mean */
function forceStats() {
  const insts = B.insts;
  let M = 0; const com = new V3();
  for (const p of insts) { const m = p.def.mass + (p.def.fuel || 0); M += m; com.x += m * p.cen[0]; com.y += m * p.cen[1]; com.z += m * p.cen[2]; }
  if (M > 0) com.divideScalar(M);
  const T = new V3(), cot = new V3(); let Tm = 0;
  const L = new V3(); let La = 0;
  const cob = new V3(); let Bv = 0;
  const grid = new Map(); for (const p of insts) for (const k of p.keys) grid.set(k, p);
  for (const p of insts) {
    const d = p.def, m = p.m, colY = [m[1], m[4], m[7]], colX = [m[0], m[3], m[6]], colZ = [m[2], m[5], m[8]];
    let dir = null;
    if (d.kind === 'rocket' && !nozzleBlocked(p, grid) && !d.ion) dir = [-colY[0], -colY[1], -colY[2]];
    else if (d.kind === 'jet' || d.kind === 'boatprop') dir = [-colY[0], -colY[1], -colY[2]];
    else if (d.kind === 'prop') { dir = colY.slice(); if (cfgGet(p, 'inv')) dir = dir.map(v => -v); }
    if (dir) {
      const f = d.thrust * cfgGet(p, 'power') / 100;
      T.x += dir[0] * f; T.y += dir[1] * f; T.z += dir[2] * f; Tm += f;
      cot.x += p.cen[0] * f; cot.y += p.cen[1] * f; cot.z += p.cen[2] * f;
    }
    if (d.kind === 'wing' || d.kind === 'flap') {
      const nL = d.kind === 'flap' ? colZ : colX;
      if (Math.abs(nL[1]) >= 0.6) { L.x += p.cen[0] * d.area; L.y += p.cen[1] * d.area; L.z += p.cen[2] * d.area; La += d.area; }
    }
    for (const c of p.cells) { const v = d.buoy; cob.x += c[0] * CELL * v; cob.y += c[1] * CELL * v; cob.z += c[2] * CELL * v; Bv += v; }
  }
  if (Tm > 0) cot.divideScalar(Tm);
  if (La > 0) L.divideScalar(La);
  if (Bv > 0) cob.divideScalar(Bv);
  const out = { M, com, T, Tm, cot, La, col: L, Bv, cob, floats: Bv * RHO_W * CELL * CELL * CELL > M * 1.05, warn: [] };
  if (Tm > 0 && T.length() > 1) {
    const th = T.clone().normalize(), arm = new V3().subVectors(com, cot).cross(th).length();
    out.arm = arm;
    if (arm > 0.3) out.warn.push(`Thrust pushes ${arm.toFixed(1)} m off the centre of mass, so the craft will turn while it burns. Line the engines up with the orange ball.`);
  }
  if (La > 1.5) {
    const dz = L.z - com.z;
    if (dz > 0.15) out.warn.push('The centre of lift (blue) is ahead of the centre of mass: a plane like this flips over. Move the wings back or add weight up front.');
    else if (dz < -3) out.warn.push('The centre of lift is far behind the centre of mass: the nose will be heavy. Move the wings forward a little.');
  }
  return out;
}
/* Air drag: every face that meets the wind head-on (the air comes from the front, +Z) */
function airStats() {
  const occ = new Set(), cols = new Set();
  for (const p of B.insts) { if (p.def.lattice) continue; for (const k of p.keys) occ.add(k); }
  const faces = [];
  for (const p of B.insts) {
    if (p.def.lattice) continue;
    for (const c of p.cells) { cols.add(c[0] * 65536 + c[1]); if (!occ.has(ckey(c[0], c[1], c[2] + 1))) faces.push(c); }
  }
  const A = cols.size * CELL * CELL, v = 100 / 3.6;
  return { faces, A, drag: 0.5 * RHO0 * 0.55 * A * v * v };
}
const OVL_MAT = {};
function arrowObj(from, dir, len, color) {
  const a = new THREE.ArrowHelper(dir.clone().normalize(), from, len, color, Math.min(0.6, len * 0.3), Math.min(0.35, len * 0.18));
  a.traverse(o => { if (o.material) { o.material.depthTest = false; o.material.transparent = true; o.material.opacity = 0.95; } o.renderOrder = 11; });
  return a;
}
function bOverlays() {
  if (!B.ovl) return;
  for (const c of B.ovl.children.slice()) { B.ovl.remove(c); c.traverse(o => { if (o.geometry && o.userData.own) o.geometry.dispose(); }); }
  const v = G.settings.views;
  const fs = B.forces = forceStats();
  B.com.position.copy(fs.com); B.com.visible = !!(v.com || v.forces) && B.insts.length > 0;
  if (v.forces && B.insts.length) {
    const g = 9.81, W = Math.max(1, fs.M * g);
    if (fs.Tm > 0) {
      const len = clamp(1 + 2.5 * fs.T.length() / W, 1, 6);
      const m = ballMarker(0xff7a3d, 0.13); m.position.copy(fs.cot); B.ovl.add(m);
      B.ovl.add(arrowObj(fs.cot, fs.T, len, 0xff7a3d));
    }
    if (fs.La > 0) { const m = ballMarker(0x6fc3ff, 0.13); m.position.copy(fs.col); B.ovl.add(m); B.ovl.add(arrowObj(fs.col, new V3(0, 1, 0), clamp(fs.La / 4, 0.8, 4), 0x6fc3ff)); }
    if (fs.floats) { const m = ballMarker(0x2fd0b8, 0.11); m.position.copy(fs.cob); B.ovl.add(m); B.ovl.add(arrowObj(fs.cob, new V3(0, 1, 0), 1.2, 0x2fd0b8)); }
    B.ovl.add(arrowObj(fs.com, new V3(0, -1, 0), 1.4, 0xf0a32b));
  }
  if (v.air && B.insts.length) {
    const as = B.air = airStats(), pos = [];
    for (const c of as.faces) {
      const x = c[0] * CELL, y = c[1] * CELL, z = c[2] * CELL + CELL / 2 + 0.01, h = CELL / 2 - 0.02;
      pos.push(x - h, y - h, z, x + h, y - h, z, x + h, y + h, z, x - h, y - h, z, x + h, y + h, z, x - h, y + h, z);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (!OVL_MAT.air) OVL_MAT.air = new THREE.MeshBasicMaterial({ color: 0xff5a3a, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const mesh = new THREE.Mesh(geo, OVL_MAT.air); mesh.renderOrder = 6; mesh.userData.own = true; B.ovl.add(mesh);
    // wind streaks coming at the front
    const lp = [], fz = (B.bmax ? B.bmax[2] : 1) + 3;
    for (let i = 0; i < 9; i++) { const x = lerp(B.bmin[0], B.bmax[0], (i % 3) / 2), y = lerp(B.bmin[1], B.bmax[1], Math.floor(i / 3) / 2); lp.push(x, y, fz + 2.5, x, y, fz); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    if (!OVL_MAT.wind) OVL_MAT.wind = new THREE.LineDashedMaterial({ color: 0xbfe6ff, dashSize: 0.3, gapSize: 0.2, transparent: true, opacity: 0.8 });
    const ln = new THREE.LineSegments(lg, OVL_MAT.wind); ln.computeLineDistances(); ln.userData.own = true; B.ovl.add(ln);
  } else B.air = null;
  buildKeyLabels();
}
/* part keys view: little labels over every part that listens to keys */
function buildKeyLabels() {
  const box = $('keyLabels'); if (!box) return;
  box.innerHTML = ''; B.labels = [];
  if (!G.settings.views.keys || G.mode !== 'build') return;
  const html = [];
  B.insts.forEach((p, i) => {
    if (B.labels.length >= 160) return;
    const s = partKeySummary(p, B.forces ? B.forces.com : null); if (!s) return;
    B.labels.push({ i, el: null }); html.push(`<span class="klab${s.custom ? ' custom' : ''}">${esc(s.text)}</span>`);
  });
  box.innerHTML = html.join('');
  [...box.children].forEach((el, k) => { B.labels[k].el = el; });
}
function placeKeyLabels() {
  if (!B.labels.length) return;
  const w = window.innerWidth, h = window.innerHeight;
  B.group.updateMatrixWorld(); camera.updateMatrixWorld();
  for (const L of B.labels) {
    const p = B.insts[L.i]; if (!p) { L.el.style.display = 'none'; continue; }
    _bp.fromArray(p.cen); B.group.localToWorld(_bp).add(RO); _bp.project(camera);
    if (_bp.z > 1 || Math.abs(_bp.x) > 1.1 || Math.abs(_bp.y) > 1.1) { L.el.style.display = 'none'; continue; }
    L.el.style.display = '';
    L.el.style.transform = `translate(${((_bp.x + 1) / 2 * w).toFixed(1)}px,${((1 - _bp.y) / 2 * h).toFixed(1)}px) translate(-50%,-50%)`;
  }
}

/* slide the build camera: drag right/down moves the build with your finger or cursor */
function bPan(dx, dy) {
  const c = B.cam, k = 2 * c.dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(200, window.innerHeight);
  const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
  c.tgt.x -= cy * dx * k; c.tgt.z += sy * dx * k; c.tgt.y += dy * k;
  // stay within reach of the build
  const m = 6 + c.dist * 0.5, lo = B.bmin || [-1, -1, -1], hi = B.bmax || [1, 1, 1];
  c.tgt.x = clamp(c.tgt.x, lo[0] - m, hi[0] + m); c.tgt.y = clamp(c.tgt.y, lo[1] - 2, hi[1] + m); c.tgt.z = clamp(c.tgt.z, lo[2] - m, hi[2] + m);
  B.needsHover = true;
}
/* arrow keys slide a selection one cell, along whichever design axis is closest to that screen direction */
function bArrowNudge(code, shift) {
  const c = B.cam;
  if (shift && (code === 'ArrowUp' || code === 'ArrowDown')) { bNudge(0, code === 'ArrowUp' ? 1 : -1, 0); return; }
  // camera right and camera forward on the ground
  const rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw), fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
  let vx = 0, vz = 0;
  if (code === 'ArrowRight') { vx = rx; vz = rz; } else if (code === 'ArrowLeft') { vx = -rx; vz = -rz; }
  else if (code === 'ArrowUp') { vx = fx; vz = fz; } else if (code === 'ArrowDown') { vx = -fx; vz = -fz; }
  if (Math.abs(vx) >= Math.abs(vz)) bNudge(Math.sign(vx), 0, 0); else bNudge(0, 0, Math.sign(vz));
}
function bCamera(dt) {
  const c = B.cam;
  const sp = c.dist * 0.9 * dt, sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
  const arrowsMove = B.selSet.size > 0 && (B.tool === 'select' || B.tool === 'config');
  if (KEYS.has('KeyW')) { c.tgt.x -= sy * sp; c.tgt.z -= cy * sp; }
  if (KEYS.has('KeyS')) { c.tgt.x += sy * sp; c.tgt.z += cy * sp; }
  if (KEYS.has('KeyA')) { c.tgt.x -= cy * sp; c.tgt.z += sy * sp; }
  if (KEYS.has('KeyD')) { c.tgt.x += cy * sp; c.tgt.z -= sy * sp; }
  if (KEYS.has('KeyQ') || (!arrowsMove && KEYS.has('ArrowLeft'))) c.yaw -= dt * 1.6;
  if (KEYS.has('KeyE') || (!arrowsMove && KEYS.has('ArrowRight'))) c.yaw += dt * 1.6;
  if (!arrowsMove && KEYS.has('ArrowUp')) c.pitch = clamp(c.pitch + dt * 1.2, -0.25, 1.5);
  if (!arrowsMove && KEYS.has('ArrowDown')) c.pitch = clamp(c.pitch - dt * 1.2, -0.25, 1.5);
  if (KEYS.has('KeyW') || KEYS.has('KeyA') || KEYS.has('KeyS') || KEYS.has('KeyD') || KEYS.has('KeyQ') || KEYS.has('KeyE') || KEYS.has('ArrowLeft') || KEYS.has('ArrowRight') || KEYS.has('ArrowUp') || KEYS.has('ArrowDown')) B.needsHover = true;
  const cp = Math.cos(c.pitch);
  _bp.set(Math.sin(c.yaw) * cp, Math.sin(c.pitch), Math.cos(c.yaw) * cp).multiplyScalar(c.dist).add(c.tgt);
  B.group.updateMatrixWorld(true);
  camera.position.copy(B.group.localToWorld(_bp)).add(RO);
  camera.up.copy(WORLD.padUp);
  camera.lookAt(B.group.localToWorld(_bn.copy(c.tgt)).add(RO));
}
function rotLabel() {
  const def = PD[B.sel];
  if (isStamping()) return `${B.moving ? 'Carrying' : 'Stamping'} ${B.clip.parts.length} part${B.clip.parts.length > 1 ? 's' : ''} · Turn ${B.rotK * 90}° (${keyName(actKeys('b_rot')[0])}) · Click a face · Esc ${B.moving ? 'puts it back' : 'stops'}`;
  let rot = `Rotation ${B.rotK * 90}° (${keyName(actKeys('b_rot')[0])})`;
  if (def.kind === 'wheel' && !def.wheel.bogie) { const t = B.target; rot = `Presses ${t && t.M ? dirName(mapply(t.M, WHEEL_DN)) : B.rotK === 0 ? 'down' : B.rotK === 2 ? 'up' : 'sideways'} (${keyName(actKeys('b_rot')[0])} turns it)`; }
  const parts = [def.name, rot];
  if (def.attach === 'all') parts.push(`Tilt ${B.tilt * 90}° (${keyName(actKeys('b_tilt')[0])})`);
  return parts.join(' · ');
}
/* keys in the builder (B and Tab are handled before this) */
function builderKey(code, e, shift) {
  const A = id => isAct(id, code, shift) || (shift && isAct(id, code, false));
  if (code === 'Escape') {
    if (B.pasting) cancelPaste();
    else if (B.selSet.size) { B.selSet.clear(); refreshHighlights(); renderCtx(); }
    else setTool('build');
    return;
  }
  const selTool = B.tool === 'select' || B.tool === 'config';
  if (selTool && B.selSet.size && !B.pasting && /^Arrow/.test(code)) { bArrowNudge(code, shift); return; }
  if (A('b_build')) return setTool('build');
  if (A('b_select')) return setTool('select');
  if (A('b_config')) return setTool('config');
  if (A('b_paint')) return setTool('paint');
  if (A('b_rot')) {
    if (B.pasting || B.tool === 'build') { B.rotK = (B.rotK + (shift ? 3 : 1)) % 4; B.needsHover = true; B.ghostKey = ''; uiRot(); }
    else if (B.selSet.size) bTurnSel([0, 1, 0], shift ? -1 : 1);
    return;
  }
  if (A('b_tilt')) {
    if (B.tool === 'build' && !B.pasting) { B.tilt = (B.tilt + 1) % 4; B.needsHover = true; uiRot(); }
    else if (B.selSet.size && !B.pasting) bTurnSel([1, 0, 0], shift ? -1 : 1);
    return;
  }
  if (A('b_mirror')) return toggleView('mirror');
  if (A('b_undo')) return bUndo();
  if (A('b_redo')) return bRedo();
  if (A('b_del')) { if (selTool && B.selSet.size) bDeleteSel(); return; }
  if (A('b_copy')) return bCopySel();
  if (A('b_paste')) return bPasteMode();
  if (A('b_move')) return bMoveSel();
  if (A('b_forces')) return toggleView('forces');
  if (A('b_air')) return toggleView('air');
  if (A('b_keys')) return toggleView('keys');
  if (A('b_focus')) return bFocus(false);
}

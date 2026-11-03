'use strict';
/* ================= Scrapline · bases and colonies =================
   Bases are built from crates of parts carried in Storage Modules. Land a vehicle carrying them on any world, open
   Base mode, and set pieces down on the ground round it: habitats, greenhouse domes, corridors, solar arrays, landing
   pads, hangars, fuel tanks, comms masts, lights, walls and depots. Each piece uses up crates; taking one back puts its
   crates back aboard. A base with a habitat, a greenhouse and power is a colony. Bases are saved (and go to the cloud
   with your vehicles), show on the map, and can be picked under Spawn at. */

/* ---- the pieces (object frame: x along, y up, z across; the floor at y = 0). cols: solid boxes [w, h, d, x, y, z] ---- */
const BW = 0xe6e2d6, BG = 0x8c99a3, BD = 0x3a4148, BY = 0xf2c230, BT = 0x8fd8c8, BC = 0xb9b8b2;
const BASE_KINDS = {
  hab: { name: 'Habitat', cost: 4, w: 9, d: 5, desc: 'Living quarters for the crew.', build(g, gl) {
    g.cyl(2.2, 2.2, 7, 20, 0, 2.6, 0, BW, 0, 0, Math.PI / 2); g.sph(2.2, -3.5, 2.6, 0, BW, 0.45, 1, 1); g.sph(2.2, 3.5, 2.6, 0, BW, 0.45, 1, 1);
    for (const x of [-2.6, 0, 2.6]) g.torus(2.22, 0.08, x, 2.6, 0, BG, 0, Math.PI / 2, 0);
    g.box(6.5, 0.5, 3.4, 0, 0.25, 0, BD);
    for (const x of [-2.7, -0.9, 0.9, 2.7]) for (const z of [-1, 1]) gl.box(1.0, 0.55, 0.06, x, 3.0, z * 2.13, 0xffd98a, z * 0.35, 0, 0);
    g.box(0.7, 1.9, 0.9, 4.45, 1.45, 0, BG); gl.box(0.05, 0.3, 0.3, 4.82, 2.1, 0, 0x9fd4ff);
  }, cols: [[9, 4.6, 4.5, 0, 2.4, 0]] },
  dome: { name: 'Greenhouse', cost: 6, w: 11, d: 11, desc: 'A glass dome full of crops. Colonies need one.', build(g, gl) {
    g.cyl(5.2, 5.2, 0.6, 24, 0, 0.3, 0, BC);
    g.add(new THREE.SphereGeometry(5, 18, 9, 0, TAU, 0, Math.PI / 2), BT, 0, 0.6, 0);
    for (let k = 0; k < 6; k++) g.torus(5.03, 0.07, 0, 0.6, 0, BW, Math.PI / 2, k * Math.PI / 6, 0);
    g.torus(4.35, 0.08, 0, 3.1, 0, BW, Math.PI / 2, 0, 0);
    for (let k = 0; k < 9; k++) { const a = k / 9 * TAU, r = 1.4 + (k % 3); gl.box(0.8, 0.5, 0.8, Math.cos(a) * r, 0.9, Math.sin(a) * r, 0x7fd36a); }
  }, cols: [[9, 3, 9, 0, 1.5, 0], [6, 2.4, 6, 0, 4.0, 0]] },
  corr: { name: 'Corridor', cost: 1, w: 6, d: 3, desc: 'A tube to join two pieces.', build(g, gl) {
    g.cyl(1.25, 1.25, 6, 14, 0, 1.6, 0, BW, 0, 0, Math.PI / 2); for (const x of [-2.6, 2.6]) g.torus(1.27, 0.07, x, 1.6, 0, BG, 0, Math.PI / 2, 0);
    g.box(5.6, 0.35, 1.6, 0, 0.18, 0, BD); gl.box(4, 0.08, 0.08, 0, 2.86, 0, 0xffe2a0);
  }, cols: [[6, 2.6, 2.6, 0, 1.6, 0]] },
  solar: { name: 'Solar Array', cost: 2, w: 7, d: 5, desc: 'Power for the base. Colonies need it.', build(g, gl) {
    for (const x of [-2.3, 0, 2.3]) { g.box(0.14, 1.6, 0.14, x, 0.8, 0, BG); g.box(2.1, 0.06, 3.4, x, 1.75, 0, 0x22344f, 0.45, 0, 0); for (let k = -1; k <= 1; k++) g.box(2.12, 0.07, 0.04, x, 1.76 + k * 0.48, k * 1.06, BG, 0.45, 0, 0); }
    g.box(6.2, 0.12, 0.2, 0, 1.0, 0, BG);
  }, cols: [[6.6, 2.4, 3.4, 0, 1.2, 0]] },
  pad: { name: 'Landing Pad', cost: 4, w: 16, d: 16, flat: true, desc: 'A flat pad to land on and drive onto, with lights at its corners.', build(g, gl) {
    g.box(14, 0.3, 14, 0, 0.15, 0, BC); g.torus(4.5, 0.25, 0, 0.31, 0, BY, Math.PI / 2, 0, 0);
    g.box(5, 0.02, 0.6, 0, 0.32, 0, BY); g.box(0.6, 0.02, 5, 0, 0.32, 0, BY);
    for (const [x, z] of [[-6.6, -6.6], [6.6, -6.6], [-6.6, 6.6], [6.6, 6.6]]) { g.box(0.4, 0.5, 0.4, x, 0.55, z, BD); gl.box(0.3, 0.2, 0.3, x, 0.9, z, 0xff9a3b); }
  }, cols: [[14, 0.3, 14, 0, 0.15, 0]], ramps: 14 },
  hangar: { name: 'Hangar', cost: 8, w: 14, d: 14, desc: 'A big shed, open at the front, to park vehicles in.', build(g, gl) {
    g.box(13, 0.3, 13, 0, 0.15, 0, BC);
    g.box(13, 7, 0.4, 0, 3.5, -6.3, BG); g.box(13, 7, 0.4, 0, 3.5, 6.3, BG); g.box(0.4, 7, 13, -6.3, 3.5, 0, BG);
    g.box(13.6, 0.5, 13.6, 0, 7.25, 0, BD); for (const z of [-6.5, 6.5]) g.box(0.6, 7, 0.6, 6.3, 3.5, z, BY);
    for (const z of [-3, 0, 3]) gl.box(2.4, 0.1, 0.4, 0, 6.9, z, 0xfff1c4);
  }, cols: [[13, 0.3, 13, 0, 0.15, 0], [13, 7, 0.4, 0, 3.5, -6.3], [13, 7, 0.4, 0, 3.5, 6.3], [0.4, 7, 13, -6.3, 3.5, 0], [13.6, 0.5, 13.6, 0, 7.25, 0]], ramps: 13, rampSides: [1] },
  tank: { name: 'Fuel Tank', cost: 3, w: 6, d: 6, desc: 'A big round tank for fuel.', build(g, gl) {
    g.sph(2.4, 0, 3.4, 0, BW); g.torus(2.42, 0.1, 0, 3.4, 0, BG, Math.PI / 2, 0, 0);
    for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + 0.785; g.box(0.25, 2.4, 0.25, Math.cos(a) * 1.8, 1.2, Math.sin(a) * 1.8, BG); }
    g.cyl(0.15, 0.15, 3, 8, 0, 6, 0, BG); g.box(1.8, 0.4, 0.4, 0, 0.2, 2.6, BD);
  }, cols: [[4.6, 5.8, 4.6, 0, 2.9, 0]] },
  comms: { name: 'Comms Mast', cost: 2, w: 4, d: 4, desc: 'A tall mast with a dish, to talk home.', build(g, gl) {
    for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) g.box(0.12, 12, 0.12, x * (1 - 0), 6, z, BG);
    for (let y = 1; y < 12; y += 1.5) { g.box(1.3, 0.08, 0.08, 0, y, -0.6, BG); g.box(1.3, 0.08, 0.08, 0, y, 0.6, BG); g.box(0.08, 0.08, 1.3, -0.6, y, 0, BG); g.box(0.08, 0.08, 1.3, 0.6, y, 0, BG); }
    g.add(new THREE.SphereGeometry(1.5, 16, 6, 0, TAU, 0, 0.9), BW, 0.4, 10.5, 0, 0, 0, 1.2); g.cyl(0.05, 0.05, 1.4, 6, 1.0, 10.6, 0, BG, 0, 0, 1.2);
    gl.box(0.3, 0.3, 0.3, 0, 12.15, 0, 0xff3b2b);
  }, cols: [[1.6, 12, 1.6, 0, 6, 0]] },
  lamp: { name: 'Light Mast', cost: 1, w: 2, d: 2, desc: 'A floodlight on a pole.', build(g, gl) {
    g.cyl(0.12, 0.16, 8, 8, 0, 4, 0, BG); g.box(0.5, 0.5, 0.5, 0, 0.25, 0, BD); g.box(1.2, 0.25, 0.6, 0.3, 8, 0, BD); gl.box(1.0, 0.06, 0.45, 0.3, 7.86, 0, 0xfff1c4);
  }, cols: [[0.6, 8, 0.6, 0, 4, 0]] },
  depot: { name: 'Supply Depot', cost: 2, w: 7, d: 4, desc: 'A stack of shipping containers.', build(g, gl) {
    g.box(6, 2.5, 2.4, 0, 1.25, -0.1, 0xc8432f); g.box(6, 2.5, 2.4, 0.4, 3.75, 0.1, 0x2f6f9f); for (const x of [-2.9, 2.9]) g.box(0.12, 2.5, 2.42, x, 1.25, -0.1, 0x8a2e20);
  }, cols: [[6.8, 5, 2.8, 0.2, 2.5, 0]] },
  wall: { name: 'Wall', cost: 1, w: 6, d: 1.5, desc: 'A concrete wall section.', build(g, gl) {
    g.box(6, 2.6, 0.5, 0, 1.3, 0, BC); g.box(6.1, 0.2, 0.7, 0, 2.7, 0, BG);
  }, cols: [[6, 2.8, 0.5, 0, 1.4, 0]] }
};
const BASE_ORDER = ['hab', 'corr', 'dome', 'solar', 'pad', 'hangar', 'tank', 'comms', 'lamp', 'depot', 'wall'];

/* ---- state: every base and every piece, saved in this browser (and to the cloud) ---- */
const BASES = { t: 0, bases: [], pieces: [], built: new Map(), mode: null, ghost: null, labels: [] };
function basesState() { return { t: BASES.t, bases: BASES.bases, pieces: BASES.pieces }; }
function basesSave() { BASES.t = Date.now(); LS.set('scrapline.bases', basesState()); if (typeof cloudChanged === 'function') cloudChanged(); }
function mergeBases(a, b) { if (!a) return b || null; if (!b) return a; return (b.t || 0) > (a.t || 0) ? b : a; }
function setBasesState(st) {
  if (!st || (st.t || 0) === BASES.t) return;
  for (const id of [...BASES.built.keys()]) unbuildPiece(id);
  BASES.t = st.t || 0; BASES.bases = Array.isArray(st.bases) ? st.bases : []; BASES.pieces = Array.isArray(st.pieces) ? st.pieces : [];
  LS.set('scrapline.bases', basesState());
  for (const p of BASES.pieces) buildPiece(p);
  basesChanged();
}
function basesLoad() {
  const st = LS.get('scrapline.bases', null);
  if (st && Array.isArray(st.pieces)) { BASES.t = st.t || 0; BASES.bases = st.bases || []; BASES.pieces = st.pieces.filter(p => BASE_KINDS[p.kind] && celByName(p.cel)); }
  for (const p of BASES.pieces) buildPiece(p);
  basesChanged(false);
}
const celByName = n => CELS.find(c => c.name === n) || null;
const baseFrameDirs = (b) => { const C = new V3().fromArray(b.d), E1 = new V3(), E3 = new V3(); tangentBasis(C.x, C.y, C.z, E1, E3); return { C, E1, E3 }; };

/* ---- where a piece stands, as a matrix in its world's own frame ---- */
function pieceMatrix(p, out = new THREE.Matrix4()) {
  const cel = celByName(p.cel), up = new V3().fromArray(p.d).normalize(), t1 = new V3(), t2 = new V3();
  const b = BASES.bases.find(x => x.id === p.base);
  // turned against the base's own north, so every piece of a base lines up
  if (b) { const f = baseFrameDirs(b); t1.copy(f.E1).addScaledVector(up, -f.E1.dot(up)).normalize(); } else tangentBasis(up.x, up.y, up.z, t1, t2);
  t2.crossVectors(up, t1);
  const X = t1.clone().multiplyScalar(Math.cos(p.yaw)).addScaledVector(t2, Math.sin(p.yaw)), Z = new V3().crossVectors(X, up);
  return out.makeBasis(X, up, Z).setPosition(up.multiplyScalar(cel.R + p.h));
}
/* the ground under a footprint: its highest and lowest points (the piece sits on the highest, a plinth fills below) */
function footHeights(cel, M, w, d) {
  const o = new V3(), q = new V3(); let hi = -1e9, lo = 1e9;
  for (const [sx, sz] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
    q.set(sx * w / 2, 0, sz * d / 2).applyMatrix4(M); o.copy(q).normalize();
    const h = cel.height(o.x, o.y, o.z), hs = cel.sea && !cel.sea.lava ? h : h; hi = Math.max(hi, hs); lo = Math.min(lo, h);
  }
  return { hi, lo };
}
function pieceGeo(kind, depth) {
  const K = BASE_KINDS[kind], g = new GB(), gl = new GB();
  K.build(g, gl);
  // a plinth down into the ground, so the piece never floats on a slope
  if (depth > 0.05) g.box(K.w * 0.92, depth + 0.6, K.d * 0.92, 0, -depth / 2 - 0.25, 0, 0x6f6d68);
  if (K.ramps) for (const s of K.rampSides || [0, 1, 2, 3]) { const a = s * Math.PI / 2, L = K.ramps / 2; g.add(new THREE.BoxGeometry(K.ramps, 0.3, 2.2), BC, Math.cos(a) * (L + 1.0), 0.05, Math.sin(a) * (L + 1.0), -0.13, -a + Math.PI / 2, 0); }
  return { body: g.geometry(), glow: gl.P.length ? gl.geometry() : null };
}
function siteGroup(cel) {
  let g = SITES.groups.get(cel);
  if (!g) { g = new THREE.Group(); scene.add(g); SITES.groups.set(cel, g); }
  return g;
}
function buildPiece(p) {
  const cel = celByName(p.cel), K = BASE_KINDS[p.kind]; if (!cel || !K) return;
  const M = pieceMatrix(p), geo = pieceGeo(p.kind, p.depth || 0), grp = siteGroup(cel), meshes = [];
  const m = new THREE.Mesh(geo.body, MAT.site); m.matrixAutoUpdate = false; m.matrix.copy(M); m.castShadow = true; m.receiveShadow = true; grp.add(m); meshes.push(m);
  if (geo.glow) { const gm = new THREE.Mesh(geo.glow, MAT.glow); gm.matrixAutoUpdate = false; gm.matrix.copy(M); grp.add(gm); meshes.push(gm); }
  const cols = [];
  for (const [w, h, d, x, y, z] of K.cols) {
    const V = []; for (let i = 0; i < 8; i++) V.push(new V3(x + (i & 4 ? w : -w) / 2, y + (i & 2 ? h : -h) / 2, z + (i & 1 ? d : -d) / 2).applyMatrix4(M));
    cols.push(makeCollider(V, BOX_F, cel, 'base'));
  }
  // ramps up onto a pad or a hangar floor
  if (K.ramps) for (const s of K.rampSides || [0, 1, 2, 3]) {
    const a = s * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a), L = K.ramps / 2, V = [];
    for (let i = 0; i < 8; i++) { const out = i & 4 ? L + 2.2 : L, across = (i & 1 ? 1 : -1) * L, y = i & 2 ? (i & 4 ? -0.15 : 0.3) : -0.6; V.push(new V3(ca * out - sa * across, y, sa * out + ca * across).applyMatrix4(M)); }
    cols.push(makeCollider(V, BOX_F, cel, 'base', [0, 1]));
  }
  BASES.built.set(p.id, { meshes, cols, cel });
}
function removeCollider(pr) {
  const i = W.props.indexOf(pr); if (i >= 0) W.props.splice(i, 1);
  const ci = CELS.indexOf(pr.cel), s = PG.size, c = pr.c, r = pr.r;
  for (let a = Math.floor((c.x - r) / s); a <= Math.floor((c.x + r) / s); a++)
    for (let b = Math.floor((c.y - r) / s); b <= Math.floor((c.y + r) / s); b++)
      for (let k = Math.floor((c.z - r) / s); k <= Math.floor((c.z + r) / s); k++) {
        const l = PG.map.get(pgKey(ci, a, b, k)); if (!l) continue;
        const j = l.indexOf(pr); if (j >= 0) l.splice(j, 1);
      }
}
function unbuildPiece(id) {
  const b = BASES.built.get(id); if (!b) return;
  for (const m of b.meshes) { if (m.parent) m.parent.remove(m); m.geometry.dispose(); }
  for (const c of b.cols) removeCollider(c);
  BASES.built.delete(id);
}
/* a base is a colony once it has somewhere to live, food and power */
function baseIsColony(b) { const k = new Set(BASES.pieces.filter(p => p.base === b.id).map(p => p.kind)); return k.has('hab') && k.has('dome') && k.has('solar'); }
function baseTitle(b) { return `${b.name}${baseIsColony(b) ? ' (colony)' : ''}`; }
/* bases under Spawn at, and their labels on the map */
function basesChanged(refill = true) {
  for (const k of Object.keys(WORLD.locs)) if (k.startsWith('base_')) delete WORLD.locs[k];
  for (const b of BASES.bases) {
    const cel = celByName(b.cel); if (!cel || !BASES.pieces.some(p => p.base === b.id)) continue;
    const f = baseFrameDirs(b), pad = BASES.pieces.find(p => p.base === b.id && p.kind === 'pad');
    // on its landing pad if it has one, otherwise just beside the base
    const dir = pad ? new V3().fromArray(pad.d) : expDir(f.C, f.E1, f.E3, cel.R, -28, 0, new V3());
    WORLD.locs['base_' + b.id] = { name: baseTitle(b), kind: 'surface', cel, dir, fwd: f.E1.clone(), group: 'Your bases', hAbs: pad ? pad.h + 0.4 : undefined };
  }
  if (refill && typeof fillSpawnSel === 'function') fillSpawnSel();
}
function baseLabels(vis, w, h, me) {
  const L = BASES.labels;
  let n = 0;
  for (const b of BASES.bases) {
    const cel = celByName(b.cel); if (!cel || !BASES.pieces.some(p => p.base === b.id)) continue;
    if (camera.position.distanceTo(cel.center) > cel.R * 9) continue;
    const pos = fromSpin(cel, new V3().fromArray(b.d), new V3()).multiplyScalar(cel.R + (b.h || 0) + 30).add(cel.center);
    if (_lp.subVectors(camera.position, pos).dot(_lp2.subVectors(pos, cel.center)) < 0) continue;
    const sp = screenOf(pos, w, h); if (!sp) continue;
    let el = L[n]; if (!el) { el = L[n] = document.createElement('div'); el.className = 'mapLabel'; el.dataset.kind = 'base'; MAP.labels.appendChild(el); }
    n++; vis.push({ el, x: sp.x, y: sp.y, k: 'place', txt: baseTitle(b), d: me.distanceTo(pos) });
  }
  for (let i = n; i < L.length; i++) L[i].hidden = true;
}

/* ---- crates aboard: Storage Modules on the vehicle you drive ---- */
function storageParts(b) { return b && !b.dead ? machineOf(b).flatMap(o => o.parts.filter(p => p.alive && p.def.storage)) : []; }
function cratesAboard(b) { return storageParts(b).reduce((s, p) => s + (p.crates ?? p.def.storage), 0); }
function takeCrates(b, n) { for (const p of storageParts(b)) { const c = p.crates ?? p.def.storage, k = Math.min(c, n); p.crates = c - k; n -= k; if (!n) break; } }
function giveCrates(b, n) { for (const p of storageParts(b)) { const c = p.crates ?? p.def.storage, k = Math.min(p.def.storage - c, n); p.crates = c + k; n -= k; if (!n) break; } return n; }

/* ---- Base mode: the palette, the ghost, placing and taking back ---- */
const BASE_RANGE = 160;
function canBaseMode(b) {
  if (!b || b.dead || G.mode !== 'drive' || G.map) return false;
  const cel = b.groundCel || null; if (!cel || cel.kind !== 'rocky') return false;
  const spd = b.v.clone().sub(surfaceVel(cel, b.x, new V3())).length();
  if (spd > 2.5) return false;
  return cratesAboard(b) > 0 || nearBase(cel, b.x) !== null;
}
function nearBase(cel, x, range = 400) {
  const lp = toSpin(cel, new V3().subVectors(x, cel.center), new V3()).normalize();
  let best = null, bd = range;
  for (const b of BASES.bases) { if (b.cel !== cel.name) continue; const d = new V3().fromArray(b.d).distanceTo(lp) * cel.R; if (d < bd) { bd = d; best = b; } }
  return best;
}
function enterBaseMode() {
  const b = G.player; if (!canBaseMode(b)) { toast('Land and stop first, with Storage Modules aboard (they carry the crates of base parts)', 2800); return; }
  BASES.mode = { kind: 'hab', yaw: 0, remove: false, cel: b.groundCel, hover: null, valid: false, why: '' };
  G.chase = false; DC.dist = Math.max(DC.dist, 45); DC.pitch = Math.max(DC.pitch, 0.6);
  for (const o of machineOf(b)) { clearInputs(o); o.ctl.brake = 1; }
  renderBasePanel();
}
function exitBaseMode() {
  BASES.mode = null; if (BASES.ghost) { BASES.ghost.parent && BASES.ghost.parent.remove(BASES.ghost); BASES.ghost = null; }
  $('basePanel').hidden = true;
}
function renderBasePanel() {
  const el = $('basePanel'), M = BASES.mode; if (!M) { el.hidden = true; return; }
  const n = cratesAboard(G.player);
  el.hidden = false;
  el.innerHTML = `<div class="bphead"><b>Base mode</b><span class="crates">${n} crate${n === 1 ? '' : 's'} aboard</span><span class="grow"></span>
      <button type="button" class="btn${M.remove ? ' on' : ''}" data-bp="remove" title="Take a piece back: its crates go back aboard">Take back</button>
      <button type="button" class="btn" data-bp="turn" title="Turn the piece (${esc(keyName(actKeys('b_rot')[0]))})">Turn</button>
      <button type="button" class="btn primary" data-bp="done">Done</button></div>
    <div class="bplist">${BASE_ORDER.map(k => { const K = BASE_KINDS[k]; return `<button type="button" class="bpc${!M.remove && M.kind === k ? ' on' : ''}${K.cost > n ? ' poor' : ''}" data-bk="${k}" title="${esc(K.desc)}"><span>${esc(K.name)}</span><em>${K.cost} crate${K.cost === 1 ? '' : 's'}</em></button>`; }).join('')}</div>
    <div class="bphint" id="bpHint">${esc(M.why || (M.remove ? `${COARSE ? 'Tap' : 'Click'} a piece to take it back.` : `${COARSE ? 'Tap' : 'Click'} the ground to set down a ${BASE_KINDS[M.kind].name}. ${keyName(actKeys('b_rot')[0])} turns it.`))}</div>`;
}
/* the ground under the pointer: a march along the ray, then a closer look */
function groundUnder(cel, x, y) {
  const r = new THREE.Raycaster(); r.setFromCamera(new THREE.Vector2(x / window.innerWidth * 2 - 1, -(y / window.innerHeight) * 2 + 1), camera);
  const o = r.ray.origin, d = r.ray.direction, p = new V3(), dir = new V3();
  const f = t => { p.copy(o).addScaledVector(d, t).sub(cel.center); const rr = p.length(); toSpin(cel, p, dir).divideScalar(rr); let h = cel.height(dir.x, dir.y, dir.z); if (cel.sea) h = Math.max(h, 0); return rr - cel.R - h; };
  let t0 = 0, f0 = f(0), t = 0, step = 2;
  for (let i = 0; i < 400 && t < 3000; i++) {
    t += step; step = Math.max(2, t * 0.02);
    const ft = f(t);
    if (ft < 0) { let lo = t0, hi = t; for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; } return toSpin(cel, p.copy(o).addScaledVector(d, hi).sub(cel.center), new V3()); }
    t0 = t; f0 = ft;
  }
  return null;
}
/* a candidate piece at a ground point: snapped to the base's 2 m grid, standing on the highest ground under it */
function candidate(cel, lp, kind, yaw) {
  const b = G.player, near = nearBase(cel, b.x, 400);
  const dir = lp.clone().normalize();
  let base = near, d = dir;
  if (near) {
    const f = baseFrameDirs(near), u = Math.round(dir.clone().sub(f.C).dot(f.E1) * cel.R / 2) * 2, v = Math.round(dir.clone().sub(f.C).dot(f.E3) * cel.R / 2) * 2;
    d = expDir(f.C, f.E1, f.E3, cel.R, u, v, new V3());
  }
  const p = { id: null, kind, cel: cel.name, d: d.toArray(), yaw, h: 0, depth: 0, base: base ? base.id : null };
  const K = BASE_KINDS[kind], M = pieceMatrix(p), fh = footHeights(cel, M, K.w * 0.9, K.d * 0.9);
  p.h = fh.hi; p.depth = fh.hi - fh.lo;
  // the reasons it cannot go here
  let why = '';
  const vlp = toSpin(cel, new V3().subVectors(b.x, cel.center), new V3());
  if (d.clone().multiplyScalar(cel.R).distanceTo(vlp.clone().normalize().multiplyScalar(cel.R)) > BASE_RANGE) why = `Too far from your vehicle: build within ${BASE_RANGE} m of it`;
  else if (cel.sea && !cel.sea.lava && fh.lo < 0.3) why = "Not in the water: pick dry ground";
  else if (cel.sea && cel.sea.lava && fh.lo < 0.3) why = 'Not in the lava!';
  else if (p.depth > 6) why = 'Too steep here: find flatter ground';
  else if (BASES.pieces.some(q => q.cel === cel.name && overlap(p, q))) why = 'Something is already there';
  else if (cratesAboard(b) < K.cost) why = `Needs ${K.cost} crates: you have ${cratesAboard(b)}`;
  else if (vehicleInside(p, cel)) why = 'Your vehicle is in the way';
  return { p, why };
}
/* two footprints (turned rectangles on the ground) overlapping */
function rectOf(p) { const cel = celByName(p.cel), M = pieceMatrix(p), K = BASE_KINDS[p.kind]; const c = new V3().setFromMatrixPosition(M), X = new V3().setFromMatrixColumn(M, 0), Z = new V3().setFromMatrixColumn(M, 2); return { c, X, Z, a: K.w / 2 - 0.3, b: K.d / 2 - 0.3, cel }; }
function overlap(p, q) {
  const A = rectOf(p), B = rectOf(q); if (A.c.distanceTo(B.c) > Math.hypot(A.a, A.b) + Math.hypot(B.a, B.b)) return false;
  const D = new V3().subVectors(B.c, A.c);
  for (const ax of [A.X, A.Z, B.X, B.Z]) {
    const ra = A.a * Math.abs(A.X.dot(ax)) + A.b * Math.abs(A.Z.dot(ax)), rb = B.a * Math.abs(B.X.dot(ax)) + B.b * Math.abs(B.Z.dot(ax));
    if (Math.abs(D.dot(ax)) > ra + rb) return false;
  }
  return true;
}
function vehicleInside(p, cel) {
  const A = rectOf(p);
  for (const o of machineOf(G.player)) { const lp = toSpin(cel, new V3().subVectors(o.x, cel.center), new V3()), D = lp.sub(A.c); if (Math.abs(D.dot(A.X)) < A.a + o.radius * 0.6 && Math.abs(D.dot(A.Z)) < A.b + o.radius * 0.6) return true; }
  return false;
}
const _bgM = new THREE.Matrix4();
function baseHover(x, y) {
  const M = BASES.mode; if (!M) return;
  const cel = M.cel, lp = groundUnder(cel, x, y);
  if (!lp) { M.valid = false; if (BASES.ghost) BASES.ghost.visible = false; return; }
  if (M.remove) {
    const hit = BASES.pieces.filter(p => p.cel === cel.name).find(p => { const R = rectOf(p), D = lp.clone().sub(R.c); return Math.abs(D.dot(R.X)) < R.a + 0.3 && Math.abs(D.dot(R.Z)) < R.b + 0.3; });
    M.hover = hit || null; M.why = hit ? `Take back the ${BASE_KINDS[hit.kind].name}: ${BASE_KINDS[hit.kind].cost} crates go back aboard` : 'Click a piece to take it back.';
    setBaseGhost(hit ? hit.kind : null, hit, false);
  } else {
    const c = candidate(cel, lp, M.kind, M.yaw); M.cand = c.p; M.valid = !c.why; M.why = c.why;
    setBaseGhost(M.kind, c.p, M.valid);
  }
  const h = $('bpHint'); if (h) h.textContent = M.why || `Click to set down the ${BASE_KINDS[M.kind].name}. ${keyName(actKeys('b_rot')[0])} turns it.`;
}
function setBaseGhost(kind, p, ok) {
  if (BASES.ghost && BASES.ghost.userData.kind !== kind) { BASES.ghost.parent && BASES.ghost.parent.remove(BASES.ghost); BASES.ghost.geometry.dispose(); BASES.ghost = null; }
  if (!kind || !p) { if (BASES.ghost) BASES.ghost.visible = false; return; }
  if (!BASES.ghost) {
    const geo = pieceGeo(kind, 0).body;
    BASES.ghost = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x6fe0a8, transparent: true, opacity: 0.45, depthWrite: false }));
    BASES.ghost.userData.kind = kind; BASES.ghost.matrixAutoUpdate = false; BASES.ghost.renderOrder = 6;
  }
  const g = BASES.ghost, grp = siteGroup(celByName(p.cel)); if (g.parent !== grp) grp.add(g);
  g.visible = true; g.matrix.copy(pieceMatrix(p, _bgM));
  g.material.color.setHex(BASES.mode && BASES.mode.remove ? 0xffa040 : ok ? 0x6fe0a8 : 0xff5a40);
}
function baseClick(x, y, btn) {
  const M = BASES.mode; if (!M) return;
  baseHover(x, y);
  if (btn === 2 || M.remove) {
    const p = M.remove ? M.hover : null;
    if (!p) return;
    const left = giveCrates(G.player, BASE_KINDS[p.kind].cost);
    if (left === BASE_KINDS[p.kind].cost) { toast('No room aboard for its crates: bring an empty Storage Module', 2400); return; }
    unbuildPiece(p.id); BASES.pieces.splice(BASES.pieces.indexOf(p), 1);
    BASES.bases = BASES.bases.filter(b => BASES.pieces.some(q => q.base === b.id));
    SND.play('pop'); basesSave(); basesChanged(); renderBasePanel(); baseHover(x, y);
    return;
  }
  if (!M.valid || !M.cand) { if (M.why) toast(M.why, 1800); return; }
  const p = M.cand;
  p.id = newId();
  if (!p.base) {
    // the first piece starts a new base, named after its world
    const n = BASES.bases.filter(b => b.cel === p.cel).length + 1, cel = celByName(p.cel);
    const b = { id: newId(), cel: p.cel, d: p.d.slice(), h: p.h, name: `${cel.name} Base${n > 1 ? ' ' + n : ''}`, made: Date.now() };
    BASES.bases.push(b); p.base = b.id;
  }
  takeCrates(G.player, BASE_KINDS[p.kind].cost);
  BASES.pieces.push(p); buildPiece(p);
  const b = BASES.bases.find(x => x.id === p.base), wasColony = b.colony;
  b.colony = baseIsColony(b);
  SND.play('place'); basesSave(); basesChanged(); renderBasePanel(); baseHover(x, y);
  if (b.colony && !wasColony) toast(`${b.name} is now a colony: it has a habitat, a greenhouse and power`, 3600);
}
function initBases() {
  basesLoad();
  $('basePanel').onclick = e => {
    const t = e.target.closest('button'); if (!t) return; t.blur();
    const M = BASES.mode; if (!M) return;
    if (t.dataset.bk) { M.kind = t.dataset.bk; M.remove = false; renderBasePanel(); }
    if (t.dataset.bp === 'remove') { M.remove = !M.remove; renderBasePanel(); }
    if (t.dataset.bp === 'turn') baseTurn();
    if (t.dataset.bp === 'done') exitBaseMode();
  };
}
function baseTurn() { const M = BASES.mode; if (!M) return; M.yaw = (M.yaw + Math.PI / 4) % TAU; if (BASES.lastXY) baseHover(...BASES.lastXY); }

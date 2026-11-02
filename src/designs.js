'use strict';
/* ================= Scrapline · designs, examples, connectivity ================= */
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const NDIRS = DIRS.map(d => [-d[0], -d[1], -d[2]]);
let PUID = 0;
class PartInst {
  constructor(t, a, m, c, uid, cfg) {
    const def = this.def = PD[t];
    this.t = t; this.a = a; this.m = m; this.c = c; this.uid = uid || ++PUID; this.cfg = cfg || null;
    this.hp = def.hp; this.alive = true; this.body = null; this.mass = def.mass; this.broken = false; this.fuel = def.fuel || 0;
    this.cells = footprint(def, a, m);
    this.keys = this.cells.map(c => ckey(c[0], c[1], c[2]));
    let sx = 0, sy = 0, sz = 0; for (const c of this.cells) { sx += c[0]; sy += c[1]; sz += c[2]; }
    const n = this.cells.length;
    this.cen = [sx / n * CELL, sy / n * CELL, sz / n * CELL];
    this.mountDir = mapply(m, [0, -1, 0]); this.topDir = mapply(m, [0, 1, 0]);
    this.aKey = ckey(a[0], a[1], a[2]);
    if (def.attach === 'ends') {
      let my = -99; for (const f of def.cells) my = Math.max(my, f[1]);
      this.topKeys = new Set(); def.cells.forEach((f, i) => { if (f[1] === my) this.topKeys.add(this.keys[i]); });
    }
    this.m4 = m4From(m, a);
  }
  allows(k, d) {
    const at = this.def.attach;
    if (at === 'all') return true;
    if (k === this.aKey && d[0] === this.mountDir[0] && d[1] === this.mountDir[1] && d[2] === this.mountDir[2]) return true;
    if (at === 'ends' && this.topKeys.has(k) && d[0] === this.topDir[0] && d[1] === this.topDir[1] && d[2] === this.topDir[2]) return true;
    return false;
  }
}
function partAdjacency(parts) {
  const grid = new Map(); for (const p of parts) for (const k of p.keys) grid.set(k, p);
  const adj = new Map(parts.map(p => [p, []]));
  for (const p of parts) {
    for (let i = 0; i < p.cells.length; i++) {
      const c = p.cells[i];
      for (let di = 0; di < 6; di++) {
        const d = DIRS[di];
        if (!p.allows(p.keys[i], d)) continue;
        const nk = ckey(c[0] + d[0], c[1] + d[1], c[2] + d[2]);
        const q = grid.get(nk);
        if (q && q !== p && q.allows(nk, NDIRS[di])) adj.get(p).push(q);
      }
    }
  }
  return adj;
}
function partDistances(parts, from) {
  const adj = partAdjacency(parts), dist = new Map([[from, 0]]), q = [from];
  while (q.length) { const p = q.shift(); for (const r of adj.get(p) || []) if (!dist.has(r)) { dist.set(r, dist.get(p) + 1); q.push(r); } }
  return dist;
}
function nozzleBlocked(p, grid) {
  if (!p.topKeys) return false;
  for (let i = 0; i < p.cells.length; i++) {
    if (!p.topKeys.has(p.keys[i])) continue;
    const c = p.cells[i], q = grid.get(ckey(c[0] + p.topDir[0], c[1] + p.topDir[1], c[2] + p.topDir[2]));
    if (q && q !== p) return true;
  }
  return false;
}
function partComponents(parts) {
  const adj = partAdjacency(parts);
  const seen = new Set(), comps = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    const comp = [], st = [p]; seen.add(p);
    while (st.length) { const q = st.pop(); comp.push(q); for (const r of adj.get(q)) if (!seen.has(r)) { seen.add(r); st.push(r); } }
    comps.push(comp);
  }
  return comps;
}
/* split a vehicle at its moving parts: each piece becomes its own body, joined by a joint */
function assemblySplit(parts) {
  const grid = new Map(); for (const p of parts) for (const k of p.keys) grid.set(k, p);
  const links = [], cut = new Set();
  for (const p of parts) {
    if (p.def.kind !== 'joint') continue;
    const c = p.cells[0], t = p.topDir, nk = ckey(c[0] + t[0], c[1] + t[1], c[2] + t[2]), q = grid.get(nk);
    if (q && q !== p && q.allows(nk, [-t[0], -t[1], -t[2]])) { links.push({ jp: p, ap: q }); cut.add(p.uid + ':' + q.uid); cut.add(q.uid + ':' + p.uid); }
  }
  const adj = partAdjacency(parts), seen = new Set(), comps = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    const comp = [], st = [p]; seen.add(p);
    while (st.length) { const q = st.pop(); comp.push(q); for (const r of adj.get(q)) if (!seen.has(r) && !cut.has(q.uid + ':' + r.uid)) { seen.add(r); st.push(r); } }
    comps.push(comp);
  }
  return { comps, links };
}
/* moving parts that can't move: nothing on top, or what's on top is also tied to the rest of the vehicle */
function lockedJoints(parts) {
  const out = [];
  if (!parts.some(p => p.def.kind === 'joint')) return out;
  const { comps, links } = assemblySplit(parts);
  const compOf = new Map(); comps.forEach((c, i) => { for (const p of c) compOf.set(p, i); });
  for (const p of parts) {
    if (p.def.kind !== 'joint') continue;
    const l = links.find(l => l.jp === p);
    if (!l) out.push([parts.indexOf(p), 'empty', p.def.joint.type]);
    else if (compOf.get(l.jp) === compOf.get(l.ap)) out.push([parts.indexOf(p), 'tied', p.def.joint.type]);
  }
  return out;
}
function instantiate(design) { return design.parts.filter(p => PD[p.t]).map(p => new PartInst(p.t, p.a.slice(), p.m.slice(), p.c, 0, p.cfg ? { ...p.cfg } : null)); }

/* lowest point of a design (meters, design Y), including wheel and leg reach */
function designBottom(parts) {
  let lo = 1e9;
  for (const p of parts) {
    const def = PD[p.t];
    const cells = footprint(def, p.a, p.m);
    if (def.kind === 'wheel') {
      const h = mapply(p.m, [0, def.wheel.hubY, 0]);
      lo = Math.min(lo, p.a[1] * CELL + h[1] - def.wheel.r);
    } else if (def.kind === 'gear') {
      const h = mapply(p.m, [0, def.gear.drop, 0]);
      lo = Math.min(lo, p.a[1] * CELL + h[1] - def.gear.r);
      for (const c of cells) lo = Math.min(lo, c[1] * CELL - CELL / 2);
    } else if (def.kind === 'leg') {
      lo = Math.min(lo, p.a[1] * CELL - def.leg.drop - def.leg.r * .6);
    } else for (const c of cells) lo = Math.min(lo, c[1] * CELL - CELL / 2);
  }
  return lo === 1e9 ? -0.25 : lo;
}
function designStats(design) {
  const parts = instantiate(design);
  const grid = new Map(); for (const p of parts) for (const k of p.keys) grid.set(k, p);
  let nTracks = 0, hover = 0, dry = 0, fuel = 0, power = 0, nWheels = 0, rocket = 0, jet = 0, prop = 0, boat = 0, area = 0, buoyKg = 0, torque = 0, cells = 0, veSum = 0, joints = 0;
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const p of parts) {
    const d = p.def; dry += d.mass; if (d.fuel) fuel += d.fuel;
    // power and thrust limits from each part's settings
    const pk = d.kind === 'rocket' || d.kind === 'jet' || d.kind === 'prop' || d.kind === 'boatprop' || d.kind === 'engine' || d.kind === 'wheel' || d.kind === 'gyro' ? cfgGet(p, 'power') / 100 : 1;
    if (d.kind === 'wheel' && Math.abs(mapply(p.m, [0, 1, 0])[1]) < 0.5) { nWheels++; if (d.wheel.track) nTracks++; power += d.wheel.power * pk; }
    if (d.kind === 'hover') hover++;
    if (d.kind === 'engine') power += d.power * pk;
    if (d.kind === 'rocket' && !nozzleBlocked(p, grid) && !d.ion) { rocket += d.thrust * pk; veSum += d.thrust * pk * (d.ve || VE); }
    if (d.kind === 'joint') joints++;
    if (d.kind === 'jet') jet += d.thrust * pk;
    if (d.kind === 'prop') prop += d.thrust * pk;
    if (d.kind === 'boatprop') boat += d.thrust * pk;
    if (d.kind === 'wing' || d.kind === 'flap') area += d.area;
    if (d.kind === 'gyro' || d.kind === 'rcs') torque += d.torque * pk;
    for (const c of p.cells) { buoyKg += RHO_W * CELL * CELL * CELL * d.buoy; cells++; for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], c[i]); mx[i] = Math.max(mx[i], c[i]); } }
  }
  const seat = parts.find(p => p.def.kind === 'seat');
  let loose = 0;
  if (parts.length) {
    const comps = partComponents(parts);
    // a trailer hitched on by two couplers that touch counts as attached
    const cp = parts.filter(p => p.def.kind === 'coupler');
    for (const a of cp) for (const b of cp) {
      if (a === b) continue;
      const c = a.cells[0], t = a.topDir; if (!b.cells.some(q => q[0] === c[0] + t[0] && q[1] === c[1] + t[1] && q[2] === c[2] + t[2])) continue;
      const ia = comps.findIndex(x => x.includes(a)), ib = comps.findIndex(x => x.includes(b));
      if (ia >= 0 && ib >= 0 && ia !== ib) { comps[ia] = comps[ia].concat(comps[ib]); comps.splice(ib, 1); }
    }
    const main = seat ? comps.find(c => c.includes(seat)) : comps.reduce((a, c) => c.length > a.length ? c : a, []); loose = parts.length - main.length;
  }
  const total = dry + fuel;
  // a tower on a Ground Anchor doesn't fly: rate the rocket on the stage with the seat
  const anchored = parts.some(p => p.def.kind === 'anchor');
  let rT = rocket, vS = veSum, sDry = dry, sFuel = fuel;
  if (anchored && seat) {
    const top = partComponents(parts.filter(p => p.def.kind !== 'decoupler')).find(c => c.includes(seat)) || [];
    rT = 0; vS = 0; sDry = 0; sFuel = 0;
    for (const p of top) { const d = p.def; sDry += d.mass; if (d.fuel) sFuel += d.fuel; if (d.kind === 'rocket' && !d.ion) { const pk = cfgGet(p, 'power') / 100; rT += d.thrust * pk; vS += d.thrust * pk * (d.ve || VE); } }
  }
  return {
    count: parts.length, dry, fuel, total, power, nWheels, nTracks, hover, rocket: rT, jet, prop, boat, area, buoyKg, torque, loose, hasSeat: !!seat, joints, anchored,
    twr: rT > 0 ? rT / ((sDry + sFuel) * G0) : 0, dv: rT > 0 && sFuel > 0 ? vS / rT * Math.log((sDry + sFuel) / sDry) : 0,
    size: parts.length ? [(mx[0] - mn[0] + 1) * CELL, (mx[1] - mn[1] + 1) * CELL, (mx[2] - mn[2] + 1) * CELL] : [0, 0, 0],
  };
}

/* ---------- example vehicles ---------- */
const NV = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
function ex(name, list) {
  const parts = [], occ = new Set();
  for (const e of list) {
    const [t, x, y, z, n = '+y', k = 0, tl = 0, c = null, cfg = null] = e;
    const def = PD[t]; if (!def) { console.warn('unknown part', t); continue; }
    // wheels: a number turns them from pressing down, 's-x' and friends name the way they press
    let ks;
    if (def.kind === 'wheel') {
      if (typeof k === 'string' && k[0] === 's') { const kk = wheelSpringK(NV[n], NV[k.slice(1)]); if (kk < 0) console.warn('wheel cannot press that way', name, e); ks = [Math.max(0, kk)]; }
      else ks = [((k | 0) + wheelDownK(NV[n])) % 4];
    } else ks = k === 'auto' ? [0, 1, 2, 3] : [k];
    let ok = false;
    for (const kk of ks) {
      const m = orient(NV[n], kk, tl);
      const fp = footprint(def, [x, y, z], m);
      if (fp.some(cc => occ.has(ckey(cc[0], cc[1], cc[2])))) continue;
      if (k === 'auto') { const cz = [m[2], m[5], m[8]]; if (Math.abs(cz[0] * Math.sign(x) + cz[2] * Math.sign(z)) < 0.5) continue; }
      fp.forEach(cc => occ.add(ckey(cc[0], cc[1], cc[2])));
      const part = { t, a: [x, y, z], m, c: c ?? def.dc };
      if (cfg) part.cfg = cfg;
      parts.push(part);
      ok = true; break;
    }
    if (!ok) console.warn('example overlap', name, e);
  }
  return { name, parts, wv: 2 };
}
function exRover() {
  const L = [['seat', 0, 0, 0, '+y', 0, 0, 1]];
  for (let x = -1; x <= 1; x++) for (let z = -3; z <= 2; z++) L.push(['block', x, -1, z, '+y', 0, 0, 4]);
  for (const z of [-1, 0]) for (const x of [-1, 1]) L.push(['block', x, 0, z, '+y', 0, 0, 1]);
  for (let x = -1; x <= 1; x++) L.push(['block', x, 0, -3, '+y', 0, 0, 1]);
  L.push(['engine', 0, 0, -2]);
  for (let x = -1; x <= 1; x++) L.push(['block', x, 1, -1, '+y', 0, 0, 4]);
  for (let x = -1; x <= 1; x++) L.push(['wedge', x, 0, 1, '+y', 0, 0, 1]);
  L.push(['light', -1, -1, 3, '+z'], ['light', 1, -1, 3, '+z']);
  L.push(['wheel_m_steer', 2, -1, 2, '+x'], ['wheel_m_steer', -2, -1, 2, '-x'], ['wheel_m', 2, -1, -3, '+x'], ['wheel_m', -2, -1, -3, '-x']);
  return ex('Rover', L);
}
function exKestrel() {
  const L = [['seat', 0, 0, 0, '+y', 0, 0, 1], ['canopy', 0, 1, 0, '+y']];
  for (let z = -6; z <= -1; z++) L.push(['light_block', 0, 0, z, '+y', 0, 0, 5]);
  L.push(['gyro', 0, 0, 1], ['light_block', 0, 0, 2, '+y', 0, 0, 5], ['nose', 0, 0, 3, '+z', 0, 0, 2]);
  L.push(['wing_l', 1, 0, -3, '+x', 0, 0, 5], ['wing_l', -1, 0, -3, '-x', 0, 0, 5]);
  L.push(['flap', 4, 0, -5, '-z', 0, 0, 2], ['flap', -4, 0, -5, '-z', 0, 0, 2]);
  L.push(['wing_s', 1, 0, -6, '+x', 0, 0, 5], ['wing_s', -1, 0, -6, '-x', 0, 0, 5]);
  L.push(['flap', 2, 0, -7, '-z', 0, 0, 2], ['flap', -2, 0, -7, '-z', 0, 0, 2]);
  L.push(['fin', 0, 1, -6, '+y', 0, 0, 2], ['flap', 0, 2, -8, '-z', 1, 0, 2]);
  L.push(['jet', 0, 0, -7, '-z']);
  L.push(['block', 2, -1, -4, '-y', 0, 0, 4], ['block', -2, -1, -4, '-y', 0, 0, 4], ['wheel_s', 3, -1, -4, '+x'], ['wheel_s', -3, -1, -4, '-x']);
  L.push(['block', 0, -1, 1, '-y', 0, 0, 4], ['wheel_s_steer', 1, -1, 1, '+x'], ['wheel_s_steer', -1, -1, 1, '-x']);
  return ex('Kestrel', L);
}
function exSkylark() {
  const d = exKestrel(); d.name = 'Skylark';
  const ex2 = ex('Skylark', [['dock', 0, 1, -2, '+y', 0, 0, 4]]);
  d.parts.push(...ex2.parts);
  return d;
}
function exSkiff() {
  const L = [['seat', 0, 0, 0, '+y', 0, 0, 1]];
  for (let x = -1; x <= 1; x++) for (let z = -3; z <= 2; z++) L.push(['hull', x, -1, z, '+y', 0, 0, 3]);
  for (let x = -1; x <= 1; x++) L.push(['hull_bow', x, -1, 3, '+z', 0, 0, 3]);
  for (let z = -3; z <= 2; z++) for (const x of [-1, 1]) L.push(['light_block', x, 0, z, '+y', 0, 0, 5]);
  L.push(['hull', 0, -2, -2, '+y', 0, 0, 3], ['hull', 0, -2, -1, '+y', 0, 0, 3]);
  L.push(['boat_prop', 0, -2, -3, '-z'], ['rudder', 0, -3, -2, '-y']);
  L.push(['float_big', 2, -1, 0, '+x'], ['float_big', -2, -1, 0, '-x']);
  return ex('Skiff', L);
}
function exComet() {
  const L = [['seat', 0, 0, 0, '+y', 0, 0, 1], ['nose', 0, 1, 0, '+y', 0, 0, 2], ['gyro', 0, -1, 0]];
  for (let y = -2; y >= -4; y--) L.push(['tank', 0, y, 0, '+y', 0, 0, 2]);
  L.push(['rocket', 0, -5, 0, '-y'], ['decoupler', 0, -7, 0, '-y']);
  for (let y = -8; y >= -13; y--) L.push(['tank', 0, y, 0, '+y', 0, 0, 3]);
  L.push(['rocket', 0, -14, 0, '-y']);
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) L.push(['block', x, -13, z, '+y', 0, 0, 4]);
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) L.push(['fin', x, -14, z, '-y', 'auto', 0, 2]);
  return ex('Comet', L);
}
/* a ship that can reach another star: a booster to get off Terra, then a Star Drive stage with fuel to spare */
function exStarfarer() {
  const L = [['seat', 0, 0, 0, '+y', 0, 0, 1], ['nose', 0, 1, 0, '+y', 0, 0, 2], ['gyro', 0, -1, 0]];
  for (let y = -2; y >= -7; y--) L.push(['tank', 0, y, 0, '+y', 0, 0, 2]);
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) L.push(['tank', x, -4, z, '+y', 0, 0, 2], ['tank', x, -5, z, '+y', 0, 0, 2]);
  L.push(['star_drive', 0, -8, 0, '-y'], ['decoupler', 0, -10, 0, '-y']);
  for (let y = -11; y >= -18; y--) L.push(['tank', 0, y, 0, '+y', 0, 0, 3]);
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let y = -12; y >= -17; y--) L.push(['tank', x, y, z, '+y', 0, 0, 3]);
  L.push(['rocket', 0, -19, 0, '-y']);
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) L.push(['rocket', x, -18, z, '-y']);
  return ex('Starfarer', L);
}
function exHopper() {
  const L = [['seat', 0, 0, 0, '+y', 0, 0, 1], ['canopy', 0, 1, 0, '+y'], ['gyro', 0, -1, 0]];
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) L.push(['tank', x, 0, z, '+y', 0, 0, 5]);
  L.push(['rocket', 0, -2, 0, '-y']);
  L.push(['leg', 2, 0, 0, '+x'], ['leg', -2, 0, 0, '-x'], ['leg', 0, 0, 2, '+z'], ['leg', 0, 0, -2, '-z']);
  return ex('Hopper', L);
}
function exBruiser() {
  const L = [['seat', 0, 0, 0, '+y', 0, 0, 2]];
  for (let x = -1; x <= 1; x++) for (let z = -3; z <= 3; z++) L.push(['block', x, -1, z, '+y', 0, 0, 2]);
  for (let x = -1; x <= 1; x++) L.push(['armor_block', x, -1, 4, '+y', 0, 0, 4]);
  L.push(['engine', 0, 0, -2], ['engine', 0, 0, -3]);
  for (const x of [-1, 1]) for (const z of [-3, -2, -1, 0]) L.push(['heavy_block', x, 0, z, '+y', 0, 0, 4]);
  for (let x = -1; x <= 1; x++) L.push(['block', x, 1, -1, '+y', 0, 0, 4]);
  L.push(['wheel_x_steer', 2, -1, 3, '+x'], ['wheel_x_steer', -2, -1, 3, '-x'], ['wheel_x', 2, -1, -3, '+x'], ['wheel_x', -2, -1, -3, '-x']);
  return ex('Bruiser', L);
}
/* a 5 km skyhook: 74 truss segments out to the grapple, 26 back to a stack of counterweights */
function exSkyhook() {
  const L = [['block', 0, 0, 0, '+y', 0, 0, 4], ['seat', 0, 1, 0, '+y', 0, 0, 1], ['canopy', 0, 2, 0, '+y'], ['gyro', 0, 0, 1], ['gyro', 0, 0, -1], ['spotlight', 0, -1, 0, '-y']];
  for (let k = 0; k < 74; k++) L.push(['truss_50', 1 + k * 100, 0, 0, '+x', 0, 0, 1]);
  L.push(['grapple', 7401, 0, 0, '+x']);
  for (let k = 0; k < 26; k++) L.push(['truss_50', -1 - k * 100, 0, 0, '-x', 0, 0, 1]);
  const cw = [[-2602, 0, 0], [-2602, -2, 0], [-2602, 0, -2], [-2602, -2, -2], [-2604, 0, 0], [-2604, -2, 0], [-2604, 0, -2]];
  for (const [x, y, z] of cw) L.push(['counterweight', x, y, z, '+y', 0, 0, 4]);
  return ex('Skyhook', L);
}
/* a crane truck: rotor turret, hinged 5 m boom and a winch */
function exCrane() {
  const L = [['seat', 0, 0, 2, '+y', 0, 0, 1], ['canopy', 0, 1, 2, '+y']];
  for (let x = -2; x <= 2; x++) for (let z = -4; z <= 3; z++) L.push(['block', x, -1, z, '+y', 0, 0, 1]);
  L.push(['engine', -1, 0, -3], ['engine', 1, 0, -3]);
  for (const x of [-2, 2]) for (const z of [-4, -3, -2]) L.push(['heavy_block', x, 0, z, '+y', 0, 0, 4]);
  L.push(['wheel_l_steer', 3, -1, 2, '+x'], ['wheel_l_steer', -3, -1, 2, '-x'], ['wheel_l', 3, -1, -3, '+x'], ['wheel_l', -3, -1, -3, '-x']);
  L.push(['rotor', 0, 0, -1, '+y'], ['block', 0, 1, -1, '+y', 0, 0, 1], ['block', 0, 2, -1, '+y', 0, 0, 1]);
  L.push(['hinge', 0, 2, 0, '+z'], ['truss_5', 0, 2, 1, '+z', 0, 0, 1], ['winch', 0, 1, 10, '-y']);
  return ex('Crane', L);
}
/* a space elevator: 50 Sky Trusses (10.75 km, up to geostationary height) on a Ground Anchor, with a climber
   clamped round the bottom. Four pairs of wheels press on the truss from every side; a rocket rides on its front. */
function exElevator() {
  const L = [['anchor', 0, -1, 0, '-y']];
  for (let i = 0; i < 50; i++) L.push(['truss_215', 0, i * 430, 0, '+y', 0, 0, 1]);
  L.push(['dome', 0, 50 * 430, 0, '+y', 0, 0, 1]);
  const Y0 = 2, ring = Y0 + 3;
  // the clamp: two rows of four wheels, each row pressing in from +x, -x, +z and -z
  for (const yh of [Y0 + 1, Y0 + 5]) {
    L.push(['block', 2, yh, -1, '+y', 0, 0, 4], ['wheel_m', 2, yh, 0, '+z', 's-x']);
    L.push(['block', -2, yh, 1, '+y', 0, 0, 4], ['wheel_m', -2, yh, 0, '-z', 's+x']);
    L.push(['block', 1, yh, 2, '+y', 0, 0, 4], ['wheel_m', 0, yh, 2, '-x', 's-z']);
    L.push(['block', -1, yh, -2, '+y', 0, 0, 4], ['wheel_m', 0, yh, -2, '+x', 's+z']);
  }
  for (const [x, z] of [[2, -1], [-2, 1], [1, 2], [-1, -2]]) for (const y of [Y0 + 2, Y0 + 4]) L.push(['block', x, y, z, '+y', 0, 0, 4]);
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (Math.max(Math.abs(x), Math.abs(z)) === 2 && !L.some(e => e[0] === 'block' && e[1] === x && e[2] === ring && e[3] === z)) L.push(['light_block', x, ring, z, '+y', 0, 0, 1]);
  // launch clamp: holds the climber to the tower until the first press of the stage key
  L.push(['decoupler', 1, ring, 0]);
  // motors on the back balance the rocket on the front
  L.push(['block', 0, ring, -3, '+y', 0, 0, 4]);
  for (let y = Y0 + 1; y <= Y0 + 5; y++) L.push(['engine', 0, y, -4]);
  for (const x of [-1, 1]) for (const y of [Y0 + 2, Y0 + 4]) L.push(['engine', x, y, -4]);
  // the rocket: the second stage press drops the climber and it flies
  L.push(['decoupler', 0, ring, 3]);
  L.push(['tank_long', 0, ring, 4, '+y', 0, 0, 3], ['tank_long', 0, ring + 3, 4, '+y', 0, 0, 3], ['rocket_vac', 0, ring - 1, 4, '-y']);
  L.push(['gyro', 0, ring + 6, 4], ['seat', 0, ring + 7, 4, '+y', 0, 0, 1], ['chute', 0, ring + 8, 4, '+y']);
  return ex('Space Elevator', L);
}
/* logic demo: a Timer fires the engine, two Sensors and a Logic Gate open the parachute at the top */
function exAuto() {
  const L = [['seat', 0, 0, 0, '+y', 0, 0, 1], ['chute', 0, 1, 0, '+y', 0, 0, 2, { k: 'CH2' }], ['gyro', 0, -1, 0]];
  L.push(['tank_long', 0, -4, 0, '+y', 0, 0, 2], ['rocket', 0, -5, 0, '-y', 0, 0, 2, { lever: false, fire: 'CH1' }]);
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) L.push(['block', x, -4, z, '+y', 0, 0, 4]);
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) L.push(['fin', x, -5, z, '-y', 'auto', 0, 2]);
  L.push(['timer', 1, -1, 0, '+x', 0, 0, 1, { delay: 1, dur: 6, out: 'CH1' }]);
  L.push(['sensor', -1, -1, 0, '-x', 0, 0, 10, { what: 'alt', cmp: 'gt', val: 30, out: 'CH3' }]);
  L.push(['sensor', 0, -1, 1, '+z', 0, 0, 10, { what: 'vs', cmp: 'lt', val: -2, out: 'CH4' }]);
  L.push(['gate', 0, -1, -1, '-z', 0, 0, 3, { op: 'and', a: 'CH3', b: 'CH4', out: 'CH2' }]);
  return ex('Auto Rocket', L);
}
/* Version 12 examples: a race car, a tank with a turret, a helicopter */
function exRacer() {
  const L = [['seat', 0, 0, -1, '+y', 0, 0, 1]];
  for (let x = -1; x <= 1; x++) for (let z = -3; z <= 3; z++) L.push(['block', x, -1, z, '+y', 0, 0, x ? 2 : 1]);
  L.push(['engine', 0, 0, -2], ['engine', 0, 0, -3]);
  for (const x of [-1, 1]) for (const z of [-3, -2, -1, 0]) L.push(['slab', x, 0, z, '+y', 0, 0, 2]);
  L.push(['window', 0, 0, 0, '+y', 0, 0, 5]);
  for (let x = -1; x <= 1; x++) L.push(['wedge_low', x, -1, 4, '+y', 0, 0, 2]);
  for (let x = -1; x <= 1; x++) L.push(['wedge_low', x, 0, 1, '+y', 0, 0, x ? 2 : 1]);
  // rear wing on two posts
  L.push(['block', -1, 1, -3, '+y', 0, 0, 5], ['block', 1, 1, -3, '+y', 0, 0, 5]);
  for (let x = -1; x <= 1; x++) L.push(['wedge_low', x, 2, -3, '+y', 2, 0, 5]);
  L.push(['light', -1, -1, 5, '+z'], ['light', 1, -1, 5, '+z']);
  L.push(['wheel_race_steer', 2, -1, 2, '+x'], ['wheel_race_steer', -2, -1, 2, '-x'], ['wheel_race', 2, -1, -2, '+x'], ['wheel_race', -2, -1, -2, '-x']);
  return ex('Racer', L);
}
function exTank() {
  const L = [['seat_race', 0, 0, 1, '+y', 0, 0, 2]];
  for (let x = -2; x <= 2; x++) for (let z = -3; z <= 3; z++) L.push(['block', x, -1, z, '+y', 0, 0, 7]);
  for (let x = -2; x <= 2; x++) L.push(['armor_plate', x, -1, 4, '+z', 0, 0, 7]);
  L.push(['engine', -1, 0, -3], ['engine', 1, 0, -3], ['engine', 0, 0, -3]);
  for (const x of [-2, 2]) for (let z = -3; z <= 3; z++) L.push(['slab', x, 0, z, '+y', 0, 0, 7]);
  // the turret turns on a rotor ({rotor_l} {rotor_r}) and touches the hull nowhere else; a cannon and a machine gun point forward
  L.push(['rotor', 0, 0, -1, '+y', 0, 0, 7]);
  for (let x = -1; x <= 1; x++) for (let z = -2; z <= 0; z++) L.push(['block', x, 1, z, '+y', 0, 0, 7]);
  L.push(['block', 0, 2, -1, '+y', 0, 0, 7], ['block', 0, 2, -2, '+y', 0, 0, 7], ['block', 1, 2, -2, '+y', 0, 0, 7]);
  L.push(['cannon', 0, 2, 0, '+z', 0, 0, 7], ['mgun', 1, 2, -1, '+z', 0, 0, 7], ['horn', -1, 2, -1, '+y'], ['flag', -1, 2, -2, '+y', 0, 0, 2]);
  for (const x of [-1, 1]) L.push(['light', x, -1, 5, '+z']);
  // a track down each side: the steering keys run them against each other
  L.push(['track', 3, -1, 0, '+x', 0, 0, 7], ['track', -3, -1, 0, '-x', 0, 0, 7]);
  return ex('Tank', L);
}
function exChopper() {
  const L = [['seat', 0, 0, 0, '+y', 0, 0, 1]];
  for (let x = -1; x <= 1; x++) for (let z = -2; z <= 1; z++) L.push(['block', x, -1, z, '+y', 0, 0, 4]);
  for (const [x, z] of [[-1, 0], [1, 0], [-1, -1], [0, -1], [1, -1], [-1, -2], [0, -2], [1, -2]]) L.push(['block', x, 0, z, '+y', 0, 0, 4]);
  for (const x of [-1, 0, 1]) L.push(['window', x, 0, 1, '+y', 0, 0, 5]);
  L.push(['heli', 0, 1, -1, '+y', 0, 0, 4]);
  // tail boom with a fin; the rotor itself keeps it level and turns it
  for (let z = -3; z >= -7; z--) L.push(['light_block', 0, 0, z, '+y', 0, 0, 4]);
  L.push(['fin', 0, 1, -7, '+y', 0, 0, 2]);
  // skids
  for (const x of [-1, 1]) for (const z of [-2, -1, 0, 1]) L.push(['slab', x, -2, z, '+y', 0, 0, 5]);
  L.push(['light', 0, -1, 2, '+z']);
  return ex('Chopper', L);
}
/* Version 13 examples: a hovercraft, a truck towing a trailer, a digger */
function exHover() {
  const L = [['seat', 0, 0, 1, '+y', 0, 0, 1], ['window', 0, 0, 2, '+y', 0, 0, 5], ['gyro', 0, 0, -1, '+y', 0, 0, 4]];
  for (let x = -3; x <= 3; x++) for (let z = -4; z <= 4; z++) L.push([Math.abs(x) === 3 || Math.abs(z) === 4 ? 'hull' : 'light_block', x, -1, z, '+y', 0, 0, Math.abs(x) === 3 || Math.abs(z) === 4 ? 2 : 4]);
  for (const x of [-2, 2]) for (const z of [-3, 3]) L.push(['hover', x, -2, z, '-y', 0, 0, 3]);
  // two pusher fans on posts at the back
  for (const x of [-2, 2]) L.push(['block', x, 0, -4, '+y', 0, 0, 4], ['block', x, 1, -4, '+y', 0, 0, 4], ['prop', x, 1, -5, '-z', 0, 0, 3, { inv: true }]);
  L.push(['fin', 0, 0, -4, '+y', 0, 0, 2], ['light', -1, -1, 5, '+z'], ['light', 1, -1, 5, '+z']);
  return ex('Hovercraft', L);
}
function exTruck() {
  // the truck: a cab, an engine and six wheels, with a coupler on its tail
  const L = [['seat_cabin', 0, 0, 3, '+y', 0, 0, 1], ['block', -1, 0, 3, '+y', 0, 0, 1], ['block', 1, 0, 3, '+y', 0, 0, 1], ['lightbar', 0, 1, 3, '+y', 0, 0, 2]];
  for (let x = -1; x <= 1; x++) for (let z = -3; z <= 4; z++) L.push(['block', x, -1, z, '+y', 0, 0, x ? 1 : 4]);
  for (let x = -1; x <= 1; x++) L.push(['wedge', x, 0, 4, '+y', 0, 0, 1]);
  L.push(['engine', 0, 0, 2], ['heavy_block', -1, 0, 2, '+y', 0, 0, 4], ['heavy_block', 1, 0, 2, '+y', 0, 0, 4], ['light', -1, -1, 5, '+z'], ['light', 1, -1, 5, '+z']);
  L.push(['wheel_l_steer', 2, -1, 3, '+x', 0, 0, 1], ['wheel_l_steer', -2, -1, 3, '-x', 0, 0, 1], ['wheel_l', 2, -1, -2, '+x', 0, 0, 1], ['wheel_l', -2, -1, -2, '-x', 0, 0, 1]);
  L.push(['coupler', 0, -1, -4, '-z', 0, 0, 4]);
  // the trailer: a flat bed on free-rolling wheels, hitched on by its own coupler; a crate rides on it
  L.push(['coupler', 0, -1, -5, '+z', 0, 0, 4]);
  for (let x = -1; x <= 1; x++) for (let z = -13; z <= -6; z++) L.push(['block', x, -1, z, '+y', 0, 0, x ? 5 : 4]);
  for (const z of [-11, -8]) for (const sd of [-1, 1]) L.push(['wheel_l', 2 * sd, -1, z, sd > 0 ? '+x' : '-x', 0, 0, 1, { power: 0 }]);
  L.push(['crate', 0, 0, -10, '+y', 0, 0, 9], ['plate_number', 0, 0, -11, '-z', 0, 0, 2, { text: 'TOW 13' }]);
  for (const x of [-1, 1]) L.push(['light_color', x, -1, -14, '-z', 0, 0, 3]);
  return ex('Truck', L);
}
function exDigger() {
  const L = [['seat_cabin', 0, 0, 0, '+y', 0, 0, 6]];
  for (let x = -1; x <= 1; x++) for (let z = -2; z <= 1; z++) L.push(['block', x, -1, z, '+y', 0, 0, 6]);
  L.push(['engine', -1, 0, -2], ['engine', 1, 0, -2], ['heavy_block', 0, 0, -2, '+y', 0, 0, 4], ['lightbar', 0, 1, 0, '+y', 0, 0, 2]);
  L.push(['track_s', 2, -1, 0, '+x', 0, 0, 4], ['track_s', -2, -1, 0, '-x', 0, 0, 4]);
  // the arm: a big hinge on the nose lifts a long boom with a drill on its end
  L.push(['block', 0, -1, 2, '+y', 0, 0, 6], ['hinge_big', 0, -1, 3, '+z', 0, 0, 6]);
  for (let z = 4; z <= 8; z++) L.push(['block', 0, -1, z, '+y', 0, 0, 6]);
  L.push(['drill', 0, -1, 9, '+z', 0, 0, 4]);
  return ex('Digger', L);
}
let EXAMPLES = [];
function buildExamples() {
  EXAMPLES = [
    { d: exRover(), blurb: 'Four-wheel starter car.' },
    { d: exBruiser(), blurb: 'Monster truck. 2.3 t, built for ramming.' },
    { d: exRacer(), blurb: 'Race car on Racing Wheels. Fast enough for the stunt park loop: spawn at Stunt park and floor it.' },
    { d: exTank(), blurb: 'Tank on tracks. {left} {right} turn it on the spot. {fire} or a click fires the cannon and machine gun, {rotor_l} and {rotor_r} turn the turret, {horn} honks.' },
    { d: exChopper(), blurb: 'Helicopter. Hold {fwd} to climb, {descend} to sink, let go to hover. {pitch_dn} {pitch_up} {roll_l} {roll_r} tilt it, {left} {right} turn.' },
    { d: exHover(), blurb: 'Hovercraft on four Hover Pads: it floats over land and sea alike. {fwd} drives the fans, {left} {right} turn.' },
    { d: exTruck(), blurb: 'Truck towing a trailer on a Coupler. {undock} unhitches it, {lights} flashes the light bar. Back a coupler into another to hitch up.' },
    { d: exDigger(), blurb: 'Digger on tracks. {hinge_a} and {hinge_b} raise the arm, hold {fire} to spin the drill, {lights} for the light bar.' },
    { d: exKestrel(), blurb: 'Jet plane. Hold {fwd}, it lifts off near 110 km/h.' },
    { d: exSkylark(), blurb: 'Jet plane with a docking port on its back. Fly under a skyhook tip to get grabbed.' },
    { d: exSkiff(), blurb: 'Boat. Spawn at Open sea.' },
    { d: exComet(), blurb: 'Two-stage rocket. {thr_full} to burn, {stage} to stage. {sas} turns on SAS.' },
    { d: exStarfarer(), blurb: 'Star ship. {thr_full} to burn, {stage} drops the booster, then the Star Drive takes you out past the planets. Between the stars, time warp goes up to ×1,000,000.' },
    { d: exHopper(), blurb: 'Lander. Try it at The Moon.' },
    { d: exAuto(), blurb: 'Logic demo: touch nothing. A Timer fires the engine for 6 s, then two Sensors and a Logic Gate open the parachute as it starts to fall. Look at it with the Configure tool.' },
    { d: exCrane(), blurb: 'Crane truck. {rotor_l} and {rotor_r} turn it, {hinge_a} and {hinge_b} raise the boom, {winch_in} and {winch_out} work the winch.' },
    { d: exSkyhook(), blurb: '5 km spinning skyhook. Spawn it at Skyhook orbit, then catch it with the Skylark.' },
    { d: exElevator(), blurb: 'Space elevator: 50 Sky Trusses up to geostationary height, 10.75 km. {stage} lets the climber go, hold {fwd} to climb. At the top you are already in orbit: {stage} lets the rocket float free.' },
  ];
}
function clonePart(p) { const q = { t: p.t, a: p.a.slice(), m: p.m.slice(), c: p.c }; if (p.cfg) q.cfg = { ...p.cfg }; return q; }
function cloneDesign(d) { return { name: d.name, parts: d.parts.map(clonePart), wv: 2 }; }
/* wv 2: wheels press the way their arrow points. Older designs had every wheel pressing down. */
function sanitizeDesign(d) {
  if (!d || !Array.isArray(d.parts)) return null;
  const old = d.wv !== 2;
  const parts = d.parts.filter(p => p && PD[p.t] && Array.isArray(p.a) && p.a.length === 3 && Array.isArray(p.m) && p.m.length === 9)
    .map(p => {
      const m = p.m.map(v => v | 0), q = { t: p.t, a: p.a.map(v => v | 0), m: old && PD[p.t].kind === 'wheel' ? fixWheelM(m) : m, c: (p.c | 0) % PALETTE.length };
      // each part's own settings from the Configure tool
      const cfg = cleanCfg(p.cfg, PD[p.t]); if (cfg) q.cfg = cfg;
      return q;
    });
  return { name: String(d.name || 'Vehicle').slice(0, 40), parts, wv: 2 };
}

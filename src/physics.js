'use strict';
/* ================= Scrapline · physics ================= */
const FIXED_DT = 1 / 120;
const HOVER_H = 2;
const W = { bodies: [], time: 0, expl: [], dmg: new Map(), props: [], frozen: [], hit: { v: 0, p: new THREE.Vector3(), m: 0 } };
const DMG_V = 7.5, MAX_DEBRIS = 90;
let BID = 0;
const _p = new V3(), _q = new V3(), _n = new V3(), _u = new V3(), _w = new V3(), _a = new V3(), _b = new V3(), _rv = new V3(), _pn = new V3();
const ZERO = new V3();
const _t9 = new Float64Array(9);
const _pt = new V3(), _pt2 = new V3(), _sw = new V3(), _sv = new V3();
const PT_CHUNK = 8, chunkKey = (i, j, k) => ((i + 4096) * 8192 + (j + 4096)) * 8192 + (k + 4096);
let FAMID = 0;
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
function rotOnly(m) { return new THREE.Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1); }

class Body {
  constructor(parts, o = {}) {
    this.id = ++BID; this.parts = parts;
    this.x = new V3(); this.v = new V3(); this.q = new Quat(); this.w = new V3();
    this.r = new Float64Array(9); this.iw = new Float64Array(9); this.il = new Float64Array(9); this.Idiag = [1, 1, 1];
    this.F = new V3(); this.T = new V3(); this.comD = new V3();
    this.player = !!o.player; this.debris = !!o.debris; this.dead = false; this.name = o.name || 'Vehicle';
    // fam: every body that came out of one spawn (stages, towers) so they are removed together
    this.fam = o.fam || 0; this.anchored = null; this.anchorOff = false; this.topR = 0;
    // ctl: thr = wheels, eng = props/jets/boat props, steer/roll positive = vehicle right (design -X)
    this.ctl = { thr: 0, eng: 0, steer: 0, pitch: 0, roll: 0, brake: o.brake || 0, rocket: 0, tx: 0, tz: 0 };
    this.dock = null; this.dockCool = 0; this.design = o.design || null;
    this.fuel = 0; this.fuelMax = 0;
    this.age = 0; this.asleep = false; this.sleepT = 0; this.massT = 0; this.wasWet = false; this.burning = false;
    // environment (refreshed every step) and hazards
    this.airCel = null; this.seaCel = null; this.groundCel = null; this.av = new V3(); this.alt = 0;
    this.heat = 0; this.crush = 0; this.burn = 0; this.lava = 0; this.aero = 0; this.sunlit = 1; this.sunT = 0; this.asmId = 0;
    this.gearUp = false; this.gearK = 1;
    this.pinCel = null; this.pinRel = new V3(); this.pinVrel = new V3(); this.pinQ = new Quat(); this.pinW = new V3(); this.frozen = false;
    this.group = new THREE.Group(); scene.add(this.group); this.vis = []; this.merged = null;
    this.rho = 0; this.mass = 1; this.invM = 1; this.onTower = null;
    this.structure(true);
    this.updR();
  }
  structure(initial) {
    const parts = this.parts = this.parts.filter(p => p.alive);
    for (const p of parts) p.body = this;
    const grid = this.grid = new Map();
    for (const p of parts) for (const k of p.keys) grid.set(k, p);
    let fmax = 0, f = 0; for (const p of parts) if (p.def.fuel) { fmax += p.def.fuel; f += p.fuel; }
    this.fuelMax = fmax; this.fuel = f;
    this.massProps(initial);
    this.buildLists();
    this.tuneSprings();
    this.buildPoints();
    this.buildVisual();
    // a parked or anchored body that lost parts keeps its new centre of mass where it is
    if (this.asleep && this.pinCel) toSpin(this.pinCel, _pt.subVectors(this.x, this.pinCel.center), this.pinRel);
    // lost its last anchor: it stands on nothing now
    if (this.anchored && !this.anchors.some(a => a.p.alive)) unanchorBody(this);
  }
  massProps(initial) {
    let M = 0, cx = 0, cy = 0, cz = 0;
    for (const p of this.parts) {
      const m = p.def.mass + (p.fuel || 0);
      p.mass = m; M += m; cx += m * p.cen[0]; cy += m * p.cen[1]; cz += m * p.cen[2];
    }
    if (M <= 0) M = 1;
    cx /= M; cy /= M; cz /= M;
    if (!initial) {
      const dx = cx - this.comD.x, dy = cy - this.comD.y, dz = cz - this.comD.z, r = this.r;
      const wx = r[0] * dx + r[1] * dy + r[2] * dz, wy = r[3] * dx + r[4] * dy + r[5] * dz, wz = r[6] * dx + r[7] * dy + r[8] * dz;
      this.x.x += wx; this.x.y += wy; this.x.z += wz;
      const w = this.w;
      this.v.x += w.y * wz - w.z * wy; this.v.y += w.z * wx - w.x * wz; this.v.z += w.x * wy - w.y * wx;
    }
    this.comD.set(cx, cy, cz);
    this.mass = M; this.invM = 1 / M;
    let I00 = 0, I11 = 0, I22 = 0, I01 = 0, I02 = 0, I12 = 0; const s = CELL * CELL / 6;
    for (const p of this.parts) {
      const mc = p.mass / p.cells.length;
      for (const c of p.cells) {
        const rx = c[0] * CELL - cx, ry = c[1] * CELL - cy, rz = c[2] * CELL - cz;
        I00 += mc * (ry * ry + rz * rz + s); I11 += mc * (rx * rx + rz * rz + s); I22 += mc * (rx * rx + ry * ry + s);
        I01 -= mc * rx * ry; I02 -= mc * rx * rz; I12 -= mc * ry * rz;
      }
    }
    const e = M * 0.002 + 0.01; I00 += e; I11 += e; I22 += e;
    const m3 = new THREE.Matrix3().set(I00, I01, I02, I01, I11, I12, I02, I12, I22).invert();
    const el = m3.elements, il = this.il;
    il[0] = el[0]; il[1] = el[3]; il[2] = el[6]; il[3] = el[1]; il[4] = el[4]; il[5] = el[7]; il[6] = el[2]; il[7] = el[5]; il[8] = el[8];
    this.Idiag = [I00, I11, I22];
    this.updR();
  }
  updR() {
    const q = this.q, x = q.x, y = q.y, z = q.z, w = q.w, r = this.r;
    const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    r[0] = 1 - (yy + zz); r[1] = xy - wz; r[2] = xz + wy;
    r[3] = xy + wz; r[4] = 1 - (xx + zz); r[5] = yz - wx;
    r[6] = xz - wy; r[7] = yz + wx; r[8] = 1 - (xx + yy);
    const il = this.il, t = _t9, iw = this.iw;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) t[i * 3 + j] = r[i * 3] * il[j] + r[i * 3 + 1] * il[3 + j] + r[i * 3 + 2] * il[6 + j];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) iw[i * 3 + j] = t[i * 3] * r[j * 3] + t[i * 3 + 1] * r[j * 3 + 1] + t[i * 3 + 2] * r[j * 3 + 2];
  }
  toWorld(dx, dy, dz, out) {
    const lx = dx - this.comD.x, ly = dy - this.comD.y, lz = dz - this.comD.z, r = this.r;
    out.x = this.x.x + r[0] * lx + r[1] * ly + r[2] * lz;
    out.y = this.x.y + r[3] * lx + r[4] * ly + r[5] * lz;
    out.z = this.x.z + r[6] * lx + r[7] * ly + r[8] * lz;
    return out;
  }
  toDesign(p, out) {
    const px = p.x - this.x.x, py = p.y - this.x.y, pz = p.z - this.x.z, r = this.r;
    out.x = r[0] * px + r[3] * py + r[6] * pz + this.comD.x;
    out.y = r[1] * px + r[4] * py + r[7] * pz + this.comD.y;
    out.z = r[2] * px + r[5] * py + r[8] * pz + this.comD.z;
    return out;
  }
  dirW(x, y, z, out) { const r = this.r; out.x = r[0] * x + r[1] * y + r[2] * z; out.y = r[3] * x + r[4] * y + r[5] * z; out.z = r[6] * x + r[7] * y + r[8] * z; return out; }
  velAt(p, out) {
    const rx = p.x - this.x.x, ry = p.y - this.x.y, rz = p.z - this.x.z, w = this.w;
    out.x = this.v.x + w.y * rz - w.z * ry; out.y = this.v.y + w.z * rx - w.x * rz; out.z = this.v.z + w.x * ry - w.y * rx;
    return out;
  }
  addForceAt(fx, fy, fz, p) {
    this.F.x += fx; this.F.y += fy; this.F.z += fz;
    const rx = p.x - this.x.x, ry = p.y - this.x.y, rz = p.z - this.x.z;
    this.T.x += ry * fz - rz * fy; this.T.y += rz * fx - rx * fz; this.T.z += rx * fy - ry * fx;
  }
  impulseAt(jx, jy, jz, p) {
    const im = this.invM; this.v.x += jx * im; this.v.y += jy * im; this.v.z += jz * im;
    const rx = p.x - this.x.x, ry = p.y - this.x.y, rz = p.z - this.x.z;
    const tx = ry * jz - rz * jy, ty = rz * jx - rx * jz, tz = rx * jy - ry * jx, iw = this.iw;
    this.w.x += iw[0] * tx + iw[1] * ty + iw[2] * tz; this.w.y += iw[3] * tx + iw[4] * ty + iw[5] * tz; this.w.z += iw[6] * tx + iw[7] * ty + iw[8] * tz;
  }
  wake() {
    // anchored towers stay locked to the ground
    if (this.anchored) return;
    // a body held still through time warp gets back the speed it had over the ground
    if (this.asleep && this.frozen && this.pinCel) { const c = this.pinCel; surfaceVel(c, this.x, this.v).add(fromSpin(c, this.pinVrel, _pt)); spinVec(c, this.w).add(fromSpin(c, this.pinW, _pt)); }
    this.asleep = false; this.frozen = false; this.sleepT = 0;
  }
  buildLists() {
    const c = this.comD;
    this.wheels = []; this.foils = []; this.props = []; this.jets = []; this.rockets = []; this.boats = []; this.cellsB = []; this.docks = []; this.rcsN = 0;
    this.chutes = []; this.claws = []; this.winches = []; this.grapples = []; this.spots = []; this.anchors = []; this.nSolar = 0; this.nShield = 0; this.nIon = 0;
    // gyros, logic blocks and parts that act once per key press (each listens to its own keys)
    this.gyros = []; this.logic = []; this.acts = [];
    this.balloons = []; this.magnets = []; this.guns = []; this.horns = [];
    this.hovers = []; this.drills = []; this.couplers = []; this.lightbars = [];
    let gyro = 0, rcs = 0, power = 0, nDriven = 0, rad = 0, drad = 0;
    const gid = new Map();
    this.fgroups = partComponents(this.parts.filter(p => p.def.kind !== 'decoupler')).map((c, i) => { for (const p of c) gid.set(p, i); return { tanks: c.filter(p => p.def.fuel), dem: 0, sc: 0 }; });
    this.tanks = this.parts.filter(p => p.def.fuel);
    this.cellPart = [];
    for (const p of this.parts) {
      const d = p.def, m = p.m, a = p.a;
      for (const cc of p.cells) { const x = cc[0] * CELL, y = cc[1] * CELL, z = cc[2] * CELL, rr = Math.hypot(x - c.x, y - c.y, z - c.z) + 0.45; this.cellsB.push(x, y, z, d.buoy); this.cellPart.push(p); if (rr > rad) rad = rr; if (!d.lattice && rr > drad) drad = rr; }
      const colX = [m[0], m[3], m[6]], colY = [m[1], m[4], m[7]], colZ = [m[2], m[5], m[8]];
      const A = [a[0] * CELL, a[1] * CELL, a[2] * CELL];
      const at = (k) => new V3(A[0] + colY[0] * k, A[1] + colY[1] * k, A[2] + colY[2] * k);
      switch (d.kind) {
        case 'wheel': {
          if (Math.abs(colY[1]) > 0.5) break;
          const Wd = d.wheel;
          // the wheel presses toward its local -Z: down for a car, sideways or up to grip a wall or a truss
          const dn = new V3(-colZ[0], -colZ[1], -colZ[2]);
          // a track is a row of road wheels along its length, all sprung and driven together
          for (const tx of Wd.track ? Wd.track.xs : [0]) {
            const hub = at(Wd.hubY); hub.x += colX[0] * tx; hub.y += colX[1] * tx; hub.z += colX[2] * tx;
            const w = makeWheel(p, hub, new V3(colY[0], colY[1], colY[2]), dn, Wd.r, Wd.L);
            w.steerMax = Wd.steer; w.steerSign = p.cen[2] >= c.z ? 1 : -1; w.vmax = Wd.vmax; w.mu = Wd.grip || 1.05; w.stiff = Wd.stiff || 1;
            // its own settings: power, top speed, brake strength, steering and drive direction
            const sm = cfgGet(p, 'steer');
            w.pw = cfgGet(p, 'power') / 100; w.vlim = Math.min(Wd.vmax, cfgGet(p, 'speed') / 3.6); w.brkK = cfgGet(p, 'brake') / 100;
            w.inv = cfgGet(p, 'inv') ? -1 : 1; w.steerMode = sm === 'off' ? 0 : sm === 'inv' ? -1 : 1;
            if (Wd.track) { w.track = true; w.side = Math.sign(p.cen[0] - c.x) || 1; }
            // how far the wheel's own cells reach toward what it presses on
            let reach = 0; for (const cc of p.cells) reach = Math.max(reach, (cc[0] * CELL - hub.x) * dn.x + (cc[1] * CELL - hub.y) * dn.y + (cc[2] * CELL - hub.z) * dn.z);
            w.reach = reach + CELL / 2;
            this.wheels.push(w);
            nDriven++; rad = Math.max(rad, hub.distanceTo(c) + Wd.r);
          }
          power += Wd.power;
          break;
        }
        case 'hover': this.hovers.push({ p, pos: at(0.1), dir: new V3().fromArray(colY), x: 0 }); break;
        case 'drill': this.drills.push({ p, pos: at(0.95), dir: new V3().fromArray(colY), on: 0 }); break;
        case 'coupler': this.couplers.push({ p, pos: at(0.25), dir: new V3().fromArray(colY) }); this.acts.push(p); break;
        case 'lightbar': this.lightbars.push(p); this.acts.push(p); break;
        case 'leg': {
          const L = d.leg, hub = new V3(A[0], A[1] - L.drop, A[2]);
          const w = makeWheel(p, hub, new V3(1, 0, 0), new V3(0, -1, 0), L.r, L.L); w.leg = true;
          this.wheels.push(w);
          rad = Math.max(rad, hub.distanceTo(c) + L.r + 0.3);
          break;
        }
        case 'anchor': this.anchors.push({ p, pos: at(0), dir: new V3().fromArray(colY) }); this.acts.push(p); break;
        case 'engine': power += d.power * cfgGet(p, 'power') / 100; break;
        case 'wing': case 'flap': case 'rudder': {
          const nL = new V3().fromArray(d.kind === 'flap' ? colZ : colX);
          const raw = nL.clone();
          const cen = new V3(p.cen[0], p.cen[1], p.cen[2]);
          const f = { p, cen, nL, area: d.area, kp: 0, kr: 0, ky: 0, isFlap: d.kind !== 'wing', water: d.kind === 'rudder', defl: 0, nsgn: 1, camber: 0, inP: 0, inR: 0, inY: 0, ang: 1, inv: 1 };
          if (f.isFlap) { f.ang = cfgGet(p, 'angle') / 100; f.inv = cfgGet(p, 'inv') ? -1 : 1; }
          const zr = cen.z - c.z, xr = cen.x - c.x;
          if (Math.abs(nL.y) >= 0.6) { if (nL.y < 0) nL.negate(); f.kp = zr < -0.25 ? 1 : (zr > 0.25 ? -1 : 0); f.kr = Math.abs(xr) > 0.4 ? -Math.sign(xr) : 0; if (d.kind === 'wing' && d.id !== 'fin' && zr > -1.0) f.camber = 0.1; }
          else if (Math.abs(nL.x) >= 0.6) { if (nL.x < 0) nL.negate(); f.ky = zr < -0.25 ? -1 : (zr > 0.25 ? 1 : 0); }
          f.nsgn = raw.dot(nL) >= 0 ? 1 : -1;
          this.foils.push(f); break;
        }
        case 'prop': { const dir = new V3().fromArray(colY); if (cfgGet(p, 'inv')) dir.negate(); this.props.push({ p, pos: at(0.1), dir, thrust: d.thrust, out: 0, eng: 0, heli: !!d.heli, hv: 0, lever: !d.heli && !!cfgGet(p, 'lever'), pw: cfgGet(p, 'power') / 100 }); break; }
        case 'jet': this.jets.push({ p, pos: at(d.nozzle[1]), dir: new V3(-colY[0], -colY[1], -colY[2]), thrust: d.thrust, out: 0, eng: 0, ab: d.ab || 0, boost: 0, any: !!d.any, plasma: !!d.plasma, lever: !!cfgGet(p, 'lever'), pw: cfgGet(p, 'power') / 100 }); break;
        case 'balloon': this.balloons.push({ p, pos: at(d.balloon.h), lift: d.balloon.lift * cfgGet(p, 'lift') / 100 }); this.acts.push(p); break;
        case 'magnet': this.magnets.push({ p, pos: at(0.28), dir: new V3().fromArray(colY) }); this.acts.push(p); break;
        case 'gun': this.guns.push({ p, pos: at(d.gun.muz), dir: new V3().fromArray(colY), cd: 0 }); break;
        case 'horn': this.horns.push(p); break;
        case 'rocket': this.rockets.push({ p, pos: at(d.nozzle[1]), dir: new V3(-colY[0], -colY[1], -colY[2]), thrust: d.thrust, ve: d.ve || VE, vac: !!d.vac, ion: !!d.ion, out: 0, big: d.thrust > 30000, g: this.fgroups[gid.get(p)], blocked: nozzleBlocked(p, this.grid), lvl: 0, lever: !!cfgGet(p, 'lever'), pw: cfgGet(p, 'power') / 100 }); if (d.ion) this.nIon++; break;
        case 'boatprop': this.boats.push({ p, pos: at(0.12), dir: new V3(-colY[0], -colY[1], -colY[2]), thrust: d.thrust, out: 0, eng: 0, lever: !!cfgGet(p, 'lever'), pw: cfgGet(p, 'power') / 100, steer: d.steer || 0 }); break;
        case 'gyro': { const pw = cfgGet(p, 'power') / 100; gyro += d.torque * pw; this.gyros.push({ p, torque: d.torque, pw, stab: !!cfgGet(p, 'stab'), inP: 0, inR: 0, inY: 0 }); break; }
        case 'rcs': rcs += d.torque; this.rcsN++; break;
        case 'dock': this.docks.push({ p, pos: at(0.24), dir: new V3().fromArray(colY) }); this.acts.push(p); break;
        case 'grapple': this.grapples.push({ p, pos: at(1.0), dir: new V3().fromArray(colY) }); this.acts.push(p); break;
        case 'claw': this.claws.push({ p, pos: at(d.claw ? d.claw.pos : 0.95), r: d.claw ? d.claw.r : 0.75, dir: new V3().fromArray(colY) }); this.acts.push(p); break;
        case 'winch': this.winches.push({ p, pos: at(0.3), dir: new V3().fromArray(colY) }); this.acts.push(p); break;
        case 'chute': this.chutes.push({ p, pos: at(0.15), dir: new V3().fromArray(colY) }); this.acts.push(p); break;
        case 'decoupler': case 'explosive': this.acts.push(p); break;
        case 'logic': this.logic.push(p); break;
        case 'spot': this.spots.push({ p, pos: at(0.12), dir: new V3().fromArray(colY) }); break;
        case 'solar': this.nSolar++; break;
        case 'heatshield': this.nShield++; break;
        case 'gear': {
          const Gd = d.gear, hub = at(Gd.drop);
          const w = makeWheel(p, hub, new V3().fromArray(colX), new V3(0, -1, 0), Gd.r, Gd.L);
          w.hub0 = hub.clone(); w.mount = at(0); w.gear = true;
          this.wheels.push(w); this.acts.push(p);
          rad = Math.max(rad, hub.distanceTo(c) + Gd.r); drad = Math.max(drad, hub.distanceTo(c) + Gd.r);
          break;
        }
      }
    }
    this.gyroT = gyro; this.rcsT = rcs; this.drivePower = power; this.nDriven = nDriven; this.radius = Math.max(rad, 0.5); this.dragR = Math.max(drad, 0.5);
    // the way SAS points the craft: along its rockets' thrust, else its jets' and props', else design forward
    const ax = this.sasAxis = new V3();
    for (const e of this.rockets) if (!e.blocked) ax.add(e.dir);
    if (ax.lengthSq() < 0.01) for (const e of [...this.jets, ...this.props]) ax.add(e.dir);
    if (ax.lengthSq() < 0.01) ax.set(0, 0, 1); ax.normalize();
    const sx = new Set(), sy = new Set(), sz = new Set();
    for (const p of this.parts) { if (p.def.lattice) continue; for (const cc of p.cells) { sx.add(cc[1] * 65536 + cc[2]); sy.add(cc[0] * 65536 + cc[2]); sz.add(cc[0] * 65536 + cc[1]); } }
    const ca = CELL * CELL; this.Ax = sx.size * ca; this.Ay = sy.size * ca; this.Az = sz.size * ca;
    this.seat = this.parts.find(p => p.def.kind === 'seat') || null;
  }
  tuneSprings() {
    const n = this.wheels.length; if (!n) return;
    const share = this.mass / n;
    for (const w of this.wheels) { w.k = share * G0 / (w.L * 0.5) * (w.stiff || 1); w.c = 2 * 0.6 * Math.sqrt(w.k * share); }
  }
  buildPoints() {
    const pts = this.pts = [], seen = new Set(), g = this.grid;
    for (const p of this.parts) {
      if (p.def.kind === 'wheel') continue;
      if (p.def.lattice) {
        // long girders: corner points every 25 m instead of every cell
        const n = p.cells.length;
        for (let i = 0; i < n; i += 50) for (const c of [p.cells[i], p.cells[Math.min(n - 1, i + 49)]]) for (let dx = -1; dx <= 1; dx += 2) for (let dy = -1; dy <= 1; dy += 2) for (let dz = -1; dz <= 1; dz += 2)
          pts.push({ x: (c[0] + dx * 0.49) * CELL, y: (c[1] + dy * 0.49) * CELL, z: (c[2] + dz * 0.49) * CELL, part: p });
        continue;
      }
      for (const c of p.cells) {
        for (let dx = -1; dx <= 1; dx += 2) for (let dy = -1; dy <= 1; dy += 2) for (let dz = -1; dz <= 1; dz += 2) {
          const kx = c[0] * 2 + dx, ky = c[1] * 2 + dy, kz = c[2] * 2 + dz;
          const k = ((kx + 65536) * 131072 + (ky + 65536)) * 131072 + (kz + 65536);
          if (seen.has(k)) continue; seen.add(k);
          let full = true;
          for (let ex = -1; ex <= 1 && full; ex += 2) for (let ey = -1; ey <= 1 && full; ey += 2) for (let ez = -1; ez <= 1 && full; ez += 2)
            if (!g.has(ckey((kx + ex) / 2, (ky + ey) / 2, (kz + ez) / 2))) full = false;
          if (full) continue;
          pts.push({ x: (c[0] + dx * 0.49) * CELL, y: (c[1] + dy * 0.49) * CELL, z: (c[2] + dz * 0.49) * CELL, part: p });
        }
      }
    }
    for (const w of this.wheels) {
      if (w.leg) { pts.push({ x: w.hub.x, y: w.hub.y - w.r * 0.2, z: w.hub.z, part: w.p, soft: true }); continue; }
      // the tire's far side and its front and back are solid; the side it presses with rides on its spring
      const ax = w.axle, u = w.up;
      let vx = ax.y * u.z - ax.z * u.y, vy = ax.z * u.x - ax.x * u.z, vz = ax.x * u.y - ax.y * u.x; const l = Math.hypot(vx, vy, vz) || 1; vx /= l; vy /= l; vz /= l;
      const gw = w.gear ? w : null;
      pts.push({ x: w.hub.x + u.x * w.r, y: w.hub.y + u.y * w.r, z: w.hub.z + u.z * w.r, part: w.p, gear: gw });
      pts.push({ x: w.hub.x + vx * w.r, y: w.hub.y + vy * w.r, z: w.hub.z + vz * w.r, part: w.p, gear: gw });
      pts.push({ x: w.hub.x - vx * w.r, y: w.hub.y - vy * w.r, z: w.hub.z - vz * w.r, part: w.p, gear: gw });
    }
    // towers and skyhooks have thousands of contact points: file them by 8 m chunk so a passing car only checks its neighbours
    this.ptChunks = null;
    if (pts.length > 400) {
      const m = this.ptChunks = new Map();
      for (const pt of pts) { const k = chunkKey(Math.floor(pt.x / PT_CHUNK), Math.floor(pt.y / PT_CHUNK), Math.floor(pt.z / PT_CHUNK)); let a = m.get(k); if (!a) m.set(k, a = []); a.push(pt); }
    }
  }
  disposeVisual() {
    for (const ch of this.group.children.slice()) this.group.remove(ch);
    if (this.merged) { this.merged.geometry.dispose(); this.merged = null; }
    this.vis = [];
  }
  buildVisual() {
    this.disposeVisual();
    let nv = 0; for (const p of this.parts) nv += staticGeo(p.t, p.c).attributes.position.count;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
    let o = 0; const nm = new THREE.Matrix3(), v = new V3();
    for (const p of this.parts) {
      const g = staticGeo(p.t, p.c), P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color;
      nm.getNormalMatrix(p.m4);
      for (let i = 0; i < P.count; i++, o++) {
        v.fromBufferAttribute(P, i).applyMatrix4(p.m4); pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
        v.fromBufferAttribute(N, i).applyMatrix3(nm); nor[o * 3] = v.x; nor[o * 3 + 1] = v.y; nor[o * 3 + 2] = v.z;
        col[o * 3] = C.getX(i); col[o * 3 + 1] = C.getY(i); col[o * 3 + 2] = C.getZ(i);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, MAT.veh); mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh); this.merged = mesh;
    const lat = this.parts.filter(p => p.def.lattice && p.cells.length > 40);
    if (lat.length) {
      // long girders also draw as lines so they stay visible kilometres away
      const lp = [];
      for (const p of lat) { const a = p.cells[0], b = p.cells[p.cells.length - 1]; lp.push(a[0] * CELL, a[1] * CELL, a[2] * CELL, b[0] * CELL, b[1] * CELL, b[2] * CELL); }
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
      const ln = new THREE.LineSegments(lg, MAT.girderLine); ln.frustumCulled = false; this.group.add(ln);
    }
    for (const p of this.parts) {
      const def = p.def;
      def.dyn.forEach((d, i) => {
        let mesh;
        if (d.type === 'flame') { mesh = new THREE.Mesh(flameGeo(d.len, d.rad), flameMat(d.col)); mesh.renderOrder = 3; mesh.visible = false; }
        else if (d.type === 'text') mesh = textMesh(def, p.c, p.cfg);
        else mesh = new THREE.Mesh(dynGeo(p.t, i, p.c), d.type === 'glass' ? MAT.glass : d.type === 'lens' ? MAT.lens : d.type === 'lensc' || d.type === 'flashA' || d.type === 'flashB' ? MAT.lensV : d.type === 'beam' ? MAT.beam : MAT.veh);
        mesh.matrixAutoUpdate = false;
        if (d.type !== 'glass' && d.type !== 'lens' && d.type !== 'flame' && d.type !== 'beam') mesh.castShadow = true;
        if (d.type === 'glass') mesh.renderOrder = 4;
        if (d.type === 'beam') { mesh.renderOrder = 5; mesh.visible = false; }
        this.group.add(mesh);
        // lamps glow: a soft halo round each one (lamps only at night; flashing lights whenever they flash)
        let glow = null;
        if (d.type === 'lens' || d.type === 'lensc' || d.type === 'flashA' || d.type === 'flashB') {
          const col = d.type === 'lens' ? 0xfff0c8 : d.type === 'flashA' ? 0xff3a30 : d.type === 'flashB' ? 0x3a72ff : ((PALETTE[p.c] && PALETTE[p.c].hex) || 0xffffff);
          glow = new THREE.Sprite(glowSpriteMat(col)); glow.scale.setScalar(d.type === 'lens' ? 1.2 : 0.9); glow.position.set(0, 0.05, 0); glow.renderOrder = 6;
          glow.visible = d.type !== 'lens' && d.type !== 'lensc'; mesh.add(glow);
        }
        const base = new THREE.Matrix4().copy(p.m4).multiply(new THREE.Matrix4().makeTranslation(d.pivot[0], d.pivot[1], d.pivot[2]));
        if (d.type === 'text') base.multiply(new THREE.Matrix4().makeScale(def.text.w, 1, def.text.h));
        const vo = { mesh, base, p, d, ang: Math.random() * TAU, up: null, glow };
        switch (d.type) {
          case 'wheel': vo.we = this.wheels.filter(w => w.p === p)[d.wi || 0] || null; vo.rot = rotOnly(p.m); vo.up = visWheel; break;
          case 'flag': vo.up = visFlag; break;
          case 'drill': vo.dr = this.drills.find(e => e.p === p) || null; vo.up = visDrill; break;
          case 'flashA': case 'flashB': case 'dimA': case 'dimB': vo.up = visFlash; break;
          case 'spin': vo.th = this.props.find(e => e.p === p) || this.boats.find(e => e.p === p) || null; vo.up = visSpin; break;
          case 'flap': vo.fo = this.foils.find(f => f.p === p) || null; vo.up = visFlap; break;
          case 'rudder': vo.fo = this.foils.find(f => f.p === p) || null; vo.up = visRudder; break;
          case 'flame': vo.th = this.jets.find(e => e.p === p) || this.rockets.find(e => e.p === p) || null; vo.up = visFlame; break;
          case 'gear': vo.we = this.wheels.find(w => w.p === p) || null; vo.up = visGear; break;
          case 'chute': vo.up = visChute; mesh.visible = false; break;
          case 'claw': vo.up = visClaw; break;
          case 'jtop': case 'jrod': vo.up = visJoint; break;
          case 'beam': vo.up = visBeam; break;
          case 'lens': case 'lensc': mesh.matrix.copy(base); vo.up = visLens; break;
          default: mesh.matrix.copy(base);
        }
        if (vo.up) vo.up(vo, this, 0);
        this.vis.push(vo);
      });
      if (def.kind === 'leg') {
        const strut = new THREE.Mesh(LEG_STRUT, MAT.strut), foot = new THREE.Mesh(LEG_FOOT, MAT.foot);
        strut.castShadow = foot.castShadow = true;
        this.group.add(strut); this.group.add(foot);
        const vo = { strut, foot, p, we: this.wheels.find(w => w.p === p), up: visLeg };
        visLeg(vo, this, 0); this.vis.push(vo);
      }
    }
  }
  updateVisual(dt) {
    this.toWorld(0, 0, 0, this.group.position); this.group.quaternion.copy(this.q);
    // near a black hole the tides stretch it toward the hole and squeeze it thin
    const g = this.group;
    if (this.tidal > 0.01) {
      const st = 1 + this.tidal * 2.4, sq = 1 / Math.sqrt(st), r = _tdr.subVectors(MAW.center, this.x).normalize(), k = st - sq;
      _tdS.set(sq + k * r.x * r.x, k * r.x * r.y, k * r.x * r.z, 0, k * r.y * r.x, sq + k * r.y * r.y, k * r.y * r.z, 0, k * r.z * r.x, k * r.z * r.y, sq + k * r.z * r.z, 0, 0, 0, 0, 1);
      g.matrixAutoUpdate = false;
      g.matrix.makeRotationFromQuaternion(this.q).premultiply(_tdS).setPosition(g.position);
      g.matrixWorldNeedsUpdate = true;
    } else if (!g.matrixAutoUpdate) g.matrixAutoUpdate = true;
    for (const vo of this.vis) if (vo.up) vo.up(vo, this, dt);
  }
  /* ---------- forces ---------- */
  forces(dt) {
    // which anchored tower the wheels held last step (wheelForces fills it in again below)
    this.lastDt = dt; const towerPrev = this.onTower; this.onTower = null;
    const F = this.F.set(0, 0, 0), T = this.T.set(0, 0, 0), M = this.mass, x = this.x, r = this.r, ctl = this.ctl;
    for (const cel of CELS) {
      const dx = cel.center.x - x.x, dy = cel.center.y - x.y, dz = cel.center.z - x.z;
      const r2 = dx * dx + dy * dy + dz * dz, rr = Math.sqrt(r2), g = cel.mu / r2 * M / rr;
      F.x += dx * g; F.y += dy * g; F.z += dz * g;
    }
    const ac = this.airCel = airAt(x), av = this.av;
    let rho = 0;
    if (ac) { this.alt = x.distanceTo(ac.center) - ac.R; rho = airDensity(ac, this.alt); surfaceVel(ac, x, av); } else av.set(0, 0, 0);
    // held in a skyhook grapple the rider is shielded from the wind (otherwise one catch would stop the hook)
    if (this.dock && this.dock.kind === 'grapple') rho = 0;
    this.rho = rho;
    const sc = this.seaCel = seaCelNear(x, this.radius);
    this.groundCel = groundCelNear(x, this.radius);
    // the frame "holding still" means: turning with the air or ground around it (or with the tower it clings to)
    const rc = ac || this.groundCel || (towerPrev && towerPrev.anchored) || null;
    spinVec(rc, _sw);
    const vx = this.v.x - av.x, vy = this.v.y - av.y, vz = this.v.z - av.z, sp2 = vx * vx + vy * vy + vz * vz;
    if (rho > 0 && sp2 > 0.01) {
      const sp = Math.sqrt(sp2);
      const lx = (r[0] * vx + r[3] * vy + r[6] * vz) / sp, ly = (r[1] * vx + r[4] * vy + r[7] * vz) / sp, lz = (r[2] * vx + r[5] * vy + r[8] * vz) / sp;
      const A = Math.abs(lx) * this.Ax + Math.abs(ly) * this.Ay + Math.abs(lz) * this.Az;
      const f = -0.5 * rho * 0.55 * A * sp;
      F.x += vx * f; F.y += vy * f; F.z += vz * f;
    }
    const Iavg = (this.Idiag[0] + this.Idiag[1] + this.Idiag[2]) / 3;
    const dr = this.dragR, ad = rho * dr * dr * dr * 0.8 + Iavg * 0.015 * Math.min(1, rho / RHO0 * 4);
    T.x -= (this.w.x - _sw.x) * ad; T.y -= (this.w.y - _sw.y) * ad; T.z -= (this.w.z - _sw.z) * ad;
    // turn rates in the design frame, relative to the turning world nearby (or the stars out in space)
    const wx = this.w.x - _sw.x, wy = this.w.y - _sw.y, wz = this.w.z - _sw.z;
    const wl0 = r[0] * wx + r[3] * wy + r[6] * wz, wl1 = r[1] * wx + r[4] * wy + r[7] * wz, wl2 = r[2] * wx + r[5] * wy + r[8] * wz;
    // SAS asks for a turn rate; flaps get it as stick, gyros and RCS as their target
    const sas = this.sasW; let s0 = 0, s1 = 0, s2 = 0;
    if (sas) {
      s0 = r[0] * sas.x + r[3] * sas.y + r[6] * sas.z; s1 = r[1] * sas.x + r[4] * sas.y + r[7] * sas.z; s2 = r[2] * sas.x + r[5] * sas.y + r[8] * sas.z;
      const st = this.sasStick || (this.sasStick = [0, 0, 0]);
      st[0] = clamp(-(s0 - wl0) * 3, -1, 1); st[1] = clamp((s2 - wl2) * 3, -1, 1); st[2] = clamp(-(s1 - wl1) * 3, -1, 1);
    }
    if (this.foils.length) this.foilForces(rho);
    for (const pr of this.props) {
      const out = clamp(pr.eng, -0.4, 1) * pr.pw; pr.out = out;
      if (!out || rho <= 0) continue;
      this.toWorld(pr.pos.x, pr.pos.y, pr.pos.z, _p);
      if (sc && _p.distanceTo(sc.center) < sc.R) { pr.out = 0; continue; }
      this.dirW(pr.dir.x, pr.dir.y, pr.dir.z, _n); this.velAt(_p, _u).sub(av);
      const Tm = pr.thrust * out * (rho / RHO0) * Math.max(0, 1 - Math.max(0, _u.dot(_n)) / 95);
      this.addForceAt(_n.x * Tm, _n.y * Tm, _n.z * Tm, _p);
      if (pr.heli && out > 0.05) heliAssist(this, pr, Tm);
    }
    for (const j of this.jets) {
      // afterburners multiply the thrust while their key is held; thrusters push the same in air or water
      const out = Math.max(0, j.eng) * j.pw * (j.boost ? j.ab : 1); j.out = rho > 0 || j.plasma ? out : 0;
      if (!j.out) continue;
      this.toWorld(j.pos.x, j.pos.y, j.pos.z, _p); this.dirW(j.dir.x, j.dir.y, j.dir.z, _n); this.velAt(_p, _u).sub(av);
      const Tm = j.any ? j.thrust * out : j.thrust * out * Math.min(1, rho / RHO0 * 1.4) * (1 - clamp(_u.dot(_n) / 260, 0, 0.8));
      this.addForceAt(_n.x * Tm, _n.y * Tm, _n.z * Tm, _p);
    }
    // balloons lift with the air around them, so they stop climbing where it gets thin
    if (this.balloons.length && rho > 0 && ac) {
      _u.subVectors(x, ac.center).normalize();
      for (const bl of this.balloons) {
        if (!bl.p.alive) continue;
        const L = bl.lift * Math.min(1.2, rho / RHO0); this.toWorld(bl.pos.x, bl.pos.y, bl.pos.z, _p); this.addForceAt(_u.x * L, _u.y * L, _u.z * L, _p);
        // a big soft envelope: lots of drag through the air
        this.velAt(_p, _w).sub(av); const sp = _w.length(); if (sp > 0.05) { const D = -0.5 * rho * 6 * sp; this.addForceAt(_w.x * D, _w.y * D, _w.z * D, _p); }
      }
    }
    this.burning = false;
    if (this.rockets.length) {
      for (const g of this.fgroups) g.dem = 0;
      // ion engines need sunlight, vacuum and a solar panel each
      if (this.nIon) { this.sunT -= dt; if (this.sunT <= 0) { this.sunT = 0.5; this.sunlit = inSunlight(this.x) ? 1 : 0; } }
      const ionK = this.nIon ? this.sunlit * Math.min(1, this.nSolar / this.nIon) * (rho > 0.01 ? 0 : 1) : 0;
      for (const rk of this.rockets) {
        rk.out = 0; rk.k = rk.ion ? ionK : rk.vac ? 1 - 0.65 * Math.min(1, rho / RHO0) : 1;
        if (rk.lvl > 0 && !rk.blocked && rk.k > 0) rk.g.dem += rk.thrust * rk.k * rk.lvl / rk.ve * dt;
      }
      for (const g of this.fgroups) {
        g.sc = 0; if (!g.dem) continue;
        let av = 0; for (const t of g.tanks) av += t.fuel;
        if (av <= 0) continue;
        g.sc = Math.min(1, av / g.dem);
        const k = g.dem * g.sc / av; for (const t of g.tanks) t.fuel -= t.fuel * k;
        this.burning = true;
      }
      if (this.burning) { let f = 0; for (const t of this.tanks) f += t.fuel; this.fuel = f; }
      for (const rk of this.rockets) {
        if (rk.blocked || rk.lvl <= 0 || rk.k <= 0) continue;
        rk.out = rk.lvl * rk.g.sc * rk.k; if (rk.out <= 0) continue;
        this.toWorld(rk.pos.x, rk.pos.y, rk.pos.z, _p); this.dirW(rk.dir.x, rk.dir.y, rk.dir.z, _n);
        const Tm = rk.thrust * rk.out;
        this.addForceAt(_n.x * Tm, _n.y * Tm, _n.z * Tm, _p);
      }
    }
    for (const bp of this.boats) {
      this.toWorld(bp.pos.x, bp.pos.y, bp.pos.z, _p);
      const sub = !!sc && _p.distanceTo(sc.center) < sc.R - 0.05, out = clamp(bp.eng, -0.5, 1) * bp.pw;
      bp.out = sub ? out : out * 0.3;
      if (!sub || !out) continue;
      if (bp.steer && ctl.steer) {
        // an outboard swings its thrust about the boat's up to steer
        const a = ctl.steer * bp.steer, ca = Math.cos(a), sa = Math.sin(a);
        this.dirW(bp.dir.x * ca + bp.dir.z * sa, bp.dir.y, -bp.dir.x * sa + bp.dir.z * ca, _n);
      } else this.dirW(bp.dir.x, bp.dir.y, bp.dir.z, _n);
      const Tm = bp.thrust * out;
      this.addForceAt(_n.x * Tm, _n.y * Tm, _n.z * Tm, _p);
    }
    // gyros: each turns the craft with its own keys, then holds still (or follows SAS) when they're let go
    const tR = this.rcsT > 0 && this.fuel > 0 ? this.rcsT : 0;
    if (this.gyros.length || tR) {
      const Id = this.Idiag, rs = ctl.rs || 1;
      let t0 = 0, t1 = 0, t2 = 0;
      for (const g of this.gyros) {
        const tq = g.torque * g.pw; if (tq <= 0) continue;
        const c0 = g.inP ? -g.inP * rs : sas ? s0 : g.stab ? 0 : NaN;
        const c1 = g.inY ? -g.inY * 0.9 * rs : sas ? s1 : g.stab ? 0 : NaN;
        const c2 = g.inR ? g.inR * 1.5 * rs : sas ? s2 : g.stab ? 0 : NaN;
        if (c0 === c0) t0 += clamp((c0 - wl0) * Id[0] * 5, -tq, tq);
        if (c1 === c1) t1 += clamp((c1 - wl1) * Id[1] * 5, -tq, tq);
        if (c2 === c2) t2 += clamp((c2 - wl2) * Id[2] * 5, -tq, tq);
      }
      if (tR) {
        // RCS blocks answer the craft's pitch, yaw and roll keys, and sip fuel to do it
        const c0 = ctl.pitch ? -ctl.pitch * rs : sas ? s0 : 0, c1 = ctl.steer ? -ctl.steer * 0.9 * rs : sas ? s1 : 0, c2 = ctl.roll ? ctl.roll * 1.5 * rs : sas ? s2 : 0;
        const r0 = clamp((c0 - wl0) * Id[0] * 5, -tR, tR), r1 = clamp((c1 - wl1) * Id[1] * 5, -tR, tR), r2 = clamp((c2 - wl2) * Id[2] * 5, -tR, tR);
        t0 += r0; t1 += r1; t2 += r2;
        const use = (Math.abs(r0) + Math.abs(r1) + Math.abs(r2)) * dt * 1e-5, k = Math.min(1, use / this.fuel);
        for (const t of this.tanks) t.fuel -= t.fuel * k;
        this.fuel *= 1 - k;
      }
      T.x += r[0] * t0 + r[1] * t1 + r[2] * t2; T.y += r[3] * t0 + r[4] * t1 + r[5] * t2; T.z += r[6] * t0 + r[7] * t1 + r[8] * t2;
    }
    // parachutes: big drag at the canopy, trailing into the wind; they tear if opened too fast
    if (this.chutes.length && rho > 0) {
      for (const ch of this.chutes) {
        const p = ch.p; if (p.chute !== 1) continue;
        p.chuteK = Math.min(1, (p.chuteK || 0) + dt * 1.2);
        this.toWorld(ch.pos.x, ch.pos.y, ch.pos.z, _p); this.velAt(_p, _u).sub(av);
        const v2 = _u.lengthSq(); if (v2 < 0.01) continue;
        const q = 0.5 * rho * v2;
        if (q > 4200 * (0.3 + 0.7 * p.chuteK)) { p.chute = 2; if (typeof onChuteTorn === 'function') onChuteTorn(this); continue; }
        const f = -q * 1.4 * PD.chute.area * p.chuteK * p.chuteK / Math.sqrt(v2);
        this.addForceAt(_u.x * f, _u.y * f, _u.z * f, _p);
      }
    }
    this.gearK += clamp((this.gearUp ? 0 : 1) - this.gearK, -dt * 0.8, dt * 0.8);
    // RCS translate mode: W/S forward and back, A/D left and right (design +Z is forward, -X is right)
    if (this.rcsN && (ctl.tx || ctl.tz) && this.fuel > 0) {
      const Fm = this.rcsN * 650, lx = -ctl.tx, lz = ctl.tz, l = Math.hypot(lx, lz);
      const fx = (r[0] * lx + r[2] * lz) / l * Fm, fy = (r[3] * lx + r[5] * lz) / l * Fm, fz = (r[6] * lx + r[8] * lz) / l * Fm;
      F.x += fx; F.y += fy; F.z += fz;
      const k = Math.min(1, Fm / VE * dt / this.fuel);
      for (const t of this.tanks) t.fuel -= t.fuel * k;
      this.fuel *= 1 - k; this.rcsOn = true;
    } else this.rcsOn = false;
    if (this.hovers.length) this.hoverForces(sc);
    if (this.drills.length) this.drillStep(dt);
    if (sc) this.water(sc); else { this.wasWet = false; this.lava = 0; }
    if (this.wheels.length) this.wheelForces(dt);
  }
  /* hover pads: a spring of air between each pad and the ground or water below it, up to HOVER_H away */
  hoverForces(sea) {
    const n = this.hovers.length, k = 5000, c = 1.4 * Math.sqrt(k * this.mass / n), cel = this.groundCel || sea || dominantCel(this.x);
    for (const h of this.hovers) {
      h.x = 0; if (!h.p.alive) continue;
      this.toWorld(h.pos.x, h.pos.y, h.pos.z, _p); this.dirW(h.dir.x, h.dir.y, h.dir.z, _n);
      let t = HOVER_H;
      const hit = groundRay(_p, _n, HOVER_H); if (hit) t = hit.t;
      if (sea) {
        // the sea's surface counts as ground for a hover pad
        _u.subVectors(_p, sea.center); const r = _u.length(), down = -_n.dot(_u) / r;
        if (down > 0.2) { const ts = (r - sea.R) / down; if (ts >= -0.5 && ts < t) t = Math.max(0, ts); }
      }
      if (t >= HOVER_H) continue;
      const x = h.x = HOVER_H - t;
      this.velAt(_p, _u).sub(surfaceVel(cel, _p, _sv));
      const vd = _u.dot(_n), F = clamp(k * x + c * vd, 0, k * HOVER_H * 1.6);
      // pushes away from the ground, and a little drag across it so it doesn't skate for ever
      this.addForceAt(-_n.x * F, -_n.y * F, -_n.z * F, _p);
      const lat = _w.copy(_u).addScaledVector(_n, -vd), dr = -this.mass / n * 0.12;
      this.addForceAt(lat.x * dr, lat.y * dr, lat.z * dr, _p);
    }
  }
  /* drills grind through whatever their spinning tip touches */
  drillStep(dt) {
    for (const d of this.drills) {
      if (!d.on || !d.p.alive) continue;
      this.toWorld(d.pos.x, d.pos.y, d.pos.z, _p);
      const hit = bodyAt(_p, this, 0.42); if (!hit) continue;
      if (hit.o.loose && hit.o.asleep) hit.o.wake();
      addDmg(hit.part, 260 * dt);
      // a little shove, and sparks now and then
      this.dirW(d.dir.x, d.dir.y, d.dir.z, _n);
      if (!jkin(hit.o)) hit.o.impulseAt(_n.x * 900 * dt, _n.y * 900 * dt, _n.z * 900 * dt, _p);
      d.fx = (d.fx || 0) - dt;
      if (d.fx <= 0) { d.fx = 0.08; if (typeof FX !== 'undefined' && FX.sparks) FX.sparks(_p.x, _p.y, _p.z, 4); if (typeof SND !== 'undefined') SND.at('drill', _p, 0.7); }
    }
  }
  foilForces(rho) {
    const ss = this.sasW ? this.sasStick : null;
    for (const f of this.foils) {
      // each flap answers its own keys; an axis left alone follows SAS
      if (f.isFlap) {
        const P = f.inP || (ss ? ss[0] : 0), R = f.inR || (ss ? ss[1] : 0), Y = f.inY || (ss ? ss[2] : 0);
        f.defl = clamp(P * f.kp + R * f.kr + Y * f.ky, -1, 1) * f.ang * f.inv;
      } else f.defl = 0;
      this.toWorld(f.cen.x, f.cen.y, f.cen.z, _p);
      const sea = this.seaCel, under = !!sea && _p.distanceTo(sea.center) < sea.R - 0.05;
      let dens, k, cap, sc;
      if (f.water) { if (!under) continue; dens = sea.sea.rho; k = 2; cap = 0.8; sc = 0.15; this.velAt(_p, _u).sub(surfaceVel(sea, _p, _sv)); }
      else { if (rho <= 0 || under) continue; dens = rho; k = 5; cap = 1.4; sc = 1; this.velAt(_p, _u).sub(this.av); }
      const sp2 = _u.lengthSq(); if (sp2 < 0.25) continue;
      const sp = Math.sqrt(sp2);
      this.dirW(f.nL.x, f.nL.y, f.nL.z, _n);
      const cn = clamp(k * (_u.dot(_n) / sp - f.camber + f.defl * 0.25), -cap, cap);
      const q = 0.5 * dens * sp2 * f.area * sc;
      const fn = -q * cn, fd = -q * (0.02 + 0.1 * cn * cn) / sp;
      this.addForceAt(_n.x * fn + _u.x * fd, _n.y * fn + _u.y * fd, _n.z * fn + _u.z * fd, _p);
    }
  }
  water(sea) {
    const R = sea.R, C = sea.center, RHO = sea.sea.rho, r = this.r, cb = this.cellsB, vol = CELL * CELL * CELL;
    let wet = false, splashP = null, sub = 0;
    for (let i = 0; i < cb.length; i += 4) {
      this.toWorld(cb[i], cb[i + 1], cb[i + 2], _p);
      const px = _p.x - C.x, py = _p.y - C.y, pz = _p.z - C.z, pr = Math.hypot(px, py, pz), depth = R - pr;
      if (depth < -CELL * 0.5) continue;
      const f = clamp(depth / CELL + 0.5, 0, 1);
      wet = true; if (!splashP) splashP = _p.clone();
      if (f > 0.3) { sub++; if (sea.sea.lava) addDmg(this.cellPart[i >> 2], 65 * this.lastDt); }
      const g = sea.mu / (pr * pr), Bf = RHO * vol * cb[i + 3] * f * g;
      const ux = px / pr, uy = py / pr, uz = pz / pr;
      this.velAt(_p, _u).sub(surfaceVel(sea, _p, _sv));
      const lx = r[0] * _u.x + r[3] * _u.y + r[6] * _u.z, ly = r[1] * _u.x + r[4] * _u.y + r[7] * _u.z, lz = r[2] * _u.x + r[5] * _u.y + r[8] * _u.z;
      const k = -0.5 * RHO * CELL * CELL * f;
      const fx = k * 0.09 * lx * Math.abs(lx), fy = k * 0.3 * ly * Math.abs(ly), fz = k * 0.035 * lz * Math.abs(lz);
      const wx = r[0] * fx + r[1] * fy + r[2] * fz, wy = r[3] * fx + r[4] * fy + r[5] * fz, wz = r[6] * fx + r[7] * fy + r[8] * fz;
      this.addForceAt(ux * Bf + wx, uy * Bf + wy, uz * Bf + wz, _p);
    }
    this.lava = sea.sea.lava && sub ? sub / (cb.length / 4) : 0;
    if (wet && !this.wasWet && splashP) {
      const vr = -_u.subVectors(this.v, surfaceVel(sea, this.x, _sv)).dot(_n.subVectors(this.x, C).normalize());
      if (vr > 2.5 && typeof FX !== 'undefined') FX.splash(splashP, Math.min(3, vr / 6) * Math.sqrt(this.radius), sea);
    }
    this.wasWet = wet;
  }
  wheelForces(dt) {
    const ctl = this.ctl;
    const gv = this.groundCel ? surfaceVel(this.groundCel, this.x, _sv) : this.av, sf = 1 / (1 + this.v.distanceTo(gv) / 22);
    const perWheel = this.nDriven > 0 ? this.drivePower / this.nDriven : 0;
    const others = W.bodies.length > 1;
    for (const w of this.wheels) {
      if (w.gear) { if (this.gearK < 0.05) { w.contact = false; w.x = 0; w.off = 0; continue; } w.hub.lerpVectors(w.mount, w.hub0, this.gearK); }
      const target = w.leg ? 0 : -w.st * w.steerMax * w.steerSign * sf;
      const brk = Math.max(w.brk, ctl.brake || 0), thr = w.thr, vlim = (w.vlim || w.vmax) * (w.vcap || 1);
      w.sa += clamp(target - w.sa, -3 * dt, 3 * dt);
      this.toWorld(w.hub.x, w.hub.y, w.hub.z, _p);
      // the spring pushes along this wheel's own "up": body up for cars, sideways for wheels gripping a truss
      this.dirW(w.up.x, w.up.y, w.up.z, _w); const ux = _w.x, uy = _w.y, uz = _w.z;
      const half = w.L * 0.5, maxT = w.L + w.r;
      _q.set(_p.x + ux * half, _p.y + uy * half, _p.z + uz * half);
      _a.set(-ux, -uy, -uz);
      let hit = groundRay(_q, _a, maxT), x = hit ? maxT - hit.t : 0, onB = null, lat = false;
      // other vehicles and towers: wheels ride on them too, and clamp onto trusses
      if (others && !w.gear) {
        const reachT = w.leg ? maxT : Math.max(maxT, half + w.reach + 0.3);
        const bh = bodyRay(this, _q, _a, hit ? Math.min(hit.t, reachT) : reachT);
        if (bh) {
          // a truss slots between the tire treads: touching it at all means a firm grip
          const bx = bh.lattice && !w.leg ? w.L * 0.7 + w.reach - (bh.t - half) : maxT - bh.t;
          if (bx > 0) { hit = bh; x = bx; onB = bh.body; lat = bh.lattice && !w.leg; }
        }
      }
      if (!hit || x <= 0) { w.x = Math.max(0, w.x - dt * 2); w.off = half - w.x; w.contact = false; w.on = null; w.lat = false; w.hold = null; w.spinV *= 0.995; continue; }
      w.contact = true; w.on = onB; w.lat = lat;
      if (onB && onB.anchored) this.onTower = onB;
      if (lat) x = Math.min(x, w.L * 1.5);
      w.x = x;
      // drawn touching the girder when clamped on, otherwise where the spring holds it
      w.off = lat ? w.reach + 0.025 - w.r : half - x;
      const cpx = _q.x - ux * hit.t, cpy = _q.y - uy * hit.t, cpz = _q.z - uz * hit.t;
      _b.set(cpx, cpy, cpz); this.velAt(_b, _u); _u.sub(hit.sv);
      const vd = -(_u.x * ux + _u.y * uy + _u.z * uz);
      // clamped onto a truss the spring is stiffer, so a climber stays centred on its girder
      const kk = lat ? w.k * 2.5 : w.k, cc = lat ? w.c * 1.6 : w.c;
      let Fs = kk * x + cc * vd;
      if (x > w.L) Fs += kk * 8 * (x - w.L);
      Fs = clamp(Fs, 0, kk * maxT * 12);
      this.addForceAt(ux * Fs, uy * Fs, uz * Fs, _b);
      let Rx = ux * Fs, Ry = uy * Fs, Rz = uz * Fs;
      const n = hit.n;
      // steering turns the axle about the wheel's up
      const ca = Math.cos(w.sa), sa = Math.sin(w.sa), ax = w.axle, ua = w.ua;
      this.dirW(ax.x * ca + ua.x * sa, ax.y * ca + ua.y * sa, ax.z * ca + ua.z * sa, _w);
      let fx = _w.y * n.z - _w.z * n.y, fy = _w.z * n.x - _w.x * n.z, fz = _w.x * n.y - _w.y * n.x;
      const fl = Math.hypot(fx, fy, fz);
      if (fl >= 1e-6) {
        fx /= fl; fy /= fl; fz /= fl;
        // keep "forward" the way this wheel was built to drive
        this.dirW(w.roll.x, w.roll.y, w.roll.z, _w);
        if (fx * _w.x + fy * _w.y + fz * _w.z < 0) { fx = -fx; fy = -fy; fz = -fz; }
        const sx = n.y * fz - n.z * fy, sy = n.z * fx - n.x * fz, sz = n.x * fy - n.y * fx;
        const vlong = _u.x * fx + _u.y * fy + _u.z * fz, vlat = _u.x * sx + _u.y * sy + _u.z * sz;
        const mu = w.leg ? 0.9 : lat ? 2.0 : w.mu || 1.05, lim = mu * Fs;
        let Flat = -clamp(vlat / (lat ? 0.8 : 0.6), -1, 1) * lim * (w.track ? 0.55 : 1), Flong = 0;
        if (w.leg) Flong = -clamp(vlong / 0.35, -1, 1) * lim;
        else if (lat) {
          // clamped on a truss
          const share = this.mass / this.wheels.length;
          // the end of the girder ahead: never drive off it, slow down in time to stop on it
          const dirS = Math.abs(vlong) > 0.3 ? Math.sign(vlong) : Math.sign(thr);
          let vt = Infinity;
          if (dirS) { const dEnd = girderAhead(onB, cpx - n.x * 0.1, cpy - n.y * 0.1, cpz - n.z * 0.1, fx * dirS, fy * dirS, fz * dirS, 2.5 + vlong * vlong / 14); vt = Math.sqrt(2 * 8 * Math.max(0, dEnd - 0.8)); }
          if ((thr === 0 && !(brk > 0)) || (vt < 0.4 && dirS * thr >= 0)) {
            // nobody driving, or parked at the end: hold still on a stiff spring
            const H = w.hold;
            if (!H || H.B !== onB) w.hold = { B: onB, p: onB.toDesign(_b.set(cpx, cpy, cpz), new V3()) };
            else {
              onB.toWorld(H.p.x, H.p.y, H.p.z, _b);
              const e = (cpx - _b.x) * fx + (cpy - _b.y) * fy + (cpz - _b.z) * fz;
              if (Math.abs(e) > 0.6) w.hold = null;
              Flong = clamp(-share * (400 * e + 36 * vlong), -lim, lim);
            }
          } else {
            w.hold = null;
            if (thr !== 0 && perWheel > 0) {
              let Fd = thr * Math.min(lim * 0.8, perWheel * w.pw / Math.max(Math.abs(vlong), 2.5));
              if (thr * w.inv < 0) Fd *= 0.6;
              if (thr * vlong > 0 && Math.abs(vlong) > vlim) Fd = 0;
              if (dirS * thr > 0 && dirS * vlong > vt - 1) Fd = 0;
              Flong += Fd;
            }
            if (brk > 0) Flong += -clamp(vlong / 0.35, -1, 1) * lim * brk;
            // never run away downhill, and brake for the end of the girder
            if (Math.abs(vlong) > vlim) Flong -= Math.sign(vlong) * lim * 0.6;
            if (dirS * vlong > vt) Flong = -dirS * lim;
          }
        } else {
          const car = !onB && hit.mover;
          if (car && thr === 0) {
            // parked on a train car: hold the spot on its deck on a stiff spring (as far as grip allows), so nothing
            // creeps off it on the bends or rolls about as the train starts and stops
            const H = w.hold;
            _mh.subVectors(hit.lp, car.base);
            const lx = _mh.dot(car.X), ly = _mh.dot(car.Y), lz = _mh.dot(car.Z);
            if (!H || H.B !== car) w.hold = { B: car, x: lx, y: ly, z: lz };
            else {
              _mh.copy(car.X).multiplyScalar(lx - H.x).addScaledVector(car.Y, ly - H.y).addScaledVector(car.Z, lz - H.z);
              fromSpin(car.cel, _mh, _mh);
              const el = _mh.x * fx + _mh.y * fy + _mh.z * fz, es = _mh.x * sx + _mh.y * sy + _mh.z * sz;
              if (el * el + es * es > 0.36) w.hold = null;
              const share = this.mass / this.wheels.length;
              Flong = -share * (400 * el + 36 * vlong); Flat = -share * (400 * es + 36 * vlat);
            }
          } else {
            if (w.hold && w.hold.B.mover) w.hold = null;
            if (thr !== 0 && perWheel > 0 && !w.gear) {
              let Fd = thr * Math.min(lim * 0.8, perWheel * w.pw / Math.max(Math.abs(vlong), 2.5));
              if (thr * w.inv < 0) Fd *= 0.6;
              if (thr * vlong > 0 && Math.abs(vlong) > vlim) Fd = 0;
              Flong += Fd;
            }
            if (brk > 0) Flong += -clamp(vlong / 0.35, -1, 1) * lim * brk;
            Flong += thr === 0 ? -clamp(vlong / 0.3, -1, 1) * Fs * (Math.abs(vlong) < 1.2 ? 0.09 : 0.035) : -clamp(vlong, -1, 1) * Fs * 0.012;
          }
        }
        const tot = Math.hypot(Flong, Flat);
        if (tot > lim * 1.05) { const s = lim * 1.05 / tot; Flong *= s; Flat *= s; }
        const tx = fx * Flong + sx * Flat, ty = fy * Flong + sy * Flat, tz = fz * Flong + sz * Flat;
        if (lat) {
          // climbing: the drive acts along the girder through the centre of mass, so uneven grip can't twist the climber off
          this.F.x += fx * Flong; this.F.y += fy * Flong; this.F.z += fz * Flong;
          _b.set(cpx, cpy, cpz); this.addForceAt(sx * Flat, sy * Flat, sz * Flat, _b);
        } else {
          const hc = (this.x.x - cpx) * ux + (this.x.y - cpy) * uy + (this.x.z - cpz) * uz;
          const ah = Math.max(w.r * 0.3, hc * 0.55);
          _b.set(cpx + ux * ah, cpy + uy * ah, cpz + uz * ah);
          this.addForceAt(tx, ty, tz, _b);
        }
        Rx += tx; Ry += ty; Rz += tz;
        w.spinV = vlong / w.r;
      }
      // whatever the wheel stands on gets pushed back, unless it is parked, anchored or carried
      if (onB && !onB.asleep && !onB.dock) { _b.set(cpx, cpy, cpz); onB.impulseAt(-Rx * dt, -Ry * dt, -Rz * dt, _b); }
    }
  }
  sleepCheck(dt) {
    // resting on the ground, or holding on to an anchored tower
    const c = this.groundCel || (this.onTower && this.onTower.anchored && !this.onTower.dead ? this.onTower.anchored : null);
    if (this.player || !c || this.wasWet || this.heat > 0 || this.jointed || this.carrying) { this.sleepT = 0; return; }
    if (this.v.distanceToSquared(surfaceVel(c, this.x, _sv)) < 0.03 && this.w.distanceToSquared(spinVec(c, _sw)) < 0.03) {
      this.sleepT += dt;
      if (this.sleepT > 1.5) this.pin(c, false);
    } else this.sleepT = 0;
  }
  /* sleep riding along with a moving world; frozen bodies keep their velocity for later */
  pin(c, frozen) {
    // where it sits and how it is turned, in the world's own (spinning) frame
    this.asleep = true; this.frozen = frozen; this.pinCel = c;
    toSpin(c, _pt.subVectors(this.x, c.center), this.pinRel);
    this.pinQ.copy(c.spinQ).invert().multiply(this.q);
    if (frozen) { toSpin(c, _pt.copy(this.v).sub(surfaceVel(c, this.x, _pt2)), this.pinVrel); toSpin(c, _pt.copy(this.w).sub(spinVec(c, _pt2)), this.pinW); }
    else { this.pinVrel.set(0, 0, 0); this.pinW.set(0, 0, 0); }
    surfaceVel(c, this.x, this.v); spinVec(c, this.w);
  }
  /* a sleeping body rides along as its world moves and turns */
  pinUpdate() {
    const c = this.pinCel;
    fromSpin(c, this.pinRel, this.x).add(c.center);
    this.q.copy(c.spinQ).multiply(this.pinQ); this.updR();
    surfaceVel(c, this.x, this.v); spinVec(c, this.w);
  }
  /* velocity it really has, including what a time-warp freeze is holding back */
  trueVel(out) { if (this.asleep && this.frozen && this.pinCel) return surfaceVel(this.pinCel, this.x, out).add(fromSpin(this.pinCel, this.pinVrel, _pt)); return out.copy(this.v); }
  trueW(out) { if (this.asleep && this.frozen && this.pinCel) return spinVec(this.pinCel, out).add(fromSpin(this.pinCel, this.pinW, _pt)); return out.copy(this.w); }
}

/* one wheel, leg or gear: dn is the way it presses (design frame), roll the way "forward" drives it */
function makeWheel(p, hub, axle, dn, r, L) {
  const up = dn.clone().negate();
  const roll = new V3().crossVectors(axle, up);
  // forward is design +Z when the wheel can roll that way, otherwise up (climbers), otherwise +X
  if (roll.z < -0.5 || (Math.abs(roll.z) < 0.5 && (roll.y < -0.5 || (Math.abs(roll.y) < 0.5 && roll.x < 0)))) roll.negate();
  const colY = new V3(p.m[1], p.m[4], p.m[7]);
  const sgn = Math.sign(new V3().crossVectors(up, roll).dot(colY)) || 1;
  return { p, hub, axle, up, dn, ua: new V3().crossVectors(up, axle), roll, sgn, r, L, reach: r, steerMax: 0, steerSign: 1, vmax: 0, leg: false, gear: false,
    x: 0, off: L * 0.5, spin: 0, spinV: 0, sa: 0, contact: false, on: null, lat: false, hold: null, k: 1, c: 0,
    // inputs (set each frame for the machine you drive) and settings
    thr: 0, brk: 0, st: 0, rev: false, pw: 1, vlim: 0, brkK: 1, inv: 1, steerMode: 1 };
}
/* ---------- part visual animators ---------- */
const _m3 = new THREE.Matrix4();
function visWheel(vo, b, dt) {
  const we = vo.we;
  if (!we) { vo.mesh.matrix.copy(vo.base); return; }
  we.spin = (we.spin + we.spinV * dt * we.sgn) % TAU;
  const off = we.off;
  _m1.makeTranslation(we.hub.x + we.dn.x * off, we.hub.y + we.dn.y * off, we.hub.z + we.dn.z * off);
  if (we.sa) { _m2.makeRotationAxis(we.up, we.sa); _m1.multiply(_m2); }
  _m1.multiply(vo.rot);
  _m2.makeRotationY(we.spin); _m1.multiply(_m2);
  vo.mesh.matrix.copy(_m1);
}
/* helicopter rotors keep the craft level by themselves: the pitch and roll keys tilt it up to about 22°,
   the steering keys turn it on the spot, and letting go levels it out again */
const _hla = new V3(), _hlv = new V3(), _hlf = new V3(), _hlr = new V3(), _hlt = new V3(), _hlw = new V3();
function heliAssist(b, pr, thrust) {
  const c = b.airCel || b.groundCel || dominantCel(b.x), ctl = b.ctl;
  _hlv.subVectors(b.x, c.center).normalize();
  const u = b.dirW(pr.dir.x, pr.dir.y, pr.dir.z, _hla);
  b.dirW(0, 0, 1, _hlf); _hlf.addScaledVector(_hlv, -_hlf.dot(_hlv)); if (_hlf.lengthSq() < 1e-6) return; _hlf.normalize();
  _hlr.crossVectors(_hlf, _hlv);
  const k = 0.4;
  _hlt.copy(_hlv).addScaledVector(_hlf, -(ctl.pitch || 0) * k).addScaledVector(_hlr, (ctl.roll || 0) * k).normalize();
  const ax = _hlw.crossVectors(u, _hlt), s = ax.length(), ang = Math.asin(Math.min(1, s));
  // the turn rate it wants: back toward the target tilt, plus the yaw the steering keys ask for
  const wd = s > 1e-6 ? ax.multiplyScalar(ang * 3.2 / s) : ax.set(0, 0, 0);
  wd.addScaledVector(u, -(ctl.steer || 0) * 1.2);
  spinVec(c, _hlt); wd.sub(b.w).add(_hlt);
  const Iavg = (b.Idiag[0] + b.Idiag[1] + b.Idiag[2]) / 3, tq = Iavg * 7, lim = thrust * 1.2;
  wd.multiplyScalar(tq); const l = wd.length(); if (l > lim) wd.multiplyScalar(lim / l);
  b.T.add(wd);
}
function visSpin(vo, b, dt) {
  const out = vo.th ? vo.th.out : 0;
  vo.ang = (vo.ang + out * 42 * dt) % TAU;
  vo.mesh.matrix.copy(vo.base).multiply(_m2.makeRotationY(vo.ang));
}
function visFlag(vo, b, dt) {
  vo.ang = (vo.ang + dt * (2.5 + Math.min(6, b.v.distanceTo(b.av || b.v) * 0.3))) % TAU;
  vo.mesh.matrix.copy(vo.base).multiply(_m2.makeRotationY(Math.sin(vo.ang) * 0.35 + Math.sin(vo.ang * 2.3) * 0.12));
}
function visDrill(vo, b, dt) {
  vo.sp = lerp(vo.sp || 0, vo.dr && vo.dr.on ? 30 : 0, Math.min(1, dt * 4));
  vo.ang = (vo.ang + vo.sp * dt) % TAU;
  vo.mesh.matrix.copy(vo.base).multiply(_m2.makeRotationY(vo.ang));
}
function visFlash(vo, b, dt) {
  const on = !!vo.p.lbOn, ph = (W.time * 3.2 + (vo.p.uid % 7) * 0.13) % 1 < 0.5, t = vo.d.type;
  vo.mesh.visible = t === 'flashA' ? on && ph : t === 'flashB' ? on && !ph : t === 'dimA' ? !(on && ph) : !(on && !ph);
  if (vo.mesh.visible) vo.mesh.matrix.copy(vo.base);
}
function visFlap(vo, b, dt) {
  const fo = vo.fo, a = fo ? fo.defl * 0.45 * fo.nsgn : 0;
  vo.ang = lerp(vo.ang || 0, a, Math.min(1, dt * 10));
  vo.mesh.matrix.copy(vo.base).multiply(_m2.makeRotationX(vo.ang));
}
function visRudder(vo, b, dt) {
  const fo = vo.fo, a = fo ? -fo.defl * 0.45 * fo.nsgn : 0;
  vo.ang = lerp(vo.ang || 0, a, Math.min(1, dt * 8));
  vo.mesh.matrix.copy(vo.base).multiply(_m2.makeRotationY(vo.ang));
}
function visFlame(vo, b, dt) {
  const out = vo.th ? vo.th.out : 0;
  if (out < 0.02) { vo.mesh.visible = false; return; }
  vo.mesh.visible = true;
  const s = out * (0.78 + 0.22 * Math.random()), w = 0.65 + 0.35 * out;
  vo.mesh.matrix.copy(vo.base).multiply(_m2.makeScale(w, Math.max(0.12, s), w));
}
function visGear(vo, b, dt) {
  const we = vo.we;
  const k = b.gearK;
  vo.mesh.visible = k > 0.02;
  if (!vo.mesh.visible) return;
  const off = we ? (we.L * 0.5 - we.x) * k : 0;
  we && (we.spin = (we.spin + we.spinV * dt) % TAU);
  // fold: shrink the strut toward the mount while retracting
  vo.mesh.matrix.copy(vo.base).multiply(_m2.makeTranslation(0, -off, 0)).multiply(_m3.makeScale(1, Math.max(0.05, k), 1));
}
function visChute(vo, b, dt) {
  const st = vo.p.chute || 0;
  if (st !== 1) { vo.mesh.visible = false; vo.open = 0; return; }
  vo.mesh.visible = true; vo.open = Math.min(1, (vo.open || 0) + dt * 1.6);
  // canopy trails into the relative wind
  b.velAt(b.toWorld(vo.p.cen[0], vo.p.cen[1], vo.p.cen[2], _vc1), _vc2).sub(b.av);
  if (_vc2.lengthSq() < 4) _vc2.subVectors(b.groundCel ? b.groundCel.center : b.x, b.x).negate();
  _vc2.normalize().negate();
  // into the body's design frame
  const r = b.r; _vc3.set(r[0] * _vc2.x + r[3] * _vc2.y + r[6] * _vc2.z, r[1] * _vc2.x + r[4] * _vc2.y + r[7] * _vc2.z, r[2] * _vc2.x + r[5] * _vc2.y + r[8] * _vc2.z);
  _vq1.setFromUnitVectors(_vy, _vc3);
  const s = 0.2 + 0.8 * vo.open;
  _vc1.set(vo.p.a[0] * CELL, vo.p.a[1] * CELL, vo.p.a[2] * CELL);
  vo.mesh.matrix.compose(_vc1, _vq1, _vs.set(s, 0.4 + 0.6 * vo.open, s));
}
function visClaw(vo, b, dt) {
  const shut = vo.p.grip ? 1 : 0;
  vo.ang = lerp(vo.ang || 0, shut, Math.min(1, dt * 8));
  const k = 1 - vo.ang * 0.35;
  vo.mesh.matrix.copy(vo.base).multiply(_m2.makeScale(k, 1, vo.p.def.claw ? k : 1));
}
function visLens(vo, b, dt) { if (vo.glow) vo.glow.visible = !!LIGHTS.on && vo.p.alive !== false; }
const GLOW_MATS = new Map();
let GLOW_TEX = null;
function glowSpriteMat(col) {
  let m = GLOW_MATS.get(col);
  if (!m) {
    if (!GLOW_TEX) GLOW_TEX = makeGlowTexture('rgba(255,255,255,0.85)', 'rgba(255,255,255,0)');
    m = new THREE.SpriteMaterial({ map: GLOW_TEX, color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.75 });
    GLOW_MATS.set(col, m);
  }
  return m;
}
function visBeam(vo, b, dt) { vo.mesh.visible = !!LIGHTS.on; if (vo.mesh.visible) vo.mesh.matrix.copy(vo.base); }
/* moving half of a hinge, rotor, piston or spring: drawn in the base body's frame but placed by the other body */
function visJoint(vo, b, dt) {
  const j = vo.p.joint, B = j && j.ap.body;
  if (!j || !B || B === b || B.dead) { vo.mesh.matrix.copy(vo.base); return; }
  // B's design frame expressed in b's design frame
  _vq1.copy(b.q).invert();
  _vq2.copy(_vq1).multiply(B.q);
  B.toWorld(0, 0, 0, _vc1); b.toDesign(_vc1, _vc2);
  _m1.compose(_vc2, _vq2, _vs.set(1, 1, 1));
  if (vo.d.type === 'jtop') { vo.mesh.matrix.multiplyMatrices(_m1, vo.base); return; }
  // rod: from the base anchor out to the moving top
  const ext = Math.max(0, j.s || 0) + 0.3;
  vo.mesh.matrix.copy(vo.base).multiply(_m2.makeTranslation(0, -0.15, 0)).multiply(_m3.makeScale(1, ext, 1));
}
const _vc1 = new V3(), _vc2 = new V3(), _vc3 = new V3(), _vq1 = new Quat(), _vq2 = new Quat(), _vs = new V3(), _vy = new V3(0, 1, 0);
const LIGHTS = { on: false };
function visLeg(vo, b, dt) {
  const def = vo.p.def.leg, a = vo.p.a, we = vo.we;
  const off = we ? we.L * 0.5 - we.x : 0;
  const len = def.drop + off;
  vo.strut.position.set(a[0] * CELL, a[1] * CELL, a[2] * CELL); vo.strut.scale.set(1, len, 1);
  vo.foot.position.set(a[0] * CELL, a[1] * CELL - len, a[2] * CELL);
}

/* ---------- ground queries ---------- */
const _hit = { t: 0, n: new V3(), sv: new V3() };
function fCel(cel, ox, oy, oz, d, t) {
  const px = ox + d.x * t, py = oy + d.y * t, pz = oz + d.z * t, r = Math.hypot(px, py, pz);
  return r - (cel.R + cel.height(px / r, py / r, pz / r));
}
function rayCel(cel, ox, oy, oz, d, maxT) {
  const f0 = fCel(cel, ox, oy, oz, d, 0); if (f0 <= 0) return 0;
  const f1 = fCel(cel, ox, oy, oz, d, maxT); if (f1 > 0) return null;
  let lo = 0, hi = maxT, flo = f0, fhi = f1;
  for (let i = 0; i < 4; i++) {
    const t = lo + (hi - lo) * flo / (flo - fhi), ft = fCel(cel, ox, oy, oz, d, t);
    if (ft > 0) { lo = t; flo = ft; } else { hi = t; fhi = ft; }
    if (Math.abs(ft) < 0.002) break;
  }
  return lo + (hi - lo) * flo / (flo - fhi);
}
function groundRay(o, d, maxT) {
  let bt = 1e9, bc = null, bp = null;
  for (const cel of ROCKY) {
    const ox = o.x - cel.center.x, oy = o.y - cel.center.y, oz = o.z - cel.center.z;
    if (Math.hypot(ox, oy, oz) > cel.R + cel.maxH + maxT + 5) continue;
    const t = rayCel(cel, ox, oy, oz, d, maxT);
    if (t !== null && t < bt) { bt = t; bc = cel; }
  }
  for (const cel of PG.cels) {
    const cc = cel.center;
    if (Math.hypot(o.x - cc.x, o.y - cc.y, o.z - cc.z) > cel.R + cel.maxH + 400 + maxT) continue;
    toSpin(cel, _pl.set(o.x - cc.x, o.y - cc.y, o.z - cc.z), _pl); toSpin(cel, d, _pd);
    _pl2.copy(_pl).addScaledVector(_pd, maxT / 2);
    pgQuery(cel, _pl2, maxT / 2 + 0.5, pr => {
      if (_pl.distanceToSquared(pr.c) > (pr.r + maxT) * (pr.r + maxT)) return;
      const t = rayConvex(pr, _pl, _pd, maxT, _pn);
      if (t !== null && t < bt) { bt = t; bp = pr; bc = null; fromSpin(pr.cel, _pn, _hit.n); }
    });
    // train cars
    for (const pr of W.movers) {
      if (pr.cel !== cel || _pl.distanceToSquared(pr.c) > (pr.r + maxT) * (pr.r + maxT)) continue;
      const t = rayConvex(pr, _pl, _pd, maxT, _pn);
      if (t !== null && t < bt) { bt = t; bp = pr; bc = null; fromSpin(pr.cel, _pn, _hit.n); _hit.lp.copy(_pl).addScaledVector(_pd, t); }
    }
  }
  if (!bc && !bp) return null;
  _hit.t = bt;
  if (bc) {
    const px = o.x + d.x * bt - bc.center.x, py = o.y + d.y * bt - bc.center.y, pz = o.z + d.z * bt - bc.center.z;
    const r = Math.hypot(px, py, pz), ux = px / r, uy = py / r, uz = pz / r;
    surfaceNormal(bc, ux, uy, uz, bc.height(ux, uy, uz), _hit.n);
  }
  surfaceVel(bc || bp.cel, _pd.set(o.x + d.x * bt, o.y + d.y * bt, o.z + d.z * bt), _hit.sv);
  if (bp && bp.mover) _hit.sv.add(fromSpin(bp.cel, moverVel(bp, _hit.lp, _pd), _pd));
  _hit.mover = bp && bp.mover ? bp : null;
  return _hit;
}
const _pl = new V3(), _pl2 = new V3(), _pd = new V3(), _mh = new V3();
_hit.lp = new V3();
/* wheels against other vehicles and towers: step the ray through each nearby body's grid of cells */
const _bhit = { t: 0, n: new V3(), sv: new V3(), body: null, part: null, lattice: false };
const _bo = new V3(), _bc = new V3();
function bodyRay(self, o, d, maxT) {
  let best = null, bt = maxT;
  for (const B of W.bodies) {
    if (B === self || B.dead || B.asmId === self.asmId) continue;
    if ((B.dock && B.dock.carrier === self) || (self.dock && self.dock.carrier === B)) continue;
    const rx = B.x.x - o.x, ry = B.x.y - o.y, rz = B.x.z - o.z;
    const tc = clamp(rx * d.x + ry * d.y + rz * d.z, 0, bt);
    const ex = rx - d.x * tc, ey = ry - d.y * tc, ez = rz - d.z * tc, rr = B.radius + 0.6;
    if (ex * ex + ey * ey + ez * ez > rr * rr) continue;
    B.toDesign(o, _bo);
    const r = B.r;
    const dx = (r[0] * d.x + r[3] * d.y + r[6] * d.z) / CELL, dy = (r[1] * d.x + r[4] * d.y + r[7] * d.z) / CELL, dz = (r[2] * d.x + r[5] * d.y + r[8] * d.z) / CELL;
    const px = _bo.x / CELL + 0.5, py = _bo.y / CELL + 0.5, pz = _bo.z / CELL + 0.5;
    let ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
    // starting inside a cell is left to the solid contacts
    if (B.grid.has(ckey(ix, iy, iz))) continue;
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const ddx = Math.abs(dx) > 1e-12 ? 1 / Math.abs(dx) : Infinity, ddy = Math.abs(dy) > 1e-12 ? 1 / Math.abs(dy) : Infinity, ddz = Math.abs(dz) > 1e-12 ? 1 / Math.abs(dz) : Infinity;
    let tx = ddx === Infinity ? Infinity : (dx > 0 ? ix + 1 - px : px - ix) * ddx;
    let ty = ddy === Infinity ? Infinity : (dy > 0 ? iy + 1 - py : py - iy) * ddy;
    let tz = ddz === Infinity ? Infinity : (dz > 0 ? iz + 1 - pz : pz - iz) * ddz;
    for (let s = 0; s < 48; s++) {
      let t, axis;
      if (tx <= ty && tx <= tz) { t = tx; ix += sx; tx += ddx; axis = 0; }
      else if (ty <= tz) { t = ty; iy += sy; ty += ddy; axis = 1; }
      else { t = tz; iz += sz; tz += ddz; axis = 2; }
      if (t > bt) break;
      const part = B.grid.get(ckey(ix, iy, iz));
      if (!part) continue;
      bt = t; best = B; _bhit.part = part; _bhit.lattice = !!part.def.lattice;
      B.dirW(axis === 0 ? -sx : 0, axis === 1 ? -sy : 0, axis === 2 ? -sz : 0, _bhit.n);
      break;
    }
  }
  if (!best) return null;
  _bhit.t = bt; _bhit.body = best;
  _bc.set(o.x + d.x * bt, o.y + d.y * bt, o.z + d.z * bt);
  best.velAt(_bc, _bhit.sv);
  return _bhit;
}
/* how far a girder runs on from a point inside it (metres, up to maxD) */
const _ga = new V3(), _gb = new V3();
function girderAhead(B, px, py, pz, dx, dy, dz, maxD) {
  _ga.set(px, py, pz); B.toDesign(_ga, _gb);
  const r = B.r, lx = r[0] * dx + r[3] * dy + r[6] * dz, ly = r[1] * dx + r[4] * dy + r[7] * dz, lz = r[2] * dx + r[5] * dy + r[8] * dz;
  // girders run along the grid: follow the cells straight down the girder, even if the climber leans a little
  const ax = Math.abs(lx), ay = Math.abs(ly), az = Math.abs(lz);
  const sx = ax >= ay && ax >= az ? Math.sign(lx) : 0, sy = !sx && ay >= az ? Math.sign(ly) : 0, sz = !sx && !sy ? Math.sign(lz) : 0;
  let cx = Math.round(_gb.x / CELL), cy = Math.round(_gb.y / CELL), cz = Math.round(_gb.z / CELL);
  const n = Math.min(400, Math.ceil(maxD / CELL));
  for (let i = 1; i <= n; i++) {
    cx += sx; cy += sy; cz += sz;
    const p = B.grid.get(ckey(cx, cy, cz));
    if (!p || !p.def.lattice) return i * CELL - CELL / 2;
  }
  return Infinity;
}
/* ---------- ground anchors: a body whose anchor spikes touch the ground is locked to that world ---------- */
const _an = new V3(), _ap = new V3();
function tryAnchor(b) {
  if (b.anchored || b.anchorOff || b.dock || b.dead) return false;
  for (const a of b.anchors) {
    if (!a.p.alive) continue;
    b.toWorld(a.pos.x, a.pos.y, a.pos.z, _ap); b.dirW(a.dir.x, a.dir.y, a.dir.z, _an);
    const cel = groundCelNear(_ap, 4); if (!cel) continue;
    const hit = groundRay(_ap, _an, 1.4); if (!hit) continue;
    // spikes have to face the ground, and a falling tower doesn't stop dead
    if (_an.dot(hit.n) > -0.5 || b.v.distanceTo(surfaceVel(cel, b.x, _sv)) > 8) continue;
    anchorBody(b, cel);
    return true;
  }
  return false;
}
function anchorBody(b, cel) {
  b.anchored = cel; b.frozen = false;
  b.pin(cel, false); b.w.set(0, 0, 0);
  if (b.debris) { b.debris = false; b.name = b.name.replace(/ (debris|piece|stage)$/, '') + ' tower'; }
  // highest point, for the climbing readout
  let top = -Infinity; const up = _an.subVectors(b.x, cel.center).normalize(), n = b.parts.length;
  for (const p of b.parts) { const c = p.cells[p.cells.length - 1], c0 = p.cells[0]; for (const cc of [c0, c]) { b.toWorld(cc[0] * CELL, cc[1] * CELL, cc[2] * CELL, _ap); top = Math.max(top, _ap.sub(cel.center).dot(up)); } }
  b.topR = top + CELL / 2;
  if (typeof onAnchored === 'function') onAnchored(b, true);
}
function unanchorBody(b) {
  if (!b.anchored) return;
  const cel = b.anchored; b.anchored = null;
  b.asleep = false; b.frozen = false; b.sleepT = 0; surfaceVel(cel, b.x, b.v); spinVec(cel, b.w);
  if (typeof onAnchored === 'function') onAnchored(b, false);
}
/* static convex props (ramps), stored in the frame of the world they sit on */
/* a solid convex shape fixed to a world (buildings, ramps, bridge decks): planes in the world's own frame */
function convexPlanes(V, F, c, internal) {
  const planes = [];
  for (let fi = 0; fi < F.length; fi++) {
    const f = F[fi];
    const a = V[f[0]], b = V[f[1]], d = V[f[2]];
    const n = new V3().subVectors(b, a).cross(new V3().subVectors(d, a));
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    const fc = new V3(); for (const i of f) fc.add(V[i]); fc.divideScalar(f.length);
    if (n.dot(new V3().subVectors(fc, c)) < 0) n.negate();
    const dd = n.dot(a);
    if (planes.some(p => p.nx * n.x + p.ny * n.y + p.nz * n.z > 0.9999 && Math.abs(p.d - dd) < 1e-3)) continue;
    planes.push({ nx: n.x, ny: n.y, nz: n.z, d: dd, int: internal && internal.includes(fi) ? 1 : 0 });
  }
  return planes;
}
/* internal: faces shared with the next piece of a chain (road, loop, half-pipe); a point never gets pushed out through them */
function makeCollider(V, F, cel, tag, internal) {
  const c = new V3(); for (const v of V) c.add(v); c.divideScalar(V.length);
  let r = 0; for (const v of V) r = Math.max(r, v.distanceTo(c));
  const pr = { c, r, planes: convexPlanes(V, F, c, internal), mesh: null, cel, tag: tag || null, _s: 0 };
  W.props.push(pr); pgInsert(pr);
  return pr;
}
function makeConvex(V, F, color, cel) {
  const pr = makeCollider(V, F, cel), c = pr.c;
  const g = polyGeo(V.map(v => [v.x - c.x, v.y - c.y, v.z - c.z]), F);
  const gb = new GB(); gb.add(g, color); const geo = gb.geometry();
  const mesh = new THREE.Mesh(geo, MAT.veh); mesh.position.copy(c).add(cel.center); mesh.castShadow = true; mesh.receiveShadow = true;
  pr.mesh = mesh;
  return pr;
}
/* props filed by 32 m chunk of their world's own frame, so a wheel only checks what is right next to it */
const PG = { size: 32, map: new Map(), stamp: 1, cels: [] };
const pgKey = (ci, i, j, k) => ((ci * 1024 + i + 512) * 1024 + j + 512) * 1024 + k + 512;
function pgInsert(pr) {
  const ci = CELS.indexOf(pr.cel), s = PG.size, c = pr.c, r = pr.r;
  if (!PG.cels.includes(pr.cel)) PG.cels.push(pr.cel);
  for (let i = Math.floor((c.x - r) / s); i <= Math.floor((c.x + r) / s); i++)
    for (let j = Math.floor((c.y - r) / s); j <= Math.floor((c.y + r) / s); j++)
      for (let k = Math.floor((c.z - r) / s); k <= Math.floor((c.z + r) / s); k++) {
        const key = pgKey(ci, i, j, k); let l = PG.map.get(key); if (!l) PG.map.set(key, l = []); l.push(pr);
      }
}
/* every prop of this world near local point p (within rad), each once */
function pgQuery(cel, p, rad, fn) {
  const ci = CELS.indexOf(cel), s = PG.size, st = ++PG.stamp;
  if (rad > 150) { for (const pr of W.props) if (pr.cel === cel && pr._s !== st) { pr._s = st; fn(pr); } return; }
  for (let i = Math.floor((p.x - rad) / s); i <= Math.floor((p.x + rad) / s); i++)
    for (let j = Math.floor((p.y - rad) / s); j <= Math.floor((p.y + rad) / s); j++)
      for (let k = Math.floor((p.z - rad) / s); k <= Math.floor((p.z + rad) / s); k++) {
        const l = PG.map.get(pgKey(ci, i, j, k)); if (!l) continue;
        for (const pr of l) if (pr._s !== st) { pr._s = st; fn(pr); }
      }
}
function convexDepth(pr, p, nout) {
  let best = -1e9, bi = -1;
  for (let i = 0; i < pr.planes.length; i++) {
    const pl = pr.planes[i], s = pl.nx * p.x + pl.ny * p.y + pl.nz * p.z - pl.d;
    if (s > 0.04) return null;
    if (s > best && !pl.int) { best = s; bi = i; }
  }
  if (bi < 0) return null;
  const pl = pr.planes[bi]; nout.set(pl.nx, pl.ny, pl.nz);
  return -best;
}
function rayConvex(pr, o, d, maxT, nout) {
  let tE = 0, tX = maxT, ni = -1, bestIn = -1e9, bi = 0;
  for (let i = 0; i < pr.planes.length; i++) {
    const pl = pr.planes[i];
    const den = pl.nx * d.x + pl.ny * d.y + pl.nz * d.z, dist = pl.nx * o.x + pl.ny * o.y + pl.nz * o.z - pl.d;
    if (dist > bestIn) { bestIn = dist; bi = i; }
    if (Math.abs(den) < 1e-9) { if (dist > 0) return null; continue; }
    const t = -dist / den;
    if (den < 0) { if (t > tE) { tE = t; ni = i; } } else if (t < tX) tX = t;
    if (tE > tX) return null;
  }
  // a ray that starts inside the solid does not see it (a wheel brushing a wall must not be thrown up by it)
  if (ni < 0) return null;
  const pl = pr.planes[ni]; nout.set(pl.nx, pl.ny, pl.nz);
  return tE;
}

/* ---------- contacts ---------- */
const CP = []; let CN = 0;
function kEff(c, dx, dy, dz) {
  const A = c.A; let k = A.invM;
  let cx = c.ay * dz - c.az * dy, cy = c.az * dx - c.ax * dz, cz = c.ax * dy - c.ay * dx, iw = A.iw;
  k += cx * (iw[0] * cx + iw[1] * cy + iw[2] * cz) + cy * (iw[3] * cx + iw[4] * cy + iw[5] * cz) + cz * (iw[6] * cx + iw[7] * cy + iw[8] * cz);
  const B = c.B;
  if (B) {
    k += B.invM; cx = c.by * dz - c.bz * dy; cy = c.bz * dx - c.bx * dz; cz = c.bx * dy - c.by * dx; iw = B.iw;
    k += cx * (iw[0] * cx + iw[1] * cy + iw[2] * cz) + cy * (iw[3] * cx + iw[4] * cy + iw[5] * cz) + cz * (iw[6] * cx + iw[7] * cy + iw[8] * cz);
  }
  return k;
}
function relVel(c, out) {
  const A = c.A, w = A.w;
  out.x = A.v.x + w.y * c.az - w.z * c.ay; out.y = A.v.y + w.z * c.ax - w.x * c.az; out.z = A.v.z + w.x * c.ay - w.y * c.ax;
  const B = c.B;
  if (B) { const u = B.w; out.x -= B.v.x + u.y * c.bz - u.z * c.by; out.y -= B.v.y + u.z * c.bx - u.x * c.bz; out.z -= B.v.z + u.x * c.by - u.y * c.bx; }
  else { out.x -= c.svx; out.y -= c.svy; out.z -= c.svz; }
  return out;
}
function applyImp(c, jx, jy, jz) {
  const A = c.A; let im = A.invM, iw = A.iw;
  A.v.x += jx * im; A.v.y += jy * im; A.v.z += jz * im;
  let tx = c.ay * jz - c.az * jy, ty = c.az * jx - c.ax * jz, tz = c.ax * jy - c.ay * jx;
  A.w.x += iw[0] * tx + iw[1] * ty + iw[2] * tz; A.w.y += iw[3] * tx + iw[4] * ty + iw[5] * tz; A.w.z += iw[6] * tx + iw[7] * ty + iw[8] * tz;
  const B = c.B;
  if (B) {
    im = B.invM; iw = B.iw;
    B.v.x -= jx * im; B.v.y -= jy * im; B.v.z -= jz * im;
    tx = c.by * jz - c.bz * jy; ty = c.bz * jx - c.bx * jz; tz = c.bx * jy - c.by * jx;
    B.w.x -= iw[0] * tx + iw[1] * ty + iw[2] * tz; B.w.y -= iw[3] * tx + iw[4] * ty + iw[5] * tz; B.w.z -= iw[6] * tx + iw[7] * ty + iw[8] * tz;
  }
}
function contact(A, B, px, py, pz, nx, ny, nz, depth, pa, pb, sv, mu, other, dt) {
  if (CN >= CP.length) CP.push({});
  const c = CP[CN++];
  c.A = A; c.B = B; c.nx = nx; c.ny = ny; c.nz = nz; c.pa = pa; c.pb = pb; c.mu = mu; c.other = other;
  c.ax = px - A.x.x; c.ay = py - A.x.y; c.az = pz - A.x.z;
  if (B) { c.bx = px - B.x.x; c.by = py - B.x.y; c.bz = pz - B.x.z; c.svx = c.svy = c.svz = 0; }
  else { c.bx = c.by = c.bz = 0; c.svx = sv.x; c.svy = sv.y; c.svz = sv.z; }
  let tx, ty, tz;
  if (Math.abs(nx) < 0.85) { tx = 0; ty = nz; tz = -ny; } else { tx = -nz; ty = 0; tz = nx; }
  let l = Math.hypot(tx, ty, tz); tx /= l; ty /= l; tz /= l;
  c.t1x = tx; c.t1y = ty; c.t1z = tz;
  c.t2x = ny * tz - nz * ty; c.t2y = nz * tx - nx * tz; c.t2z = nx * ty - ny * tx;
  c.kn = kEff(c, nx, ny, nz); c.k1 = kEff(c, c.t1x, c.t1y, c.t1z); c.k2 = kEff(c, c.t2x, c.t2y, c.t2z);
  relVel(c, _rv);
  const vn0 = c.vn0 = _rv.x * nx + _rv.y * ny + _rv.z * nz;
  let tgt = depth < 0 ? depth / dt : Math.min(4, 0.25 * Math.max(0, depth - 0.005) / dt);
  if (vn0 < -2.5) tgt = Math.max(tgt, -0.12 * vn0);
  // bumpers bounce things off
  const bo = (pa && pa.def && pa.def.bounce) || (pb && pb.def && pb.def.bounce) || 0;
  if (bo && vn0 < -0.8) { tgt = Math.max(tgt, -bo * vn0); if (vn0 < -3 && typeof SND !== 'undefined') SND.at('bounce', _rv.set(px, py, pz), clamp(-vn0 / 12, 0.2, 1)); }
  c.tgt = tgt; c.jn = 0; c.j1 = 0; c.j2 = 0; c.depth = depth;
}
function solveContacts(iters) {
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < CN; i++) {
      const c = CP[i];
      relVel(c, _rv);
      const vn = _rv.x * c.nx + _rv.y * c.ny + _rv.z * c.nz;
      let dj = (c.tgt - vn) / c.kn;
      const nj = Math.max(0, c.jn + dj); dj = nj - c.jn; c.jn = nj;
      if (dj !== 0) applyImp(c, c.nx * dj, c.ny * dj, c.nz * dj);
      relVel(c, _rv);
      const v1 = _rv.x * c.t1x + _rv.y * c.t1y + _rv.z * c.t1z, v2 = _rv.x * c.t2x + _rv.y * c.t2y + _rv.z * c.t2z;
      let n1 = c.j1 - v1 / c.k1, n2 = c.j2 - v2 / c.k2;
      const lim = c.mu * c.jn, m = Math.hypot(n1, n2);
      if (m > lim) { const s = lim / (m || 1); n1 *= s; n2 *= s; }
      const d1 = n1 - c.j1, d2 = n2 - c.j2; c.j1 = n1; c.j2 = n2;
      if (d1 !== 0 || d2 !== 0) applyImp(c, c.t1x * d1 + c.t2x * d2, c.t1y * d1 + c.t2y * d2, c.t1z * d1 + c.t2z * d2);
    }
  }
}
function terrainContacts(b, cel, dt) {
  const cx = b.x.x - cel.center.x, cy = b.x.y - cel.center.y, cz = b.x.z - cel.center.z, dc = Math.hypot(cx, cy, cz);
  if (dc - b.radius > cel.R + cel.maxH + 2) return;
  const hc = cel.height(cx / dc, cy / dc, cz / dc);
  // nothing above the highest mountain can touch the ground (long towers have thousands of points)
  const top = Math.min(cel.R + hc + b.radius * 1.6 + 2, cel.R + cel.maxH * 1.5 + 30);
  if (dc - b.radius > top) return;
  const pts = b.pts;
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i]; if (pt.gear && b.gearK < 0.95) continue; b.toWorld(pt.x, pt.y, pt.z, _p);
    const rx = _p.x - cel.center.x, ry = _p.y - cel.center.y, rz = _p.z - cel.center.z, r = Math.hypot(rx, ry, rz);
    if (r > top) continue;
    const ux = rx / r, uy = ry / r, uz = rz / r, h = cel.height(ux, uy, uz), depth = cel.R + h - r;
    if (depth < -0.05) continue;
    surfaceNormal(cel, ux, uy, uz, h, _n);
    const dn = depth * (_n.x * ux + _n.y * uy + _n.z * uz);
    contact(b, null, _p.x, _p.y, _p.z, _n.x, _n.y, _n.z, dn, pt.part, null, surfaceVel(cel, _p, _sv), 0.75, null, dt);
  }
}
function propContacts(b, dt) {
  for (const cel of PG.cels) {
    const cc = cel.center;
    if (b.x.distanceTo(cc) > cel.R + cel.maxH + 400 + b.radius) continue;
    toSpin(cel, _pl2.subVectors(b.x, cc), _pl2);
    pgQuery(cel, _pl2, b.radius + 0.5, pr => propPoints(b, pr, dt));
    for (const pr of W.movers) if (pr.cel === cel) propPoints(b, pr, dt);
  }
}
const _mvp = new V3();
function propPoints(b, pr, dt) {
  {
    const cc = pr.cel.center;
    if (_pl2.distanceTo(pr.c) > pr.r + b.radius) return;
    for (const pt of b.pts) {
      if (pt.gear && b.gearK < 0.95) continue;
      b.toWorld(pt.x, pt.y, pt.z, _p);
      toSpin(pr.cel, _pl.subVectors(_p, cc), _pl);
      if (_pl.distanceToSquared(pr.c) > pr.r * pr.r) continue;
      const d = convexDepth(pr, _pl, _n); if (d === null) continue;
      fromSpin(pr.cel, _n, _n);
      surfaceVel(pr.cel, _p, _sv);
      if (pr.mover) _sv.add(fromSpin(pr.cel, moverVel(pr, _pl, _mvp), _mvp));
      contact(b, null, _p.x, _p.y, _p.z, _n.x, _n.y, _n.z, d, pt.part, null, _sv, pr.mu || 0.7, null, dt);
    }
  }
}
function gridContacts(A, B, dt) {
  if (A.asmId === B.asmId || (A.dock && A.dock.carrier === B) || (B.dock && B.dock.carrier === A)) return;
  const aDyn = !A.asleep && !A.dock, bDyn = !B.asleep && !B.dock; if (!aDyn && !bDyn) return;
  const rB = B.radius + 0.5, rB2 = rB * rB;
  if (A.ptChunks && rB < 60) {
    // only the chunks of A's points near B
    A.toDesign(B.x, _q2);
    const i0 = Math.floor((_q2.x - rB) / PT_CHUNK), i1 = Math.floor((_q2.x + rB) / PT_CHUNK), j0 = Math.floor((_q2.y - rB) / PT_CHUNK), j1 = Math.floor((_q2.y + rB) / PT_CHUNK), k0 = Math.floor((_q2.z - rB) / PT_CHUNK), k1 = Math.floor((_q2.z + rB) / PT_CHUNK);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
      const list = A.ptChunks.get(chunkKey(i, j, k)); if (!list) continue;
      for (const pt of list) gridPoint(A, B, pt, rB2, aDyn, bDyn, dt);
    }
    return;
  }
  for (const pt of A.pts) gridPoint(A, B, pt, rB2, aDyn, bDyn, dt);
}
const _q2 = new V3();
function gridPoint(A, B, pt, rB2, aDyn, bDyn, dt) {
  if (pt.gear && A.gearK < 0.95) return;
  A.toWorld(pt.x, pt.y, pt.z, _p);
  if (_p.distanceToSquared(B.x) > rB2) return;
  B.toDesign(_p, _q);
  const fx = _q.x / CELL, fy = _q.y / CELL, fz = _q.z / CELL;
  const ix = Math.round(fx), iy = Math.round(fy), iz = Math.round(fz);
  const part = B.grid.get(ckey(ix, iy, iz)); if (!part) return;
  // a wheel's cells are only the space its tire turns in: girders slide between the treads
  if (part.def.kind === 'wheel' && pt.part.def.lattice) return;
  const ox = fx - ix, oy = fy - iy, oz = fz - iz;
  let best = -1, bd = 9;
  for (let k = 0; k < 6; k++) { const d = DIRS[k], dist = 0.5 - (ox * d[0] + oy * d[1] + oz * d[2]); if (dist < bd && !B.grid.has(ckey(ix + d[0], iy + d[1], iz + d[2]))) { bd = dist; best = k; } }
  if (best < 0) for (let k = 0; k < 6; k++) { const d = DIRS[k], dist = 0.5 - (ox * d[0] + oy * d[1] + oz * d[2]); if (dist < bd) { bd = dist; best = k; } }
  const d = DIRS[best]; B.dirW(d[0], d[1], d[2], _n);
  const depth = bd * CELL;
  if (aDyn && bDyn) contact(A, B, _p.x, _p.y, _p.z, _n.x, _n.y, _n.z, depth, pt.part, part, null, 0.55, B, dt);
  else if (aDyn) contact(A, null, _p.x, _p.y, _p.z, _n.x, _n.y, _n.z, depth, pt.part, part, B.velAt(_p, _sv), 0.55, B, dt);
  else contact(B, null, _p.x, _p.y, _p.z, -_n.x, -_n.y, -_n.z, depth, part, pt.part, A.velAt(_p, _sv), 0.55, A, dt);
}
function gatherContacts(dt) {
  CN = 0;
  const L = W.bodies;
  for (const b of L) { if (b.asleep || b.dock) continue; if (b.groundCel) terrainContacts(b, b.groundCel, dt); if (W.props.length || W.movers.length) propContacts(b, dt); }
  for (let i = 0; i < L.length; i++) {
    const A = L[i];
    for (let j = i + 1; j < L.length; j++) {
      const C = L[j];
      if ((A.asleep || A.dock) && (C.asleep || C.dock)) continue;
      const rr = A.radius + C.radius;
      if (A.x.distanceToSquared(C.x) > rr * rr) continue;
      if (A.asleep && (C.v.distanceToSquared(A.velAt(C.x, _sv)) > 0.25 || C.w.distanceToSquared(A.w) > 0.25 || C.player)) A.wake();
      if (C.asleep && (A.v.distanceToSquared(C.velAt(A.x, _sv)) > 0.25 || A.w.distanceToSquared(C.w) > 0.25 || A.player)) C.wake();
      gridContacts(A, C, dt); gridContacts(C, A, dt);
    }
  }
}
function addDmg(p, a) { if (a <= 0 || p.broken) return; const o = W.dmg.get(p) || 0; if (a > o) W.dmg.set(p, a); }
function contactDamage() {
  for (let i = 0; i < CN; i++) {
    const c = CP[i];
    if (c.jn <= 0) continue;
    const imp = -c.vn0; if (imp < DMG_V) continue;
    const base = (imp - DMG_V) * (imp - DMG_V) * 0.8;
    if (c.pa) addDmg(c.pa, base * (c.other ? Math.min(1, c.other.mass / (c.pa.mass * 4)) : 1));
    if (c.pb && c.other) addDmg(c.pb, base * Math.min(1, c.A.mass / (c.pb.mass * 4)));
    if (imp > 9 && Math.random() < 0.35 && typeof FX !== 'undefined') FX.sparks(c.A.x.x + c.ax, c.A.x.y + c.ay, c.A.x.z + c.az, imp);
    // the hardest hit this step, for the crash sound
    if (imp > W.hit.v) { W.hit.v = imp; W.hit.p.set(c.A.x.x + c.ax, c.A.x.y + c.ay, c.A.x.z + c.az); W.hit.m = Math.min(c.A.mass, c.other ? c.other.mass : c.A.mass); }
  }
}

/* ---------- integration & step ---------- */
function integrateVel(b, dt) {
  const im = b.invM; b.v.x += b.F.x * im * dt; b.v.y += b.F.y * im * dt; b.v.z += b.F.z * im * dt;
  const iw = b.iw, T = b.T;
  b.w.x += (iw[0] * T.x + iw[1] * T.y + iw[2] * T.z) * dt; b.w.y += (iw[3] * T.x + iw[4] * T.y + iw[5] * T.z) * dt; b.w.z += (iw[6] * T.x + iw[7] * T.y + iw[8] * T.z) * dt;
  const wl = b.w.length(); if (wl > 60) b.w.multiplyScalar(60 / wl);
}
function integratePos(b, dt) {
  const fv = b.fc ? b.fc.vel : ZERO;
  b.x.x += (b.v.x - fv.x) * dt; b.x.y += (b.v.y - fv.y) * dt; b.x.z += (b.v.z - fv.z) * dt;
  const q = b.q, w = b.w, hx = w.x * dt * 0.5, hy = w.y * dt * 0.5, hz = w.z * dt * 0.5;
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  q.x += hx * qw + hy * qz - hz * qy; q.y += hy * qw + hz * qx - hx * qz; q.z += hz * qw + hx * qy - hy * qx; q.w += -hx * qx - hy * qy - hz * qz;
  q.normalize();
}
/* ---------- links: docking ports, grapples, claws and winch hooks ----------
   The lighter body rides on the heavier one. Every step it hands its own forces and its change of
   momentum back to the carrier, so catching a plane really does slow a skyhook down. */
const _dk = new V3(), _dk2 = new V3(), _dk3 = new V3(), _dq = new Quat(), _dq2 = new Quat();
function attach(F, C, kind, fp, cp, align, blend) {
  if (F.dock) detach(F);
  let qT = F.q.clone(), oT = F.toWorld(0, 0, 0, new V3());
  if (align) {
    // turn so the two faces meet, then slide the follower's face onto the carrier's
    const fd = F.dirW(align.fDir.x, align.fDir.y, align.fDir.z, new V3()), cd = C.dirW(align.cDir.x, align.cDir.y, align.cDir.z, new V3());
    qT = new Quat().setFromUnitVectors(fd, cd.clone().negate()).multiply(F.q);
    const cp0 = C.toWorld(align.cPos.x, align.cPos.y, align.cPos.z, new V3()).addScaledVector(cd, align.gap || 0);
    const R = new THREE.Matrix4().makeRotationFromQuaternion(qT);
    oT = cp0.sub(align.fPos.clone().applyMatrix4(R));
  }
  if (C.dock) C = C.dock.carrier;
  const qi = _dq.copy(C.q).invert();
  const o0 = C.toDesign(F.toWorld(0, 0, 0, new V3()), new V3()), q0 = qi.clone().multiply(F.q);
  const o1 = C.toDesign(oT, new V3()), q1 = qi.clone().multiply(qT);
  F.dock = { carrier: C, kind, fp, cp, o: o1, q: q1, o0, q0, t: blend ? 0 : 1, dur: blend || 1, vPrev: F.v.clone() };
  if (fp) fp.linked = true; if (cp) cp.linked = true;
  for (const e of [...F.rockets, ...F.jets, ...F.props, ...F.boats]) e.out = 0;
  F.asleep = false; F.frozen = false; C.wake(); C.carrying = true;
  placeFollower(F, 0); F.dock.vPrev.copy(F.v);
  if (typeof onLinked === 'function') onLinked(F, C, kind);
}
function placeFollower(F, dt) {
  const D = F.dock, C = D.carrier;
  D.t = Math.min(1, D.t + dt / D.dur);
  const k = D.t * D.t * (3 - 2 * D.t);
  _dk3.lerpVectors(D.o0, D.o, k);
  C.toWorld(_dk3.x, _dk3.y, _dk3.z, _dk3);
  F.q.copy(C.q).multiply(_dq2.copy(D.q0).slerp(D.q, k)); F.updR();
  const c = F.comD;
  F.x.set(_dk3.x + F.r[0] * c.x + F.r[1] * c.y + F.r[2] * c.z, _dk3.y + F.r[3] * c.x + F.r[4] * c.y + F.r[5] * c.z, _dk3.z + F.r[6] * c.x + F.r[7] * c.y + F.r[8] * c.z);
  C.velAt(F.x, F.v); F.w.copy(C.w);
}
function detach(F) {
  const D = F.dock; if (!D) return false;
  if (D.fp) D.fp.linked = false; if (D.cp) D.cp.linked = false;
  // a skyhook tip curves away slowly: don't let it snatch you straight back
  F.dock = null; F.dockCool = D.kind === 'grapple' ? 10 : 2.5;
  return true;
}
/* keep links pointing at the right bodies after crashes and splits */
function checkLinks() {
  for (const F of W.bodies.slice()) {
    const D = F.dock; if (!D) continue;
    if ((D.fp && !D.fp.alive) || (D.cp && !D.cp.alive) || D.carrier.dead) { detach(F); continue; }
    if (D.cp && D.cp.body !== D.carrier) D.carrier = D.cp.body;
    if (D.fp && D.fp.body !== F) { const nf = D.fp.body; F.dock = null; if (nf && !nf.dead && !nf.dock) nf.dock = D; continue; }
    if (D.carrier === F || D.carrier.dock) detach(F);
  }
  for (const b of W.bodies) b.carrying = false;
  for (const b of W.bodies) if (b.dock) b.dock.carrier.carrying = true;
}
const lighter = (a, b) => a.mass <= b.mass;
function linkPair(P, pp, Q, qp, kind, align, blend) {
  // the lighter one follows; a body already riding something hands over to its carrier
  if (P.dock || (!Q.dock && lighter(P, Q))) attach(P, Q, kind, pp, qp, align, blend);
  else attach(Q, P, kind, qp, pp, align && { fPos: align.cPos, fDir: align.cDir, cPos: align.fPos, cDir: align.fDir, gap: align.gap }, blend);
}
/* docking ports meet other ports up close; grapples reach out about 25 m for a port facing them */
function tryDocking() {
  const ports = [], grabs = [];
  for (const b of W.bodies) {
    if (b.dead || b.debris || b.dockCool > 0) continue;
    for (const d of b.docks) if (d.p.alive && !d.p.linked) ports.push({ b, d });
    for (const g of b.grapples) if (g.p.alive && !g.p.linked) grabs.push({ b, d: g });
  }
  if (!ports.length) return;
  const pw = new V3(), pd = new V3(), qw = new V3(), qd = new V3(), pv = new V3(), qv = new V3();
  for (let i = 0; i < ports.length; i++) {
    const P = ports[i];
    P.b.toWorld(P.d.pos.x, P.d.pos.y, P.d.pos.z, pw); P.b.dirW(P.d.dir.x, P.d.dir.y, P.d.dir.z, pd);
    const cand = ports.slice(i + 1).map(o => ({ o, reach: 2.2, face: -0.7, dv: 6 })).concat(grabs.map(o => ({ o, reach: 25, face: -0.2, dv: 35, grab: true })));
    for (const { o: Q, reach, face, dv, grab } of cand) {
      if (Q.b === P.b || Q.b.asmId === P.b.asmId || P.d.p.linked || Q.d.p.linked) continue;
      if (Q.b.x.distanceTo(pw) > Q.b.radius + reach + 2) continue;
      Q.b.toWorld(Q.d.pos.x, Q.d.pos.y, Q.d.pos.z, qw);
      const dist = qw.distanceTo(pw); if (dist > reach) continue;
      Q.b.dirW(Q.d.dir.x, Q.d.dir.y, Q.d.dir.z, qd);
      if (pd.dot(qd) > face) continue;
      if (P.b.velAt(pw, pv).distanceTo(Q.b.velAt(qw, qv)) > dv) continue;
      const align = { fPos: P.d.pos, fDir: P.d.dir, cPos: Q.d.pos, cDir: Q.d.dir, gap: grab ? 0.35 : 0 };
      linkPair(P.b, P.d.p, Q.b, Q.d.p, grab ? 'grapple' : 'dock', align, grab ? 0.5 + dist * 0.04 : 0.3);
      break;
    }
  }
}
/* couplers on two vehicles that touch, facing each other, lock together on a swivel */
function tryCoupling() {
  const list = [];
  for (const b of W.bodies) { if (b.dead || b.debris) continue; for (const c of b.couplers) if (c.p.alive && !c.p.cpl && !(c.p.cplCool > W.time)) list.push({ b, c }); }
  if (list.length < 2) return;
  const pw = new V3(), qw = new V3(), pd = new V3(), qd = new V3();
  for (let i = 0; i < list.length; i++) {
    const P = list[i]; if (P.c.p.cpl) continue;
    P.b.toWorld(P.c.pos.x, P.c.pos.y, P.c.pos.z, pw); P.b.dirW(P.c.dir.x, P.c.dir.y, P.c.dir.z, pd);
    for (let k = i + 1; k < list.length; k++) {
      const Q = list[k]; if (Q.c.p.cpl || Q.b === P.b || Q.b.asmId === P.b.asmId) continue;
      Q.b.toWorld(Q.c.pos.x, Q.c.pos.y, Q.c.pos.z, qw); if (qw.distanceTo(pw) > 0.45) continue;
      Q.b.dirW(Q.c.dir.x, Q.c.dir.y, Q.c.dir.z, qd); if (pd.dot(qd) > -0.6) continue;
      const j = { type: 'ball', def: { type: 'ball' }, jp: P.c.p, ap: Q.c.p, axis: new V3(0, 1, 0), ref: new V3(1, 0, 0), coupler: true,
        anchor: P.c.pos.clone(), anchorB: Q.c.pos.clone(), target: 0, spin: 0, hold: 0, theta: 0, s: 0, acc: 0, kMul: 1, cMul: 1 };
      P.c.p.cpl = Q.c.p.cpl = j; W.joints.push(j);
      if (typeof SND !== 'undefined') SND.at('dock', pw, 1);
      if (typeof onLinked === 'function') onLinked(P.b, Q.b, 'coupler');
      break;
    }
  }
}
function uncouple(parts) {
  let n = 0;
  for (const p of parts) { const j = p.cpl; if (!j) continue; j.gone = true; j.jp.cpl = j.ap.cpl = null; j.jp.cplCool = j.ap.cplCool = W.time + 2; n++; }
  if (n) cleanJoints();
  return n;
}
/* claws and winch hooks: grab whatever is touching the tip */
function bodyAt(p, self, r) {
  for (const o of W.bodies) {
    if (o === self || o.dead || o.asmId === self.asmId) continue;
    if (o.x.distanceTo(p) > o.radius + r + 0.5) continue;
    o.toDesign(p, _dk);
    const cx = Math.round(_dk.x / CELL), cy = Math.round(_dk.y / CELL), cz = Math.round(_dk.z / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      if (!o.grid.has(ckey(cx + dx, cy + dy, cz + dz))) continue;
      const ex = (cx + dx) * CELL - _dk.x, ey = (cy + dy) * CELL - _dk.y, ez = (cz + dz) * CELL - _dk.z;
      if (ex * ex + ey * ey + ez * ez < r * r) return { o, part: o.grid.get(ckey(cx + dx, cy + dy, cz + dz)) };
    }
  }
  return null;
}
function clawGrab(b, cl) {
  b.toWorld(cl.pos.x, cl.pos.y, cl.pos.z, _dk2);
  const hit = bodyAt(_dk2, b, cl.r || 0.75); if (!hit) return false;
  cl.p.grip = true;
  linkPair(b, cl.p, hit.o, hit.part, 'claw', null, 0);
  return true;
}
function releaseParts(set) {
  let n = 0;
  for (const F of W.bodies) { const D = F.dock; if (D && ((D.fp && set.has(D.fp)) || (D.cp && set.has(D.cp)))) { detach(F); n++; } }
  for (const p of set) { if (p.grip) p.grip = false; }
  return n;
}

/* ---------- joints: hinges, rotors, pistons and springs between parts of one machine ---------- */
W.joints = [];
function makeJoint(jp, ap) {
  const d = jp.def.joint, m = jp.m;
  const colX = new V3(m[0], m[3], m[6]), colY = new V3(m[1], m[4], m[7]);
  const A = new V3(jp.a[0] * CELL, jp.a[1] * CELL, jp.a[2] * CELL);
  const j = { type: d.type, def: d, jp, ap, axis: d.type === 'hinge' ? colX : colY, ref: d.type === 'hinge' ? colY : colX,
    anchor: d.type === 'hinge' ? A : A.clone().addScaledVector(colY, d.type === 'ball' ? 0.06 : 0.25), target: 0, spin: 0, hold: 0, theta: 0, s: 0, acc: 0,
    kMul: d.type === 'susp' ? cfgGet(jp, 'stiff') / 100 : 1, cMul: d.type === 'susp' ? cfgGet(jp, 'damp') / 100 : 1 };
  jp.joint = j;
  W.joints.push(j);
  return j;
}
function jointBodies(j) {
  const A = j.jp.alive ? j.jp.body : null, B = j.ap.alive ? j.ap.body : null;
  return A && B && A !== B && !A.dead && !B.dead ? [A, B] : null;
}
function cleanJoints() {
  // cables go when the winch or the hook is gone; an orphaned hook becomes wreckage
  if (W.ropes.length) W.ropes = W.ropes.filter(r => { const ok = r.wp.alive && r.wp.body && !r.wp.body.dead && r.hook && !r.hook.dead; if (!ok && r.hook && !r.hook.dead) r.hook.debris = true; return ok; });
  const keep = [];
  for (const j of W.joints) {
    if (jointBodies(j) && !j.gone) { keep.push(j); continue; }
    if (j.coupler) { j.jp.cpl = null; j.ap.cpl = null; continue; }
    if (j.jp.joint === j) j.jp.joint = null;
    if (typeof onJointLost === 'function') onJointLost(j);
  }
  W.joints = keep;
}
/* machines: bodies joined by joints or winch cables share an id (no self-collisions) */
function assignAssemblies() {
  const par = new Map();
  const find = b => { let r = b; while (par.get(r) !== r) r = par.get(r); let c = b; while (par.get(c) !== r) { const n = par.get(c); par.set(c, r); c = n; } return r; };
  for (const b of W.bodies) { par.set(b, b); b.jointed = false; }
  const uni = (a, b) => { if (!par.has(a) || !par.has(b)) return; const ra = find(a), rb = find(b); if (ra !== rb) par.set(ra, rb); };
  for (const j of W.joints) { const ab = jointBodies(j); if (ab) { uni(ab[0], ab[1]); ab[0].jointed = ab[1].jointed = true; } }
  for (const r of W.ropes) if (r.wp.alive && r.hook && !r.hook.dead) { uni(r.wp.body, r.hook); r.wp.body.jointed = r.hook.jointed = true; }
  for (const b of W.bodies) b.asmId = find(b).id;
}
function assemblyOf(b) { return W.bodies.filter(o => o.asmId === b.asmId && !o.dead); }
const _jv = new V3(), _jw = new V3(), _ja = new V3(), _jb = new V3(), _jc = new V3(), _jd = new V3(), _je = new V3(), _jr1 = new V3(), _jr2 = new V3();
const jkin = b => b.asleep || !!b.dock;
function applyLin(A, B, rA, rB, ix, iy, iz) {
  // impulse +i on B at rB, -i on A at rA
  if (!jkin(B)) { B.v.x += ix * B.invM; B.v.y += iy * B.invM; B.v.z += iz * B.invM; const tx = rB.y * iz - rB.z * iy, ty = rB.z * ix - rB.x * iz, tz = rB.x * iy - rB.y * ix, I = B.iw; B.w.x += I[0] * tx + I[1] * ty + I[2] * tz; B.w.y += I[3] * tx + I[4] * ty + I[5] * tz; B.w.z += I[6] * tx + I[7] * ty + I[8] * tz; }
  if (!jkin(A)) { A.v.x -= ix * A.invM; A.v.y -= iy * A.invM; A.v.z -= iz * A.invM; const tx = rA.y * iz - rA.z * iy, ty = rA.z * ix - rA.x * iz, tz = rA.x * iy - rA.y * ix, I = A.iw; A.w.x -= I[0] * tx + I[1] * ty + I[2] * tz; A.w.y -= I[3] * tx + I[4] * ty + I[5] * tz; A.w.z -= I[6] * tx + I[7] * ty + I[8] * tz; }
}
function applyAng(A, B, ix, iy, iz) {
  if (!jkin(B)) { const I = B.iw; B.w.x += I[0] * ix + I[1] * iy + I[2] * iz; B.w.y += I[3] * ix + I[4] * iy + I[5] * iz; B.w.z += I[6] * ix + I[7] * iy + I[8] * iz; }
  if (!jkin(A)) { const I = A.iw; A.w.x -= I[0] * ix + I[1] * iy + I[2] * iz; A.w.y -= I[3] * ix + I[4] * iy + I[5] * iz; A.w.z -= I[6] * ix + I[7] * iy + I[8] * iz; }
}
function kLin(A, B, rA, rB, u) {
  let k = (jkin(A) ? 0 : A.invM) + (jkin(B) ? 0 : B.invM);
  for (const [bd, r] of [[A, rA], [B, rB]]) {
    if (jkin(bd)) continue;
    const cx = r.y * u.z - r.z * u.y, cy = r.z * u.x - r.x * u.z, cz = r.x * u.y - r.y * u.x, I = bd.iw;
    k += cx * (I[0] * cx + I[1] * cy + I[2] * cz) + cy * (I[3] * cx + I[4] * cy + I[5] * cz) + cz * (I[6] * cx + I[7] * cy + I[8] * cz);
  }
  return k;
}
function kAng(A, B, u) {
  let k = 0;
  for (const bd of [A, B]) { if (jkin(bd)) continue; const I = bd.iw; k += u.x * (I[0] * u.x + I[1] * u.y + I[2] * u.z) + u.y * (I[3] * u.x + I[4] * u.y + I[5] * u.z) + u.z * (I[6] * u.x + I[7] * u.y + I[8] * u.z); }
  return k;
}
const _perp1 = new V3(), _perp2 = new V3();
function perpOf(a) { tangentBasis(a.x, a.y, a.z, _perp1, _perp2); }
function solveJoint(j, dt, first) {
  const ab = jointBodies(j); if (!ab) return;
  const [A, B] = ab; if (jkin(A) && jkin(B)) return;
  const beta = 0.25 / dt;
  const anB = j.anchorB || j.anchor;
  const pA = A.toWorld(j.anchor.x, j.anchor.y, j.anchor.z, _ja), pB = B.toWorld(anB.x, anB.y, anB.z, _jb);
  _jr1.subVectors(pA, A.x); _jr2.subVectors(pB, B.x);
  const aA = A.dirW(j.axis.x, j.axis.y, j.axis.z, _jc), aB = B.dirW(j.axis.x, j.axis.y, j.axis.z, _jd);
  // relative velocity at the anchor
  const vrel = () => { A.velAt(pA, _jv); B.velAt(pB, _jw); return _jw.sub(_jv); };
  const C = _je.subVectors(pB, pA);
  const prism = j.type === 'piston' || j.type === 'susp';
  if (first) { j.s = C.dot(aA); j.acc = 0; }
  if (!prism) {
    // pin the anchor (three directions)
    for (const u of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      _perp1.set(u[0], u[1], u[2]);
      const k = kLin(A, B, _jr1, _jr2, _perp1); if (k <= 0) continue;
      const vr = vrel().dot(_perp1), err = clamp(C.dot(_perp1) * beta, -6, 6);
      const lam = -(vr + err) / k;
      applyLin(A, B, _jr1, _jr2, _perp1.x * lam, _perp1.y * lam, _perp1.z * lam);
    }
  } else {
    // slide only along the axis
    perpOf(aA);
    for (const u of [_perp1.clone(), _perp2.clone()]) {
      const k = kLin(A, B, _jr1, _jr2, u); if (k <= 0) continue;
      const lam = -(vrel().dot(u) + clamp(C.dot(u) * beta, -6, 6)) / k;
      applyLin(A, B, _jr1, _jr2, u.x * lam, u.y * lam, u.z * lam);
    }
    const ka = kLin(A, B, _jr1, _jr2, aA);
    if (ka > 0) {
      const sd = vrel().dot(aA), s = j.s;
      if (j.type === 'piston') {
        const vt = clamp((j.target - s) * 5, -1.5, 1.5), Fm = j.def.force * dt;
        let lam = (vt - sd) / ka; const na = clamp(j.acc + lam, -Fm, Fm); lam = na - j.acc; j.acc = na;
        applyLin(A, B, _jr1, _jr2, aA.x * lam, aA.y * lam, aA.z * lam);
      } else {
        const half = j.def.travel / 2;
        if (first) { const f = (-j.def.k * j.kMul * s - j.def.c * j.cMul * sd) * dt; applyLin(A, B, _jr1, _jr2, aA.x * f, aA.y * f, aA.z * f); }
        if (s < -half || s > half) { const lim = s < -half ? -half : half; const lam = -(sd + (s - lim) * beta) / ka; if ((s < -half && lam > 0) || (s > half && lam < 0)) applyLin(A, B, _jr1, _jr2, aA.x * lam, aA.y * lam, aA.z * lam); }
      }
    }
  }
  // a ball joint only holds its two halves together: they turn every way
  if (j.type === 'ball') return;
  // angular: hinges and rotors keep their axes lined up; pistons and springs don't twist at all
  const wrel = _jw.subVectors(B.w, A.w);
  if (!prism) {
    const err = _jv.crossVectors(aB, aA); perpOf(aA);
    for (const u of [_perp1.clone(), _perp2.clone()]) {
      const k = kAng(A, B, u); if (k <= 0) continue;
      const lam = -(_jw.subVectors(B.w, A.w).dot(u) - err.dot(u) * beta) / k;
      applyAng(A, B, u.x * lam, u.y * lam, u.z * lam);
    }
    // motor about the axis
    const rA = A.dirW(j.ref.x, j.ref.y, j.ref.z, _jr1), rB = B.dirW(j.ref.x, j.ref.y, j.ref.z, _jr2);
    rB.addScaledVector(aA, -rB.dot(aA));
    const th = Math.atan2(_je.crossVectors(rA, rB).dot(aA), rA.dot(rB));
    if (first) j.theta = th;
    const k = kAng(A, B, aA);
    if (k > 0) {
      let wd;
      if (j.type === 'hinge') wd = clamp((j.target - th) * 6, -1.6, 1.6);
      else if (j.spin) wd = j.spin;
      else { let e = j.hold - th; e = ((e + Math.PI) % TAU + TAU) % TAU - Math.PI; wd = j.def.servo ? clamp(e * 12, -4, 4) : clamp(e * 6, -2, 2); }
      const Tm = j.def.torque * dt;
      let lam = (wd - _jw.subVectors(B.w, A.w).dot(aA)) / k; const na = clamp(j.acc + lam, -Tm, Tm); lam = na - j.acc; j.acc = na;
      applyAng(A, B, aA.x * lam, aA.y * lam, aA.z * lam);
    }
  } else {
    // full rotation lock: error from the relative orientation
    _dq.copy(A.q).invert().multiply(B.q);
    const sg = _dq.w < 0 ? -1 : 1;
    _jv.set(_dq.x * 2 * sg, _dq.y * 2 * sg, _dq.z * 2 * sg).applyQuaternion(A.q);
    for (const u of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      _perp1.set(u[0], u[1], u[2]);
      const k = kAng(A, B, _perp1); if (k <= 0) continue;
      const lam = -(_jw.subVectors(B.w, A.w).dot(_perp1) + _jv.dot(_perp1) * beta) / k;
      applyAng(A, B, _perp1.x * lam, _perp1.y * lam, _perp1.z * lam);
    }
  }
}

/* ---------- winch cables: a hook on a rope that only pulls ---------- */
W.ropes = [];
function solveRope(r, dt) {
  if (!r.wp.alive || !r.hook || r.hook.dead) return;
  const Wb = r.wp.body, wd = r.wd;
  const H = r.hook.dock ? r.hook.dock.carrier : r.hook;
  if (!Wb || Wb === H || (jkin(Wb) && jkin(H))) return;
  const pW = Wb.toWorld(wd.pos.x, wd.pos.y, wd.pos.z, _ja), pH = _jb.copy(r.hook.x);
  const d = _je.subVectors(pH, pW), len = d.length(); r.len = len;
  if (len <= r.L || len < 1e-6) return;
  d.divideScalar(len);
  _jr1.subVectors(pW, Wb.x); _jr2.subVectors(pH, H.x);
  const k = kLin(Wb, H, _jr1, _jr2, d); if (k <= 0) return;
  Wb.velAt(pW, _jv); H.velAt(pH, _jw);
  const vn = _jw.sub(_jv).dot(d), bias = (len - r.L) * 0.2 / dt;
  let lam = -(vn + bias) / k;
  const na = Math.min(0, r.acc + lam); lam = na - r.acc; r.acc = na;
  applyLin(Wb, H, _jr1, _jr2, d.x * lam, d.y * lam, d.z * lam);
}
function hooksTouch() {
  for (const r of W.ropes) {
    const h = r.hook; if (!h || h.dead || h.dock || h.dockCool > 0 || r.holding()) continue;
    const hit = bodyAt(h.x, h, 0.7);
    if (hit && hit.o !== r.wp.body) linkPair(h, h.parts[0], hit.o, hit.part, 'hook', null, 0);
  }
}

function physicsStep(dt) {
  // worlds sit at time t for the whole step; they advance once every body has moved
  const L = W.bodies, big = dt > FIXED_DT * 1.5;
  if (!big && W.frozen.length) { for (const b of W.frozen) if (!b.dead && b.frozen) b.wake(); W.frozen.length = 0; }
  cleanJoints(); checkLinks(); assignAssemblies();
  for (const b of L) if (b.anchors.length && !b.anchored && !b.anchorOff) tryAnchor(b);
  const pa = G && G.player && !G.player.dead ? G.player.asmId : -1;
  // whatever the player is riding keeps moving too
  const rider = pa < 0 ? null : W.bodies.find(o => o.asmId === pa && o.dock), pc = rider ? rider.dock.carrier.asmId : -1;
  for (const b of L) {
    b.age += dt;
    if (b.dockCool > 0) b.dockCool -= dt;
    if (b.dock) { b.updR(); b.forces(dt); continue; }
    if (b.asleep) continue;
    // big warp steps would tunnel through terrain: park anything near a surface or in air until warp ends
    if (big && b.asmId !== pa && b.asmId !== pc && (b.groundCel || b.airCel || b.seaCel || b.onTower)) { b.pin(b.groundCel || b.airCel || b.seaCel || b.onTower.anchored || dominantCel(b.x), true); W.frozen.push(b); continue; }
    b.updR(); b.forces(dt); integrateVel(b, dt);
    // integrate relative to the nearest world's moving frame: its exact rail motion is added back after the step
    const fc = b.fc = dominantCel(b.x); b.v.addScaledVector(fc.acc, -dt);
    hazards(b, dt);
  }
  // riders push on whatever carries them
  for (const F of L) {
    if (!F.dock) continue;
    const C = F.dock.carrier; if (jkin(C)) continue;
    C.v.addScaledVector(F.F, dt * C.invM);
    _dk.subVectors(F.x, C.x); _dk2.crossVectors(_dk, F.F).add(F.T).multiplyScalar(dt);
    const I = C.iw; C.w.x += I[0] * _dk2.x + I[1] * _dk2.y + I[2] * _dk2.z; C.w.y += I[3] * _dk2.x + I[4] * _dk2.y + I[5] * _dk2.z; C.w.z += I[6] * _dk2.x + I[7] * _dk2.y + I[8] * _dk2.z;
    F.dock.vPrev.copy(F.v);
  }
  if (TRAIN.list.length) trainsStep(dt);
  magnetsStep(dt);
  gatherContacts(dt);
  const nj = W.joints.length + W.ropes.length, iters = CN > 500 ? 2 : nj ? 6 : 4;
  for (const r of W.ropes) r.acc = 0;
  for (let it = 0; it < iters; it++) {
    solveContacts(1);
    for (const j of W.joints) solveJoint(j, dt, it === 0);
    for (const r of W.ropes) solveRope(r, dt);
  }
  contactDamage();
  for (const b of L) { if (!b.asleep && !b.dock) { integratePos(b, dt); b.updR(); } }
  shotsMove(dt);
  for (const c of ORBITERS) { c.pc.copy(c.center); c.pv.copy(c.vel); }
  W.time += dt; updateCelestials(W.time);
  for (const b of L) {
    if (b.asleep) { if (b.pinCel) b.pinUpdate(); continue; }
    if (b.dock) continue;
    const fc = b.fc;
    if (fc && fc.parent) { b.x.x += fc.center.x - fc.pc.x; b.x.y += fc.center.y - fc.pc.y; b.x.z += fc.center.z - fc.pc.z; b.v.x += fc.vel.x - fc.pv.x; b.v.y += fc.vel.y - fc.pv.y; b.v.z += fc.vel.z - fc.pv.z; }
    b.sleepCheck(dt);
    if (b.burning || b.rcsT) { b.massT += dt; if (b.massT > 0.25) { b.massT = 0; b.massProps(false); b.tuneSprings(); } }
  }
  // riders follow their carrier, and their change of momentum pushes back on it
  for (const F of L) {
    if (!F.dock) continue;
    const C = F.dock.carrier;
    placeFollower(F, dt);
    if (jkin(C)) continue;
    // inelastic hand-off: the rider's change of momentum, softened by how hard the carrier is to push at that point
    _dk.subVectors(F.v, F.dock.vPrev); const l = _dk.length(); if (l < 1e-9) continue;
    _dk3.copy(_dk).divideScalar(l); _dk2.subVectors(F.x, C.x);
    const cx = _dk2.y * _dk3.z - _dk2.z * _dk3.y, cy = _dk2.z * _dk3.x - _dk2.x * _dk3.z, cz = _dk2.x * _dk3.y - _dk2.y * _dk3.x, I = C.iw;
    const k = C.invM + cx * (I[0] * cx + I[1] * cy + I[2] * cz) + cy * (I[3] * cx + I[4] * cy + I[5] * cz) + cz * (I[6] * cx + I[7] * cy + I[8] * cz);
    _dk.multiplyScalar(-F.mass / (1 + F.mass * k));
    C.impulseAt(_dk.x, _dk.y, _dk.z, F.x);
    C.velAt(F.x, F.v); F.w.copy(C.w);
  }
  // shots check what they ran into once everything (bodies and worlds) has moved
  shotsHit(dt);
  tryDocking(); tryCoupling(); hooksTouch();
  processDamage();
  processExplosions(dt);
  if (W.burnt.length) { for (const b of W.burnt) if (!b.dead) { if (typeof FX !== 'undefined') FX.embers(b.x, b.v); removeBody(b); } W.burnt.length = 0; if (typeof onStructureChange === 'function') onStructureChange(); }
}
/* Sun heat, gas-giant pressure and lava: continuous damage that ends in total destruction */
W.burnt = [];
const _tdr = new V3(), _tdS = new THREE.Matrix4();
function hazards(b, dt) {
  const h = b.heat = sunHeat(b.x);
  // a black hole's tides pull harder on the near end than the far one: spaghettification
  const tp = b.tidal = tidalPull(b.x);
  // fast entries heat up in thick air; heat shields soak most of it
  b.aero = 0;
  if (b.rho > 0.002) { const vr = b.v.distanceTo(b.av); if (vr > 380) b.aero = Math.min(1.2, Math.sqrt(b.rho / RHO0) * ((vr - 380) / 260) ** 2); }
  const shield = Math.pow(0.3, Math.min(3, b.nShield));
  let rate = (h > 0 ? 300 * h * h * h * h : 0) * shield + (b.aero > 0.02 ? 180 * b.aero * b.aero * shield : 0) + (tp > 0 ? 420 * tp * tp * tp : 0);
  if (h >= 1 || tp >= 1) rate = 1e9;
  b.crush = 0;
  const ac = b.airCel;
  if (ac && ac.kind === 'gas' && b.alt < 0) {
    const d0 = ac.R * 0.012, d1 = ac.R * 0.05, k = clamp((-b.alt - d0) / (d1 - d0), 0, 1);
    b.crush = k; rate += 300 * k * k * k; if (k >= 1) rate = 1e9;
  }
  if (!b.lava && !h && !b.crush && !tp && b.aero < 0.02) { b.burn = Math.max(0, b.burn - dt); return; }
  if (rate <= 0) return;
  // loose debris can't take damage, so it burns up instead
  if (b.parts.every(p => p.broken)) { b.burn += rate * dt; if (b.burn > 50) W.burnt.push(b); return; }
  for (const p of b.parts) addDmg(p, rate * dt);
}
function processDamage() {
  if (!W.dmg.size) return;
  const byBody = new Map();
  for (const [p, d] of W.dmg) {
    if (!p.alive || !p.body || p.body.dead) continue;
    p.hp -= d;
    if (p.hp <= 0) { let l = byBody.get(p.body); if (!l) { l = []; byBody.set(p.body, l); } l.push(p); }
  }
  W.dmg.clear();
  for (const [b, l] of byBody) breakOff(b, l);
}
function processExplosions(dt) {
  if (!W.expl.length) return;
  const now = W.expl; W.expl = [];
  for (const e of now) {
    // ride along with the nearest world (it moves a long way each step), drifting at the speed it started with
    if (!e.cel) { e.cel = dominantCel(e.pos); e.rel = e.pos.clone().sub(e.cel.center); e.vrel = e.vel.clone().sub(e.cel.vel); }
    e.delay -= dt; e.rel.addScaledVector(e.vrel, dt); e.pos.copy(e.cel.center).add(e.rel);
    if (e.delay > 0) W.expl.push(e); else explode(e);
  }
}
function explode(e) {
  if (typeof FX !== 'undefined') FX.explosion(e.pos, e.radius, e.vel);
  if (typeof onExplosion === 'function') onExplosion(e);
  for (const b of W.bodies.slice()) {
    if (b.dead) continue;
    if (b.x.distanceTo(e.pos) > e.radius + b.radius) continue;
    b.wake();
    for (const p of b.parts) {
      if (!p.alive) continue;
      b.toWorld(p.cen[0], p.cen[1], p.cen[2], _p);
      const d = _p.distanceTo(e.pos); if (d > e.radius) continue;
      const f = 1 - d / e.radius;
      addDmg(p, e.power * f * f);
      _n.subVectors(_p, e.pos); const l = _n.length(); if (l < 0.01) _n.set(0, 1, 0); else _n.divideScalar(l);
      const J = p.mass * f * e.power / 45;
      b.impulseAt(_n.x * J, _n.y * J, _n.z * J, _p);
    }
  }
}
function breakOff(b, list) {
  if (b.dead) return;
  for (const p of list) {
    if (!p.alive) continue;
    p.alive = false;
    b.toWorld(p.cen[0], p.cen[1], p.cen[2], _p);
    const k = p.def.kind;
    if (k === 'tank' || k === 'explosive') {
      const big = (p.def.fuel || 0) > 500;
      const ff = p.def.fuel ? 0.35 + 0.65 * p.fuel / p.def.fuel : 1;
      W.expl.push({ pos: _p.clone(), vel: b.velAt(_p, new V3()), radius: k === 'explosive' ? p.def.radius : (big ? 13 : 6) * (0.6 + 0.4 * ff), power: k === 'explosive' ? p.def.power : (big ? 750 : 240) * ff, delay: 0.03 + Math.random() * 0.04 });
      continue;
    }
    const np = new PartInst(p.t, p.a, p.m, p.c, p.uid); np.hp = 1e9; np.broken = true;
    const db = new Body([np], { debris: true, name: `${b.name.replace(/ (debris|piece|stage)$/, '')} debris` });
    db.q.copy(b.q); db.updR(); db.x.copy(_p); b.velAt(_p, db.v);
    db.v.x += (Math.random() - 0.5) * 2; db.v.y += (Math.random() - 0.5) * 2; db.v.z += (Math.random() - 0.5) * 2;
    db.w.copy(b.w); db.w.x += (Math.random() - 0.5) * 4; db.w.y += (Math.random() - 0.5) * 4; db.w.z += (Math.random() - 0.5) * 4;
    W.bodies.push(db);
  }
  afterLoss(b);
  enforceDebrisCap();
  if (typeof onStructureChange === 'function') onStructureChange();
}
function afterLoss(b, kind = 'piece') {
  const alive = b.parts.filter(p => p.alive);
  if (!alive.length) { removeBody(b); return []; }
  const comps = partComponents(alive);
  let mi = comps.findIndex(c => c.some(p => p.def.kind === 'seat' && !p.broken));
  // an anchored tower keeps standing on the piece that still has its anchor
  if (mi < 0 && b.anchored) mi = comps.findIndex(c => c.some(p => p.def.kind === 'anchor'));
  if (mi < 0) { let bm = -1; comps.forEach((c, i) => { const m = c.reduce((s, p) => s + p.def.mass, 0); if (m > bm) { bm = m; mi = i; } }); }
  const out = [b];
  comps.forEach((comp, i) => {
    if (i === mi) return;
    const nb = new Body(comp, { debris: true, fam: b.fam, name: `${b.name.replace(/ (debris|piece|stage)$/, '')} ${comp.length === 1 ? 'debris' : kind}` });
    nb.q.copy(b.q); nb.updR(); nb.staged = kind === 'stage' || !!b.staged;
    b.toWorld(nb.comD.x, nb.comD.y, nb.comD.z, nb.x); b.velAt(nb.x, nb.v); nb.w.copy(b.w);
    W.bodies.push(nb); out.push(nb);
  });
  b.parts = comps[mi];
  b.structure(false);
  b.wake();
  return out;
}
/* the default stage key: the outermost decouplers, counted from the seat */
function decouple(b) { return stageBody(b); }
/* split a body at these decouplers; the pieces drift apart */
function decoupleParts(b, ds) {
  ds = ds.filter(d => d.alive && d.body === b);
  if (!ds.length || b.dead) return false;
  const pts = [];
  for (const d of ds) { b.toWorld(d.cen[0], d.cen[1], d.cen[2], _p); pts.push(_p.clone()); d.alive = false; if (typeof FX !== 'undefined') FX.puff(_p); }
  if (typeof SND !== 'undefined') SND.at('decouple', pts[0]);
  const res = afterLoss(b, 'stage');
  for (const nb of res) {
    let best = null, bd = 1e9;
    for (const p of pts) { const d = p.distanceTo(nb.x); if (d < bd) { bd = d; best = p; } }
    if (!best) continue;
    _n.subVectors(nb.x, best); if (_n.lengthSq() < 1e-6) continue;
    _n.normalize(); nb.v.addScaledVector(_n, 1.4); nb.wake();
  }
  if (typeof onStructureChange === 'function') onStructureChange();
  return true;
}
function removeBody(b) {
  const i = W.bodies.indexOf(b); if (i >= 0) W.bodies.splice(i, 1);
  b.dead = true; b.disposeVisual(); scene.remove(b.group);
}
function enforceDebrisCap() {
  const deb = W.bodies.filter(b => b.debris && !b.player && !b.parts.some(p => p.uid === G.seatUid));
  if (deb.length <= MAX_DEBRIS) return;
  deb.sort((a, b) => b.age - a.age);
  for (let i = 0; i < deb.length - MAX_DEBRIS; i++) removeBody(deb[i]);
}

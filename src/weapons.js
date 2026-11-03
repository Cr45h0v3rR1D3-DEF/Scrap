'use strict';
/* ================= Scrapline · weapons and magnets =================
   Cannons, machine guns, missile launchers and bomb racks fire shots: small points that fly under gravity
   (missiles steer themselves) and hit the ground, the buildings, the sea or another vehicle. Shells, missiles
   and bombs explode; bullets chip away at the block they hit. Shots fly through the machine that fired them.
   Magnets pull whatever is in front of them and latch on. */
W.shots = [];
const SHOT_GEO = {}, SHOT_MAT = {};
function shotLook(k) {
  if (!SHOT_GEO.bullet) {
    SHOT_GEO.bullet = new THREE.BoxGeometry(0.07, 0.07, 1.8);
    SHOT_GEO.shell = new THREE.SphereGeometry(0.17, 10, 8);
    SHOT_GEO.bomb = new THREE.SphereGeometry(0.2, 12, 8).scale(1, 1, 1.9);
    SHOT_GEO.missile = new THREE.CylinderGeometry(0.11, 0.11, 1.3, 10).rotateX(Math.PI / 2);
    SHOT_GEO.flame = new THREE.ConeGeometry(0.13, 1.1, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -1.2);
    SHOT_MAT.bullet = new THREE.MeshBasicMaterial({ color: 0xfff1a8, fog: false });
    SHOT_MAT.shell = new THREE.MeshBasicMaterial({ color: 0xffb35a, fog: false });
    SHOT_MAT.bomb = new THREE.MeshPhongMaterial({ color: 0x3a4148, shininess: 40 });
    SHOT_MAT.missile = new THREE.MeshPhongMaterial({ color: 0xe8ebe7, shininess: 50 });
    SHOT_MAT.flame = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  }
  const m = new THREE.Mesh(SHOT_GEO[k], SHOT_MAT[k]);
  if (k === 'missile') m.add(new THREE.Mesh(SHOT_GEO.flame, SHOT_MAT.flame));
  m.frustumCulled = false;
  return m;
}
const _wgv = new V3(), _whd = new V3(), _wdr = new V3(), _wvv = new V3(), _wk = new V3(), _wzz = new V3(0, 0, 1);
/* fire one gun of body b */
function fireGun(b, g) {
  const d = g.p.def.gun, pos = b.toWorld(g.pos.x, g.pos.y, g.pos.z, new V3()), dir = b.dirW(g.dir.x, g.dir.y, g.dir.z, new V3());
  const vel = b.velAt(pos, new V3()).addScaledVector(dir, d.speed);
  const s = { k: d.type, pos, p0: pos.clone(), vel, t: 0, life: d.life, asm: b.asmId, owner: b, d, target: null, fc: null, mesh: shotLook(d.type) };
  if (d.type === 'missile') s.target = missileTarget(b, pos, dir);
  scene.add(s.mesh); placeShot(s);
  W.shots.push(s);
  if (W.shots.length > 160) dropShot(W.shots[0], 0);
  // the gun kicks back
  if (d.recoil) b.impulseAt(-dir.x * d.recoil, -dir.y * d.recoil, -dir.z * d.recoil, pos);
  if (typeof SND !== 'undefined') SND.at(d.snd, pos);
  if (typeof FX !== 'undefined' && d.type !== 'bomb') { FX.flash(pos, d.type === 'bullet' ? 0.9 : 2.2, 0.08); if (d.type !== 'bullet') FX.puff(pos); }
}
/* a missile picks the vehicle closest to where it is pointed */
function missileTarget(b, pos, dir) {
  let best = null, bs = 1e9;
  for (const o of W.bodies) {
    if (o.dead || o.asmId === b.asmId || o.debris || o.loose || o.mass < 40) continue;
    _wdr.subVectors(o.x, pos); const dist = _wdr.length(); if (dist < 4 || dist > 1600) continue;
    const ang = Math.acos(clamp(_wdr.dot(dir) / dist, -1, 1)); if (ang > 0.45) continue;
    const sc = ang + dist / 3000 + (o.parts.some(p => p.def.kind === 'seat') ? 0 : 0.3);
    if (sc < bs) { bs = sc; best = o; }
  }
  return best;
}
function gravAt(p, out) {
  out.set(0, 0, 0);
  for (const cel of CELS) { const dx = cel.center.x - p.x, dy = cel.center.y - p.y, dz = cel.center.z - p.z, r2 = dx * dx + dy * dy + dz * dz, r = Math.sqrt(r2), g = cel.mu / r2 / r; out.x += dx * g; out.y += dy * g; out.z += dz * g; }
  return out;
}
/* first half of the step: gravity and steering, then move in the nearest world's moving frame (as bodies do) */
function shotsMove(dt) {
  for (const s of W.shots) {
    const fc = s.fc = dominantCel(s.pos);
    // missiles fly on their own lift and thrust; everything else falls
    gravAt(s.pos, _wgv); if (s.k !== 'missile') s.vel.addScaledVector(_wgv, dt); s.vel.addScaledVector(fc.acc, -dt);
    if (s.k === 'missile') steerMissile(s, dt);
    s.p0.copy(s.pos);
    s.pos.x += (s.vel.x - fc.vel.x) * dt; s.pos.y += (s.vel.y - fc.vel.y) * dt; s.pos.z += (s.vel.z - fc.vel.z) * dt;
    s.t += dt;
  }
}
function steerMissile(s, dt) {
  // speed and heading relative to the air (or the world) around it
  const ac = airAt(s.pos), base = ac ? surfaceVel(ac, s.pos, _wvv) : _wvv.copy(s.fc.vel);
  _whd.subVectors(s.vel, base); let sp = _whd.length(); if (sp < 1e-3) { _whd.set(0, 0, 1); sp = 0; } else _whd.divideScalar(sp);
  if (s.t > 0.25) {
    const T = s.target;
    if (T && !T.dead) {
      _wdr.subVectors(T.x, s.pos); const dist = _wdr.length();
      _wk.subVectors(T.v, base).multiplyScalar(Math.min(2, dist / Math.max(40, sp)));
      _wdr.add(_wk).normalize();
      const ang = Math.acos(clamp(_whd.dot(_wdr), -1, 1)), turn = Math.min(ang, 2.6 * dt);
      if (ang > 1e-4) { _wk.crossVectors(_whd, _wdr).normalize(); _whd.applyAxisAngle(_wk, turn); }
    }
    sp = Math.min(185, sp + 85 * dt);
  }
  s.vel.copy(base).addScaledVector(_whd, sp);
  if (typeof FX !== 'undefined' && Math.random() < 0.7) { const d = FX.rnd(0.6); FX.spawn(s.pos.x, s.pos.y, s.pos.z, base.x + d[0], base.y + d[1], base.z + d[2], 1 + Math.random(), .25, 1.6, .9, .9, .9, .6, .6, .62, .5, 0, 1.5); }
}
/* second half: follow the world's own motion, then see what the shot ran into on the way */
function shotsHit() {
  const keep = [];
  for (const s of W.shots) {
    const fc = s.fc;
    if (fc && fc.parent) { _wk.subVectors(fc.center, fc.pc); s.pos.add(_wk); s.p0.add(_wk); _wk.subVectors(fc.vel, fc.pv); s.vel.add(_wk); }
    const hit = shotTrace(s);
    if (hit) { shotImpact(s, hit); dropShot(s, 1); continue; }
    if (s.t > s.life) { if (s.k === 'missile') shotImpact(s, { pos: s.pos.clone(), body: null, part: null }); dropShot(s, 1); continue; }
    keep.push(s);
  }
  W.shots = keep;
}
function shotTrace(s) {
  _wdr.subVectors(s.pos, s.p0); const L = _wdr.length(); if (L < 1e-6) return null; _wdr.divideScalar(L);
  let bt = L, hit = null;
  // the ground, buildings and other fixed things
  const g = groundRay(s.p0, _wdr, L);
  if (g && g.t < bt) { bt = g.t; hit = { pos: s.p0.clone().addScaledVector(_wdr, g.t), body: null, part: null, ground: true, pr: g.pr }; }
  // vehicles and loose things, but not the machine that fired it
  for (const o of W.bodies) {
    if (o.dead || o.asmId === s.asm) continue;
    // closest approach of the path to the body's centre
    _wk.subVectors(o.x, s.p0); const tc = clamp(_wk.dot(_wdr), 0, bt);
    _wvv.copy(s.p0).addScaledVector(_wdr, tc);
    if (_wvv.distanceToSquared(o.x) > (o.radius + 0.6) * (o.radius + 0.6)) continue;
    const n = Math.max(2, Math.ceil(bt / 0.22));
    for (let i = 0; i <= n; i++) {
      const t = bt * i / n; _wvv.copy(s.p0).addScaledVector(_wdr, t); o.toDesign(_wvv, _wk);
      const part = o.grid.get(ckey(Math.round(_wk.x / CELL), Math.round(_wk.y / CELL), Math.round(_wk.z / CELL)));
      if (part && part.alive) { bt = t; hit = { pos: _wvv.clone(), body: o, part }; break; }
    }
  }
  // missiles have a proximity fuse: they go off as they pass close to their target
  const T = s.k === 'missile' && s.target && !s.target.dead ? s.target : null;
  if (T) {
    _wk.subVectors(T.x, s.p0); const tc = clamp(_wk.dot(_wdr), 0, bt);
    _wvv.copy(s.p0).addScaledVector(_wdr, tc);
    if (_wvv.distanceTo(T.x) < Math.min(3, T.radius * 0.8 + 1)) hit = { pos: _wvv.clone(), body: T, part: null };
  }
  // the sea
  if (!hit) { const sc = seaCelNear(s.pos, 0); if (sc && s.pos.distanceTo(sc.center) < sc.R) hit = { pos: s.pos.clone(), body: null, part: null, sea: sc }; }
  return hit;
}
function shotImpact(s, h) {
  const d = s.d;
  if (s.k === 'bullet') {
    if (h.pr && h.pr.st && typeof wreckChip === 'function') wreckChip(h.pr, h.pos, d.dmg);
    if (h.body) { addDmg(h.part, d.dmg); h.body.wake(); _wvv.subVectors(s.vel, h.body.velAt(h.pos, _wk)).multiplyScalar(0.35); h.body.impulseAt(_wvv.x, _wvv.y, _wvv.z, h.pos); }
    if (typeof FX !== 'undefined') { if (h.sea) FX.splash(h.pos, 0.25, h.sea); else FX.sparks(h.pos.x, h.pos.y, h.pos.z, 4); }
    return;
  }
  if (h.sea && typeof FX !== 'undefined') FX.splash(h.pos, 1.2, h.sea);
  const vel = h.body ? h.body.velAt(h.pos, new V3()) : surfaceVel(h.sea || groundCelNear(h.pos, 0) || dominantCel(h.pos), h.pos, new V3());
  // back the blast up out of whatever it hit, so it does not go off inside a wall
  const pos = h.pos.clone().addScaledVector(_wdr.subVectors(s.p0, s.pos).normalize(), 0.3);
  W.expl.push({ pos, vel, radius: d.radius, power: d.power, delay: 0 });
}
function dropShot(s, why) { if (s.mesh) { scene.remove(s.mesh); s.mesh = null; } if (!why) { const i = W.shots.indexOf(s); if (i >= 0) W.shots.splice(i, 1); } }
function clearShots() { for (const s of W.shots) if (s.mesh) scene.remove(s.mesh); W.shots = []; }
function placeShot(s) {
  if (!s.mesh) return;
  s.mesh.position.copy(s.pos);
  const ac = s.k === 'missile' ? null : airAt(s.pos);
  _whd.copy(s.vel); if (ac) _whd.sub(surfaceVel(ac, s.pos, _wvv)); else if (s.fc) _whd.sub(s.fc.vel);
  if (_whd.lengthSq() > 1e-6) s.mesh.quaternion.setFromUnitVectors(_wzz, _whd.normalize());
}
function drawShots() { for (const s of W.shots) placeShot(s); }

/* ---------- magnets ---------- */
const _mg = new V3(), _mgd = new V3();
function magnetsStep(dt) {
  for (const b of W.bodies) {
    if (b.dead || !b.magnets || !b.magnets.length) continue;
    for (const m of b.magnets) {
      const p = m.p; if (!p.alive || !p.mag || p.linked || p.grip) continue;
      b.toWorld(m.pos.x, m.pos.y, m.pos.z, _mg); b.dirW(m.dir.x, m.dir.y, m.dir.z, _mgd);
      const hit = bodyRay(b, _mg, _mgd, 4); if (!hit || !hit.body || hit.body.dead) continue;
      const o = hit.body;
      if (hit.t < 0.35) { p.grip = true; linkPair(b, p, o, hit.part, 'claw', null, 0); if (typeof SND !== 'undefined') SND.at('dock', _mg, 0.6); continue; }
      // pull: strongest up close, shared between the two like a real magnet
      const F = 9000 * (cfgGet(p, 'power') / 100) * (1 - hit.t / 4) ** 2 * dt;
      o.wake();
      _wk.copy(_mg).addScaledVector(_mgd, hit.t);
      o.impulseAt(-_mgd.x * F, -_mgd.y * F, -_mgd.z * F, _wk);
      b.impulseAt(_mgd.x * F, _mgd.y * F, _mgd.z * F, _mg);
    }
  }
}

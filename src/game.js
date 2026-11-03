'use strict';
/* ================= Scrapline · game: renderer, camera, input, FX, HUD, UI ================= */
let renderer, stage, scene, camera, sunLight, sun2, moonL, hemi, ambient, sky, raycaster;
const RO = new V3(); // render origin: the scene is drawn shifted by -RO so the GPU only sees small numbers
const KEYS = new Set();
/* a touchscreen first (an iPad): words say tap, not click */
const COARSE = !!(window.matchMedia && matchMedia("(pointer: coarse)").matches);
const G = {
  mode: 'build', player: null, seatUid: null, spawnLoc: 'pad', warp: 1, map: false, chase: true, shake: 0, initialParts: 1,
  throttle: 0, reversing: false, noSeat: false, wrecked: false, budget: 4.5, hudT: 0, mapYaw: 0.4, mapPitch: 0.55, mapZoom: 1, keysMin: false, fuelWarned: false, predT: 0,
  settings: { quality: 'balanced', shadows: true, invertPitch: false, volume: 0.7, mute: false, views: { com: true, forces: true, air: false, keys: false } },
  live: [], braking: 0
};
const DC = { yaw: 0, pitch: 0.3, dist: 14, ref: new V3(1, 0, 0), dragging: false, lastDrag: 0 };
const WARPS = [1, 2, 5, 10, 25, 50, 100, 1000, 10000, 100000, 1000000];
const RAILS = 1000; // at this warp and above, ships coast on their orbits instead of running full physics
const $ = id => document.getElementById(id);
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
};
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
function setLoad(f, t) { $('ldFill').style.width = Math.round(f * 100) + '%'; if (t) $('ldText').textContent = t; }
function lerpAngle(a, b, t) { let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a + d * t; }
let toastT = 0;
function toast(msg, ms = 2200) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
function saveCurrent() { if (B.design) LS.set('scrapline.current', B.design); }
function fmtKg(m) { return m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 2) + ' t' : Math.round(m) + ' kg'; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

/* ---------------- particles & effects ---------------- */
/* Particles live in a local frame that rides along with the world under the camera,
   so they keep their shape while planets move at kilometres per second. */
const FX = {
  N: 2600, n: 0, cel: null, rel: new V3(), anchor: new V3(), g: new V3(),
  init() {
    const N = this.N;
    for (const k of ['pos', 'vel', 'col', 'col1', 'rc']) this[k] = new Float32Array(N * 3);
    for (const k of ['life', 'max', 's0', 's1', 'a0', 'grav', 'drag', 'size', 'alpha']) this[k] = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3); this.aSize = new THREE.BufferAttribute(this.size, 1); this.aAlpha = new THREE.BufferAttribute(this.alpha, 1); this.aCol = new THREE.BufferAttribute(this.rc, 3);
    for (const a of [this.aPos, this.aSize, this.aAlpha, this.aCol]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('size', this.aSize); g.setAttribute('alpha', this.aAlpha); g.setAttribute('pcolor', this.aCol);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 600 } },
      vertexShader: LOGV + 'attribute float size; attribute float alpha; attribute vec3 pcolor; varying float vA; varying vec3 vC; uniform float scale;\nvoid main(){ vA=alpha; vC=pcolor; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=clamp(size*scale/max(0.1,-mv.z),1.0,256.0); gl_Position=projectionMatrix*mv;\n#include <logdepthbuf_vertex>\n}',
      fragmentShader: LOGF + 'varying float vA; varying vec3 vC;\nvoid main(){\n#include <logdepthbuf_fragment>\n vec2 d=gl_PointCoord-0.5; float r=dot(d,d); if(r>0.25) discard; float s=1.0-smoothstep(0.06,0.25,r); gl_FragColor=vec4(vC,vA*s);\n}',
      transparent: true, depthWrite: false
    });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 6; scene.add(this.pts);
    this.geo = g;
    const tex = makeGlowTexture('rgba(255,240,200,1)', 'rgba(255,120,30,0)');
    this.flashes = [];
    for (let i = 0; i < 8; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false })); s.visible = false; s.renderOrder = 7; scene.add(s); this.flashes.push({ s, t: 0, life: 0, size: 1, rel: new V3() }); }
    this.cel = PLANET;
  },
  /* keep the frame on the world nearest the camera and the anchor near the camera */
  frame(cam) {
    const c = dominantCel(cam), A = this.anchor.copy(this.cel.center).add(this.rel);
    if (c !== this.cel || cam.distanceToSquared(A) > 3000 * 3000) {
      const nr = _fxa.subVectors(cam, c.center);
      const sx = A.x - c.center.x - nr.x, sy = A.y - c.center.y - nr.y, sz = A.z - c.center.z - nr.z;
      const dvx = this.cel.vel.x - c.vel.x, dvy = this.cel.vel.y - c.vel.y, dvz = this.cel.vel.z - c.vel.z;
      const P = this.pos, Vv = this.vel;
      for (let i = 0; i < this.n; i++) { const i3 = i * 3; P[i3] += sx; P[i3 + 1] += sy; P[i3 + 2] += sz; Vv[i3] += dvx; Vv[i3 + 1] += dvy; Vv[i3 + 2] += dvz; }
      for (const f of this.flashes) f.rel.x += sx, f.rel.y += sy, f.rel.z += sz;
      this.cel = c; this.rel.copy(nr); A.copy(c.center).add(nr);
    }
    this.pts.position.copy(A);
    const dx = c.center.x - A.x, dy = c.center.y - A.y, dz = c.center.z - A.z, r2 = dx * dx + dy * dy + dz * dz, r = Math.sqrt(r2) || 1;
    this.g.set(dx, dy, dz).multiplyScalar(c.mu / r2 / r);
    for (const f of this.flashes) if (f.s.visible) f.s.position.copy(A).add(f.rel);
  },
  spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, r1, g1, b1, a, grav, drag) {
    if (this.n >= this.N) return;
    const i = this.n++, i3 = i * 3, C = this.cel.center, R = this.rel, V = this.cel.vel;
    this.pos[i3] = x - C.x - R.x; this.pos[i3 + 1] = y - C.y - R.y; this.pos[i3 + 2] = z - C.z - R.z; this.vel[i3] = vx - V.x; this.vel[i3 + 1] = vy - V.y; this.vel[i3 + 2] = vz - V.z;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b; this.col1[i3] = r1; this.col1[i3 + 1] = g1; this.col1[i3 + 2] = b1;
    this.life[i] = life; this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a; this.grav[i] = grav; this.drag[i] = drag;
  },
  kill(i) {
    const j = --this.n; if (i === j) return;
    const i3 = i * 3, j3 = j * 3;
    for (const k of ['pos', 'vel', 'col', 'col1']) { const A = this[k]; A[i3] = A[j3]; A[i3 + 1] = A[j3 + 1]; A[i3 + 2] = A[j3 + 2]; }
    for (const k of ['life', 'max', 's0', 's1', 'a0', 'grav', 'drag']) this[k][i] = this[k][j];
  },
  update(dt) {
    let i = 0;
    const gx = this.g.x, gy = this.g.y, gz = this.g.z, sw = spinVec(this.cel, _fxw), rl = this.rel;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.kill(i); continue; }
      const i3 = i * 3, P = this.pos, Vv = this.vel;
      const gr = this.grav[i] * dt;
      if (gr !== 0) { Vv[i3] += gx * gr; Vv[i3 + 1] += gy * gr; Vv[i3 + 2] += gz * gr; }
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      if (dr < 1) {
        // the air turns with the world: drag pulls toward its motion, not toward standing still
        const px = P[i3] + rl.x, py = P[i3 + 1] + rl.y, pz = P[i3 + 2] + rl.z;
        const ax = sw.y * pz - sw.z * py, ay = sw.z * px - sw.x * pz, az = sw.x * py - sw.y * px;
        Vv[i3] = ax + (Vv[i3] - ax) * dr; Vv[i3 + 1] = ay + (Vv[i3 + 1] - ay) * dr; Vv[i3 + 2] = az + (Vv[i3 + 2] - az) * dr;
      }
      P[i3] += Vv[i3] * dt; P[i3 + 1] += Vv[i3 + 1] * dt; P[i3 + 2] += Vv[i3 + 2] * dt;
      const t = 1 - this.life[i] / this.max[i];
      this.size[i] = lerp(this.s0[i], this.s1[i], t);
      this.alpha[i] = this.a0[i] * (1 - t) * Math.min(1, t * 12 + 0.25);
      const ct = Math.min(1, t * 2.2);
      this.rc[i3] = lerp(this.col[i3], this.col1[i3], ct); this.rc[i3 + 1] = lerp(this.col[i3 + 1], this.col1[i3 + 1], ct); this.rc[i3 + 2] = lerp(this.col[i3 + 2], this.col1[i3 + 2], ct);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    if (this.n) for (const a of [this.aPos, this.aSize, this.aAlpha, this.aCol]) a.needsUpdate = true;
    for (const f of this.flashes) {
      if (!f.s.visible) continue;
      f.t += dt; const k = f.t / f.life;
      if (k >= 1) { f.s.visible = false; continue; }
      f.s.scale.setScalar(f.size * (0.4 + k * 1.2)); f.s.material.opacity = (1 - k) * (1 - k);
    }
  },
  flash(p, size, life = 0.4) {
    const f = this.flashes.find(f => !f.s.visible) || this.flashes[0];
    f.s.visible = true; f.rel.subVectors(p, this.cel.center).sub(this.rel); f.s.position.copy(p); f.t = 0; f.life = life; f.size = size; f.s.material.opacity = 1;
  },
  rnd(s) { const u = Math.random() * 2 - 1, th = Math.random() * TAU, q = Math.sqrt(1 - u * u); return [q * Math.cos(th) * s, u * s, q * Math.sin(th) * s]; },
  explosion(p, R, vel) {
    const V0 = vel || surfaceVel(this.cel, p, _fxv), k = clamp(R / 6, 0.6, 2.4), vx = V0.x, vy = V0.y, vz = V0.z;
    for (let i = 0; i < 38 * k; i++) { const d = this.rnd(Math.random() * 13 * k); this.spawn(p.x, p.y, p.z, vx + d[0], vy + d[1], vz + d[2], 0.45 + Math.random() * 0.6, 1.1 * k, 3.6 * k, 1, .88, .45, .92, .32, .08, 1, -0.05, 2.6); }
    for (let i = 0; i < 24 * k; i++) { const d = this.rnd(Math.random() * 5 * k); this.spawn(p.x + d[0] * .2, p.y + d[1] * .2, p.z + d[2] * .2, vx + d[0], vy + d[1], vz + d[2], 2 + Math.random() * 2, 2 * k, 8.5 * k, .34, .32, .3, .16, .16, .17, .55, -0.06, 1.1); }
    for (let i = 0; i < 18 * k; i++) { const d = this.rnd(10 + Math.random() * 22); this.spawn(p.x, p.y, p.z, vx + d[0], vy + d[1], vz + d[2], 0.7 + Math.random() * 0.9, .22, .12, 1, .75, .3, 1, .4, .1, 1, 1, 0.3); }
    this.flash(p, R * 2.4, 0.38);
  },
  splash(p, k, sea) {
    SND.at('splash', p, Math.min(1.2, 0.3 + k * 0.4));
    const C = sea ? sea.center : PLANET.center, V = surfaceVel(sea || PLANET, p, _fxv), lava = sea && sea.sea.lava;
    _fxa.subVectors(p, C).normalize(); const ux = _fxa.x, uy = _fxa.y, uz = _fxa.z;
    for (let i = 0; i < 26 * k; i++) {
      const d = this.rnd(2.5 * k), s = 3 + Math.random() * 6 * k;
      if (lava) this.spawn(p.x, p.y, p.z, V.x + d[0] + ux * s, V.y + d[1] + uy * s, V.z + d[2] + uz * s, 0.9 + Math.random() * 0.9, .35 * k, 1.1 * k, 1, .62, .2, .5, .1, .03, .95, 1, 0.4);
      else this.spawn(p.x, p.y, p.z, V.x + d[0] + ux * s, V.y + d[1] + uy * s, V.z + d[2] + uz * s, 0.9 + Math.random() * 0.9, .35 * k, 1.4 * k, .9, .96, 1, .75, .86, .92, .9, 1, 0.4);
    }
  },
  sparks(x, y, z, imp) { const V = surfaceVel(this.cel, _fxb.set(x, y, z), _fxv); for (let i = 0; i < 5; i++) { const d = this.rnd(3 + imp * 0.4); this.spawn(x, y, z, V.x + d[0], V.y + d[1], V.z + d[2], 0.3 + Math.random() * 0.4, .12, .05, 1, .85, .45, 1, .45, .1, 1, 1, 0.5); } },
  puff(p) { const V = surfaceVel(this.cel, p, _fxv); for (let i = 0; i < 14; i++) { const d = this.rnd(2 + Math.random() * 3); this.spawn(p.x, p.y, p.z, V.x + d[0], V.y + d[1], V.z + d[2], 0.8 + Math.random() * 0.8, .4, 1.8, .85, .85, .85, .55, .55, .58, .6, 0, 2); } },
  embers(p, v) { for (let i = 0; i < 10; i++) { const d = this.rnd(3 + Math.random() * 4); this.spawn(p.x, p.y, p.z, v.x + d[0], v.y + d[1], v.z + d[2], 0.6 + Math.random() * 0.7, .5, .1, 1, .7, .25, .9, .2, .05, 1, 0, 1.2); } },
  /* glowing streaks peeling off a vehicle that is cooking */
  heat(b, k) {
    const n = Math.random() < k * 1.5 ? 1 + (k > 0.5 ? 1 : 0) : 0;
    for (let i = 0; i < n; i++) {
      const p = b.parts[(Math.random() * b.parts.length) | 0]; if (!p) return;
      b.toWorld(p.cen[0], p.cen[1], p.cen[2], _fxb); const d = this.rnd(1.5);
      this.spawn(_fxb.x + d[0] * 0.3, _fxb.y + d[1] * 0.3, _fxb.z + d[2] * 0.3, b.v.x + d[0], b.v.y + d[1], b.v.z + d[2], 0.5 + Math.random() * 0.5, .25 + k * 0.4, .05, 1, .8, .35, 1, .3, .05, .9, 0, 0.5);
    }
  },
};
const _fxa = new V3(), _fxb = new V3(), _fxw = new V3(), _fxv = new V3();
function onExplosion(e) {
  SND.at('boom', e.pos, clamp(e.power / 400, 0.4, 1.6));
  const d = camera.position.distanceTo(e.pos);
  G.shake = Math.max(G.shake, clamp(e.power / 300, 0.2, 1.6) * clamp(1 - d / (e.radius * 14), 0, 1));
}
const _ex = new V3(), _ed = new V3(), _ev = new V3();
function exhaustFX(dt) {
  for (const b of W.bodies) {
    if (b.asleep || !b.rockets.length) continue;
    const air = b.rho > 0 ? 1 : 0.25;
    for (const rk of b.rockets) {
      if (rk.out < 0.05) continue;
      b.toWorld(rk.pos.x, rk.pos.y, rk.pos.z, _ex); b.dirW(rk.dir.x, rk.dir.y, rk.dir.z, _ed);
      const n = (rk.big ? 3 : 1) * (Math.random() < rk.out ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const back = (rk.big ? 4.2 : 2.0) * rk.out, j = FX.rnd(rk.big ? 3 : 1.5), sp = 22 + Math.random() * 12;
        FX.spawn(_ex.x - _ed.x * back, _ex.y - _ed.y * back, _ex.z - _ed.z * back,
          b.v.x - _ed.x * sp + j[0], b.v.y - _ed.y * sp + j[1], b.v.z - _ed.z * sp + j[2],
          (1.4 + Math.random()) * air + 0.3, rk.big ? 2 : 0.9, (rk.big ? 9 : 4.5) * (air > 0.5 ? 1 : 0.4), .95, .9, .82, .62, .6, .58, 0.5 * air + 0.1, -0.02, b.rho > 0 ? 1.6 : 0.2);
      }
    }
  }
}

/* ---------------- props near the pad ---------------- */
function makeProps() {
  const up = WORLD.L.up, f = WORLD.L.fwd, rt = WORLD.L.right;
  const base = up.clone().multiplyScalar(PLANET.R + WORLD.padH);
  const P = (x, y, z) => base.clone().addScaledVector(rt, x).addScaledVector(up, y).addScaledVector(f, z);
  const ramp = (cx, cz, w, L, H, col) => {
    const V = [P(cx - w / 2, -0.35, cz), P(cx + w / 2, -0.35, cz), P(cx - w / 2, -0.35, cz + L), P(cx + w / 2, -0.35, cz + L), P(cx - w / 2, H, cz + L), P(cx + w / 2, H, cz + L)];
    const Fc = [[0, 1, 3, 2], [2, 3, 5, 4], [0, 1, 5, 4], [0, 2, 4], [1, 3, 5]];
    const pr = makeConvex(V, Fc, col, PLANET); W.props.push(pr); scene.add(pr.mesh);
  };
  ramp(16, 6, 6, 12, 3.2, 0x8d9296);
  ramp(-18, 8, 5, 6, 2.2, 0xc98f3a);
  ramp(0, 38, 9, 22, 6.5, 0x8d9296);
}

/* ---------------- map objects ---------------- */
const MAP = { segs: [], ghosts: [], rings: [], celLabels: [], pred: null, focus: null, pan: new V3(), tr: null, pick: [] };
const SEG_N = 2400, SEG_COLS = [0xf0a32b, 0x7fd0ff, 0xd99cff];
function lineObj(n, color, opacity = 1) {
  const pos = new Float32Array(n * 3);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); g.setDrawRange(0, 0);
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, fog: false, depthWrite: false }));
  line.frustumCulled = false; line.visible = false; line.renderOrder = 8; scene.add(line);
  return { line, pos, n: 0, cel: null };
}
function dotSprite(tex, color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, depthTest: false, sizeAttenuation: false, fog: false, transparent: true }));
  s.scale.setScalar(size); s.renderOrder = 9; s.visible = false; scene.add(s); return s;
}
function initMapObjects() {
  for (let i = 0; i < 3; i++) MAP.segs.push(lineObj(SEG_N, SEG_COLS[i]));
  // each world's orbit, drawn around its parent
  for (const c of ORBITERS) {
    const big = c.parent.kind === 'star';
    const L = lineObj(257, c.kind === 'star' ? 0xc79a5a : big ? 0x7d98a8 : 0x5d7684, big ? 0.55 : 0.4);
    for (let i = 0; i <= 256; i++) { const a = i / 256 * TAU, ca = Math.cos(a) * c.a, sa = Math.sin(a) * c.a; L.pos[i * 3] = c.e1.x * ca + c.e2.x * sa; L.pos[i * 3 + 1] = c.e1.y * ca + c.e2.y * sa; L.pos[i * 3 + 2] = c.e1.z * ca + c.e2.z * sa; }
    L.line.geometry.setDrawRange(0, 257); L.line.geometry.attributes.position.needsUpdate = true; L.cel = c; L.line.renderOrder = 7;
    MAP.rings.push(L);
  }
  const mk = document.createElement('canvas'); mk.width = mk.height = 64; const x = mk.getContext('2d');
  x.fillStyle = '#f0a32b'; x.beginPath(); x.arc(32, 32, 14, 0, TAU); x.fill(); x.lineWidth = 5; x.strokeStyle = '#1d1405'; x.stroke();
  MAP.marker = dotSprite(new THREE.CanvasTexture(mk), 0xffffff, 0.03);
  const gk = document.createElement('canvas'); gk.width = gk.height = 64; const gx = gk.getContext('2d');
  gx.lineWidth = 6; gx.strokeStyle = '#ffffff'; gx.setLineDash([9, 6]); gx.beginPath(); gx.arc(32, 32, 24, 0, TAU); gx.stroke();
  const gtex = new THREE.CanvasTexture(gk);
  for (let i = 0; i < 3; i++) MAP.ghosts.push({ s: dotSprite(gtex, 0xffffff, 0.028), rel: new V3(), anchor: null, cel: null, label: null, on: false, txt: '' });
  // other objects in space: pooled orbit lines, dots and HTML labels
  const dk = document.createElement('canvas'); dk.width = dk.height = 32; const dx = dk.getContext('2d');
  dx.fillStyle = '#ffffff'; dx.beginPath(); dx.arc(16, 16, 9, 0, TAU); dx.fill();
  MAP.dotTex = new THREE.CanvasTexture(dk);
  MAP.others = []; MAP.objT = 0;
  MAP.labels = document.createElement('div'); MAP.labels.id = 'mapLabels'; $('hud').appendChild(MAP.labels);
  for (const c of CELS) { const l = document.createElement('div'); l.className = 'mapLabel'; l.dataset.kind = c.kind === 'star' ? 'star' : c.parent && c.parent.kind === 'star' ? 'planet' : 'moon'; l.hidden = true; MAP.labels.appendChild(l); MAP.celLabels.push({ c, l }); }
  mapPlaces();
  MAP.dip = dotSprite(gtex, 0xf0a32b, 0.034);
  MAP.tgt = dotSprite(gtex, 0xff6fd8, 0.05);
  // winch cables
  MAP.ropes = [];
  for (const g of MAP.ghosts) { g.label = document.createElement('div'); g.label.className = 'mapLabel'; g.label.dataset.kind = 'ghost'; g.label.hidden = true; MAP.labels.appendChild(g.label); }
}
const MAP_COLS = { vehicle: 0x7fd0ff, stage: 0xb9a6ff, debris: 0x8d9aa3 };
const MAX_TRACKS = 36, CONIC_N = 160;
function trackSlot(i) {
  let s = MAP.others[i];
  if (s) return s;
  const L = lineObj(CONIC_N + 1, 0xffffff, 0.75);
  const dot = dotSprite(MAP.dotTex, 0xffffff, 0.014);
  const label = document.createElement('div'); label.className = 'mapLabel'; label.hidden = true; MAP.labels.appendChild(label);
  s = MAP.others[i] = { line: L.line, dot, label, pos: L.pos, body: null, cel: null };
  return s;
}
function inSpace(b) {
  if (b.anchored || (b.onTower && !b.onTower.dead)) return false;
  const cel = dominantCel(b.x), alt = b.x.distanceTo(cel.center) - cel.R;
  return alt > spaceAlt(cel);
}
const _oe = new V3(), _oh = new V3(), _or = new V3(), _ov = new V3(), _oP = new V3(), _oQ = new V3();
/* Two-body orbit drawn as a conic around the dominant body (points stored relative to it) */
function conicInto(slot, b) {
  const cel = dominantCel(b.x), mu = cel.mu;
  slot.cel = cel;
  _or.subVectors(b.x, cel.center); _ov.subVectors(b.v, cel.vel);
  const r = _or.length();
  _oh.crossVectors(_or, _ov); const h = _oh.length(); if (h < 1e-3) { slot.line.geometry.setDrawRange(0, 0); return; }
  _oe.crossVectors(_ov, _oh).divideScalar(mu).addScaledVector(_or, -1 / r);
  const e = _oe.length(), p = h * h / mu, rMax = cel.soi === Infinity ? 6e7 : cel.soi * 1.05;
  if (e > 1e-6) _oP.copy(_oe).divideScalar(e); else _oP.copy(_or).divideScalar(r);
  _oQ.crossVectors(_oh, _oP).normalize();
  let t0 = -Math.PI, t1 = Math.PI;
  if (e >= 1) { const lim = Math.acos(-1 / e) - 0.02; t0 = -lim; t1 = lim; }
  const P = slot.pos; let n = 0;
  for (let i = 0; i <= CONIC_N; i++) {
    const th = t0 + (t1 - t0) * i / CONIC_N, rr = p / (1 + e * Math.cos(th));
    if (!(rr > 0) || rr > rMax) continue;
    const c = Math.cos(th) * rr, sn = Math.sin(th) * rr;
    P[n * 3] = _oP.x * c + _oQ.x * sn; P[n * 3 + 1] = _oP.y * c + _oQ.y * sn; P[n * 3 + 2] = _oP.z * c + _oQ.z * sn;
    n++;
  }
  slot.line.geometry.setDrawRange(0, n); slot.line.geometry.attributes.position.needsUpdate = true;
}
function bodyKind(b) { return / debris$/.test(b.name) ? 'debris' : / (stage|piece)$/.test(b.name) ? 'stage' : 'vehicle'; }
function updateMapTracks(dt) {
  if (!G.map) { for (const s of MAP.others) { s.line.visible = s.dot.visible = false; s.label.hidden = true; s.body = null; } return; }
  MAP.objT -= dt;
  const list = W.bodies.filter(b => !b.dead && b !== G.player && inSpace(b))
    .sort((a, b) => (bodyKind(a) === 'debris') - (bodyKind(b) === 'debris') || a.x.distanceToSquared(camera.position) - b.x.distanceToSquared(camera.position))
    .slice(0, MAX_TRACKS);
  const refresh = MAP.objT <= 0; if (refresh) MAP.objT = 0.5;
  for (let i = 0; i < Math.max(list.length, MAP.others.length); i++) {
    const b = list[i];
    if (!b) { const s = MAP.others[i]; if (s) { s.line.visible = s.dot.visible = false; s.label.hidden = true; s.body = null; } continue; }
    const s = trackSlot(i);
    if (refresh || s.body !== b) {
      const col = MAP_COLS[bodyKind(b)];
      s.line.material.color.setHex(col); s.dot.material.color.setHex(col);
      conicInto(s, b); s.body = b;
    }
    s.line.visible = true; s.dot.visible = true; s.dot.position.copy(b.x); s.line.position.copy(s.cel.center);
  }
}
const _lp = new V3(), _lp2 = new V3();
function screenOf(p, w, h) {
  // past the far end of the view, a thing still shows where it lies
  _lp.copy(p); const dd = _lp.distanceTo(camera.position);
  if (dd > camera.far * 0.8) _lp.sub(camera.position).multiplyScalar(camera.far * 0.5 / dd).add(camera.position);
  _lp.project(camera);
  if (_lp.z > 1 || Math.abs(_lp.x) > 1.05 || Math.abs(_lp.y) > 1.05) return null;
  return { x: (_lp.x + 1) / 2 * w, y: (1 - _lp.y) / 2 * h };
}
/* the map also shows Terra's places, stations and landmarks, and its highways and railways as lines */
function mapPlaces() {
  MAP.places = []; MAP.lines = [];
  for (const [k, L] of Object.entries(WORLD.locs)) {
    if (!L.dir || L.cel !== PLANET || !['Places', 'Towns', 'Railways', 'Landmarks'].includes(L.group) && k !== 'pad') continue;
    const l = document.createElement('div'); l.className = 'mapLabel'; l.dataset.kind = L.group === 'Railways' ? 'station' : 'place'; l.hidden = true; MAP.labels.appendChild(l);
    const h = L.hAbs !== undefined ? L.hAbs : Math.max(0, PLANET.heightL(L.dir.x, L.dir.y, L.dir.z));
    MAP.places.push({ l, name: L.name.replace(/ \(.*\)$/, ''), p: L.dir.clone().multiplyScalar(PLANET.R + h + 20), w: new V3() });
  }
  const grp = SITES.groups.get(PLANET); if (!grp) return;
  const add = (pts, col, lift) => {
    const P = [];
    for (let i = 0; i < pts.length; i += 3) { const q = pts[i]; P.push(q.d.x * (PLANET.R + Math.max(q.h, 0) + lift), q.d.y * (PLANET.R + Math.max(q.h, 0) + lift), q.d.z * (PLANET.R + Math.max(q.h, 0) + lift)); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    const ln = new THREE.Line(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.9 })); ln.visible = false; ln.frustumCulled = false; grp.add(ln); MAP.lines.push(ln);
  };
  for (const r of [...WP.roads, ...GLOBE.roads]) add(r.pts, 0xf2c230, 25);
  for (const r of GLOBE.rails) add(r.pts, r.col, 30);
}
function updateMapLabels() {
  for (const ln of MAP.lines || []) ln.visible = G.map && camera.position.distanceTo(PLANET.center) < PLANET.R * 9;
  if (!G.map) { for (const o of MAP.celLabels) o.l.hidden = true; for (const g of MAP.ghosts) g.label.hidden = true; for (const o of MAP.places || []) o.l.hidden = true; return; }
  const w = window.innerWidth, h = window.innerHeight, me = G.player && !G.player.dead ? G.player.x : camera.position;
  const rank = { star: 0, planet: 1, ghost: 2, hook: 3, vehicle: 3, moon: 4, place: 5, station: 6, stage: 7, debris: 8 };
  const vis = [];
  for (const o of MAP.celLabels) {
    o.l.hidden = true;
    const sp = screenOf(o.c.center, w, h); if (!sp) continue;
    vis.push({ el: o.l, x: sp.x, y: sp.y, k: o.l.dataset.kind, name: o.c.name, d: me.distanceTo(o.c.center) - o.c.R, obj: { cel: o.c }, tg: !!(SAS.target && SAS.target.cel === o.c) });
  }
  for (const g of MAP.ghosts) {
    g.label.hidden = true;
    if (!g.on) continue;
    const sp = screenOf(g.s.position, w, h); if (!sp) continue;
    vis.push({ el: g.label, x: sp.x, y: sp.y, k: 'ghost', txt: g.txt, obj: { cel: g.cel } });
  }
  // places on Terra: only from fairly near, and only on the side facing the camera
  const nearT = camera.position.distanceTo(PLANET.center) < PLANET.R * 7;
  for (const o of MAP.places || []) {
    o.l.hidden = true; if (!nearT) continue;
    fromSpin(PLANET, o.p, o.w).add(PLANET.center);
    if (_lp.subVectors(camera.position, o.w).dot(_lp2.subVectors(o.w, PLANET.center)) < 0) continue;
    const sp = screenOf(o.w, w, h); if (!sp) continue;
    vis.push({ el: o.l, x: sp.x, y: sp.y, k: o.l.dataset.kind, txt: o.name, d: me.distanceTo(o.w) });
  }
  for (const s of MAP.others) {
    s.label.hidden = true;
    if (!s.body || !s.dot.visible) continue;
    const sp = screenOf(s.body.x, w, h); if (!sp) continue;
    vis.push({ el: s.label, x: sp.x, y: sp.y, k: bodyKind(s.body), name: s.body.name, d: me.distanceTo(s.body.x), obj: { body: s.body }, tg: !!(SAS.target && SAS.target.body === s.body) });
  }
  baseLabels(vis, w, h, me);
  vis.sort((a, b) => (b.tg ? 1 : 0) - (a.tg ? 1 : 0) || rank[a.k] - rank[b.k] || (a.d || 0) - (b.d || 0));
  // your own vehicle can be clicked too (its dot has no label)
  if (G.player && !G.player.dead) { const sp = screenOf(G.player.x, w, h); if (sp) vis.push({ x: sp.x, y: sp.y, obj: { body: G.player }, k: 'me' }); }
  MAP.pick = vis;
  const shown = [];
  for (const v of vis) {
    const near = shown.find(o => Math.abs(o.x - v.x) < 26 && Math.abs(o.y - v.y) < 16);
    if (v.k === 'me') continue;
    if (near) { near.extra++; continue; }
    v.extra = 0; shown.push(v);
  }
  for (const v of shown) {
    const txt = (v.txt || (v.d < 200 ? v.name : `${v.name} · ${fmtDist(v.d)}`)) + (v.extra ? ` · +${v.extra} more` : '');
    const L = v.el;
    if (L.textContent !== txt) L.textContent = txt;
    if (L.classList.contains('tgt') !== !!v.tg) L.classList.toggle('tgt', !!v.tg);
    L.style.transform = `translate(${(v.x + 9).toFixed(1)}px, ${(v.y - 9).toFixed(1)}px)`;
    L.hidden = false;
  }
}
/* ---- trajectory prediction: integrate through every world's gravity, split into patches per sphere of influence ---- */
const NCEL = CELS.length, CPOS = new Float64Array(NCEL * 3);
let CPAR = null;
function celPositions(t) {
  if (!CPAR) CPAR = CELS.map(c => CELS.indexOf(c.parent));
  for (let i = 0; i < NCEL; i++) {
    const c = CELS[i], k = i * 3;
    if (!c.parent) { CPOS[k] = c.center.x; CPOS[k + 1] = c.center.y; CPOS[k + 2] = c.center.z; continue; }
    const pk = CPAR[i] * 3, th = c.theta0 + c.omega * t, ca = Math.cos(th) * c.a, sa = Math.sin(th) * c.a;
    CPOS[k] = CPOS[pk] + c.e1.x * ca + c.e2.x * sa; CPOS[k + 1] = CPOS[pk + 1] + c.e1.y * ca + c.e2.y * sa; CPOS[k + 2] = CPOS[pk + 2] + c.e1.z * ca + c.e2.z * sa;
  }
}
const _pa = new V3();
function predAccel(px, py, pz, out) {
  let ax = 0, ay = 0, az = 0, dtm = Infinity;
  for (let i = 0; i < NCEL; i++) {
    const k = i * 3, dx = CPOS[k] - px, dy = CPOS[k + 1] - py, dz = CPOS[k + 2] - pz, r2 = dx * dx + dy * dy + dz * dz, r = Math.sqrt(r2), mu = CELS[i].mu;
    const g = mu / (r2 * r); ax += dx * g; ay += dy * g; az += dz * g;
    const tdyn = Math.sqrt(r2 * r / mu); if (tdyn < dtm) dtm = tdyn;
  }
  out.set(ax, ay, az); return dtm;
}
function predDominant(px, py, pz) {
  let best = 0, bs = Infinity;
  for (let i = 1; i < NCEL; i++) {
    const c = CELS[i], k = i * 3, dx = CPOS[k] - px, dy = CPOS[k + 1] - py, dz = CPOS[k + 2] - pz;
    if (c.soi < bs && dx * dx + dy * dy + dz * dz < c.soi * c.soi) { best = i; bs = c.soi; }
  }
  return best;
}
function predictOrbit(b, draw = true) {
  const segs = MAP.segs; for (const sg of segs) { sg.n = 0; sg.cel = null; }
  for (const g of MAP.ghosts) g.on = false;
  const pred = { enc: [], impact: null, segs: 0, tgt: null };
  const tgi = SAS.target && SAS.target.cel ? CELS.indexOf(SAS.target.cel) : -1; if (tgi >= 0) pred.tgt = { min: Infinity, t: 0 };
  let px = b.x.x, py = b.x.y, pz = b.x.z, vx = b.v.x, vy = b.v.y, vz = b.v.z, t = W.time;
  celPositions(t);
  let ci = predDominant(px, py, pz), si = 0, seg = segs[0]; seg.cel = CELS[ci];
  let dtm = predAccel(px, py, pz, _pa), swept = 0, lx = px - CPOS[ci * 3], ly = py - CPOS[ci * 3 + 1], lz = pz - CPOS[ci * 3 + 2];
  let enc = null;
  const push = () => { if (seg.n < SEG_N) { const k = seg.n * 3, ck = ci * 3; seg.pos[k] = px - CPOS[ck]; seg.pos[k + 1] = py - CPOS[ck + 1]; seg.pos[k + 2] = pz - CPOS[ck + 2]; seg.n++; } };
  push();
  for (let step = 0; step < 3200; step++) {
    const dt = clamp(dtm * 0.03, 0.05, 4000);
    vx += _pa.x * dt * 0.5; vy += _pa.y * dt * 0.5; vz += _pa.z * dt * 0.5;
    px += vx * dt; py += vy * dt; pz += vz * dt; t += dt;
    celPositions(t);
    dtm = predAccel(px, py, pz, _pa);
    vx += _pa.x * dt * 0.5; vy += _pa.y * dt * 0.5; vz += _pa.z * dt * 0.5;
    // impacts, and the stars' kill zones
    let hitI = -1;
    for (let i = 0; i < NCEL; i++) {
      const c = CELS[i], k = i * 3, d = Math.hypot(px - CPOS[k], py - CPOS[k + 1], pz - CPOS[k + 2]);
      const lim = c.kind === 'star' ? (c.hole ? c.R : c.heatEnd) : c.R + (c.kind === 'gas' ? -c.R * 0.05 : 0);
      if (i === tgi && d - c.R < pred.tgt.min) { pred.tgt.min = d - c.R; pred.tgt.t = t - W.time; }
      if (d < lim) { hitI = i; break; }
      if (enc && i === enc.i) enc.min = Math.min(enc.min, d - c.R);
    }
    const ni = predDominant(px, py, pz);
    if (ni !== ci) {
      if (si === 2) { push(); break; }
      const nc = CELS[ni];
      if (nc.parent === CELS[ci] || (nc !== CELS[ci].parent)) {
        // entering a smaller world's sphere: remember where it will be
        const g = MAP.ghosts[pred.enc.length];
        enc = { i: ni, cel: nc, t: t - W.time, min: Infinity };
        pred.enc.push(enc);
        if (g) { const k = ni * 3, ck = ci * 3; g.rel.set(CPOS[k] - CPOS[ck], CPOS[k + 1] - CPOS[ck + 1], CPOS[k + 2] - CPOS[ck + 2]); g.anchor = CELS[ci]; g.cel = nc; g.on = true; g.enc = enc; }
      }
      push();
      si++; seg = segs[si]; ci = ni; seg.cel = CELS[ci]; swept = 0;
      lx = px - CPOS[ci * 3]; ly = py - CPOS[ci * 3 + 1]; lz = pz - CPOS[ci * 3 + 2];
    }
    push();
    if (hitI >= 0) { pred.impact = { cel: CELS[hitI], t: t - W.time }; break; }
    const rx = px - CPOS[ci * 3], ry = py - CPOS[ci * 3 + 1], rz = pz - CPOS[ci * 3 + 2];
    const cs = (lx * rx + ly * ry + lz * rz) / (Math.hypot(lx, ly, lz) * Math.hypot(rx, ry, rz));
    swept += Math.acos(clamp(cs, -1, 1)); lx = rx; ly = ry; lz = rz;
    if (swept > TAU + 0.03) break;
  }
  pred.segs = si + 1;
  MAP.pred = pred;
  if (!draw) return pred;
  for (const sg of segs) {
    sg.line.geometry.setDrawRange(0, sg.n); sg.line.geometry.attributes.position.needsUpdate = true;
  }
  for (const g of MAP.ghosts) {
    if (!g.on) continue;
    const e = g.enc;
    g.txt = `${g.cel.name} encounter in ${fmtTime(e.t)}` + (e.min < Infinity ? (e.min < 0 ? ' · impact' : ` · closest ${fmtDist(e.min)}`) : '');
    g.s.material.color.setHex(g.cel.beacon || 0xffffff);
  }
  return pred;
}
function placeMapLines() {
  for (const sg of MAP.segs) { sg.line.visible = G.map && sg.n > 1 && !!sg.cel; if (sg.cel) sg.line.position.copy(sg.cel.center); }
  for (const g of MAP.ghosts) { g.s.visible = G.map && g.on; if (g.on) g.s.position.copy(g.anchor.center).add(g.rel); }
  for (const r of MAP.rings) { r.line.visible = G.map; r.line.position.copy(r.cel.parent.center); }
  // the target: a pink ring round it
  const tp = G.map ? sasTargetPos() : null; MAP.tgt.visible = !!tp; if (tp) MAP.tgt.position.copy(tp);
  // in flight: a ring where the next skyhook dip happens, for anything carrying a docking port
  const dp = HOOKPRED.ok && G.mode === 'drive' && HOOKPRED.cel ? HOOKPRED : null;
  MAP.dip.visible = !!dp;
  if (dp) fromSpin(dp.cel, dp.relL, MAP.dip.position).add(dp.cel.center);
  // cables
  let n = 0;
  for (const r of W.ropes) {
    if (!r.wp.alive || !r.hook || r.hook.dead || !r.wp.body) continue;
    let L = MAP.ropes[n];
    if (!L) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage)); L = MAP.ropes[n] = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x1d1f22 })); L.frustumCulled = false; scene.add(L); }
    const A = r.wp.body.toWorld(r.wd.pos.x, r.wd.pos.y, r.wd.pos.z, _rpa), P = L.geometry.attributes.position;
    L.position.copy(A); P.setXYZ(0, 0, 0, 0); P.setXYZ(1, r.hook.x.x - A.x, r.hook.x.y - A.y, r.hook.x.z - A.z); P.needsUpdate = true; L.visible = true; n++;
  }
  for (let i = n; i < MAP.ropes.length; i++) MAP.ropes[i].visible = false;
  MAP.marker.visible = G.map && !!G.player && !G.player.dead;
}
const _dipDir = new V3(), _rpa = new V3();
/* where will the nearest spinning skyhook's grapple next bottom out? */
const HOOKPRED = { ok: false, t: 0, rel: new V3(), relL: new V3(), cel: null, alt: 0, dist: 0, tipDist: 0, hook: null, timer: 0 };
const _hp1 = new V3(), _hp2 = new V3(), _hp3 = new V3(), _hp4 = new V3(), _hp5 = new V3(), _hpq = new Quat();
function predictDip(p) {
  const H = HOOKPRED; H.ok = false;
  const pm = new Set(machineOf(p));
  let best = null, bd = 6e4;
  for (const b of W.bodies) {
    if (b.dead || pm.has(b) || !b.grapples.length || b.w.length() < 0.01) continue;
    const d = b.x.distanceTo(p.x) - b.radius; if (d < bd) { bd = d; best = b; }
  }
  if (!best) return;
  const cel = dominantCel(best.x); if (cel.kind !== 'rocky' && cel.kind !== 'gas') return;
  const g = best.grapples.find(g => g.p.alive); if (!g) return;
  const tip0 = best.toWorld(g.pos.x, g.pos.y, g.pos.z, _hp1).sub(best.x);
  const wl = best.w.length(), ax = _hp2.copy(best.w).divideScalar(wl);
  const r = _hp3.subVectors(best.x, cel.center), v = _hp4.subVectors(best.v, cel.vel);
  H.tipDist = best.toWorld(g.pos.x, g.pos.y, g.pos.z, _hp5).distanceTo(p.x);
  // step ahead until the tip's height stops falling: that's the next dip
  let tBest = 0, aBest = Infinity, relBest = null, prev = Infinity, prevRel = null, falling = false;
  const dt = 0.5, n = Math.min(1200, Math.ceil(2.5 * TAU / wl / dt));
  for (let i = 0; i <= n; i++) {
    const t = i * dt;
    if (i) { const r2 = r.lengthSq(), k = -cel.mu / (r2 * Math.sqrt(r2)); v.addScaledVector(r, k * dt); r.addScaledVector(v, dt); }
    _hpq.setFromAxisAngle(ax, wl * t);
    const tip = _hp5.copy(tip0).applyQuaternion(_hpq).add(r);
    const a = tip.length() - cel.R;
    if (a < prev) falling = true;
    else if (falling && i > 1) { aBest = prev; tBest = t - dt; relBest = prevRel; break; }
    prev = a; prevRel = tip.clone();
  }
  if (!relBest) return;
  // where that is over the ground now: turn it back by however far the world spins before then
  _hpq.setFromAxisAngle(cel.spinAxis, -cel.spinW * tBest); relBest.applyQuaternion(_hpq);
  H.ok = true; H.t = tBest; toSpin(cel, relBest, H.relL); H.cel = cel; H.alt = aBest; H.hook = best;
  H.dist = fromSpin(cel, H.relL, _hp5).add(cel.center).distanceTo(p.x);
}
function fmtTime(s) {
  s = Math.max(0, s);
  if (s < 60) return Math.round(s) + 's';
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
  if (s < 86400 * 2) return `${Math.floor(s / 3600)}h ${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor(s % 86400 / 3600)}h`;
}
function orbitInfo(b, cel) {
  const rx = b.x.x - cel.center.x, ry = b.x.y - cel.center.y, rz = b.x.z - cel.center.z;
  const vx = b.v.x - cel.vel.x, vy = b.v.y - cel.vel.y, vz = b.v.z - cel.vel.z;
  const r = Math.hypot(rx, ry, rz), v2 = vx * vx + vy * vy + vz * vz, eps = v2 / 2 - cel.mu / r;
  const hx = ry * vz - rz * vy, hy = rz * vx - rx * vz, hz = rx * vy - ry * vx, h = Math.hypot(hx, hy, hz);
  const e = Math.sqrt(Math.max(0, 1 + 2 * eps * h * h / (cel.mu * cel.mu)));
  if (eps >= 0) return { escape: true, e, pe: h * h / cel.mu / (1 + e) - cel.R };
  const a = -cel.mu / (2 * eps);
  return { escape: false, e, ap: a * (1 + e) - cel.R, pe: a * (1 - e) - cel.R, T: TAU * Math.sqrt(a * a * a / cel.mu) };
}

/* ---------------- spawning ---------------- */
function frameAt(up, hint) {
  const f = hint.clone().addScaledVector(up, -hint.dot(up));
  if (f.lengthSq() < 1e-6) { const t2 = new V3(); tangentBasis(up.x, up.y, up.z, f, t2); }
  f.normalize();
  const r = new V3().crossVectors(up, f).normalize();
  return { up, fwd: f, right: r };
}
function groundHeightUnder(cel, center, fr, rad) {
  let h = -1e9; const o = new V3();
  for (let i = 0; i < 9; i++) {
    const a = i / 8 * TAU, d = i === 0 ? 0 : rad;
    o.copy(center).addScaledVector(fr.right, Math.cos(a) * d).addScaledVector(fr.fwd, Math.sin(a) * d).sub(cel.center).normalize();
    h = Math.max(h, cel.height(o.x, o.y, o.z));
  }
  return h;
}
/* ---------- machines: a vehicle may be several bodies joined by moving parts ---------- */
function machineOf(b) { return b && !b.dead ? assemblyOf(b) : []; }
function createVehicle(design, opts = {}) {
  const parts = instantiate(design);
  const { comps, links } = assemblySplit(parts);
  const name = design.name || 'Vehicle', dz = cloneDesign(design);
  const fam = ++FAMID;
  const bodies = comps.map(c => new Body(c, { name, design: dz, brake: opts.brake || 0, fam }));
  const root = bodies.find(b => b.seat) || bodies.reduce((a, b) => b.mass > a.mass ? b : a);
  for (const b of bodies) { b.initialParts = parts.length; b.spawned = !!opts.spawned; }
  for (const l of links) makeJoint(l.jp, l.ap);
  const all = bodies.slice();
  // every winch drops a hook on a short cable
  for (const b of bodies) for (const w of b.winches) {
    const hp = new PartInst('winch_hook', [0, 0, 0], [1, 0, 0, 0, 1, 0, 0, 0, 1], 4);
    const hook = new Body([hp], { name: name + ' hook', fam });
    hook.homeD = w.pos.clone().addScaledVector(w.dir, 2.5); hook.initialParts = 1;
    const r = { wp: w.p, wd: { pos: w.pos.clone(), dir: w.dir.clone() }, hook, L: 2.5, acc: 0, len: 2.5 };
    r.holding = () => !!hook.dock || W.bodies.some(o => o.dock && o.dock.carrier === hook);
    W.ropes.push(r); all.push(hook);
  }
  root.machine = all; root.allParts = parts;
  for (const b of all) b.machine = all;
  W.bodies.push(...all);
  assignAssemblies();
  return root;
}
/* move every piece of a fresh machine to match its root (the design frame is shared) */
function syncMachine(root) {
  for (const b of root.machine || [root]) {
    if (b === root || b.dead) continue;
    b.q.copy(root.q); b.updR();
    if (b.homeD) { root.toWorld(b.homeD.x, b.homeD.y, b.homeD.z, b.x); const c = b.comD; b.x.x += b.r[0] * c.x + b.r[1] * c.y + b.r[2] * c.z; b.x.y += b.r[3] * c.x + b.r[4] * c.y + b.r[5] * c.z; b.x.z += b.r[6] * c.x + b.r[7] * c.y + b.r[8] * c.z; }
    else root.toWorld(b.comD.x, b.comD.y, b.comD.z, b.x);
    root.velAt(b.x, b.v); b.w.copy(root.w); b.wake(); b.dock = null;
  }
  for (const j of W.joints) if (j.jp.body && (root.machine || [root]).includes(j.jp.body)) { j.target = 0; j.spin = 0; j.hold = 0; }
}
function removeMachine(b) {
  const fam = b.fam;
  for (const o of machineOf(b).slice()) removeBody(o); if (!b.dead) removeBody(b);
  // towers and dropped stages from the same launch go too; other drivable craft stay
  if (fam) for (const o of W.bodies.slice()) if (o.fam === fam && !(o.seat && !o.seat.broken)) removeBody(o);
}
function placeBody(b, fr, ground, vel, extra = 0.3, cel = null) {
  b.q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fr.right, fr.up, fr.fwd)); b.updR();
  const lo = designBottom(b.allParts || b.parts);
  const origin = ground.clone().addScaledVector(fr.up, -lo + extra);
  const r = b.r, c = b.comD;
  b.x.set(origin.x + r[0] * c.x + r[1] * c.y + r[2] * c.z, origin.y + r[3] * c.x + r[4] * c.y + r[5] * c.z, origin.z + r[6] * c.x + r[7] * c.y + r[8] * c.z);
  b.v.copy(vel); b.w.set(0, 0, 0);
  if (cel) { surfaceVel(cel, b.x, b.v); spinVec(cel, b.w); }
  b.wake();
  syncMachine(b);
}
function warmTerrain(c, p) {
  if (!c.ter) return;
  const f = toSpin(c, new V3().subVectors(p, c.center), new V3()), t0 = performance.now();
  for (let i = 0; i < 60 && performance.now() - t0 < 350; i++) { c.ter.update(f, f); if (!c.ter.queue.length) break; c.ter.process(25); }
}
/* skyhook orbit: centre of mass circles Terra over the pad, the long arm spins so its tip dips to
   1,500 m moving about 30 m/s over the ground, slow enough for a plane to meet it */
const HOOK_LOW = 1500, HOOK_TIP_SPEED = 30;
function machineShape(root) {
  const bodies = (root.machine || [root]).filter(b => !b.dead);
  let M = 0; const com = new V3();
  for (const b of bodies) { M += b.mass; com.addScaledVector(b.comD, b.mass); }
  com.divideScalar(M || 1);
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const b of bodies) for (const p of b.parts) for (const c of p.cells) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], c[i]); mx[i] = Math.max(mx[i], c[i]); }
  const ext = [0, 1, 2].map(i => (mx[i] - mn[i] + 1) * CELL), li = ext.indexOf(Math.max(...ext));
  const Ld = new V3().setComponent(li, 1);
  // the grapple end is the tip; otherwise the end farther from the centre of mass
  let tip = null, best = -1;
  for (const b of bodies) for (const g of b.grapples) { const d = Math.abs(g.pos.getComponent(li) - com.getComponent(li)); if (d > best) { best = d; tip = g.pos.clone(); } }
  if (!tip) { const a = mx[li] * CELL - com.getComponent(li), z = com.getComponent(li) - mn[li] * CELL; tip = com.clone().setComponent(li, a > z ? mx[li] * CELL + .25 : mn[li] * CELL - .25); }
  const s = Math.sign(tip.getComponent(li) - com.getComponent(li)) || 1, Ltip = Math.abs(tip.getComponent(li) - com.getComponent(li)) + 0.5;
  return { bodies, M, com, Ld: Ld.multiplyScalar(s), Ltip, len: ext[li], li };
}
function placeSkyhook(root) {
  const S = machineShape(root);
  const rc = PLANET.R + HOOK_LOW + S.Ltip, n = Math.sqrt(PLANET.mu / (rc * rc * rc)), vc = n * rc;
  const ground = PLANET.spinW * (PLANET.R + HOOK_LOW);
  const w = Math.max(n * 1.6, (vc - HOOK_TIP_SPEED - ground) / S.Ltip);
  const e1 = WORLD.padUp, e2 = WORLD.padEast, nrm = new V3().crossVectors(e1, e2).normalize();
  // design: a = toward the tip, b = spin axis, c = a × b; world: tip leads along the orbit, spin about the orbit normal
  const a = S.Ld.clone(), b = S.li === 1 ? new V3(0, 0, 1) : new V3(0, 1, 0), c = new V3().crossVectors(a, b);
  const A = e2.clone(), Bw = nrm.clone(), Cw = new V3().crossVectors(A, Bw);
  const Md = new THREE.Matrix4().makeBasis(a, b, c), Mw = new THREE.Matrix4().makeBasis(A, Bw, Cw);
  const R = Mw.multiply(Md.transpose()), q = new Quat().setFromRotationMatrix(R);
  const comW = PLANET.center.clone().addScaledVector(e1, rc), vCom = PLANET.vel.clone().addScaledVector(e2, vc), wv = nrm.clone().multiplyScalar(w);
  for (const bd of S.bodies) {
    bd.q.copy(q); bd.updR();
    bd.x.copy(bd.comD).sub(S.com).applyQuaternion(q).add(comW);
    bd.v.copy(vCom).add(new V3().crossVectors(wv, new V3().subVectors(bd.x, comW)));
    bd.w.copy(wv); bd.wake(); bd.dock = null;
  }
  for (const bd of S.bodies) if (bd.homeD) { bd.x.copy(bd.homeD).sub(S.com).applyQuaternion(q).add(comW); bd.v.copy(vCom).add(new V3().crossVectors(wv, new V3().subVectors(bd.x, comW))); }
  return { fr: frameAt(e1.clone(), e2.clone()), dip: Math.PI / 2 / (w - n), rc, w, S };
}
function spawnAtLocation(b, key) {
  const L = WORLD.locs[key] || WORLD.locs.pad;
  const c = L.cel || PLANET;
  if (L.kind === 'skyhook') {
    if (machineShape(b).len < 300) { toast('Skyhook orbit is for skyhooks: builds at least 300 m long with a Grapple Claw on one end. Starting in low orbit instead.', 4200); return spawnAtLocation(b, 'orbit'); }
    const r = placeSkyhook(b);
    toast(`Skyhook spinning: the tip first dips to ${fmtDist(HOOK_LOW)} in ${fmtTime(r.dip)}`, 3600);
    return r.fr;
  }
  if (L.kind === 'deep') {
    // out between the stars, coasting toward one: far beyond any world's pull
    const S = c, toS = new V3().subVectors(S.center, SUN.center), dist = toS.length(); toS.divideScalar(dist);
    const up = toS.clone().negate(), fr = frameAt(up, new V3().crossVectors(SOLAR.n, up));
    placeBody(b, fr, SUN.center.clone().addScaledVector(toS, dist * 0.55), toS.clone().multiplyScalar(900), 0);
    toast(`Deep space, ${fmtDist(dist * 0.45)} from ${S.name}. Time warp here goes up to ×1,000,000`, 4200);
    return fr;
  }
  if (L.kind === 'orbit') {
    let up, hint;
    if (c === PLANET) { up = WORLD.padUp.clone(); hint = WORLD.padEast; }
    else {
      const S = c.kind === 'star' ? (c === SUN ? null : SUN) : rootStar(c);
      up = S ? new V3().subVectors(S.center, c.center).normalize() : SOLAR.e1.clone(); hint = new V3().crossVectors(SOLAR.n, up);
      // round the black hole the orbit is tipped a little out of the disk's plane, so you see the disk from just above it
      if (c === MAW) { const n = sky.hole.lensMat.uniforms.nrm.value; up.addScaledVector(n, -up.dot(n)).normalize().multiplyScalar(Math.cos(0.26)).addScaledVector(n, Math.sin(0.26)); hint = new V3().crossVectors(n, up); }
    }
    const fr = frameAt(up, hint);
    const r = c.R + L.alt, pos = c.center.clone().addScaledVector(fr.up, r);
    placeBody(b, fr, pos, c.vel.clone().addScaledVector(fr.fwd, Math.sqrt(c.mu / r)), 0);
    return fr;
  }
  if (L.kind === 'surface' && L.dir) {
    const dir = fromSpin(c, L.dir, new V3()).normalize(), fr = frameAt(dir, fromSpin(c, L.fwd, new V3()));
    const h = groundHeightUnder(c, c.center.clone().addScaledVector(dir, c.R), fr, Math.min(b.radius, 30));
    placeBody(b, fr, c.center.clone().addScaledVector(dir, c.R + h), c.vel, 0.4, c);
    warmTerrain(c, b.x);
    return fr;
  }
  if (L.kind === 'surface') {
    const sun = new V3().subVectors(rootStar(c).center, c.center).normalize();
    if (c === MOON) sun.addScaledVector(new V3().subVectors(PLANET.center, MOON.center).normalize(), 0.9).normalize();
    // on Iris, the living ring where day meets night
    if (c === IRIS) { const side = new V3().crossVectors(sun, SOLAR.n).normalize(); sun.multiplyScalar(0.12).add(side).normalize(); }
    const dir = findSurfaceSpot(c, sun), fr = frameAt(dir, new V3().crossVectors(SOLAR.n, dir).add(sun.clone().multiplyScalar(0.3)));
    let h = groundHeightUnder(c, c.center.clone().addScaledVector(dir, c.R), fr, Math.min(b.radius, 30));
    if (c.sea) h = Math.max(h, 0);
    const ground = c.center.clone().addScaledVector(dir, c.R + h);
    placeBody(b, fr, ground, c.vel, 0.5, c);
    warmTerrain(c, ground);
    return fr;
  }
  if (L.kind === 'train') { const fr = spawnOnTrain(b, L.line); if (fr) return fr; }
  const up = fromSpin(PLANET, L.dir || WORLD.padUp, new V3()).normalize(), fr = frameAt(up, L.fwd ? fromSpin(PLANET, L.fwd, new V3()) : WORLD.padFwd);
  if (L.kind === 'sea') { placeBody(b, fr, PLANET.center.clone().addScaledVector(up, PLANET.R), PLANET.vel, 0.15, PLANET); return fr; }
  // spots on top of something (a platform, a roof) give their own height
  const h = key === 'pad' ? WORLD.padH : L.hAbs !== undefined ? L.hAbs : groundHeightUnder(PLANET, PLANET.center.clone().addScaledVector(up, PLANET.R), fr, Math.min(b.radius, 30));
  placeBody(b, fr, PLANET.center.clone().addScaledVector(up, PLANET.R + (L.hAbs !== undefined ? h : Math.max(h, 0))), PLANET.vel, 0.35, PLANET);
  if (key !== 'pad') warmTerrain(PLANET, b.x);
  return railSnap(b) || fr;
}
/* a vehicle on rail bogies spawned near a railway is set down on the track, lined up with it, clear of the trains */
function railSnap(b) {
  if (!machineOf(b).some(o => o.bogies && o.bogies.length) || !GLOBE.rails.length) return null;
  const lp = toSpin(PLANET, new V3().subVectors(b.x, PLANET.center), new V3()).normalize(), R = PLANET.R;
  const trains = TRAIN.list.flatMap(tr => tr.cars.map(c => c.base));
  let best = null, bd = 160;
  for (const L of GLOBE.rails) {
    const P = L.pts;
    for (let i = 1; i < P.length - 1; i++) {
      const d = P[i].d.distanceTo(lp) * R; if (d >= bd || P[i].cross) continue;
      const at = P[i].d.clone().multiplyScalar(R + P[i].h);
      if (trains.some(t => t.distanceTo(at) < 45)) continue;
      bd = d; best = { L, i };
    }
  }
  if (!best) return null;
  const P = best.L.pts, p = P[best.i];
  // facing the longer way along the line, not into the buffers at the end of it
  const ahead = best.i < P.length / 2 ? 1 : -1;
  const up = fromSpin(PLANET, p.d, new V3()).normalize(), f = fromSpin(PLANET, new V3().subVectors(P[best.i + ahead].d, P[best.i - ahead].d), new V3());
  const fr = frameAt(up, f);
  placeBody(b, fr, PLANET.center.clone().addScaledVector(up, R + p.h + RAIL_TOP), PLANET.vel, 0.08, PLANET);
  ensureBuiltNear(b.x);
  return fr;
}
function spawnPlayer(respawn) {
  const cur = G.player && !G.player.dead ? G.player : null;
  const design = respawn && cur && cur.design ? cur.design : B.design;
  const st = designStats(design);
  if (!st.count) { toast('Nothing to drive yet. Place a part first.'); return false; }
  if (cur) { cur.player = false; removeMachine(cur); G.player = null; }
  for (const b of W.bodies.filter(b => b.player)) removeMachine(b);
  const b = createVehicle(design);
  const fr = spawnAtLocation(b, G.spawnLoc);
  ensureBuiltNear(b.x);
  makeRoom(b, fr);
  takeControl(b, fr);
  return true;
}
/* hand the controls to a vehicle; whatever you were driving is parked where it is */
function takeControl(b, fr) {
  ensureBuiltNear(b.x);
  if (G.player && G.player !== b && !G.player.dead) parkBody(G.player);
  G.player = b; b.player = true; b.debris = false;
  for (const o of machineOf(b)) { o.spawned = false; if (o.asleep) o.wake(); o.ctl.brake = 0; }
  G.seatUid = b.seat ? b.seat.uid : null; G.initialParts = b.initialParts || (b.initialParts = b.parts.length);
  G.wrecked = false; G.throttle = 0; G.reversing = false; G.braking = 0; G.warp = 1; G.fuelWarned = false; G.noSeat = !b.seat; G.rcsMode = false;
  // SAS starts off, and keys already held don't count as fresh presses
  SAS.on = false; seedEdges();
  if (G.noSeat) toast('No seat aboard: this vehicle won\'t respond to controls', 3200);
  const cel = dominantCel(b.x), up = new V3().subVectors(b.x, cel.center).normalize();
  const f = fr ? fr.fwd.clone() : b.dirW(0, 0, 1, new V3());
  f.addScaledVector(up, -f.dot(up)); if (f.lengthSq() < 1e-4) tangentBasis(up.x, up.y, up.z, f, new V3());
  DC.ref.copy(f.normalize()); DC.yaw = 0; DC.pitch = 0.3; DC.dist = b.radius > 300 && b.seat ? 24 : clamp(Math.min(b.radius, 20) * 3.0 + 4, 8, 70);
  lastFocus.copy(b.x);
  renderKeys(); renderSAS();
}
function parkBody(b) {
  b.player = false;
  for (const o of machineOf(b)) { clearInputs(o); o.ctl.brake = 0.6; }
}
/* towers: where the anchor stands, and how far apart two points are along the ground */
function towerBase(o) { const a = o.anchors.find(a => a.p.alive); return a ? o.toWorld(a.pos.x, a.pos.y, a.pos.z, new V3()) : null; }
function groundDist(p, q, cel) { const up = p.clone().sub(cel.center).normalize(), d = q.clone().sub(p); return d.addScaledVector(up, -d.dot(up)).length(); }
function nearTower(p, r, skip) {
  for (const o of W.bodies) { if (!o.anchored || o === skip || o.dead) continue; const tb = towerBase(o); if (tb && groundDist(tb, p, o.anchored) < r + 6) return o; }
  return null;
}
/* a parked tower standing where a new vehicle appears walks back along the ground, with whatever is holding on to it */
function moveTowerAside(o, b, fr) {
  const cel = o.anchored, base = towerBase(o); if (!cel || !base) return;
  const at = (b.anchors.length && towerBase(b)) || b.x;
  if (groundDist(base, at, cel) > (b.radius > 300 ? 6 : b.radius) + 6) return;
  const fam = W.bodies.filter(q => q === o || (!q.dead && q.onTower === o));
  for (let k = 1; k < 14; k++) {
    const spot = base.clone().addScaledVector(fr.fwd, -12 * k);
    if (nearTower(spot, 2, o)) continue;
    // swing the whole tower about the world's centre so it stays upright, then sit it on the ground there
    const u0 = base.clone().sub(cel.center).normalize(), u1 = spot.clone().sub(cel.center).normalize();
    const R = new Quat().setFromUnitVectors(u0, u1);
    const dh = cel.height(u1.x, u1.y, u1.z) - cel.height(u0.x, u0.y, u0.z);
    o.anchored = null;
    for (const q of fam) {
      q.x.sub(cel.center).applyQuaternion(R).add(cel.center).addScaledVector(u1, dh);
      q.q.premultiply(R); q.updR(); surfaceVel(cel, q.x, q.v); spinVec(cel, q.w);
      if (q !== o && q.asleep && q.pinCel) q.pin(q.pinCel, false);
    }
    anchorBody(o, cel);
    toast(`Moved ${o.name} back to make room`, 2000);
    return;
  }
}
/* a parked vehicle sitting where a new one appears gets nudged to one side */
function makeRoom(b, fr) {
  const mine = new Set(machineOf(b));
  if (fr) for (const o of W.bodies.slice()) if (o.anchored && !mine.has(o) && o.fam !== b.fam) moveTowerAside(o, b, fr);
  for (const o of W.bodies) {
    if (mine.has(o) || o.dead || o.debris || o.dock || !o.seat) continue;
    if (o.x.distanceTo(b.x) > o.radius + b.radius + 1 || o.radius > 400 || b.radius > 400) continue;
    const cel = dominantCel(b.x), right = fr ? fr.right : b.dirW(1, 0, 0, new V3());
    for (let k = 1; k < 10; k++) {
      const side = (k % 2 ? 1 : -1) * Math.ceil(k / 2);
      const c = b.x.clone().addScaledVector(right, side * (b.radius + o.radius + 3));
      if (!W.bodies.every(q => q === o || q.dead || q.x.distanceTo(c) > q.radius + o.radius + 1.5)) continue;
      if (cel.kind === 'rocky' && b.x.distanceTo(cel.center) - cel.R < spaceAlt(cel)) {
        const tu = c.clone().sub(cel.center).normalize(), frO = frameAt(tu, o.dirW(0, 0, 1, new V3()));
        let h = groundHeightUnder(cel, cel.center.clone().addScaledVector(tu, cel.R), frO, o.radius);
        if (cel.sea) h = Math.max(h, 0);
        placeBody(o, frO, cel.center.clone().addScaledVector(tu, cel.R + h), cel.vel, 0.4, cel);
      } else { o.x.copy(c); o.wake(); syncMachine(o); }
      toast(`Moved ${o.name} aside to make room`, 1800);
      break;
    }
  }
}
function spawnOther(design) {
  const pb = G.player && !G.player.dead ? G.player : null;
  const base = pb ? pb.x.clone() : B.padPoint.clone();
  const cel = dominantCel(base);
  const up = base.clone().sub(cel.center).normalize();
  const camF = new V3(); camera.getWorldDirection(camF);
  const fr0 = frameAt(up, camF);
  const nb = createVehicle(design, { brake: 0.6, spawned: true });
  parkBody(nb);
  // anything kilometres long goes straight to the skyhook orbit
  if (machineShape(nb).len > 400 && !machineOf(nb).some(o => o.anchors.length)) { const r = placeSkyhook(nb); toast(`${design.name} is spinning in skyhook orbit: first dip in ${fmtTime(r.dip)}`, 3600); return; }
  const pr = pb ? Math.min(pb.radius, 30) : 4, d0 = pr + nb.radius + 6;
  let target = null;
  for (const dist of [d0, d0 + nb.radius * 2 + 4, d0 + nb.radius * 4 + 8]) {
    for (const lat of [0, 1, -1, 2, -2]) {
      const c = base.clone().addScaledVector(fr0.fwd, dist).addScaledVector(fr0.right, lat * (nb.radius * 2 + 3));
      if (W.bodies.every(o => o.machine === nb.machine || o.x.distanceTo(c) > Math.min(o.radius, 60) + nb.radius + 1.5) && !nearTower(c, nb.radius > 300 ? 2 : nb.radius)) { target = c; break; }
    }
    if (target) break;
  }
  if (!target) target = base.clone().addScaledVector(fr0.fwd, d0 + nb.radius * 6 + 12);
  const alt = base.distanceTo(cel.center) - cel.R;
  const tu = target.clone().sub(cel.center).normalize();
  const fr = frameAt(tu, fr0.fwd.clone().negate());
  if (cel.kind !== 'rocky' || alt > spaceAlt(cel) || (!cel.air && alt > 500)) {
    placeBody(nb, fr, target, pb ? pb.v : cel.vel, 0);
  } else {
    let h = groundHeightUnder(cel, cel.center.clone().addScaledVector(tu, cel.R), fr, nb.radius);
    if (cel.sea) h = Math.max(h, 0);
    placeBody(nb, fr, cel.center.clone().addScaledVector(tu, cel.R + h), cel.vel, 0.4, cel);
  }
  toast(`Spawned ${design.name}`);
}
function onStructureChange() {
  if (G.seatUid == null) { if (G.player && G.player.dead) { const nb = W.bodies.filter(b => !b.dead && b.debris).sort((a, b) => b.mass - a.mass)[0]; if (nb) { G.player = nb; nb.player = true; } } return; }
  const sb = W.bodies.find(b => b.parts.some(p => p.uid === G.seatUid));
  if (sb) {
    if (G.player !== sb) { if (G.player && !G.player.dead) G.player.player = false; G.player = sb; sb.player = true; }
    const sp = sb.parts.find(p => p.uid === G.seatUid);
    G.wrecked = !!(sp && sp.broken);
  } else G.wrecked = true;
}
function onJointLost(j) {
  // a piece that lost its last joint to the seat becomes wreckage
  const B = j.ap.alive ? j.ap.body : null;
  if (B && !B.dead && !B.seat) { B.debris = true; B.name = B.name.replace(/ (debris|piece|stage)$/, '') + ' piece'; }
}
function onLinked(F, C, kind) {
  const p = G.player; if (!p || p.dead) return;
  const mine = machineOf(p);
  if (!mine.includes(F) && !mine.includes(C)) return;
  const other = mine.includes(F) ? C : F;
  const ug = keyName(actKeys('undock')[0]), gr = keyName(actKeys('grab')[0]);
  const msg = kind === 'grapple' ? `Grabbed by the skyhook! Ride to the top of the swing and press ${ug} to let go`
    : kind === 'dock' ? `Docked with ${other.name}. ${ug} undocks` : kind === 'coupler' ? `Coupled to ${other.name}. ${ug} lets go` : kind === 'claw' ? `Claw grabbed ${other.name}. ${gr} lets go` : `Hook latched onto ${other.name}. ${gr} lets go`;
  toast(msg, 3400); G.shake = Math.max(G.shake, kind === 'grapple' ? 0.5 : 0.2); SND.play('dock');
}
function onChuteTorn(b) { if (G.player && machineOf(G.player).includes(b)) toast('Parachute torn: too fast to open', 2200); }
function flipUpright() {
  const b = G.player; if (!b || G.wrecked) return;
  if (b.anchored) { toast(`Anchored to the ground. ${keyName(actKeys('undock')[0])} lets go first`, 1600); return; }
  if (machineOf(b).some(o => o.wheels.some(w => w.lat))) { toast('Can\'t flip while clamped onto a truss', 1600); return; }
  if (b.radius > 300) { toast('Too big to flip', 1400); return; }
  const cel = dominantCel(b.x), up = new V3().subVectors(b.x, cel.center).normalize();
  const fr = frameAt(up, b.dirW(0, 0, 1, new V3()));
  for (const o of machineOf(b)) if (o.dock) detach(o);
  b.q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fr.right, fr.up, fr.fwd)); b.updR();
  b.x.addScaledVector(up, 1.2 + Math.min(b.radius, 20) * 0.6); surfaceVel(cel, b.x, b.v); spinVec(cel, b.w); b.wake();
  syncMachine(b);
  toast('Flipped upright');
}

/* ---------------- modes ---------------- */
/* B back to the builder removes the vehicle you were driving; Park & build leaves it out in the world */
function setMode(m, force, board, park) {
  if (BASES.mode) exitBaseMode();
  if (m === G.mode && !force && !board) return;
  G.mode = m;
  document.body.classList.toggle('mode-build', m === 'build');
  document.body.classList.toggle('mode-drive', m === 'drive');
  $('btnBuild').classList.toggle('on', m === 'build'); $('btnDrive').classList.toggle('on', m === 'drive');
  $('btnBuild').setAttribute('aria-selected', m === 'build'); $('btnDrive').setAttribute('aria-selected', m === 'drive');
  if (m === 'drive') {
    B.group.visible = false; setGhost('', null); setHover(-1);
    B.selSet.clear(); if (B.pasting) cancelPaste();
    if (board) takeControl(board);
    else if (!spawnPlayer()) { setMode('build'); return; }
    G.map = false;
  } else {
    const p = G.player;
    if (p && !p.dead) {
      if (park && p.seat && !p.seat.broken) { parkBody(p); toast(`${p.name} is parked. Find it under Vehicles`, 2600); }
      else removeMachine(p);
    }
    for (const b of W.bodies.filter(b => b.debris)) removeBody(b);
    // knocked-over cones, barrels and trees go back where they were
    if (started) { spawnLoose(); floraStandUp(); }
    FX.n = 0; W.expl = []; clearShots();
    for (const o of G.live) if (!o.dead) clearInputs(o);
    G.live = []; IN.real = false;
    G.player = null; G.map = false; G.warp = 1; G.rcsMode = false; SAS.on = false;
    B.group.visible = true; bRebuild();
    worldSave();
  }
  setMapVisible(false);
  renderKeys(); renderSAS(); buildKeyLabels();
  if (m === 'drive') { const seen = LS.get('scrapline.droveBefore', false); G.keysMin = !!seen; $('keys').classList.toggle('min', G.keysMin); if (!seen) LS.set('scrapline.droveBefore', true); }
  $('view').focus();
}
function setMapVisible(v) {
  if (v && BASES.mode) exitBaseMode();
  G.map = v; MAP.objT = 0;
  if (v) { MAP.focus = null; MAP.pan.set(0, 0, 0); MAP.tr = null; MAP.lastClick = null; }
  if (!v) updateMapTracks(0);
  document.body.classList.toggle('map', v);
  if (v && G.player && !G.player.dead) predictOrbit(G.player);
  placeMapLines(); renderMapBar();
}
/* highest time warp allowed right now, and why */
function warpLimit() {
  const b = G.player; if (!b || b.dead) return [1, 'Nothing to warp'];
  let lim = WARPS[WARPS.length - 1], why = '';
  const cap = (n, w) => { if (n < lim) { lim = n; why = w; } };
  const mach = machineOf(b);
  // engines can fire under warp, but only coasting goes past ×100
  if (b.ctl.rocket > 0 || b.ctl.thr !== 0 || b.ctl.eng !== 0 || mach.some(o => o.rcsOn || o.burning)) cap(100, 'With engines firing, time warp tops out at ×100');
  for (const c of ORBITERS) {
    const alt = b.x.distanceTo(c.center) - c.R, lc = c.air ? c.air.top + 200 : c.maxH + 400;
    if (alt < lc) { cap(5, c.air ? `In ${c.name}'s air, time warp tops out at ×5` : `Close to ${c.name}, time warp tops out at ×5`); break; }
  }
  if (sunHeat(b.x) > 0) cap(10, `${celTitle(HOT)}'s heat zone limits warp to ×10`);
  if (b.x.distanceTo(MAW.center) < MAW.slowR) cap(10, 'Near the black hole, time warp tops out at ×10');
  // only out between the stars does warp go past ×10,000
  if (!inDeepSpace(b.x)) cap(10000, 'Time warp goes past ×10,000 only out between the stars');
  if (mach.some(o => o.dock && o.dock.carrier.radius > 300)) cap(25, 'Riding a skyhook limits warp to ×25');
  if (W.joints.length && mach.some(o => o.jointed)) cap(25, 'Moving parts limit warp to ×25');
  if (mach.some(o => o.wheels.some(w => w.contact && w.on))) cap(10, 'Wheels gripping a tower or another build limit warp to ×10');
  return [lim, why];
}
function changeWarp(dir) {
  let i = WARPS.indexOf(G.warp) + dir; i = clamp(i, 0, WARPS.length - 1);
  const [lim, why] = warpLimit();
  if (WARPS[i] > lim) { toast(why); while (i > 0 && WARPS[i] > lim) i--; }
  const was = G.warp; G.warp = WARPS[i];
  if (G.warp >= RAILS && was < RAILS) toast(`Time warp ×${G.warp.toLocaleString('en-US')}: coasting on rails. Throttle up to drop back to ×100`, 2600);
}
/* ---------------- rails: huge time warps move ships along their orbits through every world's gravity ---------------- */
const _rv1 = new V3(), _rq = new Quat(), _rax = new V3();
function railsBody(b, t0, T, stop) {
  let px = b.x.x, py = b.x.y, pz = b.x.z, vx = b.v.x, vy = b.v.y, vz = b.v.z, t = t0, n = 0, hit = -1;
  celPositions(t);
  let dtm = predAccel(px, py, pz, _pa);
  const tEnd = t0 + T;
  stop(px, py, pz);
  while (t < tEnd - 1e-6 && n < 4000) {
    // shorter steps as the stopping line gets close, so nobody overshoots into air or ground
    const sp = Math.hypot(vx, vy, vz) + 1;
    const dt = Math.min(clamp(dtm * 0.02, 0.05, 2000), Math.max(0.05, RAILM / (3 * sp)), tEnd - t);
    vx += _pa.x * dt * 0.5; vy += _pa.y * dt * 0.5; vz += _pa.z * dt * 0.5;
    px += vx * dt; py += vy * dt; pz += vz * dt; t += dt; n++;
    celPositions(t);
    dtm = predAccel(px, py, pz, _pa);
    vx += _pa.x * dt * 0.5; vy += _pa.y * dt * 0.5; vz += _pa.z * dt * 0.5;
    hit = stop(px, py, pz);
    if (hit >= 0) break;
  }
  return { t, px, py, pz, vx, vy, vz, hit, rel: hit >= 0 ? new V3(px - CPOS[hit * 3], py - CPOS[hit * 3 + 1], pz - CPOS[hit * 3 + 2]) : null };
}
/* which world (index into CELS) is this point too close to for rails? RAILM keeps the distance to the nearest line */
let RAILM = 1e9;
function railsStopWith(near, edges) {
  return (px, py, pz) => {
    RAILM = 1e9; let hit = -1;
    const deepWarp = edges && G.warp > 10000;
    for (let i = 0; i < NCEL; i++) {
      const c = CELS[i], k = i * 3, d = Math.hypot(px - CPOS[k], py - CPOS[k + 1], pz - CPOS[k + 2]);
      let m;
      if (c.kind === 'star') {
        // a star's heat zone (a black hole's tides); and under deep-space warp, the edge of its system
        m = d - (c.hole ? c.slowR : c.heatStart || c.R * 2);
        if (deepWarp && c.sysR) { const me = d - c.sysR; if (me < RAILM) RAILM = me; if (me < 0 && hit < 0) hit = i; }
      } else m = d - c.R - near(c);
      if (m < RAILM) RAILM = m;
      if (m < 0 && hit < 0) hit = i;
    }
    return hit;
  };
}
// the player stops where warp would drop anyway; everything else only stops at the ground or the clouds
const railsStop = railsStopWith(c => c.air ? c.air.top + 200 : c.maxH + 400, true), railsStopOther = railsStopWith(c => c.kind === 'gas' ? 0 : c.maxH + 20, false);
function railsAdvance(T) {
  const p = G.player, pm = new Set(machineOf(p)), t0 = W.time;
  // anything that needs real physics (near a world, jointed, on a cable) waits it out where it is
  const movers = [];
  for (const b of W.bodies) {
    if (b.dead || b.asleep || b.dock) continue;
    if (!pm.has(b) && (b.groundCel || b.airCel || b.seaCel || b.jointed || b.onTower)) { b.pin(b.groundCel || b.airCel || b.seaCel || dominantCel(b.x), true); W.frozen.push(b); continue; }
    movers.push(b);
  }
  // the player goes first and decides how far this frame can go
  movers.sort((a, b) => pm.has(b) - pm.has(a));
  let span = T;
  const late = [];
  for (const b of movers) {
    const r = railsBody(b, t0, span, pm.has(b) ? railsStop : railsStopOther);
    if (pm.has(b)) span = r.t - t0;
    b.x.set(r.px, r.py, r.pz); b.v.set(r.vx, r.vy, r.vz);
    const wl = b.w.length(); if (wl > 1e-6) { _rq.setFromAxisAngle(_rax.copy(b.w).divideScalar(wl), wl * (r.t - t0)); b.q.premultiply(_rq).normalize(); b.updR(); }
    if (!pm.has(b) && r.hit >= 0 && r.t < t0 + span - 1e-6) late.push([b, CELS[r.hit], r]);
  }
  W.time = t0 + span; updateCelestials(W.time);
  // bodies that reached a world early park beside it, still carrying their speed
  for (const [b, c, r] of late) {
    b.x.copy(c.center).add(r.rel);
    b.v.copy(c.vel).add(_rv1.set(r.vx, r.vy, r.vz).sub(c.vel));
    b.pin(c, true); W.frozen.push(b);
  }
  for (const b of W.bodies) {
    if (b.asleep && b.pinCel) b.pinUpdate();
    else if (b.dock) placeFollower(b, 0);
    b.age += span;
  }
}

/* ---------------- input ---------------- */
function K(c) { return KEYS.has(c); }
/* every frame: read the keys (and logic blocks) into each part of the machine you drive */
function driveControls(dt = 1 / 60) {
  const b = G.player;
  if (!b || b.dead) { IN.real = false; for (const o of G.live) if (!o.dead) clearInputs(o); G.live = []; return; }
  const live = !G.wrecked && !G.noSeat, mach = machineOf(b);
  // pieces that left the machine (dropped stages, broken joints) let go of the controls
  for (const o of G.live) if (!o.dead && !mach.includes(o)) clearInputs(o);
  G.live = mach;
  IN.real = live;
  // the throttle lever: full and off
  for (const c of actKeys('thr_full')) if (edgeOf(c)) { G.throttle = 1; G.fuelWarned = false; }
  for (const c of actKeys('thr_off')) if (edgeOf(c)) G.throttle = 0;
  // under warp, turning keeps its real-time feel
  const rs = 1 / Math.max(1, Math.min(G.warp, 100));
  for (const o of mach) o.ctl.rs = rs;
  applyInputs(mach, live && !BASES.mode, dt, dt * G.warp);
  if (live) {
    const jk = id => anyDown(actKeys(id)) ? 1 : 0;
    const hk = jk('hinge_a') - jk('hinge_b'), rk = jk('rotor_r') - jk('rotor_l'), pk = jk('piston_out') - jk('piston_in');
    if (hk || rk || pk) jointHint(mach, hk, rk, pk);
  }
  if (b.rockets.some(r => r.lvl > 0)) {
    const act = b.rockets.filter(r => !r.blocked && r.lvl > 0);
    if (!act.length) { if (!G.fuelWarned) { G.fuelWarned = true; toast(`Every engine has something attached under its nozzle. Press ${keyName(actKeys('stage')[0])} to drop a stage.`); } }
    else if (act.every(r => (r.g.tanks.reduce((s, t) => s + t.fuel, 0)) <= 0.01)) { if (!G.fuelWarned) { G.fuelWarned = true; toast(b.parts.some(p => p.def.kind === 'decoupler') ? `This stage is out of fuel. Press ${keyName(actKeys('stage')[0])} to drop it.` : 'Out of fuel'); } }
    else G.fuelWarned = false;
  }
}
const _dv = new V3(), _dv2 = new V3();
/* pressing a joint key with nothing that can move: say why, once in a while */
let jointHintT = 0;
function jointHint(mach, hk, rk, pk) {
  const want = pk ? 'piston' : hk ? 'hinge' : rk ? 'rotor' : null;
  if (!want || performance.now() < jointHintT) return;
  const works = W.joints.some(j => j.type === want && j.jp.alive && mach.includes(j.jp.body) && jointBodies(j));
  if (works) return;
  const has = mach.some(o => o.parts.some(p => p.def.joint && p.def.joint.type === want));
  jointHintT = performance.now() + 4000;
  if (has || !mach.some(o => o.parts.some(p => p.def.kind === 'logic'))) toast(has ? `This ${want} can't move: what's on its top face also touches the rest of the vehicle. Open the builder (${keyName(actKeys('build')[0])}): the stuck part glows red.` : `No ${want}s on this vehicle`, 4200);
}
function onAnchored(b, on) {
  const p = G.player; if (!on || !p || p.dead || !b.fam || b.fam !== p.fam) return;
  const mach = machineOf(p), climber = mach.some(o => o.wheels.length), stg = keyName(actKeys('stage')[0]), fwd = keyName(actKeys('fwd')[0]), back = keyName(actKeys('back')[0]);
  if (b === p) toast(climber && p.parts.some(q => q.def.kind === 'decoupler') ? `Anchored to the ground. ${stg} lets the climber go, then hold ${fwd} to climb` : `Anchored to the ground. ${keyName(actKeys('undock')[0])} lets go`, 4600);
  else if (climber && !mach.includes(b)) toast(`Climber released. Hold ${fwd} to climb, ${back} to come back down. Let go of the keys and it holds on`, 4600);
}
/* parts that nothing aboard answers to: say so */
const PART_KEYS = [['chute', ['chute'], 'No parachutes aboard'], ['gear', ['gear'], 'No landing gear aboard'], ['grab', ['claw', 'winch', 'magnet'], 'No claws, winches or magnets aboard'], ['fire', ['gun', 'drill'], 'No weapons or drills aboard'], ['undock', ['dock', 'grapple', 'anchor', 'coupler'], 'Not docked'], ['lights', ['lightbar'], 'No light bar aboard']];
function onKey(code, e) {
  const shift = !!(e && e.shiftKey);
  // Shift pressed after the key: count it as the Shift+ key
  if (code === 'ShiftLeft' || code === 'ShiftRight') { for (const k of IN.shifted) if (KEYS.has(k)) onKey(k, { shiftKey: true }); return; }
  const A = id => isAct(id, code, shift);
  if (BASES.mode) {
    if (A('build')) { exitBaseMode(); return; }
    if (isAct('b_rot', code, shift)) { baseTurn(); return; }
    if (A('map')) exitBaseMode(); else return;
  }
  if (A('build')) {
    if (G.mode === 'build') setMode('drive');
    else { if (B.pasting) cancelPaste(); setMode('build'); }
    return;
  }
  if (G.mode === 'build') { builderKey(code, e, shift); return; }
  const ok = G.player && !G.player.dead && !G.wrecked && !G.noSeat;
  if (A('respawn')) { if (spawnPlayer(true)) toast('Respawned', 1000); return; }
  if (A('sas')) { if (ok) toggleSAS(); return; }
  if (A('rcs')) {
    if (!ok) return;
    if (!machineOf(G.player).some(o => o.rcsN > 0)) { G.rcsMode = false; toast('No RCS blocks aboard. Add RCS Blocks to slide around with the steering keys.', 2600); return; }
    G.rcsMode = !G.rcsMode; toast(G.rcsMode ? `RCS translate on: ${keyName(actKeys('pitch_dn')[0])} ${keyName(actKeys('pitch_up')[0])} forward and back, ${keyName(actKeys('left')[0])} ${keyName(actKeys('right')[0])} sideways` : 'RCS translate off', 1800); return;
  }
  if (A('flip')) { flipUpright(); return; }
  if (A('camera')) { G.chase = !G.chase; toast(G.chase ? 'Chase camera' : 'Free camera', 1100); return; }
  if (A('map')) { setMapVisible(!G.map); return; }
  if (A('warp_up')) { changeWarp(1); return; }
  if (A('warp_dn')) { changeWarp(-1); return; }
  if (A('keys')) { toggleKeys(); return; }
  if (A('map_out')) { if (G.map) G.mapZoom = clamp(G.mapZoom * 1.8, 0.15, 4000); return; }
  if (A('map_in')) { if (G.map) G.mapZoom = clamp(G.mapZoom / 1.8, 0.15, 4000); return; }
  if (ok) {
    const mach = machineOf(G.player);
    for (const [id, kinds, msg] of PART_KEYS) if (A(id) && !mach.some(o => o.parts.some(p => kinds.includes(p.def.kind)))) toast(msg, 1400);
    if (A('stage') && !mach.some(o => o.parts.some(p => p.def.kind === 'decoupler'))) toast('No decouplers on this vehicle', 1600);
  }
}
const GAMEKEYS = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace']);
function bindInput() {
  window.addEventListener('keydown', e => {
    SND.unlock();
    if (captureKeydown(e)) return;
    if (!$('title').hidden && titleKey(e)) return;
    if (e.key === 'Escape' && $('modalWrap').hidden && G.mode === 'drive' && !BASES.mode && !(e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) { e.preventDefault(); openMenu(); return; }
    const tg = e.target;
    if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT')) { if (e.key === 'Escape' || e.key === 'Enter') tg.blur(); return; }
    if (!$('modalWrap').hidden) { if (e.key === 'Escape') closeModal(); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && G.mode === 'build') {
      const k = e.code, run = f => { e.preventDefault(); f(); };
      if (k === 'KeyZ') return run(() => e.shiftKey ? bRedo() : bUndo());
      if (k === 'KeyY') return run(bRedo);
      if (k === 'KeyC' || k === 'KeyD') return run(bCopySel);
      if (k === 'KeyV') return run(bPasteMode);
      if (k === 'KeyX') return run(bMoveSel);
      if (k === 'KeyA') return run(bSelectAll);
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (GAMEKEYS.has(e.code) || (G.mode === 'build' && e.code === 'Delete')) e.preventDefault();
    if (!e.repeat) onKey(e.code, e);
    else if (G.mode === 'build' && /^Arrow/.test(e.code) && B.selSet.size && !B.pasting) onKey(e.code, e);
    KEYS.add(e.code); if (G.mode === 'drive' && !e.repeat) TAPS.add(e.code);
  });
  window.addEventListener('keyup', e => KEYS.delete(e.code));
  window.addEventListener('blur', () => KEYS.clear());
  const cv = $('view'), PTR = { down: false, btn: 0, x0: 0, y0: 0, x: 0, y: 0, dragged: false, pan: false, multi: false, box: false, shift: false };
  const TOUCH = new Map(); let pinch = null;
  const twoFinger = () => { const [a, b] = [...TOUCH.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };
  const box = $('selBox');
  const showBox = (x1, y1) => { box.hidden = false; box.style.left = Math.min(PTR.x0, x1) + 'px'; box.style.top = Math.min(PTR.y0, y1) + 'px'; box.style.width = Math.abs(x1 - PTR.x0) + 'px'; box.style.height = Math.abs(y1 - PTR.y0) + 'px'; };
  cv.addEventListener('pointerdown', e => {
    SND.unlock();
    TOUCH.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { cv.setPointerCapture(e.pointerId); } catch (err) { }
    if (TOUCH.size >= 2) { PTR.multi = true; PTR.dragged = true; PTR.box = false; box.hidden = true; pinch = twoFinger(); return; }
    cv.focus(); PTR.down = true; PTR.btn = e.button; PTR.x0 = PTR.x = e.clientX; PTR.y0 = PTR.y = e.clientY; PTR.dragged = false; PTR.multi = false; PTR.shift = e.shiftKey;
    // Select tool: a left drag draws a box. Otherwise a left or right drag turns the camera; middle or Shift drag slides it
    PTR.box = G.mode === 'build' && B.tool === 'select' && e.button === 0 && !B.pasting;
    PTR.pan = e.button === 1 || (e.shiftKey && !PTR.box);
    setNdc(e);
    // in drive mode a click is the Mouse0 key: a quick click fires once, holding without dragging keeps it down
    clearTimeout(PTR.fireT);
    if (G.mode === 'drive' && e.button === 0 && !G.map && !BASES.mode) PTR.fireT = setTimeout(() => { if (PTR.down && !PTR.dragged && !PTR.multi) KEYS.add('Mouse0'); }, 150);
  });
  const setNdc = e => { const r = cv.getBoundingClientRect(); B.ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); B.hoverOK = true; };
  cv.addEventListener('pointermove', e => {
    if (TOUCH.has(e.pointerId)) TOUCH.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (TOUCH.size >= 2 && pinch) {
      // two fingers: slide the build view and pinch to zoom
      const now = twoFinger();
      if (G.mode === 'build') {
        bPan(now.x - pinch.x, now.y - pinch.y);
        if (pinch.d > 10 && now.d > 10) B.cam.dist = clamp(B.cam.dist * pinch.d / now.d, 2.5, Math.max(120, (B.size || 0) * 2));
      } else if (G.map) {
        // on the map: two fingers move it and pinch zooms
        mapPan(now.x - pinch.x, now.y - pinch.y);
        if (pinch.d > 10 && now.d > 10) G.mapZoom = clamp(G.mapZoom * pinch.d / now.d, 0.15, 4000);
      } else if (pinch.d > 10 && now.d > 10) DC.dist = clamp(DC.dist * pinch.d / now.d, 3, 600);
      pinch = now; return;
    }
    if (PTR.multi) return;
    setNdc(e);
    if (PTR.down) {
      const dx = e.clientX - PTR.x, dy = e.clientY - PTR.y; PTR.x = e.clientX; PTR.y = e.clientY;
      if (!PTR.dragged && Math.hypot(e.clientX - PTR.x0, e.clientY - PTR.y0) > 5) { PTR.dragged = true; KEYS.delete('Mouse0'); }
      if (PTR.dragged) { if (PTR.box) showBox(e.clientX, e.clientY); else if (PTR.pan && G.mode === 'build') bPan(dx, dy); else if (PTR.pan && G.map) mapPan(dx, dy); else orbitDrag(dx, dy); }
    } else B.needsHover = true;
    if (BASES.mode && !PTR.down) { BASES.lastXY = [e.clientX, e.clientY]; if (performance.now() - (BASES.hoverT || 0) > 60) { BASES.hoverT = performance.now(); baseHover(e.clientX, e.clientY); } }
  });
  const lift = e => {
    TOUCH.delete(e.pointerId);
    if (TOUCH.size < 2) pinch = null;
    if (PTR.multi) { if (!TOUCH.size) { PTR.multi = false; PTR.down = false; } return true; }
    return false;
  };
  cv.addEventListener('pointerup', e => {
    if (lift(e)) return;
    if (!PTR.down) return; PTR.down = false;
    const held = KEYS.has('Mouse0'); clearTimeout(PTR.fireT); KEYS.delete('Mouse0');
    if (PTR.box && PTR.dragged) { box.hidden = true; bBoxSelect(PTR.x0, PTR.y0, e.clientX, e.clientY, PTR.shift); }
    else if (!PTR.dragged && G.mode === 'build') { bHover(); bClick(PTR.btn, PTR.shift); }
    else if (!PTR.dragged && BASES.mode) baseClick(e.clientX, e.clientY, PTR.btn);
    else if (!PTR.dragged && G.map && PTR.btn === 0) mapClick(e.clientX, e.clientY);
    else if (!PTR.dragged && !held && G.mode === 'drive' && PTR.btn === 0 && !G.map) TAPS.add('Mouse0');
    PTR.box = false; box.hidden = true;
    DC.dragging = false; DC.lastDrag = performance.now(); B.needsHover = true;
  });
  cv.addEventListener('pointercancel', e => { lift(e); PTR.down = false; PTR.box = false; box.hidden = true; DC.dragging = false; clearTimeout(PTR.fireT); KEYS.delete('Mouse0'); });
  cv.addEventListener('pointerleave', () => { if (!PTR.down) { B.hoverOK = false; B.needsHover = true; } });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const f = Math.exp(clamp(e.deltaY, -200, 200) * 0.0012);
    if (G.mode === 'build') { B.cam.dist = clamp(B.cam.dist * f, 2.5, Math.max(120, (B.size || 0) * 2)); B.needsHover = true; }
    else if (G.map) G.mapZoom = clamp(G.mapZoom * Math.exp(clamp(e.deltaY, -200, 200) * 0.0016), 0.15, 4000);
    else DC.dist = clamp(DC.dist * f, 3, 600);
  }, { passive: false });
  document.addEventListener('visibilitychange', () => { if (SND.ctx) { if (document.hidden) SND.ctx.suspend().catch(() => { }); else if (SND.ok) SND.ctx.resume().catch(() => { }); } });
}
function orbitDrag(dx, dy) {
  if (G.mode === 'build') { B.cam.yaw -= dx * 0.006; B.cam.pitch = clamp(B.cam.pitch + dy * 0.005, -0.25, 1.5); B.needsHover = true; }
  else if (G.map) { G.mapYaw -= dx * 0.005; G.mapPitch = clamp(G.mapPitch + dy * 0.005, -1.45, 1.45); }
  else { DC.yaw -= dx * 0.006; DC.pitch = clamp(DC.pitch + dy * 0.005, -0.35, 1.45); DC.dragging = true; }
}

/* ---------------- cameras ---------------- */
const _cf = new V3(), _cu = new V3(), _ce = new V3(), _cv = new V3(), _co = new V3(), _ct = new V3();
const lastFocus = new V3();
/* where the pilot sits: a tower's centre of mass is kilometres up, so big builds follow the seat */
const _ppos = new V3();
function pilotPos(b, out = _ppos) {
  if (b.radius > 60 && b.seat && b.seat.alive) return b.toWorld(b.seat.cen[0], b.seat.cen[1], b.seat.cen[2], out);
  return out.copy(b.x);
}
function driveCamera(dt) {
  const b = G.player;
  if (b && !b.dead) lastFocus.copy(pilotPos(b));
  const focus = _cf.copy(lastFocus);
  const cel = dominantCel(focus);
  const up = _cu.subVectors(focus, cel.center).normalize();
  // near a world the view turns with it, so the ground doesn't slide around under a still camera
  const simDt = W.time - (DC.t === undefined ? W.time : DC.t); DC.t = W.time;
  if (simDt > 0 && cel.spinW && focus.distanceTo(cel.center) - cel.R < spaceAlt(cel) + 3000) DC.ref.applyAxisAngle(cel.spinAxis, cel.spinW * Math.min(simDt, 60));
  DC.ref.addScaledVector(up, -DC.ref.dot(up));
  if (DC.ref.lengthSq() < 1e-6) tangentBasis(up.x, up.y, up.z, DC.ref, _ct);
  DC.ref.normalize();
  const E = _ce.crossVectors(up, DC.ref).normalize();
  if (b && !b.dead && G.chase && !DC.dragging && performance.now() - DC.lastDrag > 1200) {
    b.dirW(0, 0, 1, _cv); _cv.addScaledVector(up, -_cv.dot(up));
    const vrel = _ct.subVectors(b.v, surfaceVel(cel, b.x, _ct)); vrel.addScaledVector(up, -vrel.dot(up));
    if (vrel.lengthSq() > 9 && vrel.dot(_cv) < 0 && b.wheels.length) { /* reversing: keep heading */ }
    const climbing = (b.anchored && b.wheels.length) || machineOf(b).some(o => o.onTower);
    if (_cv.lengthSq() > 0.04) { const des = Math.atan2(_cv.dot(E), _cv.dot(DC.ref)) + (climbing ? 1.25 : 0); DC.yaw = lerpAngle(DC.yaw, des, 1 - Math.exp(-dt * 2.2)); }
  }
  const cp = Math.cos(DC.pitch), sp = Math.sin(DC.pitch), cy = Math.cos(DC.yaw), sy = Math.sin(DC.yaw);
  const off = _co.copy(DC.ref).multiplyScalar(-cy * cp).addScaledVector(E, -sy * cp).addScaledVector(up, sp).multiplyScalar(DC.dist);
  camera.position.copy(focus).add(off);
  const cr = _cv.subVectors(camera.position, cel.center), crl = cr.length(); cr.divideScalar(crl);
  let gh = cel.height ? cel.R + cel.height(cr.x, cr.y, cr.z) + 1.0 : 0;
  if (cel.sea && focus.distanceTo(cel.center) > cel.R + 0.5) gh = Math.max(gh, cel.R + 0.6);
  if (crl < gh) camera.position.copy(cel.center).addScaledVector(cr, gh);
  camBlock(cel, focus);
  if (G.shake > 0.01) { const s = G.shake * 0.45; camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; camera.position.z += (Math.random() - 0.5) * s; }
  camera.up.copy(up); camera.lookAt(focus);
}
/* keep the chase camera on the near side of walls, roofs and the ground over tunnels: if something solid lies between
   the vehicle and the camera, the camera comes in to just short of it */
const _cbA = new V3(), _cbB = new V3();
function camBlock(cel, focus) {
  const dist = camera.position.distanceTo(focus); if (dist < 1 || dist > 140 || !cel.spinQ) return;
  toSpin(cel, _cbA.subVectors(focus, cel.center), _cbA); toSpin(cel, _cbB.subVectors(camera.position, cel.center), _cbB);
  const dx = _cbB.x - _cbA.x, dy = _cbB.y - _cbA.y, dz = _cbB.z - _cbA.z;
  let best = 1;
  pgQuery(cel, _cbA.clone().lerp(_cbB, 0.5), dist / 2 + 2, pr => {
    if (!pr.planes || pr.loose) return;
    let t0 = 0, t1 = 1, inside0 = true;
    for (const p of pr.planes) {
      const den = p.nx * dx + p.ny * dy + p.nz * dz, num = p.d - (p.nx * _cbA.x + p.ny * _cbA.y + p.nz * _cbA.z);
      if (num < 0) inside0 = false;
      if (Math.abs(den) < 1e-9) { if (num < 0) return; continue; }
      const t = num / den;
      if (den > 0) { if (t < t1) t1 = t; } else if (t > t0) t0 = t;
      if (t0 > t1) return;
    }
    if (inside0 || t0 <= 0) return;   // the vehicle itself is in or on it
    if (t0 < best) best = t0;
  });
  if (best < 1) camera.position.lerp(focus, 1 - Math.max(0.05, best - 0.6 / dist));
}
const _mf = new V3(), _mfT = new V3(), _mR = new V3(), _mU = new V3();
function mapBase(cel, b) {
  if (cel.kind === 'star' && !cel.parent) return b ? Math.max(cel === SUN ? 4e6 : 3e6, b.x.distanceTo(cel.center) * 1.6) : cel.sysR || 6e7;
  if (cel.kind === 'star') return cel.R * 9;
  return cel.R * (cel.parent.kind === 'star' ? 6.2 : 7.3);
}
/* what the map is looking at: something you clicked, else the world you are at. Zooming only moves the camera in and out:
   the view stays on it (it no longer slides over to the Sun) */
function mapFocusObj() {
  const f = MAP.focus;
  if (f && f.body && !f.body.dead) return f;
  if (f && f.cel) return f;
  const b = G.player && !G.player.dead ? G.player : null;
  return { cel: b ? dominantCel(b.x) : PLANET, home: true };
}
function mapFocusName(f = mapFocusObj()) { return f.body ? (f.body === G.player ? 'Your vehicle' : f.body.name) : f.cel.name; }
function mapFocusPos(out) {
  const f = mapFocusObj(), b = G.player && !G.player.dead ? G.player : null;
  if (f.body) { out.copy(f.body.x); return Math.max(400, f.body.radius * 30); }
  out.copy(f.cel.center);
  return mapBase(f.cel, b && dominantCel(b.x) === f.cel ? b : null);
}
function mapSetFocus(obj) {
  MAP.tr = { t: 0, f0: (MAP.lastF || camera.position).clone(), d0: MAP.lastD || 1e5 };
  MAP.focus = obj; MAP.pan.set(0, 0, 0); G.mapZoom = 1;
  renderMapBar();
}
function mapCamera(dt = 0.016) {
  const d1 = mapFocusPos(_mfT) * G.mapZoom;
  _mfT.add(MAP.pan);
  const f = _mf.copy(_mfT); let d = d1;
  // a short glide to a newly picked focus
  if (MAP.tr) {
    const tr = MAP.tr; tr.t = Math.min(1, tr.t + dt / 0.7); const e = tr.t * tr.t * (3 - 2 * tr.t);
    f.copy(tr.f0).lerp(_mfT, e); d = Math.exp(lerp(Math.log(tr.d0), Math.log(d1), e));
    if (tr.t >= 1) MAP.tr = null;
  }
  (MAP.lastF || (MAP.lastF = new V3())).copy(f); MAP.lastD = d;
  const cp = Math.cos(G.mapPitch);
  camera.position.copy(f)
    .addScaledVector(SOLAR.e2, Math.sin(G.mapYaw) * cp * d)
    .addScaledVector(SOLAR.n, Math.sin(G.mapPitch) * d)
    .addScaledVector(SOLAR.e1, Math.cos(G.mapYaw) * cp * d);
  camera.up.copy(SOLAR.n);
  camera.lookAt(f);
  const b = G.player && !G.player.dead ? G.player : null;
  if (b) MAP.marker.position.copy(b.x);
  // zoomed right out, the view reaches across the galaxy
  const far = Math.max(1e9, d * 8);
  if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
}
/* slide the map sideways (Shift+drag, middle drag, or two fingers) */
function mapPan(dx, dy) {
  camera.updateMatrixWorld();
  _mR.setFromMatrixColumn(camera.matrixWorld, 0); _mU.setFromMatrixColumn(camera.matrixWorld, 1);
  const k = (MAP.lastD || 1e5) * 2 * Math.tan(camera.fov * Math.PI / 360) / window.innerHeight;
  MAP.pan.addScaledVector(_mR, -dx * k).addScaledVector(_mU, dy * k);
  renderMapBar();
}
/* what is under a click on the map: a label, a dot, or a world's disc */
function mapPick(x, y) {
  let best = null, bd = 1e9;
  for (const p of MAP.pick || []) {
    if (!p.obj) continue;
    let d = Math.hypot(p.x - x, p.y - y);
    if (p.el && !p.el.hidden) { const r = p.el.getBoundingClientRect(); if (x >= r.left - 3 && x <= r.right + 3 && y >= r.top - 3 && y <= r.bottom + 3) d = Math.min(d, 2); }
    if (d < 30 && d < bd) { bd = d; best = p; }
  }
  if (best) return best;
  // a world big on screen: anywhere on its disc
  const h = window.innerHeight, f = h / 2 / Math.tan(camera.fov * Math.PI / 360);
  let cd = Infinity;
  for (const c of CELS) {
    const sp = screenOf(c.center, window.innerWidth, h); if (!sp) continue;
    const dist = camera.position.distanceTo(c.center), rp = c.R / dist * f;
    if (rp > 8 && Math.hypot(sp.x - x, sp.y - y) < rp && dist < cd) { cd = dist; best = { obj: { cel: c }, key: c.name }; }
  }
  return best;
}
/* one click (or tap) focuses on it; a second one straight after makes it the target */
function mapClick(x, y) {
  const now = performance.now(), lc = MAP.lastClick;
  if (lc && now - lc.t < 450 && Math.hypot(lc.x - x, lc.y - y) < 24) { MAP.lastClick = null; setTarget(lc.obj); return; }
  const hit = mapPick(x, y);
  MAP.lastClick = hit ? { t: now, x, y, obj: hit.obj } : null;
  if (hit) mapSetFocus(hit.obj);
}
/* the target: what SAS Target mode points at, and what the map and the orbit panel measure to */
function setTarget(obj) {
  const b = G.player && !G.player.dead ? G.player : null;
  if (!obj) { SAS.target = null; if (SAS.mode === 'target') SAS.mode = 'hold'; toast('Target cleared', 1200); }
  else if (obj.body) {
    if (b && machineOf(b).includes(obj.body)) { toast("That's your own vehicle: pick something else to target", 2000); return; }
    SAS.target = { body: obj.body, name: obj.body.name }; toast(`Target: ${obj.body.name}`, 1400);
  } else { SAS.target = { cel: obj.cel, name: celCall(obj.cel) }; toast(`Target: ${celTitle(obj.cel)}`, 1400); }
  G.predT = 0;
  SND.play('beep'); renderSAS(); renderMapBar();
}
/* the strip at the top of the map: what it is centred on, the target, and how to move about */
function renderMapBar() {
  const el = $('mapBar'); if (!el) return;
  el.hidden = !G.map; if (!G.map) return;
  const f = mapFocusObj(), b = G.player && !G.player.dead ? G.player : null;
  const t = SAS.target && sasTargetPos() ? SAS.target : null;
  const homeCel = b ? dominantCel(b.x) : PLANET;
  const panned = MAP.pan.lengthSq() > 1;
  el.innerHTML = `<div class="mbrow"><span class="lab">Focus</span><b>${esc(mapFocusName(f))}</b>`
    + (b && f.body !== b ? `<button type="button" class="btn" data-mb="me">Your vehicle</button>` : '')
    + (!f.home || panned ? `<button type="button" class="btn" data-mb="home">${esc(homeCel.name)}</button>` : '')
    + `</div><div class="mbrow"><span class="lab">Target</span><b class="tg">${t ? esc(t.body ? t.name : celTitle(t.cel)) : 'none'}</b>`
    + (t ? `<button type="button" class="btn" data-mb="clear">Clear</button>` : `<button type="button" class="btn" data-mb="pick">Pick</button>`)
    + `</div><div class="mbhint">${COARSE ? 'Tap to focus · double-tap to target · two fingers to move' : 'Click to focus · double-click to target · Shift+drag to move'}</div>`;
}
function nearFar() { if (camera.far !== 1e9) { camera.far = 1e9; camera.updateProjectionMatrix(); } }

/* ---------------- HUD ---------------- */
/* the key list shows only what this vehicle can use, with your own key settings */
function toggleKeys() { G.keysMin = !G.keysMin; $('keys').classList.toggle('min', G.keysMin); }
function renderKeys() {
  const kinds = new Set(), custom = [], seen = new Set();
  if (G.player && !G.player.dead) for (const o of machineOf(G.player)) for (const p of o.parts) {
    kinds.add(p.def.kind); if (p.def.joint) kinds.add('j_' + p.def.joint.type);
    if (!p.cfg || p.def.kind === 'logic') continue;
    const sc = cfgSchema(p.def); if (!sc) continue;
    for (const f of sc) { const v = p.cfg[f.id]; if (f.type !== 'key' || !v || seen.has(v + f.label + p.t)) continue; seen.add(v + f.label + p.t); custom.push([kbd(v), `${p.def.name}: ${f.label.toLowerCase()}`]); }
  }
  const has = (...k) => k.some(x => kinds.has(x)), K1 = id => kbd(actKeys(id)[0] || ''), K2 = (a, b) => K1(a) + K1(b);
  const rows = [];
  if (has('wheel', 'prop', 'jet', 'boatprop')) rows.push([K1('fwd'), 'Drive forward, thrust']);
  if (has('wheel', 'gear', 'boatprop')) rows.push([K1('back'), 'Brake, hold to reverse']);
  if (has('flap', 'gyro', 'rcs')) rows.push([K2('pitch_dn', 'pitch_up'), 'Nose down, up'], [K2('roll_l', 'roll_r'), 'Roll']);
  rows.push([K2('left', 'right'), 'Steer and yaw']);
  if (has('rocket', 'jet', 'prop', 'boatprop')) rows.push([K2('thr_full', 'thr_off'), 'Throttle lever full, off']);
  const mparts = G.player && !G.player.dead ? machineOf(G.player).flatMap(o => o.parts) : [];
  if (mparts.some(p => p.def.heli)) rows.push([K2('fwd', 'descend'), 'Helicopter climb, sink (let go to hover)']);
  if (mparts.some(p => p.def.ab)) rows.push([K1('boost'), 'Afterburner']);
  if (has('gun')) rows.push([kbd(actKeys('fire')[0] || '') + kbd(actKeys('fire')[1] || ''), 'Fire weapons']);
  if (has('drill')) rows.push([kbd(actKeys('fire')[0] || '') + kbd(actKeys('fire')[1] || ''), 'Spin the drill']);
  if (mparts.some(p => p.def.detacher)) rows.push([K1('detach'), 'Detachers let go']);
  if (mparts.some(p => p.def.joint && p.def.joint.spinner)) rows.push([K1('spin'), 'Spinners on, off']);
  if (has('lightbar')) rows.push([K1('lights'), 'Light bar on, off']);
  if (has('coupler')) rows.push([K1('undock'), 'Uncouple']);
  if (has('magnet')) rows.push([K1('grab'), 'Magnet on, let go']);
  if (has('horn')) rows.push([K1('horn'), 'Horn']);
  if (mparts.some(p => p.def.kind === 'decoupler' && !p.def.detacher)) rows.push([K1('stage'), 'Separate stage']);
  if (has('gyro', 'rcs', 'flap')) rows.push([K1('sas'), 'SAS: hold or point the craft']);
  if (has('rcs')) rows.push([K1('rcs'), 'RCS translate mode']);
  if (has('j_hinge')) rows.push([K2('hinge_a', 'hinge_b'), 'Swing hinges']);
  if (mparts.some(p => p.def.joint && p.def.joint.type === 'rotor' && !p.def.joint.spinner && !p.def.joint.servo)) rows.push([K2('rotor_l', 'rotor_r'), 'Turn rotors']);
  if (has('j_piston')) rows.push([K2('piston_out', 'piston_in'), 'Extend, retract pistons']);
  if (has('winch')) rows.push([K2('winch_in', 'winch_out'), 'Winch in, out']);
  if (has('claw', 'winch')) rows.push([K1('grab'), 'Grab, let go']);
  if (has('dock', 'grapple')) rows.push([K1('undock'), 'Undock, let go of a skyhook']);
  else if (has('anchor')) rows.push([K1('undock'), 'Ground anchor let go, re-arm']);
  if (has('chute')) rows.push([K1('chute'), 'Parachute open, cut']);
  if (has('gear')) rows.push([K1('gear'), 'Landing gear up, down']);
  rows.push(...custom.slice(0, 8));
  rows.push([K1('flip'), 'Flip upright'], [K1('respawn'), 'Respawn'], [K2('camera', 'map'), 'Camera mode, map'], [K2('warp_dn', 'warp_up'), 'Time warp'], [K1('keys'), 'Hide this list'], [K1('build'), 'Back to build (clears this vehicle)']);
  // folded away (after the first drive) it is one line saying how to bring it back
  $('keys').innerHTML = rows.map(r => `<span>${r[0]}</span><span>${r[1]}</span>`).join('') + `<span class="kmin">${K1('keys')}</span><span class="kmin">Show the keys</span>`;
}
/* SAS buttons under the gauges */
const SAS_SHORT = { hold: 'Hold', pro: 'Pro', retro: 'Retro', norm: 'Norm', anti: 'Anti', rout: 'Rad +', rin: 'Rad −', target: 'Target', level: 'Level' };
const _tgv = new V3(), _tgv2 = new V3(), _rk1 = new V3(), _rk2 = new V3();
function renderSAS() {
  const el = $('sasRow'), b = G.player;
  const can = G.mode === 'drive' && b && !b.dead && machineOf(b).some(sasCapable);
  el.hidden = !can; if (!can) return;
  const tn = SAS.mode === 'target' && SAS.target ? ` · ${esc(SAS.target.name)}` : '';
  el.innerHTML = `<button type="button" class="sasbtn main${SAS.on ? ' on' : ''}" data-sas="toggle" title="SAS on, off (${esc(keyName(actKeys('sas')[0]))})">SAS ${SAS.on ? 'on' : 'off'}${SAS.on ? tn : ''}</button>`
    + SAS_MODES.filter(([m]) => SAS.space || !ORBIT_ONLY.has(m) || (SAS.on && SAS.mode === m))
      .map(([m, nm]) => `<button type="button" class="sasbtn${SAS.on && SAS.mode === m ? ' on' : ''}" data-sas="${m}" title="${nm}">${SAS_SHORT[m]}</button>`).join('');
}
/* normal, anti-normal and radial only mean something in orbit: down in the air the row is just hold, pro, retro, target and level */
const ORBIT_ONLY = new Set(['norm', 'anti', 'rout', 'rin']);
function openTargetPicker(forSAS) {
  const b = G.player; if (!b || b.dead) return;
  const mine = new Set(machineOf(b));
  const veh = vehicleList().filter(v => !mine.has(v));
  const d = p => fmtDist(Math.max(0, b.x.distanceTo(p)));
  const rows = [...veh.map((v, i) => `<div class="mrow"><div class="grow"><span class="nm">${esc(v.name)}</span><span class="meta">${d(v.x)} away</span></div><button type="button" class="btn primary" data-v="${i}">Target</button></div>`),
    // worlds nearest first
    ...CELS.map((c, i) => [c, i]).sort((A, B) => b.x.distanceTo(A[0].center) - b.x.distanceTo(B[0].center))
      .map(([c, i]) => `<div class="mrow"><div class="grow"><span class="nm">${esc(celTitle(c))}</span><span class="meta">${d(c.center)} to its centre</span></div><button type="button" class="btn" data-c="${i}">Target</button></div>`)].join('');
  const cur = SAS.target && sasTargetPos() ? `<div class="mrow"><div class="grow"><span class="nm">Now: ${esc(SAS.target.body ? SAS.target.name : celTitle(SAS.target.cel))}</span><span class="meta">the pink ring on the map</span></div><button type="button" class="btn danger" data-clear="1">Clear target</button></div>` : '';
  openModal(`<h2>Pick a target</h2><p>The orbit panel and the map measure to your target, and SAS Target mode points the craft at it. On the map you can also double-${COARSE ? 'tap' : 'click'} something to target it.</p>${cur}<div class="mlist">${rows}</div><div class="mfoot"><button type="button" class="btn" data-close="1">Close</button></div>`);
  $('modal').onclick = e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.close) return closeModal();
    if (t.dataset.clear) { closeModal(); setTarget(null); return; }
    if (t.dataset.v !== undefined) setTarget({ body: veh[+t.dataset.v] });
    if (t.dataset.c !== undefined) setTarget({ cel: CELS[+t.dataset.c] });
    closeModal();
    if (forSAS && sasTargetPos()) setSASMode('target');
  };
}
/* spotlights: two real lights follow the player's lamps when it gets dark */
function initLights() {
  LIGHTS.spots = [0, 1].map(() => { const l = new THREE.SpotLight(0xfff1d6, 0, 120, 0.42, 0.55, 1); scene.add(l, l.target); return l; });
}
function updateLights() {
  const st = sky.state;
  LIGHTS.on = sunLight.intensity < 0.4 || !!st.inSea || st.deep > 0.3;
  const spots = [];
  if (G.mode === 'drive' && G.player && !G.player.dead) for (const o of machineOf(G.player)) for (const sp of o.spots) if (sp.p.alive) spots.push([o, sp]);
  for (let i = 0; i < 2; i++) {
    const L = LIGHTS.spots[i], e = spots[i];
    if (!e || !LIGHTS.on) { L.intensity = 0; continue; }
    const [o, sp] = e;
    o.toWorld(sp.pos.x, sp.pos.y, sp.pos.z, L.position); o.dirW(sp.dir.x, sp.dir.y, sp.dir.z, _lt);
    L.target.position.copy(L.position).addScaledVector(_lt, 12); L.intensity = 2.4;
  }
}
const _lt = new V3(), _wh = new THREE.Color(0xffffff);
function setBar(id, frac, text, show = true) {
  const el = $(id); el.hidden = !show; if (!show) return;
  el.querySelector('i').style.width = clamp(frac * 100, 0, 100) + '%'; el.querySelector('b').textContent = text;
}
const _hv = new V3(), _hu = new V3(), _hs = new V3();
function altLabel(cel, alt) {
  if (cel === PLANET) return alt < -1 ? 'below sea' : 'above sea';
  if (cel.kind === 'gas') return alt < 0 ? `inside ${cel.name}'s clouds` : `above ${cel.name}'s clouds`;
  if (cel.kind === 'star') return cel.hole ? `from ${cel.name}` : `above ${celCall(cel)}`;
  if (cel.sea && alt < -1) return `below ${cel.name}'s ${cel.sea.lava ? 'lava' : 'sea'}`;
  return `above ${cel.name}`;
}
function updateHUD() {
  const b = G.player;
  if (!b || b.dead) return;
  const cel = dominantCel(b.x), pp = pilotPos(b);
  _hu.subVectors(pp, cel.center); const r = _hu.length(); _hu.divideScalar(r);
  // low down, speed is over the turning ground; out in space, it's orbital speed
  const low = r - cel.R < spaceAlt(cel) || b.anchored || machineOf(b).some(o => o.onTower);
  b.velAt(pp, _hv).sub(low ? surfaceVel(cel, pp, _hs) : cel.vel);
  const spd = _hv.length(), vs = _hv.dot(_hu);
  // on a world with no sea, low down the height is over the ground beneath (its craters dip below the mean radius)
  let alt = r - cel.R;
  if (cel !== PLANET && !cel.sea && cel.height && cel.kind !== 'gas' && cel.kind !== 'star' && alt < 20000) alt -= Math.max(0, 1 - alt / 20000) * cel.height(_hu.x, _hu.y, _hu.z);
  const high = alt > 2500 || !b.airCel || (cel === MOON && alt > 300);
  $('hSpeed').textContent = high ? Math.round(spd).toLocaleString('en-US') : Math.round(spd * 3.6);
  $('hSpeedU').textContent = high ? 'm/s' : 'km/h';
  const big = Math.abs(alt) >= 100000;
  $('hAlt').textContent = big ? Math.round(alt / 1000).toLocaleString('en-US') : Math.abs(alt) >= 10000 ? (alt / 1000).toFixed(1) + 'k' : Math.round(alt).toLocaleString('en-US');
  $('hAltU').textContent = (big ? 'km ' : 'm ') + altLabel(cel, alt);
  $('hVs').textContent = (vs >= 0 ? '+' : '') + (Math.abs(vs) >= 1000 ? Math.round(vs).toLocaleString('en-US') : vs.toFixed(Math.abs(vs) < 10 ? 1 : 0));
  const mach = machineOf(b);
  let alive = 0; for (const o of mach) alive += o.parts.length;
  if (b.fam) for (const o of W.bodies) if (o.fam === b.fam && o.staged && !o.dead && !mach.includes(o)) alive += o.parts.length;
  setBar('intBar', Math.min(1, alive / G.initialParts), Math.round(Math.min(1, alive / G.initialParts) * 100) + '%');
  setBar('fuelBar', b.fuelMax > 0 ? b.fuel / b.fuelMax : 0, b.fuelMax > 0 ? Math.round(b.fuel) + ' kg' : '', b.fuelMax > 0);
  let rho = (b.rho || 0) / RHO0;
  // an anchored tower skips the physics that measures the air, so read it at the seat
  if (b.anchored) { const ac = airAt(pp); rho = ac ? airDensity(ac, pp.distanceTo(ac.center) - ac.R) / RHO0 : 0; }
  setBar('airBar', rho, rho > 0 && rho < 0.01 ? '<1%' : Math.round(rho * 100) + '%');
  const haz = Math.max(b.heat || 0, b.crush || 0, b.lava ? 0.5 : 0, Math.min(1, b.aero || 0));
  const hz = $('heatBar');
  if (haz > 0.001) { hz.querySelector('.lab').textContent = b.crush > Math.max(b.heat, b.aero) ? 'Pressure' : b.lava && !b.heat && !b.aero ? 'Lava' : 'Heat'; setBar('heatBar', haz, Math.round(haz * 100) + '%'); }
  else hz.hidden = true;
  const chips = [];
  if (mach.some(o => o.rockets.length || o.jets.length || o.props.length || o.boats.length)) chips.push(`<span class="chip${G.throttle ? ' on' : ''}">Throttle ${G.throttle ? 'full' : 'off'}</span>`);
  if (G.braking) chips.push('<span class="chip on">Brake</span>');
  if (G.reversing) chips.push('<span class="chip on">Reverse</span>');
  if (SAS.on) chips.push(`<span class="chip on">SAS · ${SAS_MODES.find(m => m[0] === SAS.mode)[1]}</span>`);
  if (b.parts.some(p => p.def.kind === 'decoupler')) chips.push(`<span class="chip">${esc(keyName(actKeys('stage')[0]))} stages</span>`);
  if (G.warp > 1) chips.push(`<span class="chip on">Warp ×${G.warp.toLocaleString('en-US')}${G.warp >= RAILS ? ' · coasting' : ''}</span>`);
  if (G.rcsMode) chips.push('<span class="chip on">RCS translate</span>');
  if (mach.some(o => o.dock || o.carrying)) chips.push(`<span class="chip on">Linked · ${esc(keyName(actKeys('undock')[0]))} undocks, ${esc(keyName(actKeys('grab')[0]))} lets go</span>`);
  if (mach.some(o => o.wheels.some(w => w.gear))) chips.push(`<span class="chip">${mach.some(o => o.gearUp) ? 'Gear up' : 'Gear down'}</span>`);
  chips.push(`<span class="chip">${G.map ? 'Map view' : G.chase ? 'Chase cam' : 'Free cam'}</span>`);
  // on rail bogies: say so, and how fast the bends just ahead can be taken
  const bogs = mach.flatMap(o => o.bogies || []), onb = bogs.find(g => g.on);
  if (onb) {
    const P = onb.line.pts, dir = onb.tdir; let kmax = 0;
    for (let k = 0, i = onb.ri; k < 30; k++, i += dir) {
      if (i < 1 || i >= P.length - 1) break;
      const a = _rk1.subVectors(P[i].d, P[i - 1].d), c = _rk2.subVectors(P[i + 1].d, P[i].d);
      kmax = Math.max(kmax, Math.acos(clamp(a.dot(c) / (a.length() * c.length() || 1), -1, 1)) / (a.length() * PLANET.R || 1));
    }
    const lim = kmax > 1e-5 ? Math.sqrt(RAIL_LAT * 0.85 / kmax) : 99;
    chips.push(lim < 40 ? `<span class="chip ${spd > lim ? 'warn' : 'on'}">Bend ahead · ${Math.round(lim * 3.6)} km/h</span>` : '<span class="chip on">On rails</span>');
  } else if (bogs.length) chips.push('<span class="chip">Bogies off the track</span>');
  $('hChips').innerHTML = chips.join('');
  { const sp = inSpace(b); if (SAS.space !== sp) { SAS.space = sp; renderSAS(); } }
  // Base mode: offered once you have landed and stopped with crates aboard (or beside a base of yours)
  if (BASES.mode && (!canBaseMode(b) || BASES.mode.cel !== b.groundCel)) exitBaseMode();
  const bm = !BASES.mode && canBaseMode(b), br = $('baseRow');
  if (br.hidden === bm) br.hidden = !bm;
  if (bm) { const n = cratesAboard(b), t = n ? `Base mode · ${n} crates aboard` : 'Base mode · take pieces back'; if ($('btnBase').textContent !== t) $('btnBase').textContent = t; }
  document.body.classList.toggle('basemode', !!BASES.mode);
  const ob = $('orbitBox');
  const onTower = b.anchored || mach.some(o => o.onTower);
  // the orbit panel: up high, going fast, in the map, or off the ground on a world with no air (not while you sit on it)
  const landed = b.groundCel && spd < 30;
  if (!onTower && (alt > 1500 || spd > 120 || G.map || (!b.airCel && !landed))) {
    const oi = orbitInfo(b, cel);
    const nm = celCall(cel);
    // sitting on the ground (looking at the map): no orbit to speak of, just where you are and what is round you
    const sitting = landed && alt < 1500;
    let html = `<div class="ttl">${sitting ? 'Landed · ' + nm : oi.escape ? 'Escaping ' + nm : (oi.pe > 0 ? 'Orbiting ' + nm : 'Suborbital · ' + nm)}</div>`;
    if (sitting) { }
    else if (oi.escape) html += `<div class="row"><span>Eccentricity</span><b>${oi.e.toFixed(2)}</b></div>`;
    else {
      html += `<div class="row"><span>Apoapsis</span><b>${fmtDist(oi.ap)}</b></div>`;
      html += `<div class="row"><span>Periapsis</span><b>${oi.pe < 0 ? (cel.kind === 'gas' ? 'in the clouds' : cel.hole ? 'inside the horizon' : 'below surface') : fmtDist(oi.pe)}</b></div>`;
      if (oi.pe > 0) html += `<div class="row"><span>Period</span><b>${fmtTime(oi.T)}</b></div>`;
    }
    if (cel.kind === 'star' && cel.heatStart && oi.pe + cel.R < cel.heatStart) html += `<div class="row warn"><span>Heat zone</span><b>${oi.pe + cel.R < cel.heatEnd ? 'fatal' : 'on this path'}</b></div>`;
    if (cel.hole && !oi.escape && oi.pe < 0) html += `<div class="row warn"><span>Horizon</span><b>falling in on this path</b></div>`;
    // out between the stars: how far to the nearest one
    if (inDeepSpace(b.x)) { let ns = null, nsd = Infinity; for (const sc of STARS) { const d = b.x.distanceTo(sc.center); if (d < nsd && sc.sysR) { nsd = d; ns = sc; } } html += `<div class="row hi"><span>Nearest star · ${ns.name}</span><b>${fmtDist(nsd)}</b></div>`; }
    // nearest other world
    let nb = null, nd = Infinity;
    const home = rootStar(cel);
    for (const c of ORBITERS) { if (c === cel || c.kind === 'star' || rootStar(c) !== home) continue; const d = b.x.distanceTo(c.center) - c.R; if (d < nd) { nd = d; nb = c; } }
    const pr = MAP.pred;
    // the target: how far, how fast you are closing, and the closest your path comes
    const tp = sasTargetPos();
    if (nb && !(tp && SAS.target && SAS.target.cel === nb)) html += `<div class="row"><span>Nearest · ${nb.name}</span><b>${fmtDist(Math.max(0, nd))}</b></div>`;
    if (tp && SAS.target) {
      const T = SAS.target, tv = T.body ? T.body.v : T.cel.vel, dist = b.x.distanceTo(tp) - (T.cel ? T.cel.R : 0);
      const rel = _tgv.subVectors(b.v, tv), close = -rel.dot(_tgv2.subVectors(tp, b.x).normalize());
      html += `<div class="row tg"><span>Target · ${esc(T.body ? T.name : T.cel.name)}</span><b>${fmtDist(Math.max(0, dist))}</b></div>`;
      html += `<div class="row tg"><span>${close >= 0 ? 'Closing at' : 'Moving away at'}</span><b>${Math.abs(close) < 1000 ? Math.abs(close).toFixed(1) + ' m/s' : (Math.abs(close) / 1000).toFixed(2) + ' km/s'}</b></div>`;
      if (pr && pr.tgt && pr.tgt.min < Infinity) html += `<div class="row tg"><span>Closest approach</span><b>${pr.tgt.min < 0 ? 'impact' : fmtDist(pr.tgt.min)} · ${fmtTime(pr.tgt.t)}</b></div>`;
    }
    if (pr && pr.enc.length) { const e = pr.enc[0]; html += `<div class="row hi"><span>${e.cel.name} encounter</span><b>${fmtTime(e.t)}</b></div>`; }
    if (pr && pr.impact && pr.impact.cel !== cel && !(pr.enc[0] && pr.enc[0].cel === pr.impact.cel)) html += `<div class="row warn"><span>${pr.impact.cel.kind === 'star' ? 'Into ' + celCall(pr.impact.cel) : 'Impact · ' + pr.impact.cel.name}</span><b>${fmtTime(pr.impact.t)}</b></div>`;
    ob.innerHTML = html; ob.hidden = false;
  } else ob.hidden = true;
  // skyhook helper for anything with a docking port
  const hr = $('hookRow');
  const ports = mach.some(o => o.docks.length);
  HOOKPRED.timer -= 0.1;
  if (ports && HOOKPRED.timer <= 0) { HOOKPRED.timer = 0.5; predictDip(b); }
  if (!ports) HOOKPRED.ok = false;
  const riding = mach.find(o => o.dock && o.dock.kind === 'grapple');
  let climbW = null; for (const o of mach) { climbW = o.wheels.find(w => w.lat && w.on && w.on.anchored && !w.on.dead); if (climbW) break; }
  const stages = mach.some(o => o.parts.some(p => p.def.kind === 'decoupler' && p.alive));
  if (b.anchored && stages && b.wheels.length) {
    hr.innerHTML = `<span>Climber locked to the tower</span><b>${esc(keyName(actKeys('stage')[0]))} lets it go</b>`; hr.hidden = false;
  } else if (climbW) {
    const left = climbW.on.topR - r;
    hr.innerHTML = left < 30 ? `<span>Top of the tower · ${fmtDist(alt)} up</span><b>${stages ? esc(keyName(actKeys('stage')[0])) + ' launches' : 'Made it'}</b>`
      : `<span>Climbing · ${fmtDist(alt)} up · ${Math.round(Math.abs(vs))} m/s</span><b>Top in ${fmtDist(left)}</b>`;
    hr.hidden = false;
  } else if (riding) {
    const C = riding.dock.carrier, cel2 = dominantCel(C.x), up = _hu.subVectors(riding.x, C.x);
    const rad = up.dot(_hv.subVectors(C.x, cel2.center).normalize()), top = rad > 0 ? 'rising' : 'falling';
    const vu = riding.v.clone().sub(cel2.vel).dot(_hv);
    hr.innerHTML = `<span>On the skyhook · ${fmtDist(riding.x.distanceTo(cel2.center) - cel2.R)} up</span><b>${rad > C.radius * 0.6 && Math.abs(vu) < 25 ? `At the top: ${esc(keyName(actKeys('undock')[0]))} lets go now!` : vu > 0 ? 'Rising' : 'Falling'}</b>`;
    hr.hidden = false;
  } else if (HOOKPRED.ok) {
    hr.innerHTML = HOOKPRED.tipDist < 400 ? `<span>Skyhook grapple</span><b>${fmtDist(HOOKPRED.tipDist)} away</b>` : `<span>Skyhook dips to ${fmtDist(HOOKPRED.alt)} in ${fmtTime(HOOKPRED.t)}</span><b>${fmtDist(HOOKPRED.dist)} away</b>`;
    hr.hidden = false;
  } else hr.hidden = true;
  const bn = $('banner');
  if (G.wrecked) { bn.innerHTML = `Your pilot was thrown clear<small>${esc(keyName(actKeys('respawn')[0]))} respawns, ${esc(keyName(actKeys('build')[0]))} goes back to the builder</small>`; bn.hidden = false; }
  else if (G.noSeat) { bn.innerHTML = 'No seat aboard<small>This vehicle won\'t respond to controls. Add a seat in the builder.</small>'; bn.hidden = false; }
  else if (b.heat > 0.12) { const hs = celCall(HOT || SUN); bn.innerHTML = `${b.heat > 0.6 ? 'Melting down' : 'Too close to ' + hs}<small>Parts are cooking. Burn away from ${hs}.</small>`; bn.hidden = false; }
  else if (b.tidal > 0.02) { bn.innerHTML = `Inside the black hole<small>Past the horizon nothing gets back out, and the tides are pulling the craft apart.</small>`; bn.hidden = false; }
  else if (b.crush > 0) { bn.innerHTML = 'Crushing pressure<small>Climb out of the clouds before the hull gives way</small>'; bn.hidden = false; }
  else if (b.lava > 0) { bn.innerHTML = 'Burning in lava<small>Get out before it eats through</small>'; bn.hidden = false; }
  else bn.hidden = true;
}
function updateTint() {
  const b = G.player, el = $('tint');
  const heat = G.mode === 'drive' && b && !b.dead ? b.heat || 0 : 0, crush = G.mode === 'drive' && b && !b.dead ? b.crush || 0 : 0;
  const k = Math.max(heat, crush);
  el.style.opacity = k > 0.005 ? Math.min(0.85, Math.pow(k, 0.8) * 0.9).toFixed(3) : '0';
  el.dataset.kind = crush > heat ? 'crush' : 'heat';
}

/* ---------------- vehicles in the world ---------------- */
function vehicleList() { return W.bodies.filter(b => !b.dead && !b.debris && !b.diorama && b.seat && !b.seat.broken); }
function vehicleWhere(b) {
  const mach = machineOf(b), rider = mach.find(o => o.dock && (o.dock.kind === 'grapple' || o.dock.kind === 'dock'));
  if (rider) return rider.dock.kind === 'grapple' ? 'Hanging from a skyhook' : `Docked to ${rider.dock.carrier.name}`;
  if (b.grapples.length && b.w.length() > 0.02 && b.radius > 300) {
    const cel = dominantCel(b.x); return `Spinning over ${cel.name} · ${fmtDist(b.x.distanceTo(cel.center) - cel.R)} up`;
  }
  const cel = dominantCel(b.x), alt = b.x.distanceTo(cel.center) - cel.R, nm = celCall(cel);
  if (b.anchored) return `Anchored on ${nm}`;
  const tw = mach.map(o => o.onTower).find(t => t && !t.dead) || (b.wheels.length ? nearTower(b.x, 3) : null);
  if (tw) return `On the ${tw.name.replace(/ tower$/, '')} tower · ${fmtDist(alt)} up`;
  if (alt > spaceAlt(cel)) { const oi = orbitInfo(b, cel); return oi.escape ? `Escaping ${nm}` : oi.pe > 0 ? `Orbiting ${nm} · ${fmtDist(alt)} up` : `Falling toward ${nm}`; }
  const moving = b.v.distanceTo(surfaceVel(cel, b.x, new V3())) > 1.5;
  let s = `${moving ? 'Moving' : 'Parked'} ${cel.kind === 'gas' ? 'in' : 'on'} ${nm}`;
  if (cel === PLANET) { const pad = PLANET.center.clone().addScaledVector(WORLD.padUp, PLANET.R + WORLD.padH); const d = pad.distanceTo(b.x); s += d < 60 ? ' · at the pad' : ` · ${fmtDist(d)} from the pad`; }
  return s;
}
function openVehicles() {
  const list = vehicleList();
  const pc = b => machineOf(b).reduce((s, o) => s + o.parts.length, 0);
  const rows = list.length ? list.map((b, i) => `<div class="mrow"><div class="grow"><span class="nm">${esc(b.name)}${b === G.player ? ' · driving' : ''}</span><span class="meta">${esc(vehicleWhere(b))} · ${pc(b)} parts</span></div>${b === G.player ? '' : `<button type="button" class="btn primary" data-board="${i}">Drive</button>`}<button type="button" class="btn danger" data-rm="${i}">Remove</button></div>`).join('')
    : `<p>No vehicles out in the world yet. Build one and ${COARSE ? 'tap Drive it' : `press ${esc(keyName(actKeys('build')[0]))}`} to drive it. Park &amp; build leaves it out in the world for later.</p>`;
  openModal(`<h2>Vehicles in the world</h2>
    <p>Everything you leave behind stays where it is, even after you close the page. Pick one to take the controls again.</p>
    <div class="mlist">${rows}</div>
    <div class="mfoot">${list.filter(b => b !== G.player).length > 1 ? '<button type="button" class="btn danger" data-rmall="1">Remove all parked</button>' : ''}<button type="button" class="btn" data-close="1">Close</button></div>`);
  $('modal').onclick = e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.close) return closeModal();
    if (t.dataset.rmall) { const l = list.filter(b => b !== G.player); for (const b of l) removeMachine(b); worldSave(); toast(`Removed ${l.length} parked vehicles`); openVehicles(); return; }
    if (t.dataset.rm !== undefined) {
      const b = list[+t.dataset.rm]; if (!b) return;
      if (b === G.player) { removeMachine(b); G.player = null; G.seatUid = null; closeModal(); setMode('build'); toast(`Removed ${b.name}`); return; }
      removeMachine(b); worldSave(); toast(`Removed ${b.name}`); openVehicles(); return;
    }
    if (t.dataset.board !== undefined) {
      const b = list[+t.dataset.board]; if (!b || b.dead) return;
      closeModal();
      if (G.mode === 'drive') takeControl(b); else setMode('drive', true, b);
      toast(`Driving ${b.name}`, 1400); worldSave();
    }
  };
}
/* ---------------- saving the world ---------------- */
const WORLD_KEY = 'scrapline.world';
const r3 = v => Math.round(v * 1000) / 1000;
function serializeBody(b) {
  const cel = b.asleep && b.pinCel ? b.pinCel : dominantCel(b.x);
  const rel = b.x.clone().sub(cel.center), vrel = b.trueVel(new V3()).sub(cel.vel);
  return {
    name: b.name, design: b.seat ? b.design : null, init: b.initialParts || b.parts.length, spawned: !!b.spawned, brake: b.player ? 0.6 : b.ctl.brake, gearUp: !!b.gearUp,
    parts: b.parts.map(p => [p.t, p.a, p.m, p.c, p.uid, r3(p.fuel || 0), Math.round(p.hp), p.chute || 0, p.cfg || 0]),
    cel: cel.name, x: rel.toArray().map(r3), v: vrel.toArray().map(r3), q: [b.q.x, b.q.y, b.q.z, b.q.w], w: b.trueW(new V3()).toArray().map(v => Math.round(v * 1e5) / 1e5),
    sleep: b.asleep && !b.frozen, anc: !!b.anchored, ancOff: !!b.anchorOff, fam: b.fam || 0
  };
}
function worldSave() {
  if (!started) return;
  try {
    // every vehicle with a seat, plus whatever is joined to it, riding on it or hanging from its winch
    const keep = new Set();
    for (const v of vehicleList()) for (const o of machineOf(v)) keep.add(o);
    let grew = true;
    while (grew) { grew = false; for (const b of W.bodies) if (!b.dead && !keep.has(b) && b.dock && keep.has(b.dock.carrier) && !b.debris) { keep.add(b); grew = true; } for (const b of [...keep]) if (b.dock && !keep.has(b.dock.carrier)) { keep.add(b.dock.carrier); grew = true; } }
    // towers a kept vehicle was launched from stay too
    const fams = new Set([...keep].map(b => b.fam).filter(f => f));
    for (const b of W.bodies) if (!b.dead && !keep.has(b) && b.anchored && fams.has(b.fam)) keep.add(b);
    const list = W.bodies.filter(b => keep.has(b)), idx = new Map(list.map((b, i) => [b, i]));
    const uid = p => p ? p.uid : null;
    const joints = W.joints.filter(j => j.jp.alive && j.ap.alive && idx.has(j.jp.body)).map(j => ({ jp: j.jp.uid, ap: j.ap.uid, target: r3(j.target), hold: r3(j.hold) }));
    const ropes = W.ropes.filter(r => r.wp.alive && r.hook && !r.hook.dead && idx.has(r.hook) && idx.has(r.wp.body)).map(r => ({ wp: r.wp.uid, hook: idx.get(r.hook), L: r3(r.L), pos: r.wd.pos.toArray(), dir: r.wd.dir.toArray() }));
    const links = list.filter(b => b.dock && idx.has(b.dock.carrier)).map(b => { const D = b.dock; return { f: idx.get(b), c: idx.get(D.carrier), kind: D.kind, fp: uid(D.fp), cp: uid(D.cp), o: D.o.toArray(), q: D.q.toArray() }; });
    LS.set(WORLD_KEY, { v: 5, time: W.time, spawnLoc: G.spawnLoc, bodies: list.map(serializeBody), joints, ropes, links });
  } catch (e) { console.warn('save failed', e); }
}
function worldLoad() {
  const d = LS.get(WORLD_KEY, null);
  if (!d || !Array.isArray(d.bodies)) return 0;
  W.time = +d.time || 0;
  // saves from before Park & build held every vehicle you ever drove: start those fresh
  if (d.v !== 3 && d.v !== 4 && d.v !== 5) { updateCelestials(W.time); return 0; }
  const oldWheels = d.v === 3;
  // saves from before the worlds turned: restart the clock, so every world sits turned exactly as those vehicles knew it,
  // then give anything on or near the ground the ground's new motion
  const preSpin = d.v < 5;
  if (preSpin) W.time = 0;
  updateCelestials(W.time);
  const made = [], byUid = new Map();
  for (const sb of d.bodies) {
    let b = null;
    try {
      const cel = CELS.find(c => c.name === sb.cel) || PLANET;
      const parts = sb.parts.filter(a => PD[a[0]]).map(a => { const p = new PartInst(a[0], a[1], oldWheels && PD[a[0]].kind === 'wheel' ? fixWheelM(a[2]) : a[2], a[3], a[4], a[8] ? cleanCfg(a[8], PD[a[0]]) || null : null); p.fuel = a[5] || 0; p.hp = a[6] || p.hp; if (a[7]) p.chute = a[7]; PUID = Math.max(PUID, a[4] | 0); byUid.set(p.uid, p); return p; });
      if (parts.length) {
        b = new Body(parts, { name: sb.name, design: sb.design ? sanitizeDesign(sb.design) : null, brake: sb.brake || 0.6, fam: sb.fam | 0 });
        FAMID = Math.max(FAMID, sb.fam | 0); b.anchorOff = !!sb.ancOff;
        b.initialParts = sb.init || parts.length; b.spawned = !!sb.spawned; b.gearUp = !!sb.gearUp; b.gearK = b.gearUp ? 0 : 1;
        b.q.set(sb.q[0], sb.q[1], sb.q[2], sb.q[3]).normalize(); b.updR();
        b.x.copy(cel.center).add(new V3().fromArray(sb.x)); b.v.copy(cel.vel).add(new V3().fromArray(sb.v)); b.w.fromArray(sb.w);
        if (preSpin && cel.spinW && (sb.sleep || b.x.distanceTo(cel.center) - cel.R < spaceAlt(cel) + 500)) { b.v.add(surfaceVel(cel, b.x, new V3()).sub(cel.vel)); b.w.add(spinVec(cel, new V3())); }
        W.bodies.push(b);
        b._cel = cel; b._sleep = !!sb.sleep; b._anc = !!sb.anc;
      }
    } catch (e) { console.warn('could not restore a vehicle', e); }
    made.push(b);
  }
  for (const j of d.joints || []) { const jp = byUid.get(j.jp), ap = byUid.get(j.ap); if (jp && ap && jp.def.joint) { const J = makeJoint(jp, ap); J.target = j.target || 0; J.hold = j.hold || 0; } }
  for (const r of d.ropes || []) {
    const wp = byUid.get(r.wp), hook = made[r.hook]; if (!wp || !hook) continue;
    const R = { wp, wd: { pos: new V3().fromArray(r.pos), dir: new V3().fromArray(r.dir) }, hook, L: r.L || 2.5, acc: 0, len: r.L || 2.5 };
    R.holding = () => !!hook.dock || W.bodies.some(o => o.dock && o.dock.carrier === hook);
    W.ropes.push(R);
  }
  for (const L of d.links || []) {
    const F = made[L.f], C = made[L.c]; if (!F || !C) continue;
    const o = new V3().fromArray(L.o), q = new Quat().fromArray(L.q), fp = byUid.get(L.fp) || null, cp = byUid.get(L.cp) || null;
    F.dock = { carrier: C, kind: L.kind, fp, cp, o, q, o0: o.clone(), q0: q.clone(), t: 1, dur: 1, vPrev: new V3() };
    if (fp) fp.linked = true; if (cp) cp.linked = true; if (L.kind === 'claw') { if (fp && fp.def.kind === 'claw') fp.grip = true; if (cp && cp.def.kind === 'claw') cp.grip = true; }
    placeFollower(F, 0);
  }
  for (const b of made) if (b && b._sleep && !b.dock && !b._anc) b.pin(b._cel, false);
  for (const b of made) if (b && b._anc) anchorBody(b, b._cel);
  assignAssemblies();
  for (const b of made) if (b) b.machine = assemblyOf(b);
  return vehicleList().length;
}

/* ---------------- UI panels ---------------- */
let curCat = 'Blocks';
const THUMB_ROT = { jet_big: [Math.PI / 2, 0, 0], truss_215: [0, 0, -Math.PI / 2], truss_120: [0, 0, -Math.PI / 2], anchor: [Math.PI, 0, 0], truss_50: [0, 0, -Math.PI / 2], truss_5: [0, 0, -Math.PI / 2], wing_s: [0, 0, -Math.PI / 2], wing: [0, 0, -Math.PI / 2], wing_l: [0, 0, -Math.PI / 2], prop: [Math.PI / 2, 0, 0], prop_big: [Math.PI / 2, 0, 0], jet: [Math.PI / 2, 0, 0], boat_prop: [Math.PI / 2, 0, 0], flap: [Math.PI / 2, 0, 0], fin: [0, -Math.PI / 2, 0] };
function makeThumbs() {
  const S = 128, rt = new THREE.WebGLRenderTarget(S, S);
  const sc = new THREE.Scene();
  sc.add(new THREE.AmbientLight(0xffffff, 0.55));
  const dl = new THREE.DirectionalLight(0xffffff, 0.85); dl.position.set(3, 5, 4); sc.add(dl);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
  const buf = new Uint8Array(S * S * 4), cv = document.createElement('canvas'); cv.width = cv.height = S;
  const cx = cv.getContext('2d'), img = cx.createImageData(S, S);
  const prevClear = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha();
  for (const d of PARTS) {
    const obj = partObject(d.id, d.dc, null, null);
    if (d.id.startsWith('wheel')) obj.rotation.set(0, 0, -Math.PI / 2);
    else if (THUMB_ROT[d.id]) obj.rotation.set(...THUMB_ROT[d.id]);
    sc.add(obj); obj.updateMatrixWorld(true);
    const s = new THREE.Box3().setFromObject(obj).getBoundingSphere(new THREE.Sphere());
    const dist = s.radius / Math.sin(THREE.MathUtils.degToRad(15)) * 1.04;
    cam.position.copy(s.center).addScaledVector(new V3(1, 0.8, 1.3).normalize(), dist);
    cam.near = dist * 0.05; cam.far = dist * 4; cam.updateProjectionMatrix(); cam.lookAt(s.center);
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(sc, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, S, S, buf);
    for (let y = 0; y < S; y++) img.data.set(buf.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
    cx.putImageData(img, 0, 0); d.thumb = cv.toDataURL();
    sc.remove(obj);
  }
  renderer.setRenderTarget(null); renderer.setClearColor(prevClear, prevA); rt.dispose();
}
function partSpec(d) {
  const s = [`${d.mass} kg`];
  switch (d.kind) {
    case 'wheel': s.push(`${d.wheel.power / 1000} kW`, `${Math.round(d.wheel.vmax * 3.6)} km/h top`); if (d.wheel.steer) s.push('steers'); break;
    case 'engine': s.push(`+${d.power / 1000} kW`); break;
    case 'prop': case 'jet': case 'rocket': case 'boatprop': s.push(`${(d.thrust / 1000).toFixed(1)} kN`); break;
    case 'wing': case 'flap': s.push(`${d.area} m²`); break;
    case 'tank': s.push(`${d.fuel} kg fuel`); break;
    case 'gyro': case 'rcs': s.push(`${(d.torque / 1000).toFixed(1)} kN·m`); break;
    case 'explosive': s.push(`${d.radius} m blast`); break;
    case 'joint': s.push(d.joint.type === 'hinge' ? 'swings ±100°' : d.joint.type === 'rotor' ? 'spins' : d.joint.type === 'piston' ? `${d.joint.travel} m stroke` : 'springy'); break;
    case 'chute': s.push(`${d.area} m² canopy`); break;
    case 'grapple': s.push('25 m reach'); break;
  }
  if (d.ve) s.push(`${d.ve > 5000 ? 'very ' : ''}efficient`);
  if (d.lattice) s.push(`${(d.cells.length * CELL).toFixed(0)} m long`);
  if (d.buoy >= 1) s.push(`floats ${d.buoy}×`);
  s.push(`${d.hp} HP`);
  return s.join(' · ');
}
function renderCats() {
  $('catTabs').innerHTML = CATS.map(c => `<button type="button" data-cat="${c}" class="${c === curCat ? 'on' : ''}">${c}</button>`).join('');
}
function renderParts() {
  $('partGrid').innerHTML = PARTS.filter(d => d.cat === curCat).map(d =>
    `<button type="button" class="pcard${d.id === B.sel && B.tool === 'build' ? ' on' : ''}" data-part="${d.id}" title="${esc(d.name)}"><img alt="" src="${d.thumb || ''}"><span>${esc(d.name)}</span></button>`).join('');
}
/* {action} in a part's description shows the key you have for it */
const keyText = s => s.replace(/\{(\w+)\}/g, (m, id) => ACT[id] ? keyName(actKeys(id)[0]) : m);
function renderPartInfo() {
  const d = PD[B.sel];
  $('partInfo').innerHTML = `<h4>${esc(d.name)}</h4><div class="spec">${partSpec(d)}</div><p>${esc(keyText(d.desc))}</p>${cfgSchema(d) ? '<p class="cfgnote">Has settings: pick the Configure tool and click it.</p>' : ''}`;
}
function swatchHTML() {
  const h = [`<button type="button" class="sw auto${B.color < 0 ? ' on' : ''}" data-c="-1" title="Each part's own colour">Auto</button>`];
  PALETTE.forEach((p, i) => h.push(`<button type="button" class="sw${B.color === i ? ' on' : ''}" data-c="${i}" title="${p.name}" style="background:#${p.hex.toString(16).padStart(6, '0')}"></button>`));
  return `<div class="swatches">${h.join('')}</div>`;
}
const HINTS = {
  build: () => [['Click', 'place'], ['Right-click', 'delete'], [keyName(actKeys('b_rot')[0]), 'rotate'], [keyName(actKeys('b_tilt')[0]), 'tilt'], ['Drag', 'turn view'], ['Shift-drag', 'slide'], ['W A S D', 'move'], ['Scroll', 'zoom']],
  select: () => [['Click', 'select'], ['Shift-click', 'add'], ['Drag', 'box'], ['Double-click', 'whole branch'], [keyName(actKeys('b_move')[0]), 'move'], [keyName(actKeys('b_copy')[0]), 'copy'], ['Del', 'delete'], ['Arrows', 'slide'], ['Right-drag', 'turn view']],
  config: () => [['Click', 'pick a part'], ['Shift-click', 'add more'], ['Drag', 'turn view'], ['Esc', 'clear']],
  paint: () => [['Click', 'paint'], ['Drag', 'turn view'], [keyName(actKeys('b_mirror')[0]), 'mirror']],
};
function syncTools() {
  for (const b of $('toolbar').querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === B.tool);
  const v = G.settings.views;
  for (const b of $('toolbar').querySelectorAll('[data-view]')) b.classList.toggle('on', b.dataset.view === 'mirror' ? B.mirror : !!v[b.dataset.view]);
  $('tbUndo').disabled = !B.undo.length && !B.pasting; $('tbRedo').disabled = !B.redo.length;
  $('hint').innerHTML = HINTS[B.tool]().map(([k, t]) => `<span><kbd>${esc(k)}</kbd> ${t}</span>`).join('');
  B.needsHover = true; B.ghostKey = '';
  renderParts(); uiRot(); renderCtx();
}
function uiRot() {
  const el = $('rotInfo');
  if (isPlacing() || isStamping()) el.textContent = rotLabel();
  else if (B.tool === 'paint') el.textContent = `Paint: click parts with ${B.color < 0 ? 'their own colour' : PALETTE[B.color].name}`;
  else if (B.selSet.size) el.textContent = `${B.selSet.size} part${B.selSet.size > 1 ? 's' : ''} selected`;
  else el.textContent = B.tool === 'config' ? 'Configure: click a part to set its keys and settings' : 'Select: click parts, or drag a box around them';
}
function uiStats() {
  if (!$('stats')) return;
  const s = designStats(B.design);
  const rows = [['Parts', s.count], ['Mass', fmtKg(s.total)], ['Size', s.size.map(v => v.toFixed(1)).join(' × ') + ' m']];
  if (s.nWheels) rows.push(['Drive', `${s.nTracks ? s.nTracks + ' track' + (s.nTracks > 1 ? 's' : '') + (s.nWheels > s.nTracks ? ' + ' : '') : ''}${s.nWheels > s.nTracks ? s.nWheels - s.nTracks + ' wheels' : ''} · ${Math.round(s.power / 1000)} kW`]);
  if (s.hover) rows.push(['Hover pads', `${s.hover} · lift up to ${s.hover * 10} kN`]);
  if (s.prop + s.jet) rows.push(['Air thrust', `${((s.prop + s.jet) / 1000).toFixed(1)} kN`]);
  if (s.anchored) rows.push(['Ground anchor', 'Stands on its own']);
  if (s.rocket) rows.push([s.anchored ? 'Top rocket' : 'Rockets', `${(s.rocket / 1000).toFixed(0)} kN · TWR ${s.twr.toFixed(2)}`]);
  if (s.fuel) rows.push(['Fuel', `${s.fuel} kg`]);
  if (s.dv) rows.push(['Δv (est.)', `${Math.round(s.dv)} m/s`]);
  if (s.area) rows.push(['Wing area', `${s.area.toFixed(1)} m²`]);
  if (s.boat) rows.push(['Water thrust', `${(s.boat / 1000).toFixed(1)} kN`]);
  if (s.torque) rows.push(['Gyro torque', `${(s.torque / 1000).toFixed(1)} kN·m`]);
  if (s.joints) rows.push(['Moving parts', `${s.joints}`]);
  const logic = B.design.parts.filter(p => PD[p.t].kind === 'logic').length;
  if (logic) rows.push(['Logic blocks', `${logic}`]);
  if (!s.anchored) rows.push(['In water', s.buoyKg > s.total * 1.05 ? 'Floats' : 'Sinks']);
  if (G.settings.views.air && B.air) rows.push(['Front area', `${B.air.A.toFixed(1)} m²`], ['Drag at 100 km/h', `${(B.air.drag / 1000).toFixed(2)} kN`]);
  $('stats').innerHTML = rows.map(r => `<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join('');
  const w = [];
  if (!s.hasSeat && s.count) w.push('No seat: this vehicle won\'t respond to controls.');
  if (s.loose) w.push(`${s.loose} part${s.loose > 1 ? 's are' : ' is'} not attached to the ${s.hasSeat ? 'seat' : 'main body'} and will fall off.`);
  if (s.rocket && !s.fuel) w.push('Rocket engines need fuel tanks.');
  if (B.design.parts.some(p => PD[p.t].kind === 'wheel' && !PD[p.t].wheel.bogie && Math.abs(p.m[4]) > 0.5)) w.push('A wheel is mounted flat and won\'t roll. Put wheels on side faces.');
  if (s.rocket && s.twr > 0 && s.twr < 1) w.push('Rockets are too weak to lift off the planet.');
  const JN = { piston: 'piston', hinge: 'hinge', rotor: 'rotor', susp: 'suspension' };
  for (const [, why, type] of B.locked || []) {
    if (why === 'tied') w.push(`A ${JN[type]} (glowing red) can't move: what's built on its top face also touches the rest of the vehicle. Only connect the moving part through the ${JN[type]}'s top.`);
    else w.push(`A ${JN[type]} (glowing red) has nothing on its top face, so it has nothing to move.`);
  }
  if (G.settings.views.forces && B.forces) w.push(...B.forces.warn);
  $('warnings').textContent = w.join(' ');
  // what the Forces view's coloured balls and arrows mean
  { const fl = $('fLegend'), on = !!(G.settings.views.forces && B.insts.length); if (fl.hidden === on) fl.hidden = !on; }
  if (typeof syncUndo === 'function') syncUndo();
}
function syncUndo() { const u = $('tbUndo'), r = $('tbRedo'); if (u) { u.disabled = !B.undo.length && !B.pasting; r.disabled = !B.redo.length; } }

/* ---------- the panel on the right: what the current tool needs ---------- */
const fmtN = v => Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v * 100) / 100) : v.toFixed(2).replace(/0$/, '');
function fieldHTML(f, p) {
  const v = p.cfg ? p.cfg[f.id] : undefined;
  switch (f.type) {
    case 'key': {
      const keys = partKeys(p, f.id), own = v !== undefined;
      const txt = keys.length ? keys.map(keyName).join(' or ') : 'None';
      return `<div class="cfg"><span>${esc(f.label)}</span><button type="button" class="keybtn${own ? ' own' : ''}" data-key="${f.id}" title="${own ? 'Its own key' : 'Your key for this (Settings, Controls)'}. Click to change">${esc(txt)}</button></div>`;
    }
    case 'num': {
      const val = v !== undefined ? v : f.def;
      if (f.free) return `<div class="cfg"><span>${esc(f.label)}</span><input type="number" data-num="${f.id}" value="${val}" step="any" aria-label="${esc(f.label)}"></div>`;
      return `<div class="cfg"><span>${esc(f.label)}</span><span class="rng"><input type="range" data-num="${f.id}" min="${f.min}" max="${f.max}" step="${f.step}" value="${val}" aria-label="${esc(f.label)}"><b>${fmtN(val)}${f.unit === '%' ? '%' : ' ' + f.unit}</b></span></div>`;
    }
    case 'bool': return `<label class="cfg toggle"><input type="checkbox" data-bool="${f.id}" ${(v !== undefined ? v : f.def) ? 'checked' : ''}> ${esc(f.label)}</label>`;
    case 'sel': { const val = v !== undefined ? v : f.def; return `<div class="cfg"><span>${esc(f.label)}</span><select data-sel="${f.id}" aria-label="${esc(f.label)}">${f.opts.map(o => `<option value="${o[0]}"${o[0] === val ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select></div>`; }
    case 'text': { const val = v !== undefined ? v : f.def; return `<div class="cfg"><span>${esc(f.label)}</span><input type="text" data-text="${f.id}" maxlength="${f.max}" value="${esc(val)}" aria-label="${esc(f.label)}" spellcheck="false"></div>`; }
  }
  return '';
}
function cfgGroupsOf(idx) {
  const groups = new Map();
  for (const i of idx) {
    const p = B.insts[i]; if (!p) continue;
    const sc = cfgSchema(p.def); if (!sc) continue;
    const sig = (p.def.kind === 'logic' ? p.def.logic : p.def.kind === 'joint' ? p.def.joint.type : p.def.kind) + '|' + sc.map(f => f.id).join(',');
    let g = groups.get(sig); if (!g) groups.set(sig, g = { sc, idx: [], names: new Set() });
    g.idx.push(i); g.names.add(p.def.name);
  }
  return [...groups.values()];
}
function configHTML(idx) {
  const groups = B.cfgGroups = cfgGroupsOf(idx);
  if (!groups.length) return `<p class="hintp">${idx.length > 1 ? 'None of these parts have settings.' : 'This part has no settings.'}</p>`;
  if (groups.length > 1) return `<span class="lab">Configure</span><p class="hintp">These are different kinds of parts. Pick one kind to set them all at once:</p><div class="onlylist">${groups.map((g, k) => `<button type="button" class="btn" data-only="${k}">${esc([...g.names].join(', '))} · ${g.idx.length}</button>`).join('')}</div>`;
  const g = groups[0], p0 = B.insts[g.idx[0]];
  let h = `<span class="lab">Configure · ${esc([...g.names].join(', '))}${g.idx.length > 1 ? ' ×' + g.idx.length : ''}</span><div class="cfglist">`;
  for (const f of g.sc) h += fieldHTML(f, p0);
  h += '</div>';
  if (g.sc.note) h += `<p class="hintp">${esc(g.sc.note)}</p>`;
  h += `<p class="hintp">Grey keys follow your Controls settings; orange keys belong to this part.</p><button type="button" class="btn" data-reset="1">Reset to defaults</button>`;
  return h;
}
function renderCtx() {
  const el = $('ctx'); if (!el) return;
  const T = B.tool, idx = selIdx();
  let h = '';
  if (B.pasting && B.clip) {
    const n = B.clip.parts.length;
    h = `<span class="lab">${B.moving ? 'Moving' : 'Stamping copies of'} ${n} part${n > 1 ? 's' : ''}</span><p class="hintp">Point at a face and click to set ${B.moving ? 'it down' : 'a copy'}. ${kbd(actKeys('b_rot')[0])} turns it. Esc ${B.moving ? 'puts it back' : 'stops'}.</p>
      <div class="actgrid"><button type="button" class="btn" data-a="rotclip">Turn</button><button type="button" class="btn" data-a="cancel">${B.moving ? 'Put back' : 'Stop'}</button></div>`;
  } else if (T === 'build') {
    const d = PD[B.sel];
    h = `<span class="lab">Build · ${esc(d.name)}</span><p class="hintp">${COARSE ? 'Tap a face to place it; to take parts off, pick them with Select and press Delete.' : 'Click a face to place it, right-click a part to delete it.'} ${kbd(actKeys('b_rot')[0])} rotates${d.attach === 'all' ? `, ${kbd(actKeys('b_tilt')[0])} tilts` : ''}. With Mirror on, a twin goes on the other side.</p><span class="lab">Colour for new parts</span>${swatchHTML()}`;
  } else if (T === 'paint') {
    h = `<span class="lab">Paint</span><p class="hintp">Pick a colour, then click parts. With Mirror on, both sides change.</p>${swatchHTML()}`;
  } else if (!idx.length) {
    h = `<span class="lab">${T === 'config' ? 'Configure' : 'Select'}</span><p class="hintp">${T === 'config'
      ? 'Click a part to set its keys and settings: wheels, engines, flaps, gyros, hinges, decouplers, logic blocks and more. With Mirror on its twin comes along; Shift-click adds more parts.'
      : 'Click a part to select it, Shift-click to add more, or drag a box around parts. Double-click a part to pick it and everything built onto it. Ctrl+A selects everything.'}</p>`;
  } else {
    h = `<span class="lab">${idx.length} part${idx.length > 1 ? 's' : ''} selected</span>`;
    if (T === 'select') h += `<div class="actgrid">
      <button type="button" class="btn" data-a="move" title="Pick it up and set it down somewhere else (${esc(keyName(actKeys('b_move')[0]))})">Move</button>
      <button type="button" class="btn" data-a="copy" title="Stamp copies (${esc(keyName(actKeys('b_copy')[0]))})">Copy</button>
      <button type="button" class="btn" data-a="mirror" title="A mirrored copy on the other side">Mirror copy</button>
      <button type="button" class="btn danger" data-a="del" title="Delete (Del)">Delete</button>
      <button type="button" class="btn" data-a="turn" title="Turn about up (${esc(keyName(actKeys('b_rot')[0]))})">Turn</button>
      <button type="button" class="btn" data-a="tilt" title="Tilt nose up or down (${esc(keyName(actKeys('b_tilt')[0]))})">Tilt</button>
      <button type="button" class="btn" data-a="roll" title="Roll sideways">Roll</button>
      <button type="button" class="btn" data-a="paint" title="Paint with the colour below">Paint</button></div>
      <span class="lab">Slide one step</span>
      <div class="nudge"><button type="button" class="btn" data-n="1,0,0">Left</button><button type="button" class="btn" data-n="0,1,0">Up</button><button type="button" class="btn" data-n="0,0,1">Forward</button>
      <button type="button" class="btn" data-n="-1,0,0">Right</button><button type="button" class="btn" data-n="0,-1,0">Down</button><button type="button" class="btn" data-n="0,0,-1">Back</button></div>
      ${swatchHTML()}`;
    h += configHTML(idx);
  }
  el.innerHTML = h;
  uiRot(); syncUndo();
}
/* the key picker for one setting: press a key, or pick a channel, none, or the default */
function openKeyPicker(btn, id) {
  const g = B.cfgGroups && B.cfgGroups[0]; if (!g) return;
  const f = cfgField(B.insts[g.idx[0]].def, id); if (!f) return;
  const box = document.createElement('div'); box.className = 'keypick';
  box.innerHTML = `<b>Press a key now</b><span>Hold Shift for a Shift+ key. Esc cancels.</span><div class="chs">${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<button type="button" class="btn" data-ch="CH${n}">Ch ${n}</button>`).join('')}</div>
    <div class="chs"><button type="button" class="btn" data-ch="">None</button>${f.act ? '<button type="button" class="btn" data-def="1">Default</button>' : ''}<button type="button" class="btn" data-cancel="1">Cancel</button></div>`;
  btn.closest('.cfg').after(box); btn.textContent = '…'; btn.classList.add('wait');
  // a click anywhere else cancels, so a stray key press later can't land on this part
  const outside = e => { if (!box.contains(e.target)) done(null); };
  const done = v => { document.removeEventListener('pointerdown', outside, true); CAPTURE = null; box.remove(); if (v === null) { renderCtx(); return; } bSetCfg(g.idx, id, v); sfx('tick'); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  captureKey(code => done(code));
  box.onclick = e => { const t = e.target.closest('button'); if (!t) return; if (t.dataset.cancel) return done(null); if (t.dataset.def) return done(undefined); if (t.dataset.ch !== undefined) return done(t.dataset.ch); };
}
function ctxEvents() {
  const el = $('ctx');
  el.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (!t.dataset.key) t.blur();
    if (t.dataset.c !== undefined) { B.color = +t.dataset.c; for (const b of el.querySelectorAll('.sw')) b.classList.toggle('on', b === t); B.ghostKey = ''; B.needsHover = true; uiRot(); return; }
    const a = t.dataset.a;
    if (a === 'move') return bMoveSel(); if (a === 'copy') return bCopySel(); if (a === 'mirror') return bMirrorSel(); if (a === 'del') return bDeleteSel();
    if (a === 'turn') return bTurnSel([0, 1, 0]); if (a === 'tilt') return bTurnSel([1, 0, 0]); if (a === 'roll') return bTurnSel([0, 0, 1]); if (a === 'paint') return bPaintSel();
    if (a === 'rotclip') { B.rotK = (B.rotK + 1) % 4; B.ghostKey = ''; B.needsHover = true; uiRot(); return; }
    if (a === 'cancel') return cancelPaste();
    if (t.dataset.n) { const [x, y, z] = t.dataset.n.split(',').map(Number); return bNudge(x, y, z); }
    if (t.dataset.only !== undefined) { const g = B.cfgGroups[+t.dataset.only]; B.selSet = new Set(g.idx); refreshHighlights(); renderCtx(); return; }
    if (t.dataset.reset) { const g = B.cfgGroups[0]; pushUndo(); for (const i of g.idx) { delete B.design.parts[i].cfg; B.insts[i].cfg = null; B.insts[i]._kc = null; } saveCurrent(); uiStats(); bOverlays(); renderCtx(); return; }
    if (t.dataset.key) { if (CAPTURE) return; openKeyPicker(t, t.dataset.key); }
  });
  el.addEventListener('input', e => { const t = e.target; if (t.dataset.num && t.type === 'range') { const f = cfgField(B.insts[B.cfgGroups[0].idx[0]].def, t.dataset.num); t.nextElementSibling.textContent = fmtN(+t.value) + (f.unit === '%' ? '%' : ' ' + f.unit); } });
  el.addEventListener('change', e => {
    const t = e.target, g = B.cfgGroups && B.cfgGroups[0]; if (!g) return;
    if (t.dataset.num) { if (t.value === '' || !isFinite(+t.value)) return renderCtx(); bSetCfg(g.idx, t.dataset.num, +t.value); }
    else if (t.dataset.bool) bSetCfg(g.idx, t.dataset.bool, t.checked);
    else if (t.dataset.sel) bSetCfg(g.idx, t.dataset.sel, t.value);
    else if (t.dataset.text) bSetCfg(g.idx, t.dataset.text, t.value.replace(/[<>]/g, '').slice(0, 24));
  });
  // typing in a text box must not work the builder's keys
  el.addEventListener('keydown', e => { if (e.target.dataset && e.target.dataset.text !== undefined) { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); } });
}
function openModal(html, wide) {
  const m = $('modal'); m.innerHTML = html; m.classList.toggle('wide', !!wide); $('modalWrap').hidden = false;
  const f = m.querySelector('input,button'); if (f) f.focus({ preventScroll: true }); m.scrollTop = 0;
}
function closeModal() { CAPTURE = null; $('modalWrap').hidden = true; $('view').focus(); }
function savedList() { const l = LS.get('scrapline.saves', []); return Array.isArray(l) ? l : []; }
function openLibrary(spawnMode) {
  // catch up with the cloud when the library opens (then show it again with what came down)
  if (!spawnMode && CLOUD.api && !CLOUD.busy && Date.now() - Math.max(CLOUD.last, CLOUD.tried || 0) > 15000) {
    CLOUD.tried = Date.now();
    cloudSync().then(ok => { if (ok && !$('modalWrap').hidden && document.querySelector('#modal .cloudslot')) openLibrary(false); });
  }
  const ex = EXAMPLES.map((e, i) => `<div class="mrow"><div class="grow"><span class="nm">${esc(e.d.name)}</span><span class="meta">${e.d.parts.length} parts · ${esc(keyText(e.blurb))}</span></div><button type="button" class="btn${spawnMode ? '' : ' primary'}" data-ex="${i}">${spawnMode ? 'Spawn' : 'Load'}</button></div>`).join('');
  const sv = savedList();
  const svh = sv.length ? sv.map((d, i) => `<div class="mrow"><div class="grow"><span class="nm">${esc(d.name)}</span><span class="meta">${d.parts.length} parts</span></div><button type="button" class="btn${spawnMode ? '' : ' primary'}" data-sv="${i}">${spawnMode ? 'Spawn' : 'Load'}</button>${spawnMode ? '' : `<button type="button" class="btn danger" data-del="${i}">Delete</button>`}</div>`).join('')
    : '<p>No saved vehicles yet. Use Save in the builder to keep one here.</p>';
  openModal(`<h2>${spawnMode ? 'Spawn a vehicle to crash into' : 'Vehicle library'}</h2>
    ${spawnMode ? '<p>It appears in front of you with its brakes on.</p>' : ''}
    ${spawnMode ? '' : '<div class="cloudslot">' + cloudLine() + '</div>'}
    <span class="lab">Your vehicles</span><div class="mlist">${svh}</div>
    <span class="lab">Examples</span><div class="mlist">${ex}</div>
    <div class="mfoot">${spawnMode ? `<button type="button" class="btn danger" data-clear="1">Remove spawned vehicles</button><button type="button" class="btn" data-current="1">Spawn ${esc(B.design.name)}</button>` : '<button type="button" class="btn" data-export="1">Export</button><button type="button" class="btn" data-import="1">Import</button><span class="grow"></span>'}<button type="button" class="btn" data-close="1">Close</button></div>`);
  $('modal').onclick = e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.close) return closeModal();
    if (t.dataset.cloud) return cloudAction(t.dataset.cloud);
    if (t.dataset.export) return openExport();
    if (t.dataset.import) return openImport();
    if (t.dataset.clear) { const l = W.bodies.filter(b => !b.player && (b.spawned || b.debris) && !b.parts.some(p => p.uid === G.seatUid)); for (const b of l) removeBody(b); closeModal(); toast(`Removed ${l.length} spawned vehicle${l.length === 1 ? '' : 's'} and wreckage`); return; }
    let d = null;
    if (t.dataset.ex !== undefined) d = EXAMPLES[+t.dataset.ex].d;
    if (t.dataset.sv !== undefined) d = sanitizeDesign(sv[+t.dataset.sv]);
    if (t.dataset.current) d = B.design;
    if (t.dataset.del !== undefined) { const l = savedList(); const nm = l[+t.dataset.del].name; noteDeleted(l[+t.dataset.del]); l.splice(+t.dataset.del, 1); LS.set('scrapline.saves', l); toast(`Deleted ${nm}`); openLibrary(spawnMode); return; }
    if (!d) return;
    closeModal();
    if (spawnMode) spawnOther(d);
    else {
      const prev = snap(); bLoad(d); B.undo.push(prev); syncUndo();
      // from the title or the paused menu, loading a vehicle means you want it now: into the builder with it
      if (TITLE.on) leaveTitle(); else if (TITLE.pause) { closeMenu(); if (G.mode !== 'build') setMode('build'); }
      toast(`Loaded ${d.name}. Undo brings back what you had`);
    }
  };
}
/* ---------- moving saved vehicles between browsers (or from one copy of the game to another) ----------
   The code is the saved vehicles (and the one being built) as JSON, in base64 after a short tag */
const XCODE_TAG = 'SCRAPLINE1.';
function exportCode() {
  const saves = savedList().map(d => sanitizeDesign(d)).filter(d => d && d.parts.length);
  const cur = B.design && sanitizeDesign(B.design), same = d => d.name === cur.name && JSON.stringify(d.parts) === JSON.stringify(cur.parts);
  if (cur && cur.parts.length && !saves.some(same)) saves.push(cur);
  const bytes = new TextEncoder().encode(JSON.stringify({ app: 'scrapline', v: 1, saves }));
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { code: XCODE_TAG + btoa(bin), n: saves.length };
}
function readCode(text) {
  const t = String(text || '').replace(/\s+/g, '');
  let json = null;
  try {
    if (t.startsWith(XCODE_TAG)) { const bin = atob(t.slice(XCODE_TAG.length)); json = new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); }
    else if (t.startsWith('{')) json = String(text);
    const o = JSON.parse(json);
    const list = Array.isArray(o) ? o : o && Array.isArray(o.saves) ? o.saves : o && Array.isArray(o.parts) ? [o] : null;
    return list ? list.map(d => sanitizeDesign(d)).filter(d => d && d.parts.length) : null;
  } catch (e) { return null; }
}
// shown inside another page (as on claude.ai, which does not let a page hand over files): no file download there
function inFrame() { try { return window.self !== window.top; } catch (e) { return true; } }
function openExport() {
  const { code, n } = exportCode();
  openModal(`<h2>Export vehicles</h2>
    <p>This code holds ${n === 1 ? 'one vehicle' : n + ' vehicles'}: everything in Your vehicles, and the one you are building. Copy it, then open the library on the other copy of Scrapline and paste it into Import.${inFrame() ? '' : ' You can keep the file instead.'}</p>
    <textarea id="xcode" rows="6" readonly aria-label="Export code">${esc(code)}</textarea>
    <div class="mfoot"><button type="button" class="btn" data-back="1">Back</button><span class="grow"></span>${inFrame() ? '' : '<button type="button" class="btn" data-dl="1">Download file</button>'}<button type="button" class="btn primary" data-copy="1">Copy code</button></div>`);
  const ta = $('xcode');
  // the plain copy first: it works inside the Claude page too, where the clipboard API may not be allowed
  const copy = () => {
    ta.focus(); ta.select(); ta.setSelectionRange(0, code.length);
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { }
    const byHand = () => toast('The code is selected: copy it from there');
    if (ok) toast('Copied');
    else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(() => toast('Copied'), byHand);
    else byHand();
  };
  $('modal').onclick = e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.back) return openLibrary(false);
    if (t.dataset.copy) copy();
    if (t.dataset.dl) {
      try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([code], { type: 'text/plain' })); a.download = 'scrapline-vehicles.txt'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
      catch (err) { copy(); }
    }
  };
}
function openImport() {
  openModal(`<h2>Import vehicles</h2>
    <p>Paste a code from Export, or open an exported file. The vehicles join Your vehicles: one you already have is skipped, and one with the same name as a different vehicle gets a number after its name.</p>
    <textarea id="icode" rows="6" placeholder="${XCODE_TAG}…" aria-label="Import code"></textarea>
    <div class="mfoot"><button type="button" class="btn" data-back="1">Back</button><span class="grow"></span><button type="button" class="btn" data-file="1">Open file</button><button type="button" class="btn primary" data-imp="1">Import</button></div>
    <input type="file" id="ifile" accept=".txt,text/plain,application/json" hidden>`);
  const ta = $('icode'); ta.focus();
  const run = text => {
    const list = readCode(text);
    if (!list) return toast('That is not a Scrapline export code');
    if (!list.length) return toast('That code has no vehicles in it');
    const have = savedList(), fresh = []; let same = 0;
    for (const d of list) {
      const js = JSON.stringify(d.parts), all = [...fresh, ...have];
      // the same vehicle already here (under any name) is not added again
      if (all.some(h => JSON.stringify((sanitizeDesign(h) || h).parts) === js)) { same++; continue; }
      let nm = d.name, k = 2; while (all.some(h => h.name === nm)) nm = `${d.name.slice(0, 36)} ${k++}`;
      d.name = nm; noteSaved(d); fresh.push(d);
    }
    if (fresh.length && !LS.set('scrapline.saves', [...fresh, ...have])) return toast('This browser blocked saving');
    if (fresh.length) cloudChanged();
    openLibrary(false);
    toast(fresh.length ? `Imported ${fresh.length} vehicle${fresh.length === 1 ? '' : 's'}${same ? ` (${same} you already had)` : ''}` : 'You already have all of those');
  };
  $('ifile').onchange = e => { const f = e.target.files && e.target.files[0]; if (!f) return; f.text().then(txt => { ta.value = txt; run(txt); }); };
  $('modal').onclick = e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.back) return openLibrary(false);
    if (t.dataset.file) $('ifile').click();
    if (t.dataset.imp) run(ta.value);
  };
}
function openSave() {
  const where = CLOUD.kind === 'claude' ? 'Saved vehicles go to your Claude account, so they are on any device you sign in on.'
    : CLOUD.kind === 'code' ? 'Saved vehicles go to the cloud under your save code, so they are on any device you type it on.'
    : CLOUD.siteReady ? 'Saved vehicles stay on this device. To have them on your other devices too, turn on cloud saves in the library.'
    : 'Saved vehicles stay on this device. Export in the library moves them to another.';
  openModal(`<h2>Save vehicle</h2><p>${where} Load them from the library, or spawn them while driving.</p>
    <input type="text" id="saveName" maxlength="40" value="${esc(B.design.name)}" aria-label="Vehicle name">
    <div class="mfoot"><button type="button" class="btn" data-close="1">Cancel</button><button type="button" class="btn primary" data-save="1">Save</button></div>`);
  const doSave = () => {
    const nm = ($('saveName').value || '').trim() || 'Vehicle';
    B.design.name = nm; $('designName').value = nm;
    const l = savedList(); const i = l.findIndex(d => d.name === nm);
    const copy = cloneDesign(B.design);
    if (i >= 0) copy.id = l[i].id;
    noteSaved(copy);
    if (i >= 0) l[i] = copy; else l.unshift(copy);
    if (LS.set('scrapline.saves', l)) { toast(i >= 0 ? `Updated ${nm}` : `Saved ${nm}`); cloudChanged(); } else toast('This browser blocked saving');
    saveCurrent(); closeModal();
  };
  $('modal').onclick = e => { const t = e.target.closest('button'); if (!t) return; if (t.dataset.close) closeModal(); if (t.dataset.save) doSave(); };
  $('saveName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSave(); } });
  $('saveName').select();
}
function openNew() {
  openModal(`<h2>Start a new vehicle?</h2><p>The current build is replaced by a lone seat. Undo brings it back.</p>
    <div class="mfoot"><button type="button" class="btn" data-close="1">Keep building</button><button type="button" class="btn primary" data-new="1">Start new</button></div>`);
  $('modal').onclick = e => { const t = e.target.closest('button'); if (!t) return; if (t.dataset.close) closeModal(); if (t.dataset.new) { bNew(); closeModal(); } };
}
function openHelp(tab) {
  const kb = (a, b) => `<span>${a}</span><span>${b}</span>`, K = id => actKbd(id), K2 = (x, y) => kbd(actKeys(x)[0] || '') + kbd(actKeys(y)[0] || '');
  const click = COARSE ? 'tap' : 'click', Click = COARSE ? 'Tap' : 'Click';
  const TABS = [['keys', 'Keys'], ['build', 'Building'], ['terra', 'Terra'], ['space', 'Space'], ['bases', 'Bases'], ['saves', 'Saving']];
  const P = {
    keys: `<div class="cols">
    <div><span class="lab">Build</span><div class="ctlgrid">
      ${kb(K('b_build'), 'Build: click a face to place the part, right-click deletes')}
      ${kb(K('b_select'), 'Select: click, Shift-click, drag a box, double-click a branch')}
      ${kb(K('b_config'), 'Configure: click a part to set its keys and settings')}
      ${kb(K('b_paint'), 'Paint')}
      ${kb(K('b_rot') + K('b_tilt'), 'Rotate, tilt (the part, or the selection)')}
      ${kb(K('b_move') + K('b_copy'), 'Move, copy the selection')}${kb('<kbd>Del</kbd>', 'Delete the selection')}
      ${kb('<kbd>Arrows</kbd>', 'Slide the selection; Shift+↑↓ up and down')}
      ${kb(K('b_undo') + K('b_redo'), 'Undo, redo (Ctrl+Z, Ctrl+Y too)')}${kb(K('b_mirror'), 'Mirror')}
      ${kb(K('b_forces') + K('b_air') + K('b_keys'), 'Forces, air drag and part keys views')}
      ${kb('<kbd>Drag</kbd> <kbd>Right-drag</kbd>', 'Turn the camera')}${kb('<kbd>Shift</kbd>+<kbd>Drag</kbd>', 'Slide the view (two fingers on a touchscreen)')}
      ${kb('<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> <kbd>Q</kbd><kbd>E</kbd>', 'Move and turn the camera')}${kb('<kbd>Scroll</kbd>', 'Zoom')}${kb(K('b_focus'), 'Refocus')}
      ${kb(K('build'), 'Drive it')}${kb('<kbd>Esc</kbd>', 'Menu (or the Menu button, top left)')}
    </div></div>
    <div><span class="lab">Drive</span><div class="ctlgrid">
      ${kb(K('fwd'), 'Drive forward, plane and boat thrust')}${kb(K('back'), 'Brake, keep holding to reverse')}
      ${kb(K2('pitch_dn', 'pitch_up'), 'Nose down, nose up')}${kb(K2('left', 'right'), 'Steer, yaw, rudder')}${kb(K2('roll_l', 'roll_r'), 'Roll')}
      ${kb(K2('thr_full', 'thr_off'), 'Throttle lever full, off: rockets, jets, props')}${kb(K('stage'), 'Separate the next stage')}
      ${kb(K('sas'), 'SAS on, off; the buttons under the gauges point it')}${kb(K('rcs'), 'RCS translate: the steering keys slide the craft')}
      ${kb(K2('hinge_a', 'hinge_b'), 'Swing hinges')}${kb(K2('rotor_l', 'rotor_r'), 'Turn rotors')}${kb(K2('piston_out', 'piston_in'), 'Extend, retract pistons')}
      ${kb(K2('winch_in', 'winch_out'), 'Winch in, out')}${kb(K('grab'), 'Claws and hooks grab, let go')}${kb(K('chute'), 'Parachutes open, cut')}${kb(K('gear'), 'Landing gear up, down')}
      ${kb(K('undock'), 'Undock, let go of a skyhook, ground anchor')}${kb(K('fire'), 'Fire weapons')}
      ${kb(K('boost'), 'Afterburners')}${kb(K2('fwd', 'descend'), 'Helicopter rotors climb, sink; let go to hover')}${kb(K('horn'), 'Horn')}
      ${kb(K('detach'), 'Detachers let go')}${kb(K('spin'), 'Spinners on, off')}${kb(K('lights'), 'Light bars on, off')}
      ${kb(K('flip'), 'Flip upright')}${kb(K('respawn'), 'Respawn')}${kb(K('keys'), 'Show or hide the key list')}
      ${kb(K('camera'), 'Chase or free camera')}${kb(K('map'), 'Map and orbit line')}${kb(K2('map_out', 'map_in'), 'Zoom the map')}
      ${kb(K2('warp_dn', 'warp_up'), 'Time warp slower, faster')}${kb(K('build'), 'Back to the builder')}
    </div></div>
  </div>
  <div class="mfoot" style="justify-content:flex-start"><button type="button" class="btn" data-keys="1">Change keys</button></div>`,
    build: `<p>Pick a part on the left and ${click} a face of your vehicle to stick it on. The tool strip next to the right panel switches tools and building views. Select grabs groups of parts: drag a box around them, Shift-click to add, or double-click a part to take it with everything built onto it. Then move it, turn it, copy it, mirror it to the other side, paint it or delete it. Undo and redo go back and forth through every change.</p>
  <p>Configure is where each part gets its own keys and settings, like in Trailmakers: wheel power, top speed and steering, engine power, flap swing, hinge angle limits and speed, piston stroke, which key fires each rocket or decoupler, and more. A grey key follows your Controls settings; set one of its own and it turns orange. The Keys view labels every part with the keys it answers to.</p>
  <p>Forces (on to start with, the Forces button in the tool strip turns it off) shows the centre of mass (orange), centre of thrust with its push (red), centre of lift (blue) and of buoyancy (teal), and warns when they would make the craft turn or flip. Air drag paints every face the wind hits head-on red and tells you the drag at 100 km/h.</p>
  <span class="lab">Parts</span>
  <p>Blocks and Shapes make the frame, from small wedges to 215 m Sky Trusses. Land has wheels from Tiny to Giant, Tracks that turn on the spot, Hover Pads, an Engine, Landing Gear and Rail Bogies. Air has propellers, jets, wings, flaps, helicopter rotors that hold their height, balloons and parachutes. Sea has floats, hulls, propellers, a rudder and an Outboard Motor. Space has rocket engines, tanks, decouplers, docking ports, RCS, the Plasma Thruster, the Star Drive and Storage Modules. Gadgets has claws, a winch, a magnet, a horn and a bumper. Weapons fire from their top face with ${K('fire')}, and their shots fly through your own vehicle. Decor has number plates, signs, flags and lights; Control has seats, a cabin and headlights.</p>
  <p>Moving has hinges, rotors, pistons, servos, ball joints, couplers, detachers, drills and spinners. They split a vehicle into pieces: whatever you build on a moving part's top face moves. If it also touches the rest of the vehicle the part is stuck, and the builder shows it glowing red.</p>
  <p>Logic blocks press keys for you. A Sensor watches height, speed, climb, tilt, distance ahead or fuel and presses a key while the reading is past your value. A Timer waits and then presses a key for a while, a Logic Gate combines two keys, and a Toggle Switch latches on and off. They can press real keys or channels (Ch 1 to Ch 8) that only parts and other logic blocks hear: set a parachute to Ch 1 and a sensor to press Ch 1 when below 300 m, and it opens by itself. The Auto Rocket in the library shows how.</p>
  <span class="lab">Driving</span>
  <p>${K('build')} or Drive takes you from the builder to the world, at the place picked under Spawn at, and back again; going back clears away the vehicle you were driving. Park &amp; build leaves it out in the world instead, and Vehicles lists everything you have left out so you can drive it again. Hard hits knock parts loose; fuel tanks and explosives blow up.</p>`,
    terra: `<p>Terra is 10 km in radius and turns once every 10 minutes. Highways run out from the launch pad to the city of Grand Metro and to towns, villages and farms all round the planet, over long bridges and through tunnels with the hills over them. Near the pad are Liftoff and Rocket City, an airport, a harbor, a race track that times your laps (drive through the start line, then every orange gate) and a stunt park with jumps, a half-pipe and a loop. Cones, barrels and crates go flying. Under Landmarks, Summit Station sits on the highest peak and the Deep Sea Base on the deepest sea floor. The wider world is built as you come near it, so far-off places appear as you travel.</p>
  <span class="lab">Wrecking</span>
  <p>Buildings, street lights and traffic lights can be knocked down with one big hit. A house falls to a car at highway speed or a cannon shell; a shop needs a heavy truck or a bomb; a tower block a bomb right against it (bombs going off together add up). Down it goes in a cloud of dust and leaves a pile of rubble you can drive over. Smaller hits do nothing, and bullets just bounce off. Trains come off their rails if you ram them hard, blast them, or leave something big on the track. A few minutes later, once you are well away, everything is put back and a fresh train sets out from the last station.</p>
  <span class="lab">Railways</span>
  <p>Three railway lines link eight stations, and a train runs on each by itself, stopping at every station. Drive up a station's ramp onto a flat car, or pick a ride under Spawn at, Railways: whatever stands on a train is carried along. The rails stand up from the ground, so crossing them is a bump.</p>
  <p>Build your own train with Rail Bogies (Land). Drive one from a station (pick it under Spawn at, Railways) and it is set down on the nearest track; Powered Rail Bogies pull it and plain ones just roll. Take a bend too fast and it comes off the rails: a chip under the gauges warns of bends ahead and the speed to take them at. ${K('respawn')} puts it back. The Locomotive in the library is one to start from.</p>
  <span class="lab">Graphics</span>
  <p>Balanced and Sharp have a painted sky with sunsets, waves on the sea, trees, finer ground and reflections on vehicles; Sharp reaches furthest and adds tree shadows. Drive into a tree fast and it falls over. Fast keeps things light for Chromebooks. Settings changes it.</p>`,
    space: `<p>Terra's air thins out by 5 km; above that only rockets work. Low orbit needs about 260 m/s sideways: watch the periapsis in the orbit panel climb above 5 km. Launch east, because Terra's spin carries you east at about 105 m/s. The Moon circles 42 km out over Terra's equator, with one-sixth gravity, so landing legs help.</p>
  <p>${K('sas')} turns SAS on. It uses gyroscopes, RCS blocks and control flaps to hold the craft where you leave it. The buttons under the gauges point it instead: prograde (where you're going), retrograde (for braking burns), normal and anti-normal (to tilt an orbit), radial out and in, at your target, or level with the ground. Steering keys still work while it's on.</p>
  <span class="lab">Map and targets</span>
  <p>${K('map')} opens the map with your orbit line. ${Click} a world, a moon or a vehicle to centre the map on it, and the map stays on it as you zoom out. Double-${click} one to make it your target: the orbit panel then shows how close you will pass, and SAS can point at it. Drag to turn the map, Shift-drag (or two fingers) to move it, and the buttons at its top take you back to your vehicle or clear the target.</p>
  <span class="lab">Further out</span>
  <p>Time warp (${K2('warp_dn', 'warp_up')}) goes up to ×5 in air or near the ground, ×100 with engines firing in space, ×10,000 coasting, and ×1,000,000 out between the stars.</p>
  <p>The Sun is about 6,800 km away, and seven more worlds circle it: lava-flooded Cinder, desert Dune, jungle Mire, icy Frost, tiny Shard, and the gas giants Tempest and Azure, with ten more moons between them. From low orbit about 150 m/s more breaks free of Terra; open the map, zoom out, and burn until your path reaches another world's orbit.</p>
  <p>Four more stars lie far beyond the Sun. Ruby is a dim red dwarf; its world Iris always shows it the same face, scorched on the day side, frozen on the night side, with a ring of purple life in between. Duet is two suns circling each other, so the desert world Mirage gets two shadows. Sapphire is a blazing blue giant with Lagoon, a world of islands and palms, and Crown, a ringed giant. Maw is a black hole: its glowing disk bends round it and is the only light on dark Gloom. You can fly right through the disk and skim past the hole, but fall in past its black horizon and its tides tear you apart. To get there, break free of the Sun (about 750 m/s more than leaving Terra) and coast out past the edge of its system, or take the Starfarer. Every world is also under Spawn at.</p>
  <p>The Space Elevator in the library is 50 Sky Trusses on a Ground Anchor, reaching 10.75 km up. ${K('stage')} lets the climber go, then hold ${K('fwd')} to drive up; at the top ${K('stage')} again lets the rocket float free, already in orbit. For a Skyhook, spawn it at Skyhook orbit and catch its grapple with the Skylark's docking port.</p>`,
    bases: `<p>Storage Modules (Space) carry crates of base parts: 12 in a Storage Module, 40 in a Big Storage Module. Build them onto a truck, a lander or a rocket and take them anywhere: the Moon, Iris, Gloom.</p>
  <p>Land, stop, and Base mode appears under the gauges. Pick a piece along the bottom and ${click} the ground to set it down; each one uses up crates. Turn spins the piece, and Take back picks one up again, its crates going back aboard. The pieces are a Habitat, a Greenhouse, Corridors, a Solar Array, a Landing Pad, a Hangar, a Fuel Tank, a Comms Mast, a Light Mast, a Supply Depot and Walls.</p>
  <p>A base with a habitat, a greenhouse and solar power becomes a colony. Every base is under Spawn at, Your bases (on its landing pad if it has one) and shows on the map. The Base Hauler in the library is a truck with 24 crates to start with.</p>`,
    saves: `<p>Save in the builder keeps the vehicle you are working on, and the library holds your saved vehicles beside the examples. Vehicles you leave out in the world and your bases stay where they are when you close the game.</p>
  <p>Cloud saves: played here in Claude while you are signed in, your saved vehicles and bases go to your Claude account, so they are there on any device where you open Scrapline signed in. On the Scrapline website, turn on cloud saves in the library to get a save code, and type that code on your other devices.</p>
  <p>Export and Import in the library move vehicles as a block of text you can paste anywhere, to a friend or to another copy of the game.</p>`
  };
  const t = P[tab] ? tab : 'keys';
  openModal(`<h2>How to play</h2>
  <div class="seg htabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-ht="${k}" class="${k === t ? 'on' : ''}">${l}</button>`).join('')}</div>
  <div class="hpane">${P[t]}</div>
  <div class="mfoot"><button type="button" class="btn primary" data-close="1">Got it</button></div>`, true);
  $('modal').onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.close) closeModal(); if (b.dataset.keys) openControls(); if (b.dataset.ht) openHelp(b.dataset.ht); };
}
function openSettings() {
  const s = G.settings;
  const seg = (k, opts) => `<div class="seg" data-set="${k}">${opts.map(o => `<button type="button" data-v="${o[0]}" class="${s[k] === o[0] ? 'on' : ''}">${o[1]}</button>`).join('')}</div>`;
  openModal(`<h2>Settings</h2>
    <div class="setrow"><span>Graphics</span>${seg('quality', [['low', 'Fast'], ['balanced', 'Balanced'], ['high', 'Sharp']])}</div>
    <p style="font-size:13px" id="setQNote"></p>
    <label class="toggle"><input type="checkbox" id="setShadows" ${s.shadows ? 'checked' : ''}> Shadows</label>
    <div class="setrow"><span>Sound</span><span class="rng"><input type="range" id="setVol" min="0" max="1" step="0.05" value="${s.volume}" aria-label="Volume"><b id="setVolT">${Math.round(s.volume * 100)}%</b></span></div>
    <label class="toggle"><input type="checkbox" id="setMute" ${s.mute ? 'checked' : ''}> Mute</label>
    <label class="toggle"><input type="checkbox" id="setInvert" ${s.invertPitch ? 'checked' : ''}> Invert pitch (nose-down and nose-up keys swap)</label>
    <div class="setrow"><span>Keys</span><button type="button" class="btn" data-keys="1">Change keys</button></div>
    <div class="mfoot"><button type="button" class="btn primary" data-close="1">Done</button></div>`);
  // what each Graphics setting does; Fast has no shadows at all, so the Shadows box is greyed out with it
  const qNote = () => {
    const q = G.settings.quality, sh = $('setShadows');
    $('setQNote').textContent = q === 'low' ? 'Fast: no shadows, trees close by only, a plain sea, ground and vehicles, and a simple black hole. Use it if a Chromebook stutters.'
      : q === 'high' ? 'Sharp: the most detail. Trees reach furthest and cast shadows, shadows are crisper, and the black hole is drawn with the finest light-bending.'
      : 'Balanced: a painted sky, waves, trees, shiny vehicles and a black hole that bends light, at a speed most computers keep up with.';
    sh.disabled = q === 'low'; sh.closest('label').classList.toggle('dim', q === 'low');
  };
  const save = () => { LS.set('scrapline.settings', G.settings); applyQuality(); SND.applyVolume(); qNote(); };
  $('modal').onclick = e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.close) return closeModal();
    if (t.dataset.keys) return openControls();
    const sg = t.closest('[data-set]');
    if (sg) { G.settings[sg.dataset.set] = t.dataset.v; for (const b of sg.querySelectorAll('button')) b.classList.toggle('on', b === t); save(); }
  };
  qNote();
  $('setShadows').onchange = e => { G.settings.shadows = e.target.checked; save(); };
  $('setInvert').onchange = e => { G.settings.invertPitch = e.target.checked; save(); bindsChanged(false); renderKeys(); };
  $('setMute').onchange = e => { G.settings.mute = e.target.checked; SND.unlock(); save(); };
  $('setVol').oninput = e => { G.settings.volume = +e.target.value; $('setVolT').textContent = Math.round(G.settings.volume * 100) + '%'; SND.unlock(); SND.applyVolume(); };
  $('setVol').onchange = () => { save(); SND.play('beep'); };
}
/* Controls: every action and its keys; click a key to change it */
function openControls() {
  const row = a => `<div class="krow"><span>${esc(a[1])}</span><span class="kb">${[0, 1].map(i => { const k = BINDS[a[0]][i]; return `<button type="button" class="keybtn${k ? '' : ' empty'}" data-act="${a[0]}" data-i="${i}">${k ? esc(keyName(k)) : '+'}</button>`; }).join('')}${BINDS[a[0]].join() !== a[3].join() ? `<button type="button" class="mini" data-reset="${a[0]}" title="Back to ${esc(a[3].map(keyName).join(', '))}">↺</button>` : ''}</span></div>`;
  openModal(`<h2>Controls</h2><p>Click a key to change it, then press the new key (hold Shift for a Shift+ key, Esc cancels, Delete clears a second key). Parts follow these unless you give one its own key with the Configure tool.</p>
    <div class="cols">${[['Drive', 'Fly', 'General'], ['Parts', 'Builder']].map(col => `<div class="kcol">${col.map(g => `<span class="lab">${g}</span><div class="klist">${ACTIONS.filter(a => a[2] === g).map(row).join('')}</div>`).join('')}</div>`).join('')}</div>
    <div class="mfoot"><button type="button" class="btn danger" data-all="1">Reset all</button><button type="button" class="btn primary" data-close="1">Done</button></div>`, true);
  $('modal').onclick = e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.close) { closeModal(); return; }
    if (t.dataset.all) { for (const a of ACTIONS) BINDS[a[0]] = a[3].slice(); bindsChanged(); afterBinds(); openControls(); return; }
    if (t.dataset.reset) { BINDS[t.dataset.reset] = ACT[t.dataset.reset].def.slice(); bindsChanged(); afterBinds(); openControls(); return; }
    if (t.dataset.act) {
      if (CAPTURE) return;
      const id = t.dataset.act, i = +t.dataset.i; t.textContent = 'Press a key'; t.classList.add('wait');
      captureKey(code => {
        if (code && (code === 'Delete' && i === 1)) code = '';
        if (code !== null) {
          const L = BINDS[id].slice();
          if (code === '') L.splice(i, 1); else { L[i] = code; if (L[1 - i] === code) L.splice(1 - i, 1); }
          BINDS[id] = L.filter(k => k).slice(0, 2);
          bindsChanged(); afterBinds();
          const ctx = ACT[id].group === 'Builder' ? ['Builder'] : ['Drive', 'Fly', 'Parts', 'General'];
          const clash = code ? ACTIONS.filter(a => a[0] !== id && ctx.includes(a[2]) && BINDS[a[0]].includes(code)).map(a => a[1].toLowerCase()) : [];
          if (clash.length) toast(`${keyName(code)} also does: ${clash.join(', ')}`, 3200);
        }
        openControls();
      });
    }
  };
}
function afterBinds() { renderKeys(); if (G.mode === 'build') { syncTools(); renderPartInfo(); buildKeyLabels(); } renderSAS(); }
const SHALLOWS = { Terra: 0x3aa6a4, Mire: 0x4b9a72, Iris: 0x4e8c94, Lagoon: 0x30d0d4 };
/* the plain water or the wave shader, on every sea and on the pieces of it already built */
function setWaterStyle(fancy) {
  for (const c of SEAS) {
    if (!c.wmatFancy) continue;
    const m = fancy ? c.wmatFancy : c.wmatBasic; if (c.wmat === m) continue;
    c.wmat = m; c.ter.wmat = m;
    c.ter.group.traverse(o => { if (o.material === c.wmatFancy || o.material === c.wmatBasic) o.material = m; });
  }
}
function applyQuality() {
  const q = G.settings.quality;
  setWaterStyle(q !== 'low'); setGroundDetail(q === 'low' ? 0 : q === 'high' ? 2 : 1); setFloraQuality(q); setShine(q); sky.hole.setQuality(q);
  renderer.setPixelRatio(q === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, q === 'high' ? 1.75 : 1.25));
  const sh = G.settings.shadows && q !== 'low', stype = q === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  if (renderer.shadowMap.enabled !== sh || renderer.shadowMap.type !== stype) {
    renderer.shadowMap.enabled = sh; renderer.shadowMap.type = stype;
    scene.traverse(o => { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); } });
    for (const k of ['terrain', 'moon', 'water', 'veh', 'hl', 'paint', 'glass', 'strut', 'foot']) if (MAT[k]) MAT[k].needsUpdate = true;
    for (const c of CELS) { if (c.mat) c.mat.needsUpdate = true; if (c.wmat) c.wmat.needsUpdate = true; }
  }
  sunLight.castShadow = sh; sun2.castShadow = sh;
  const ms = q === 'high' ? 2048 : 1024;
  if (sunLight.shadow.mapSize.x !== ms) { sunLight.shadow.mapSize.set(ms, ms); if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; } }
  const k = q === 'low' ? 1.6 : q === 'high' ? 2.6 : 2.1;
  for (const c of ROCKY) c.ter.splitK = k;
  G.budget = q === 'low' ? 3 : q === 'high' ? 6 : 4.5;
  onResize();
}
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  FX.mat.uniforms.scale.value = h * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
}
function buildUI() {
  renderCats(); renderParts(); renderPartInfo(); renderKeys();
  $('catTabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; curCat = b.dataset.cat; renderCats(); renderParts(); };
  $('partGrid').onclick = e => {
    const b = e.target.closest('button'); if (!b) return; b.blur();
    if (B.pasting) cancelPaste();
    B.sel = b.dataset.part; B.tilt = 0; if (PD[B.sel].kind === 'wheel') B.rotK = 0;
    renderPartInfo(); setTool('build'); sfx('tick');
  };
  $('toolbar').onclick = e => {
    const b = e.target.closest('button'); if (!b) return; b.blur();
    if (b.dataset.tool) setTool(b.dataset.tool);
    else if (b.dataset.view) toggleView(b.dataset.view);
    else if (b.id === 'tbUndo') bUndo(); else if (b.id === 'tbRedo') bRedo();
  };
  ctxEvents();
  $('btnBase').onclick = e => { e.currentTarget.blur(); enterBaseMode(); };
  $('mapBar').onclick = e => {
    const t = e.target.closest('button'); if (!t) return; t.blur();
    const a = t.dataset.mb;
    if (a === 'me' && G.player && !G.player.dead) mapSetFocus({ body: G.player });
    else if (a === 'home') mapSetFocus(null);
    else if (a === 'clear') setTarget(null);
    else if (a === 'pick') openTargetPicker();
  };
  $('sasRow').onclick = e => { const b = e.target.closest('button'); if (!b) return; b.blur(); if (b.dataset.sas === 'toggle') toggleSAS(); else setSASMode(b.dataset.sas); SND.play(SAS.on ? 'beep' : 'boop'); };
  $('designName').oninput = e => { B.design.name = e.target.value.slice(0, 40) || 'Vehicle'; saveCurrent(); };
  $('btnNew').onclick = openNew; $('btnSave').onclick = openSave; $('btnLibrary').onclick = () => openLibrary(false);
  $('btnGoDrive').onclick = () => setMode('drive');
  $('btnGoDrive').innerHTML = `Drive it ${kbd(actKeys('build')[0])}`;
  $('btnBuild').onclick = () => setMode('build'); $('btnDrive').onclick = () => setMode('drive');
  $('btnSpawnVeh').onclick = () => openLibrary(true);
  $('btnVehicles').onclick = openVehicles;
  $('btnPark').onclick = () => { if (G.mode === 'drive') setMode('build', false, null, true); };
  // Settings and How to play live in the Menu (top left)
  $('keys').onclick = toggleKeys;
  // the top bar wraps onto two rows on narrow screens: the panels under it follow its real height
  { const tb = $('topbar'), setH = () => document.documentElement.style.setProperty('--topH', Math.round(tb.getBoundingClientRect().height) + 'px');
    setH(); if (window.ResizeObserver) new ResizeObserver(setH).observe(tb); else window.addEventListener('resize', setH); }
  $('toolsToggle').onclick = () => $('toolsPanel').classList.toggle('open');
  $('modalWrap').addEventListener('pointerdown', e => { if (e.target === $('modalWrap')) { CAPTURE = null; closeModal(); } });
  const sel = $('spawnSel');
  fillSpawnSel();
  sel.onchange = () => { G.spawnLoc = sel.value; sel.blur(); if (G.mode === 'drive') { spawnPlayer(true); toast(`Spawned at ${WORLD.locs[G.spawnLoc].name}`); } };
  // what the menu shows is always where you spawn
  sel.addEventListener('focus', () => { sel.value = G.spawnLoc; });
  window.addEventListener('resize', onResize);
  syncTools();
}
/* the Spawn at list, grouped (your own bases appear in it as you build them) */
function fillSpawnSel() {
  const sel = $('spawnSel'), groups = {};
  for (const [k, v] of Object.entries(WORLD.locs)) (groups[v.group] = groups[v.group] || []).push(`<option value="${k}">${esc(v.name)}</option>`);
  sel.innerHTML = Object.entries(groups).map(([g, o]) => `<optgroup label="${esc(g)}">${o.join('')}</optgroup>`).join('');
  if (!WORLD.locs[G.spawnLoc]) G.spawnLoc = 'pad';
  sel.value = G.spawnLoc;
}
/* ---------------- main loop ---------------- */
let last = 0, acc = 0;
const _fv = new V3(), _fv2 = new V3();
const TERS = [];
function updateTerrains(focus) {
  for (const c of ROCKY) {
    const d = camera.position.distanceTo(c.center);
    c.ter.camD = d - c.R;
    // worlds smaller than a pixel are left to their beacon dots
    const vis = c.R / d > 0.0012;
    c.ter.group.visible = vis; c.ter.skip = !vis;
    if (!vis) continue;
    c.ter.group.position.copy(c.center); c.ter.group.quaternion.copy(c.spinQ);
    c.ter.update(toSpin(c, _fv.subVectors(focus, c.center), _fv), toSpin(c, _fv2.subVectors(camera.position, c.center), _fv2));
  }
  TERS.sort((a, b) => a.camD - b.camD);
  const t0 = performance.now();
  for (const t of TERS) {
    if (t.skip || !t.queue.length) continue;
    const left = G.budget - (performance.now() - t0);
    if (left < 0.25) break;
    t.process(left);
  }
}
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (!(dt > 0)) dt = 0.016; if (dt > 0.1) dt = 0.1;
  if (TITLE.on) titleStep(dt);
  else if (G.mode === 'drive' && !TITLE.pause) {
    driveControls(dt);
    if (G.warp > 1) {
      const [lim, why] = warpLimit();
      if (G.warp > lim) { let i = WARPS.indexOf(G.warp); while (i > 0 && WARPS[i] > lim) i--; G.warp = WARPS[i]; toast(why || (G.warp > 1 ? `Time warp reduced to ×${G.warp}` : 'Time warp stopped'), 1800); }
    }
    if (G.warp >= RAILS) { acc = 0; railsAdvance(dt * G.warp); }
    else {
      // big warps take longer steps so the frame rate holds; anything near a surface waits it out
      const sdt = G.warp > 5 ? FIXED_DT * G.warp / 5 : FIXED_DT;
      acc += dt * G.warp;
      let steps = 0; const maxS = G.warp > 1 ? 60 : 7;
      while (acc >= sdt && steps < maxS) { physicsStep(sdt); acc -= sdt; steps++; }
      if (steps >= maxS) acc = 0;
      if (steps) floraContacts();
    }
    exhaustFX(dt);
    const p = G.player;
    if (p && !p.dead && (p.heat > 0.15 || p.crush > 0.2 || p.aero > 0.08)) FX.heat(p, Math.max(p.heat, p.crush, Math.min(1, p.aero)));
  }
  drawShots();
  for (const b of W.bodies) {
    b.updateVisual(dt);
    // keep the garage clear: parked vehicles near the pad are hidden while you build
    b.group.visible = !(G.mode === 'build' && !TITLE.on && b.x.distanceTo(B.padPoint) < 30 + b.radius) && !(b.loose && b.x.distanceTo(camera.position) > 450);
  }
  for (const pr of W.props) if (pr.mesh) { fromSpin(pr.cel, pr.c, pr.mesh.position).add(pr.cel.center); pr.mesh.quaternion.copy(pr.cel.spinQ); }
  updateSites(dt); updateRace(); wreckFrame(dt);
  if (TITLE.on) { }
  else if (G.mode === 'build') { nearFar(); bCamera(dt); }
  else if (G.map) mapCamera(dt);
  else { nearFar(); driveCamera(dt); }
  G.shake *= Math.exp(-dt * 5);
  const focus = G.map && G.player && !G.player.dead ? G.player.x : camera.position;
  updateTerrains(focus); updateFlora(dt);
  sky.update(camera.position, stage, stage.fog, sunLight, ambient, G.map);
  if (G.mode === 'build' && sunLight.intensity < 0.7) ambient.intensity = Math.max(ambient.intensity, 1.0 - sunLight.intensity * 0.8);
  updateLights();
  const st = TITLE.on && TITLE.focus && !TITLE.focus.dead ? TITLE.focus.x : G.mode === 'drive' && G.player && !G.player.dead ? G.player.x : B.group.position;
  sunLight.target.position.copy(st); sunLight.position.copy(st).addScaledVector(SUN_DIR, 160);
  // the sky's own light (from above) and moonlight
  { const ss = sky.state; hemi.intensity = ss.hemi; hemi.position.copy(ss.up); hemi.color.copy(sky.domeU.zen.value).lerp(_wh, 0.45); hemi.groundColor.copy(sky.fogCol).multiplyScalar(0.42);
    const wm = ss.moonK > 0.004; if (moonL.visible !== wm) moonL.visible = wm;
    if (wm) { moonL.intensity = ss.moonK; moonL.target.position.copy(st); moonL.position.copy(st).addScaledVector(ss.moonDir, 160); } }
  const s2 = sky.state.light2 || 0, want2 = s2 > 0.02;
  if (sun2.visible !== want2) sun2.visible = want2;
  if (want2) { sun2.intensity = s2; sun2.color.setHex(sky.state.light2Col); sun2.target.position.copy(st); sun2.position.copy(st).addScaledVector(SUN2_DIR, 160); }
  FX.frame(camera.position);
  FX.update(dt);
  if (G.mode === 'build' && B.needsHover && !TITLE.on) bHover();
  G.hudT -= dt;
  if (G.mode === 'drive' && G.hudT <= 0) { G.hudT = 0.1; updateHUD(); }
  if (G.mode === 'drive' && G.player && !G.player.dead) {
    G.predT -= dt;
    if (G.predT <= 0) {
      if (G.map) { G.predT = 0.6; predictOrbit(G.player); }
      else { G.predT = G.warp >= RAILS ? 0.4 : 2; if (inSpace(G.player)) predictOrbit(G.player, false); else MAP.pred = null; }
    }
  }
  updateMapTracks(dt);
  placeMapLines();
  updateTint();
  updateWater(camera, performance.now() / 1000);
  updateEnv(dt);
  // floating origin: draw everything relative to the camera so far-flung worlds stay precise on the GPU
  RO.copy(camera.position);
  scene.position.copy(RO).negate();
  camera.position.set(0, 0, 0);
  renderer.render(stage, camera);
  camera.position.copy(RO); camera.updateMatrixWorld();
  updateMapLabels();
  if (G.mode === 'build') placeKeyLabels();
  SND.update(dt);
}

/* ---------------- boot ---------------- */
async function init() {
  try {
    setLoad(0.04, 'Shaping continents');
    await nextFrame();
    setupWorld();
    setLoad(0.08, 'Laying highways and railways');
    await nextFrame();
    planGlobe();
    initSolar(); initSpawns(); planMoon();
    // the pad's directions in Terra's own frame (time 0), so they can turn with it
    WORLD.L = { up: WORLD.padUp.clone(), fwd: WORLD.padFwd.clone(), right: WORLD.padRight.clone(), east: WORLD.padEast.clone() };
    const ss = LS.get('scrapline.settings', {}) || {}, views = { ...G.settings.views, ...(ss.views || {}) };
    if (ss.showCom === false && !ss.views) views.com = false;
    // Forces is on by default since V17; turn it on once for players who had it off without knowing it was there
    if (!ss.forcesOn) { views.forces = true; ss.forcesOn = true; }
    Object.assign(G.settings, ss); G.settings.views = views; delete G.settings.showCom;
    loadBinds();
    setLoad(0.14, 'Starting the renderer');
    await nextFrame();
    renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    stage = new THREE.Scene(); stage.fog = new THREE.Fog(0x8cbfe0, 600, 9000);
    scene = new THREE.Group(); stage.add(scene);
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1e9);
    raycaster = new THREE.Raycaster();
    initMaterials();
    sunLight = new THREE.DirectionalLight(0xfff2de, 1.05);
    sunLight.castShadow = true; sunLight.shadow.mapSize.set(1024, 1024);
    const sc = sunLight.shadow.camera; sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 420;
    sunLight.shadow.bias = -0.0006; sunLight.shadow.normalBias = 0.04;
    scene.add(sunLight, sunLight.target);
    // a second sun, for twin stars: its own light and its own shadows
    sun2 = new THREE.DirectionalLight(0xffc07c, 0); sun2.visible = false;
    sun2.shadow.mapSize.set(1024, 1024); Object.assign(sun2.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 420 });
    sun2.shadow.bias = -0.0006; sun2.shadow.normalBias = 0.04;
    scene.add(sun2, sun2.target);
    ambient = new THREE.AmbientLight(0xb6cbe0, 0.42); stage.add(ambient);
    hemi = new THREE.HemisphereLight(0xcfe0f2, 0x5c5040, 0.2); stage.add(hemi);
    moonL = new THREE.DirectionalLight(0xb8c8ff, 0); moonL.visible = false; scene.add(moonL, moonL.target);
    // one terrain per landable world, each with its own materials so fog only touches the air you are in
    for (const c of ROCKY) {
      c.mat = c === PLANET ? MAT.terrain : c === MOON ? MAT.moon : new THREE.MeshLambertMaterial({ vertexColors: true, fog: false });
      if (c.sea) c.wmat = c === PLANET ? MAT.water : c.sea.lava ? new THREE.MeshBasicMaterial({ color: c.sea.color, fog: false })
        : new THREE.MeshPhongMaterial({ color: c.sea.color, specular: 0x9ec9dc, shininess: 85, transparent: true, opacity: .86, depthWrite: false, fog: false });
      addGroundDetail(c.mat);
      // seas of water get the wave shader (the plain one stays for the Fast setting)
      if (c.sea && !c.sea.lava) { c.wmatBasic = c.wmat; c.wmatFancy = makeWaterMaterial(c.sea.color, SHALLOWS[c.name] || 0x40a0a0); }
      c.ter = new Terrain(c, c.mat, c.wmat || null, c.depth, scene);
      c.ter.group.position.copy(c.center);
      TERS.push(c.ter);
    }
    sky = makeSky(scene);
    sky.makeStarCube(renderer); makeEnv();
    for (const k of ['veh', 'hl', 'paint', 'move', 'sel', 'locked']) { shine(MAT[k], 'veh', 0.2); MAT[k].userData.glossy = true; }
    shine(MAT.glass, 'glass', 0.85, { glass: true }); shine(MAT.strut, 'strut', 0.3);
    initLights();
    buildWorld(); initBases();
    FX.init();
    initMapObjects();
    applyQuality();
    buildExamples();
    bInit();
    const focus = B.padPoint.clone().addScaledVector(WORLD.padUp, 9);
    for (let it = 0; it < 500; it++) {
      let pending = 0;
      for (const c of ROCKY) { const f = toSpin(c, _fv.subVectors(focus, c.center), _fv); c.ter.update(f, f); pending += c.ter.queue.length; }
      if (!pending) break;
      for (const c of ROCKY) if (c.ter.queue.length) c.ter.process(c === PLANET ? 40 : 6);
      if (it % 2 === 0) { setLoad(0.2 + 0.6 * Math.min(1, it / 30), it < 4 ? 'Lighting the Sun' : 'Raising mountains'); await nextFrame(); }
    }
    setLoad(0.86, 'Machining parts'); await nextFrame();
    makeThumbs();
    buildUI();
    bindInput();
    setLoad(1, 'Ready');
    const boot = data => start(data || {});
    if (window.claude && window.claude.hot && typeof window.claude.hot.snapshot === 'function') { try { window.claude.hot.snapshot(() => ({ design: B.design })); } catch (e) { } }
    if (window.claude && window.claude.hot && typeof window.claude.hot.ready === 'function') window.claude.hot.ready(boot);
    else boot((window.claude && window.claude.hot && window.claude.hot.data) || {});
  } catch (err) {
    console.error(err);
    $('ldText').textContent = 'Scrapline could not start: ' + (err && err.message ? err.message : err) + '. WebGL may be turned off in this browser.';
  }
}
let started = false;
function start(data) {
  if (started) return; started = true;
  let d = data && data.design ? sanitizeDesign(data.design) : null;
  if (!d) d = sanitizeDesign(LS.get('scrapline.current', null));
  if (!d) d = EXAMPLES[0].d;
  bLoad(d);
  const restored = worldLoad();
  spawnLoose();
  G.spawnLoc = 'pad'; $('spawnSel').value = 'pad';
  setMode('build', true);
  uiRot();
  initTitle(); showTitle();
  $('loading').hidden = true;
  last = performance.now();
  requestAnimationFrame(frame);
  cloudInit();
  TITLE.after = () => afterTitle(restored);
}
/* the first things said once you leave the title screen */
function afterTitle(restored) {
  let wait = 600;
  if (restored) { setTimeout(() => toast(`Welcome back: ${restored} vehicle${restored === 1 ? ' is' : 's are'} still out in the world. Open Vehicles to drive one.`, 4200), wait); wait += 4600; }
  if (TITLE.saving) return; TITLE.saving = true;
  setInterval(() => { if (G.mode === 'drive' && !TITLE.on) worldSave(); }, 10000);
  document.addEventListener('visibilitychange', () => { if (document.hidden && !TITLE.on) worldSave(); });
  window.addEventListener('pagehide', () => { if (!TITLE.on) worldSave(); });
  const touch = COARSE;
  if (!LS.get('scrapline.seenHelp', false)) {
    for (const v of ['Help', 'V11', 'V12', 'V13', 'V15', 'V16', 'V17']) LS.set('scrapline.seen' + v, true);
    setTimeout(() => toast(touch ? 'Pick a part, tap the vehicle to attach it, then tap Drive' : `Pick a part, click the vehicle to attach it, then press ${keyName(actKeys('build')[0])} to drive`, 5200), wait);
  } else if (!LS.get('scrapline.seenV17', false)) {
    const v16 = LS.get('scrapline.seenV16', false);
    for (const v of ['V11', 'V12', 'V13', 'V15', 'V16', 'V17']) LS.set('scrapline.seen' + v, true);
    setTimeout(() => toast(v16 ? 'New: knock buildings down and throw trains off their rails (it all comes back a few minutes later). The builder now shows Forces from the start.'
      : 'New: trains you build with rail bogies, bases built from crates wherever you land, cloud saves, and buildings and trains you can wreck. Help has more.', 7000), wait);
  }
}
init();

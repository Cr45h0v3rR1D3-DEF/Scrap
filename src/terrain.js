'use strict';
/* ================= Scrapline · terrain LOD, sky, atmosphere ================= */
const FACES = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]];
const _cs = [0, 0, 0];
function faceDir(f, a, b, out) {
  const F = FACES[f];
  const x = F[0][0] + F[1][0] * a + F[2][0] * b, y = F[0][1] + F[1][1] * a + F[2][1] * b, z = F[0][2] + F[1][2] * a + F[2][2] * b;
  const x2 = x * x, y2 = y * y, z2 = z * z;
  let ox = x * Math.sqrt(Math.max(0, 1 - y2 / 2 - z2 / 2 + y2 * z2 / 3));
  let oy = y * Math.sqrt(Math.max(0, 1 - z2 / 2 - x2 / 2 + z2 * x2 / 3));
  let oz = z * Math.sqrt(Math.max(0, 1 - x2 / 2 - y2 / 2 + x2 * y2 / 3));
  const l = Math.hypot(ox, oy, oz); out[0] = ox / l; out[1] = oy / l; out[2] = oz / l;
}
const TN = 16;
class TNode {
  constructor(ter, face, a0, b0, size, depth) {
    this.ter = ter; this.face = face; this.a0 = a0; this.b0 = b0; this.size = size; this.depth = depth;
    this.children = null; this.mesh = null; this.water = null; this.state = 0; this.dead = false; this.prio = 0;
    const cel = ter.cel; faceDir(face, a0 + size / 2, b0 + size / 2, _cs);
    // terrain is built in the world's own frame; the group turns it into place
    const h = cel.heightL(_cs[0], _cs[1], _cs[2]);
    this.c = new V3(_cs[0], _cs[1], _cs[2]).multiplyScalar(cel.R + h);
    this.sizeM = size * 0.7854 * cel.R;
  }
}
class Terrain {
  constructor(cel, mat, waterMat, maxDepth, parent) {
    this.cel = cel; this.mat = mat; this.wmat = waterMat; this.maxDepth = maxDepth;
    this.group = new THREE.Group(); parent.add(this.group);
    this.roots = []; this.queue = []; this.splitK = 2.1; this.focus = new V3();
    for (let f = 0; f < 6; f++) this.roots.push(new TNode(this, f, -1, -1, 2, 0));
    this.pending = 0; this.ver = 0; this.verV = 0;
  }
  update(focus, cam) {
    // verV: how many patches had been built or dropped when this frame's choice of patches to show was made
    this.verV = this.ver; this.focus.copy(focus); this.cam = cam || focus;
    const Ro = this.cel.R - (this.cel.sea ? 150 : 220), cr = this.cam.length();
    this.Ro = Ro; this.dC = cr > Ro ? Math.sqrt(cr * cr - Ro * Ro) : -1;
    for (const r of this.roots) this.visit(r);
  }
  hidden(n) {
    if (this.dC < 0 || n.depth < 2) return false;
    const top = this.cel.R + (n.state === 2 ? Math.max(n.maxH, 0) : this.cel.maxH) + 5;
    const dP = Math.sqrt(Math.max(0, top * top - this.Ro * this.Ro));
    return n.c.distanceTo(this.cam) - n.sizeM * 0.75 > this.dC + dP;
  }
  visit(n) {
    if (this.hidden(n)) { this.hideTree(n); if (n.children) { for (const ch of n.children) this.dispose(ch); n.children = null; } return; }
    const d = n.c.distanceTo(this.focus);
    const split = n.depth < this.maxDepth && d < n.sizeM * this.splitK * (n.children ? 1.12 : 1);
    if (split) {
      if (!n.children) this.makeChildren(n);
      let ready = true;
      for (const ch of n.children) if (ch.state !== 2) { ready = false; this.request(ch, ch.c.distanceTo(this.focus)); }
      if (ready) { this.show(n, false); for (const ch of n.children) this.visit(ch); }
      else { if (n.state !== 2) this.request(n, d); this.show(n, true); for (const ch of n.children) this.hideTree(ch); }
    } else {
      if (n.state !== 2) this.request(n, d);
      this.show(n, true);
      if (n.children) { for (const ch of n.children) this.dispose(ch); n.children = null; }
    }
  }
  request(n, d) { n.prio = d / n.sizeM - n.depth * 0.01; if (n.state === 0) { n.state = 1; this.queue.push(n); } }
  show(n, v) { if (n.mesh) n.mesh.visible = v; if (n.water) n.water.visible = v; }
  hideTree(n) { this.show(n, false); if (n.children) for (const c of n.children) this.hideTree(c); }
  dispose(n) {
    if (n.children) { for (const c of n.children) this.dispose(c); n.children = null; }
    n.dead = true; n.state = 0;
    if (n.mesh) { this.group.remove(n.mesh); n.mesh.geometry.dispose(); n.mesh = null; this.ver++; }
    if (n.water) { this.group.remove(n.water); n.water.geometry.dispose(); n.water = null; }
  }
  makeChildren(n) {
    const s = n.size / 2, d = n.depth + 1;
    n.children = [new TNode(this, n.face, n.a0, n.b0, s, d), new TNode(this, n.face, n.a0 + s, n.b0, s, d),
      new TNode(this, n.face, n.a0, n.b0 + s, s, d), new TNode(this, n.face, n.a0 + s, n.b0 + s, s, d)];
  }
  process(budgetMs) {
    if (!this.queue.length) { this.pending = 0; return 0; }
    this.queue = this.queue.filter(n => !n.dead && n.state === 1);
    this.queue.sort((a, b) => a.prio - b.prio);
    const t0 = performance.now(); let built = 0;
    while (this.queue.length) {
      const n = this.queue.shift();
      this.build(n); built++;
      if (performance.now() - t0 > budgetMs) break;
    }
    this.pending = this.queue.length;
    return built;
  }
  build(n) {
    const cel = this.cel, R = cel.R, S = TN + 3;
    const P = new Float64Array(S * S * 3), D = new Float64Array(S * S * 3), H = new Float32Array(S * S);
    let minH = 1e9, maxH = -1e9;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const a = n.a0 + (i - 1) / TN * n.size, b = n.b0 + (j - 1) / TN * n.size;
      faceDir(n.face, a, b, _cs);
      const h = cel.heightL(_cs[0], _cs[1], _cs[2]);
      const k = j * S + i, r = R + h;
      D[k * 3] = _cs[0]; D[k * 3 + 1] = _cs[1]; D[k * 3 + 2] = _cs[2]; H[k] = h;
      P[k * 3] = _cs[0] * r; P[k * 3 + 1] = _cs[1] * r; P[k * 3 + 2] = _cs[2] * r;
      if (i >= 1 && i <= TN + 1 && j >= 1 && j <= TN + 1) { if (h < minH) minH = h; if (h > maxH) maxH = h; }
    }
    const NV = (TN + 1) * (TN + 1), NE = 4 * TN;
    const pos = new Float32Array((NV + NE) * 3), nor = new Float32Array((NV + NE) * 3), col = new Float32Array((NV + NE) * 3), tl = new Float32Array((NV + NE) * 3);
    const cx = n.c.x, cy = n.c.y, cz = n.c.z, oc = [0, 0, 0];
    const sampleIdx = new Int32Array(NV);
    let vi = 0;
    for (let j = 1; j <= TN + 1; j++) for (let i = 1; i <= TN + 1; i++) {
      const k = j * S + i, k3 = k * 3;
      pos[vi * 3] = P[k3] - cx; pos[vi * 3 + 1] = P[k3 + 1] - cy; pos[vi * 3 + 2] = P[k3 + 2] - cz;
      const ux = P[k3 + 3] - P[k3 - 3], uy = P[k3 + 4] - P[k3 - 2], uz = P[k3 + 5] - P[k3 - 1];
      const ks = (k + S) * 3, kn = (k - S) * 3;
      const vx = P[ks] - P[kn], vy = P[ks + 1] - P[kn + 1], vz = P[ks + 2] - P[kn + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      nor[vi * 3] = nx; nor[vi * 3 + 1] = ny; nor[vi * 3 + 2] = nz;
      const slope = 1 - (nx * D[k3] + ny * D[k3 + 1] + nz * D[k3 + 2]);
      cel.color(H[k], slope, D[k3], D[k3 + 1], D[k3 + 2], oc);
      col[vi * 3] = oc[0]; col[vi * 3 + 1] = oc[1]; col[vi * 3 + 2] = oc[2];
      tl[vi * 3] = P[k3]; tl[vi * 3 + 1] = P[k3 + 1]; tl[vi * 3 + 2] = P[k3 + 2];
      sampleIdx[vi] = k;
      vi++;
    }
    const idx = (i, j) => j * (TN + 1) + i;
    const loop = [];
    for (let i = 0; i < TN; i++) loop.push(idx(i, 0));
    for (let j = 0; j < TN; j++) loop.push(idx(TN, j));
    for (let i = TN; i > 0; i--) loop.push(idx(i, TN));
    for (let j = TN; j > 0; j--) loop.push(idx(0, j));
    const sd = n.sizeM * 0.02 + 3;
    for (let m = 0; m < NE; m++) {
      const v = loop[m], k3 = sampleIdx[v] * 3, w = NV + m;
      pos[w * 3] = pos[v * 3] - D[k3] * sd; pos[w * 3 + 1] = pos[v * 3 + 1] - D[k3 + 1] * sd; pos[w * 3 + 2] = pos[v * 3 + 2] - D[k3 + 2] * sd;
      nor[w * 3] = nor[v * 3]; nor[w * 3 + 1] = nor[v * 3 + 1]; nor[w * 3 + 2] = nor[v * 3 + 2];
      col[w * 3] = col[v * 3] * 0.8; col[w * 3 + 1] = col[v * 3 + 1] * 0.8; col[w * 3 + 2] = col[v * 3 + 2] * 0.8;
      tl[w * 3] = pos[w * 3] + cx; tl[w * 3 + 1] = pos[w * 3 + 1] + cy; tl[w * 3 + 2] = pos[w * 3 + 2] + cz;
    }
    const ind = [];
    for (let j = 0; j < TN; j++) for (let i = 0; i < TN; i++) {
      const a = idx(i, j), b = idx(i + 1, j), c = idx(i, j + 1), d = idx(i + 1, j + 1);
      ind.push(a, b, d, a, d, c);
    }
    for (let m = 0; m < NE; m++) {
      const A = loop[m], B2 = loop[(m + 1) % NE], A2 = NV + m, B3 = NV + (m + 1) % NE;
      ind.push(A, A2, B2, B2, A2, B3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('tl', new THREE.BufferAttribute(tl, 3));
    g.setIndex(ind);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.mat);
    mesh.position.copy(n.c); mesh.receiveShadow = true; mesh.visible = false; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    this.group.add(mesh); n.mesh = mesh; this.ver++;
    n.minH = minH; n.maxH = maxH;
    if (cel.sea && minH < 1.5) {
      const wp = new Float32Array(NV * 3), wn = new Float32Array(NV * 3), wl = new Float32Array(NV * 3), wd = new Float32Array(NV);
      for (let v = 0; v < NV; v++) {
        const k3 = sampleIdx[v] * 3;
        wp[v * 3] = D[k3] * R - cx; wp[v * 3 + 1] = D[k3 + 1] * R - cy; wp[v * 3 + 2] = D[k3 + 2] * R - cz;
        wn[v * 3] = D[k3]; wn[v * 3 + 1] = D[k3 + 1]; wn[v * 3 + 2] = D[k3 + 2];
        // where on the world it is (for the waves) and how deep the water is there (for shallows and foam)
        wl[v * 3] = D[k3] * R; wl[v * 3 + 1] = D[k3 + 1] * R; wl[v * 3 + 2] = D[k3 + 2] * R; wd[v] = -H[sampleIdx[v]];
      }
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.BufferAttribute(wp, 3));
      wg.setAttribute('normal', new THREE.BufferAttribute(wn, 3));
      wg.setAttribute('wl', new THREE.BufferAttribute(wl, 3)); wg.setAttribute('wd', new THREE.BufferAttribute(wd, 1));
      wg.setIndex(ind.slice(0, TN * TN * 6));
      wg.computeBoundingSphere();
      const wm = new THREE.Mesh(wg, this.wmat);
      wm.position.copy(n.c); wm.visible = false; wm.renderOrder = 2; wm.matrixAutoUpdate = false; wm.updateMatrix();
      this.group.add(wm); n.water = wm;
    }
    n.state = 2;
  }
}

/* ---------- ground detail: the colour broken up by noise at a few sizes, so near ground reads as grass, soil and rock
   rather than flat paint. Fades out with distance; off in the Fast setting ---------- */
function addGroundDetail(mat) {
  mat.defines = mat.defines || {};
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 tl; varying vec3 vTL; varying float vDist;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvTL = tl; vDist = -mvPosition.z;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTL; varying float vDist;\n#ifdef DETAIL\n' + GLSL_NOISE + '\n#endif')
      .replace('#include <color_fragment>', `#include <color_fragment>
#ifdef DETAIL
  {
    float fade = 1.0 - smoothstep(80.0, 520.0, vDist);
    float n1 = vnoise(vTL * 0.85), n3 = vnoise(vTL * 0.13);
    float det = (n1 - 0.5) * 0.2 * fade + (n3 - 0.5) * 0.16;
  #if DETAIL > 1
    det += (vnoise(vTL * 3.3) - 0.5) * 0.12 * (1.0 - smoothstep(30.0, 160.0, vDist));
  #endif
    diffuseColor.rgb *= 1.0 + det;
  }
#endif`);
  };
  mat.customProgramCacheKey = () => 'ground' + (mat.defines.DETAIL || 0);
}
function setGroundDetail(level) {
  for (const c of ROCKY) {
    const m = c.mat; if (!m) continue;
    if ((m.defines.DETAIL || 0) === level) continue;
    if (level) m.defines.DETAIL = level; else delete m.defines.DETAIL;
    m.needsUpdate = true;
  }
}
/* ---------- water: waves, reflections of the sky and the sun, turquoise shallows and foam at the shore ---------- */
const WAVES = (() => {
  // a few long and short swells from fixed directions in the world's own frame
  const rnd = mulberry32(17), list = [];
  for (const [lam, sl, sp] of [[26, 0.055, 0.9], [15, 0.05, 1.1], [8.5, 0.045, 1.4], [4.8, 0.035, 1.8], [2.6, 0.025, 2.4]]) {
    const u = rnd() * 2 - 1, th = rnd() * TAU, s = Math.sqrt(1 - u * u), k = TAU / lam;
    list.push(`vec4(${(s * Math.cos(th) * k).toFixed(4)}, ${(u * k).toFixed(4)}, ${(s * Math.sin(th) * k).toFixed(4)}, ${(sl / k).toFixed(5)})`, sp.toFixed(2));
  }
  return list;
})();
function makeWaterMaterial(deep, shallow) {
  const W = [];
  for (let i = 0; i < WAVES.length; i += 2) W.push(`{ vec4 w = ${WAVES[i]}; float ph = dot(w.xyz, p) - t * ${WAVES[i + 1]} * length(w.xyz) * 1.6; g += w.xyz * w.w * cos(ph); }`);
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 }, sunV: { value: new V3(0, 1, 0) }, sunCol: { value: new THREE.Color(1, 1, 1) }, sunK: { value: 1 }, skyHor: { value: new THREE.Color(0x9cc6e2) }, skyZen: { value: new THREE.Color(0x3a6fb0) },
      deepCol: { value: new THREE.Color(deep) }, shalCol: { value: new THREE.Color(shallow) }, toView: { value: new THREE.Matrix3() }, amb: { value: 0.3 } }]),
    vertexShader: `#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
attribute vec3 wl; attribute float wd;
varying vec3 vWL; varying float vDepth; varying vec3 vUp; varying vec3 vView;
void main(){
  vWL = wl; vDepth = wd;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vView = -mvPosition.xyz; vUp = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`,
    fragmentShader: `uniform float time; uniform vec3 sunV; uniform vec3 sunCol; uniform float sunK; uniform vec3 skyHor; uniform vec3 skyZen; uniform vec3 deepCol; uniform vec3 shalCol; uniform mat3 toView; uniform float amb;
varying vec3 vWL; varying float vDepth; varying vec3 vUp; varying vec3 vView;
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
${GLSL_NOISE}
void main(){
  #include <logdepthbuf_fragment>
  float dist = length(vView);
  vec3 p = vWL; float t = time; vec3 g = vec3(0.0);
  ${W.join('\n  ')}
  g *= 1.0 - smoothstep(120.0, 900.0, dist);
  vec3 up = normalize(vUp), gv = toView * g;
  vec3 n = normalize(up - (gv - up * dot(gv, up)));
  vec3 v = normalize(vView);
  float F = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  vec3 sky = mix(skyHor, skyZen, pow(clamp(dot(r, up), 0.0, 1.0), 0.5));
  float rs = max(dot(r, sunV), 0.0);
  float spec = pow(rs, 260.0) * 3.5 + pow(rs, 24.0) * 0.12;
  float sh = clamp(vDepth / 8.0, 0.0, 1.0);
  float lit = amb + sunK * max(dot(up, sunV), 0.0) * 0.8;
  vec3 body = mix(shalCol, deepCol, sh) * lit;
  vec3 col = mix(body, sky, F * 0.85) + sunCol * spec * sunK;
  float fb = 1.0 - smoothstep(0.05, 1.5, vDepth);
  float fn = vnoise(vWL * 0.7 + vec3(0.0, t * 0.35, 0.0)) * 0.6 + vnoise(vWL * 2.1 - vec3(t * 0.25)) * 0.4;
  float foam = fb * smoothstep(0.42, 0.62, fn + fb * 0.3) * (1.0 - smoothstep(200.0, 700.0, dist));
  col = mix(col, vec3(0.93, 0.96, 0.97) * (0.3 + 0.7 * lit), foam * 0.9);
  float a = mix(0.82, 1.0, max(F, foam)) * mix(0.62, 1.0, sh);
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
}`,
    transparent: true, depthWrite: false, fog: true
  });
}
/* each frame: the water's view of the sun and sky */
const _wtq = new Quat(), _wm4 = new THREE.Matrix4(), _wsv = new V3();
function updateWater(cam, t) {
  _wtq.copy(cam.quaternion).invert();
  _wsv.copy(SUN_DIR).applyQuaternion(_wtq);
  for (const c of SEAS) {
    const m = c.wmatFancy; if (!m || c.wmat !== m) continue;
    const U = m.uniforms;
    U.time.value = t; U.sunV.value.copy(_wsv); U.sunCol.value.copy(sunLight.color); U.sunK.value = Math.min(1.3, sunLight.intensity);
    U.skyHor.value.copy(sky.domeU.hor.value); U.skyZen.value.copy(sky.domeU.zen.value); U.amb.value = ambient.intensity + hemi.intensity * 0.6;
    _wm4.makeRotationFromQuaternion(_wtq.clone().multiply(c.ter.group.quaternion)); U.toView.value.setFromMatrix4(_wm4);
  }
}
/* ---------- sky ---------- */
function makeGlowTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner); g.addColorStop(0.25, inner); g.addColorStop(1, outer);
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); return t;
}
const LOGV = '#include <common>\n#include <logdepthbuf_pars_vertex>\n';
const LOGF = '#include <logdepthbuf_pars_fragment>\n';
const SUN_DIR = new V3(1, 0, 0), SUN2_DIR = new V3(0, 0, 1);
function bandTexture(c) {
  const W = 256, H = 128, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d'), img = x.createImageData(W, H), n = makeSimplex(c.R | 0), B = c.bands;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const lon = i / W * TAU, lat = j / H;
    const w = n(Math.cos(lon) * 1.5, Math.sin(lon) * 1.5, lat * 9) * 0.6 + n(Math.cos(lon) * 5, Math.sin(lon) * 5, lat * 30) * 0.2;
    const f = lat * B.length * 2.2 + w * 0.7, k = Math.floor(f), t = smooth(0.7, 1, f - k);
    const a = B[((k % B.length) + B.length) % B.length], b = B[(((k + 1) % B.length) + B.length) % B.length];
    const o = (j * W + i) * 4, sh = 0.92 + n(i * 0.09, j * 0.6, 3) * 0.08;
    img.data[o] = (a[0] + (b[0] - a[0]) * t) * 255 * sh; img.data[o + 1] = (a[1] + (b[1] - a[1]) * t) * 255 * sh; img.data[o + 2] = (a[2] + (b[2] - a[2]) * t) * 255 * sh; img.data[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = THREE.RepeatWrapping; return t;
}
function ringGeometry(r0, r1, seg) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = i / seg * TAU, c = Math.cos(a), s = Math.sin(a);
    pos.push(c * r0, 0, s * r0, c * r1, 0, s * r1); uv.push(0, 0.5, 1, 0.5);
    if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 3, k, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
function ringTexture() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 4; const x = cv.getContext('2d'), rnd = mulberry32(5);
  for (let i = 0; i < 512; i++) {
    const t = i / 512, gap = (t > 0.55 && t < 0.6) ? 0.1 : 1, a = (0.35 + rnd() * 0.45) * gap * smooth(0, 0.06, t) * (1 - smooth(0.9, 1, t));
    const c = 200 + rnd() * 40;
    x.fillStyle = `rgba(${c | 0},${(c * 0.88) | 0},${(c * 0.72) | 0},${a.toFixed(3)})`; x.fillRect(i, 0, 1, 4);
  }
  return new THREE.CanvasTexture(cv);
}
const ATMO_V = LOGV + 'varying vec3 vN; varying vec3 vP; varying vec3 vWN;\nvoid main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vP=mv.xyz; vWN=normalize((modelMatrix*vec4(normal,0.0)).xyz); gl_Position=projectionMatrix*mv;\n#include <logdepthbuf_vertex>\n}';
const ATMO_F = LOGF + 'uniform vec3 sunDir; uniform vec3 glow; uniform float opacity; uniform float limbCos; varying vec3 vN; varying vec3 vP; varying vec3 vWN;\nvoid main(){\n#include <logdepthbuf_fragment>\n float d=dot(normalize(vP),vN); float g=pow(clamp(d/limbCos,0.0,1.0),2.4); float day=smoothstep(-0.35,0.45,dot(vWN,sunDir)); vec3 col=mix(vec3(0.05,0.08,0.2),glow,day); gl_FragColor=vec4(col*g*opacity*(0.2+0.95*day),1.0);\n}';
/* ---------- the black hole: horizon, glowing disk, a bright ring, and starlight bent round it ---------- */
const GLSL_NOISE = `
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;
function makeHole(scene) {
  const H = { st: MAW };
  const R = MAW.R, [r0, r1] = MAW.disk;
  H.horizon = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
  // the disk spins faster nearer in; the side coming toward you is brighter
  H.diskMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, r0: { value: r0 }, r1: { value: r1 }, nrm: { value: new V3(0, 1, 0) } },
    vertexShader: LOGV + 'varying vec3 vL; varying vec3 vW; varying vec3 vC;\nvoid main(){ vL = position; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vC = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * w;\n#include <logdepthbuf_vertex>\n}',
    fragmentShader: LOGF + 'uniform float time; uniform float r0; uniform float r1; uniform vec3 nrm; varying vec3 vL; varying vec3 vW; varying vec3 vC;' + GLSL_NOISE + `
void main(){
#include <logdepthbuf_fragment>
  float r = length(vL.xz), t = (r - r0) / (r1 - r0);
  if (t < 0.0 || t > 1.0) discard;
  float a = atan(vL.z, vL.x) + time * 0.9 * pow(r0 / r, 1.5);
  float lr = log(r / r0);
  float n = vnoise(vec3(cos(a) * 3.0, sin(a) * 3.0, lr * 9.0)) * 0.6 + vnoise(vec3(cos(a) * 9.0, sin(a) * 9.0, lr * 30.0)) * 0.4;
  vec3 hot = mix(vec3(1.0, 0.96, 0.88), vec3(1.0, 0.6, 0.24), smoothstep(0.0, 0.45, t));
  hot = mix(hot, vec3(0.7, 0.18, 0.06), smoothstep(0.45, 1.0, t));
  float b = pow(1.0 - t, 1.4) * (0.45 + 0.9 * n) * smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.75, 1.0, t));
  vec3 rv = normalize(vW - vC), vel = normalize(cross(nrm, rv));
  float beam = 1.0 + 0.6 * dot(vel, -normalize(vW));
  gl_FragColor = vec4(hot * b * beam * 1.6, 1.0);
}`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false
  });
  H.disk = new THREE.Mesh(ringGeometry(r0, r1, 256), H.diskMat);
  // the ring of light just outside the shadow: light that went round the hole on its way to you
  const rk = document.createElement('canvas'); rk.width = rk.height = 256; const rx = rk.getContext('2d'), rg = rx.createRadialGradient(128, 128, 0, 128, 128, 128);
  rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(0.62, 'rgba(0,0,0,0)'); rg.addColorStop(0.7, 'rgba(255,214,160,0.95)'); rg.addColorStop(0.76, 'rgba(255,150,70,0.45)'); rg.addColorStop(1, 'rgba(255,90,30,0)');
  rx.fillStyle = rg; rx.fillRect(0, 0, 256, 256);
  H.ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(rk), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  H.ring.scale.setScalar(R * 2.6 / 0.7 * 2);
  // starlight bent round the hole: a sphere that shows the stars behind it, each ray turned toward the hole
  H.lensR = R * 20;
  H.lensMat = new THREE.ShaderMaterial({
    uniforms: { tStars: { value: null }, hole: { value: new V3() }, rs: { value: R }, rl: { value: H.lensR }, op: { value: 1 } },
    vertexShader: LOGV + 'varying vec3 vW;\nvoid main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;\n#include <logdepthbuf_vertex>\n}',
    fragmentShader: LOGF + `uniform samplerCube tStars; uniform vec3 hole; uniform float rs; uniform float rl; uniform float op; varying vec3 vW;
void main(){
#include <logdepthbuf_fragment>
  vec3 d = normalize(vW - cameraPosition);
  vec3 h = hole - cameraPosition;
  float along = dot(h, d);
  vec3 perp = h - d * along;
  float b = length(perp);
  if (along > 0.0 && b < rs * 2.6) { gl_FragColor = vec4(0.0, 0.0, 0.0, op); return; }
  float k = 1.0 - smoothstep(rl * 0.55, rl, b);
  float ang = along > 0.0 ? 2.0 * rs / max(b, rs) * k : 0.0;
  vec3 toward = b > 0.0 ? perp / b : vec3(0.0);
  vec3 nd = normalize(d * cos(ang) + toward * sin(ang));
  vec3 c = textureCube(tStars, nd).rgb;
  gl_FragColor = vec4(c, op * (1.0 - smoothstep(rl * 0.9, rl, b)));
}`,
    transparent: true, depthWrite: false, side: THREE.BackSide, fog: false
  });
  H.lens = new THREE.Mesh(new THREE.SphereGeometry(H.lensR, 64, 48), H.lensMat);
  H.lens.renderOrder = -1.5; H.lens.frustumCulled = false;
  scene.add(H.horizon, H.disk, H.ring, H.lens);
  return H;
}
function makeSky(scene) {
  const sky = {};
  // stars, far beyond every orbit
  const rnd = mulberry32(9);
  const N = 2400, sp = new Float32Array(N * 3), sc = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = rnd() * 2 - 1, th = rnd() * TAU, s = Math.sqrt(1 - u * u);
    sp[i * 3] = s * Math.cos(th); sp[i * 3 + 1] = u; sp[i * 3 + 2] = s * Math.sin(th);
    const b = 0.45 + rnd() * 0.55, warm = rnd();
    sc[i * 3] = b * (warm > 0.8 ? 1 : 0.85); sc[i * 3 + 1] = b * 0.9; sc[i * 3 + 2] = b * (warm < 0.3 ? 1 : 0.85);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  const sm = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, fog: false, depthWrite: false });
  sky.stars = new THREE.Points(sg, sm); sky.stars.scale.setScalar(5e8); sky.stars.frustumCulled = false; sky.stars.renderOrder = -2;
  scene.add(sky.stars);
  // every star: a glowing ball with a halo when near, and from afar (from another system) a bright point among the stars
  const fk = document.createElement('canvas'); fk.width = fk.height = 64; const fx = fk.getContext('2d'), fg = fx.createRadialGradient(32, 32, 0, 32, 32, 32);
  fg.addColorStop(0, 'rgba(255,255,255,1)'); fg.addColorStop(0.18, 'rgba(255,255,255,0.9)'); fg.addColorStop(0.45, 'rgba(255,255,255,0.22)'); fg.addColorStop(1, 'rgba(255,255,255,0)');
  fx.fillStyle = fg; fx.fillRect(0, 0, 64, 64);
  const farTex = new THREE.CanvasTexture(fk);
  sky.suns = STARS.map(st => {
    const o = { st };
    if (!st.hole) {
      o.mesh = new THREE.Mesh(new THREE.SphereGeometry(st.R, 48, 32), new THREE.MeshBasicMaterial({ color: st === SUN ? 0xfff3d6 : st.color, fog: false }));
      o.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(st.glowIn, st.glowOut), fog: false, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true }));
      o.glow.scale.setScalar(st.R * st.glowK); o.glow.renderOrder = -1;
      scene.add(o.mesh, o.glow);
    }
    o.far = new THREE.Sprite(new THREE.SpriteMaterial({ map: farTex, color: st.beacon, sizeAttenuation: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending, fog: false }));
    o.far.renderOrder = -1; o.far.visible = false; scene.add(o.far);
    return o;
  });
  sky.sunMesh = sky.suns[0].mesh; sky.sunGlow = sky.suns[0].glow;
  sky.hole = makeHole(scene);
  // the disk lies in the plane its world circles in
  const hn = new V3().crossVectors(GLOOM.e1, GLOOM.e2).normalize();
  sky.hole.disk.quaternion.setFromUnitVectors(new V3(0, 1, 0), hn); sky.hole.diskMat.uniforms.nrm.value.copy(hn);
  /* the stars as seen from anywhere (they are infinitely far), drawn once into a cube for the black hole to bend */
  sky.makeStarCube = function (renderer) {
    const rt = new THREE.WebGLCubeRenderTarget(512, { format: THREE.RGBFormat, generateMipmaps: false, minFilter: THREE.LinearFilter });
    const cs = new THREE.Scene(); cs.background = new THREE.Color(0x020306);
    const pm = new THREE.PointsMaterial({ size: 1.1, sizeAttenuation: false, vertexColors: true, fog: false });
    const pts = new THREE.Points(sky.stars.geometry, pm); pts.scale.setScalar(1e3); cs.add(pts);
    const cc = new THREE.CubeCamera(1, 1e4, rt); cs.add(cc); cc.update(renderer, cs);
    pm.dispose();
    sky.hole.lensMat.uniforms.tStars.value = rt.texture;
  };
  // atmosphere shells
  sky.shells = AIRY.map(c => {
    const ratio = c.R / (c.R + c.air.top);
    const mat = new THREE.ShaderMaterial({
      uniforms: { sunDir: { value: new V3() }, glow: { value: new V3().fromArray(c.air.glow) }, opacity: { value: 0 }, limbCos: { value: Math.min(0.97, ratio * 1.117) } },
      vertexShader: ATMO_V, fragmentShader: ATMO_F, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(c.R + c.air.top, c === PLANET ? 96 : 64, c === PLANET ? 64 : 48), mat);
    mesh.renderOrder = 1; scene.add(mesh);
    return { c, mesh, mat, star: rootStar(c) };
  });
  // gas giants and rings (spin axis = ecliptic normal)
  const qAxis = new Quat().setFromUnitVectors(new V3(0, 1, 0), SOLAR.n);
  sky.giants = PLANETS.filter(c => c.kind === 'gas').map(c => {
    const mat = new THREE.MeshLambertMaterial({ map: bandTexture(c), fog: false });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(c.R, 96, 64), mat); mesh.quaternion.copy(qAxis); scene.add(mesh);
    c.mat = mat;
    let ring = null;
    if (c.rings) {
      ring = new THREE.Mesh(ringGeometry(c.R * 1.65, c.R * 2.7, 160), new THREE.MeshLambertMaterial({ map: ringTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false }));
      ring.quaternion.copy(qAxis).multiply(new Quat().setFromAxisAngle(new V3(1, 0, 0), 0.12)); ring.renderOrder = 2; scene.add(ring);
    }
    return { c, mesh, ring, q0: qAxis.clone() };
  });
  // beacons: dots that keep small and distant worlds visible
  const dk = document.createElement('canvas'); dk.width = dk.height = 32; const dx = dk.getContext('2d');
  dx.fillStyle = '#ffffff'; dx.beginPath(); dx.arc(16, 16, 10, 0, TAU); dx.fill();
  const dotTex = new THREE.CanvasTexture(dk);
  sky.beacons = ORBITERS.filter(c => c.kind !== 'star').map(c => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: c.beacon, sizeAttenuation: false, depthWrite: false, transparent: true, fog: false }));
    s.renderOrder = 5; s.visible = false; scene.add(s); return { c, s, star: rootStar(c) };
  });
  /* the sky itself: a dome round the camera, painted first. Its horizon is the fog colour so far hills melt into it;
     overhead it deepens; toward a low sun it turns to sunset, and round the sun itself glows */
  sky.domeU = { hor: { value: new THREE.Color() }, zen: { value: new THREE.Color() }, setc: { value: new THREE.Color() }, setk: { value: 0 }, sunc: { value: new THREE.Color() },
    sun: { value: new V3(1, 0, 0) }, up: { value: new V3(0, 1, 0) }, vis: { value: 1 }, day: { value: 1 }, glare: { value: 1 } };
  sky.domeMat = new THREE.ShaderMaterial({
    uniforms: sky.domeU,
    vertexShader: 'varying vec3 vD;\nvoid main(){ vD = (modelMatrix * vec4(position, 0.0)).xyz; vec4 p = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position, 1.0)).xyz, 1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 hor; uniform vec3 zen; uniform vec3 setc; uniform float setk; uniform vec3 sunc; uniform vec3 sun; uniform vec3 up; uniform float vis; uniform float day; uniform float glare; varying vec3 vD;
void main(){
  vec3 d = normalize(vD);
  float el = dot(d, up);
  vec3 col = mix(hor, zen, pow(clamp(el, 0.0, 1.0), 0.5));
  // toward a low sun the horizon burns orange, fading upward
  vec3 dh = normalize(d - up * el + up * 1e-4), sh = normalize(sun - up * dot(sun, up) + up * 1e-4);
  float toward = pow(max(dot(dh, sh), 0.0), 2.5);
  col = mix(col, setc, setk * (0.3 + 0.7 * toward) * exp(-max(el, 0.0) * 4.0) * smoothstep(-0.25, 0.02, el));
  // round the sun: a bright core and a wide soft glare
  float cs = max(dot(d, sun), 0.0);
  col += sunc * vis * (pow(cs, 900.0) * 1.2 + pow(cs, 60.0) * 0.22 * glare + pow(cs, 6.0) * 0.07 * glare) * (0.35 + 0.65 * day);
  gl_FragColor = vec4(col, 1.0);
}`,
    side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false
  });
  sky.dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), sky.domeMat);
  sky.dome.renderOrder = -3; sky.dome.frustumCulled = false; scene.add(sky.dome);
  sky.bg = new THREE.Color(); sky.fogCol = new THREE.Color(); sky.deepCol = new THREE.Color();
  const cSpace = new THREE.Color(0x020306), cWater = new THREE.Color(0x0d3a48), cLava = new THREE.Color(0x7a1e04), cFogMix = new THREE.Color(0xdde8ef);
  const t1 = new THREE.Color(), t2 = new THREE.Color(), cc = { day: new THREE.Color(), high: new THREE.Color(), set: new THREE.Color(), night: new THREE.Color() };
  const _a = new V3(), _b = new V3();
  sky.state = { airCel: null, day: 1, sunVis: 1, inSea: null, deep: 0, moonDir: new V3(0, 1, 0), moonK: 0, hemi: 0, up: new V3(0, 1, 0) };
  const cAmbDay = new THREE.Color(0xb6cbe0), cAmbNight = new THREE.Color(0x5a72b0);
  sky.update = function (cam, stage, fog, sunLight, ambient, mapMode) {
    const st = sky.state;
    // the brightest star here lights everything (and a twin sun adds a second light)
    const lit = starLight(cam), S = lit.a;
    const sunDist = cam.distanceTo(S.center);
    SUN_DIR.subVectors(S.center, cam).divideScalar(sunDist || 1);
    if (lit.b) SUN2_DIR.subVectors(lit.b.center, cam).normalize();
    const ac = airAt(cam);
    let alt = 0, airF = 0, sunEl = 1, day = 1, deep = 0;
    if (ac) {
      _a.subVectors(cam, ac.center); const r = _a.length(); alt = r - ac.R; _a.divideScalar(r);
      airF = Math.pow(clamp(1 - alt / (ac.air.top + 300), 0, 1), 1.1);
      sunEl = _a.dot(SUN_DIR); day = smooth(-0.2, 0.22, sunEl);
      if (lit.b) { st.sunEl2 = _a.dot(SUN2_DIR); day = Math.max(day, smooth(-0.2, 0.22, st.sunEl2) * 0.8); }
      if (ac.kind === 'gas' && alt < 0) deep = clamp(-alt / (ac.R * 0.05), 0, 1);
    }
    // eclipses: is any world between us and the Sun?
    let sunVis = S.hole ? 0.75 : 1;
    for (const c of ORBITERS) {
      if (c === ac || c === S) continue;
      _b.subVectors(c.center, cam); const along = _b.dot(SUN_DIR);
      if (along <= 0 || along > sunDist) continue;
      const perp2 = _b.lengthSq() - along * along;
      if (perp2 < c.R * c.R) { sunVis = 0; break; }
    }
    const surfaceDay = (ac ? smooth(-0.12, 0.08, sunEl) : 1) * sunVis;
    const dimm = clamp(Math.pow(S.lux / Math.max(sunDist, 1), 0.3), 0.05, 1.5) * S.lumK;
    sunLight.intensity = 1.05 * surfaceDay * dimm * (1 - deep * 0.85);
    sunLight.color.setHex(S.light);
    st.light2 = 0;
    if (lit.b) {
      const B = lit.b, d2 = cam.distanceTo(B.center), day2 = ac ? smooth(-0.12, 0.08, st.sunEl2) : 1;
      st.light2 = 1.05 * day2 * clamp(Math.pow(B.lux / Math.max(d2, 1), 0.3), 0.05, 1.5) * B.lumK * (1 - deep * 0.85); st.light2Col = B.light;
    }
    st.star = S; st.star2 = lit.b;
    // light from the whole sky as well as the sun: bright from above, dim from the ground (so undersides and creases
    // read darker), bluer at night; and the brightest moon over this world lights the night
    ambient.intensity = 0.24 + 0.08 * day * airF;
    ambient.color.copy(cAmbDay).lerp(cAmbNight, (1 - day) * airF * 0.7);
    st.hemi = 0.05 + 0.22 * day * airF;
    st.moonK = 0;
    if (ac && day < 0.95) {
      let best = 0;
      for (const m of MOONS) {
        if (m.parent !== ac) continue;
        _b.subVectors(m.center, cam); const md = _b.length(); _b.divideScalar(md);
        const el = _b.dot(_a), phase = 0.5 * (1 - _b.dot(SUN_DIR)), k = Math.min(1, (m.R / md) * 40) * phase * smooth(-0.02, 0.15, el);
        if (k > best) { best = k; st.moonDir.copy(_b); }
      }
      st.moonK = best * 0.2 * (1 - day) * airF;
    }
    // sky colours for whichever air we are in
    if (ac) {
      const A = ac.air; cc.day.setHex(A.day); cc.high.setHex(A.high); cc.set.setHex(A.set); cc.night.setHex(A.night);
      t1.copy(cc.day).lerp(cc.high, clamp(alt / (A.top * 0.76), 0, 1));
      const setk = (1 - Math.abs(day - 0.5) * 2);
      t1.lerp(cc.set, setk * 0.55);
      t2.copy(cc.night).lerp(t1, day);
      sky.bg.copy(cSpace).lerp(t2, airF);
      // the dome: overhead deeper than the horizon, sunset strongest toward the sun
      const U = sky.domeU, hh = clamp(alt / (A.top * 0.76), 0, 1);
      t1.copy(cc.day).lerp(cc.high, 0.55 + 0.45 * hh); t2.copy(cc.night).multiplyScalar(0.7).lerp(t1, day);
      U.zen.value.copy(cSpace).lerp(t2, airF);
      U.setc.value.copy(cc.set); U.setk.value = setk * airF * 0.85;
    } else { sky.bg.copy(cSpace); sky.domeU.zen.value.copy(cSpace); sky.domeU.setk.value = 0; }
    sky.fogCol.copy(sky.bg).lerp(cFogMix, 0.12 * day * airF);
    {
      const U = sky.domeU;
      U.hor.value.copy(sky.fogCol); U.sun.value.copy(SUN_DIR); U.sunc.value.setHex(S.hole ? 0xffb070 : S.light);
      U.vis.value = sunVis * (S.hole ? 0.25 : 1) * clamp(dimm, 0, 1.2); U.day.value = day; U.glare.value = airF;
      if (ac) { U.up.value.copy(_a); st.up.copy(_a); } else { U.up.value.copy(SUN_DIR); st.up.copy(SUN_DIR); }
      sky.dome.position.copy(cam);
    }
    let inSea = null;
    for (const c of SEAS) { const d = cam.distanceTo(c.center) - c.R; if (d < -0.3 && d > -900) { inSea = c; break; } }
    let starsOp = 0;
    sky.dome.visible = !inSea && deep === 0 && airF > 0.002;
    if (inSea) {
      const col = inSea.sea.lava ? cLava : cWater;
      stage.background = col; fog.color.copy(col); fog.near = 0; fog.far = inSea.sea.lava ? 6 : 60;
    } else if (deep > 0) {
      sky.deepCol.copy(sky.bg).multiplyScalar(1 - deep * 0.7);
      stage.background = sky.deepCol; fog.color.copy(sky.deepCol); fog.near = 0; fog.far = lerp(900, 40, deep);
    } else {
      stage.background = sky.bg; fog.color.copy(sky.fogCol);
      if (airF > 0.001) { const k = ac.air.top / 5000; fog.near = 600 * k + Math.max(0, alt) * 1.4; fog.far = lerp(48000, 9000, airF) * Math.max(1, k * 0.8); } else { fog.near = 1e10; fog.far = 2e10; }
      starsOp = clamp(1 - airF * day * 1.6, 0, 1) * clamp(1 - airF * 0.5, 0, 1);
    }
    sky.stars.material.opacity = starsOp;
    sky.stars.position.copy(cam);
    // only the world whose air or sea we are in gets fog; everything else is seen through clear space
    const fogCel = inSea || ac;
    for (const c of CELS) {
      if (!c.mat) continue;
      const want = c === fogCel;
      if (c.mat.fog !== want) { c.mat.fog = want; c.mat.needsUpdate = true; }
      if (c.wmat && c.wmat.fog !== want) { c.wmat.fog = want; c.wmat.needsUpdate = true; }
    }
    // the black hole: where it is, how its disk spins, and the bent starlight round it (hidden far off)
    {
      const H = sky.hole, d = cam.distanceTo(MAW.center), on = d < 6e8;
      H.horizon.visible = H.disk.visible = H.ring.visible = H.lens.visible = on;
      if (on) {
        H.horizon.position.copy(MAW.center); H.disk.position.copy(MAW.center); H.ring.position.copy(MAW.center); H.lens.position.copy(MAW.center);
        H.diskMat.uniforms.time.value = (W.time % 100000);
        H.lensMat.uniforms.hole.value.subVectors(MAW.center, cam);   // drawn with the camera at the origin
        H.lens.visible = !!H.lensMat.uniforms.tStars.value && d < 4e8;
      }
    }
    for (const o of sky.suns) {
      const sc = o.st, d = cam.distanceTo(sc.center), near = d < 7e8;
      if (o.mesh) { o.mesh.visible = o.glow.visible = near; o.mesh.position.copy(sc.center); o.glow.position.copy(sc.center); o.glow.material.opacity = deep > 0 ? 1 - deep : 1; }
      // from out of its own system a star is a bright point at its true direction, sized by how bright it looks
      const show = d > Math.max(sc.sysR || 0, 2e7) && (mapMode || starsOp > 0.02);
      o.far.visible = show;
      if (show) {
        _b.subVectors(sc.center, cam).multiplyScalar(4e8 / d); o.far.position.copy(cam).add(_b);
        const k = sc.lumK * (sc.lux / d) * (sc.lux / d);
        o.far.scale.setScalar(clamp(0.0048 + 0.0017 * (Math.log10(Math.max(k, 1e-12)) + 8), 0.0045, 0.022) * (mapMode ? 1.5 : 1));
        o.far.material.opacity = mapMode ? 1 : starsOp;
      }
    }
    for (const sh of sky.shells) {
      const c = sh.c, d = cam.distanceTo(c.center) - c.R;
      sh.mesh.position.copy(c.center); sh.mesh.visible = (c.R + c.air.top) / (d + c.R) > 0.0012;
      sh.mat.uniforms.sunDir.value.subVectors(sh.star.center, c.center).normalize();
      sh.mat.uniforms.opacity.value = smooth(c.air.top * 0.5, c.air.top * 1.5, d);
    }
    for (const g of sky.giants) {
      const vis = g.c.R * 2.7 / cam.distanceTo(g.c.center) > 0.0012;
      g.mesh.visible = vis; g.mesh.position.copy(g.c.center); g.mesh.quaternion.copy(g.c.spinQ).multiply(g.q0);
      if (g.ring) { g.ring.visible = vis; g.ring.position.copy(g.c.center); }
    }
    // worlds of other systems only show as their star's point (or on the map)
    let camSys = null; for (const sc of STARS) if (sc.sysR && cam.distanceTo(sc.center) < sc.sysR) camSys = sc;
    st.sys = camSys;
    for (const b of sky.beacons) {
      const c = b.c; _a.subVectors(cam, c.center); const d = _a.length();
      const small = c.R / d < 0.004;
      b.s.visible = mapMode ? d < 3e9 : small && starsOp > 0.05 && b.star === camSys;
      if (!b.s.visible) continue;
      b.s.position.copy(c.center).addScaledVector(_a, Math.min(1.03 * c.R, d * 0.5) / d);
      const big = c.parent && c.parent.kind === 'star';
      b.s.scale.setScalar(mapMode ? (big ? 0.016 : 0.01) : (big ? 0.007 : 0.005));
      b.s.material.opacity = mapMode ? 1 : starsOp;
    }
    st.airCel = ac; st.day = day; st.sunVis = sunVis; st.inSea = inSea; st.deep = deep;
  };
  return sky;
}

/* ---------- the sky seen in shiny things ----------
   A tiny cube picture of the sky (the dome's own colours, with the ground's colour below the horizon), redrawn about once
   a second. Vehicles, glass and building windows reflect it, most strongly at a glancing angle as real paint and glass do.
   Fast leaves it off. */
const ENV = { rt: null, cam: null, scene: null, U: null, on: false, t: 0, mats: [] };
function makeEnv() {
  ENV.rt = new THREE.WebGLCubeRenderTarget(64, { format: THREE.RGBFormat, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  ENV.cam = new THREE.CubeCamera(0.1, 100, ENV.rt);
  ENV.scene = new THREE.Scene();
  ENV.U = Object.assign({}, sky.domeU, { gnd: { value: new THREE.Color() } });
  const m = new THREE.ShaderMaterial({ uniforms: ENV.U, side: THREE.BackSide, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec3 vD;\nvoid main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: sky.domeMat.fragmentShader.replace('uniform vec3 hor;', 'uniform vec3 gnd; uniform vec3 hor;')
      .replace('gl_FragColor = vec4(col, 1.0);', 'col = mix(col, gnd, smoothstep(0.0, -0.12, el));\n  gl_FragColor = vec4(col, 1.0);') });
  ENV.scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), m), ENV.cam);
}
/* a Phong material that reflects the sky picture: k is how much, at a glancing angle */
const SHINE_GLSL = {
  fres: 'float shF = 0.16 + 0.84 * pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 4.0);\n',
  env: () => THREE.ShaderChunk.envmap_fragment.split('specularStrength * reflectivity').join('specularStrength * reflectivity * shF')
};
function shine(mat, key, k, o = {}) {
  mat.userData.shineK = k; mat.combine = THREE.AddOperation; mat.reflectivity = k;
  mat.onBeforeCompile = sh => {
    let f = sh.fragmentShader, v = sh.vertexShader;
    let pre = SHINE_GLSL.fres;
    // windows: only the darkest colours (glass) reflect
    if (o.windows) pre += 'shF *= 1.0 - smoothstep(0.1, 0.24, max(max(vColor.r, vColor.g), vColor.b));\n';
    f = f.replace('#include <envmap_fragment>', pre + SHINE_GLSL.env() + (o.glass ? '\ndiffuseColor.a = clamp(diffuseColor.a + shF * 0.45, 0.0, 1.0);' : ''));
    // buildings: darker where they meet the ground (gy is the height above the building's own floor, plus 10; 0 = not known)
    if (o.ao) {
      v = 'attribute float gy;\nvarying float vGy;\n' + v.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGy = gy;');
      f = 'varying float vGy;\n' + f.replace('#include <color_fragment>', '#include <color_fragment>\n  if (vGy > 0.5) diffuseColor.rgb *= mix(0.56, 1.0, smoothstep(-0.2, 2.6, vGy - 10.0));');
    }
    sh.vertexShader = v; sh.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => 'shine:' + key;
  ENV.mats.push(mat); mat.needsUpdate = true;
  return mat;
}
/* Balanced and Sharp: sky reflections on, and vehicles a little glossier */
function setShine(q) {
  ENV.on = q !== 'low'; ENV.t = 0;
  for (const m of ENV.mats) {
    const want = ENV.on && m.userData.shineK > 0 ? ENV.rt.texture : null;
    if (m.envMap !== want) { m.envMap = want; m.needsUpdate = true; }
    if (m.userData.glossy) { m.shininess = ENV.on ? 46 : 26; m.specular.setHex(ENV.on ? 0x343434 : 0x1c1c1c); }
  }
}
function updateEnv(dt) {
  if (!ENV.on) return;
  ENV.t -= dt; if (ENV.t > 0) return; ENV.t = 0.9;
  ENV.U.gnd.value.copy(sky.fogCol).multiplyScalar(0.42);
  ENV.cam.position.set(0, 0, 0); ENV.cam.update(renderer, ENV.scene);
}

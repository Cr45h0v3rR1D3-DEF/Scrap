'use strict';
/* ================= Scrapline · solar system ================= */
/* Absolute frame: the Sun sits at the origin; every other body follows a circular orbit on rails.
   Vehicles feel gravity from all of them. Rendering uses a floating origin (see game.js). */
const SUN = { name: 'Sun', kind: 'star', R: 2.5e5, mu: 2.19e13, center: new V3(), vel: new V3(), soi: Infinity, maxH: 0, parent: null,
  heatStart: 2.2e6, heatEnd: 3.3e5, color: 0xffe2a8, beacon: 0xffe2a8 };
const SOLAR = { n: new V3(0, 1, 0), e1: new V3(1, 0, 0), e2: new V3(0, 0, 1) };
const AIR_HOME = { rho0: RHO0, top: 5000, day: 0x8cbfe0, high: 0x2c5a95, set: 0xe4a77a, night: 0x0a1424, glow: [0.42, 0.68, 1.0] };
Object.assign(PLANET, { kind: 'rocky', air: AIR_HOME, sea: { rho: RHO_W, lava: false, color: 0x1f6d8c }, beacon: 0x8fd0ff, depth: 9 });
Object.assign(MOON, { kind: 'rocky', air: null, sea: null, beacon: 0xc9c7c2, depth: 7 });

const nS1 = makeSimplex(101), nS2 = makeSimplex(113), nS3 = makeSimplex(127), nS4 = makeSimplex(131), nS5 = makeSimplex(149);
function ridged(n, x, y, z, f0, oct, lac = 2.1) {
  let r = 0, a = 1, f = f0, ws = 0;
  for (let i = 0; i < oct; i++) { let v = 1 - Math.abs(n(x * f, y * f, z * f)); v *= v; r += v * a; ws += a; a *= 0.5; f *= lac; }
  return r / ws;
}
function setRGB(o, r, g, b) { o[0] = r; o[1] = g; o[2] = b; }

/* ---------- landable planets ---------- */
const CINDER = { name: 'Cinder', kind: 'rocky', R: 4500, g: 5.5, maxH: 950, beacon: 0xff7a3d, depth: 8,
  blurb: 'Lava world. Basalt plains and molten seas that burn anything that sinks.',
  sea: { rho: 2800, lava: true, color: 0xff5a1a }, air: null,
  height(x, y, z) {
    const c = nS1(x * 1.4, y * 1.4, z * 1.4) * 0.6 + nS2(x * 3.2, y * 3.2, z * 3.2) * 0.3 + nS3(x * 7, y * 7, z * 7) * 0.14 + 0.1;
    let h = c * 380;
    h += Math.pow(ridged(nS4, x, y, z, 4, 4), 2.2) * 520 * smooth(-0.05, 0.2, c);
    return h + nS2(x * 60, y * 60, z * 60) * 6 + nS1(x * 220, y * 220, z * 220) * 1.5;
  },
  color(h, slope, x, y, z, o) {
    const v = nS3(x * 90, y * 90, z * 90) * 0.5 + 0.5;
    let r = 0.2 + v * 0.06, g = 0.17 + v * 0.04, b = 0.16 + v * 0.03;
    if (h < 0) { r = 0.5; g = 0.16; b = 0.05; }
    else { const glow = 1 - smooth(0, 16, h); r = lerp(r, 0.78, glow * 0.85); g = lerp(g, 0.24, glow * 0.85); b = lerp(b, 0.06, glow * 0.85); }
    const ash = smooth(320, 520, h); r = lerp(r, 0.44, ash); g = lerp(g, 0.42, ash); b = lerp(b, 0.4, ash);
    r -= smooth(0.25, 0.5, slope) * 0.05;
    setRGB(o, r, g, b);
  } };
const DUNE = { name: 'Dune', kind: 'rocky', R: 6000, g: 6.5, maxH: 520, beacon: 0xe39a5c, depth: 8,
  blurb: 'Desert world with thin air, rolling dunes and deep canyons.',
  sea: null, air: { rho0: 0.35, top: 3000, day: 0xd9a27a, high: 0x6b4a6a, set: 0x9fb8d8, night: 0x140c12, glow: [0.95, 0.62, 0.42] },
  height(x, y, z) {
    const base = nS2(x * 1.2, y * 1.2, z * 1.2) * 120 + nS3(x * 3, y * 3, z * 3) * 50;
    const d = 1 - Math.abs(nS1(x * 38 + nS4(x * 6, y * 6, z * 6) * 0.8, y * 38, z * 38));
    const dunes = d * d * 28 * smooth(-0.2, 0.3, nS4(x * 2.2, y * 2.2, z * 2.2) + 0.2);
    const cv = Math.abs(nS5(x * 5.5 + 7, y * 5.5, z * 5.5));
    const canyon = (1 - smooth(0.0, 0.06, cv)) * 220;
    const mesa = smooth(0.35, 0.4, nS1(x * 4, y * 4, z * 4)) * 90;
    return base + dunes + mesa - canyon + nS2(x * 200, y * 200, z * 200) * 0.8;
  },
  color(h, slope, x, y, z, o) {
    const v = nS3(x * 70, y * 70, z * 70) * 0.5 + 0.5;
    let r = 0.86 + (v - 0.5) * 0.08, g = 0.56 + (v - 0.5) * 0.06, b = 0.33;
    const rock = Math.max(smooth(0.14, 0.28, slope), smooth(-60, -140, h));
    r = lerp(r, 0.58, rock); g = lerp(g, 0.32, rock); b = lerp(b, 0.22, rock);
    setRGB(o, r, g, b);
  } };
const MIRE = { name: 'Mire', kind: 'rocky', R: 8000, g: 8.5, maxH: 420, beacon: 0x6fd07a, depth: 8,
  blurb: 'Jungle world with thick air and warm green seas. Planes fly easily here.',
  sea: { rho: RHO_W, lava: false, color: 0x1f6b5a }, air: { rho0: 2.2, top: 7000, day: 0x9fc9a2, high: 0x3a6e66, set: 0xd8a060, night: 0x0b1712, glow: [0.5, 0.88, 0.62] },
  height(x, y, z) {
    const c = nS4(x * 1.3, y * 1.3, z * 1.3) * 0.6 + nS1(x * 2.9, y * 2.9, z * 2.9) * 0.3 + nS2(x * 6.5, y * 6.5, z * 6.5) * 0.15 - 0.02;
    let h = c > 0 ? c * 260 : c * 420;
    if (c > 0) h += smooth(0, 0.08, c) * (nS3(x * 16, y * 16, z * 16) * 35 + nS5(x * 40, y * 40, z * 40) * 12);
    return h + nS1(x * 130, y * 130, z * 130) * 2;
  },
  color(h, slope, x, y, z, o) {
    const v = nS5(x * 80, y * 80, z * 80) * 0.5 + 0.5;
    if (h < -1) { const t = clamp(-h / 120, 0, 1); setRGB(o, lerp(0.36, 0.1, t), lerp(0.36, 0.22, t), lerp(0.22, 0.2, t)); return; }
    if (h < 3) { setRGB(o, 0.36, 0.33, 0.2); return; }
    let r = 0.14 + v * 0.1, g = 0.34 + v * 0.12, b = 0.12 + v * 0.05;
    const rock = smooth(0.2, 0.36, slope); r = lerp(r, 0.36, rock); g = lerp(g, 0.38, rock); b = lerp(b, 0.3, rock);
    setRGB(o, r, g, b);
  } };
const FROST = { name: 'Frost', kind: 'rocky', R: 5500, g: 7, maxH: 900, beacon: 0xcfe8ff, depth: 8,
  blurb: 'Ice world. Frozen seas make perfectly flat plains for racing.',
  sea: null, air: { rho0: 0.6, top: 3000, day: 0xc8dcef, high: 0x5a7ea8, set: 0xe9b6d0, night: 0x0c1220, glow: [0.72, 0.84, 1.0] },
  height(x, y, z) {
    const c = nS2(x * 1.5, y * 1.5, z * 1.5) * 0.6 + nS3(x * 3.3, y * 3.3, z * 3.3) * 0.3 + nS1(x * 7, y * 7, z * 7) * 0.14;
    let h = c * 450;
    if (h < 0) h *= 0.012;
    else h += Math.pow(ridged(nS5, x, y, z, 5, 4), 1.8) * 520 * smooth(0.05, 0.25, c);
    return h + nS4(x * 150, y * 150, z * 150) * 0.6;
  },
  color(h, slope, x, y, z, o) {
    const v = nS1(x * 120, y * 120, z * 120) * 0.5 + 0.5;
    if (h < 0.8) { const crack = smooth(0.46, 0.5, v) * (1 - smooth(0.5, 0.54, v)); setRGB(o, 0.7 + v * 0.1 - crack * 0.2, 0.84 + v * 0.06 - crack * 0.15, 0.93 - crack * 0.1); return; }
    let r = 0.93, g = 0.95, b = 0.98;
    const rock = smooth(0.2, 0.36, slope); r = lerp(r, 0.45, rock); g = lerp(g, 0.5, rock); b = lerp(b, 0.58, rock);
    setRGB(o, r, g, b);
  } };
const SHARD = { name: 'Shard', kind: 'rocky', R: 2500, g: 1.5, maxH: 1100, beacon: 0xb79cff, depth: 7,
  blurb: 'Tiny crystal rock with towering spires and very low gravity.',
  sea: null, air: null,
  height(x, y, z) {
    const h = nS1(x * 2, y * 2, z * 2) * 90 + nS2(x * 6, y * 6, z * 6) * 30;
    return h + Math.pow(ridged(nS3, x, y, z, 9, 3, 2.3), 6) * 950 + nS4(x * 90, y * 90, z * 90) * 3;
  },
  color(h, slope, x, y, z, o) {
    const t = smooth(80, 600, h), v = nS5(x * 60, y * 60, z * 60) * 0.5 + 0.5;
    setRGB(o, lerp(0.4, 0.82, t) + v * 0.05, lerp(0.36, 0.76, t) + v * 0.04, lerp(0.5, 0.95, t));
  } };

/* ---------- moons: cratered worlds with their own palettes ---------- */
function craterWorld(o) {
  const rnd = mulberry32(o.seed), na = makeSimplex(o.seed * 7 + 1), nb = makeSimplex(o.seed * 7 + 2);
  const cr = [];
  for (let i = 0; i < (o.count || 120); i++) {
    const u = rnd() * 2 - 1, th = rnd() * TAU, s = Math.sqrt(1 - u * u);
    const rad = Math.pow(rnd(), 2.4) * o.R * 0.22 + o.R * 0.015;
    cr.push({ x: s * Math.cos(th), y: u, z: s * Math.sin(th), rad, depth: rad * (0.14 + rnd() * 0.08), rim: rad * 0.05, cosLim: Math.cos(rad * 1.6 / o.R) });
  }
  const amp = o.R * (o.rough || 0.03);
  const P = o.pal;
  return Object.assign({ kind: 'rocky', air: null, sea: null, maxH: amp * 1.6 + o.R * 0.02 + 20, depth: clamp(Math.round(Math.log2(1.5708 * o.R / 30)), 4, 8) }, o, {
    height(x, y, z) {
      let h = na(x * 1.6, y * 1.6, z * 1.6) * amp + nb(x * 5, y * 5, z * 5) * amp * 0.35 + na(x * 30, y * 30, z * 30) * amp * 0.05;
      for (let i = 0; i < cr.length; i++) {
        const c = cr[i], d = x * c.x + y * c.y + z * c.z;
        if (d < c.cosLim) continue;
        const q = Math.acos(d > 1 ? 1 : d) * o.R / c.rad;
        if (q < 1) h += c.depth * (q * q - 1);
        const e = (q - 1) * 3.5; h += c.rim * Math.exp(-e * e);
      }
      return h;
    },
    color(h, slope, x, y, z, out) {
      const v = nb(x * 70, y * 70, z * 70) * 0.5 + 0.5, k = 0.85 + clamp(h / (amp * 4 + 1), -0.15, 0.15) + (v - 0.5) * 0.12 - smooth(0.2, 0.45, slope) * 0.1;
      let r = P[0] * k, g = P[1] * k, b = P[2] * k;
      if (o.spots) { const s = smooth(0.62, 0.7, na(x * 9, y * 9, z * 9) * 0.5 + 0.5); r = lerp(r, o.spots[0], s); g = lerp(g, o.spots[1], s); b = lerp(b, o.spots[2], s); }
      setRGB(out, r, g, b);
    } });
}
const PIP = craterWorld({ name: 'Pip', seed: 21, R: 600, g: 0.5, pal: [0.62, 0.5, 0.42], beacon: 0xb59a86, blurb: 'Tiny dusty moon of Dune.' });
const KETTLE = craterWorld({ name: 'Kettle', seed: 22, R: 1000, g: 0.8, pal: [0.55, 0.47, 0.44], beacon: 0xa8978f, blurb: 'Battered moon of Dune.' });
const LANTERN = craterWorld({ name: 'Lantern', seed: 23, R: 1500, g: 1.0, pal: [0.5, 0.56, 0.5], beacon: 0xa9c4aa, blurb: 'Grey-green moon of Mire.' });
const SLEET = craterWorld({ name: 'Sleet', seed: 24, R: 900, g: 0.6, pal: [0.86, 0.9, 0.95], rough: 0.02, beacon: 0xe6f2ff, blurb: 'Icy moon of Frost.' });
const EMBER = craterWorld({ name: 'Ember', seed: 25, R: 1800, g: 1.5, pal: [0.82, 0.72, 0.36], spots: [0.55, 0.2, 0.08], beacon: 0xe8c45a, blurb: 'Sulfur-yellow moon of Tempest.' });
const VANE = craterWorld({ name: 'Vane', seed: 26, R: 1200, g: 1.0, pal: [0.82, 0.84, 0.86], rough: 0.02, beacon: 0xdfe4ea, blurb: 'Frozen moon of Tempest.' });
const TUMBLE = craterWorld({ name: 'Tumble', seed: 27, R: 700, g: 0.6, pal: [0.36, 0.33, 0.31], rough: 0.06, beacon: 0x8a837d, blurb: 'Lumpy dark moon of Tempest.' });
const HALO = craterWorld({ name: 'Halo', seed: 28, R: 2200, g: 1.4, pal: [0.6, 0.6, 0.6], beacon: 0xc4c4c4, blurb: 'Large grey moon of Tempest.' });
const SHIVER = craterWorld({ name: 'Shiver', seed: 29, R: 1100, g: 0.9, pal: [0.72, 0.84, 0.95], rough: 0.02, beacon: 0xbfe0ff, blurb: 'Blue ice moon of Azure.' });
const DRIFT = craterWorld({ name: 'Drift', seed: 30, R: 800, g: 0.6, pal: [0.42, 0.4, 0.46], beacon: 0x9b97a6, blurb: 'Dark little moon of Azure.' });

/* ---------- gas giants ---------- */
const TEMPEST = { name: 'Tempest', kind: 'gas', R: 45000, g: 18, maxH: 0, beacon: 0xf0b46a, rings: true,
  bands: [[0.93, 0.82, 0.62], [0.78, 0.52, 0.3], [0.96, 0.9, 0.78], [0.62, 0.38, 0.22], [0.88, 0.7, 0.48]],
  blurb: 'Banded gas giant with rings. Sink into the clouds and the pressure crushes you.',
  air: { rho0: 1.6, top: 15000, day: 0xd9b27a, high: 0x7a5532, set: 0xe08a50, night: 0x140c06, glow: [1.0, 0.76, 0.46] }, sea: null };
const AZURE = { name: 'Azure', kind: 'gas', R: 32000, g: 12, maxH: 0, beacon: 0x7fb4ff,
  bands: [[0.55, 0.72, 0.95], [0.38, 0.55, 0.86], [0.7, 0.84, 0.98], [0.3, 0.45, 0.78]],
  blurb: 'Blue ice giant far from the Sun. Its clouds crush anything that sinks.',
  air: { rho0: 1.4, top: 12000, day: 0x8fb6e8, high: 0x28508f, set: 0x9fd0ff, night: 0x050b18, glow: [0.45, 0.65, 1.0] }, sea: null };

/* ================= other stars ================= */
/* Each sits still, far out in the galaxy, with worlds of its own on rails round it. lux is the distance at which a star
   lights things as the Sun lights Terra (lumK scales that), sysR how far out its worlds reach: past that, between the
   stars, time warp goes much higher. hole: a black hole (R is its horizon: its tides only tear things apart once they fall in past it;
   slowR is how near time warp is held down, so nothing warps straight in) */
Object.assign(SUN, { lux: 6.8e6, lumK: 1, light: 0xfff2de, sysR: 6e7, call: 'the Sun', title: 'The Sun', sys: 'Sun', glowIn: 'rgba(255,248,226,1)', glowOut: 'rgba(255,190,110,0)', glowK: 7 });
const RUBY = { name: 'Ruby', kind: 'star', R: 1.1e5, mu: 6e12, heatStart: 7e5, heatEnd: 1.5e5, color: 0xff6a3a, light: 0xffb08c, lux: 1.8e6, lumK: 0.8, beacon: 0xff8a5c,
  sysR: 1.2e7, sys: 'Ruby', glowIn: 'rgba(255,150,100,1)', glowOut: 'rgba(255,60,20,0)', glowK: 8, blurb: 'A dim red dwarf.' };
const DUET_A = { name: 'Duet A', kind: 'star', R: 2e5, mu: 1.6e13, heatStart: 1.6e6, heatEnd: 2.8e5, color: 0xfff1d6, light: 0xfff0dc, lux: 6.4e6, lumK: 0.72, beacon: 0xfff0c8,
  sysR: 2.2e7, sys: 'Duet', glowIn: 'rgba(255,246,226,1)', glowOut: 'rgba(255,200,130,0)', glowK: 7, blurb: 'The bigger of two suns circling each other.' };
const DUET_B = { name: 'Duet B', kind: 'star', R: 1.3e5, mu: 7e12, heatStart: 8e5, heatEnd: 1.8e5, color: 0xffa858, light: 0xffc07c, lux: 4.2e6, lumK: 0.42, beacon: 0xffa858,
  sysR: 0, sys: 'Duet', glowIn: 'rgba(255,190,120,1)', glowOut: 'rgba(255,110,40,0)', glowK: 7, blurb: 'The smaller, orange one of two suns.' };
const SAPPHIRE = { name: 'Sapphire', kind: 'star', R: 9e5, mu: 9e13, heatStart: 8e6, heatEnd: 1.3e6, color: 0xd6e4ff, light: 0xe2ebff, lux: 2.1e7, lumK: 1.15, beacon: 0xa8c8ff,
  sysR: 6e7, sys: 'Sapphire', glowIn: 'rgba(225,236,255,1)', glowOut: 'rgba(110,150,255,0)', glowK: 8, blurb: 'A huge, blazing blue-white giant.' };
const MAW = { name: 'Maw', kind: 'star', hole: true, R: 3e4, mu: 4e13, slowR: 3.84e5, heatStart: 0, heatEnd: 0, color: 0x000000, light: 0xffb878, lux: 2.6e6, lumK: 0.5, beacon: 0xffa060,
  sysR: 2.6e7, sys: 'Maw', disk: [5.5e4, 3.2e5], blurb: 'A black hole. Its glowing disk lights the dark; fall in past its horizon and nothing comes back out.' };
const STARS = [SUN, RUBY, DUET_A, DUET_B, SAPPHIRE, MAW];

/* Iris: always the same face to Ruby (sub is the point right under it, in Iris's own frame). Day side a scorched
   desert, night side a sheet of ice, and between them a ring of seas and dark purple life */
const nI1 = makeSimplex(201), nI2 = makeSimplex(211), nI3 = makeSimplex(223), nI4 = makeSimplex(227);
const IRIS = { name: 'Iris', kind: 'rocky', R: 6000, g: 7, maxH: 560, beacon: 0xd98a6a, depth: 8, sub: new V3(1, 0, 0),
  blurb: 'Eyeball world: endless day on one side, endless night on the other, and life in the ring between.',
  sea: { rho: RHO_W, lava: false, color: 0x25607a }, air: { rho0: 0.9, top: 4000, day: 0xd29a7c, high: 0x5c3452, set: 0xe8784a, night: 0x0c0610, glow: [1.0, 0.55, 0.4] },
  height(x, y, z) {
    const sb = IRIS.sub, s = x * sb.x + y * sb.y + z * sb.z;
    const n0 = nI1(x * 1.6, y * 1.6, z * 1.6) * 0.55 + nI2(x * 3.8, y * 3.8, z * 3.8) * 0.3 + nI3(x * 9, y * 9, z * 9) * 0.15;
    let h = 80 + n0 * 120;
    const day = smooth(0.18, 0.55, s), night = smooth(-0.18, -0.55, s);
    if (day > 0) { const d = 1 - Math.abs(nI4(x * 42 + nI2(x * 5, y * 5, z * 5) * 0.7, y * 42, z * 42)); h += d * d * 26 * day + Math.pow(ridged(nI3, x, y, z, 6, 3), 2.5) * 180 * day; }
    if (night > 0) h = lerp(h, 95 + nI3(x * 2.4, y * 2.4, z * 2.4) * 22 - (1 - smooth(0, 0.04, Math.abs(nI4(x * 12, y * 12, z * 12)))) * 14, night * 0.85);
    const ring = Math.exp(-(s / 0.2) * (s / 0.2));
    h = lerp(h, -55 + n0 * 170 + nI4(x * 20, y * 20, z * 20) * 12, ring);
    return h + nI1(x * 150, y * 150, z * 150) * 1.4;
  },
  color(h, slope, x, y, z, o) {
    const sb = IRIS.sub, s = x * sb.x + y * sb.y + z * sb.z, v = nI2(x * 80, y * 80, z * 80) * 0.5 + 0.5;
    if (h < -1) { const t = clamp(-h / 90, 0, 1); setRGB(o, lerp(0.46, 0.16, t), lerp(0.4, 0.22, t), lerp(0.32, 0.26, t)); return; }
    if (h < 2.5 + v * 2) { setRGB(o, 0.42, 0.36, 0.3); return; }
    let r = 0.8 + (v - 0.5) * 0.1, g = 0.46 + (v - 0.5) * 0.08, b = 0.28;
    const life = Math.exp(-(s / 0.24) * (s / 0.24)) * (1 - smooth(260, 380, h));
    r = lerp(r, 0.3 + v * 0.12, life); g = lerp(g, 0.11 + v * 0.06, life); b = lerp(b, 0.24 + v * 0.1, life);
    const ice = smooth(-0.16, -0.36, s);
    r = lerp(r, 0.84 + v * 0.06, ice); g = lerp(g, 0.9 + v * 0.04, ice); b = lerp(b, 0.97, ice);
    const rock = smooth(0.2, 0.36, slope) * (1 - ice * 0.6); r = lerp(r, 0.42, rock); g = lerp(g, 0.3, rock); b = lerp(b, 0.26, rock);
    setRGB(o, r, g, b);
  },
  flora: { kinds: ['blob'], cols: [[0.3, 0.1, 0.26], [0.42, 0.14, 0.3], [0.2, 0.08, 0.2]], dens(h, slope, x, y, z) { const sb = IRIS.sub, s = x * sb.x + y * sb.y + z * sb.z; return h < 3 || h > 300 || slope > 0.3 ? 0 : Math.exp(-(s / 0.2) * (s / 0.2)) * 0.9; } } };
/* Mirage: a desert under two suns: dunes, red canyons and white salt pans */
const nG1 = makeSimplex(241), nG2 = makeSimplex(251), nG3 = makeSimplex(257);
const MIRAGE = { name: 'Mirage', kind: 'rocky', R: 7000, g: 7.5, maxH: 620, beacon: 0xf0b070, depth: 8,
  blurb: 'Desert world with two suns: two shadows and two sunsets every day.',
  sea: null, air: { rho0: 0.55, top: 3500, day: 0xe6c79c, high: 0x6c5c8c, set: 0xff9868, night: 0x120c18, glow: [1.0, 0.8, 0.55] },
  height(x, y, z) {
    const base = nG1(x * 1.3, y * 1.3, z * 1.3) * 140 + nG2(x * 3.4, y * 3.4, z * 3.4) * 55;
    const d = 1 - Math.abs(nG3(x * 34 + nG1(x * 5, y * 5, z * 5) * 0.9, y * 34, z * 34)), dunes = d * d * 34 * smooth(-0.3, 0.2, nG2(x * 2, y * 2, z * 2));
    const cv = Math.abs(nG3(x * 4.2 + 3, y * 4.2, z * 4.2)), canyon = (1 - smooth(0, 0.05, cv)) * 240;
    const pan = smooth(-40, -90, base) * 0.85;
    return lerp(base + dunes, -95 + nG1(x * 30, y * 30, z * 30) * 0.6, pan) + smooth(0.32, 0.38, nG2(x * 5, y * 5, z * 5)) * 110 - canyon;
  },
  color(h, slope, x, y, z, o) {
    const v = nG2(x * 70, y * 70, z * 70) * 0.5 + 0.5;
    let r = 0.8 + (v - 0.5) * 0.08, g = 0.58 + (v - 0.5) * 0.06, b = 0.36;
    const salt = smooth(-80, -92, h); r = lerp(r, 0.72, salt); g = lerp(g, 0.69, salt); b = lerp(b, 0.65, salt);
    const rock = Math.max(smooth(0.14, 0.28, slope), smooth(-30, -120, h) * (1 - salt)); r = lerp(r, 0.66, rock); g = lerp(g, 0.3, rock); b = lerp(b, 0.2, rock);
    setRGB(o, r, g, b);
  } };
const PEBBLE = craterWorld({ name: 'Pebble', seed: 31, R: 900, g: 0.6, pal: [0.7, 0.62, 0.52], beacon: 0xb8a48c, blurb: 'Little moon of Mirage.' });
/* Lagoon: almost all sea, with volcanic islands, white beaches, palms and shallow reefs */
const nL1 = makeSimplex(271), nL2 = makeSimplex(277), nL3 = makeSimplex(281), nL4 = makeSimplex(283);
const LAGOON = { name: 'Lagoon', kind: 'rocky', R: 9000, g: 9.2, maxH: 480, beacon: 0x5ac8f0, depth: 9,
  blurb: 'Ocean world under a blue giant: islands, palm beaches and turquoise reefs.',
  sea: { rho: RHO_W, lava: false, color: 0x146f94 }, air: { rho0: 1.4, top: 6000, day: 0x9ad0f6, high: 0x2c68c6, set: 0xffb08a, night: 0x07101e, glow: [0.5, 0.75, 1.0] },
  height(x, y, z) {
    const c = nL1(x * 2.2, y * 2.2, z * 2.2) * 0.6 + nL2(x * 5, y * 5, z * 5) * 0.3 + nL3(x * 11, y * 11, z * 11) * 0.15;
    let h = -70 + c * 80;
    const isl = smooth(0.28, 0.56, c);
    h += isl * (75 + Math.pow(ridged(nL4, x, y, z, 7, 3), 2) * 300);
    const shelf = smooth(0.14, 0.27, c) * (1 - isl);
    h = lerp(h, -3.5 + nL2(x * 40, y * 40, z * 40) * 1.8, shelf * 0.92);
    const at = Math.abs(nL4(x * 6.5 + 2, y * 6.5, z * 6.5));
    if (c > -0.15 && c < 0.2) h = Math.max(h, lerp(-60, -1.6 + nL3(x * 60, y * 60, z * 60) * 1.4, 1 - smooth(0.012, 0.035, at)));
    return h + nL3(x * 140, y * 140, z * 140) * 0.8;
  },
  color(h, slope, x, y, z, o) {
    const v = nL2(x * 90, y * 90, z * 90) * 0.5 + 0.5;
    if (h < -1) { const t = clamp(-h / 60, 0, 1); setRGB(o, lerp(0.9, 0.2, t), lerp(0.86, 0.3, t), lerp(0.68, 0.4, t)); return; }
    if (h < 3 + v * 3) { setRGB(o, 0.86, 0.82, 0.68); return; }
    let r = 0.17 + v * 0.07, g = 0.4 + v * 0.08, b = 0.17;
    const rock = Math.max(smooth(0.2, 0.36, slope), smooth(220, 320, h)); r = lerp(r, 0.26, rock); g = lerp(g, 0.24, rock); b = lerp(b, 0.24, rock);
    setRGB(o, r, g, b);
  },
  flora: { kinds: ['palm', 'bush'], cols: [[0.22, 0.52, 0.2], [0.3, 0.6, 0.24], [0.16, 0.42, 0.18]], dens(h, slope) { return h < 2.5 || h > 200 || slope > 0.3 ? 0 : h < 14 ? 0.7 : 0.45; } } };
const CROWN = { name: 'Crown', kind: 'gas', R: 40000, g: 14, maxH: 0, beacon: 0x8fe0e8, rings: true,
  bands: [[0.62, 0.84, 0.86], [0.42, 0.68, 0.78], [0.86, 0.94, 0.95], [0.32, 0.55, 0.7], [0.72, 0.9, 0.9]],
  blurb: 'Teal ringed giant of Sapphire. Its clouds crush anything that sinks.',
  air: { rho0: 1.5, top: 13000, day: 0x9fd8e0, high: 0x2a6a80, set: 0xa8e8ff, night: 0x041014, glow: [0.5, 0.9, 1.0] }, sea: null };
const SPINDLE = craterWorld({ name: 'Spindle', seed: 32, R: 1300, g: 0.9, pal: [0.78, 0.8, 0.84], rough: 0.025, beacon: 0xd4dae2, blurb: 'Icy moon of Crown.' });
/* Gloom: a dark world lit only by the black hole's disk, with fields of glowing crystal */
const nK1 = makeSimplex(301), nK2 = makeSimplex(307), nK3 = makeSimplex(311);
const GLOOM = { name: 'Gloom', kind: 'rocky', R: 5000, g: 6, maxH: 900, beacon: 0x7fe8ff, depth: 8,
  blurb: 'Dark basalt world lit by the black hole Maw, with fields of glowing crystal.',
  sea: null, air: null,
  height(x, y, z) {
    const h = nK1(x * 1.8, y * 1.8, z * 1.8) * 110 + nK2(x * 4.5, y * 4.5, z * 4.5) * 40;
    return h + Math.pow(ridged(nK3, x, y, z, 7, 3, 2.3), 5) * 700 * smooth(-0.1, 0.3, nK2(x * 2, y * 2, z * 2)) + nK1(x * 120, y * 120, z * 120) * 2;
  },
  color(h, slope, x, y, z, o) {
    const v = nK2(x * 60, y * 60, z * 60) * 0.5 + 0.5, cr = smooth(160, 420, h);
    setRGB(o, lerp(0.16 + v * 0.05, 0.35, cr), lerp(0.15 + v * 0.04, 0.86, cr), lerp(0.17 + v * 0.05, 0.95, cr));
  },
  flora: { kinds: ['crystal'], scale: 1.7, cols: [[0.45, 0.95, 1.0], [0.6, 0.8, 1.0], [0.5, 1.0, 0.9], [0.75, 0.6, 1.0]], glow: true, dens(h, slope, x, y, z) { return slope > 0.4 ? 0 : smooth(0.05, 0.4, nK3(x * 9, y * 9, z * 9)) * 0.32; } } };

const PLANETS = [CINDER, PLANET, DUNE, MIRE, FROST, SHARD, TEMPEST, AZURE, IRIS, MIRAGE, LAGOON, CROWN, GLOOM];
const MOONS = [MOON, PIP, KETTLE, LANTERN, SLEET, EMBER, VANE, TUMBLE, HALO, SHIVER, DRIFT, PEBBLE, SPINDLE];
const CELS = [...STARS, ...PLANETS, ...MOONS];
const ROCKY = CELS.filter(c => c.kind === 'rocky');
const AIRY = CELS.filter(c => c.air);
const SEAS = CELS.filter(c => c.sea);
// everything on a rail round something else (Duet B circles Duet A)
const ORBITERS = [DUET_B, ...PLANETS, ...MOONS];
// worlds with a sphere of influence smaller than the whole galaxy, for picking whose pull dominates
const SOI_CELS = CELS.filter(c => c !== SUN);
/* the star a world belongs to, and how a world is named in a sentence */
function rootStar(c) { while (c.parent) c = c.parent; return c; }
function celCall(c) { return c.call || c.name; }
function celTitle(c) { return c.title || c.name; }
for (const c of CELS) {
  if (c.g && !c.mu) c.mu = c.g * c.R * c.R;
  c.center = c.center || new V3(); c.vel = c.vel || new V3(); c.acc = new V3(); c.pc = new V3(); c.pv = new V3();
  if (c.kind === 'rocky' && !c.terrainName) c.terrainName = c.name;
  // spin: sm turns the world's own frame (as it sat at time 0) into space; spinQ is the same turn for meshes
  c.spinAxis = new V3(0, 1, 0); c.spinW = 0; c.day = 0; c.sm = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]); c.spinQ = new Quat();
}
/* terrain heights are defined on the world's own surface, so turn a direction in space into the world's frame first */
for (const c of ROCKY) {
  const hl = c.height; c.heightL = hl;
  c.height = function (x, y, z) { const m = c.sm; return hl.call(c, m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z, m[2] * x + m[5] * y + m[8] * z); };
}
/* ---------- spin ---------- */
function setSpin(c, axis, day) { c.spinAxis.copy(axis).normalize(); c.day = day; c.spinW = day ? TAU / day : 0; }
function updateSpin(c, t) {
  const th = c.spinW * (t % c.day), a = c.spinAxis, cs = Math.cos(th), sn = Math.sin(th), k = 1 - cs, m = c.sm;
  m[0] = cs + a.x * a.x * k; m[1] = a.x * a.y * k - a.z * sn; m[2] = a.x * a.z * k + a.y * sn;
  m[3] = a.y * a.x * k + a.z * sn; m[4] = cs + a.y * a.y * k; m[5] = a.y * a.z * k - a.x * sn;
  m[6] = a.z * a.x * k - a.y * sn; m[7] = a.z * a.y * k + a.x * sn; m[8] = cs + a.z * a.z * k;
  c.spinQ.setFromAxisAngle(a, th);
}
/* space -> the world's own frame, and back */
function toSpin(c, v, out) { const m = c.sm, x = v.x, y = v.y, z = v.z; out.x = m[0] * x + m[3] * y + m[6] * z; out.y = m[1] * x + m[4] * y + m[7] * z; out.z = m[2] * x + m[5] * y + m[8] * z; return out; }
function fromSpin(c, v, out) { const m = c.sm, x = v.x, y = v.y, z = v.z; out.x = m[0] * x + m[1] * y + m[2] * z; out.y = m[3] * x + m[4] * y + m[5] * z; out.z = m[6] * x + m[7] * y + m[8] * z; return out; }
function spinVec(c, out) { return c ? out.copy(c.spinAxis).multiplyScalar(c.spinW) : out.set(0, 0, 0); }
/* how fast the ground, sea or air at p is moving: the world's own speed plus its spin */
function surfaceVel(c, p, out) {
  const w = c.spinW, a = c.spinAxis, rx = p.x - c.center.x, ry = p.y - c.center.y, rz = p.z - c.center.z;
  return out.set(c.vel.x + w * (a.y * rz - a.z * ry), c.vel.y + w * (a.z * rx - a.x * rz), c.vel.z + w * (a.x * ry - a.y * rx));
}

function setOrbit(c, parent, a, theta0, n, ref) {
  c.parent = parent; c.a = a; c.omega = Math.sqrt(parent.mu / (a * a * a)); c.theta0 = theta0;
  c.e1 = ref.clone().addScaledVector(n, -ref.dot(n)).normalize();
  c.e2 = new V3().crossVectors(n, c.e1).normalize();
  c.soi = a * Math.pow(c.mu / parent.mu, 0.4);
  c.period = TAU / c.omega;
}
/* every world rides a circular rail; acc is the rail's acceleration, used to integrate vehicles in their world's frame */
function updateCelestials(t) {
  for (const c of ORBITERS) {
    const th = c.theta0 + c.omega * t, cs = Math.cos(th), sn = Math.sin(th), p = c.parent, s = c.a * c.omega, w2 = c.omega * c.omega;
    c.center.copy(p.center).addScaledVector(c.e1, cs * c.a).addScaledVector(c.e2, sn * c.a);
    c.vel.copy(p.vel).addScaledVector(c.e1, -sn * s).addScaledVector(c.e2, cs * s);
    c.acc.copy(p.acc).addScaledVector(c.e1, -cs * c.a * w2).addScaledVector(c.e2, -sn * c.a * w2);
  }
  for (const c of CELS) if (c.spinW) updateSpin(c, t);
  if (typeof syncPad === 'function') syncPad();
}
function celPosAt(c, t, out) {
  if (!c.parent) return out.set(0, 0, 0);
  celPosAt(c.parent, t, out);
  const th = c.theta0 + c.omega * t;
  return out.addScaledVector(c.e1, Math.cos(th) * c.a).addScaledVector(c.e2, Math.sin(th) * c.a);
}
function dominantCel(p) {
  let best = SUN, bs = Infinity;
  for (const c of SOI_CELS) if (c.soi < bs && p.distanceToSquared(c.center) < c.soi * c.soi) { best = c; bs = c.soi; }
  return best;
}
function airDensity(cel, alt) {
  const a = cel.air; if (!a || alt >= a.top) return 0;
  if (alt < 0) return cel.kind === 'gas' ? Math.min(60, a.rho0 * Math.exp(-alt / 1500)) : a.rho0;
  return a.rho0 * Math.pow(1 - alt / a.top, 2.2);
}
/* air and liquid around a point: returns the body whose air or sea we are in */
function airAt(p) {
  for (const c of AIRY) { const alt = p.distanceTo(c.center) - c.R; if (alt < c.air.top) return c; }
  return null;
}
/* how deep into a star's heat zone a point is (0 outside every one, 1 at the deadly edge), and which star's */
let HOT = null;
function sunHeat(p) {
  let h = 0; HOT = null;
  for (const s of STARS) {
    if (!s.heatStart) continue;
    const r = p.distanceTo(s.center); if (r >= s.heatStart) continue;
    const k = clamp((s.heatStart - r) / (s.heatStart - s.heatEnd), 0, 1); if (k > h) { h = k; HOT = s; }
  }
  return h;
}
/* how hard a black hole's tides are pulling at a point: 0 anywhere outside its horizon, then, once you have
   fallen in, rising fast to 1, where nothing holds together */
function tidalPull(p) {
  const r = p.distanceTo(MAW.center); if (r >= MAW.R) return 0;
  return clamp((MAW.R - r) / (MAW.R * 0.35), 0, 1);
}
/* out between the stars: past every star's worlds */
function inDeepSpace(p) { for (const s of STARS) if (s.sysR && p.distanceToSquared(s.center) < s.sysR * s.sysR) return false; return true; }
/* the stars lighting a point, brightest first. k is how bright, 1 being the Sun seen from Terra; a second star counts
   only when it is a fair share as bright (twin suns) */
const LIT = { a: SUN, ka: 1, b: null, kb: 0 };
function starLight(p) {
  let a = SUN, ka = -1, b = null, kb = 0;
  for (const s of STARS) {
    const d = Math.max(p.distanceTo(s.center), s.R * 1.5), k = s.lumK * (s.lux / d) * (s.lux / d);
    if (k > ka) { b = ka >= 0 ? a : null; kb = Math.max(ka, 0); a = s; ka = k; } else if (k > kb) { b = s; kb = k; }
  }
  LIT.a = a; LIT.ka = ka; LIT.b = kb > ka * 0.12 ? b : null; LIT.kb = LIT.b ? kb : 0;
  return LIT;
}
function initSolar() {
  const sun0 = WORLD.sunDir.clone();
  const nEcl = new V3().crossVectors(sun0, WORLD.padRight).normalize();
  const homeRef = sun0.clone().negate();
  SOLAR.n.copy(nEcl); SOLAR.e1.copy(homeRef); SOLAR.e2.crossVectors(nEcl, homeRef).normalize();
  setOrbit(PLANET, SUN, 6.8e6, 0, nEcl, homeRef);
  const tilt = (ang) => nEcl.clone().applyAxisAngle(homeRef, ang);
  const rnd = mulberry32(77);
  const plan = [[CINDER, 3.4e6, 0.02], [DUNE, 9.6e6, -0.03], [MIRE, 1.25e7, 0.025], [FROST, 1.65e7, -0.02], [SHARD, 2.05e7, 0.06], [TEMPEST, 3.0e7, 0.015], [AZURE, 4.2e7, -0.025]];
  for (const [c, a, inc] of plan) setOrbit(c, SUN, a, 0.6 + rnd() * 5.2, tilt(inc), homeRef);
  setOrbit(MOON, PLANET, 42000, 0, MOON.orbitPlaneN || nEcl, MOON.orbitRef || homeRef);
  const moonPlan = [[PIP, DUNE, 22000], [KETTLE, DUNE, 40000], [LANTERN, MIRE, 52000], [SLEET, FROST, 30000],
    [EMBER, TEMPEST, 150000], [VANE, TEMPEST, 260000], [TUMBLE, TEMPEST, 420000], [HALO, TEMPEST, 700000], [SHIVER, AZURE, 120000], [DRIFT, AZURE, 300000]];
  for (const [m, p, a] of moonPlan) setOrbit(m, p, a, rnd() * TAU, tilt((rnd() - 0.5) * 0.2), homeRef);
  // days: Terra turns every 10 minutes about an axis through its poles that keeps the pad on the equator; with the Sun
  // set in the equator's plane (see setupWorld) that axis stands straight up out of the planets' plane: no tilt
  const up = WORLD.padUp, ax = nEcl.clone().addScaledVector(up, -nEcl.dot(up));
  if (ax.lengthSq() < 1e-6) ax.copy(WORLD.padRight);
  setSpin(PLANET, ax.normalize(), TERRA_DAY);
  WORLD.padEast.crossVectors(PLANET.spinAxis, up).normalize();
  const dayPlan = [[CINDER, 720, 0.05], [DUNE, 960, 0.3], [MIRE, 1200, 0.15], [FROST, 840, 0.45], [SHARD, 1500, 0.9], [TEMPEST, 1500, 0], [AZURE, 1200, 0]];
  for (const [c, day, t] of dayPlan) setSpin(c, tilt(t), day);
  // moons keep one face toward their planet: one turn per orbit (the other stars' moons get theirs below)
  for (const m of MOONS) if (m.e1) setSpin(m, new V3().crossVectors(m.e1, m.e2), m.period);
  // the other stars, far out in every direction, holding still in the galaxy's frame
  const at = (d, ang, el) => SOLAR.e1.clone().multiplyScalar(Math.cos(ang) * Math.cos(el) * d).addScaledVector(SOLAR.e2, Math.sin(ang) * Math.cos(el) * d).addScaledVector(SOLAR.n, Math.sin(el) * d);
  for (const [st, d, ang, el] of [[RUBY, 1.2e9, 0.7, 0.1], [DUET_A, 1.8e9, 2.6, -0.14], [SAPPHIRE, 2.6e9, 4.4, 0.2], [MAW, 3.4e9, 5.6, -0.07]]) { st.center.copy(at(d, ang, el)); st.soi = 2.5e8; }
  // each system in a plane of its own, tipped a little from the Sun's
  const plane = (ax, a) => nEcl.clone().applyAxisAngle(ax, a);
  setOrbit(DUET_B, DUET_A, 1.2e6, 0.4, plane(homeRef, 0.05), homeRef);
  setOrbit(IRIS, RUBY, 1.8e6, 1.1, plane(homeRef, 0.08), homeRef);
  setOrbit(MIRAGE, DUET_A, 7e6, 2.2, plane(homeRef, 0.05), homeRef);
  setOrbit(PEBBLE, MIRAGE, 32000, 0.9, plane(SOLAR.e2, 0.1), homeRef);
  setOrbit(LAGOON, SAPPHIRE, 1.8e7, 3.4, plane(SOLAR.e2, -0.06), homeRef);
  setOrbit(CROWN, SAPPHIRE, 3.4e7, 0.6, plane(SOLAR.e2, 0.04), homeRef);
  setOrbit(SPINDLE, CROWN, 1.8e5, 2.0, plane(homeRef, 0.1), homeRef);
  setOrbit(GLOOM, MAW, 8e6, 4.1, plane(homeRef, -0.05), homeRef);
  for (const [c, day, t] of [[MIRAGE, 840, 0.2], [LAGOON, 1100, 0.15], [CROWN, 1300, 0], [GLOOM, 1000, 0.3]]) setSpin(c, plane(homeRef, t), day);
  for (const m of [PEBBLE, SPINDLE]) setSpin(m, new V3().crossVectors(m.e1, m.e2), m.period);
  // Iris turns once per orbit, so Ruby hangs still in its sky
  setSpin(IRIS, new V3().crossVectors(IRIS.e1, IRIS.e2), IRIS.period);
  updateCelestials(0);
  IRIS.sub.subVectors(RUBY.center, IRIS.center).normalize();
}

/* nearest rocky body whose terrain could touch a sphere of radius rad at p */
function groundCelNear(p, rad) {
  for (const c of ROCKY) { const d = p.distanceTo(c.center) - c.R; if (d < c.maxH + rad + 50) return c; }
  return null;
}
function seaCelNear(p, rad) {
  for (const c of SEAS) { const d = p.distanceTo(c.center) - c.R; if (d < rad + 1 && d > -600) return c; }
  return null;
}
/* surface altitude where a body counts as "in space" (above the air or high above the ground) */
function spaceAlt(c) { return c.kind === 'star' ? -Infinity : c.air ? c.air.top : c.maxH + 120; }
function fmtDist(d) {
  const a = Math.abs(d);
  if (a < 1000) return Math.round(d) + ' m';
  if (a < 100000) return (d / 1000).toFixed(a < 10000 ? 2 : 1) + ' km';
  return Math.round(d / 1000).toLocaleString('en-US') + ' km';
}
/* find a flat, dry, sunlit spot near a preferred direction on a rocky body */
function findSurfaceSpot(c, pref) {
  const rnd = mulberry32(c.R | 0), t1 = new V3(), t2 = new V3(), o = new V3(), q = new V3(), q1 = new V3(), q2 = new V3();
  tangentBasis(pref.x, pref.y, pref.z, t1, t2);
  const minH = c.sea ? (c.sea.lava ? 10 : 4) : -1e9;
  let best = pref.clone(), bs = -1e9;
  for (let i = 0; i < 220; i++) {
    const dist = Math.sqrt(i / 220) * c.R * 0.75, ang = i * 2.39996;
    offsetDir(pref, t1, t2, dist, ang, c.R, o);
    const h = c.height(o.x, o.y, o.z);
    if (h < minH) continue;
    tangentBasis(o.x, o.y, o.z, q1, q2);
    let dev = 0;
    for (let k = 0; k < 6; k++) { offsetDir(o, q1, q2, 9, k * TAU / 6, c.R, q); dev = Math.max(dev, Math.abs(c.height(q.x, q.y, q.z) - h)); }
    const sc = -dev * 3 - dist / c.R * 6 - (c.sea && h > 200 ? (h - 200) * 0.01 : 0);
    if (sc > bs) { bs = sc; best = o.clone(); }
  }
  return best;
}
/* spawn menu: home spots first, then every other world */
function initSpawns() {
  const L = WORLD.locs;
  L.orbit = { name: 'Low orbit (9 km)', kind: 'orbit', cel: PLANET, alt: 9000, group: 'Terra' };
  L.moon = { name: 'The Moon', kind: 'surface', cel: MOON, group: 'Terra' };
  L.skyhook = { name: 'Skyhook orbit (spinning)', kind: 'skyhook', cel: PLANET, group: 'Terra' };
  for (const k of ['pad', 'highlands', 'sea']) L[k].group = 'Terra';
  for (const c of [CINDER, DUNE, MIRE, FROST, SHARD]) L['s_' + c.name] = { name: c.name, kind: 'surface', cel: c, group: 'Planets' };
  for (const c of [TEMPEST, AZURE]) L['o_' + c.name] = { name: `${c.name} orbit`, kind: 'orbit', cel: c, alt: c.air.top + 6000, group: 'Planets' };
  for (const c of MOONS) if (c !== MOON && rootStar(c) === SUN) L['s_' + c.name] = { name: `${c.name} (${c.parent.name})`, kind: 'surface', cel: c, group: 'Moons' };
  // the other stars' worlds, a group for each star, and a start out between the stars
  const sys = (group, list) => { for (const [k, name, kind, cel, alt] of list) L[k] = { name, kind, cel, alt, group }; };
  sys('Ruby, red dwarf', [['s_Iris', 'Iris', 'surface', IRIS], ['o_Iris', 'Iris orbit', 'orbit', IRIS, 9000]]);
  sys('Duet, twin suns', [['s_Mirage', 'Mirage', 'surface', MIRAGE], ['o_Mirage', 'Mirage orbit', 'orbit', MIRAGE, 9000], ['s_Pebble', 'Pebble (Mirage)', 'surface', PEBBLE]]);
  sys('Sapphire, blue giant', [['s_Lagoon', 'Lagoon', 'surface', LAGOON], ['o_Lagoon', 'Lagoon orbit', 'orbit', LAGOON, 12000], ['o_Crown', 'Crown orbit', 'orbit', CROWN, CROWN.air.top + 6000], ['s_Spindle', 'Spindle (Crown)', 'surface', SPINDLE]]);
  sys('Maw, black hole', [['s_Gloom', 'Gloom', 'surface', GLOOM], ['o_Gloom', 'Gloom orbit', 'orbit', GLOOM, 6000], ['o_Maw', 'Orbit round the black hole', 'orbit', MAW, 9e5]]);
  L.deep = { name: 'Between the stars (heading for Ruby)', kind: 'deep', cel: RUBY, group: 'Deep space' };
}

/* is a point in sunlight (its brightest star's), or in some world's shadow? */
function inSunlight(p) {
  const S = starLight(p).a;
  if (S.hole) return false;
  const dx = S.center.x - p.x, dy = S.center.y - p.y, dz = S.center.z - p.z, dist = Math.hypot(dx, dy, dz);
  const ux = dx / dist, uy = dy / dist, uz = dz / dist;
  for (const c of ORBITERS) {
    const vx = c.center.x - p.x, vy = c.center.y - p.y, vz = c.center.z - p.z, along = vx * ux + vy * uy + vz * uz;
    if (along <= 0 || along > dist) continue;
    if (vx * vx + vy * vy + vz * vz - along * along < c.R * c.R) return false;
  }
  return true;
}

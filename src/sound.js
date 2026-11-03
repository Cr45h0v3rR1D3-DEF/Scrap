'use strict';
/* ================= Scrapline · sound =================
   Everything is made on the fly with WebAudio: engines, props, jets and rockets hum along with your machine,
   wind rises with airspeed, and crashes, explosions, splashes, decouplers, docking and the builder all click,
   thump and boom. Nothing loads from the network. Browsers only allow sound after the first click or key. */
const SND = {
  ctx: null, out: null, ok: false, loops: null, nbuf: null, bbuf: null, hitT: 0, last: {},
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => { }); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try {
      const ctx = this.ctx = new AC();
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(ctx.destination);
      this.out = ctx.createGain(); this.out.connect(comp);
      // two seconds of white noise, and a brown (rumbly) version of it
      const n = ctx.sampleRate * 2, wb = ctx.createBuffer(1, n, ctx.sampleRate), bb = ctx.createBuffer(1, n, ctx.sampleRate);
      const w = wb.getChannelData(0), b = bb.getChannelData(0); let last = 0;
      for (let i = 0; i < n; i++) { const r = Math.random() * 2 - 1; w[i] = r; last = (last + 0.02 * r) / 1.02; b[i] = last * 3.5; }
      this.nbuf = wb; this.bbuf = bb;
      this.makeLoops();
      this.ok = true; this.applyVolume();
    } catch (e) { console.warn('sound off', e); this.ctx = null; }
  },
  applyVolume() { if (!this.ok) return; const s = G.settings; this.out.gain.setTargetAtTime(s.mute ? 0 : s.volume * 1.8, this.ctx.currentTime, 0.05); },
  noiseSrc(brown) { const s = this.ctx.createBufferSource(); s.buffer = brown ? this.bbuf : this.nbuf; s.loop = true; s.loopStart = Math.random(); return s; },
  makeLoops() {
    const c = this.ctx, L = this.loops = {};
    const chain = (src, filt, fType, f, q) => { const fl = c.createBiquadFilter(); fl.type = fType; fl.frequency.value = f; fl.Q.value = q || 0.7; const g = c.createGain(); g.gain.value = 0; src.connect(fl); fl.connect(g); g.connect(this.out); return { fl, g }; };
    // engine: two detuned saws through a lowpass that opens with load
    { const o1 = c.createOscillator(), o2 = c.createOscillator(); o1.type = 'sawtooth'; o2.type = 'square'; o2.detune.value = -1200 + 8;
      const mix = c.createGain(); mix.gain.value = 0.5; o1.connect(mix); o2.connect(mix);
      const k = chain(mix, null, 'lowpass', 400, 1.2); o1.start(); o2.start(); L.engine = { o1, o2, ...k }; }
    // propeller: a buzzing saw with a little throb
    { const o = c.createOscillator(); o.type = 'sawtooth'; const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 9; lg.gain.value = 0.35;
      const am = c.createGain(); am.gain.value = 0.65; lfo.connect(lg); lg.connect(am.gain); o.connect(am);
      const k = chain(am, null, 'lowpass', 900, 0.8); o.start(); lfo.start(); L.prop = { o, lfo, ...k }; }
    // jet: roaring noise with a turbine whine on top
    { const n = this.noiseSrc(false), k = chain(n, null, 'bandpass', 1200, 0.6); n.start();
      const w = c.createOscillator(); w.type = 'sine'; w.frequency.value = 2400; const wg = c.createGain(); wg.gain.value = 0; w.connect(wg); wg.connect(this.out); w.start();
      L.jet = { n, w, wg, ...k }; }
    // rocket: deep brown-noise roar
    { const n = this.noiseSrc(true), k = chain(n, null, 'lowpass', 500, 0.5); n.start();
      const n2 = this.noiseSrc(false), k2 = chain(n2, null, 'bandpass', 2200, 0.4); n2.start();
      L.rocket = { n, ...k, crack: k2 }; }
    // wind: noise through a band that rises with speed
    { const n = this.noiseSrc(false), k = chain(n, null, 'bandpass', 500, 0.9); n.start(); L.wind = { n, ...k }; }
    // horn: two detuned squares, a car-horn chord
    { const o1 = c.createOscillator(), o2 = c.createOscillator(); o1.type = 'square'; o2.type = 'square'; o1.frequency.value = 415; o2.frequency.value = 523;
      const mix = c.createGain(); mix.gain.value = 0.5; o1.connect(mix); o2.connect(mix);
      const k = chain(mix, null, 'lowpass', 1800, 0.9); o1.start(); o2.start(); L.horn = { o1, o2, ...k }; }
    // water rushing past a hull
    { const n = this.noiseSrc(false), k = chain(n, null, 'lowpass', 700, 0.7); n.start(); L.water = { n, ...k }; }
  },
  set(param, v, tc = 0.08) { param.setTargetAtTime(v, this.ctx.currentTime, tc); },
  /* the machine you drive sets the loops; everything else is quiet */
  update(dt) {
    if (!this.ok) return;
    const L = this.loops, b = G.player, live = G.mode === 'drive' && b && !b.dead;
    let wheelK = 0, wheelSp = 0, nW = 0, prop = 0, jet = 0, rk = 0, rkBig = 0, boat = 0, air = 0, wet = 0;
    if (live) {
      for (const o of machineOf(b)) {
        for (const w of o.wheels) { if (w.leg || w.gear) continue; nW++; wheelSp += Math.abs(w.spinV) * w.r; if (w.thr) wheelK = 1; }
        for (const e of o.props) prop += Math.abs(e.out);
        for (const e of o.jets) jet += e.out;
        for (const e of o.rockets) { rk += e.out * e.thrust; if (e.out > 0.05 && e.big) rkBig = 1; }
        for (const e of o.boats) boat += Math.abs(e.out);
      }
      const cel = dominantCel(b.x), rel = _sdv.subVectors(b.v, b.av).length();
      air = rel * Math.sqrt(Math.min(1, (b.rho || 0) / RHO0));
      if (b.wasWet && b.seaCel) wet = _sdv.subVectors(b.v, surfaceVel(b.seaCel, b.x, _sdv2)).length();
      if (cel.kind === 'gas' && b.alt < 0) air *= 1.3;
    }
    const warpQ = G.warp > 10 ? 0.3 : 1;
    // engine
    const hasW = nW > 0 && live && b.nDriven > 0;
    const sp = nW ? wheelSp / nW : 0, rpm = 38 + Math.min(sp, 40) * 4.2 + wheelK * 14;
    this.set(L.engine.o1.frequency, rpm, 0.12); this.set(L.engine.o2.frequency, rpm, 0.12);
    this.set(L.engine.fl.frequency, 260 + wheelK * 520 + Math.min(sp, 40) * 14, 0.1);
    this.set(L.engine.g.gain, hasW ? (0.05 + wheelK * 0.08) * warpQ : 0, 0.15);
    // props
    const pk = Math.min(1.5, prop + boat * 0.6);
    this.set(L.prop.o.frequency, 55 + pk * 70, 0.2); this.set(L.prop.lfo.frequency, 7 + pk * 10, 0.2);
    this.set(L.prop.g.gain, pk > 0.02 ? Math.min(0.12, 0.04 + pk * 0.07) * warpQ : 0, 0.15);
    // jets
    const jk = Math.min(1.5, jet);
    this.set(L.jet.fl.frequency, 700 + jk * 1100, 0.2); this.set(L.jet.g.gain, jk > 0.02 ? Math.min(0.2, 0.06 + jk * 0.12) * warpQ : 0, 0.2);
    this.set(L.jet.w.frequency, 1800 + jk * 1500, 0.4); this.set(L.jet.wg.gain, jk > 0.02 ? 0.012 * warpQ : 0, 0.3);
    // rockets: louder with more thrust, a crackle on top
    const rkk = rk > 0 ? Math.min(1, 0.35 + Math.log10(1 + rk / 4000) * 0.4) : 0, inAir = live && b.rho > 0.01 ? 1 : 0.35;
    this.set(L.rocket.g.gain, rkk * 0.42 * inAir * warpQ, 0.06); this.set(L.rocket.fl.frequency, 260 + rkk * 420 + rkBig * 120, 0.1);
    this.set(L.rocket.crack.g.gain, rkk * 0.05 * inAir * warpQ, 0.06);
    // wind and water
    const wk = clamp((air - 6) / 120, 0, 1);
    this.set(L.wind.g.gain, wk * 0.22 * warpQ, 0.25); this.set(L.wind.fl.frequency, 350 + air * 7, 0.25);
    const wa = clamp(wet / 12, 0, 1);
    this.set(L.water.g.gain, wa * 0.12 * warpQ, 0.25); this.set(L.water.fl.frequency, 400 + wet * 30, 0.25);
    this.set(L.horn.g.gain, live && G.horn ? 0.09 : 0, 0.02);
    // the hardest crash since last frame
    this.hitT -= dt;
    if (W.hit.v > 0) {
      if (W.hit.v > 3.5 && this.hitT <= 0) { this.hitT = 0.09; this.at('crash', W.hit.p, clamp((W.hit.v - 3) / 16, 0.15, 1) * clamp(Math.sqrt(W.hit.m / 400), 0.4, 1.4)); }
      W.hit.v = 0;
    }
  },
  /* a one-shot sound at a place in the world: quieter further from the camera */
  at(name, pos, vol = 1) {
    if (!this.ok || !pos) return;
    const d = typeof camera !== 'undefined' ? camera.position.distanceTo(pos) : 0;
    const k = vol / (1 + d / 40); if (k < 0.02) return;
    this.play(name, k);
  },
  env(g, t0, a, peak, dec) { g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec); },
  tone(type, f0, f1, dur, peak, t0, a = 0.004) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type;
    o.frequency.setValueAtTime(f0, t0); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    this.env(g, t0, a, peak, dur); o.connect(g); g.connect(this.out); o.start(t0); o.stop(t0 + a + dur + 0.05);
  },
  burst(fType, f0, f1, dur, peak, t0, brown, q = 0.8, a = 0.003) {
    const c = this.ctx, n = this.noiseSrc(brown), fl = c.createBiquadFilter(), g = c.createGain();
    fl.type = fType; fl.Q.value = q; fl.frequency.setValueAtTime(f0, t0); if (f1 !== f0) fl.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    this.env(g, t0, a, peak, dur); n.connect(fl); fl.connect(g); g.connect(this.out); n.start(t0); n.stop(t0 + a + dur + 0.05);
  },
  play(name, vol = 1) {
    if (!this.ok || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    // the same sound piling up in one instant only plays once
    if (this.last[name] && now - this.last[name] < 0.03) return;
    this.last[name] = now;
    const t = now + 0.005, v = vol;
    switch (name) {
      case 'place': this.tone('square', 920, 620, 0.05, 0.08 * v, t); this.burst('highpass', 3000, 3000, 0.03, 0.05 * v, t); break;
      case 'pop': this.tone('sine', 640, 180, 0.09, 0.12 * v, t); break;
      case 'tick': this.tone('sine', 1500, 1500, 0.025, 0.05 * v, t); break;
      case 'click': this.tone('triangle', 1100, 900, 0.03, 0.07 * v, t); break;
      case 'nope': this.tone('square', 190, 170, 0.07, 0.06 * v, t); this.tone('square', 150, 140, 0.08, 0.06 * v, t + 0.09); break;
      case 'boom': this.burst('lowpass', 1400, 90, 1.6, 0.9 * v, t, true, 0.6, 0.01); this.tone('sine', 80, 34, 0.9, 0.7 * v, t, 0.01); this.burst('bandpass', 2500, 600, 0.35, 0.25 * v, t, false, 0.6); break;
      case 'crash': this.burst('bandpass', 900, 260, 0.22 + v * 0.2, 0.5 * v, t, false, 0.9); this.tone('sine', 120, 55, 0.18, 0.4 * v, t); if (v > 0.5) this.burst('highpass', 3500, 2000, 0.25, 0.15 * v, t + 0.02); break;
      case 'rubble': this.burst('lowpass', 900, 120, 1.4 + v * 0.8, 0.55 * v, t, true, 0.7, 0.05); this.burst('bandpass', 1600, 500, 0.5, 0.25 * v, t + 0.05, false, 0.8); this.tone('sine', 70, 40, 0.8, 0.35 * v, t, 0.02); break;
      case 'splash': this.burst('highpass', 900, 2600, 0.7, 0.35 * v, t, false, 0.5, 0.02); this.burst('lowpass', 500, 200, 0.4, 0.25 * v, t, true); break;
      case 'decouple': this.burst('bandpass', 1800, 500, 0.25, 0.4 * v, t, false, 1.2); this.tone('square', 320, 300, 0.12, 0.08 * v, t); this.tone('square', 470, 440, 0.1, 0.06 * v, t + 0.01); break;
      case 'dock': this.tone('sine', 140, 90, 0.25, 0.4 * v, t); this.tone('square', 600, 560, 0.05, 0.07 * v, t + 0.02); break;
      case 'chute': this.burst('bandpass', 350, 1600, 0.8, 0.35 * v, t, false, 0.7, 0.05); break;
      case 'beep': this.tone('sine', 880, 880, 0.06, 0.08 * v, t); this.tone('sine', 1320, 1320, 0.06, 0.07 * v, t + 0.08); break;
      case 'boop': this.tone('sine', 660, 660, 0.06, 0.07 * v, t); this.tone('sine', 440, 440, 0.07, 0.07 * v, t + 0.08); break;
      case 'cannon': this.burst('lowpass', 2600, 160, 0.55, 0.75 * v, t, true, 0.7, 0.002); this.tone('sine', 120, 45, 0.35, 0.5 * v, t); this.burst('highpass', 2500, 1200, 0.12, 0.2 * v, t, false); break;
      case 'mg': this.burst('bandpass', 1900, 700, 0.07, 0.3 * v, t, false, 1.1, 0.001); this.tone('square', 180, 90, 0.04, 0.08 * v, t); break;
      case 'missile': this.burst('bandpass', 700, 2600, 0.9, 0.35 * v, t, false, 0.6, 0.02); this.burst('lowpass', 900, 300, 0.5, 0.3 * v, t, true); break;
      case 'bombdrop': this.tone('triangle', 520, 260, 0.12, 0.08 * v, t); this.burst('bandpass', 900, 400, 0.08, 0.1 * v, t, false); break;
      case 'magnet': this.tone('sawtooth', 70, 90, 0.25, 0.12 * v, t, 0.02); this.tone('sine', 220, 180, 0.1, 0.08 * v, t); break;
      case 'trainhorn': for (const f of [277, 349, 415]) this.tone('sawtooth', f, f * 0.985, 1.4, 0.035 * v, t, 0.08); for (const f of [277, 349, 415]) this.tone('sawtooth', f, f * 0.985, 0.6, 0.03 * v, t + 1.6, 0.06); break;
      case 'drill': this.burst('bandpass', 2400, 1600, 0.09, 0.22 * v, t, false, 2.2, 0.002); this.tone('sawtooth', 220, 200, 0.08, 0.05 * v, t); break;
      case 'bounce': this.tone('sine', 180, 520, 0.16, 0.3 * v, t); this.tone('sine', 360, 900, 0.1, 0.12 * v, t + 0.02); break;
    }
  }
};
const _sdv = new V3(), _sdv2 = new V3();

'use strict';
/* ================= Scrapline · controls: key bindings, part settings, logic blocks, SAS =================
   Every key the game listens to is an action with default keys that players can rebind (Settings > Controls).
   Every part can also listen to keys of its own (the Configure tool), like Trailmakers: a part's key setting
   is either left on its action's keys or set to one key of its own. Logic blocks press keys by themselves. */

/* [id, label, group, default keys] */
const ACTIONS = [
  ['fwd', 'Drive forward, thrust', 'Drive', ['Space']],
  ['back', 'Brake, then reverse', 'Drive', ['KeyS']],
  ['left', 'Steer and yaw left', 'Drive', ['KeyA']],
  ['right', 'Steer and yaw right', 'Drive', ['KeyD']],
  ['pitch_dn', 'Nose down', 'Fly', ['KeyW', 'ArrowUp']],
  ['pitch_up', 'Nose up', 'Fly', ['KeyS', 'ArrowDown']],
  ['roll_l', 'Roll left', 'Fly', ['KeyQ', 'ArrowLeft']],
  ['roll_r', 'Roll right', 'Fly', ['KeyE', 'ArrowRight']],
  ['thr_full', 'Throttle lever full', 'Fly', ['KeyZ']],
  ['thr_off', 'Throttle lever off', 'Fly', ['KeyX']],
  ['stage', 'Separate the next stage', 'Fly', ['Shift+Space']],
  ['sas', 'SAS on, off', 'Fly', ['KeyT']],
  ['rcs', 'RCS translate mode', 'Fly', ['KeyR']],
  ['chute', 'Parachutes open, cut', 'Parts', ['KeyP']],
  ['gear', 'Landing gear up, down', 'Parts', ['KeyN']],
  ['grab', 'Claws and hooks grab, let go', 'Parts', ['KeyY']],
  ['undock', 'Undock, skyhook and anchor let go', 'Parts', ['KeyG']],
  ['hinge_a', 'Hinges swing', 'Parts', ['KeyI']],
  ['hinge_b', 'Hinges swing back', 'Parts', ['KeyK']],
  ['rotor_l', 'Rotors turn left', 'Parts', ['KeyJ']],
  ['rotor_r', 'Rotors turn right', 'Parts', ['KeyL']],
  ['piston_out', 'Pistons extend', 'Parts', ['KeyU']],
  ['piston_in', 'Pistons retract', 'Parts', ['KeyO']],
  ['winch_in', 'Winches reel in', 'Parts', ['BracketLeft']],
  ['winch_out', 'Winches let out', 'Parts', ['BracketRight']],
  ['fire', 'Fire weapons', 'Parts', ['Mouse0', 'Enter']],
  ['boost', 'Afterburners', 'Fly', ['KeyV']],
  ['descend', 'Helicopter rotors sink', 'Fly', ['ShiftLeft']],
  ['horn', 'Horn', 'Parts', ['KeyH']],
  ['detach', 'Detachers let go', 'Parts', ['Digit1']],
  ['spin', 'Spinners on, off', 'Parts', ['Digit2']],
  ['lights', 'Light bars on, off', 'Parts', ['Digit3']],
  ['build', 'Builder, and back to driving', 'General', ['KeyB', 'Tab']],
  ['flip', 'Flip upright', 'General', ['KeyF']],
  ['respawn', 'Respawn', 'General', ['Backspace']],
  ['camera', 'Chase or free camera', 'General', ['KeyC']],
  ['map', 'Map', 'General', ['KeyM']],
  ['warp_up', 'Time warp faster', 'General', ['Period']],
  ['warp_dn', 'Time warp slower', 'General', ['Comma']],
  ['map_out', 'Map zoom out', 'General', ['Minus']],
  ['map_in', 'Map zoom in', 'General', ['Equal']],
  ['keys', 'Show or hide the key list', 'General', ['Slash']],
  ['b_build', 'Build tool', 'Builder', ['Digit1']],
  ['b_select', 'Select tool', 'Builder', ['Digit2']],
  ['b_config', 'Configure tool', 'Builder', ['Digit3']],
  ['b_paint', 'Paint tool', 'Builder', ['Digit4']],
  ['b_rot', 'Rotate the part or selection', 'Builder', ['KeyR']],
  ['b_tilt', 'Tilt the part or selection', 'Builder', ['KeyT']],
  ['b_mirror', 'Mirror on, off', 'Builder', ['KeyM']],
  ['b_undo', 'Undo', 'Builder', ['KeyZ']],
  ['b_redo', 'Redo', 'Builder', ['KeyY']],
  ['b_del', 'Delete the selection', 'Builder', ['Delete', 'Backspace']],
  ['b_copy', 'Copy the selection', 'Builder', ['KeyC']],
  ['b_paste', 'Paste copies', 'Builder', ['KeyV']],
  ['b_move', 'Pick up the selection and move it', 'Builder', ['KeyX']],
  ['b_forces', 'Forces view', 'Builder', ['KeyG']],
  ['b_air', 'Air drag view', 'Builder', ['KeyN']],
  ['b_keys', 'Part keys view', 'Builder', ['KeyK']],
  ['b_focus', 'Refocus the camera', 'Builder', ['KeyF']],
];
const ACT = {}; for (const a of ACTIONS) ACT[a[0]] = { id: a[0], label: a[1], group: a[2], def: a[3] };
const BINDS = {};
let BINDV = 1;
const shiftHeld = () => KEYS.has('ShiftLeft') || KEYS.has('ShiftRight');
function loadBinds() {
  const s = LS.get('scrapline.binds', {}) || {};
  for (const a of ACTIONS) { const v = s[a[0]]; BINDS[a[0]] = Array.isArray(v) ? v.filter(k => typeof k === 'string' && k.length && k.length < 32).slice(0, 2) : a[3].slice(); }
  bindsChanged(false);
}
function saveBinds() { const o = {}; for (const a of ACTIONS) if (BINDS[a[0]].join() !== a[3].join()) o[a[0]] = BINDS[a[0]]; LS.set('scrapline.binds', o); }
function bindsChanged(save = true) {
  BINDV++;
  IN.shifted.clear();
  for (const a of ACTIONS) for (const k of BINDS[a[0]]) if (k.startsWith('Shift+')) IN.shifted.add(k.slice(6));
  if (save) saveBinds();
}
/* the keys an action listens to right now (Invert pitch swaps nose up and down) */
function actKeys(id) {
  if (G.settings.invertPitch && (id === 'pitch_up' || id === 'pitch_dn')) id = id === 'pitch_up' ? 'pitch_dn' : 'pitch_up';
  return BINDS[id] || [];
}
const KEYNAMES = { Mouse0: 'Click', ShiftLeft: 'Shift', ShiftRight: 'R Shift', Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: 'Bksp', Delete: 'Del', Period: '.', Comma: ',', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: '\'', Slash: '/', Backslash: '\\', Backquote: '`', Enter: 'Enter', Tab: 'Tab', Escape: 'Esc', CapsLock: 'Caps', PageUp: 'PgUp', PageDown: 'PgDn', Home: 'Home', End: 'End', Insert: 'Ins', IntlBackslash: '\\' };
function keyName(c) {
  if (!c) return 'None';
  if (c.startsWith('Shift+')) return 'Shift+' + keyName(c.slice(6));
  if (/^CH\d$/.test(c)) return 'Ch ' + c.slice(2);
  if (KEYNAMES[c]) return KEYNAMES[c];
  if (c.startsWith('Key')) return c.slice(3);
  if (c.startsWith('Digit')) return c.slice(5);
  if (c.startsWith('Numpad')) return 'Num ' + c.slice(6);
  return c;
}
const kbd = c => `<kbd>${esc(keyName(c))}</kbd>`;
function actKbd(id, sep = ' ') { const k = actKeys(id); return k.length ? k.map(kbd).join(sep) : '<kbd>—</kbd>'; }
/* does this key press (with or without Shift) set off an action? */
function isAct(id, code, shift) {
  for (const k of actKeys(id)) {
    if (k.startsWith('Shift+')) { if (shift && k.slice(6) === code) return true; }
    else if (k === code && !(shift && IN.shifted.has(code))) return true;
  }
  return false;
}

/* ---------- live key state: real keys plus whatever logic blocks press ---------- */
const IN = { real: false, vk: new Set(), vkB: new Set(), prev: new Set(), cur: new Set(), shifted: new Set(), suppress: new Set() };
/* keys pressed since the last frame count even if they were already let go (quick taps on a slow frame) */
const TAPS = new Set();
const held = k => KEYS.has(k) || TAPS.has(k);
function realDown(c) {
  if (!IN.real || !c || IN.suppress.has(c)) return false;
  if (c.startsWith('Shift+')) return (shiftHeld() || TAPS.has('ShiftLeft') || TAPS.has('ShiftRight')) && held(c.slice(6));
  return held(c) && !(IN.shifted.has(c) && shiftHeld());
}
function kdown(c) { return !!c && (realDown(c) || IN.vk.has(c)); }
function anyDown(list) { for (let i = 0; i < list.length; i++) if (kdown(list[i])) return true; return false; }
function edgeOf(c) { const d = kdown(c); if (d) IN.cur.add(c); return d && !IN.prev.has(c); }
function endEdges() { const t = IN.prev; IN.prev = IN.cur; IN.cur = t; t.clear(); TAPS.clear(); }
/* keys already held when you take the controls don't count as fresh presses */
function seedEdges() { TAPS.clear(); IN.prev.clear(); for (const k of KEYS) { IN.prev.add(k); IN.prev.add('Shift+' + k); } IN.vk.clear(); IN.vkB.clear(); }

/* ---------- part settings (the Configure tool) ---------- */
const KEYF = (id, label, act) => ({ id, type: 'key', label, act });
const PCT = (id, label, def = 100, min = 0, max = 100, step = 5) => ({ id, type: 'num', label, def, min, max, step, unit: '%' });
const NUM = (id, label, def, min, max, step, unit, free) => ({ id, type: 'num', label, def, min, max, step, unit, free: !!free });
const BOOL = (id, label, def = false) => ({ id, type: 'bool', label, def });
const SEL = (id, label, def, opts) => ({ id, type: 'sel', label, def, opts });
const ROT_KEYS = () => [KEYF('up', 'Nose up', 'pitch_up'), KEYF('dn', 'Nose down', 'pitch_dn'), KEYF('rl', 'Roll left', 'roll_l'), KEYF('rr', 'Roll right', 'roll_r'), KEYF('yl', 'Yaw left', 'left'), KEYF('yr', 'Yaw right', 'right')];
const SENSE = [['alt', 'Height above ground (m)'], ['asl', 'Altitude above sea (m)'], ['spd', 'Speed (km/h)'], ['vs', 'Climb rate (m/s)'], ['tilt', 'Tilt from upright (°)'], ['dist', 'Distance ahead (m)'], ['fuel', 'Fuel left (%)']];
function cfgSchema(def) {
  if (def._cfg !== undefined) return def._cfg;
  let f = null, note = '';
  switch (def.kind) {
    case 'wheel': {
      const top = Math.round(def.wheel.vmax * 3.6);
      f = [KEYF('fwd', 'Forward', 'fwd'), KEYF('back', 'Brake, then reverse', 'back')];
      if (def.wheel.track) { f.push(KEYF('left', 'Turn left', 'left'), KEYF('right', 'Turn right', 'right')); note = 'Tracks turn by running the two sides at different speeds.'; }
      if (def.wheel.steer) f.push(KEYF('left', 'Steer left', 'left'), KEYF('right', 'Steer right', 'right'), SEL('steer', 'Steering', 'auto', [['auto', 'Normal'], ['inv', 'Reversed'], ['off', 'Off']]));
      f.push(PCT('power', 'Power'), NUM('speed', 'Top speed', top, 5, top, 5, 'km/h'), PCT('brake', 'Brake strength'), BOOL('inv', 'Drive the other way'));
      break;
    }
    case 'gear': f = [KEYF('back', 'Brake', 'back'), KEYF('fold', 'Fold away, put down', 'gear')]; break;
    case 'engine': f = [PCT('power', 'Power')]; note = 'Engines add power to every drive wheel on the vehicle.'; break;
    case 'prop':
      if (def.heli) { f = [KEYF('up', 'Climb', 'fwd'), KEYF('dn', 'Sink', 'descend'), PCT('power', 'Power'), BOOL('inv', 'Push the other way')]; note = 'With neither key held it holds its height by itself.'; }
      else f = [KEYF('fwd', 'Thrust', 'fwd'), KEYF('back', 'Reverse', ''), BOOL('lever', 'Follows the throttle lever', true), PCT('power', 'Power'), BOOL('inv', 'Push the other way')];
      break;
    case 'jet': f = [KEYF('fwd', 'Thrust', 'fwd'), BOOL('lever', 'Follows the throttle lever', true), PCT('power', 'Power')]; if (def.ab) f.splice(1, 0, KEYF('boost', 'Afterburner', 'boost')); break;
    case 'balloon': f = [PCT('lift', 'Lift', 100, 10, 100, 5), KEYF('k', 'Let go', '')]; break;
    case 'magnet': f = [KEYF('k', 'On, let go', 'grab'), PCT('power', 'Pull', 100, 10, 200, 10)]; break;
    case 'horn': f = [KEYF('k', 'Honk', 'horn')]; break;
    case 'gun': f = [KEYF('fire', 'Fire', 'fire')]; note = 'Shots leave from the top face. They pass through your own vehicle.'; break;
    case 'boatprop': f = [KEYF('fwd', 'Thrust', 'fwd'), KEYF('back', 'Reverse', 'back'), BOOL('lever', 'Follows the throttle lever', true), PCT('power', 'Power')]; break;
    case 'rocket': f = [BOOL('lever', 'Follows the throttle lever', true), KEYF('fire', 'Fire while held', ''), PCT('power', 'Thrust limit')]; note = 'The throttle lever is Z for full and X for off, unless you changed those keys.'; break;
    case 'flap': case 'rudder': f = [...ROT_KEYS(), PCT('angle', 'Swing'), BOOL('inv', 'Swing the other way')]; note = 'Each flap only answers the keys that suit where it sits: tail flaps pitch, wingtip flaps roll, upright ones yaw.'; break;
    case 'gyro': f = [...ROT_KEYS(), PCT('power', 'Strength'), BOOL('stab', 'Hold steady when no key is pressed', true)]; break;
    case 'joint': {
      const t = def.joint.type;
      if (t === 'hinge') f = [KEYF('a', 'Swing', 'hinge_a'), KEYF('b', 'Swing back', 'hinge_b'), PCT('speed', 'Speed', 100, 10, 300, 10), NUM('min', 'Lowest angle', -100, -100, 0, 5, '°'), NUM('max', 'Highest angle', 100, 0, 100, 5, '°'), BOOL('ret', 'Spring back to the middle')];
      else if (t === 'rotor' && def.joint.spinner) { f = [KEYF('a', 'On, off', 'spin'), PCT('speed', 'Speed', 100, 10, 300, 10), BOOL('rev', 'Spin the other way')]; note = 'Once on it keeps spinning until you switch it off.'; }
      else if (t === 'rotor' && def.joint.servo) { f = [KEYF('a', 'Turn left', 'left'), KEYF('b', 'Turn right', 'right'), NUM('angle', 'Turns up to', 30, 5, 90, 5, '°'), PCT('speed', 'Speed', 100, 10, 300, 10)]; note = 'Comes back to straight when the keys are let go.'; }
      else if (t === 'rotor') f = [KEYF('a', 'Turn left', 'rotor_l'), KEYF('b', 'Turn right', 'rotor_r'), PCT('speed', 'Speed', 100, 10, 400, 10)];
      else if (t === 'piston') f = [KEYF('a', 'Extend', 'piston_out'), KEYF('b', 'Retract', 'piston_in'), PCT('speed', 'Speed', 100, 10, 300, 10), NUM('travel', 'Stroke', 2, 0.25, 2, 0.25, 'm'), BOOL('ret', 'Pull back when no key is held')];
      else if (t === 'ball') f = null;
      else f = [PCT('stiff', 'Stiffness', 100, 25, 300, 5), PCT('damp', 'Damping', 100, 25, 300, 5)];
      break;
    }
    case 'winch': f = [KEYF('a', 'Reel in', 'winch_in'), KEYF('b', 'Let out', 'winch_out'), KEYF('rel', 'Let go', 'grab'), PCT('speed', 'Speed', 100, 10, 300, 10)]; break;
    case 'claw': f = [KEYF('k', 'Grab, let go', 'grab')]; break;
    case 'chute': f = [KEYF('k', 'Open, cut loose', 'chute')]; break;
    case 'decoupler':
      if (def.detacher) { f = [KEYF('k', 'Let go', 'detach')]; note = 'Everything built on its top face comes away.'; }
      else { f = [KEYF('k', 'Separate', 'stage')]; note = 'Decouplers left on the stage key fire one at a time, from the outside in. Give one a key of its own to fire it whenever you like.'; }
      break;
    case 'coupler': f = [KEYF('k', 'Let go', 'undock')]; note = 'Two couplers lock together when they touch, facing each other, on two different vehicles.'; break;
    case 'drill': f = [KEYF('k', 'Spin', 'fire')]; break;
    case 'lightbar': f = [KEYF('k', 'On, off', 'lights')]; break;
    case 'text': f = [{ id: 'text', type: 'text', label: 'Text', def: def.text.def, max: def.text.max }]; break;
    case 'dock': case 'grapple': f = [KEYF('k', 'Let go', 'undock')]; break;
    case 'anchor': f = [KEYF('k', 'Let go, re-arm', 'undock')]; break;
    case 'explosive': f = [KEYF('k', 'Detonate', '')]; note = 'It also blows up on a hard hit.'; break;
    case 'logic': {
      const L = def.logic;
      if (L === 'sensor') { f = [SEL('what', 'Measures', 'alt', SENSE), SEL('cmp', 'Presses when it is', 'gt', [['gt', 'More than'], ['lt', 'Less than']]), NUM('val', 'Value', 100, -1e6, 1e6, 1, '', true), KEYF('out', 'Presses', '')]; note = 'Measures where it sits. Tilt and distance go by the way its top faces.'; }
      else if (L === 'timer') { f = [KEYF('in', 'Starts on', ''), NUM('delay', 'Wait', 1, 0, 120, 0.5, 's'), NUM('dur', 'Then presses for', 1, 0, 120, 0.5, 's'), BOOL('loop', 'Repeat'), KEYF('out', 'Presses', '')]; note = 'With no start key it starts as soon as you drive. 0 s keeps pressing.'; }
      else if (L === 'gate') { f = [SEL('op', 'Gate', 'and', [['and', 'AND: both on'], ['or', 'OR: either on'], ['xor', 'XOR: just one on'], ['not', 'NOT: A off'], ['nand', 'NAND: not both'], ['nor', 'NOR: neither on']]), KEYF('a', 'Input A', ''), KEYF('b', 'Input B', ''), KEYF('out', 'Presses', '')]; }
      else if (L === 'toggle') { f = [KEYF('in', 'Switches on each press of', ''), BOOL('start', 'Starts on'), KEYF('out', 'Presses while on', '')]; }
      note = (note ? note + ' ' : '') + 'Outputs can be any key, or a channel (Ch 1 to Ch 8) that only logic and parts hear.';
      break;
    }
  }
  if (f) f.note = note;
  def._cfg = f; return f;
}
function cfgField(def, id) { const s = cfgSchema(def); return s ? s.find(f => f.id === id) : null; }
function cfgGet(p, id) {
  const v = p.cfg ? p.cfg[id] : undefined;
  if (v !== undefined) return v;
  const f = cfgField(p.def, id); return f ? f.def : undefined;
}
/* resolved keys of a part's key setting */
function partKeys(p, id) {
  let c = p._kc;
  const ver = BINDV * 2 + (G.settings.invertPitch ? 1 : 0);
  if (!c || c.v !== ver) c = p._kc = { v: ver };
  let r = c[id];
  if (!r) {
    const v = p.cfg ? p.cfg[id] : undefined;
    if (v !== undefined) r = v ? [v] : [];
    else { const f = cfgField(p.def, id); r = f && f.act ? actKeys(f.act).slice() : []; }
    c[id] = r;
  }
  return r;
}
/* what a saved design may hold: known settings only, each within its range */
const KEY_RX = /^(Shift\+)?[A-Za-z0-9]{1,24}$/;
function cleanCfg(cfg, def) {
  if (!cfg || typeof cfg !== 'object') return undefined;
  const s = cfgSchema(def); if (!s) return undefined;
  const out = {}; let n = 0;
  for (const f of s) {
    const v = cfg[f.id]; if (v === undefined) continue;
    if (f.type === 'key') { if (v === '' || (typeof v === 'string' && KEY_RX.test(v))) { out[f.id] = v; n++; } }
    else if (f.type === 'num') { const x = +v; if (isFinite(x)) { out[f.id] = clamp(x, f.min, f.max); n++; } }
    else if (f.type === 'bool') { out[f.id] = !!v; n++; }
    else if (f.type === 'sel') { if (f.opts.some(o => o[0] === v)) { out[f.id] = v; n++; } }
    else if (f.type === 'text') { if (typeof v === 'string') { out[f.id] = v.replace(/[<>]/g, '').slice(0, f.max); n++; } }
  }
  return n ? out : undefined;
}
/* short key summary for the builder's part keys view: opposite keys paired up, flaps only the axes they answer */
const PAIRS = { fwd: 'back', left: 'right', up: 'dn', rl: 'rr', yl: 'yr', a: 'b' };
function partKeySummary(p, com) {
  const s = cfgSchema(p.def); if (!s) return null;
  let keyF = s.filter(f => f.type === 'key');
  const custom = !!(p.cfg && keyF.some(f => p.cfg[f.id] !== undefined));
  const k1 = id => { const k = partKeys(p, id)[0]; return k ? keyName(k) : ''; };
  if (p.def.kind === 'logic') {
    const ins = keyF.filter(f => f.id !== 'out').map(f => k1(f.id)).filter(x => x);
    const out = k1('out');
    return out || ins.length ? { text: `${ins.join('·')}→${out || '?'}`, custom } : null;
  }
  if ((p.def.kind === 'flap' || p.def.kind === 'rudder') && com) {
    const m = p.m, nL = p.def.kind === 'flap' ? [m[2], m[5], m[8]] : [m[0], m[3], m[6]], zr = p.cen[2] - com.z, xr = p.cen[0] - com.x, ax = new Set();
    if (Math.abs(nL[1]) >= 0.6) { if (Math.abs(zr) > 0.25) ax.add('up'); if (Math.abs(xr) > 0.4) ax.add('rl'); }
    else if (Math.abs(nL[0]) >= 0.6 && Math.abs(zr) > 0.25) ax.add('yl');
    keyF = keyF.filter(f => ax.has(f.id) || ax.has(Object.keys(PAIRS).find(k => PAIRS[k] === f.id)));
  }
  const names = [], done = new Set();
  for (const f of keyF) {
    if (done.has(f.id)) continue; done.add(f.id);
    const mate = PAIRS[f.id] && keyF.find(g => g.id === PAIRS[f.id]);
    let t = k1(f.id);
    if (mate) { done.add(mate.id); const t2 = k1(mate.id); t = t && t2 ? `${t}/${t2}` : t || t2; }
    if (t && !names.includes(t)) names.push(t);
  }
  return names.length ? { text: names.slice(0, 4).join(' '), custom } : null;
}
/* ---------- per-frame inputs for the machine you drive ---------- */
const _ci = new V3(), _ci2 = new V3();
function clearInputs(o) {
  for (const w of o.wheels) { w.thr = 0; w.brk = 0; w.st = 0; w.rev = false; }
  for (const e of o.props) e.eng = 0; for (const e of o.jets) { e.eng = 0; e.boost = 0; } for (const e of o.boats) e.eng = 0;
  for (const e of o.rockets) e.lvl = 0;
  for (const f of o.foils) { f.inP = 0; f.inR = 0; f.inY = 0; }
  for (const g of o.gyros) { g.inP = 0; g.inR = 0; g.inY = 0; }
  o.sasW = null; o.sasHold = null;
  Object.assign(o.ctl, { thr: 0, eng: 0, steer: 0, pitch: 0, roll: 0, rocket: 0, tx: 0, tz: 0 });
}
const pressed = (p, id) => anyDown(partKeys(p, id)) ? 1 : 0;
function applyInputs(mach, live, dt, dtSim) {
  IN.real = live;
  runLogic(mach, dtSim);
  // RCS translate: the first W S A D keys slide the craft instead of steering it
  const tr = live && G.rcsMode && mach.some(o => o.rcsN > 0);
  IN.suppress.clear();
  let tx = 0, tz = 0;
  if (tr) {
    const k = id => actKeys(id)[0];
    tx = (realDown(k('right')) ? 1 : 0) - (realDown(k('left')) ? 1 : 0); tz = (realDown(k('pitch_dn')) ? 1 : 0) - (realDown(k('pitch_up')) ? 1 : 0);
    for (const id of ['right', 'left', 'pitch_dn', 'pitch_up']) if (k(id)) IN.suppress.add(k(id));
  }
  // body-wide stick for RCS blocks, the throttle lever, and what the HUD reports
  const gP = anyDown(actKeys('pitch_up')) - anyDown(actKeys('pitch_dn')), gR = anyDown(actKeys('roll_r')) - anyDown(actKeys('roll_l')), gY = anyDown(actKeys('right')) - anyDown(actKeys('left'));
  const lever = live ? G.throttle : 0;
  let anyThr = 0, anyEng = 0, anyRk = 0, anyBrk = 0, rev = false, horn = 0;
  for (const o of mach) {
    const cel = o.groundCel || dominantCel(o.x);
    for (const w of o.wheels) {
      const p = w.p;
      if (w.leg) continue;
      if (w.gear) { w.thr = 0; w.st = 0; w.brk = pressed(p, 'back'); anyBrk = Math.max(anyBrk, w.brk); continue; }
      const f = pressed(p, 'fwd'), bk = pressed(p, 'back'), inv = w.inv;
      let thr = 0, brk = 0;
      if (bk && !f) {
        // brake while still rolling forward, then reverse while the key stays down
        o.velAt(o.toWorld(w.hub.x, w.hub.y, w.hub.z, _ci), _ci2).sub(surfaceVel(cel, _ci, _ci));
        const vf = _ci2.dot(o.dirW(w.roll.x, w.roll.y, w.roll.z, _ci)) * inv;
        if (!w.rev && vf > 0.8) brk = 1; else { w.rev = true; thr = -1; }
      } else { w.rev = false; if (f) thr = 1; }
      w.thr = thr * inv; w.brk = brk * w.brkK;
      w.st = w.steerMode === 0 ? 0 : (pressed(p, 'right') - pressed(p, 'left')) * w.steerMode;
      // tracks steer by driving one side forward and the other back
      // (turning on the spot runs them slowly; on the move the inside track slows down)
      if (w.track) {
        const st = pressed(p, 'right') - pressed(p, 'left'); w.st = 0; w.vcap = 1;
        if (st) { if (w.thr) w.thr = clamp(w.thr + w.side * st * 0.6 * Math.sign(w.thr), -1, 1); else { w.thr = w.side * st; w.vcap = 0.16; } w.brk = 0; }
      }
      if (thr) anyThr = 1; if (w.brk > 0) anyBrk = Math.max(anyBrk, w.brk); if (w.rev) rev = true;
    }
    let vs = null;
    for (const e of o.props) {
      const p = e.p;
      if (e.heli) {
        // hover assist: climb or sink at a steady rate while a key is held, hold height when none is
        if (vs === null) { _ci.subVectors(o.x, cel.center).normalize(); vs = _ci2.subVectors(o.v, surfaceVel(cel, o.x, _ci2)).dot(_ci); }
        const tgt = pressed(p, 'up') ? 6 : pressed(p, 'dn') ? -5 : 0, err = tgt - vs;
        e.hv = clamp((e.hv || 0) + err * dt * 0.9, 0, 1);
        e.eng = clamp(e.hv + err * 0.25, 0, 1); if (e.eng > 0.02) anyEng = 1;
        continue;
      }
      e.eng = pressed(p, 'fwd') ? 1 : pressed(p, 'back') ? -1 : e.lever ? lever : 0; if (e.eng) anyEng = 1;
    }
    for (const e of o.jets) { const p = e.p; e.eng = pressed(p, 'fwd') ? 1 : e.lever ? lever : 0; e.boost = e.ab && e.eng > 0 ? pressed(p, 'boost') : 0; if (e.eng) anyEng = 1; }
    // weapons fire while their key is held, as fast as they reload
    for (const g of o.guns) { g.cd = Math.max(0, g.cd - dtSim); if (live && g.cd <= 0 && g.p.alive && pressed(g.p, 'fire')) { fireGun(o, g); g.cd = g.p.def.gun.reload; } }
    for (const p of o.horns) if (live && p.alive && pressed(p, 'k')) horn = 1;
    for (const d of o.drills) d.on = live && d.p.alive && pressed(d.p, 'k') ? 1 : 0;
    for (const e of o.boats) { const p = e.p; e.eng = pressed(p, 'fwd') ? 1 : pressed(p, 'back') ? -1 : e.lever ? lever : 0; if (e.eng) anyEng = 1; }
    for (const e of o.rockets) { const p = e.p; e.lvl = Math.max(e.lever ? lever : 0, pressed(p, 'fire')) * e.pw; if (e.lvl > 0) anyRk = 1; }
    for (const f of o.foils) { if (!f.isFlap) continue; const p = f.p; f.inP = pressed(p, 'up') - pressed(p, 'dn'); f.inR = pressed(p, 'rr') - pressed(p, 'rl'); f.inY = pressed(p, 'yr') - pressed(p, 'yl'); }
    for (const g of o.gyros) { const p = g.p; g.inP = pressed(p, 'up') - pressed(p, 'dn'); g.inR = pressed(p, 'rr') - pressed(p, 'rl'); g.inY = pressed(p, 'yr') - pressed(p, 'yl'); }
    Object.assign(o.ctl, { thr: anyThr, eng: anyEng, rocket: anyRk, steer: tr ? 0 : gY, pitch: gP, roll: gR, tx: tr ? tx : 0, tz: tr ? tz : 0 });
    o.ctl.brake = 0;
  }
  G.braking = anyBrk; G.reversing = rev; G.horn = horn;
  // moving parts and winches
  for (const j of W.joints) {
    const p = j.jp; if (!p.alive || !mach.includes(p.body)) continue;
    const a = pressed(p, 'a'), b = pressed(p, 'b'), sp = cfgGet(p, 'speed') / 100;
    if (j.type === 'hinge') {
      const lo = cfgGet(p, 'min') * Math.PI / 180, hi = cfgGet(p, 'max') * Math.PI / 180, st = 1.3 * sp * dt, d = a - b;
      if (d) j.target = clamp(j.target + d * st, lo, hi);
      else if (cfgGet(p, 'ret')) j.target -= clamp(j.target, -st, st);
      j.target = clamp(j.target, lo, hi);
    } else if (j.type === 'rotor' && j.def.spinner) {
      // a spinner keeps going once switched on
      for (const c of partKeys(p, 'a')) if (edgeOf(c)) { j.on = !j.on; if (live) toast(j.on ? 'Spinner on' : 'Spinner off', 900); break; }
      const was = j.spin; j.spin = j.on ? 6 * sp * (cfgGet(p, 'rev') ? -1 : 1) : 0; if (was && !j.spin) j.hold = j.theta;
    } else if (j.type === 'rotor' && j.def.servo) {
      // a servo turns toward an angle while its keys are held, and back to straight when they are let go
      const tgt = (b - a) * cfgGet(p, 'angle') * Math.PI / 180, st = 3 * sp * dt;
      j.spin = 0; j.hold += clamp(tgt - j.hold, -st, st);
    } else if (j.type === 'rotor') {
      const was = j.spin; j.spin = (b - a) * 2.5 * sp; if (was && !j.spin) j.hold = j.theta;
    } else if (j.type === 'piston') {
      const st = 0.9 * sp * dt, d = a - b, top = Math.min(j.def.travel, cfgGet(p, 'travel'));
      if (d) j.target = clamp(j.target + d * st, 0, top);
      else if (cfgGet(p, 'ret')) j.target = Math.max(0, j.target - st);
      j.target = Math.min(j.target, top);
    }
  }
  for (const r of W.ropes) {
    const p = r.wp; if (!p.alive || !mach.includes(p.body)) continue;
    const d = pressed(p, 'b') - pressed(p, 'a');
    if (d) r.L = clamp(r.L + d * 3 * (cfgGet(p, 'speed') / 100) * dt, 1.2, 60);
  }
  partActions(mach, live);
  sasUpdate(mach, live && (gP || gR || gY));
  endEdges();
}
/* parts that do something once per key press: grouped by key so one press works them together */
function partActions(mach, live) {
  const G2 = new Map();
  const add = (code, kind, item) => { let g = G2.get(code); if (!g) G2.set(code, g = { chute: [], grab: [], hook: [], gear: [], dock: [], anchor: [], dec: [], bomb: [], mag: [], cpl: [], lb: [] }); g[kind].push(item); };
  for (const o of mach) for (const p of o.acts) {
    if (!p.alive) continue;
    const k = p.def.kind;
    if (k === 'decoupler') { if (p.def.detacher || (p.cfg && p.cfg.k !== undefined)) for (const c of partKeys(p, 'k')) add(c, 'dec', p); continue; }
    if (k === 'coupler') { for (const c of partKeys(p, 'k')) add(c, 'cpl', p); continue; }
    if (k === 'lightbar') { for (const c of partKeys(p, 'k')) add(c, 'lb', p); continue; }
    if (k === 'gear') { for (const c of partKeys(p, 'fold')) add(c, 'gear', o); continue; }
    if (k === 'winch') { for (const c of partKeys(p, 'rel')) add(c, 'hook', p); continue; }
    const kind = k === 'chute' ? 'chute' : k === 'claw' ? 'grab' : k === 'dock' || k === 'grapple' ? 'dock' : k === 'anchor' ? 'anchor' : k === 'explosive' || k === 'balloon' ? 'bomb' : k === 'magnet' ? 'mag' : null;
    if (kind) for (const c of partKeys(p, 'k')) add(c, kind, kind === 'anchor' ? o : p);
  }
  for (const [code, g] of G2) {
    if (!edgeOf(code)) continue;
    if (g.chute.length) chuteGroup(g.chute, live);
    if (g.grab.length || g.hook.length) grabGroup(mach, g.grab, g.hook, live);
    if (g.gear.length) { const bs = [...new Set(g.gear)], up = !bs[0].gearUp; for (const o of bs) o.gearUp = up; if (live) toast(up ? 'Gear up' : 'Gear down', 1100); }
    if (g.dock.length || g.anchor.length) dockGroup(g.dock, [...new Set(g.anchor)], live);
    if (g.dec.length) { const byBody = new Map(); for (const p of g.dec) { if (!p.alive || !p.body) continue; let l = byBody.get(p.body); if (!l) byBody.set(p.body, l = []); l.push(p); } for (const [b, l] of byBody) decoupleParts(b, l); if (live) toast('Separated', 1100); }
    if (g.bomb.length) for (const p of g.bomb) if (p.alive) addDmg(p, 1e9);
    if (g.mag.length) magnetGroup(g.mag, live);
    if (g.cpl.length) { const n = uncouple(g.cpl); if (live) toast(n ? 'Uncoupled' : 'Not coupled to anything', 1200); }
    if (g.lb.length) { const on = !g.lb.some(p => p.lbOn); for (const p of g.lb) p.lbOn = on; if (live) toast(on ? 'Lights on' : 'Lights off', 900); if (typeof SND !== 'undefined') SND.play('click'); }
  }
  // the stage key fires the outermost decouplers that don't have keys of their own
  for (const c of actKeys('stage')) if (edgeOf(c)) { stageNext(mach, live); break; }
}
/* magnets: on, and they pull; off again lets go of whatever they hold */
function magnetGroup(ms, live) {
  const held = new Set(ms.filter(p => p.linked || p.grip));
  if (held.size) releaseParts(held);
  const on = !ms.some(p => p.mag);
  for (const p of ms) p.mag = on;
  if (typeof SND !== 'undefined') SND.play(on ? 'magnet' : 'click');
  if (live) toast(on ? 'Magnet on' : held.size ? 'Magnet off: let go' : 'Magnet off', 1100);
}
function chuteGroup(ch, live) {
  const packed = ch.filter(p => !p.chute);
  if (packed.length) { for (const p of packed) { p.chute = 1; p.chuteK = 0; } if (typeof SND !== 'undefined') SND.play('chute'); if (live) toast('Parachutes out. Press again to cut them loose', 1800); }
  else { const open = ch.filter(p => p.chute === 1); for (const p of open) p.chute = 2; if (live) toast(open.length ? 'Parachutes cut' : 'Parachutes already used', 1400); }
}
function grabGroup(mach, claws, winches, live) {
  const hooks = W.ropes.filter(r => winches.includes(r.wp) && r.hook && !r.hook.dead).map(r => r.hook);
  const held = new Set([...claws.filter(p => p.linked || p.grip), ...hooks.map(h => h.parts[0]).filter(p => p && p.linked)]);
  if (held.size) { releaseParts(held); for (const h of hooks) h.dockCool = 2; if (live) toast('Let go', 1100); return; }
  let n = 0;
  for (const o of mach) for (const cl of o.claws) if (cl.p.alive && claws.includes(cl.p) && clawGrab(o, cl)) n++;
  if (!n && live) toast(claws.length ? 'Nothing between the jaws' : 'Winch hooks grab on their own when they touch something', 1800);
}
function dockGroup(ports, anchors, live) {
  const linked = new Set(ports.filter(p => p.linked));
  if (linked.size) { releaseParts(linked); if (live) toast('Undocked', 1200); return; }
  if (!anchors.length) { if (live && ports.length) toast('Not docked', 1100); return; }
  if (anchors.some(o => o.anchored)) { for (const o of anchors) { o.anchorOff = true; unanchorBody(o); } if (live) toast('Anchor let go. Press again to re-arm it', 2200); }
  else { for (const o of anchors) o.anchorOff = false; if (live) toast('Anchor armed: it locks when the spikes touch the ground', 2400); }
}
function stageNext(mach, live) {
  const b = G.player; if (!b || b.dead) return;
  if (stageBody(b)) { if (live) toast('Stage separated', 1400); }
  else if (live) toast('No decouplers on the stage key', 1600);
}
/* the outermost stage-key decouplers of one body, counted from the seat */
function stageBody(b) {
  let ds = b.parts.filter(p => p.alive && p.def.kind === 'decoupler' && !p.def.detacher && !(p.cfg && p.cfg.k !== undefined));
  if (!ds.length) return false;
  const seat = b.parts.find(p => p.def.kind === 'seat' && !p.broken);
  if (seat) {
    const dist = partDistances(b.parts.filter(p => p.alive), seat);
    let mx = -1; for (const d of ds) mx = Math.max(mx, dist.has(d) ? dist.get(d) : -1);
    ds = ds.filter(d => (dist.has(d) ? dist.get(d) : -1) === mx);
  }
  decoupleParts(b, ds);
  return true;
}

/* ---------- logic blocks ---------- */
function runLogic(mach, dt) {
  const nx = IN.vkB; nx.clear();
  for (const o of mach) for (const p of o.logic) if (p.alive) logicStep(o, p, dt, nx);
  IN.vkB = IN.vk; IN.vk = nx;
}
const _lg = new V3(), _lg2 = new V3(), _lg3 = new V3();
function sensorValue(o, p, what) {
  const pos = o.toWorld(p.cen[0], p.cen[1], p.cen[2], _lg), cel = dominantCel(pos);
  const up = _lg2.subVectors(pos, cel.center), r = up.length(); up.divideScalar(r);
  switch (what) {
    case 'alt': { let h = cel.height ? cel.height(up.x, up.y, up.z) : 0; if (cel.sea) h = Math.max(h, 0); return r - cel.R - h; }
    case 'asl': return r - cel.R;
    case 'spd': case 'vs': {
      const low = r - cel.R < spaceAlt(cel);
      o.velAt(pos, _lg3).sub(low ? surfaceVel(cel, pos, _ci) : cel.vel);
      return what === 'spd' ? _lg3.length() * 3.6 : _lg3.dot(up);
    }
    case 'tilt': { const t = p.topDir; o.dirW(t[0], t[1], t[2], _lg3); return Math.acos(clamp(_lg3.dot(up), -1, 1)) * 180 / Math.PI; }
    case 'dist': {
      const t = p.topDir; o.dirW(t[0], t[1], t[2], _lg3);
      const from = _ci.copy(pos).addScaledVector(_lg3, CELL * 0.6);
      let best = 1000; const h = groundRay(from, _lg3, 1000); if (h) best = h.t;
      if (W.bodies.length > 1) { const bh = bodyRay(o, from, _lg3, best); if (bh) best = Math.min(best, bh.t); }
      return best;
    }
    case 'fuel': return o.fuelMax > 0 ? o.fuel / o.fuelMax * 100 : 0;
  }
  return 0;
}
function logicStep(o, p, dt, out) {
  const s = p.ls || (p.ls = { on: false, t: -1, last: false, init: false, v: 0 });
  let on = false;
  switch (p.def.logic) {
    case 'sensor': { const v = s.v = sensorValue(o, p, cfgGet(p, 'what')), lim = cfgGet(p, 'val'); on = cfgGet(p, 'cmp') === 'lt' ? v < lim : v > lim; break; }
    case 'gate': {
      const a = !!pressed(p, 'a'), b = !!pressed(p, 'b');
      switch (cfgGet(p, 'op')) { case 'and': on = a && b; break; case 'or': on = a || b; break; case 'xor': on = a !== b; break; case 'not': on = !a; break; case 'nand': on = !(a && b); break; case 'nor': on = !(a || b); break; }
      break;
    }
    case 'toggle': {
      if (!s.init) { s.init = true; s.on = !!cfgGet(p, 'start'); }
      const i = !!pressed(p, 'in'); if (i && !s.last) s.on = !s.on; s.last = i; on = s.on; break;
    }
    case 'timer': {
      const ik = partKeys(p, 'in'), i = ik.length ? anyDown(ik) : true;
      if (i && !s.last) s.t = 0; s.last = i;
      if (s.t >= 0) {
        s.t += dt;
        const d0 = cfgGet(p, 'delay'), d1 = cfgGet(p, 'dur');
        if (s.t >= d0) { if (d1 <= 0 || s.t < d0 + d1) on = true; else if (cfgGet(p, 'loop')) s.t = 0; else s.t = -1; }
      }
      break;
    }
  }
  s.out = on;
  if (on) for (const c of partKeys(p, 'out')) out.add(c);
}

/* ---------- SAS: gyros, RCS and flaps hold the craft still or point it ---------- */
const SAS = { on: false, mode: 'hold', target: null };
const SAS_MODES = [['hold', 'Hold'], ['pro', 'Prograde'], ['retro', 'Retrograde'], ['norm', 'Normal'], ['anti', 'Anti-normal'], ['rout', 'Radial out'], ['rin', 'Radial in'], ['target', 'Target'], ['level', 'Level']];
function sasCapable(o) { return o.gyros.length > 0 || o.rcsN > 0 || o.foils.some(f => f.isFlap); }
const _sq = new Quat(), _sq2 = new Quat(), _sa = new V3(), _sd = new V3(), _sr = new V3(), _sv2 = new V3(), _sn = new V3();
function sasTargetPos() {
  const t = SAS.target; if (!t) return null;
  if (t.body) return t.body.dead ? null : t.body.x;
  return t.cel ? t.cel.center : null;
}
/* desired turn rate (world, relative to the frame the gyros hold still in) */
function sasUpdate(mach, manual) {
  for (const o of mach) {
    if (!SAS.on || !sasCapable(o) || o.dock || o.anchored) { o.sasW = null; o.sasHold = null; continue; }
    const w = o.sasW || (o.sasW = new V3());
    const ref = o.airCel || o.groundCel || null;
    let tq = o.rcsN > 0 && o.fuel > 0 ? o.rcsT : 0; for (const g of o.gyros) tq += g.torque * g.pw;
    const I = Math.max(o.Idiag[0], o.Idiag[1], o.Idiag[2]), alpha = tq > 0 ? tq / I : 0.6;
    const rate = a => Math.min(0.7, 2 * a, Math.sqrt(alpha * a));
    // which way to point
    let mode = SAS.mode, haveDir = false;
    if (mode !== 'hold' && mode !== 'level') {
      const cel = dominantCel(o.x), r = _sr.subVectors(o.x, cel.center), low = r.length() - cel.R < spaceAlt(cel);
      if (mode === 'target') { const tp = sasTargetPos(); if (tp) { _sd.subVectors(tp, o.x); haveDir = _sd.lengthSq() > 1; } }
      else {
        const vs = _sv2.copy(o.v).sub(low && (mode === 'pro' || mode === 'retro') ? surfaceVel(cel, o.x, _sd) : cel.vel);
        if (vs.lengthSq() > 0.09) {
          haveDir = true;
          if (mode === 'pro') _sd.copy(vs); else if (mode === 'retro') _sd.copy(vs).negate();
          else {
            const vo = _sv2.copy(o.v).sub(cel.vel), n = _sn.crossVectors(r, vo);
            if (n.lengthSq() < 1e-6) haveDir = false;
            else if (mode === 'norm') _sd.copy(n); else if (mode === 'anti') _sd.copy(n).negate();
            else { _sd.copy(vo).normalize(); const ro = _sa.copy(r).addScaledVector(_sd, -r.dot(_sd)); _sd.copy(ro); if (mode === 'rin') _sd.negate(); }
          }
        }
      }
      if (!haveDir) mode = 'hold';
    }
    if (mode === 'level') {
      const cel = dominantCel(o.x); _sd.subVectors(o.x, cel.center).normalize();
      o.dirW(0, 1, 0, _sa); pointRate(_sa, _sd, rate, w); o.sasHold = null; continue;
    }
    if (mode !== 'hold') { const ax = o.sasAxis; o.dirW(ax.x, ax.y, ax.z, _sa); pointRate(_sa, _sd.normalize(), rate, w); o.sasHold = null; continue; }
    // hold: keep the attitude it had when you let go of the keys (turning with the world near the ground)
    if (manual || !o.sasHold || o.sasRef !== ref) { o.sasHold = (o.sasHold || new Quat()).copy(o.q); if (ref) o.sasHold.premultiply(_sq.copy(ref.spinQ).invert()); o.sasRef = ref; }
    const qh = ref ? _sq.copy(ref.spinQ).multiply(o.sasHold) : _sq.copy(o.sasHold);
    const qe = qh.multiply(_sq2.copy(o.q).invert());
    if (qe.w < 0) { qe.x = -qe.x; qe.y = -qe.y; qe.z = -qe.z; qe.w = -qe.w; }
    const s = Math.hypot(qe.x, qe.y, qe.z);
    if (s < 1e-6) { w.set(0, 0, 0); continue; }
    const ang = 2 * Math.atan2(s, qe.w);
    w.set(qe.x / s, qe.y / s, qe.z / s).multiplyScalar(rate(ang));
  }
}
function pointRate(a, d, rate, out) {
  out.crossVectors(a, d);
  const s = out.length(), c = a.dot(d), ang = Math.atan2(s, c);
  if (s < 1e-6) { if (c > 0) { out.set(0, 0, 0); return; } tangentBasis(a.x, a.y, a.z, out, _sn); out.multiplyScalar(rate(ang)); return; }
  out.multiplyScalar(rate(ang) / s);
}
function toggleSAS(on = !SAS.on) {
  const b = G.player; if (!b || b.dead) return;
  if (on && !machineOf(b).some(sasCapable)) { toast('SAS needs a Gyroscope, RCS Block or Control Flap to steer with', 2600); SAS.on = false; return; }
  SAS.on = on; for (const o of machineOf(b)) o.sasHold = null;
  toast(on ? `SAS on: ${SAS_MODES.find(m => m[0] === SAS.mode)[1].toLowerCase()}` : 'SAS off', 1300);
  if (typeof renderSAS === 'function') renderSAS();
}
function setSASMode(m) {
  if (m === 'target' && !sasTargetPos()) { openTargetPicker(); return; }
  SAS.mode = m;
  if (!SAS.on) toggleSAS(true); else { for (const o of machineOf(G.player)) o.sasHold = null; renderSAS(); }
}

/* ---------- key capture for the Configure tool and the Controls page ---------- */
let CAPTURE = null;
function captureKey(cb) { CAPTURE = cb; }
function captureKeydown(e) {
  if (!CAPTURE) return false;
  e.preventDefault(); e.stopPropagation();
  const c = e.code;
  if (/^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/.test(c)) return true;
  const cb = CAPTURE; CAPTURE = null;
  if (c === 'Escape') cb(null); else cb(e.shiftKey ? 'Shift+' + c : c);
  return true;
}

'use strict';
/* ================= Scrapline · title screen and menu =================
   The game opens on a title screen. Behind the menu, little scenes play one after another, like Trailmakers' and
   Minecraft's: real vehicles from the library parked in real places (the launch pad, the city, a station, the Moon,
   Lagoon's beaches, Iris, the black hole), the camera drifting slowly round them. The Menu button brings the same
   menu up later, over the game, paused. */
const TITLE = { on: false, pause: false, scenes: [], i: -1, t: 0, bodies: [], focus: null, fr: null, busy: false, cam: null };
const DIORAMAS = [
  { cap: 'The launch pad · Terra', loc: 'pad', main: 'Starfarer', extras: ['Rover'], dist: 26, pitch: 0.18, yaw: 2.5, lift: 9 },
  { cap: 'Millbrook station · Terra', loc: 'st_g_millbrook', main: 'Locomotive', extras: [], dist: 24, pitch: 0.28, yaw: 0.9, lift: 2 },
  { cap: 'Grand Metro · Terra', loc: 'g_grand_metro', main: 'Truck', extras: ['Racer'], dist: 30, pitch: 0.3, yaw: 2.2, lift: 2 },
  { cap: 'The Moon', loc: 'moon', main: 'Base Hauler', extras: ['Hopper'], dist: 28, pitch: 0.32, yaw: 0.6, lift: 2 },
  { cap: 'Lagoon · Sapphire, a blue giant', loc: 's_Lagoon', main: 'Hovercraft', extras: [], dist: 20, pitch: 0.25, yaw: 1.4, lift: 1 },
  { cap: 'Iris · Ruby, a red dwarf', loc: 's_Iris', main: 'Bruiser', extras: [], dist: 22, pitch: 0.2, yaw: 2.8, lift: 2 },
  { cap: 'Maw, a black hole', loc: 'o_Maw', main: 'Comet', extras: [], dist: 13, pitch: 0, yaw: 0, lift: 0, space: true, hole: true }
];
const SCENE_T = 11;

function titleHTML(paused) {
  return `<div class="tmenu panel">
      <div class="tmark">SCRAP<span>LINE</span></div>
      <p class="ttag">Build anything from blocks. Drive it, fly it, sail it, and take it to the stars.</p>
      <nav class="tbtns">
        <button type="button" class="tbtn primary" data-t="play">${paused ? 'Resume' : 'Play'}</button>
        <button type="button" class="tbtn" data-t="library">Vehicle library</button>
        <button type="button" class="tbtn" data-t="settings">Settings</button>
        <button type="button" class="tbtn" data-t="help">How to play</button>
        ${paused ? '<button type="button" class="tbtn" data-t="title">Title screen</button>' : ''}
      </nav>
      <p class="tnote">${paused ? 'The game is paused.' : 'Play starts in the builder with your last vehicle.'}</p>
    </div>
    <div class="tcap" id="titleCap"></div>`;
}
/* first thing on screen: the title, with the scenes behind it */
function showTitle() {
  wreckResetAll();
  TITLE.on = true; TITLE.pause = false; TITLE.i = -1; TITLE.t = SCENE_T; document.body.classList.add('title');
  const el = $('title'); el.innerHTML = titleHTML(false); el.hidden = false; el.classList.remove('paused');
  B.group.visible = false;
  focusFirst();
}
/* later, from the Menu button: the same menu over the game, which waits */
function openMenu() {
  if (TITLE.on) return;
  closeModal(); if (BASES.mode) exitBaseMode();
  TITLE.pause = true; document.body.classList.add('paused');
  const el = $('title'); el.innerHTML = titleHTML(true); el.hidden = false; el.classList.add('paused');
  KEYS.clear(); focusFirst();
}
function closeMenu() {
  TITLE.pause = false; document.body.classList.remove('paused');
  $('title').hidden = true; $('title').classList.remove('paused'); $('view').focus();
}
function focusFirst() { const b = $('title').querySelector('.tbtn'); if (b) b.focus({ preventScroll: true }); }
function titleAction(a) {
  if (a === 'play') { if (TITLE.pause) closeMenu(); else leaveTitle(); }
  else if (a === 'library') openLibrary(false);
  else if (a === 'settings') openSettings();
  else if (a === 'help') openHelp();
  else if (a === 'title') { closeMenu(); setMode('build', false, null, true); worldSave(); showTitle(); }
}
/* off the title and into the builder, as the game used to start */
async function leaveTitle() {
  if (!TITLE.on || TITLE.leaving) return;
  TITLE.leaving = true;
  await titleFade(1);
  clearScene();
  TITLE.on = false; TITLE.leaving = false; document.body.classList.remove('title');
  $('title').hidden = true;
  G.spawnLoc = 'pad'; $('spawnSel').value = 'pad';
  B.group.visible = true;
  setMode('build', true);
  titleFade(0);
  if (TITLE.after) { const f = TITLE.after; TITLE.after = null; f(); }
}
const titleFade = v => new Promise(r => { const f = $('titleFade'); f.style.opacity = v; setTimeout(r, 650); });
function clearScene() {
  for (const b of TITLE.bodies) if (!b.dead) removeMachine(b);
  TITLE.bodies = []; TITLE.focus = null;
}
/* one scene: its vehicles set down at its place, a moment for them and the ground round them to settle */
async function nextScene() {
  if (TITLE.busy) return; TITLE.busy = true;
  await titleFade(1);
  if (!TITLE.on) { TITLE.busy = false; return; }
  clearScene();
  for (let tries = 0; tries < DIORAMAS.length; tries++) {
    TITLE.i = (TITLE.i + 1) % DIORAMAS.length;
    const S = DIORAMAS[TITLE.i], ex = EXAMPLES.find(e => e.d.name === S.main);
    if (!ex || !WORLD.locs[S.loc]) continue;
    try {
      const b = createVehicle(ex.d, { brake: 1 });
      for (const o of machineOf(b)) o.diorama = true;
      let fr = spawnAtLocation(b, S.loc) || frameAt(new V3(0, 1, 0), new V3(0, 0, 1));
      // by the black hole: stood upright against its disk, the hole off to one side behind it
      // (seen from just under the disk, so its bright side, the one spinning toward you, is on the right, clear of the menu)
      if (S.hole) {
        const n = TITLE.holeN = sky.hole.lensMat.uniforms.nrm.value.clone().negate(), r = MAW.R * 16;
        const out = new V3().subVectors(b.x, MAW.center).normalize(); out.addScaledVector(n, -2 * out.dot(n));
        const vel = new V3().subVectors(b.v, MAW.vel).normalize().multiplyScalar(Math.sqrt(MAW.mu / r)).add(MAW.vel);
        fr = frameAt(n.clone(), out.clone().negate()); placeBody(b, fr, MAW.center.clone().addScaledVector(out, r), vel, 0);
      }
      ensureBuiltNear(b.x);
      TITLE.bodies.push(b); TITLE.focus = b; TITLE.fr = fr; TITLE.scene = S;
      // the others parked alongside
      const cel = dominantCel(b.x);
      let side = b.radius + 3;
      for (const name of S.extras) {
        const e2 = EXAMPLES.find(e => e.d.name === name); if (!e2) continue;
        const nb = createVehicle(e2.d, { brake: 1 }); for (const o of machineOf(nb)) o.diorama = true;
        side += nb.radius + 2;
        const at = b.x.clone().addScaledVector(fr.right, side), up = at.clone().sub(cel.center).normalize(), f2 = frameAt(up, fr.fwd);
        const h = cel.height ? groundHeightUnder(cel, cel.center.clone().addScaledVector(up, cel.R), f2, Math.min(nb.radius, 20)) : 0;
        placeBody(nb, f2, cel.center.clone().addScaledVector(up, cel.R + Math.max(h, cel.sea ? 0 : -1e9)), cel.vel, 0.4, cel);
        TITLE.bodies.push(nb); side += nb.radius + 1;
      }
      for (let k = 0; k < (S.space ? 0 : 150); k++) physicsStep(FIXED_DT);
      for (const o of TITLE.bodies.flatMap(x => machineOf(x))) o.sleepT = 99;
      TITLE.cam = { yaw: S.yaw, dist: S.dist + Math.min(b.radius, 30) * 0.8, pitch: S.pitch, lift: S.lift };
      $('titleCap').textContent = S.cap;
      break;
    } catch (err) { console.warn('scene', S.cap, err); clearScene(); }
  }
  // let the ground near the camera come in before showing it
  for (let k = 0; k < 10; k++) { titleCamera(0); updateTerrains(camera.position); for (const t of TERS) if (!t.skip) t.process(30); await nextFrame(); }
  TITLE.t = 0; TITLE.busy = false;
  if (TITLE.on) titleFade(0);
}
/* the camera drifts round the scene's main vehicle */
const _tcU = new V3(), _tcF = new V3(), _tcR = new V3(), _tcP = new V3();
function titleCamera(dt) {
  const b = TITLE.focus, C = TITLE.cam; if (!b || b.dead || !C) return;
  C.yaw += dt * 0.045;
  if (TITLE.scene && TITLE.scene.hole) {
    // the vehicle in the middle, the hole and its disk off to the right of it
    const h = _tcF.subVectors(MAW.center, b.x).normalize(), n = TITLE.holeN, s = _tcR.crossVectors(h, n).normalize();
    const hf = Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect), a = Math.min(0.36, hf * 0.6) + 0.05 * Math.sin(C.yaw * 4), k = Math.min(0.38, hf * 0.48);
    camera.position.copy(b.x).addScaledVector(h, -Math.cos(a) * C.dist).addScaledVector(s, Math.sin(a) * C.dist).addScaledVector(n, C.dist * 0.08);
    _tcP.copy(h).multiplyScalar(Math.cos(k)).addScaledVector(s, -Math.sin(k)).add(camera.position);
    camera.up.copy(n); camera.lookAt(_tcP);
    return;
  }
  const cel = dominantCel(b.x), up = _tcU.subVectors(b.x, cel.center).normalize();
  const f = _tcF.copy(TITLE.fr.fwd).addScaledVector(up, -TITLE.fr.fwd.dot(up)).normalize(), r = _tcR.crossVectors(f, up);
  const focus = _tcP.copy(b.x).addScaledVector(up, C.lift);
  const cp = Math.cos(C.pitch), sp = Math.sin(C.pitch);
  camera.position.copy(focus).addScaledVector(f, -Math.cos(C.yaw) * cp * C.dist).addScaledVector(r, Math.sin(C.yaw) * cp * C.dist).addScaledVector(up, sp * C.dist);
  if (cel.height) {
    const cr = camera.position.clone().sub(cel.center), crl = cr.length(); cr.divideScalar(crl);
    const lcr = toSpin(cel, cr, new V3());
    let gh = cel.R + Math.max(cel.height(lcr.x, lcr.y, lcr.z), cel.sea ? 0 : -1e9) + 2;
    if (crl < gh) camera.position.copy(cel.center).addScaledVector(cr, gh);
  }
  camera.up.copy(up); camera.lookAt(focus);
}
/* called every frame while the title is up */
function titleStep(dt) {
  TITLE.t += dt;
  if (!TITLE.busy && TITLE.t > SCENE_T) nextScene();
  // the world goes on (trains run, the scene's vehicles sit still)
  const n = Math.min(4, Math.round(dt / FIXED_DT));
  for (let k = 0; k < n; k++) physicsStep(FIXED_DT);
  nearFar(); titleCamera(dt);
}
function initTitle() {
  $('title').addEventListener('click', e => { const t = e.target.closest('[data-t]'); if (!t) return; t.blur(); titleAction(t.dataset.t); });
  $('btnMenu').onclick = e => { e.currentTarget.blur(); openMenu(); };
}
/* the menu's own keys: arrows move between its buttons, Enter or Space presses one */
function titleKey(e) {
  if ($('title').hidden || !$('modalWrap').hidden) return false;
  const btns = [...$('title').querySelectorAll('.tbtn')], i = btns.indexOf(document.activeElement);
  if (e.code === 'ArrowDown' || e.code === 'ArrowUp') { e.preventDefault(); const j = i < 0 ? 0 : (i + (e.code === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length; btns[j].focus(); return true; }
  if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); (i >= 0 ? btns[i] : btns[0]).click(); return true; }
  if (e.code === 'Escape' && TITLE.pause) { closeMenu(); return true; }
  return true;   // nothing else reaches the game while the menu is up
}

'use strict';
/* ================= Scrapline · cloud saves =================
   Saved vehicles (and bases) follow you from one device to another.
   - Inside Claude, they are kept in your own private corner of this page's database, tied to your Claude account:
     open Scrapline signed in on any device and they are there. Nobody else can see them.
   - On the website, they are kept on the site's own server under a save code. Turn it on in the vehicle library on
     one device, then type the same code on another. (The site's owner adds a free database once: see README.)
   The browser keeps its own copy as well, so it all works offline. The copies are merged: every vehicle carries an
   id and the time it was last saved, the newest copy of each wins, and a deleted vehicle leaves a note so it stays
   deleted everywhere. */
const CLOUD = { kind: null, api: null, status: 'off', note: '', last: 0, busy: false, again: false, timer: 0, code: null, siteReady: null };
const CLOUD_WORDS = ('amber anchor apple arrow atlas autumn badger banjo basil beacon birch bison blaze bolt bonsai breeze brick bronze cactus ' +
  'camel canyon cedar cherry cinder clover cobalt comet copper coral cosmos crane crater crystal cypress delta desert dingo dolphin dragon ' +
  'drift dune eagle echo ember falcon fern fjord flint forest fossil fox frost galaxy garnet gecko geyser glacier granite gravel harbor hawk ' +
  'hazel heron hickory horizon iceberg indigo iris island ivory jade jaguar jasper jungle kayak kelp kestrel koala lagoon lantern lava ' +
  'lemon lichen lilac lizard lotus lynx magma mango maple marble meadow meteor mint moose moss nebula nickel nova oak oasis ocean olive ' +
  'onyx orbit orchid otter owl panda pebble pepper pine planet plasma pluto polar pony prairie puffin quartz quasar rabbit radar raven ' +
  'reef ridge river robin rocket ruby saffron salmon sand sapphire saturn sequoia shadow shark sierra silver sky slate sparrow spruce ' +
  'squid star storm summit sunset swift tango thunder tiger timber topaz tornado tulip tundra turbo turtle valley velvet violet volcano ' +
  'walnut walrus willow wolf yak zebra zephyr').split(' ');

/* ---- the local copy: every saved vehicle gets an id and a time ---- */
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function stampSaves(list) {
  let changed = false;
  for (const d of list) { if (!d.id) { d.id = newId(); changed = true; } if (typeof d.t !== 'number') { d.t = 0; changed = true; } }
  return changed;
}
function localState() {
  const saves = savedList(); if (stampSaves(saves)) LS.set('scrapline.saves', saves);
  const deleted = LS.get('scrapline.deleted', {}) || {};
  const bases = typeof basesState === 'function' ? basesState() : null;
  return { saves, deleted, bases };
}
/* the library calls these when it changes the list */
function noteSaved(d) { if (!d.id) d.id = newId(); d.t = Date.now(); }
function noteDeleted(d) { if (!d || !d.id) return; const del = LS.get('scrapline.deleted', {}) || {}; del[d.id] = Date.now(); LS.set('scrapline.deleted', del); cloudChanged(); }
/* two copies into one: the newest of each vehicle, minus the deleted ones */
function mergeStates(a, b) {
  const deleted = { ...(a.deleted || {}) };
  for (const [k, t] of Object.entries(b.deleted || {})) if (!(deleted[k] >= t)) deleted[k] = t;
  const by = new Map();
  for (const d of [...(a.saves || []), ...(b.saves || [])]) { if (!d || !d.id) continue; const h = by.get(d.id); if (!h || (d.t || 0) > (h.t || 0)) by.set(d.id, d); }
  const saves = [...by.values()].filter(d => !(deleted[d.id] >= (d.t || 0))).sort((x, y) => (y.t || 0) - (x.t || 0));
  const bases = typeof mergeBases === 'function' ? mergeBases(a.bases, b.bases) : (a.bases || b.bases || null);
  return { saves, deleted, bases };
}
const stateKey = s => JSON.stringify([s.saves.map(d => [d.id, d.t || 0]), Object.keys(s.deleted || {}).sort(), s.bases ? s.bases.t || 0 : 0]);

/* ---- inside Claude: your own private documents in the page's database ---- */
async function claudeCloud() {
  if (!window.claude || typeof window.claude.use !== 'function') return null;
  const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
  if (!db || !user) return null;
  const uid = await user.id(); if (!uid) return null;
  const col = db.collection('data/users/' + uid);
  let seen = new Map();   // what the store holds: vehicle id -> time
  return {
    kind: 'claude',
    async pull() {
      const snap = await col.get(), saves = [], out = { saves, deleted: {}, bases: null };
      seen = new Map();
      for (const doc of snap.docs) {
        const v = doc.data(); if (!v) continue;
        if (doc.id === 'meta') { out.deleted = v.deleted || {}; continue; }
        if (doc.id === 'bases') { out.bases = v.bases || null; continue; }
        if (doc.id.startsWith('v_') && v.d) { const d = { ...v.d, id: doc.id.slice(2), t: v.t || 0 }; saves.push(d); seen.set(d.id, d.t); }
      }
      return out;
    },
    async push(st) {
      // one write at a time, and only what changed
      for (const d of st.saves) {
        if (seen.get(d.id) === (d.t || 0)) continue;
        const body = { ...d }; delete body.id; delete body.t;
        await col.doc('v_' + d.id).set({ t: d.t || 0, d: body }); seen.set(d.id, d.t || 0);
      }
      for (const id of [...seen.keys()]) if (st.deleted[id] && !st.saves.some(d => d.id === id)) { await col.doc('v_' + id).delete(); seen.delete(id); }
      await col.doc('meta').set({ deleted: st.deleted });
      if (st.bases) await col.doc('bases').set({ bases: st.bases });
    }
  };
}
/* ---- on the website: the site's server keeps it under a save code ---- */
function siteCloud(code) {
  const url = '/api/cloud';
  return {
    kind: 'code',
    async pull() {
      const r = await fetch(url + '?code=' + encodeURIComponent(code), { cache: 'no-store' });
      if (r.status === 404) return { saves: [], deleted: {}, bases: null };
      if (!r.ok) throw new Error('server ' + r.status);
      const j = await r.json(); return j.state || { saves: [], deleted: {}, bases: null };
    },
    async push(st) {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, state: st }) });
      if (!r.ok) { let m = ''; try { m = (await r.json()).error || ''; } catch (e) { } throw new Error(m || 'server ' + r.status); }
    }
  };
}
/* is the site's cloud there? (only on the website, never inside Claude) */
async function siteCloudReady() {
  if (CLOUD.siteReady !== null) return CLOUD.siteReady;
  if (inFrame() || !/^https?:$/.test(location.protocol)) return (CLOUD.siteReady = false);
  try { const r = await fetch('/api/cloud?ping=1', { cache: 'no-store' }); const j = r.ok ? await r.json() : null; CLOUD.siteReady = !!(j && j.ok); }
  catch (e) { CLOUD.siteReady = false; }
  return CLOUD.siteReady;
}
function newCloudCode() {
  const w = () => CLOUD_WORDS[Math.floor(Math.random() * CLOUD_WORDS.length)];
  return `${w()}-${w()}-${w()}-${Math.floor(Math.random() * 90 + 10)}`;
}
const cleanCode = c => String(c || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 60);

/* ---- syncing ---- */
async function cloudInit() {
  try {
    const cc = await claudeCloud();
    if (cc) { CLOUD.api = cc; CLOUD.kind = 'claude'; }
    else {
      const code = LS.get('scrapline.cloudCode', null), ready = await siteCloudReady();
      if (code && ready) { CLOUD.api = siteCloud(code); CLOUD.kind = 'code'; CLOUD.code = code; }
    }
  } catch (e) { CLOUD.api = null; }
  if (CLOUD.api) await cloudSync();
  else CLOUD.status = 'off';
  // back from another tab or device: catch up
  document.addEventListener('visibilitychange', () => { if (!document.hidden && CLOUD.api && Date.now() - CLOUD.last > 30000) cloudSync(); });
}
async function cloudSync() {
  if (!CLOUD.api) return false;
  if (CLOUD.busy) { CLOUD.again = true; return false; }
  CLOUD.busy = true; CLOUD.status = 'syncing'; cloudShow();
  try {
    const remote = await CLOUD.api.pull(), local = localState(), merged = mergeStates(local, remote);
    if (stateKey(merged) !== stateKey(local)) {
      LS.set('scrapline.saves', merged.saves); LS.set('scrapline.deleted', merged.deleted);
      if (merged.bases && typeof setBasesState === 'function') setBasesState(merged.bases);
    }
    if (stateKey(merged) !== stateKey(remote)) await CLOUD.api.push(merged);
    CLOUD.status = 'ok'; CLOUD.note = ''; CLOUD.last = Date.now();
  } catch (e) {
    CLOUD.status = 'error'; CLOUD.note = e && (e.code || e.message) ? String(e.code || e.message) : 'unreachable';
  }
  CLOUD.busy = false; cloudShow();
  if (CLOUD.again) { CLOUD.again = false; return cloudSync(); }
  return CLOUD.status === 'ok';
}
/* something changed here: send it up in a moment (a burst of changes goes as one) */
function cloudChanged() { if (!CLOUD.api) return; clearTimeout(CLOUD.timer); CLOUD.timer = setTimeout(cloudSync, 1500); }
/* the line about it in the vehicle library */
function cloudLine() {
  const t = CLOUD.last ? new Date(CLOUD.last).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  if (CLOUD.kind === 'claude') {
    const s = CLOUD.status === 'syncing' ? 'Syncing…' : CLOUD.status === 'error' ? `Can't reach your Claude account right now (${esc(CLOUD.note)}); saved on this device` : `Synced ${t}`;
    return `<div class="cloudrow"><span class="cloudic" aria-hidden="true">☁</span><div class="grow"><b>Saved to your Claude account</b><span class="meta">${s}. Open Scrapline signed in on any device and they are there.</span></div></div>`;
  }
  if (CLOUD.kind === 'code') {
    const s = CLOUD.status === 'syncing' ? 'Syncing…' : CLOUD.status === 'error' ? `Can't reach the server right now (${esc(CLOUD.note)}); saved on this device` : `Synced ${t}`;
    return `<div class="cloudrow"><span class="cloudic" aria-hidden="true">☁</span><div class="grow"><b>Cloud saves on · code <code>${esc(CLOUD.code)}</code></b><span class="meta">${s}. Type this code on another device to get your vehicles there.</span></div><button type="button" class="btn" data-cloud="copy">Copy code</button><button type="button" class="btn" data-cloud="off">Turn off</button></div>`;
  }
  if (CLOUD.siteReady) return `<div class="cloudrow"><span class="cloudic" aria-hidden="true">☁</span><div class="grow"><b>Cloud saves are off</b><span class="meta">Turn them on to get your vehicles on any device with a save code.</span></div><button type="button" class="btn primary" data-cloud="on">Turn on</button><button type="button" class="btn" data-cloud="enter">I have a code</button></div>`;
  return '';
}
function cloudShow() { const el = document.querySelector('#modal .cloudslot'); if (el) el.innerHTML = cloudLine(); }
/* the buttons on that line */
async function cloudAction(a) {
  if (a === 'copy' && CLOUD.code) { try { await navigator.clipboard.writeText(CLOUD.code); toast('Code copied'); } catch (e) { toast('Your code: ' + CLOUD.code, 5000); } return; }
  if (a === 'off') { LS.set('scrapline.cloudCode', null); CLOUD.api = null; CLOUD.kind = null; CLOUD.code = null; toast('Cloud saves off on this device. Your vehicles stay here, and on the server under the code'); cloudShow(); return; }
  if (a === 'enter') {
    openModal(`<h2>Use a save code</h2><p>Type the save code from your other device. Your vehicles from that code are added to the ones here, and from then on both stay in step.</p>
      <input type="text" id="ccode" maxlength="60" placeholder="river-comet-oak-42" aria-label="Save code" autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="mfoot"><button type="button" class="btn" data-back="1">Back</button><button type="button" class="btn primary" data-go="1">Link</button></div>`);
    const go = () => cloudLink(cleanCode($('ccode').value));
    $('modal').onclick = e => { const t = e.target.closest('button'); if (!t) return; if (t.dataset.back) openLibrary(false); if (t.dataset.go) go(); };
    $('ccode').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    return;
  }
  if (a === 'on') cloudLink(newCloudCode(), true);
}
async function cloudLink(code, fresh) {
  {
    if (!code) return;
    if (code.split('-').length < 3) { toast('That does not look like a save code'); return; }
    LS.set('scrapline.cloudCode', code); CLOUD.code = code; CLOUD.api = siteCloud(code); CLOUD.kind = 'code';
    const ok = await cloudSync();
    if (ok) toast(fresh ? `Cloud saves on. Your code is ${code}: write it down` : 'Linked: your vehicles from that code are here', 5200);
    else toast("Couldn't reach the server: try again in a moment", 3000);
    if (typeof openLibrary === 'function') openLibrary(false);
  }
}

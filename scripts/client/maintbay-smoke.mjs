// MAINTENANCE BAY SMOKE: the bay controller (client/game/js/panels/maintenance-bay.js) with a fake
// seat, and the marina's bay on a mounted boat seat walked job by job.
//
// WHY THIS EXISTS. The four service bays share one controller for the open job, the camera, the
// seat's view, the preview and the keyboard (docs/proposals/maintenance-bay.md §7). A mistake there
// breaks every depot at once and no other gate opens a bay: the seat smokes mount seats, and
// boatseat-smoke opens the marina's counter, never its bay. So this checks the controller's rules
// directly, then opens a real bay through a real seat and clicks through it.
//
// ⚠ THE DOM IS THE SHARED STUB (seat-harness.mjs). It has no parser, so a page is checked by its
// markup string, and a click is a hand-built target whose `closest` answers the attribute
// selectors the depot asks for.

import { registerHooks } from 'node:module';
import { installSeatDom, fakeEl, checker } from './seat-harness.mjs';

// The client imports '/shared/…' by its web path (the server serves client/shared there). The cab
// and the truck depot reach it through net.js, so it is mapped back onto the tree here.
const SHARED = new URL('../../client/shared/', import.meta.url).href;
// ⚠ AND THE COCKPIT IS A STAND-IN. The hangar asks for cockpit.js only once a seat is open, and
// mounting the flight sim headless is a gate of its own; the hangar's bench needs only its hooks,
// so the hangar section gets a cockpit that answers them and records what it was asked.
const COCKPIT = new URL('../../client/game/js/panels/cockpit.js', import.meta.url).href;
const STUB_COCKPIT = 'data:text/javascript,' + encodeURIComponent(`
  const S = globalThis.__mbCockpit;
  export const cockpitServiceHost = () => S.host;
  export const cockpitRolling = () => false;
  export const cockpitPreview = (o) => S.log.push(['preview', o]);
  export const cockpitView = (m) => { if (m) S.view = m; return S.view; };
  export const cockpitFrame = (s) => S.log.push(['frame', s]);
  export const cockpitBaySeat = { host: () => S.host, frame: (s, ms) => S.log.push(['frame', s, ms]),
    preview: (l) => S.log.push(['preview', l]), view: (m) => { if (m) S.view = m; return S.view; } };`);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('/shared/')) return next(SHARED + specifier.slice('/shared/'.length), context);
    const r = next(specifier, context);
    if (r.url === COCKPIT) return { url: STUB_COCKPIT, shortCircuit: true };
    return r;
  },
});

await installSeatDom(['boat-']);
const ws = await import('../../client/game/js/panels/windshield.js');
ws.RENDER_TUNE.gl = 0;
ws.RENDER_TUNE.glFloor = 0;
const mb = await import('../../client/game/js/panels/maintenance-bay.js');
const { SHOTS } = await import('../../client/game/js/panels/camera-tween.js');
const sk = await import('../../client/game/js/panels/seat-keys.js');
const ck = checker();

// ── 1. THE EIGHT JOBS ───────────────────────────────────────────────────────
console.log('— the jobs —');
const log = [];
const seat = {
  v: 'cab',
  view(m, o) { if (m) { log.push(['view', m, !!o?.enter]); this.v = m; } return this.v; },
  frame(s, ms) { log.push(['frame', s, ms]); },
  preview(l) { log.push(['preview', l]); },
  rev(a) { log.push(['rev', a]); return true; },
};
const bay = mb.openBay({ seat, job: 'paint' });
bay.canon({ load: true, paint: { sub: 'unsaved', tone: 'hot' }, repair: true, perf: { rev: 0.4 }, inside: true });
ck('the jobs come in the canonical order whatever order they are given', bay.list.map((j) => j.id).join() === 'repair,perf,paint,inside,load');
ck('…each keeps its canonical number', bay.list.map((j) => j.key).join() === '1,3,5,6,7');
ck('…and its canonical name and icon', bay.list.find((j) => j.id === 'perf')?.label === 'Performance');
ck('the job the depot asked for is open', bay.job === 'paint');
ck('the tiles carry the key that picks them', /aria-keyshortcuts="5"/.test(bay.railHtml()) && /ds-job-key/.test(bay.railHtml()));
ck('a job the vehicle has not got is not drawn', !/data-ds-job="business"/.test(bay.railHtml()));

// ── 2. THE CAMERA ───────────────────────────────────────────────────────────
console.log('\n— the camera —');
log.length = 0;
bay.sync({ look: { a: 1 } });
ck('the first take sets the outside view, as an entry', log.some((e) => e[0] === 'view' && e[1] === 'ext' && e[2] === true));
const first = log.find((e) => e[0] === 'frame');
ck('…frames the job\'s area over 900 ms', first && first[1] === SHOTS.side && first[2] === 900, JSON.stringify(first));
ck('…and puts the look on the vehicle', log.some((e) => e[0] === 'preview' && e[1]?.a === 1));
log.length = 0;
bay.sync({ look: null });
ck('a redraw on the same job leaves the camera alone', !log.some((e) => e[0] === 'frame'));
bay.job = 'perf';
log.length = 0;
bay.sync({});
ck('a new job moves the camera over 700 ms', log.find((e) => e[0] === 'frame')?.[2] === 700);
ck('…and a job that revs the engine revs it', log.some((e) => e[0] === 'rev' && e[1] === 0.4));
bay.job = 'paint';
bay.groups([{ id: 'colour', label: 'Colours' }, { id: 'name', label: 'Name', area: 'rear' }]);
bay.subs.paint = 'name';
log.length = 0;
bay.sync({});
ck('a group with an area of its own takes that shot', log.find((e) => e[0] === 'frame')?.[1] === SHOTS.rear);
ck('the group strip is drawn with its click hook', /data-ds-sub="name"/.test(bay.groupsHtml()));
bay.job = 'inside';
log.length = 0;
bay.sync({});
ck('Inside sits you in the seat and frames nothing', log.some((e) => e[0] === 'view' && e[1] === 'cab') && !log.some((e) => e[0] === 'frame'));
bay.open = false;
log.length = 0;
bay.sync({ look: 'rest' });
ck('folding hands the camera back and restores the view the seat had',
  log.some((e) => e[0] === 'frame' && e[1] === null) && log.some((e) => e[0] === 'view' && e[1] === 'cab'));
bay.open = true;
log.length = 0;
bay.sync({});
ck('opening again takes the camera again, as an entry', log.some((e) => e[0] === 'view' && e[2] === true));
log.length = 0;
bay.close('own');
ck('closing restores the view and puts the vehicle\'s own look back', log.some((e) => e[0] === 'view') && log.some((e) => e[0] === 'preview' && e[1] === 'own'));
{
  const area = mb.openBay({ seat: { frame: () => log.push(['f']), preview() {} } });
  area.canon({ repair: true });
  log.length = 0;
  area.sync({ area: null });
  ck('a bay with no camera (the fuel float) frames nothing', !log.length);
}

// ── 3. THE KEYBOARD ─────────────────────────────────────────────────────────
console.log('\n— the keyboard —');
const btn = { tagName: 'BUTTON', classList: { contains: () => false } };
const field = { tagName: 'INPUT', type: 'text', classList: { contains: () => false } };
const outside = { tagName: 'CANVAS', classList: { contains: () => false } };
const kbay = mb.openBay({ seat: {} });
const el = { ...fakeEl(), isConnected: true, contains: (n) => n === btn || n === field };
kbay.attach(el);
ck('the bay takes its keys while focus is in it', ['1', '8', 'ArrowDown', 'Enter', ' ', 'Escape'].every((key) => kbay.takesKey({ key, target: btn }, el)));
ck('…but never a letter: W still drives off', !kbay.takesKey({ key: 'w', target: btn }, el));
ck('…nor a key typed into a field on the page', !kbay.takesKey({ key: ' ', target: field }, el));
ck('…nor anything with focus outside it', !kbay.takesKey({ key: 'ArrowUp', target: outside }, el));
ck('…nor a key with a modifier', !kbay.takesKey({ key: '1', ctrlKey: true, target: btn }, el));
ck('the seats are told to stand aside for it (panelTakesKey)', sk.panelTakesKey({ key: 'ArrowUp', target: btn }) === true
  && sk.panelTakesKey({ key: 'w', target: btn }) === false && sk.panelTakesKey({ key: 'ArrowUp', target: outside }) === false);
kbay.open = false;
ck('a folded bay takes no keys', !kbay.takesKey({ key: 'ArrowUp', target: btn }, el) && sk.panelTakesKey({ key: 'ArrowUp', target: btn }) === false);

// ── 4. THE MARINA'S BAY, ON A REAL SEAT ─────────────────────────────────────
console.log('\n— the marina bay —');
const R = 8, map = [];
for (let y = -R; y <= R; y++) { const row = []; for (let x = -R; x <= R; x++) row.push({ kind: 'land', biome: 'water', road: 0 }); map.push(row); }
const bv = await import('../../client/game/js/panels/boat-view.js');
bv.openBoat({ mount: fakeEl(), name: 'Rooster', gx: 894, gy: 902, heading: 90, map, hull: 0.8, fuel: 0.6, nitro: 0.5, hour: 13, weather: 'clear', onSend() {}, onExit() {} });
ck('the boat seat is up', bv.isBoatActive() === true);

// Elements made from here on record their listeners, so the bay's click handler can be fired.
const made = [];
const mk = document.createElement;
document.createElement = (t) => {
  const e = mk(t);
  e._on = {};
  e.addEventListener = (ev, fn) => { (e._on[ev] ||= []).push(fn); };
  e.contains = () => true;
  e.isConnected = true;
  made.push(e);
  return e;
};
const target = (attrs) => {
  const dataset = {};
  for (const [k, v] of Object.entries(attrs)) dataset[k.replace(/^data-/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
  const t = {
    dataset, disabled: false, textContent: '', classList: { contains: () => false },
    hasAttribute: (n) => n in attrs, getAttribute: (n) => attrs[n] ?? null,
    closest: (sel) => (String(sel).split(',').some((p) => {
      const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(p.trim());
      return m && m[1] in attrs && (m[2] === undefined || attrs[m[1]] === m[2]);
    }) ? t : null),
  };
  return t;
};
const bayEl = () => made.filter((e) => e.id === 'mar-svc').at(-1);
const html = () => String(bayEl()?.innerHTML || '');
const click = (attrs) => { for (const fn of bayEl()?._on.click || []) fn({ target: target(attrs), preventDefault() {}, stopPropagation() {} }); };

const mp = await import('../../client/game/js/panels/marina-panel.js');
const sent = [];
const boat = {
  id: 'boat_1', typeId: 'hydro', name: 'Rooster', typeName: 'Vaskin Rooster', hull: 0.7, band: 'marked', fuel: 0.6,
  svc: { items: [{ id: 'oil', label: 'Engine oil', desc: 'x', life: 0.4, band: 'due', bandLabel: 'Getting dark', price: 265 }], full: 900, anyDue: true },
  scheme: 'factory', decal: 'none', rental: null, fillPrice: 120,
};
const svcData = (over = {}) => ({
  service: 'dock', serviceId: 'boat_1', credits: 20000, onSend: (c) => sent.push(c), fleet: [boat],
  schemes: [{ id: 'factory', label: 'As she came', livery: null }, { id: 'redline', label: 'Red line', livery: { base: '#b3261e', trim: '#f1ede4' } }],
  decals: [{ id: 'none', label: 'Bare' }, { id: 'flames', label: 'Flames' }], paintPrice: 1800, decalPrice: 650, ...over,
});
let threw = null;
try { mp.openMarinaService(svcData()); } catch (e) { threw = e.stack || e.message; }
ck('the bay opens on the boat seat', !threw && !!bayEl(), threw);
const order = [...html().matchAll(/data-ds-job="(\w+)"/g)].map((m) => m[1]).join();
ck('…with a boat\'s jobs in the canonical order', order === 'repair,service,parts,paint', order);
ck('…on Repair, with the hull\'s key in the till', /ds-gx-till/.test(html()) && /data-cmd="refit boat_1"/.test(html()));
const PROOF = { service: 'refit service boat_1 all', parts: 'data-decal="flames"', paint: 'data-scheme="redline"' };
for (const [job, proof] of Object.entries(PROOF)) {
  let t2 = null;
  try { click({ 'data-ds-job': job }); } catch (e) { t2 = e.stack || e.message; }
  ck(`the ${job} job draws`, !t2 && html().includes(proof), t2 || 'expected ' + JSON.stringify(proof));
  ck('…and its tile is lit', new RegExp(`class="ds-job on"[^>]*data-ds-job="${job}"`).test(html()));
}
click({ 'data-ds-job': 'parts' });
click({ 'data-decal': 'flames' });
ck('picking a decal puts its verb in the till', /data-cmd="refit decal boat_1 flames"/.test(html()));
click({ 'data-ds-job': 'paint' });
click({ 'data-ds-sub': 'name' });
ck('Paint\'s Name group draws the name box and its key', /mar-namein/.test(html()) && /data-name="boat_1"/.test(html()));
click({ 'data-ds': 'bay-fold' });
ck('folding leaves the chip', /data-ds="bay-open"/.test(html()));
click({ 'data-ds': 'bay-open' });
ck('…and the chip opens it on the same job', /class="ds-job on"[^>]*data-ds-job="paint"/.test(html()));
mp.openMarinaService(svcData({ fleet: [{ ...boat, rental: { left: 1, leftText: '1h left' } }] }));
const hire = [...html().matchAll(/data-ds-job="(\w+)"/g)].map((m) => m[1]).join();
ck('a hire boat has Repair and Service only', hire === 'repair,service', hire);
mp.openMarinaService(svcData({ service: 'fuel' }));
ck('the fuel float has no jobs and the pump in the till', !/data-ds-job/.test(html()) && /data-cmd="fuel"/.test(html()));
ck('closing the bay does not throw', (() => { try { mp.closeMarinaService(); return true; } catch { return false; } })());
bv.closeBoat();

// ── 5. THE RACER'S BAY, ON A REAL SEAT ──────────────────────────────────────
// The racer has the one service verb, so Repair and Service pay the same bill; its fitting shop
// splits into Performance (the engine rows) and Parts (the rest).
console.log('\n— the racer bay —');
const pv = await import('../../client/game/js/panels/podracer-view.js');
pv.openPodracer({ mount: fakeEl(), name: 'Redline', typeId: 'podracer', gx: 900, gy: 900, map, hull: 1, fuel: 1, hour: 13, weather: 'clear', onSend() {}, onExit() {} });
const pd = await import('../../client/game/js/panels/podracer-depot.js');
const racer = { id: 'pr_1', name: 'Redline', typeId: 'podracer', typeName: 'Racer', hull: 0.6, eng: [0.9, 0.5], fuel: 0.4, cables: [true, false], binder: true,
  quote: { total: 1200, parts: 1000, fuel: 200 }, kit: {}, livery: null, scheme: 'factory', rental: null, paintPrice: 900, insidePrice: 300 };
const prEl = () => made.filter((e) => e.id === 'pdd-bay').at(-1);
const prHtml = () => String(prEl()?.innerHTML || '');
const prClick = (attrs) => { for (const fn of prEl()?._on.click || []) fn({ target: target(attrs), preventDefault() {}, stopPropagation() {} }); };
let prThrew = null;
try {
  pd.openPodracerDepot({ service: true, serviceId: 'pr_1', credits: 50000, fleet: [racer], onSend() {},
    schemes: [{ id: 'factory', label: 'Factory', livery: null }], finishes: ['gloss', 'candy'] });
} catch (e) { prThrew = e.stack || e.message; }
ck('the racer bay opens on the racer seat', !prThrew && !!prEl(), prThrew);
const prOrder = [...prHtml().matchAll(/data-ds-job="(\w+)"/g)].map((m) => m[1]).join();
ck('…with a racer\'s jobs in the canonical order', prOrder === 'repair,service,perf,parts,paint', prOrder);
ck('…Repair pays the yard\'s one bill', /data-cmd="podracer service"/.test(prHtml()) && /cut/.test(prHtml()));
const PR = { service: 'right turbine', perf: 'data-kit=', parts: 'data-kit=', paint: 'data-sch="factory"' };
for (const [job, proof] of Object.entries(PR)) {
  let t2 = null;
  try { prClick({ 'data-ds-job': job }); } catch (e) { t2 = e.stack || e.message; }
  ck(`the racer's ${job} job draws`, !t2 && prHtml().includes(proof), t2 || 'expected ' + JSON.stringify(proof));
}
ck('Performance and Parts split the fitting shop', (() => {
  prClick({ 'data-ds-job': 'perf' });
  const perf = prHtml();
  prClick({ 'data-ds-job': 'parts' });
  return perf !== prHtml();
})());
ck('closing the racer bay does not throw', (() => { try { pd.closePodracerBay(); return true; } catch { return false; } })());
pv.closePodracer?.();

// ── 6. THE TRUCK'S BAY, ON A REAL CAB ───────────────────────────────────────
// The biggest of the four: every job, and every old tab as a group inside one.
console.log('\n— the truck bay —');
// net.js reads the page's address and storage as it loads; nothing here connects.
globalThis.location ??= { protocol: 'http:', host: 'localhost', hostname: 'localhost', port: '', pathname: '/', search: '', hash: '', href: 'http://localhost/', origin: 'http://localhost' };
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
globalThis.localStorage ??= mem();
globalThis.sessionStorage ??= mem();
const cv = await import('../../client/game/js/panels/cab-view.js');
const cabWrap = fakeEl();
const realQS = document.querySelector;
document.querySelector = (s) => (s === '.cab-wrap' ? cabWrap : realQS(s));
let cabThrew = null;
// The cab sets custom properties on its wrapper, so the stub's elements get a style that takes them.
const richEl = () => ({ ...fakeEl(), style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }, querySelector: () => richEl(), closest: () => richEl() });
try { cv.openCab({ mount: richEl(), typeId: 'hauler', heading: 90, map, hour: 13, fuel: 0.6, condition: 0.7, onSend() {}, onExit() {} }); } catch (e) { cabThrew = e.stack || e.message; }
ck('the cab is up', !cabThrew && !!cv.cabServiceHost(), cabThrew);
const td = await import('../../client/game/js/panels/truck-depot.js');
const stats = { pull: 0.5, speed: 0.5, stop: 0.5, turn: 0.5, range: 0.5 };
const truck = {
  id: 'truck_1', name: 'Big Lad', typeId: 'hauler', condition: 0.7, band: 'worn', bandText: 'Tired.', stats, fuel: 0.6,
  svc: { items: [{ id: 'oil', label: 'Oil', desc: 'x', life: 0.4, band: 'due', bandLabel: 'Due', price: 200, left: 30 }], full: 800, anyDue: true },
  tune: { gear: 0 }, tuneEnds: null, kits: ['k1'], kitStats: { k2: { ...stats, pull: 0.7 } }, fits: [], fitPrices: { f1: 400 }, cab: [], cabPrices: { c1: 50 },
  horn: 'stock', hornPrices: { stock: 0, chime: 300 }, trim: { mat: 'plastic', col: 'stock' }, paint: {}, odometer: 1200, resale: 9000,
  repairShop: 900, repairField: 300, canField: true, washPrice: 40, refuel: 120, rental: null, paintPrice: 600, paintBase: 600, trimPrice: 250,
};
const truckData = (over = {}) => ({
  service: true, serviceId: 'truck_1', depot: 'Coldwater Haulage', credits: 40000, fuel: 0.6, fuelHere: true, fleet: [truck],
  kitCatalog: [{ id: 'k1', name: 'Turbo', desc: 'x', price: 2000, afford: true }, { id: 'k2', name: 'Big brakes', desc: 'y', price: 1500, afford: true }],
  fitCat: { slots: [{ id: 'roof', label: 'Roof', note: 'up top' }], items: [{ id: 'f1', slot: 'roof', name: 'Light bar', desc: 'z' }] },
  cabCat: { slots: [{ id: 'dash', label: 'Dash', note: 'in front' }], items: [{ id: 'c1', slot: 'dash', name: 'Nodding dog', desc: 'w' }] },
  hornCat: [{ id: 'stock', name: 'Stock', desc: 'a', price: 0 }, { id: 'chime', name: 'Chime', desc: 'b', price: 300 }],
  tuneParams: [{ id: 'gear', label: 'Gearing', lo: 'pull', hi: 'speed', desc: 'x' }], tuneRange: 1,
  paintPresets: [], flashes: [], finishes: [], arts: [], dashColourways: [], dashMaterials: [], paintDefault: { base: '#888888' },
  board: [], quotes: [], ...over,
});
const tdEl = () => made.filter((e) => e.id === 'td-svc').at(-1);
const tdHtml = () => String(tdEl()?.innerHTML || '');
const tdClick = (attrs) => { for (const fn of tdEl()?._on.click || []) fn({ target: target(attrs), preventDefault() {}, stopPropagation() {} }); };
let tdThrew = null;
try { td.openTruckDepot(truckData()); } catch (e) { tdThrew = e.stack || e.message; }
ck('the truck bay opens on the cab', !tdThrew && !!tdEl(), tdThrew);
const tdOrder = [...tdHtml().matchAll(/data-ds-job="(\w+)"/g)].map((m) => m[1]).join();
ck('…with all eight jobs in the canonical order', tdOrder === 'repair,service,perf,parts,paint,inside,load,business', tdOrder);
ck('…Repair puts the shop in the till', /data-cmd="rig repair truck_1 shop"/.test(tdHtml()));
const TD = [
  [{ 'data-ds-job': 'service' }, 'rig service truck_1 all'],
  [{ 'data-ds-job': 'perf' }, 'data-tune="gear"'],
  [{ 'data-ds-sub': 'kits' }, 'data-kpick="k2"'],
  [{ 'data-kpick': 'k2' }, 'rig kit truck_1 k2'],
  [{ 'data-ds-job': 'parts' }, 'data-fpick="f1"'],
  [{ 'data-fpick': 'f1' }, 'rig fit truck_1 f1'],
  [{ 'data-ds-sub': 'badge' }, 'data-hpick="chime"'],
  [{ 'data-ds-job': 'paint' }, 'data-commit="paint"'],
  [{ 'data-ds-job': 'inside' }, 'data-cpick="c1"'],
  [{ 'data-cpick': 'c1' }, 'rig cab truck_1 c1'],
  [{ 'data-ds-sub': 'trim' }, 'data-commit="trim"'],
  [{ 'data-ds-job': 'load' }, 'Nothing on the board'],
  [{ 'data-ds-job': 'business' }, 'td-rows'],
];
for (const [attrs, proof] of TD) {
  let t2 = null;
  try { tdClick(attrs); } catch (e) { t2 = e.stack || e.message; }
  ck(`the truck's ${JSON.stringify(attrs)} draws`, !t2 && tdHtml().includes(proof), t2 || 'expected ' + JSON.stringify(proof));
}
td.openTruckDepot(truckData({ fleet: [{ ...truck, rental: { leftText: '2h left' } }] }));
const tdHire = [...tdHtml().matchAll(/data-ds-job="(\w+)"/g)].map((m) => m[1]).join();
ck('a hire truck has Repair, Service, Load and Business only', tdHire === 'repair,service,load,business', tdHire);
ck('closing the truck bay does not throw', (() => { try { td.closeBayService(); return true; } catch { return false; } })());
try { cv.closeCab?.(); } catch { /* the stub cab can fail to come down cleanly; not this gate's business */ }
document.querySelector = realQS;

// ── 7. THE HANGAR'S BENCH, ON A STAND-IN COCKPIT ────────────────────────────
console.log('\n— the hangar bench —');
globalThis.__mbCockpit = { host: fakeEl(), log: [], view: 'cab' };
const hb = await import('../../client/game/js/panels/hangar-bay.js');
const craft = {
  id: 'ac_1', tail: 'N-ABC', typeName: 'Twin Otter', class: 'prop', hullPct: 70, fuelPct: 40, livery: { base: '#ffffff', trim: '#cc0000' },
  paintable: true, wreck: false, rental: false, kitCatalog: [{ id: 'kit_intercooler', name: 'Intercooler', blurb: 'Cooler.', price: 900, owned: false }],
  tune: {}, tuneRange: 1, perfBase: { cruise: 1, burn: 1, maxTOW: 300, pace: 1 }, hopperCap: 0, configurable: true, seats: 6, maxSeats: 9, seatsNow: 6,
  loadoutBudget: 400, cargoCapNow: 200, cargoLoaded: 0, shopCost: 1200, diyCost: 300, fillCost: 200, fuelType: 'avgas', fuelNow: 40, fuelCap: 100, paintCost: 700, sets: [], schemes: [],
};
const hangarData = (over = {}) => ({ service: true, serviceId: 'ac_1', field: 'Coldwater Field', hangar: true, credits: 30000, craft: [craft],
  catalog: { patterns: [], finishes: [], uphol: [], decals: [], trims: {}, cabinTrims: {} }, tuneParams: [{ id: 'mixture', label: 'Mixture' }], fuelStocks: ['avgas'], ...over });
const hbEl = () => made.filter((e) => e.id === 'hb-svc').at(-1);
const hbHtml = () => String(hbEl()?.innerHTML || '');
const hbClick = (attrs) => { for (const fn of hbEl()?._on.click || []) fn({ target: target(attrs), preventDefault() {}, stopPropagation() {} }); };
let hbThrew = null;
try { hb.openHangarBay(hangarData()); await new Promise((r) => setTimeout(r, 20)); } catch (e) { hbThrew = e.stack || e.message; }
ck('the bench docks on the cockpit', !hbThrew && !!hbEl(), hbThrew);
const hbOrder = [...hbHtml().matchAll(/data-ds-job="(\w+)"/g)].map((m) => m[1]).join();
ck('…with an aircraft\'s jobs in the canonical order', hbOrder === 'repair,service,perf,paint,inside,load', hbOrder);
ck('…Repair puts the shop in the till', /ds-gx-till[\s\S]*data-act="repair-pro"/.test(hbHtml()));
const HB = [
  [{ 'data-ds-job': 'service' }, 'data-act="refuel"'],
  [{ 'data-ds-job': 'perf' }, 'data-act="tune-apply"'],
  [{ 'data-ds-sub': 'kits' }, 'data-kit="kit_intercooler"'],
  [{ 'data-ds-job': 'paint' }, 'data-act="paint-apply"'],
  [{ 'data-ds-job': 'inside' }, 'data-act="paint-apply"'],
  [{ 'data-ds-job': 'load' }, 'data-loadout="passenger"'],
];
for (const [attrs, proof] of HB) {
  let t2 = null;
  try { hbClick(attrs); } catch (e) { t2 = e.stack || e.message; }
  ck(`the bench's ${JSON.stringify(attrs)} draws`, !t2 && hbHtml().includes(proof), t2 || 'expected ' + JSON.stringify(proof));
}
globalThis.__mbCockpit.view = 'ext';
hbClick({ 'data-ds-job': 'paint' });
hbClick({ 'data-ds-job': 'inside' });
ck('Inside sits you in the cabin', globalThis.__mbCockpit.view === 'cab');
ck('closing the bench does not throw', (() => { try { hb.closeHangarBay(); return true; } catch { return false; } })());
document.createElement = mk;

const fails = ck.fails();
console.log(fails ? `\n✗ maintbay:smoke — ${fails} failed` : '\n✓ maintbay:smoke — the controller keeps its rules, and all four bays walk every job.');
process.exit(fails ? 1 : 0);

// THE GATE FOR THE WATER SEAT.
//
//   node scripts/client/boatseat-smoke.mjs
//
// `boat-view.js` is a panel: it mounts, integrates a hull at the frame rate, paints, reports back
// and comes down. Every one of those can fail silently. A throw inside the frame body is CAUGHT and
// logged once (helm-view's rule — a loop that reschedules at the END freezes for good if one frame
// escapes), so "it did not throw" proves nothing at all; a sync packet with the wrong arity is
// dropped by the server without a word; and a seat that never claims the keyboard looks exactly
// like a seat whose keys are broken.
//
// ⚠ AND THE ONE THAT MATTERS MOST IS THE PACKET. The client packs thirteen numbers and the server
// unpacks thirteen numbers, in two files that share no code. Get that wrong and the boat drives
// perfectly for the person in it and does not exist for anybody else — `cmdBoatSync` returns on the
// arity check, `rigs` stays empty, and `vehicle.contacts` publishes nothing. There is no error
// anywhere in that, which is why it is asserted here against the SERVER'S OWN unpack rather than
// against a number written down twice.

import { readFileSync } from 'node:fs';
import { installSeatDom, fakeEl, TALLY, step as frameStep, pending } from './seat-harness.mjs';
import { blank } from '../lib/blank-scanner.mjs';

const { canvases } = await installSeatDom(['boat-']);

const ws = await import('../../client/game/js/panels/windshield.js');
const bv = await import('../../client/game/js/panels/boat-view.js');

// No GL hook here, so the pass would fail safe to 0 anyway; pinning keeps the run on one path.
ws.RENDER_TUNE.gl = 0;
ws.RENDER_TUNE.glFloor = 0;

let fails = 0;
const ck = (name, ok, note) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || note === undefined ? '' : ' — ' + note));
  if (!ok) fails++;
};

// A patch of basin with a quay along its north edge, so both branches of `surfaceUnder` are real.
const R = 16;
const map = [];
for (let y = -R; y <= R; y++) {
  const row = [];
  for (let x = -R; x <= R; x++) row.push(y < -8 ? { kind: 'land', biome: 'urban', road: 0 } : { kind: 'land', biome: 'water', road: 0 });
  map.push(row);
}

// ── 1. IT MOUNTS, PAINTS AND COMES DOWN ─────────────────────────────────────
console.log('— the seat —');
ck('starts inactive', bv.isBoatActive() === false);

const sent = [];
const sentCmds = [];
const mount = fakeEl();
bv.openBoat({
  mount,
  name: 'Rooster', gx: 894, gy: 902, heading: 90, map,
  hull: 0.8, fuel: 0.6, nitro: 0.5, hour: 13, weather: 'clear',
  onSend: (c) => sentCmds.push(c),
  onExit: () => { sent.push('exit'); },
});
ck('openBoat reports the seat active', bv.isBoatActive() === true);
ck('…and it armed a frame', typeof pending() === 'function');

const before = Object.keys(TALLY.ops).length;
frameStep(16);
frameStep(32);
ck('two frames paint something', Object.keys(TALLY.ops).length > before,
   'the canvas saw no operations at all');

// ⚠ THE FRAME BODY SWALLOWS ITS OWN THROWS, so the evidence that it RAN is the canvas, and the
// evidence that it ran CLEANLY is that nothing was logged once into the error channel.
ck('no frame threw', !TALLY.text.some((t) => String(t).includes('[boat] frame error')),
   TALLY.text.find((t) => String(t).includes('[boat] frame error')));

// ── 2. THE PACKET THE SERVER ACTUALLY UNPACKS ───────────────────────────────
//
// ⚠ READ OFF BOTH FILES RATHER THAN WRITTEN DOWN HERE. A constant in this gate is a third copy of
// the arity, and a third copy agrees with whichever of the other two was edited last.
console.log('\n— the telemetry packet —');
const srv = blank(readFileSync('plugins/powerboat/helm.js', 'utf8'));
const unpack = srv.match(/const \[([^\]]+)\] = n;/);
const arity = srv.match(/n\.length < (\d+)/);
ck('the server states an arity', !!arity, 'no `n.length < N` guard found in cmdBoatSync');
ck('…and destructures exactly that many', !!unpack && unpack[1].split(',').length === Number(arity?.[1]),
   unpack ? `${unpack[1].split(',').length} names against ${arity?.[1]}` : 'no destructure found');

const cli = blank(readFileSync('client/game/js/panels/boat-view.js', 'utf8'));
const packed = cli.match(/send\('boatsync '([\s\S]*?)\);/);
ck('the client packs a boatsync', !!packed);
// One space-joined literal per field, so counting the ' ' separators counts the fields.
const fields = packed ? packed[1].split('+').filter((s) => /toFixed|Math\.round|\?/.test(s)).length : 0;
ck(`the client sends ${arity?.[1]} fields`, fields === Number(arity?.[1]),
   `packed ${fields}, server unpacks ${arity?.[1]}`);

// ── 3. THE THINGS ONLY THE OTHER BOATS CARE ABOUT ───────────────────────────
//
// ⚠ THE FLAME IS THE CASE THIS EXISTS FOR. `pedal`, `rich` and `bang` are in the packet purely so
// `boatContactsNear` can publish them and somebody else's windscreen can draw the flame off the
// gap between lever and blower. They are invisible to the person driving, so dropping one is a
// change nobody in the seat could ever notice.
console.log('\n— what other people see —');
const idx = unpack ? unpack[1].split(',').map((s) => s.trim()) : [];
for (const f of ['pedal', 'rich', 'bang', 'roll', 'pitch']) {
  ck(`the packet carries \`${f}\``, idx.includes(f));
}
const boatIdx = blank(readFileSync('plugins/powerboat/index.js', 'utf8'));
for (const f of ['rig.pedal', 'rig.rich', 'rig.bang']) {
  ck(`boatContactsNear still publishes \`${f}\``, boatIdx.includes(f));
}
ck('the sync fills the RAM registry rather than the row',
   /rigs\.set\(/.test(srv) && !/UPDATE boats SET x/.test(srv),
   'a position on the water is per-tick state — see the persistence tiers');

// ── 4. THE IGNITION ─────────────────────────────────────────────────────────
//
// ⚠ ASSERTED AGAINST THE MODEL RATHER THAN AGAINST THE SEAT, because the model is the half that is
// silent when it is wrong. A key that does nothing is a thing you notice in half a second; a
// `running` flag read the wrong way round makes every hull in the game that has never heard of a
// key sit dead in the water, and the boat in front of you looks exactly the same either way.
console.log('\n— the key —');
const fm = await import('../../client/game/js/panels/flight-model.js');
const P = fm.TYPES.hydro;
const run = (s, over = {}, secs = 1, dt = 1 / 30) => {
  const evs = [];
  for (let i = 0; i < Math.round(secs / dt); i++) {
    fm.stepBoat(s, { throttle: 1, steer: 0, trim: 0, surface: 'open', ...over }, P, dt);
    for (const e of s.events || []) evs.push(e);
  }
  return evs;
};

// ⚠ THE MIGRATION INVARIANT, AND IT IS THE ONE CLAIM THAT PROTECTS EVERYTHING ELSE IN THE GAME.
// Every existing caller — the text rung before this change, every regress case, every harness —
// hands `stepBoat` a state with no `running` on it.
const legacy = fm.createBoatState(P);
run(legacy, {}, 1.5);
ck('a state that has never heard of the key still drives', legacy.speed > 1,
   `absent \`running\` must mean running — she made ${legacy.speed.toFixed(2)} mph`);

const dead = fm.createBoatState(P);
dead.running = false;
run(dead, {}, 1.5);
ck('a dead motor makes no way at all', dead.speed === 0, `she made ${dead.speed.toFixed(2)} mph`);
ck('…and the tacho is on the peg', dead.rpm === 0, String(dead.rpm));

// ⚠ AND SHE IS NOT STOPPED, WHICH IS THE HALF THE OBVIOUS IMPLEMENTATION GETS WRONG. An early
// return on a dead engine is a boat that comes to a dead halt when you turn the key off — a worse
// lie than not having a key, because a boat has no brakes.
const coast = fm.createBoatState(P);
run(coast, {}, 3);
const wasDoing = coast.speed;
coast.running = false;
run(coast, { throttle: 0 }, 0.5);
ck('killing her at speed leaves the way on', coast.speed > wasDoing * 0.5 && coast.speed > 1,
   `${wasDoing.toFixed(1)} mph became ${coast.speed.toFixed(1)}`);

const cold = fm.createBoatState(P);
cold.running = false;
const caught = run(cold, { throttle: 0, starter: true, fuel: 1 }, fm.CRANK_S + 0.3);
ck('holding the starter fires her', cold.running === true && caught.includes('started'));

// ⚠ RELEASING MID-CRANK IS A START THAT DID NOT TAKE, which is what makes it a key rather than a
// button — and the crank has to RESET, or a player tapping it repeatedly accumulates a start.
const tapped = fm.createBoatState(P);
tapped.running = false;
for (let i = 0; i < 6; i++) {
  run(tapped, { throttle: 0, starter: true, fuel: 1 }, fm.CRANK_S * 0.4);
  run(tapped, { throttle: 0, starter: false, fuel: 1 }, 0.1);
}
ck('six taps do not add up to a start', tapped.running === false);

const empty = fm.createBoatState(P);
empty.running = false;
const dryEvs = run(empty, { throttle: 0, starter: true, fuel: 0 }, fm.CRANK_S * 3);
ck('a dry tank turns over and never catches', empty.running === false && dryEvs.includes('dry'));

// The bottle is engine power, so it may not be reachable with the engine off.
const bottled = fm.createBoatState(P);
bottled.running = false;
const nitroBefore = bottled.nitro;
run(bottled, { throttle: 1, nitro: true }, 1.5);
ck('the bottle is dead with the motor', bottled.nitroOn === false && bottled.nitro === nitroBefore);

// ── AND BOTH SEATS COME UP COLD ─────────────────────────────────────────────
//
// ⚠ TWO RUNGS, ONE BOAT. A hull that needs a key on the panel and starts herself in the log is not
// two presentations of one boat, it is two boats — the display-mode rule this plugin's own README
// states. Read off the sources, because neither seat can be entered from here.
const th = blank(readFileSync('plugins/powerboat/texthelm.js', 'utf8'));
ck('the panel seats you in a dead boat', /running:\s*false/.test(cli));
ck('…and so does the text rung', /running:\s*false/.test(th));
ck('the text rung can turn the key', /word === 'start'/.test(th) && /word === 'kill'/.test(th));
// ⚠ `stop` IS ALREADY THE BOTTOM BELL. An ignition order spelled `stop` would be two meanings for
// one word on the one surface where every order is typed.
ck('…without colliding with the STOP bell', /BELLS = \{ stop:/.test(th) && !/word === 'stop'\s*\)\s*\{[\s\S]{0,80}running = false/.test(th));

// ⚠ A STOPPED MOTOR BURNS NOTHING, and that figure is the IDLE burn — left unconditional a hull
// left shut down at the pontoon drinks her own tank, which is the one thing a key is for.
ck('neither rung burns fuel with the key off',
   /running\)\s*st\.fuel = Math\.max/.test(cli) && /running\)\s*c\.fuel = Math\.max/.test(th));

// ── 5. AND IT LETS GO ───────────────────────────────────────────────────────
console.log('\n— coming down —');
bv.closeBoat();
ck('closeBoat reports inactive', bv.isBoatActive() === false);
const armed = pending();
frameStep(48);
ck('…and the loop stopped', pending() === armed || typeof pending() !== 'function',
   'a frame was still scheduled after close');
ck('closing twice does not throw', (() => { try { bv.closeBoat(); return true; } catch { return false; } })());

// ── 5. THE YARD SCREEN ──────────────────────────────────────────────────────
//
// The other client surface this plugin owns. ⚠ IT IS NOT A SEAT — it mounts no windshield, so the
// bigscreen and seat-keys gates derive their lists from `windshieldHTML(` and correctly never see
// it. Which means nothing else in the repo opens it at all, and a panel nothing opens is a panel
// that can be broken for a week before anybody walks into a marina.
console.log('\n— the yard screen —');
const mp = await import('../../client/game/js/panels/marina-panel.js');
ck('starts inactive', mp.isMarinaActive() === false);

const yardData = (tab, over = {}) => ({
  tab, name: 'Fairweather Marina', credits: 20000,
  // `dock` is the SERVER's answer to "is this room a berth", and the dock tab does not exist without
  // it — see the note on TABS in marina-panel.js.
  dock: true, hereName: 'The Dock Hall', sky: { hour: 13, night: 0, weather: 'clear' },
  fleet: [{
    id: 'boat_1', typeId: 'hydro', name: 'Rooster', typeName: 'Vaskin Rooster',
    hull: 0.8, band: 'marked', fuel: 0.6, nitro: 0.5,
    hereNow: true, aboard: false,
    where: 'The Dock Hall, under cover', whereShort: 'The Dock Hall',
  }],
  berths: [{ name: 'The Dock Hall', kindWord: 'under cover', capacity: 2, taken: 1 }],
  dealer: true, stock: [{ id: 'hydro', name: 'Vaskin Rooster', price: 14500, blurb: 'A blown picklefork.' }],
  refitCap: 1,
  ...over,
});

const yardMount = fakeEl();
const clicked = [];
mp.openMarina({ ...yardData('fleet'), mount: yardMount, onSend: (c) => clicked.push(c) });
ck('openMarina reports it active', mp.isMarinaActive() === true);
ck('…and it wrote a root into the mount', /mar-root/.test(yardMount.innerHTML || ''));

// ⚠ EVERY TAB HAS TO BUILD, because a body that throws leaves the panel half-drawn with no error
// anywhere a player can see — and three of the four are only ever reached by a click.
// ⚠ AND EACH IS CHECKED ON ITS CONTENT, NOT ON "IT DID NOT THROW". A `draw` that wrote an empty
// body would pass a throw test perfectly, which is the whole class of failure this is here for.
const TAB_PROOF = {
  dock: 'mar-scene', fleet: 'Rooster', dealer: '14,500', berths: '1 of 2', bench: 'Refit her',
};
for (const [tab, proof] of Object.entries(TAB_PROOF)) {
  let threw = null;
  try { mp.marinaSetData(yardData(tab)); } catch (e) { threw = e.message; }
  ck('the ' + tab + ' tab builds', !threw, threw);
  ck('…and has its content on it', !threw && String(yardMount.innerHTML || '').includes(proof),
    'expected to find ' + JSON.stringify(proof));
}

// ── ⚠ BOARD AND THE HELM ARE GATED ON THE SERVER'S FACTS ───────────────────────────────────────
//
// Both buttons were unconditional, so a card for a hull under cover two rooms away offered a Board
// button that `embark` correctly refuses for not being at the berth. That is the whole of the
// report "the buttons in the boat depot have to allow you get in your boat": the verb was right and
// the screen had never been told. Three states, and each one has exactly one live button.
{
  const acts = () => String(yardMount.innerHTML || '');
  mp.marinaSetData(yardData('dock'));
  ck('tied up here: Board is live', /data-cmd="embark"/.test(acts()));
  ck('…and the helm is refused until you are in her',
    /disabled[^>]*Get aboard her first|Get aboard her first[^<]*<\/button>/.test(acts()) || /disabled title="Get aboard her first"/.test(acts()));

  mp.marinaSetData(yardData('dock', {
    aboardId: 'boat_1',
    fleet: [{ ...yardData('dock').fleet[0], aboard: true }],
  }));
  ck('aboard: the helm is live', /data-cmd="helm"/.test(acts()));
  ck('…and Board has become the way out', /data-cmd="disembark"/.test(acts()));

  mp.marinaSetData(yardData('dock', {
    fleet: [{ ...yardData('dock').fleet[0], hereNow: false, whereShort: 'The Hardstanding' }],
  }));
  ck('she is elsewhere: Board is refused and says where she is',
    !/data-cmd="embark"/.test(acts()) && /The Hardstanding/.test(acts()));
}

// ⚠ AND THE DOCK TAB DOES NOT EXIST IN A ROOM WITH NO WATER IN IT — the lobby is the marina and is
// not a berth, so the screen must not offer a picture of a dock you are not standing on.
{
  let threw = null;
  try { mp.marinaSetData(yardData('fleet', { dock: false })); } catch (e) { threw = e.message; }
  ck('a room that is not a berth has no dock tab', !threw && !/data-tab="dock"/.test(String(yardMount.innerHTML || '')), threw);
}

// ── ⚠ THE DEALER SHOWS YOU THE HULL, AND SAYS WHAT SHE LEAVES THE SHED WITH ────────────────────
//
// A wireframe is the one thing on this screen the text rung genuinely cannot carry, which is
// exactly why it is the one thing here that is not a line of prose — and it is `drawWireframe3D`,
// the schematic the aircraft lot and the rig lot already buy through, rather than a second
// renderer. What can be asserted headlessly is that the card CARRIES one and that it is bound to
// the type id, because a canvas with no class on it draws the Twin Otter fallback: `aircraftFaces`
// builds anything it does not recognise as a fixed wing, silently, which is how the Mayfly once
// shipped as a light twin.
{
  mp.marinaSetData(yardData('dealer'));
  const html = () => String(yardMount.innerHTML || '');
  ck('the dealer card carries a schematic', /class="mar-wf"/.test(html()));
  ck('…bound to the hull it is selling', /data-wf-cls="hydro"/.test(html()),
    'an unbound canvas renders the fixed-wing fallback, not a boat');
  // She has always been sold brimmed — the insert writes `fuel, condition` as 1, 1 — and until
  // fuel could be SPENT that was a detail nobody could act on. Now a tank is a running cost, so
  // "the price includes a full one" is part of the price and belongs beside the number.
  ck('…and says she comes with a full tank', /tank full/i.test(html()));
  // ⚠ AND NEITHER IS ON A TAB THAT IS NOT THE DEALER'S. A schematic left in the fleet list is a
  // rAF loop with nothing to draw, running for as long as somebody leaves the screen open.
  mp.marinaSetData(yardData('fleet'));
  ck('the fleet list carries no schematic', !/class="mar-wf"/.test(html()));
}

// ⚠ AND IT SURVIVES AN EMPTY YARD, which is the FIRST state anybody sees: no boats, and at most
// marinas no dealer either, so every list on the screen is empty at once.
{
  let threw = null;
  try { mp.marinaSetData({ tab: 'fleet', name: 'Somewhere', credits: 0 }); } catch (e) { threw = e.message; }
  ck('an empty yard does not throw', !threw, threw);
  for (const tab of ['dealer', 'berths', 'bench']) {
    let t2 = null;
    try { mp.marinaSetData({ tab, name: 'Somewhere', credits: 0 }); } catch (e) { t2 = e.message; }
    ck('…nor its ' + tab + ' tab', !t2, t2);
  }
}

// ⚠ AND CLOSING THE SCREEN LEAVES NOTHING SCHEDULED AGAINST IT. The schematics turn on a rAF loop
// — the only one in that file, and the opposite case from the dock, which is a still life and
// explicitly refuses one. The loop re-queries its canvases and retires itself when they are gone,
// which covers a redraw; a CLOSE empties the host in the same tick, so without an explicit cancel
// there is one more frame booked against a detached node. Asserted rather than reasoned about,
// because the harness holds exactly one pending callback and can therefore see the difference.
mp.marinaSetData(yardData('dealer'));
mp.closeMarina();
ck('closing the yard leaves no frame booked against it', pending() === null || pending() === undefined);
ck('closeMarina reports inactive', mp.isMarinaActive() === false);
ck('closing twice does not throw', (() => { try { mp.closeMarina(); return true; } catch { return false; } })());

console.log('\n' + (fails ? `✗ boat:smoke — ${fails} problem(s)` : '✓ boat:smoke — the seat mounts, paints and reports a packet the server can read; the yard screen builds every tab and lets go.'));
process.exit(fails ? 1 : 0);

// BIG SCREEN — the gate for a feature whose every failure is silent.
//
// `body.bigscreen` (client/game/js/panels/bigscreen.js) takes the whole page away and leaves the
// world: no header, no sidebar, no log, no command box, and none of the readouts a seat hangs on
// its own glass. It is assembled out of four parts that live in four places, and each of them
// fails without a word:
//
//   · A SEAT WITH NO STRIPPING RULE looks like the mode not working — the page goes and the
//     instrument panel is still sitting over the picture.
//   · A SEAT WITH NO `exitBigScreen()` ON ITS CLOSE PATH STRANDS THE PLAYER. The mode owns the
//     PAGE, so nothing else takes it down: climb out of the cab in big screen and you are left
//     looking at a room description with no sidebar, no log and no command box, and the one key
//     that would have fixed it is bound only while the mode thinks it is on.
//   · A SEAT WITH NO BUTTON simply cannot be got into, which is the mildest of the four and the
//     easiest to ship.
//   · AND THE PAGE RULES are the one part a browser is needed to see, so what is checked here is
//     that each element that must go is named at all.
//
// ⚠ THE SEAT LIST IS DERIVED, NEVER WRITTEN DOWN. A seat is a file that calls `windshieldHTML(`,
// which is the only way to put a world canvas on the page — so a fifth one added later arrives
// here as a failure rather than as a gap nobody notices. The map below says where each seat's
// chrome LIVES, because the wheelhouse is split (helm-view.js paints, helm-mode.js owns the
// buttons and the close), and an entry is a REASON rather than a name.
//
// ⚠ AND COMMENTS ARE BLANKED BEFORE THE CODE CHECKS, per the note at the top of
// scripts/lib/blank-scanner.mjs: this repo's files are mostly prose and the prose here names
// every identifier the scan is looking for — including in this file's own header.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { blank } from '../lib/blank-scanner.mjs';

const PANELS = 'client/game/js/panels';
const fails = [];
const notes = [];
const fail = (m) => fails.push(m);
const read = (p) => readFileSync(p, 'utf8');

// Where each seat's chrome lives, and why it is not always the file that paints.
const OWNER = {
  'cab-view.js':      { chrome: 'cab-view.js',  root: '.cab-wrap',  why: 'the truck cab paints and wears its own chrome' },
  'cockpit.js':       { chrome: 'cockpit.js',   root: '.fsim',      why: 'the flight sim and the charter cabin, one file, two mounts' },
  'freelook-view.js': { chrome: 'freelook-view.js', root: '.fl-root', why: 'the camera with no vehicle under it' },
  'helm-view.js':     { chrome: 'helm-mode.js', root: '.helm-root', why: 'helm-view paints the chase; helm-mode owns the console, the chips and closeHelm' },
  'boat-view.js':     { chrome: 'boat-view.js', root: '.boat-root', why: 'the race boat paints and wears its own chrome — the cab arrangement rather than the wheelhouse split' },
};

// ── 1. every seat is accounted for ──────────────────────────────────────────
// ⚠ RAW SOURCE HERE, WHICH IS THE OPPOSITE OF EVERY OTHER CHECK BELOW, and it cost a run that
// found ONE seat out of four. `blank` wipes a template literal WHOLE — interpolations included,
// whatever its header's "a template interpolation is just code again" reads like — and three of
// the four seats build their markup as a template, so `${windshieldHTML(id, label)}` is blanked
// and the seat disappears. The cost of reading raw is a comment that names the call being taken
// for a seat, which fails LOUDLY (an OWNER entry it cannot find) rather than quietly.
const seats = readdirSync(PANELS)
  .filter((f) => f.endsWith('.js'))
  .filter((f) => read(join(PANELS, f)).includes('windshieldHTML('))
  .filter((f) => f !== 'windshield.js' && f !== 'windshield-lazy.js');

if (!seats.length) fail('found no seats at all — has windshieldHTML been renamed?');
for (const f of seats) {
  if (!OWNER[f]) fail(`${f} mounts a windshield and has no entry in OWNER — say where its big-screen chrome lives, with a reason`);
}
notes.push(`seats: ${seats.join(', ')}`);

// ── 2. each seat strips its own glass, offers the button, and clears the mode ─
const chromeFiles = new Set();
for (const f of seats) {
  const o = OWNER[f];
  if (!o) continue;
  chromeFiles.add(o.chrome);
  const raw = read(join(PANELS, o.chrome));
  const code = blank(raw);

  // ⚠ THE RULE IS CHECKED IN RAW SOURCE, because a seat's stylesheet is a TEMPLATE LITERAL and
  // `blank` wipes those — that is right for every other check here and would blank the one thing
  // this one is looking for. A CSS-rule shape rather than the bare class name, so the prose in
  // these files (which quotes it constantly) cannot satisfy it.
  //
  // ⚠ AND IT IS PINNED TO THE SEAT'S OWN ROOT, which a looser version was not: every one of these
  // files carries SEVERAL big-screen rules, so "has a body.bigscreen rule that hides something"
  // stayed green with the one rule that matters deleted. The allow-list shape the three freecam
  // rules already use — hide the root's children EXCEPT the picture — is the thing to test for,
  // because a rule that names what to HIDE is a rule somebody has to remember to add to and the
  // next overlay hung on that glass ships inside the shot.
  const rule = new RegExp(String.raw`body\.bigscreen ${o.root.replace('.', '\\.')} > \*:not\([^\n]*display\s*:\s*none`);
  if (!rule.test(raw)) {
    fail(`${o.chrome}: no allow-list rule 'body.bigscreen ${o.root} > *:not(…){display:none}' — ${f}'s glass keeps its readouts in big screen`);
  }
  if (!code.includes('bindBigScreenButton(')) {
    fail(`${o.chrome}: never calls bindBigScreenButton — ${f} has no way into big screen`);
  }
  // ⚠ EVERY CLOSE PATH, NOT "the file mentions it somewhere". cockpit.js has two — the charter
  // cabin and the flight sim — and a check that only asked whether the call appeared at all
  // stayed green with one of them deleted. Every exported top-level `close*` in these four files
  // is a seat teardown, which is what makes this exact rather than a heuristic.
  // ⚠ AND IT IS EVERY PAGE-LEVEL CLASS THE SEAT TURNS ON, NOT JUST BIG SCREEN. The three rungs
  // strand the player in three different ways and all for one reason — a `body` class the SEAT set
  // and nothing else takes down. Hiding the sidebar is the worst of them, because there is no
  // switch for the panels anywhere in the base UI: close a seat with it on and the game is missing
  // a fifth of its interface with nothing on screen to say why.
  //
  // A seat only has to clear what it can turn ON, so each rule is conditional on the setter being
  // in the file — which is what lets a seat that never offers the sidebar switch stay silent
  // rather than being made to clear a class it cannot set.
  // The two PAGE-level classes are asked of every close in the file, because either seat in a
  // two-seat file can have turned one on: big screen and the sidebar are one state for the whole
  // page rather than one per seat.
  const owes = [['exitBigScreen(', 'big screen']];
  if (code.includes('bindSidebarButton(')) owes.push(['setSidebarHidden(', 'the sidebar switch']);

  const closes = [];
  for (const m of code.matchAll(/^export function (close\w*)\s*\([^)]*\)\s*\{/gm)) {
    const from = m.index;
    const end = code.indexOf('\n}', from);
    const body = code.slice(from, end < 0 ? code.length : end);
    closes.push({ name: m[1], body });
    for (const [needs, what] of owes) {
      if (!body.includes(needs)) fail(`${o.chrome}: ${m[1]}() does not clear ${what} — closing ${f} with it on strands the player`);
    }
  }

  // ⚠ THE COLUMN RUNGS ARE ASKED OF THE FILE AND NOT OF EVERY CLOSE, WHICH IS A NARROWING THE
  // FIRST CUT GOT WRONG AND THE GATE CAUGHT. A rung is per SEAT (`fsim-`, `ck-`, `cab-`, …) and
  // cockpit.js holds two of them, so demanding every close clear every prefix in its own file made
  // `closeCockpit` answer for the flight sim's layout — four findings, none of them a bug. What is
  // genuinely checkable here is that a rung this file can turn ON is one some close path takes
  // back down; which close owns which seat is not something the text can say.
  for (const t of new Set([...code.matchAll(/classList\.toggle\('([a-z]+-(?:fullscreen|hidepanel))'/g)].map((m) => m[1]))) {
    const cleared = closes.some((c) => new RegExp(String.raw`classList\.remove\([^)]*'${t}'`).test(c.body));
    if (!cleared) fail(`${o.chrome}: nothing clears '${t}' on the way out — closing ${f} with that rung on leaves the log and the command box folded away`);
  }
}
notes.push(`chrome owners: ${[...chromeFiles].join(', ')}`);

// ── 3. the page half ────────────────────────────────────────────────────────
// One block in styles.css, beside the other immersive layouts. Checked by NAME only — whether a
// rule actually wins is a question for a browser, and the rect census in the harness is where that
// was measured. What this catches is somebody adding a page element and not adding it here.
const css = read('client/game/styles.css').replace(/\/\*[\s\S]*?\*\//g, ' ');
const bigBlock = css.split(/(?=body\.bigscreen)/).filter((s) => s.startsWith('body.bigscreen')).join('\n');
if (!bigBlock) fail('styles.css: no body.bigscreen rules at all');
for (const sel of ['#header', '#sidebar', '#mobile-hud', '#output', '#look-resize-handle', '#bottom-input-wrap']) {
  if (!bigBlock.includes(`body.bigscreen ${sel}`)) fail(`styles.css: big screen does not name ${sel} — it stays on screen over the world`);
}
// ── THE SIDEBAR SWITCH ──────────────────────────────────────────────────────
// ⚠ HIDING THE SIDEBAR IS NOT ENOUGH ON ITS OWN, the same grid trap the big-screen block is
// written up for: #main declares its tracks and #output-container names the one it sits in, so a
// rule that only sets `display:none` leaves the pane in a 1fr track beside an empty 240px one, or
// (sidebar on the right) in a column that no longer exists. It looks like the button doing nothing.
const sideBlock = css.split(/(?=body\.nosidebar)/).filter((s) => s.startsWith('body.nosidebar')).join('\n');
if (!/body\.nosidebar #sidebar\s*\{[^}]*display:\s*none/.test(sideBlock)) {
  fail('styles.css: body.nosidebar does not hide #sidebar');
}
if (!/body\.nosidebar #main\s*\{[^}]*grid-template-columns/.test(sideBlock)) {
  fail("styles.css: body.nosidebar does not restate #main's grid-template-columns — the pane keeps the sidebar's empty track");
}
if (!/body\.nosidebar #output-container\s*\{[^}]*grid-column/.test(sideBlock)) {
  fail('styles.css: body.nosidebar does not restate #output-container\'s grid-column — with the sidebar on the right the pane is placed in a column that no longer exists');
}
// ⚠ The inline height the look-resize handle stores on #area-pane beats every class rule, which is
// why the other immersive layouts carry !important here and why this one must too.
if (!/body\.bigscreen #area-pane\s*\{[^}]*max-height:\s*none\s*!important/.test(bigBlock)
    || !/body\.bigscreen #area-pane\s*\{[^}]*height:\s*auto\s*!important/.test(bigBlock)) {
  fail('styles.css: #area-pane needs max-height:none !important AND height:auto !important — a dragged pane height is an INLINE style and beats a class rule');
}
// #main is a grid with named columns; hiding the sidebar alone leaves the pane in a 1fr track
// beside an empty 240px one, or (sidebar on the right) in a column that no longer exists.
if (!/body\.bigscreen #main\s*\{[^}]*grid-template-columns/.test(bigBlock)) {
  fail('styles.css: big screen does not restate #main\'s grid-template-columns — the pane keeps the sidebar\'s empty track');
}

// ── 4. the one readout the renderer paints ──────────────────────────────────
// Everything else on the glass is DOM and goes with a CSS rule. The weather badge is painted into
// the canvas, so it needs its own guard — read off the page rather than threaded through eight
// paintWindshield call sites, see the note beside it.
const ws = blank(read(join(PANELS, 'windshield.js')));
const badge = ws.slice(ws.indexOf('function drawWxBadge'), ws.indexOf('function drawWxBadge') + 300);
if (!/bigScreenOn\(\)/.test(badge)) {
  fail('windshield.js: drawWxBadge no longer checks bigScreenOn() — the weather chip is painted over a HUD-free view');
}
if (!/classList\.contains\('bigscreen'\)/.test(ws)) {
  fail('windshield.js: bigScreenOn no longer reads the body class');
}

// ── 5. the way out ──────────────────────────────────────────────────────────
const bs = blank(read(join(PANELS, 'bigscreen.js')));
// ⚠ CAPTURE PHASE OR THE HELM EATS IT. helm-mode binds Esc on the window to LEAVE THE HELM; a
// bubble listener here fires after it and the first press does both.
if (!/addEventListener\('keydown',\s*onKey,\s*true\)/.test(bs)) {
  fail("bigscreen.js: the Esc listener is not capture-phase — the helm's own Esc runs first and one press both leaves big screen and shuts the wheelhouse");
}
if (!/stopPropagation\(\)/.test(bs)) fail('bigscreen.js: Esc is not stopped — the seats below still see it');
// A modal opened over the shot is the innermost layer and gets the key first.
if (!/activeModal\(\)/.test(bs)) fail('bigscreen.js: Esc does not abstain for an open modal — a confirm window could not be dismissed');
// A refused fullscreen must not leave the mode believing it holds one.
if (!/fullscreenchange/.test(bs)) {
  fail("bigscreen.js: nothing listens for fullscreenchange — the browser's own Esc would drop out of fullscreen and leave the page wearing no header and no sidebar");
}

if (fails.length) {
  console.error('bigscreen:smoke — FAILED');
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`bigscreen:smoke — ${seats.length} seats, each strips its glass, offers the button and clears the mode on close; the page block names every element it has to take.`);
for (const n of notes) console.log('  · ' + n);

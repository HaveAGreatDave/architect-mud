// Accessibility contract check for the game client.
//
// The Display Mode `log` rung makes a promise to a player using a screen reader,
// and the whole promise rests on three attributes in one HTML file plus one
// function in render.js. None of that is exercised by any other test, and all of
// it is the kind of thing an unrelated edit removes without anyone noticing —
// there is no visible symptom, the game just goes silent for the people who need
// it most.
//
// This is a STATIC check. It cannot tell you what a screen reader says, how it
// paces, or whether listening to it is bearable — that needs a human with NVDA
// (see docs/systems-display-mode.md). What it can do is stop the mechanism being
// deleted by accident.
//
// Run: node scripts/a11y/smoke.mjs   (also wired into pretest:regress)
import { readFileSync } from 'node:fs';

let failed = 0;
const bad = (m) => { console.error(`  ✗ ${m}`); failed++; };
const ok = (m) => console.log(`  ✓ ${m}`);

const html = readFileSync('client/game/index.html', 'utf8');
const render = readFileSync('client/game/js/render.js', 'utf8');
const dispatch = readFileSync('client/game/js/dispatch.js', 'utf8');

// ── The log is the game's voice ──────────────────────────────────────────────
// Without role="log" nothing in the client is announced at all: a screen-reader
// player would have to re-navigate to the log after every command to discover
// what happened. It implies polite announcement of ADDITIONS ONLY, which is
// exactly the shape of #output (appendHtml appends; it never rewrites).
if (/<div id="output"[^>]*role="log"/.test(html)) ok('#output carries role="log" — the game has a voice');
else bad('#output has lost role="log" — NOTHING in the client is announced any more');

if (/<div id="output"[^>]*aria-label=/.test(html)) ok('#output is labelled');
else bad('#output has no aria-label — it is announced as an unnamed region');

if (/<div id="output"[^>]*aria-hidden/.test(html)) bad('#output is aria-hidden — the log is silent');

// ── The top pane must never be a live region ─────────────────────────────────
// It is REPLACED wholesale on every look (setAreaPane sets innerHTML). Marking it
// live re-announces the entire pane on every move, and at a text minigame's frame
// rate that is an unusable torrent that also queues ahead of the log.
const paneTag = html.match(/<div id="area-content"[^>]*>/)?.[0] || '';
if (!paneTag) bad('#area-content is gone — the pane checks below are meaningless');
else if (/aria-live/.test(paneTag)) bad('#area-content has aria-live — it is replaced wholesale, so this re-reads the whole pane on every move');
else ok('#area-content is not a live region');

if (/aria-label=/.test(paneTag)) ok('#area-content is labelled, so it can be found on demand');
else bad('#area-content has no aria-label — a screen reader user cannot locate the room pane');

// ── The bottom rung hides the pane rather than deleting it ───────────────────
if (/export function setPaneSilent/.test(render)) ok('setPaneSilent exists');
else bad('setPaneSilent is gone — the pane can no longer be hidden at the log rung');
if (/aria-hidden/.test(render)) ok('…and it toggles aria-hidden');
else bad('setPaneSilent no longer touches aria-hidden');

// Both room-painting handlers must drive it, or the pane stays announced (or
// stays hidden) after the player changes rung mid-session.
const paneSilentCalls = (dispatch.match(/setPaneSilent\(/g) || []).length;
if (paneSilentCalls >= 2) ok(`setPaneSilent is called on both look and move (${paneSilentCalls} sites)`);
else bad(`setPaneSilent is called ${paneSilentCalls}× — look AND move both need it`);

// ── The room reaches the log at the bottom rung ──────────────────────────────
// A look normally goes to the pane and never touches #output, so without this a
// player reading through the log alone walks from room to room hearing nothing
// about where they are. Server stamps `toLog`; the client must honour it.
const toLogAppends = (dispatch.match(/msg\.toLog\)\s*appendHtml/g) || []).length;
if (toLogAppends >= 2) ok(`the room description reaches the log on look and move (${toLogAppends} sites)`);
else bad(`msg.toLog is honoured at ${toLogAppends} site(s) — look AND move both need it, or the room goes unspoken`);

const server = readFileSync('server/index.js', 'utf8');
if (/stampToLog/.test(server)) ok('the server stamps toLog on outbound look/move');
else bad('server/index.js no longer stamps toLog — the client will never be told to log the room');

// ── The command input is labelled ────────────────────────────────────────────
// A placeholder is not a label: several screen readers drop it once anything is
// typed, leaving the only input in the game unnamed.
if (/id="cmd-input"[\s\S]{0,200}?aria-label=/.test(html) || /aria-label=[\s\S]{0,200}?id="cmd-input"/.test(html)) {
  ok('the command input is labelled');
} else bad('#cmd-input has no aria-label — the game\'s only input is unnamed');

// ── Live regions elsewhere ───────────────────────────────────────────────────
// The rule is NOT "exactly one live region" — that was too strong. A one-token,
// user-triggered readout is a legitimate ARIA pattern. The real constraint is
// that the log must be the only CONTINUOUS one: a second region that chatters
// interleaves with it and the listener cannot tell which is speaking.
//
// Anything added here needs a justification on this list, so the decision is made
// deliberately rather than by whoever last typed `aria-live`.
const ALLOWED_LIVE = [
  {
    file: 'client/game/js/panels/tablet-os.js',
    what: 'tos-tv-num (the TV channel readout)',
    why: 'one token, announced only in response to the player pressing CH▲/▼. Not continuous, so it cannot interleave with the log for more than a moment.',
  },
];
const CLIENT_FILES = [
  'client/game/index.html',
  ...['tablet-os', 'textbreach', 'texthololock', 'textvault', 'textsignal', 'textcockpit', 'textui']
    .map(f => `client/game/js/panels/${f}.js`),
  'client/game/js/render.js', 'client/game/js/dispatch.js',
];
for (const f of CLIENT_FILES) {
  let src;
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  // Skip prose: these files explain at length why the pane must NOT be live.
  const code = src.replace(/\/\/[^\n]*/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const hits = (code.match(/aria-live/g) || []).length;
  if (!hits) continue;
  const allowed = ALLOWED_LIVE.filter(a => a.file === f).length;
  if (hits > allowed) {
    bad(`${f} has ${hits} aria-live region(s), ${allowed} justified. A second CONTINUOUS live region interleaves with the game log — add it to ALLOWED_LIVE with a reason, or drop it.`);
  } else {
    ok(`${f}: ${hits} live region, justified (${ALLOWED_LIVE.find(a => a.file === f).what})`);
  }
}

// The character minigames repaint at frame rate. One of those marked live would
// be catastrophic — a torrent that never stops and drowns everything else.
for (const f of ['textbreach', 'texthololock', 'textvault', 'textsignal', 'textcockpit']) {
  const src = readFileSync(`client/game/js/panels/${f}.js`, 'utf8');
  if (/aria-live/.test(src.replace(/\/\/[^\n]*/g, ''))) {
    bad(`${f}.js declares aria-live — it repaints at frame rate and would drown the log`);
  }
}
ok('no character minigame declares a live region');

if (failed) {
  console.error(`\n✗ a11y:smoke — ${failed} problem(s). See docs/systems-display-mode.md.`);
  process.exit(1);
}
console.log('✓ a11y:smoke clean.');
console.log('  (Static only — what a screen reader actually SAYS still needs a human with NVDA.)');

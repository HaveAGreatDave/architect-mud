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

// ── The bottom rung puts the pane away ───────────────────────────────────────
if (/export function setPaneSilent/.test(render)) ok('setPaneSilent exists');
else bad('setPaneSilent is gone — the pane can no longer be hidden at the log rung');
if (/aria-hidden/.test(render)) ok('…and it toggles aria-hidden');
else bad('setPaneSilent no longer touches aria-hidden');
if (/log-rung/.test(render)) ok('…and collapses the pane visually');
else bad('setPaneSilent no longer toggles the log-rung class — the pane stays on screen duplicating the log');

const css = readFileSync('client/game/styles.css', 'utf8');
if (/\.log-rung[^{]*#area-pane/.test(css)) ok('the log-rung collapse rule exists in styles.css');
else bad('styles.css has no .log-rung rule for #area-pane — the class is toggled but does nothing');

// Both room-painting handlers must drive it, or the pane stays announced (or
// stays hidden) after the player changes rung mid-session.
const paneSilentCalls = (dispatch.match(/setPaneSilent\(/g) || []).length;
if (paneSilentCalls >= 2) ok(`setPaneSilent is called on both look and move (${paneSilentCalls} sites)`);
else bad(`setPaneSilent is called ${paneSilentCalls}× — look AND move both need it`);

// THE DANGEROUS ONE. The text cockpit and the five character minigame boards
// mount in the very pane this hides, so an ungated hide blacks out a text pilot's
// instruments or a breach board mid-run. Both call sites must be gated.
const guardedHides = (dispatch.match(/setPaneSilent\([^)]*free[^)]*\)/g) || []).length;
if (guardedHides >= 2) ok(`the pane is only hidden when no text cockpit or minigame owns it (${guardedHides} sites gated)`);
else bad(`only ${guardedHides} setPaneSilent call(s) are gated on paneFreeForRoom() — hiding the pane while a text cockpit or minigame board is mounted blacks it out`);

// ── Brief rooms ──────────────────────────────────────────────────────────────
// Without this the log-rung player gets a full prose paragraph read aloud on
// every single step, which is the difference between a playable transcript and
// an unusable one.
{
  const brief = readFileSync('server/engine/room-brief.js', 'utf8');
  const server2 = readFileSync('server/index.js', 'utf8');
  if (/arrivalRoom/.test(server2)) ok('the server shortens a walked-into room in the log');
  else bad('server/index.js no longer calls arrivalRoom — every step logs a full paragraph');
  // The safety property. An abbreviated `look` would make the information GONE
  // rather than one keystroke away, and the whole contract rests on that.
  if (/message\.type === 'look' \? message\.message/.test(server2)) ok("…and never abbreviates an explicit `look`");
  else bad('the full-render condition has changed — an explicit `look` MUST stay full, or the short arrival becomes lossy');
  if (/appendHtml\(msg\.logMessage \|\| msg\.message/.test(dispatch)) ok('…and the client honours the brief copy');
  else bad('the client ignores msg.logMessage — the brief is computed and thrown away');
  // The transform parses another module's markup, so its bail-out is load-bearing.
  if (/return html;/.test(brief)) ok('briefRoom bails out to the full description when it does not recognise one');
  else bad('briefRoom no longer returns the input unchanged on an unrecognised description — it can now eat a room');
}

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

// ── A SILENT look is not an explicit one ─────────────────────────────────────
// The client fires sendCmdSilent('look') from ~15 places to repaint the area
// pane — the zone_event refresh when somebody ELSE leaves the room, the combat
// refresh, take, every panel close. All arrive as `type: 'look'`, which means
// FULL. Left unmarked, a bystander walking east reads the whole room aloud.
if (/stampToLog\(player, result, !!msg\.silent\)/.test(server)) {
  ok('a silent look is distinguished from an explicit one before it reaches the log');
} else bad('stampToLog no longer receives msg.silent — every pane refresh will read the full room aloud');
if (/silent && message\.type === 'look'/.test(server)) {
  ok('a silent look is never rendered full');
} else bad('stampToLog no longer special-cases a silent look — the brief contract is only half enforced');

// ── Flavour is droppable ─────────────────────────────────────────────────────
// Scene-setting ambience read aloud is a torrent with nothing in it, and unlike
// a room description there is no keystroke that gets it back. Both broadcast
// paths must honour the mark — sendToPlayer returns before `deliver` runs.
const flavourGuards = (server.match(/message\.flavour && loggedPanelsSync/g) || []).length;
if (flavourGuards >= 2) ok(`flavour ambience is dropped at the log rung on both broadcast paths (${flavourGuards} sites)`);
else bad(`the flavour filter is present at ${flavourGuards} broadcast site(s) — the zone path AND the targeted path both need it`);

// The mark must stay NARROW. Sound propagation carries gunshots and screams as
// well as dripping pipes, so it must default to speaking.
const sounds = readFileSync('server/engine/sounds.js', 'utf8');
if (/propagateSound\([^)]*flavour = false/.test(sounds)) {
  ok('propagateSound treats an unmarked sound as news, not flavour');
} else bad('propagateSound no longer defaults flavour to false — an unmarked gunshot could go unspoken');

// ── Lock flavour collapses at the bottom rung ────────────────────────────────
// A lock type writes its own sentence ("The keycard reader flashes green. The
// lock disengages."), which is the right thing to READ and a paragraph to hear
// on a door you use twenty times a day. The only news in it is whether it
// locked. Rendering only — the refusal keeps the type's own `denied` line,
// because that one explains WHY.
const doorsSrc = readFileSync('server/engine/commands/doors.js', 'utf8');
if (/terseLock\(player,[\s\S]{0,200}?'Locked\.'/.test(doorsSrc) && /terseLock\(player,[\s\S]{0,200}?'Unlocked\.'/.test(doorsSrc)) {
  ok('lock and unlock collapse to one word at the log rung');
} else bad('the door lock/unlock flavour is no longer shortened at the log rung');
const aptSrc = readFileSync('server/engine/apartments.js', 'utf8');
if (/loggedPanelsSync\(player\)[\s\S]{0,120}?"Locked\."/.test(aptSrc)) ok('…and so does your own front door');
else bad('the apartment lock verb still speaks its full flavour at the log rung');

// ── The command input is labelled ────────────────────────────────────────────
// A placeholder is not a label: several screen readers drop it once anything is
// typed, leaving the only input in the game unnamed.
if (/id="cmd-input"[\s\S]{0,200}?aria-label=/.test(html) || /aria-label=[\s\S]{0,200}?id="cmd-input"/.test(html)) {
  ok('the command input is labelled');
} else bad('#cmd-input has no aria-label — the game\'s only input is unnamed');

// ── The login screen ─────────────────────────────────────────────────────────
// THE FIRST SCREEN IN THE GAME. If it can't be filled in, nothing behind it
// matters — every other check in this file is about a player who already got in.
//
// A `<label>` with no `for` is not associated with anything, so a screen reader
// names the box by its PLACEHOLDER, and several drop the placeholder the moment
// you type — leaving you in an unnamed field on a form you cannot submit twice.
{
  const labels = [...html.matchAll(/<label(\s[^>]*)?>/g)].map(m => m[0]);
  // A label that WRAPS its input (the "Remember me" checkbox) is implicitly
  // associated and needs no `for`; those are the only ones allowed to be bare.
  const wrapping = (html.match(/<label\s*>\s*<input/g) || []).length;
  const bareCount = labels.filter(l => !/\sfor=/.test(l)).length;
  if (bareCount > wrapping) {
    bad(`${bareCount - wrapping} <label> without a "for" — a screen reader will name those fields by their placeholder, which vanishes once the player types`);
  } else ok(`every login/registration label is associated (${labels.length} labels)`);

  for (const id of ['auth-handle', 'auth-username', 'auth-password', 'auth-email']) {
    if (!new RegExp(`<label for="${id}"`).test(html)) bad(`#${id} has no associated label — it is a field on the first screen of the game`);
  }
  ok('the four sign-in fields are each named');

  // A rejected login must SPEAK. The field it refers to has already lost its
  // value, and a player who doesn't hear "wrong password" simply sits there.
  if (/id="auth-error"[^>]*role="alert"/.test(html)) ok('a failed login is announced (role="alert")');
  else bad('#auth-error has no role="alert" — a rejected login is painted silently');
}

// ── The way out, before you have a tablet ────────────────────────────────────
// Display Mode lives in the tablet, and the prologue deliberately refuses the
// tablet until the clone vat issues it. `displaymode` is therefore a plain verb
// with NO tablet gate — and the prologue says so in the log at first login,
// because there is no way to guess a verb nobody has mentioned.
{
  const prologue = readFileSync('plugins/prologue/index.js', 'utf8');
  if (/data-cmd="displaymode log"/.test(prologue)) ok('first login names the text mode');
  else bad('the prologue no longer tells a new player that text mode exists — it is unguessable, and the setting is in a tablet they do not have yet');
  // The cinematic states its own skip hint visually, which is no use to somebody
  // who cannot see it.
  if (/Escape/.test(prologue)) ok('…and names the way to skip the opening sequence');
  else bad('the prologue no longer names Escape — a blind player sits through ~50s of silence with no stated way out');

  // ── …and the way out BEFORE you have a prompt ─────────────────────────────
  // The log line above arrives in the same tick as the ~50-second wordless cold
  // open, so it tells you how to leave a sequence that is already playing. The
  // auth screen's disclosure is the only place the choice can be made EARLY
  // enough for the prologue's skip branch to see it. No visible symptom if it
  // disappears — a screen-reader player just silently gets the cinematic again.
  if (/id="auth-display-details"/.test(html)) ok('the auth screen offers Display Mode before login');
  else bad('the pre-login Display Mode disclosure is gone — the choice can no longer be made before the cold open plays');

  for (const id of ['auth-display-textgames', 'auth-display-log', 'auth-display-visual']) {
    if (!new RegExp(`<label for="${id}"`).test(html)) bad(`#${id} has no associated label — it is a radio on the first screen of the game`);
  }
  if (/<summary id="auth-display-summary">/.test(html)) ok('…behind a named disclosure a screen reader can find');
  else bad('the disclosure has lost its summary — the control is unreachable by keyboard');

  // ⚠ NOTHING MAY BE PRE-CHECKED. An explicit `visual` for every new account
  // destroys presentation.js's never-chosen fourth state, which poker's
  // called-aloud felt reads. Untouched must send nothing at all.
  const displaySet = html.slice(html.indexOf('id="auth-display-details"'), html.indexOf('</details>'));
  if (/name="auth-display"[\s\S]{0,120}?checked/.test(displaySet)) {
    bad('a pre-login Display Mode radio is pre-checked — this collapses the never-chosen state for every account ever created');
  } else ok('…with nothing pre-checked, so an untouched account stays never-chosen');

  const net = readFileSync('client/game/js/net.js', 'utf8');
  if (/displayRung/.test(net)) ok('the choice is forwarded with the auth message');
  else bad('net.js no longer sends displayRung — the auth screen control is decorative');
  const server3 = readFileSync('server/index.js', 'utf8');
  if (/seedDisplayRungIfUnset/.test(server3)) ok('…and the server seeds it before player.login fires');
  else bad('finishAuth no longer seeds the pre-login rung — the prologue will read undefined and play the cinematic anyway');

  // A PRESSED radio is an instruction, not a seed. Seed-only was right for the
  // radio the screen REMEMBERS and wrong for one the player just pressed: every
  // account that has ever visited Settings has a stored rung, so without this
  // the login-screen control did nothing at all for anybody but a brand-new
  // character — you chose `log`, logged in, and got the graphical game.
  if (/displayRungExplicit/.test(net)) ok('…and a rung the player PRESSED is marked as an explicit choice');
  else bad('net.js no longer distinguishes a pressed rung from a remembered one — the login-screen choice is a no-op for any account that already has a rung');
  if (/explicitDisplayRung && DISPLAY_RUNGS\.includes/.test(server3)) ok('…which the server honours over a stored rung, validated');
  else bad('finishAuth no longer applies an explicit pre-login rung (or applies it unvalidated) — the choice is silently dropped');

  const tablet = readFileSync('plugins/tablet/index.js', 'utf8');
  const dm = tablet.slice(tablet.indexOf('displaymode:'), tablet.indexOf('displaymode:') + 400);
  if (/noTablet/.test(dm)) bad('`displaymode` has become tablet-gated — the one setting a player needs BEFORE they are given a tablet');
  else ok('`displaymode` is reachable without a tablet');
}

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

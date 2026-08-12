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
const settingsSrc = readFileSync('client/shared/settings.js', 'utf8');
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

  // ── Getting TO that disclosure ───────────────────────────────────────────
  // Every check above verifies the seam works for someone who reaches it. These
  // verify they can. See docs/systems-display-mode.md § Getting to the
  // disclosure at all.

  // The wordmark is drawn in block glyphs, so a reader either spells the banner
  // out as box-drawing noise or skips it — either way the game never says its
  // own name. The <h1> is the name, and the screen's only heading.
  const banners = ['auth-ascii', 'auth-title'].filter(
    id => !new RegExp(`id="${id}"[^>]*aria-hidden="true"|id="${id}"\\s*\\n?\\s*aria-hidden="true"`).test(html));
  if (banners.length) bad(`${banners.join(', ')}: ASCII banner art is not aria-hidden — a screen reader reads ~200 box-drawing characters before the form`);
  else ok('the ASCII banners are decoration, not the first 200 characters a player hears');
  if (/<h1 class="sr-only">ARCHITECT<\/h1>/.test(html)) ok('…and the game says its name in characters, once');
  else bad('the auth screen has no text heading — the wordmark is glyph art, so the name is never spoken');

  // THE ONE THAT LOCKED PEOPLE OUT. These were <a> with no href: not focusable,
  // not exposed as controls, so registration and password recovery were
  // mouse-only. An <a> here is the regression, not the fix.
  for (const id of ['auth-toggle-link', 'auth-forgot-link', 'verify-back-link']) {
    const tag = new RegExp(`<(\\w+)[^>]*\\sid="${id}"`).exec(html.replace(/\n\s*/g, ' '));
    if (tag && tag[1] === 'button') ok(`#${id} is a real button — reachable by keyboard`);
    else bad(`#${id} is <${tag ? tag[1] : 'missing'}> — an anchor with no href is not focusable, so this control cannot be reached without a mouse`);
  }

  // Register reveals two required fields ABOVE the current focus position.
  const mainAuth = readFileSync('client/game/js/main.js', 'utf8');
  if (/auth-mode-status/.test(html) && /auth-mode-status/.test(mainAuth)) ok('…and switching to register is announced rather than silently rearranging the form');
  else bad('nothing announces the register/login mode flip — the first news of a required Handle field is the form rejecting you');
  // The registrations-closed fetch flips this toggle with a synthetic click.
  if (/isTrusted/.test(mainAuth)) ok('…and only a real press moves focus, so an async toggle cannot yank the caret');
  else bad('the auth toggle moves focus unconditionally — the registrations-closed fetch flips it with a synthetic click seconds after load');
  if (/new-password/.test(mainAuth)) ok('…and a password manager is asked to generate on register, not to fill');
  else bad('the password field never flips to autocomplete="new-password" — registering prompts to fill a password that does not exist yet');

  const net = readFileSync('client/game/js/net.js', 'utf8');
  // Registration hides the whole auth screen out from under the submit button.
  if (/verify-message'\)\.focus\(\)/.test(net)) ok('the verify screen takes focus, so a new account is not created in silence');
  else bad('showVerifyScreen does not move focus — the auth screen vanishes, focus falls to <body>, and nothing tells the player the account was made');
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

// ── The onboarding walkthrough ───────────────────────────────────────────────
// The tour is the first thing a new player is asked and the first thing they are
// told, and both halves were bare <div>s. Focus landed on a button, so the only
// thing spoken was "No — show me around, button" — an answer with no question,
// on a prompt that gates the whole prologue (beginArrival holds the arrival
// prose until it's answered). Each of the fifteen cards then read "Next, button"
// and not one word of the walkthrough.
{
  const tour = readFileSync('client/game/js/panels/tour.js', 'utf8');
  for (const [what, label] of [['tour-offer-title', 'the tour offer'], ['tour-card-title', 'each tour card']]) {
    if (new RegExp(`aria-labelledby'?,?\\s*'?${what}`).test(tour)) ok(`${label} is a NAMED dialog`);
    else bad(`${label} has no aria-labelledby — its text is never announced, and focus lands on a button with no question in front of it`);
  }
  // The card element survives the innerHTML swap between steps, so re-focusing it
  // fires no focus event and every step after the first is silent.
  if (/_card\.blur\(\);\s*\n\s*_card\.focus\(/.test(tour)) ok('…and each step re-enters the dialog, so it announces itself');
  else bad('the tour card is not blurred before being re-focused — only step 1 is ever announced');
  if (/_card\.setAttribute\('role', 'dialog'\)/.test(tour)) ok('…and the card is a dialog, not an unlabelled div');
  else bad('the tour card has lost role="dialog" — a screen reader has no reason to read it');
}

// ── Chargen ──────────────────────────────────────────────────────────────────
// A BLOCKING surface by the classification test in docs/systems-display-mode.md:
// the prologue's first move gate wants `appearance.changed`, and the MORPHEX is
// the only thing that emits it. Every sub-command was already typed — the hole
// was that nothing but a modal ever NAMED them, and the toast saying what
// changed rode the panel payload and never reached the log.
{
  const morphex = readFileSync('plugins/cosmetic-machine/index.js', 'utf8');
  if (/loggedPanelsSync/.test(morphex)) ok('the BioSculpt sheet has a written form');
  else bad('cosmetic-machine consults no rung — chargen is a panel with no text equivalent, and it gates the prologue');
  // One funnel. Every sub-command returns through buildPanelData, so the branch
  // belongs there and nowhere else — a second return path would be a toast that
  // silently never lands.
  if (/function buildPanelData[\s\S]{0,200}loggedPanelsSync\(player\)\) return renderMorphexText/.test(morphex)) {
    ok('…branched in the one builder every sub-command returns through');
  } else bad('the text form is not branched inside buildPanelData — some sub-command will return a panel and lose its toast');
}

// ── The type scale ───────────────────────────────────────────────────────────
// WCAG 1.4.4 asks that text scale to 200% without loss of content or function.
// The Font Size setting used to sit on `body` while 629 font-sizes in styles.css
// were hardcoded px, so raising it enlarged the log and the room pane and left
// the sidebar, the smartbar, every label and every panel at 11px — a setting
// that looked like it worked and stopped helping exactly where it mattered.
//
// The fix is one line (`html { font-size: var(--font-size-base) }`) plus the
// invariant below: nothing in the sheet may reintroduce an absolute font-size,
// because a single px value is a piece of the interface that never grows again.
{
  if (/^html\s*\{[^}]*font-size:\s*var\(--font-size-base\)/m.test(css)) {
    ok('the root font-size is driven by --font-size-base — the setting scales the whole interface');
  } else {
    bad('styles.css no longer hangs `html { font-size: var(--font-size-base) }` — the Font Size setting now scales nothing but whatever still inherits it');
  }

  // `max(1rem, 16px)` is deliberately not matched: an input under 16px makes iOS
  // zoom the viewport on focus, so those two need an absolute floor.
  const stray = [];
  css.split('\n').forEach((line, i) => {
    if (/(^|[^-\w])font-size:\s*[0-9.]+px/.test(line)) stray.push(i + 1);
  });
  if (stray.length) {
    bad(`${stray.length} absolute px font-size(s) in styles.css (line${stray.length > 1 ? 's' : ''} ${stray.slice(0, 8).join(', ')}${stray.length > 8 ? ', …' : ''}) — use rem against the 16px reference root, or that text can never be enlarged`);
  } else ok('every font-size in styles.css is relative');

  const strayHtml = [];
  html.split('\n').forEach((line, i) => {
    if (/(^|[^-\w])font-size:\s*[0-9.]+px/.test(line)) strayHtml.push(i + 1);
  });
  if (strayHtml.length) {
    bad(`${strayHtml.length} absolute px font-size(s) in index.html (line${strayHtml.length > 1 ? 's' : ''} ${strayHtml.slice(0, 8).join(', ')}${strayHtml.length > 8 ? ', …' : ''}) — the auth screen and the sidebar live here`);
  } else ok('every font-size in index.html is relative');

  // The setting is only as good as its top rung. 32px = 200% of the reference.
  const tos = readFileSync('client/game/js/panels/tablet-os.js', 'utf8');
  const grp = settingsSrc.slice(settingsSrc.indexOf("key: 'fontSize'"), settingsSrc.indexOf("key: 'fontSize'") + 700);
  const rungs = [...grp.matchAll(/v: '(\d+)'/g)].map(m => +m[1]);
  if (Math.max(...rungs, 0) >= 32) ok(`Font Size reaches ${Math.max(...rungs)}px (${Math.round(Math.max(...rungs) / 16 * 100)}% of the reference root)`);
  else bad(`Font Size tops out at ${Math.max(...rungs, 0)}px — WCAG 1.4.4 wants 200% of the 16px root, i.e. a 32 rung`);

  // ── The reading surfaces whose CSS lives in JS ─────────────────────────────
  // Roughly half the client's type is in template strings under js/panels/. The
  // split is NOT arbitrary and is not "whatever we got to": a surface you READ
  // scales, a surface you ACT through has a text rung instead (that is the whole
  // Display Mode contract above). Scaling a flight instrument's 7px label would
  // overlap the gauge beside it and buy nobody anything, because the accessible
  // path off the cockpit is `displaymode textgames`, not a bigger cockpit.
  //
  // Moving a file between these lists is a real decision. Make it here.
  const SCALES = [
    'panels/tablet-os', 'panels/whisper', 'panels/corp-console', 'panels/who',
    'panels/admin', 'panels/keypad', 'panels/color-picker', 'panels/deviceinspect',
    'panels/textui', 'panels/textcockpit', 'panels/minigame-common',
    'net', 'dispatch', 'markup',
  ];
  const strayJs = [];
  for (const f of SCALES) {
    const src = readFileSync(`client/game/js/${f}.js`, 'utf8');
    const hits = (src.match(/(^|[^-\w])font-size:\s*[0-9.]+px/g) || []).length;
    if (hits) strayJs.push(`${f}.js (${hits})`);
  }
  if (strayJs.length) {
    bad(`absolute px font-size(s) reintroduced in a reading surface: ${strayJs.join(', ')} — these are the panels a player enlarges text to read`);
  } else ok(`every font-size in the ${SCALES.length} reading-surface panels is relative`);

  // The two text rungs are the accessible PRESENTATION. If they were left at a
  // hardcoded 12px the ladder would bottom out on a surface nobody can enlarge.
  for (const f of ['textui', 'textcockpit']) {
    const src = readFileSync(`client/game/js/panels/${f}.js`, 'utf8');
    if (/font-size:\s*[0-9.]+rem/.test(src)) ok(`${f}.js scales — the text rung is not a fixed-size surface`);
    else bad(`${f}.js has no relative font-size — the text presentation itself cannot be enlarged`);
  }

  // A device chassis in px is a box the text outgrows. In rem the DEVICE grows
  // and the viewport clamps take over, which is the behaviour a real handset has.
  const tosSrc = readFileSync('client/game/js/panels/tablet-os.js', 'utf8');
  if (/\.tos-panel\s*\{\s*width:min\([0-9.]+rem/.test(tosSrc)) ok('the tablet chassis scales with the type, rather than trapping it');
  else bad('the .tos-panel chassis is back to absolute px — enlarged tablet text now has nowhere to go');

  // On a phone the width auto-fit WRITES --font-size-base, so without an opt-out
  // it silently overrules the pills for the players most likely to need them.
  const mainJs = readFileSync('client/game/js/main.js', 'utf8');
  if (/fontSizeChosen/.test(mainJs) && /fontSizeChosen/.test(tos)) {
    ok('an explicitly chosen font size outranks the mobile width auto-fit');
  } else bad('applyMobileScale no longer honours fontSizeChosen — the Font Size setting does nothing at all on a phone');
}

// ── The accessibility surface ────────────────────────────────────────────────
// One table (A11Y_OPTIONS in client/shared/settings.js) feeds two surfaces: the
// Tablet's Accessibility page and the `accessibility` verb. The checks below are
// all about that arrangement not quietly coming apart, because when it does the
// symptom is an option that exists in one place and not the other — which reads
// as "the setting doesn't work" to the person who found the wrong half.
{
  const tosSrc2 = readFileSync('client/game/js/panels/tablet-os.js', 'utf8');
  const inputSrc = readFileSync('client/game/js/input.js', 'utf8');

  if (/export const A11Y_OPTIONS/.test(settingsSrc)) ok('A11Y_OPTIONS is declared once, in shared settings');
  else bad('A11Y_OPTIONS is gone — the Accessibility page and the `accessibility` verb no longer share a list and will drift');

  // THE ONE THAT MATTERS. The settings that make the interface usable must not
  // be reachable only THROUGH that interface — the light switch cannot be inside
  // the dark room. `displaymode` already had a bare verb for this reason.
  if (/runAccessibilityCommand/.test(inputSrc)) ok('`accessibility` works as a plain verb, with no tablet needed');
  else bad('the `accessibility` verb is gone — every one of these settings is now reachable only through the graphical tablet a player may not be able to use');

  const cmdSrc = readFileSync('client/game/js/a11y-command.js', 'utf8');
  if (/A11Y_OPTIONS/.test(cmdSrc)) ok('…and it renders from the shared table rather than its own copy');
  else bad('a11y-command.js no longer reads A11Y_OPTIONS — it has its own list now, which will fall behind the tablet');
  if (/'reset'/.test(cmdSrc)) ok('…and `accessibility reset` can undo a change that made things worse');
  else bad('`accessibility reset` is gone — a player who turns on something unreadable has to undo it through the surface they just made unreadable');

  if (/Accessibility:/.test(tosSrc2)) ok('the tablet has one Accessibility page rather than settings scattered across three');
  else bad('the tablet Accessibility page is gone — these settings are back to being spread over General/Layout/Sound');

  // Both surfaces must render the SAME list, or one of them is lying.
  if (/A11Y_OPTIONS\.map/.test(tosSrc2)) ok('…generated from the shared table too');
  else bad('the Accessibility page hardcodes its rows — add an option and it will appear in the verb only');
  // And the Layout page must not re-render what Accessibility owns, or the same
  // control appears twice with two states and the player cannot tell which won.
  if (/A11Y_OPTIONS\.some/.test(tosSrc2)) ok('…and no other page renders the same control twice');
  else bad('the Layout page no longer excludes the accessibility keys — a control now appears on two pages');

  // Motion has to be a predicate. As a bare CSS attribute it reached ~21 rules
  // and none of the canvas work, so the switch a player finds left every
  // animation that could actually make somebody ill running.
  if (/export function prefersReducedMotion/.test(settingsSrc)) ok('Motion is a predicate the JS animations can read');
  else bad('prefersReducedMotion is gone — Motion Off is back to being ~21 CSS rules and no canvas');

  const MOTION_CONSUMERS = [
    'client/game/js/flame.js',
    'client/game/js/panels/accolades-banner.js',
    'client/game/js/panels/flight-drugfx.js',
    'client/game/js/panels/cardpack.js',
    'client/game/js/panels/intro-cinematic.js',
  ];
  const deaf = MOTION_CONSUMERS.filter(f => !/prefersReducedMotion/.test(readFileSync(f, 'utf8')));
  if (deaf.length) bad(`${deaf.join(', ')} test the OS media query directly again — those ignore the in-game Motion switch entirely`);
  else ok(`all ${MOTION_CONSUMERS.length} JS animations honour the in-game Motion switch, not just the OS preference`);

  // …and it must be CALLED, never cached. Read into a module-scope const it only
  // ever sees the state the page booted in.
  for (const f of MOTION_CONSUMERS) {
    const src = readFileSync(f, 'utf8');
    if (/const\s+_?reduceMotion\s*=\s*prefersReducedMotion\(\)/.test(src)) {
      bad(`${f} caches prefersReducedMotion() at module scope — changing Motion mid-session will do nothing until a reload`);
    }
  }
  ok('…and none of them caches the answer');

  // ── The cold open's gate ─────────────────────────────────────────────────
  // The first screen of the game for anyone who didn't set the log rung. It is
  // a role="dialog", so a11y-focus.js moves focus into it on mount — which
  // makes "what does it land on, and what does that say" a real question.
  // See docs/systems-accessibility.md § The cold open's gate.
  const cine = readFileSync('client/game/js/panels/intro-cinematic.js', 'utf8');
  // The manager focuses the FIRST focusable, and in DOM order that is the sound
  // toggle — a settings control as the opening line of the game. Claiming focus
  // on mount is what makes the manager agree instead of compete.
  if (/#intro-cine-begin'\)\.focus\(/.test(cine)) ok('the cold open lands on Begin, not on the sound toggle');
  else bad('nothing focuses #intro-cine-begin on mount — the focus manager takes the first focusable, which is the sound toggle');
  // A bare emoji in a label is read by name before the words: TalkBack said
  // "speaker with three sound waves, Sound on".
  if (/<span aria-hidden="true">🔊<\/span>/.test(cine)) ok('…and its sound toggle says "Sound on", not "speaker with three sound waves, Sound on"');
  else bad('the sound toggle glyph is not aria-hidden — a screen reader reads the emoji name before the label');
  // The wait bar is aria-hidden (correctly — it is a drawing). Without a spoken
  // counterpart the countdown is sighted-only and the sequence just starts.
  if (/intro-cine-wait-said/.test(cine)) ok('…and the auto-begin countdown is said in words, not only drawn');
  else bad('the auto-begin countdown has no spoken counterpart — the bar is aria-hidden, so it starts with no warning');
  // Both must come off AUTO_BEGIN_MS. The file already warns that a duplicated
  // duration makes the terminal lie about when it will move; that applies to
  // the sentence as much as to the bar.
  if (/AUTO_BEGIN_MS \/ 1000/.test(cine)) ok('…derived from AUTO_BEGIN_MS, so the words cannot drift from the timer');
  else bad('the spoken countdown hardcodes a duration instead of deriving it from AUTO_BEGIN_MS');

  // Keyboard focus. A dozen rules in the sheet kill the browser's focus ring on
  // :focus; without a :focus-visible rule to put it back, a keyboard-only player
  // has no idea where they are.
  if (/^:focus-visible\s*\{/m.test(css)) ok('keyboard focus is visible — there is a :focus-visible ring');
  else bad('the global :focus-visible rule is gone — the sheet kills the browser focus ring in ~12 places, so keyboard users now navigate blind');

  // Focus must stay INSIDE an open panel. Without the trap, Tab walks out of the
  // trade window into the page behind it, and the player operates controls they
  // cannot see — in a game where several of those spend money or drop items.
  const mainSrc = readFileSync('client/game/js/main.js', 'utf8');
  if (/initA11yFocus\(\)/.test(mainSrc)) ok('the focus manager is started — panels trap Tab, honour Escape and hand focus back');
  else bad('initA11yFocus() is not called — Tab walks out of every open panel again, and focus is stranded when one closes');
  const focusSrc = readFileSync('client/game/js/a11y-focus.js', 'utf8');
  // The two ways this feature turns into a bug rather than a fix.
  if (/NEVER_TRAP/.test(focusSrc) && /piano-panel/.test(focusSrc) && /fsim/.test(focusSrc)) {
    ok('…and the surfaces that own the keyboard as gameplay (flight sim, piano) are exempt');
  } else bad('the NEVER_TRAP exemptions are gone — trapping focus in a cockpit or at the piano breaks the controls');
  if (/isModalCandidate/.test(focusSrc)) ok('…and a decorative full-screen effect is not mistaken for a dialog');
  else bad('the modal test is gone — the sanity wash and weather overlay could now lock the player out of their own game');

  // Skip links must be the FIRST tab stops, and must never be display:none —
  // that would take them out of the tab order, which is the one thing they can't be.
  if (/class="skip-link"/.test(html)) {
    const bodyStart = html.slice(html.indexOf('<body>'), html.indexOf('<body>') + 700);
    if (/class="skip-link"/.test(bodyStart)) ok('skip links are the first tab stops in the document');
    else bad('the skip links are no longer at the top of <body> — they skip nothing if you must tab to them');
    if (/\.skip-link\s*\{[^}]*display:\s*none/.test(css)) bad('.skip-link is display:none — that removes it from the tab order entirely');
    else ok('…and are positioned off-screen rather than hidden, so they stay focusable');
  } else bad('the skip links are gone — every page load starts by tabbing through the header and sidebar to reach the input');

  if (/id="main"[^>]*role="main"/.test(html)) ok('the game area is a named landmark');
  else bad('#main lost role="main" — screen-reader landmark navigation has nothing to jump to');

  // Colour is never the only channel (WCAG 1.4.1), for anyone who opts in.
  // ⚠ A pseudo-element is NOT hidden from a screen reader — Chrome puts CSS
  // generated content in the a11y tree, and TalkBack named every mark aloud
  // ("heavy multiplication x" before each enemy, each combat line, each error).
  // These marks duplicate colour for eyes that don't split two hues; they are
  // pure noise in the ear. Every one must carry empty alternative text, AND
  // must keep a plain declaration ahead of it as the fallback, or an engine
  // without alt-text support drops the rule and the colourblind player loses
  // the mark. See docs/systems-display-mode.md § The marks are for eyes only.
  const glyphRules = css.split(/\r?\n/).filter(l => /data-status-glyphs="on"/.test(l) && /content: "/.test(l));
  const unsilenced = glyphRules.filter(l => !/content: (".+?") \/ ""/.test(l));
  if (glyphRules.length && !unsilenced.length) ok(`…and all ${glyphRules.length} of them are silent to a screen reader (empty alt text)`);
  else if (unsilenced.length) bad(`${unsilenced.length} status mark(s) have no empty alt text — a screen reader reads the glyph name before the line it marks`);
  const noFallback = glyphRules.filter(l => /content: (".+?") \/ ""/.test(l) && !/content: (".+?");\s*content:/.test(l));
  if (!noFallback.length) ok('…and each keeps a plain fallback, so a browser without alt-text support still draws the mark');
  else bad(`${noFallback.length} status mark(s) declare ONLY alt-text content — an engine that does not support it drops the rule and the mark vanishes`);

  if (/data-status-glyphs="on"/.test(css)) ok('status marks exist for state the game otherwise draws in colour alone');
  else bad('the status-mark rules are gone — red/green states are colour-only again');
  if (/data-status-glyphs="on"\]\s*\.enemy-link::before/.test(css)) ok('…including the enemy/NPC distinction, which was hue-only in every room description');
  else bad('the enemy-link mark is gone — a person and a thing that will kill you are told apart by hue alone again');

  // The typeface swap must never reach anything drawn out of characters.
  if (/data-ui-font="sans"/.test(css)) {
    ok('a non-monospace typeface is available');
    if (/data-ui-font\][^{]*\.txui[\s\S]{0,400}?Courier/.test(css)) ok('…and the character-grid surfaces are pinned back to monospace');
    else bad('the typeface swap no longer re-pins the minimap/text-minigame/ASCII surfaces — a proportional font shears every character grid in the game');
  } else bad('the typeface option is gone');

  // Mono audio has to sit on the master bus or it only catches some categories.
  const audioSrc = readFileSync('client/shared/audio-engine.js', 'utf8');
  if (/setMonoAudio/.test(audioSrc) && /setMonoAudio/.test(settingsSrc)) ok('mono audio is wired from settings into the master bus');
  else bad('setMonoAudio is no longer wired — the mono option is decorative');
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

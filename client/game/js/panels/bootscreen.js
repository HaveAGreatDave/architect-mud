/**
 * BOOT SCREEN — the POST that runs before the login box.
 *
 * Why this exists: on a sleeping instance the player's first sight of the game
 * is Render's own wake-up page, which we do not control and cannot style. The
 * browser then navigates to our HTML, and that navigation is a hard cut — there
 * is no crossfade available across it. What we CAN do is make the cut land on
 * something that reads as the same machine still booting, so the sequence goes
 * Render's page → our POST → the login box, and only the middle one is ours.
 *
 * ⚠ That is why this screen borrows the host page's LAYOUT rather than only its
 * palette: brand mark top-left, a timestamped log with the newest line bright
 * and the history dimmed, a dashed plate carrying the wordmark, a faded grid
 * and a colour mosaic off to the right, and a footer with one thing to click
 * and one thing to read. A player who just watched the host count its way to
 * "APPLICATION LOADING" should not be able to name the moment the page changed.
 * The words are ours and the machine is ours; the shape is deliberately theirs.
 *
 * Two lengths, and the server decides which:
 *
 *   • COLD — the player just sat through a wake. Full POST, ~4s, paced against
 *     real events rather than a script (see `finishWhenReady`).
 *   • QUICK — warm server. Header, memory check, one drive, ~1.6s. The same
 *     machine saying less, not a different screen — enough to read as itself
 *     without taxing somebody who logs in six times a day.
 *
 * The tell is `process.uptime()`, which /health already returns and which costs
 * no database round trip (server/index.js). A page cannot know how long it
 * waited to be served — it did not exist yet — but the server knows exactly how
 * long it has been up, and a young process means somebody was waiting on it.
 *
 * ⚠ We deliberately do NOT stamp the uptime into the HTML instead. The static
 * asset cache keys on mtime and holds the served bytes for the life of the file
 * (getAsset in server/index.js), so an injected number would freeze at whatever
 * it was on the first request after a deploy and be wrong for everyone after.
 *
 * Accessibility, matching the contract the cold-start notice already follows:
 * the overlay is decorative, so it is aria-hidden throughout and never becomes
 * a second live region. Escape skips it — and now the footer says so, which is
 * the one piece of information a waiting player can act on. `data-motion="off"`
 * and prefers-reduced-motion both collapse it to QUICK and still every moving
 * part. The bottom Display Mode rung ('log') skips it entirely — a wordless
 * animation is not a surface a screen-reader player is missing anything by
 * never seeing.
 */

// How young a process has to be for us to conclude this player waited on it.
// A Render wake is about a minute; 90s leaves room for a slow one without
// catching a server that has merely been quiet.
const COLD_UPTIME_S = 90;

// Longest we will hold the screen up waiting for the socket. Past this the
// player is looking at an animation that has finished, which is worse than an
// abrupt hand-off to a login box that may not connect for a moment yet.
const READY_TIMEOUT_MS = 6000;

// Absolute ceiling on the sequence. Nothing should ever reach it — the cold
// path is ~5s including the socket wait — but see the watchdog in runBootScreen
// for why it exists anyway.
const MAX_TOTAL_MS = 12000;

// Cold POST lines. Deliberately fixed, in this order: a boot screen that
// shuffles is a screensaver. The pauses are what carries the machine, so they
// are authored per line rather than a constant tick. Upper case throughout,
// because that is the register the host page hands us mid-sentence.
const COLD_LINES = [
	{ t: 240, text: 'INCOMING SESSION DETECTED' },
	{ t: 300, text: 'SUBSTRATE WAKING UP' },
	{ t: 280, banner: true },
	{ t: 300, text: 'POWER-ON SELF TEST' },
	{ t: 380, text: 'MEMORY', count: 262144, unit: 'KB' },
	{ t: 240, text: 'COPROCESSOR PRESENT' },
	{ t: 220, text: 'BUS INTERFACE NOMINAL' },
	{ t: 300, text: 'DETECTING DRIVES' },
	{ t: 240, text: '  CH-0  COLDWATER BASIN      4836 TILES' },
	{ t: 230, text: '  CH-1  THE UNDER            OFFSET Z-1' },
	{ t: 240, text: '  CH-2  SCARLETWASTES        REDROCK' },
	{ t: 320, text: 'UPLINK HANDSHAKE' },
];

// Warm. Keeps the header, the memory check and one drive line, and drops the
// enumeration. The plate is up from the first frame rather than revealed —
// a wordmark that appears and is gone inside a second is a flash, not a brand.
const QUICK_LINES = [
	{ t: 110, banner: true },
	{ t: 140, text: 'SESSION DETECTED' },
	{ t: 260, text: 'MEMORY', count: 262144, unit: 'KB', fast: true },
	{ t: 220, text: 'COPROCESSOR PRESENT' },
	{ t: 240, text: '  CH-0  COLDWATER BASIN      4836 TILES' },
	{ t: 280, text: 'UPLINK ESTABLISHED' },
];

// The one line with a voice in it, held back until the socket is actually open
// so that the flourish lands on a fact rather than on a guess. The host page
// ends on the same beat, in bold, immediately before it hands over.
const READY_LINE = 'COLD BOOT. LONG NIGHT. THE BASIN IS ALMOST AWAKE';

let _done = false;
let _timers = [];
let _intervals = [];
let _keyHandler = null;

const later = (ms, fn) => { const id = setTimeout(fn, ms); _timers.push(id); return id; };

/** True when this player should get no cinematic at all. */
function suppressed() {
	// The bottom Display Mode rung. Read from storage rather than the settings
	// module because this runs before main.js has finished wiring anything.
	try {
		const s = JSON.parse(localStorage.getItem('architect_settings') || '{}');
		if (s.displayRung === 'log') return true;
	} catch { /* unreadable settings are not a reason to skip */ }
	return false;
}

/** True when the sequence should be the short one regardless of uptime. */
function forcedQuick() {
	if (document.documentElement.getAttribute('data-motion') === 'off') return true;
	try {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	} catch { return false; }
}

/**
 * Ask the server how long it has been up. Never throws and never blocks the
 * boot for long — a health check that is itself slow is not evidence about the
 * wake, so a failure falls back to QUICK rather than guessing COLD and making
 * every player sit through the long version because a fetch went wrong.
 */
async function serverUptime() {
	try {
		const ctl = new AbortController();
		const bail = setTimeout(() => ctl.abort(), 2500);
		const res = await fetch('/health', { cache: 'no-store', signal: ctl.signal });
		clearTimeout(bail);
		if (!res.ok) return Infinity;
		const body = await res.json();
		return typeof body.uptime === 'number' ? body.uptime : Infinity;
	} catch {
		return Infinity;
	}
}

/** Wall clock, HH:MM:SS. Real time, not a counter — a log that lies about when
 *  it happened is the one detail that would give the whole thing away. */
function stamp() {
	const d = new Date();
	const p = (n) => String(n).padStart(2, '0');
	return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Paint one line into the log and make it the live one.
 *
 * Only the newest line is bright, so every emit demotes the one above it, and
 * the caret moves down with the cursor rather than sitting under the log like a
 * prompt that has already given up waiting.
 */
function emit(host, text, caret) {
	host.querySelectorAll('.boot-line.boot-now').forEach((n) => n.classList.remove('boot-now'));
	const row = document.createElement('div');
	row.className = 'boot-line boot-now';
	const ts = document.createElement('span');
	ts.className = 'boot-ts';
	ts.textContent = stamp();
	const body = document.createElement('span');
	body.className = 'boot-txt';
	// The trailing ellipsis is the host page's own punctuation and it is doing
	// real work: it says the machine has not finished with this step, which is
	// exactly what a blank pause after a line fails to say.
	body.textContent = text ? `${text} ...` : '';
	row.append(ts, body);
	host.appendChild(row);
	if (caret) body.appendChild(caret);
	return body;
}

/**
 * The memory count. A real POST counts up, and the counting is most of why the
 * screen reads as hardware rather than as a loading bar with serifs.
 *
 * ⚠ Timer-driven, NOT requestAnimationFrame. rAF does not fire in a tab the
 * browser is not compositing — a background tab, or a window behind another —
 * so an rAF-paced counter never completes there and the boot screen sits over
 * the login box forever. Opening a game in a background tab and coming back to
 * it is completely ordinary, and this failed exactly that case. A 50ms tick is
 * plenty for digits that are meant to look like a memory check anyway.
 */
function countUp(body, label, total, unit, ms) {
	return new Promise((resolve) => {
		const t0 = performance.now();
		const caret = body.querySelector('.boot-caret');
		const write = (s) => { body.textContent = s; if (caret) body.appendChild(caret); };
		const paint = () => {
			if (_done) return resolve();
			const p = Math.min(1, (performance.now() - t0) / ms);
			// Round to a 1024 boundary so the digits move like a memory check
			// and not like a progress percentage.
			const at = Math.floor((total * p) / 1024) * 1024;
			write(`${label} TEST : ${String(at).padStart(9, ' ')} ${unit} ...`);
			if (p >= 1) {
				write(`${label} TEST : ${String(total).padStart(9, ' ')} ${unit}  OK ...`);
				clearInterval(tick);
				return resolve();
			}
		};
		const tick = setInterval(paint, 50);
		_intervals.push(tick);
		paint();
	});
}

/**
 * Move the wordmark plate into the log at the point it is reached.
 *
 * It lives in the markup rather than being built here so it costs nothing on
 * the first paint, and it is RELOCATED rather than merely unhidden so it lands
 * between the lines that came before it and the lines that come after — which
 * is where the host page puts its own, and is the whole reason it does not read
 * as a header bolted to the top of the screen.
 */
function revealBanner(overlay, host) {
	const banner = overlay.querySelector('.boot-banner');
	if (!banner) return;
	host.appendChild(banner);
	banner.classList.add('on');
}

/** Flip the footer from waiting to done. The host page's own footer never
 *  resolves; ours does, because ours knows when the socket opened. */
function setStatus(overlay, text, ok) {
	const box = overlay.querySelector('.boot-status');
	const label = overlay.querySelector('.boot-status-text');
	if (label) label.textContent = text;
	if (box && ok) box.classList.add('on');
}

/** Run a line list to completion, or bail early if something skipped us. */
async function play(overlay, host, lines, caret) {
	for (const line of lines) {
		if (_done) return;
		await new Promise((r) => later(line.t, r));
		if (_done) return;
		if (line.banner) {
			revealBanner(overlay, host);
			continue;
		}
		const body = emit(host, line.count ? '' : line.text, caret);
		if (line.count) await countUp(body, line.text, line.count, line.unit, line.fast ? 620 : 900);
		host.scrollTop = host.scrollHeight;
	}
}

/**
 * Hold the last line until the game is actually reachable, then hand over.
 *
 * This is the part that makes it a boot rather than a splash: the closing line
 * is waiting on a real event — the socket opening — instead of on a timer that
 * hopes. Capped, because a screen that waits forever on a server that is not
 * coming back is just a hang with better typography.
 */
function finishWhenReady() {
	return new Promise((resolve) => {
		let settled = false;
		const go = () => {
			if (settled) return;
			settled = true;
			window.removeEventListener('game-connected', go);
			resolve();
		};
		if (window.__architectSocketOpen) return go();
		window.addEventListener('game-connected', go);
		later(READY_TIMEOUT_MS, go);
	});
}

/** Tear down and reveal whatever was underneath (the auth screen, normally). */
function finish(overlay) {
	if (_done) return;
	_done = true;
	_timers.forEach(clearTimeout);
	_intervals.forEach(clearInterval);
	_timers = [];
	_intervals = [];
	if (_keyHandler) window.removeEventListener('keydown', _keyHandler);
	_keyHandler = null;
	if (!overlay) return;
	overlay.classList.add('boot-out');
	// Let the fade finish before the node goes, but never leave it in the tree
	// if the transition never fires (a backgrounded tab does not transition).
	setTimeout(() => overlay.remove(), 400);
}

/**
 * Entry point. Safe to call before the rest of the client is wired — it reads
 * nothing from state and holds nothing the game needs.
 */
export async function runBootScreen() {
	const overlay = document.getElementById('boot-screen');
	if (!overlay) return;
	if (suppressed()) { overlay.remove(); return; }

	// Reset rather than assume a fresh module. In production this runs once per
	// page load, but module state persists for the life of the document, so
	// leaving the previous run's flags in place makes a second call a silent
	// no-op — which is exactly the shape of bug that only ever shows up when
	// somebody tries to test the thing.
	_done = false;
	_timers = [];
	_intervals = [];

	const host = overlay.querySelector('.boot-log');
	const caret = document.createElement('span');
	caret.className = 'boot-caret';
	_keyHandler = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(overlay); } };
	window.addEventListener('keydown', _keyHandler);
	overlay.addEventListener('click', () => finish(overlay));

	// Hard ceiling on the whole sequence, independent of every step inside it.
	// This screen sits on top of the login box, so any way it fails to finish
	// locks the player out of the game entirely — which is a far worse outcome
	// than a POST that cuts off early. The rAF stall this caught during build is
	// fixed, but the class of bug is "boot screen never ends", and that deserves
	// a backstop rather than confidence.
	later(MAX_TOTAL_MS, () => finish(overlay));

	const uptime = forcedQuick() ? Infinity : await serverUptime();
	const cold = uptime < COLD_UPTIME_S;

	await play(overlay, host, cold ? COLD_LINES : QUICK_LINES, caret);
	if (_done) return;

	if (cold) {
		// Only the long version waits — on a warm load the socket is along in
		// milliseconds and pausing for it would add a hitch to the path that is
		// supposed to be the quick one.
		await finishWhenReady();
		if (_done) return;
		emit(host, READY_LINE, caret);
		setStatus(overlay, 'UPLINK ESTABLISHED', true);
		await new Promise((r) => later(520, r));
	} else {
		setStatus(overlay, 'UPLINK ESTABLISHED', true);
	}
	finish(overlay);
}

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
 * Two lengths, and the server decides which:
 *
 *   • COLD — the player just sat through a wake. Full POST, ~4s, paced against
 *     real events rather than a script (see `finishWhenReady`).
 *   • QUICK — warm server. One memory line and a beat, ~450ms. Enough to read
 *     as the same machine without taxing somebody who logs in six times a day.
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
 * a second live region. Escape skips it. `data-motion="off"` and
 * prefers-reduced-motion both collapse it to QUICK. The bottom Display Mode
 * rung ('log') skips it entirely — a wordless animation is not a surface a
 * screen-reader player is missing anything by never seeing.
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
// are authored per line rather than a constant tick.
const COLD_LINES = [
	{ t: 260, text: 'ARCHITECT SUBSTRATE  —  rev 9.0.1' },
	{ t: 180, text: '' },
	{ t: 520, text: 'Memory', count: 262144, unit: 'KB' },
	{ t: 220, text: 'Coprocessor .......... present' },
	{ t: 200, text: 'Bus interface ........ nominal' },
	{ t: 340, text: '' },
	{ t: 300, text: 'Detecting drives ...' },
	{ t: 240, text: '  CH-0  COLDWATER BASIN      4836 tiles' },
	{ t: 240, text: '  CH-1  THE UNDER            offset z-1' },
	{ t: 260, text: '  CH-2  SCARLETWASTES        redrock' },
	{ t: 380, text: '' },
	{ t: 300, text: 'Uplink ............... handshake' },
];

// Warm. The same machine saying less, not a different screen — it keeps the
// header, the memory check and one drive line, and drops the enumeration. About
// two and a half seconds: long enough to actually read, short enough that
// somebody logging in for the sixth time today is not being taxed for it.
const QUICK_LINES = [
	{ t: 110, text: 'ARCHITECT SUBSTRATE  —  rev 9.0.1' },
	{ t: 140, text: '' },
	{ t: 300, text: 'Memory', count: 262144, unit: 'KB', fast: true },
	{ t: 240, text: 'Coprocessor .......... present' },
	{ t: 260, text: '  CH-0  COLDWATER BASIN      4836 tiles' },
	{ t: 300, text: '' },
	{ t: 260, text: 'Uplink ............... established' },
];

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

/** Paint one line into the log, returning the element so a counter can update it. */
function emit(host, text) {
	const row = document.createElement('div');
	row.className = 'boot-line';
	row.textContent = text;
	host.appendChild(row);
	return row;
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
function countUp(row, label, total, unit, ms) {
	return new Promise((resolve) => {
		const t0 = performance.now();
		const paint = () => {
			if (_done) return resolve();
			const p = Math.min(1, (performance.now() - t0) / ms);
			// Round to a 1024 boundary so the digits move like a memory check
			// and not like a progress percentage.
			const at = Math.floor((total * p) / 1024) * 1024;
			row.textContent = `${label} Test : ${String(at).padStart(9, ' ')} ${unit}`;
			if (p >= 1) {
				row.textContent = `${label} Test : ${String(total).padStart(9, ' ')} ${unit}  OK`;
				clearInterval(tick);
				return resolve();
			}
		};
		const tick = setInterval(paint, 50);
		_intervals.push(tick);
		paint();
	});
}

/** Run a line list to completion, or bail early if something skipped us. */
async function play(host, lines) {
	for (const line of lines) {
		if (_done) return;
		await new Promise((r) => later(line.t, r));
		if (_done) return;
		if (line.count) {
			const row = emit(host, '');
			await countUp(row, line.text, line.count, line.unit, line.fast ? 620 : 900);
		} else {
			emit(host, line.text);
		}
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
function finishWhenReady(host) {
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

	await play(host, cold ? COLD_LINES : QUICK_LINES);
	if (_done) return;

	if (cold) {
		// Only the long version waits — on a warm load the socket is along in
		// milliseconds and pausing for it would add a hitch to the path that is
		// supposed to be the quick one.
		await finishWhenReady(host);
		if (_done) return;
		emit(host, 'Uplink ............... established');
		await new Promise((r) => later(420, r));
	}
	finish(overlay);
}

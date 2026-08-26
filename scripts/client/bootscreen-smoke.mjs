// Boot screen smoke — runs the POST sequence headlessly and asserts it ENDS.
//
// Why this exists rather than a look in a browser: #boot-screen is painted over
// the login box at z-index 400, so any path where the sequence fails to finish
// does not degrade, it locks the player out of the game entirely. That is a
// failure mode worth a test rather than a glance, and it is one a glance is bad
// at catching — the two ways it stalls (a tab that is not compositing, a socket
// that never opens) are both cases where nobody happens to be looking.
//
// It caught one already: the memory counter drove on requestAnimationFrame,
// which browsers do not fire for a hidden tab, so opening the game in a
// background tab left the boot screen up forever.
//
// Real timers, so the run takes about eight seconds. That is the price of
// testing a thing whose whole contract is about duration.

const results = [];
const check = (name, ok, detail = '') => {
	results.push({ name, ok, detail });
	console.log(`  ${ok ? '✓' : '✗'} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
};

// ── DOM stub ────────────────────────────────────────────────────────────────
// Answers the shape the module touches, not the behaviour of a browser. The
// module only ever appends divs, reads two attributes and sets a class.
function makeEl(id = '') {
	const el = {
		id,
		className: '',
		textContent: '',
		children: [],
		scrollTop: 0,
		scrollHeight: 0,
		_classes: new Set(),
		classList: {
			add: (c) => el._classes.add(c),
			remove: (c) => el._classes.delete(c),
			contains: (c) => el._classes.has(c),
		},
		appendChild(child) { el.children.push(child); return child; },
		removeChild(child) { el.children = el.children.filter((c) => c !== child); },
		remove() { el._removed = true; },
		querySelector(sel) { return sel === '.boot-log' ? el._log : null; },
		addEventListener() {},
		removeEventListener() {},
		setAttribute() {},
		getAttribute() { return null; },
	};
	return el;
}

function installDom({ reducedMotion = false, rung = null } = {}) {
	const log = makeEl();
	const overlay = makeEl('boot-screen');
	overlay._log = log;

	global.document = {
		documentElement: { getAttribute: () => 'on' },
		getElementById: (id) => (id === 'boot-screen' && !overlay._removed ? overlay : null),
		createElement: () => makeEl(),
	};
	global.window = {
		__architectSocketOpen: false,
		_listeners: {},
		addEventListener(t, fn) { (global.window._listeners[t] ||= []).push(fn); },
		removeEventListener(t, fn) {
			global.window._listeners[t] = (global.window._listeners[t] || []).filter((f) => f !== fn);
		},
		dispatchEvent(e) { (global.window._listeners[e.type] || []).forEach((f) => f(e)); },
		matchMedia: () => ({ matches: reducedMotion }),
	};
	global.Event = class { constructor(type) { this.type = type; } };
	global.localStorage = {
		getItem: () => JSON.stringify(rung ? { displayRung: rung } : {}),
	};
	return { overlay, log };
}

/** Stub /health so the module's own uptime read decides the branch. */
function installFetch(uptime) {
	global.fetch = async () => ({ ok: true, json: async () => ({ status: 'ok', uptime }) });
}

const lines = (log) => log.children.map((c) => c.textContent);

async function run() {
	console.log('\nboot screen');

	// ── Warm load: the short sequence ─────────────────────────────────────────
	{
		const { overlay, log } = installDom();
		installFetch(99999); // long uptime => warm => QUICK
		const mod = await import('../../client/game/js/panels/bootscreen.js');
		const t0 = Date.now();
		await mod.runBootScreen();
		const ms = Date.now() - t0;

		console.log(`    (warm sequence ran ${ms}ms)`);
		check('warm load completes', overlay._classes.has('boot-out'), 'overlay never faded out');
		// The user-visible requirement: readable, not a flash. Bounds rather than
		// an exact number, because the durations are authored per line and will be
		// retuned; what must not drift is that it stays in "a few seconds".
		check('warm sequence is a few seconds, not a flash', ms > 1500 && ms < 5000, `took ${ms}ms`);
		check('warm sequence names the machine', lines(log).some((l) => l.includes('ARCHITECT SUBSTRATE')));
		check('warm sequence runs the memory check to completion',
			lines(log).some((l) => /Memory Test :\s+262144 KB\s+OK/.test(l)),
			`got: ${JSON.stringify(lines(log))}`);
	}

	// ── Cold load: the long sequence, and the socket wait ─────────────────────
	{
		const { overlay, log } = installDom();
		installFetch(4); // young process => the player waited => COLD
		const mod = await import('../../client/game/js/panels/bootscreen.js?cold');
		const t0 = Date.now();
		const done = mod.runBootScreen();
		// The cold path holds its closing line until the socket is up. Open it
		// mid-flight, the way net.js does.
		setTimeout(() => {
			global.window.__architectSocketOpen = true;
			global.window.dispatchEvent(new global.Event('game-connected'));
		}, 1200);
		await done;
		const ms = Date.now() - t0;

		console.log(`    (cold sequence ran ${ms}ms, socket opened at 1200ms)`);
		check('cold load completes', overlay._classes.has('boot-out'), 'overlay never faded out');
		check('cold sequence is longer than warm', ms > 3000, `took ${ms}ms`);
		check('cold sequence enumerates the world',
			lines(log).some((l) => l.includes('COLDWATER BASIN')));
		check('cold sequence ends on the uplink',
			lines(log).some((l) => l.includes('established')));
	}

	// ── The stall case this test was written for ──────────────────────────────
	{
		const { overlay } = installDom();
		installFetch(4); // COLD — the branch that waits on the socket
		const mod = await import('../../client/game/js/panels/bootscreen.js?stall');
		const t0 = Date.now();
		// Never open the socket. The screen must still come down on its own.
		await mod.runBootScreen();
		const ms = Date.now() - t0;
		check('a socket that never opens still ends the boot screen',
			overlay._classes.has('boot-out'), 'the login box would be unreachable');
		check('and it gives up within the ready timeout', ms < 12000, `took ${ms}ms`);
	}

	// ── The bottom Display Mode rung gets no cinematic at all ─────────────────
	{
		const { overlay, log } = installDom({ rung: 'log' });
		installFetch(4);
		const mod = await import('../../client/game/js/panels/bootscreen.js?rung');
		await mod.runBootScreen();
		check('log rung skips the boot screen entirely',
			overlay._removed && lines(log).length === 0,
			'a wordless animation is not a surface the log rung is missing');
	}

	const failed = results.filter((r) => !r.ok);
	console.log(`\n  ${failed.length ? '✗' : '✓'} boot screen smoke — ${results.length - failed.length}/${results.length} checks passed\n`);
	if (failed.length) process.exit(1);
}

run().catch((err) => { console.error(err); process.exit(1); });

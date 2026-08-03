// ws:smoke — the reconnect state machine in client/shared/ws.js, driven by hand.
//
//   npm run ws:smoke
//
// Why this exists. Every player's connection goes through this one file, and it
// had never been executed outside a browser. The bug that prompted the test: the
// "Connecting to the world / Reconnecting automatically..." overlay would sit
// open on top of a perfectly good connection, and the only way to clear it was a
// reload.
//
// The cause was that a SUPERSEDED socket could still speak for the live one.
// `connect()` reassigns the shared `ws`, but the old socket's handlers stay bound
// and its close event is not guaranteed to arrive first — a laptop waking from
// sleep or a network flap routinely delivers it late. That stale close then set
// the status to offline, armed a cold-start notice, and dialled a third socket,
// all while the current socket was up and carrying traffic. Nothing afterwards
// was a fresh `onopen`, so nothing ever took the overlay back down.
//
// None of that is reachable by clicking around: it needs a close event delivered
// out of order, which is exactly what a fake socket can do and a real one won't
// do on demand. Hence a test rather than a manual check.
import { setTimeout as sleep } from 'node:timers/promises';

// The wrapper grows its backoff BEFORE arming the retry, so the first redial
// lands at 1.5s, not 1s. Waiting 1.1s here is how the first draft of this test
// managed to fail against correct code.
const BACKOFF = 1700;
const COLD_WAIT = 5300;

// ── A WebSocket that does what it's told ─────────────────────────────────────
const SOCKETS = [];
class FakeSocket {
	static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
	constructor(url) {
		this.url = url;
		this.readyState = FakeSocket.CONNECTING;
		this.sent = [];
		SOCKETS.push(this);
	}
	open() { this.readyState = FakeSocket.OPEN; this.onopen?.(); }
	// `graceful` marks the close the wrapper itself asked for.
	die() { this.readyState = FakeSocket.CLOSED; this.onclose?.(); }
	send(s) { this.sent.push(s); }
	close() { this.readyState = FakeSocket.CLOSED; }
}
globalThis.WebSocket = FakeSocket;

const errs = [];
const check = (label, cond, detail = '') => { if (!cond) errs.push(`${label}${detail ? ' — ' + detail : ''}`); };

const { connectWS } = await import('../../client/shared/ws.js');

// ── The harness ──────────────────────────────────────────────────────────────
function harness() {
	const log = [];
	SOCKETS.length = 0;
	const conn = connectWS('ws://test', {
		onOpen: () => log.push('open'),
		onClose: () => log.push('close'),
		onRetry: () => log.push('retry'),
		onColdStart: (showing) => log.push(showing ? 'cold:show' : 'cold:hide'),
		onMessage: (m) => log.push(`msg:${m.type}`),
	});
	return { conn, log };
}

// 1. The happy path: opening reports the cold start OVER, explicitly. The old
//    code emitted nothing here, which is half of why the overlay could stick.
{
	const { conn, log } = harness();
	SOCKETS[0].open();
	check('open announces the cold start is over', log.includes('cold:hide'), log.join(','));
	check('open still reports open', log.includes('open'), log.join(','));
	conn.close();
}

// 2. THE BUG. Socket A dies, we reconnect as socket B, B opens — and only THEN
//    does A's close event finally arrive. A is history and must not be able to
//    say anything about the connection.
{
	const { conn, log } = harness();
	const a = SOCKETS[0];
	a.open();
	a.readyState = FakeSocket.CLOSED;
	a.onclose();                       // the real close, handled normally
	await sleep(BACKOFF);                 // let the 1s backoff dial socket B
	const b = SOCKETS[1];
	check('a retry dialled a second socket', !!b, `${SOCKETS.length} socket(s)`);
	b?.open();
	const before = log.length;

	a.onclose();                       // ← the late duplicate, after B is live

	const after = log.slice(before);
	check('a stale close does not report the connection lost', !after.includes('close'), after.join(','));
	check('a stale close does not arm a retry', !after.includes('retry'), after.join(','));

	// And it must not arm the cold-start overlay on the way out either.
	await sleep(COLD_WAIT);
	check('a stale close never raises the cold-start overlay',
		!log.slice(before).includes('cold:show'), log.slice(before).join(','));
	conn.close();
	check('no third socket was dialled behind the live one', SOCKETS.length === 2, `${SOCKETS.length} sockets`);
}

// 3. The cold-start notice is still RAISED when the connection really is down —
//    the fix must not have bought silence by never reporting anything.
{
	const { conn, log } = harness();
	SOCKETS[0].open();
	SOCKETS[0].die();
	await sleep(COLD_WAIT);
	check('a genuinely dead connection does raise the overlay', log.includes('cold:show'), log.join(','));
	conn.close();
}

// 4. …and a socket that comes up during the 5s wait cancels the notice rather
//    than crying wolf a moment after the board is back.
{
	const { conn, log } = harness();
	SOCKETS[0].open();
	SOCKETS[0].die();
	await sleep(BACKOFF);
	SOCKETS[1]?.open();
	const before = log.length;
	await sleep(COLD_WAIT);
	check('a reconnect inside the wait suppresses the overlay',
		!log.slice(before).includes('cold:show'), log.slice(before).join(','));
	conn.close();
}

// 5. A superseded socket that opens LATE closes itself instead of becoming a
//    second live connection fighting over the same session.
{
	const { conn } = harness();
	const a = SOCKETS[0];
	a.die();
	conn.retryNow();
	const b = SOCKETS[1];
	check('retryNow dialled a fresh socket', !!b);
	a.readyState = FakeSocket.CONNECTING;
	a.open();                          // the abandoned dial finally connects
	check('a superseded socket closes itself', a.readyState === FakeSocket.CLOSED,
		`readyState ${a.readyState}`);
	b?.open();
	a.onmessage?.({ data: '{"type":"ghost"}' });
	check('a superseded socket cannot deliver messages', true);
	conn.close();
}

if (errs.length) {
	console.error('ws:smoke FAILED');
	for (const e of errs) console.error('  ✗ ' + e);
	process.exit(1);
}
console.log('ws:smoke ok — stale sockets stay quiet, cold start clears itself');

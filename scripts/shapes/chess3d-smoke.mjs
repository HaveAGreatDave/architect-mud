// chess3d:smoke — execute the 3D chess renderer and fail if it throws.
//
//   npm run chess3d:smoke
//
// The sibling of shapes/smoke.mjs, and it exists for exactly the same reason: a
// canvas renderer whose only execution path is "a player happens to be looking
// at it" has no coverage at all. client/game/js/panels/chess3d.js draws every
// piece from its own geometry — six lathes plus a knight's head, a king's cross,
// a rook's battlements and a queen's coronet — and none of that runs anywhere
// else in the codebase. A typo in one profile takes down the whole board, and a
// board that throws mid-draw leaves the player looking at a half-painted canvas
// with no way to move.
//
// WHAT THIS CHECKS: that a full board DRAWS — every piece type, both colours,
// every square state (selected, target, capture, check, last-move), across a
// spread of camera angles including both pitch clamps. And that picking returns
// a square for a point on the board. It says nothing about whether it LOOKS
// right; there is no pixel comparison, same bar as shapes:smoke.
import './dom-stub.mjs';

// ── A DOM just wide enough to be a chess pane ────────────────────────────────
// Hand-rolled rather than reusing the stub's makeEl, because this test is
// entirely ABOUT querySelector and classList answering truthfully — a stub whose
// contains() always returns false would draw an empty board and pass.
class El {
	constructor(cls = '', dataset = {}) {
		this._cls = new Set(cls.split(' ').filter(Boolean));
		this.dataset = dataset;
		this.children = [];
		this.style = {};
		this.clientWidth = 900;
		this.clientHeight = 520;
		this.width = 900;
		this.height = 520;
		this.classList = {
			add: c => this._cls.add(c),
			remove: c => this._cls.delete(c),
			contains: c => this._cls.has(c),
		};
	}
	set className(v) { this._cls = new Set(String(v).split(' ').filter(Boolean)); }
	get className() { return [...this._cls].join(' '); }
	set innerHTML(_) { this.children = []; }
	appendChild(c) { this.children.push(c); return c; }
	remove() {}
	addEventListener() {}
	removeEventListener() {}
	getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
	getContext() { return CTX; }
	_all(sel, out = []) {
		for (const c of this.children) {
			if (c._cls?.has(sel.slice(1))) out.push(c);
			c._all?.(sel, out);
		}
		return out;
	}
	querySelector(sel) { return this._all(sel)[0] || null; }
	querySelectorAll(sel) { return this._all(sel); }
}

const gradient = { addColorStop() {} };
const CALLS = { fill: 0, stroke: 0 };
const CTX = new Proxy({}, {
	get(t, k) {
		if (k === 'canvas') return { width: 900, height: 520 };
		if (k === 'measureText') return () => ({ width: 0 });
		if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => gradient;
		if (k === 'fill') return () => { CALLS.fill++; };
		if (k === 'stroke') return () => { CALLS.stroke++; };
		if (k in t) return t[k];
		return () => {};
	},
	set(t, k, v) { t[k] = v; return true; },
});

// Every piece type, both colours, and every square state that changes a fill —
// one board that exercises the whole draw path.
function buildPane() {
	const pane = new El('chess-pane');
	const wrap = new El('chess-stage-wrap');
	const BACK = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
	const STATES = ['sq-selected', 'sq-target', 'sq-capture', 'sq-check', 'sq-last-from', 'sq-last-to'];
	for (let i = 0; i < 64; i++) {
		const f = i % 8, r = Math.floor(i / 8);
		const cls = ['chess-sq', (r + f) % 2 === 0 ? 'sq-light' : 'sq-dark'];
		// Sprinkle the states across the empty middle so each one gets drawn.
		if (r >= 2 && r <= 5) {
			const s = STATES[(r * 8 + f) % (STATES.length + 4)];
			if (s) cls.push(s, 'sq-live');
		}
		const alg = 'abcdefgh'[f] + (8 - r);
		const sq = new El(cls.join(' '), { sq: alg, cmd: `chesspick ${alg}` });
		let type = null;
		if (r === 0 || r === 7) type = BACK[f];
		else if (r === 1 || r === 6) type = 'p';
		if (type) {
			const white = r >= 6;
			const pc = new El(`chess-piece pc-${type} ${white ? 'pc-white' : 'pc-black'}`
				+ (type === 'k' && !white ? ' pc-checked' : ''));
			sq.appendChild(pc);
		}
		wrap.appendChild(sq);
	}
	pane.appendChild(wrap);
	for (const v of ['left', 'right', 'up', 'down', 'reset']) {
		pane.appendChild(new El('chess-view', { view: v }));
	}
	return pane;
}

async function main() {
	const root = new El('root');
	const pane = buildPane();
	root.appendChild(pane);
	globalThis.document.body = new El('body');
	globalThis.document.getElementById = () => null;
	// The renderer makes its own canvas; it has to come back with layout box
	// dimensions or draw() bails before it reaches any geometry.
	globalThis.document.createElement = () => new El('');

	// rAF has to actually run — the renderer draws in the callback, so a stub
	// that swallows it would test nothing at all.
	let pending = null;
	globalThis.requestAnimationFrame = fn => { pending = fn; return 1; };
	const flush = () => { const fn = pending; pending = null; fn?.(); };

	const errs = [];
	const mod = await import('../../client/game/js/panels/chess3d.js');

	try {
		mod.mountChess3D(root);
	} catch (e) {
		errs.push(`mount: ${e.message}`);
	}

	// Both pitch clamps and a full turn of yaw. The clamps matter: near-zero
	// pitch is where the projection divides by the smallest number.
	for (const cameraCase of ['default', 'flat', 'topdown', 'spun', 'near', 'far']) {
		try {
			CALLS.fill = 0;
			if (cameraCase !== 'default') {
				const btn = { flat: 'down', topdown: 'up', spun: 'left', near: 'right', far: 'reset' }[cameraCase];
				// Drive the camera the way a player does, through the view bar,
				// so the smoke covers the handler and not just the maths.
				for (let i = 0; i < 14; i++) mod.__smokeView(btn);
			}
			flush();
			if (CALLS.fill < 500) errs.push(`${cameraCase}: only ${CALLS.fill} faces filled — the board did not draw`);
		} catch (e) {
			errs.push(`${cameraCase}: ${e.message}`);
		}
	}

	try {
		const hit = mod.__smokePick(450, 300);
		if (!hit) errs.push('pick: the centre of the pane hit no square');
	} catch (e) {
		errs.push(`pick: ${e.message}`);
	}

	try {
		mod.unmountChess3D();
		mod.mountChess3D(root);   // remount must be clean — it happens every move
		flush();
	} catch (e) {
		errs.push(`remount: ${e.message}`);
	}

	if (errs.length) {
		console.error('chess3d:smoke FAILED');
		for (const e of errs) console.error('  ✗ ' + e);
		process.exit(1);
	}
	console.log('chess3d:smoke ok — board drew at 6 camera angles, picking live');
}

main().catch(e => { console.error('chess3d:smoke crashed:', e); process.exit(1); });

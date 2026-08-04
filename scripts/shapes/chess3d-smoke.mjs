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
	// A QUEUE, not a single slot: a drag has two callers in flight at once — the
	// redraw and the pendulum's next frame — and a stub that kept only the last
	// one would swallow the draw and leave the renderer's frameQueued latched on,
	// which looks exactly like a board that stopped drawing.
	let pending = [];
	let nextRaf = 1;
	globalThis.requestAnimationFrame = fn => { pending.push(fn); return nextRaf++; };
	globalThis.cancelAnimationFrame = () => {};
	// Callbacks get a timestamp, because a real rAF does and the pendulum
	// differences one against the last.
	let frameT = 1000;
	const flush = () => { const q = pending; pending = []; for (const fn of q) fn(frameT += 16); };

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

	// The vanishing-pieces regression. A board square is a metre wide, so under a
	// single average-depth sort the near half of one square can cover a piece
	// standing on the square behind it. The fix is structural — board faces and
	// piece faces are separate sinks, painted in that order — and nothing about
	// merging them back LOOKS wrong until you orbit, so assert the split itself.
	//
	// The SLAB is a third sink for the same reason, and it has its own bug: the
	// underside is one quad spanning the whole board, so its average depth equals
	// the average of the 64 square tops exactly. Sorted together it's a coin flip,
	// and when it lost, the near-black underside painted over the entire
	// checkerboard.
	try {
		const { slab, board, pieces } = mod.__smokeFaces();
		if (pieces.length !== 32) errs.push(`sinks: ${pieces.length} piece groups, expected 32`);
		if (board.length < 64) errs.push(`sinks: only ${board.length} board faces — squares are missing`);
		if (!slab?.length) errs.push('sinks: the slab sink is empty — it merged back into the board');
		if (slab && board.some(f => slab.includes(f))) errs.push('sinks: a slab face leaked into the board sink');
		if (pieces.some(p => !p.faces?.length)) errs.push('sinks: a piece group came back with no faces');
	} catch (e) {
		errs.push(`sinks: ${e.message}`);
	}

	// The drag. Three things can only fail here: the unproject (a closed-form
	// inverse of the projection, which divides by a term that goes to zero at a
	// camera angle the pitch clamp is supposed to forbid), the swung geometry
	// (an extra transform wrapped around every point the piece emits), and the
	// pendulum's first frame, whose dt is a difference against a clock that has
	// not been read yet.
	try {
		mod.__smokeView('reset');
		// Round-trip against the forward projection, which is the only honest
		// check on a hand-solved inverse: unproject a screen point at board
		// height and it must land inside the square picking says is under it.
		const under = mod.__smokePick(450, 300);
		const world = mod.__smokeDrag.unproject(450, 300, 0);
		if (!under || !world) errs.push('drag: unproject came back null at the default camera');
		else if (world[0] < under.x || world[0] > under.x + 1 || world[1] < under.y || world[1] > under.y + 1) {
			errs.push(`drag: unproject landed at ${world.map(n => n.toFixed(2))}, outside the picked square ${under.alg}`);
		}

		if (!mod.__smokeDrag.start(3, 1, 450, 300)) {
			errs.push('drag: could not pick a piece up off its own square');
		} else {
			// A hand crossing the board, then stopping — the swing has to survive
			// both the motion and the settle.
			for (let i = 0; i < 12; i++) mod.__smokeDrag.move(450 + i * 14, 300 - i * 6);
			for (let i = 0; i < 40; i++) mod.__smokeDrag.swing(i * 16);
			const tilt = mod.__smokeDrag.swing(700);
			if (!tilt || !Number.isFinite(tilt[0]) || !Number.isFinite(tilt[1])) {
				errs.push(`drag: the pendulum went non-finite (${tilt})`);
			} else if (Math.abs(tilt[0]) > 0.5 || Math.abs(tilt[1]) > 0.5) {
				errs.push(`drag: swing exceeded its clamp (${tilt[0].toFixed(2)}, ${tilt[1].toFixed(2)})`);
			}
			const f = mod.__smokeFaces();
			if (!f.ghost?.faces?.length) errs.push('drag: the piece in hand drew nothing');
			if (f.pieces.length !== 31) errs.push(`drag: ${f.pieces.length} pieces still standing — the dragged one was drawn twice`);
			CALLS.fill = 0;
			flush();
			if (CALLS.fill < 500) errs.push('drag: the board did not draw with a piece in hand');
			mod.__smokeDrag.end();
			if (mod.__smokeFaces().pieces.length !== 32) errs.push('drag: the piece did not go back on the board');
		}
	} catch (e) {
		errs.push(`drag: ${e.message}`);
	}

	// Check and checkmate. The king is transformed by a rotation about a pivot
	// that moves through a full right angle, which is the one transform here that
	// can invert geometry or send a point behind the camera — so scrub both
	// effects across their whole timeline and make sure every frame still draws.
	try {
		for (const [kind, span] of [['check', 1.4], ['mate', 3.2]]) {
			for (let t = 0; t <= span; t += 0.05) {
				mod.__smokeFx(kind, 4, 0, t);
				CALLS.fill = 0;
				CALLS.stroke = 0;
				flush();
				if (CALLS.fill < 500) errs.push(`${kind} @${t.toFixed(2)}s: the board did not draw`);
			}
		}
		// The shockwave has to actually be IN the scene partway through, or the
		// loop above is asserting nothing but "it didn't throw". Counted off the
		// face sink rather than off stroke calls, which the board itself makes
		// hundreds of.
		mod.__smokeFxOff();
		const quiet = mod.__smokeFaces().board.length;
		mod.__smokeFx('mate', 4, 0, 0.4);
		const loud = mod.__smokeFaces().board.length;
		mod.__smokeFxOff();
		if (loud !== quiet + 2) errs.push(`fx: expected 2 shockwave rings on the board, got ${loud - quiet}`);
		// And the king has to have MOVED. A topple that renders the piece exactly
		// where it stood is the failure this whole effect would be invisible to.
		// The black king on e8 — back rank, so y = 7.
		const upright = JSON.stringify(mod.__smokeFaces().pieces);
		mod.__smokeFx('mate', 4, 7, 2.0);
		const fallen = JSON.stringify(mod.__smokeFaces().pieces);
		mod.__smokeFxOff();
		if (upright === fallen) errs.push('fx: the mated king did not move — the topple transform is a no-op');
	} catch (e) {
		errs.push(`fx: ${e.message}`);
	} finally {
		mod.__smokeFxOff();
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
	console.log('chess3d:smoke ok — board drew at 6 camera angles, sinks split, picking live');
}

main().catch(e => { console.error('chess3d:smoke crashed:', e); process.exit(1); });

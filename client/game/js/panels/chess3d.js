// Chess in actual 3D — a canvas renderer for the gametable chess pane.
//
// The CSS 3/4 board it replaces was a tilted PICTURE of a board: pieces were
// glyphs counter-rotated to stand up, which falls apart the moment you want to
// orbit around it. This draws a real scene — a camera, solid geometry, painter's
// algorithm — so the board can be looked at from anywhere.
//
// It decides NOTHING. The server still renders the pane HTML exactly as before;
// this reads the board state back out of that markup (`.chess-sq[data-sq]` and
// the `.chess-piece` classes inside it) and draws it. Clicking a square fires
// the literal verb the server already put in that square's `data-cmd`. So the
// rule holds: the client never computes legality, and the 3D view is presentation
// sitting on top of a pane that works without it.
//
// Pieces are surfaces of revolution — a 2D silhouette (radius, height) spun
// around its axis. That's how real chess pieces are made (they're turned on a
// lathe), which is why a dozen numbers per piece is enough to get a shape that
// reads instantly. The two that aren't lathes — the knight's head and the king's
// cross — are extruded polygons bolted onto a lathed base.
//
// The 3D is done the way the flight sim does it (panels/windshield.js) and for
// the same reason — no WebGL, no library, no build step. Same three parts:
//   • a camera that projects a world point to the screen (windshield's makeCam
//     → proj; here `project`),
//   • depth-sorted FACE SINKS, because a 2D context has no z-buffer, so faces
//     are queued with their camera depth and painted back→front (windshield's
//     emitFace/flushFaces; here `face()` + the sorts in draw()). THREE of them —
//     slab, board, pieces — see buildFaces for why one wasn't enough,
//   • per-face lighting from the face normal, not per-pixel.
// The one deliberate divergence: windshield queues CLOSURES because a building
// face can paint itself in a dozen different ways. Every face here is a filled
// polygon, so the sink holds plain geometry and skips the closure allocation —
// there are ~4000 of them per frame.
//
// Rendering is ON DEMAND: the scene is static between moves, so it redraws when
// the camera moves or the pane changes and otherwise costs nothing. That's what
// makes 4000 faces in a 2D context affordable. The ONE exception is a piece in
// hand — a pendulum has to keep integrating after the input that started it, so
// dragging runs a rAF loop that stops itself the moment the swing settles.

const RADIAL = 12;          // radial segments per lathe — 12 is round enough at this size
const BOARD = 8;
const SLAB = 0.22;          // board thickness in squares
const CAM_KEY = 'chessCam3d';

// ── Piece silhouettes ────────────────────────────────────────────────────────
// [radius, height] pairs, bottom to top, in units where one square is 1.0.
// Read them down the column and you can see the shape: a wide foot, a waist, a
// collar, a head.
const PROFILES = {
	p: [[0.30, 0], [0.31, 0.04], [0.25, 0.09], [0.16, 0.13], [0.13, 0.34], [0.20, 0.40],
		[0.20, 0.44], [0.13, 0.48], [0.17, 0.56], [0.19, 0.64], [0.15, 0.72], [0.00, 0.80]],
	r: [[0.34, 0], [0.35, 0.05], [0.28, 0.11], [0.22, 0.16], [0.20, 0.55], [0.24, 0.62],
		[0.30, 0.68], [0.31, 0.80]],
	b: [[0.32, 0], [0.33, 0.05], [0.26, 0.10], [0.17, 0.15], [0.14, 0.38], [0.22, 0.45],
		[0.22, 0.49], [0.13, 0.53], [0.19, 0.62], [0.17, 0.74], [0.10, 0.82], [0.06, 0.86],
		[0.09, 0.90], [0.00, 0.95]],
	n: [[0.33, 0], [0.34, 0.05], [0.27, 0.11], [0.22, 0.16], [0.20, 0.32], [0.18, 0.36]],
	q: [[0.36, 0], [0.37, 0.05], [0.30, 0.11], [0.19, 0.17], [0.15, 0.50], [0.24, 0.58],
		[0.24, 0.62], [0.16, 0.66], [0.20, 0.78], [0.30, 0.92], [0.31, 0.98]],
	k: [[0.36, 0], [0.37, 0.05], [0.30, 0.11], [0.20, 0.17], [0.16, 0.52], [0.25, 0.60],
		[0.25, 0.64], [0.17, 0.68], [0.22, 0.80], [0.30, 0.94], [0.31, 1.00]],
};

// Where each piece's lit core band sits, as [bottom, top] heights. Placed on the
// waist — the narrowest run of the body — so the glow reads as something let
// INTO the piece at its thinnest point rather than a stripe painted round it.
const CORE_BAND = {
	p: [0.20, 0.27], r: [0.30, 0.40], b: [0.24, 0.32],
	n: [0.20, 0.27], q: [0.28, 0.38], k: [0.30, 0.42],
};

// The knight's head, in (forward, up) — extruded sideways into a slab. It is the
// one piece whose orientation matters, so it's the one piece that gets turned to
// face down the board.
const KNIGHT_HEAD = [
	[-0.10, 0.30], [-0.16, 0.52], [-0.10, 0.70], [0.04, 0.86], [0.24, 0.90],
	[0.30, 0.80], [0.12, 0.68], [0.16, 0.52], [0.18, 0.34],
];

// ── Vector helpers ───────────────────────────────────────────────────────────

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function norm(v) {
	const l = Math.hypot(v[0], v[1], v[2]) || 1;
	return [v[0] / l, v[1] / l, v[2] / l];
}
// Key light from over the viewer's left shoulder, high. One light, because a
// second one flattens a lathe back out.
const LIGHT = norm([-0.45, -0.5, 0.74]);

// ── Module state ─────────────────────────────────────────────────────────────

let canvas = null;
let ctx = null;
let scene = null;       // { squares, pieces }
let cam = null;
let colors = null;
let frameQueued = false;
let resizeObs = null;
let detachInput = null;

// The piece currently hanging off the cursor, or null. MODULE state, not input
// state, and that's load-bearing: the server's reply to your own pickup arrives
// mid-drag and remounts the whole pane (see mountChess3D), so anything living in
// attachInput's closure would drop the piece out of your hand at the exact
// moment the board lit up its targets.
let drag = null;
// A drop that landed before the server had told us where the piece may go. See
// resolveDrop — the drag is faster than the round trip, and losing the move to
// that race is the one failure mode a drag has that a click doesn't.
let pendingDrop = null;
let swayRaf = 0;

// How high above the board a carried piece hangs, in squares. The HAND itself
// travels on the board plane (see dropTarget) — this only lifts the piece off
// it, so the height is free to be whatever looks carried without ever affecting
// which square the drop lands on.
const HOVER = 1.55;
// The pendulum. A piece hangs from a point just above its own crown and trails
// the hand: the target tilt is proportional to hand SPEED, and a spring chases
// it, so the overshoot on stopping is what actually reads as weight. Tuned for
// a swing that settles in well under a second — this is a chess piece on a
// short string, not a wrecking ball.
const SWAY_PER_SPEED = 0.085;   // radians per square/second of hand speed
const SWAY_MAX = 0.40;          // radians — past this it reads as broken, not heavy
const SWAY_STIFF = 105;
const SWAY_DAMP = 9.5;
const SWAY_VEL_DECAY = 9;       // how fast the hand's remembered speed bleeds off
const SWAY_REST = 0.0025;       // below this the swing is over and the loop stops

// The one thing on the board that ANIMATES ITSELF. Check and checkmate are the
// two moments in a chess game that are events rather than positions, and the
// flat board could only ever colour a square for them.
//
//   • CHECK — a red shockwave off the king's square and a hard shudder through
//     the king itself. It's a warning, so it's over in under a second and
//     leaves the standing position alone.
//   • CHECKMATE — the king TOPPLES. It's the oldest gesture in the game and the
//     only thing a 3D piece can do that a 2D one can't, and unlike the check
//     shudder it is PERMANENT: the king stays down for as long as the finished
//     board is on screen, because the position it fell out of is the record.
let fx = null;              // { kind:'check'|'mate', x, y, t0, t }
let fxRaf = 0;
let lastCheck = null;       // the checked square last seen, so a NEW check fires once
let lastMate = false;
const CHECK_FX_SECS = 1.1;
const MATE_FALL_DELAY = 0.42;   // the ring lands first, then the king goes
const MATE_FALL_SECS = 0.8;
const HALF_PI = Math.PI / 2;

function loadCam() {
	let saved = {};
	try { saved = JSON.parse(localStorage.getItem(CAM_KEY)) || {}; } catch { /* first run */ }
	return {
		yaw: saved.yaw ?? 0,
		// Pitch is elevation above the board plane: 90° is straight down, 0° is
		// edge-on. Clamped short of both so you can never lose the board to a
		// degenerate view.
		pitch: saved.pitch ?? 0.92,
		dist: saved.dist ?? 13.5,
		f: 620,
	};
}
function saveCam() {
	try {
		localStorage.setItem(CAM_KEY, JSON.stringify({ yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist }));
	} catch { /* private mode — the view just doesn't persist */ }
}

// ── Reading the board out of the server's markup ─────────────────────────────

// The pane is the source of truth. Board coordinates come from DOM ORDER, not
// from the algebraic name, so a flipped board (Black's view) arrives already
// oriented with the viewer's own side nearest the camera — the server did that
// work and there's no reason to redo it here.
function parsePane(pane) {
	const cells = pane.querySelectorAll('.chess-sq');
	if (cells.length !== 64) return null;
	const squares = [];
	const pieces = [];
	cells.forEach((el, i) => {
		const f = i % 8;
		const r = Math.floor(i / 8);      // 0 = far row, 7 = nearest the viewer
		const y = 7 - r;
		const cl = el.classList;
		squares.push({
			x: f, y,
			light: cl.contains('sq-light'),
			selected: cl.contains('sq-selected'),
			target: cl.contains('sq-target'),
			capture: cl.contains('sq-capture'),
			lastFrom: cl.contains('sq-last-from'),
			lastTo: cl.contains('sq-last-to'),
			check: cl.contains('sq-check'),
			live: cl.contains('sq-live'),
			cmd: el.dataset.cmd || null,
			alg: el.dataset.sq || '',
		});
		const pc = el.querySelector('.chess-piece');
		if (pc) {
			const type = ['k', 'q', 'r', 'b', 'n', 'p'].find(t => pc.classList.contains(`pc-${t}`));
			if (type) {
				pieces.push({
					x: f, y, type,
					white: pc.classList.contains('pc-white'),
					checked: pc.classList.contains('pc-checked'),
					lifted: cl.contains('sq-selected'),
				});
			}
		}
	});
	return {
		squares, pieces,
		// The ending, straight off the status line's class. A resignation is over
		// without being mate, and a king can be standing in check when its player
		// resigns — so these are two separate facts and the server states both.
		over: !!pane.querySelector('.chess-status-over'),
		mate: !!pane.querySelector('.chess-status-mate'),
	};
}

// Team colours come from the pane's own CSS variables, so the board still tracks
// the room palette rather than hardcoding two hexes here.
// Nothing in the scene is a literal hex any more. Every colour on the board is
// mixed at mount out of the ACTIVE THEME's palette, so a player on a different
// [data-theme] gets a board built out of their own room rather than one that
// looks pasted in from someone else's.
//
// The mixing is the groove. Two flat tones is a checkerboard; the light squares
// instead run a ramp along the board's diagonal from --cyan to --purple and the
// dark squares run the SAME ramp inverted, at a fraction of the strength — so
// the deck shifts hue corner to corner and the two colours cross in the middle,
// which is the thing you notice when the camera swings and nothing else moves.
function readColors(pane) {
	const cs = getComputedStyle(pane);
	const pick = (name, fallback) => toRgb(cs.getPropertyValue(name).trim() || fallback);
	const cyan = pick('--cyan', '#28e5ff');
	const purple = pick('--purple', '#b86bff');
	const accent = pick('--accent', '#ff2ec4');
	const deck = pick('--bg', '#05050a');
	return {
		// The two armies, still off the pane's own chess vars.
		white: css(pick('--chess-white', '#38e0d8')),
		black: css(pick('--chess-black', '#e2479f')),
		accent: css(cyan),           // the board's structural light: rim, etching, coords
		cyan, purple, accent2: accent, deck,
		green: pick('--green', '#39ff8f'),
		red: pick('--red', '#ff3b5c'),
		yellow: pick('--yellow', '#f5e642'),
		// A lit panel set into a dark deck, and a deck very nearly black — the
		// contrast between them is what keeps a dim piece readable, so both ends
		// of the ramp are anchored against the theme's own background.
		litLo: mixRgb(deck, cyan, 0.20),
		litHi: mixRgb(deck, purple, 0.20),
		darkLo: mixRgb(deck, purple, 0.055),
		darkHi: mixRgb(deck, cyan, 0.055),
	};
}

const css = rgb => `rgb(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0})`;
const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ── Projection ───────────────────────────────────────────────────────────────

// World: x = file (0..8), y = rank (0..8, growing AWAY from the camera at yaw 0),
// z = up. Origin corner, board centred on (4,4).
function project(p) {
	const dx = p[0] - 4, dy = p[1] - 4, dz = p[2];
	const ca = Math.cos(cam.yaw), sa = Math.sin(cam.yaw);
	const x1 = dx * ca + dy * sa;
	const y1 = -dx * sa + dy * ca;
	const ce = Math.cos(cam.pitch), se = Math.sin(cam.pitch);
	const up = y1 * se + dz * ce;
	const depth = y1 * ce - dz * se + cam.dist;
	const s = cam.f / Math.max(0.2, depth);
	return [canvas.clientWidth / 2 + x1 * s, canvas.clientHeight / 2 - up * s + canvas.clientHeight * 0.06, depth];
}

// ── Geometry assembly ────────────────────────────────────────────────────────

// Everything the frame will draw, as flat-shaded polygons with an average depth.
//
// TWO sinks, not one, and that split is a bug fix rather than tidiness. A single
// depth-sorted list sorts each face by its AVERAGE depth, and a board square is
// a metre wide: the near half of a square can sit in front of a piece standing
// on the square behind it while its average says it's further away. The square
// then paints straight over the piece and the piece VANISHES — which is exactly
// what happened along the far ranks at a low camera angle.
//
// Average-depth sorting can't fix that, because the two objects genuinely
// interleave in depth. What resolves it is the fact that no piece is ever behind
// the board: pieces stand ON the plane, so the board is painted first, whole,
// and the pieces go on top. Within the piece pass the ordering is per PIECE (by
// the depth of its base, which is exact for objects standing on a plane), and
// only then per face inside that piece — the same shape as the flight sim's
// per-building face sink.
function buildFaces() {
	const slab = [];
	const board = [];
	const pieces = [];
	const into = list => (pts, fill, opts = {}) => {
		let d = 0;
		const proj = pts.map(p => { const q = project(p); d += q[2]; return q; });
		list.push({ proj, fill, depth: d / pts.length, ...opts });
	};
	const face = into(board);

	// The slab: the sides and the underside rim that give the board an edge when
	// you orbit low. It gets its OWN pass, painted before the squares — the same ordering
	// argument as pieces, run the other way. The underside is a single quad
	// spanning the whole board, so its average depth is IDENTICAL to the average
	// of the 64 square tops; a depth sort between them is a coin flip, and when it
	// came up tails the near-black underside painted over the entire checkerboard.
	// That's the board "losing its squares" at certain angles. It isn't a sorting
	// bug to be tuned — the camera is always above the plane (pitch clamps well
	// above 0), so the slab is ALWAYS behind the top, and saying so outright is
	// both correct and cheaper than sorting.
	const slabFace = into(slab);
	const z0 = -SLAB;
	const corners = [[0, 0], [BOARD, 0], [BOARD, BOARD], [0, BOARD]];
	for (let i = 0; i < 4; i++) {
		const a = corners[i], b = corners[(i + 1) % 4];
		slabFace([[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], 0], [a[0], a[1], 0]],
			css(mixRgb(colors.deck, colors.cyan, 0.06)), { stroke: colors.accent, strokeAlpha: 0.55 });
		// A light strip let into the rim, all the way round. The board is a
		// machine the game runs on, and this is the one detail that says so from
		// every angle — it's the only thing still visible edge-on at a low camera.
		//
		// The strip runs the SAME diagonal ramp as the deck, one hue step per
		// side, so the rim light crosses from --cyan to --accent as it goes round
		// and the two opposite corners never read the same. It's the one piece of
		// colour still on screen when the camera is nearly edge-on, which is
		// exactly when a board most needs something to look at.
		const inset = 0.05, lo = z0 * 0.62, hi = z0 * 0.34;
		const ax = a[0] + (b[0] - a[0]) * inset, ay = a[1] + (b[1] - a[1]) * inset;
		const bx = b[0] - (b[0] - a[0]) * inset, by = b[1] - (b[1] - a[1]) * inset;
		// 0,1,2,1 round the four sides — a there-and-back, so the seam where the
		// last side meets the first has no jump in it.
		const hue = mixRgb(colors.cyan, colors.accent2, [0, 0.5, 1, 0.5][i]);
		slabFace([[ax, ay, lo], [bx, by, lo], [bx, by, hi], [ax, ay, hi]],
			rgba(hue, 0.78), { glow: css(hue), glowSize: 12 });
	}
	slabFace([[0, 0, z0], [BOARD, 0, z0], [BOARD, BOARD, z0], [0, BOARD, z0]], css(mixRgb(colors.deck, [0, 0, 0], 0.35)));

	// Squares. The face colour carries every bit of board state — selection, the
	// last move, check — because a flat lit panel is the only surface here that
	// can hold a colour without competing with the pieces.
	for (const sq of scene.squares) {
		const { x, y } = sq;
		face([[x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]],
			squareFill(sq), { square: sq, stroke: squareStroke(sq), strokeAlpha: 1, glow: squareGlow(sq) });
		// An empty legal destination gets a floating disc; "go here" and "take
		// that" stay different marks, as in the flat board.
		if (sq.target) {
			face(discPts(x + 0.5, y + 0.5, 0.16, 0.02), rgba(colors.green, 0.85), { glow: css(colors.green) });
		}
	}

	// Each piece gets its own face list. The plinth and contact shadow go into the
	// BOARD list instead — they lie on the plane, so they belong to it.
	for (const pc of scene.pieces) {
		// The piece in your hand isn't standing anywhere. It's drawn last, in its
		// own pass, because a dangling piece is over the board rather than on it
		// and has no honest depth to sort by.
		if (drag && pc.x === drag.from.x && pc.y === drag.from.y) continue;
		const own = [];
		const emit = into(own);
		// A king under fire moves. The transform wraps the emitter rather than
		// being threaded through pieceFaces, the same trick the dragged piece uses.
		const xf = fxTransform(pc);
		pieceFaces(pc, xf ? (pts, fill, opts) => emit(pts.map(xf), fill, opts) : emit, face);
		pieces.push({ depth: project([pc.x + 0.5, pc.y + 0.5, 0])[2], faces: own });
	}
	fxBoardFaces(face);

	const ghost = drag ? ghostFaces(into, face) : null;
	return { slab, board, pieces, ghost };
}

// Turn a point about a PIVOT: first about the world Y axis by `b`, then about
// the world X axis by `a`, with `zOff` lifting the source geometry beforehand.
// One helper, three users — the swing of a carried piece, the shudder of a king
// in check, and the topple of a mated one are the same operation about three
// different pivots, and that is the whole reason any of them was cheap to add.
function rotator(pivot, a, b, zOff = 0) {
	const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
	return p => {
		const lx = p[0] - pivot[0], ly = p[1] - pivot[1], lz = p[2] + zOff - pivot[2];
		const x1 = lx * cb + lz * sb;
		const z1 = -lx * sb + lz * cb;
		return [pivot[0] + x1, pivot[1] + ly * ca - z1 * sa, pivot[2] + ly * sa + z1 * ca];
	};
}

// The dangling piece, plus the marks on the board that say where it would land.
//
// The piece geometry is the ORDINARY piece geometry: `pieceFaces` builds a lathe
// around (x+0.5, y+0.5), so a fractional x/y puts it anywhere, and the swing is a
// transform wrapped around the emitter rather than an argument threaded through
// the dozen places that emit a point.
function ghostFaces(into, boardFace) {
	const pc = { x: drag.wx - 0.5, y: drag.wy - 0.5, type: drag.type, white: drag.white, checked: false, lifted: false };
	const top = PROFILES[drag.type][PROFILES[drag.type].length - 1][1];
	const hang = top + 0.10;           // the string is tied just above the crown
	const zOff = HOVER - hang;
	// Rotate about the hang point, not the base — that's the difference between
	// a piece swinging and a piece leaning.
	const swing = rotator([drag.wx, drag.wy, HOVER], drag.tiltX, drag.tiltY, zOff);

	const faces = [];
	const raw = into(faces);
	const swung = (pts, fill, opts) => raw(pts.map(swing), fill, opts);
	// The board emitter is stubbed out: the contact shadow and docking pad belong
	// to a piece that's standing on a square, and this one isn't.
	pieceFaces(pc, swung, () => {});

	// Where it would land. The drop square gets a ring; an illegal one gets
	// nothing but the tether, so "nowhere to put this" reads as an absence.
	const sq = drag.dropSq;
	if (sq) {
		boardFace(discPts(sq.x + 0.5, sq.y + 0.5, 0.42, 0.012), rgba(colors.green, 0.20),
			{ stroke: css(colors.green), strokeAlpha: 1, glow: css(colors.green) });
	}
	// A contact shadow under the hand, on the plane, wherever the hand actually is.
	boardFace(discPts(drag.wx, drag.wy, 0.30, 0.005), 'rgba(0,0,0,0.5)', { soft: true });
	return { faces, foot: [drag.wx, drag.wy] };
}

// ── Check and checkmate ──────────────────────────────────────────────────────

// What the king itself is doing. Null for every other piece and for every quiet
// position, so the whole feature costs nothing until the moment it exists.
function fxTransform(pc) {
	if (!fx || pc.x !== fx.x || pc.y !== fx.y) return null;
	const t = fx.t;
	const cx = pc.x + 0.5, cy = pc.y + 0.5;

	if (fx.kind === 'check') {
		if (t > CHECK_FX_SECS) return null;
		// A jolt through the piece, rocking on its own foot and dying away fast.
		// Two frequencies slightly apart so it reads as a shudder rather than as
		// a wobble on one axis.
		const amp = 0.15 * Math.exp(-4.6 * t);
		return rotator([cx, cy, 0], amp * Math.sin(t * 34), amp * 0.7 * Math.sin(t * 29 + 1.1));
	}

	// The topple. It pivots on the contact edge of its own base and falls toward
	// the near edge of the board — toward its own player, which is the direction
	// a resigning hand tips a king in.
	const p = (t - MATE_FALL_DELAY) / MATE_FALL_SECS;
	if (p <= 0) return null;
	// Accelerating, not eased: it's falling, and an ease-out at the bottom would
	// read as being lowered.
	let th = HALF_PI * Math.min(1, p) ** 2;
	if (p >= 1) {
		// It lands on something hard. One small bounce, then it's over for good.
		const b = t - MATE_FALL_DELAY - MATE_FALL_SECS;
		th = HALF_PI - 0.09 * Math.exp(-8 * b) * Math.abs(Math.sin(b * 20));
	}
	return rotator([cx, cy - PROFILES[pc.type][0][0], 0], th, 0);
}

// The shockwave, on the board plane, so pieces stand in front of it.
function fxBoardFaces(face) {
	if (!fx) return;
	const t = fx.t;
	const cx = fx.x + 0.5, cy = fx.y + 0.5;
	// [launch delay, duration, final radius] — one entry per ring. Check throws
	// two quick small ones; mate throws three that run off the edge of the board.
	const rings = fx.kind === 'check'
		? [[0, 0.62, 2.4], [0.18, 0.62, 1.9]]
		: [[0, 1.5, 6.2], [0.3, 1.5, 4.8], [0.6, 1.5, 3.4]];
	for (const [t0, dur, rmax] of rings) {
		const p = (t - t0) / dur;
		if (p <= 0 || p >= 1) continue;
		const r = 0.36 + (rmax - 0.36) * (1 - (1 - p) ** 2.2);
		face(discPts(cx, cy, r, 0.014, 40), null,
			{ stroke: rgba(colors.red, ((1 - p) * 0.85).toFixed(3)), strokeAlpha: 1, glow: css(colors.red), glowSize: 14 });
	}
}

function startFx(kind, x, y) {
	fx = { kind, x, y, t0: performance.now(), t: 0 };
	if (!fxRaf) fxRaf = requestAnimationFrame(fxTick);
	requestDraw();
}

function fxTick(t) {
	fxRaf = 0;
	if (!fx) return;
	fx.t = (t - fx.t0) / 1000;
	requestDraw();
	// A check burns out and the board goes back to normal. A checkmate does NOT:
	// the loop stops once the king has finished falling, and the frozen last
	// frame IS the final position — a king that stood back up after the game
	// ended would be undoing the only record of how it finished.
	const done = fx.kind === 'check'
		? fx.t > CHECK_FX_SECS
		: fx.t > MATE_FALL_DELAY + MATE_FALL_SECS + 1.4;
	if (done) {
		if (fx.kind === 'check') fx = null;
		requestDraw();
		return;
	}
	fxRaf = requestAnimationFrame(fxTick);
}

function stopFx() {
	fx = null;
	if (fxRaf) cancelAnimationFrame(fxRaf);
	fxRaf = 0;
}

// Fired off the board that just arrived. A check fires ONCE per new check —
// re-rendering the same position (a chat line, a resize, the opponent's clock)
// must not re-bang the drum.
function syncFx() {
	const king = scene.squares.find(s => s.check) || null;
	const key = king?.alg || null;
	if (scene.mate && king) {
		if (!lastMate || fx?.kind !== 'mate') startFx('mate', king.x, king.y);
	} else if (!scene.over && key && key !== lastCheck) {
		startFx('check', king.x, king.y);
	} else if (!scene.mate && fx?.kind === 'mate') {
		stopFx();      // a new game on the same table — stand the king back up
	}
	lastCheck = key;
	lastMate = scene.mate;
}

function discPts(cx, cy, r, z, n = 10) {
	const pts = [];
	for (let i = 0; i < n; i++) {
		const t = (i / n) * Math.PI * 2;
		pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r, z]);
	}
	return pts;
}

// The light square is a lit panel set into a dark deck — a floor tile with power
// behind it, not ivory. The dark square is very nearly black on purpose: the
// contrast is what lets a dim piece stay readable standing on it.
// The diagonal position of a square, 0 at the far-left corner and 1 at the
// near-right one. The whole board ramp hangs off this one number.
const ramp = sq => (sq.x + (7 - sq.y)) / 14;

function squareFill(sq) {
	if (sq.check) return rgba(colors.red, 0.72);
	if (sq.selected) return rgba(colors.yellow, 0.66);
	if (sq.capture) return rgba(colors.red, 0.42);
	if (sq.target) return rgba(colors.green, 0.26);
	if (sq.lastTo) return rgba(colors.purple, 0.34);
	if (sq.lastFrom) return rgba(colors.purple, 0.18);
	const t = ramp(sq);
	return css(sq.light
		? mixRgb(colors.litLo, colors.litHi, t)
		: mixRgb(colors.darkLo, colors.darkHi, 1 - t));
}
// Every square carries a faint circuit line. Lit squares get a brighter one, so
// the grid itself reads as etched rather than drawn.
function squareStroke(sq) {
	if (sq.check) return css(colors.red);
	if (sq.selected) return css(colors.yellow);
	if (sq.capture) return css(colors.red);
	if (sq.target) return css(colors.green);
	// The etching runs the ramp too, the other way round from the fill it sits
	// on — so the grid stays visible at both ends of the board instead of fading
	// out wherever the deck happens to have brightened.
	const t = ramp(sq);
	return rgba(mixRgb(colors.cyan, colors.purple, 1 - t), sq.light ? 0.24 : 0.09);
}
function squareGlow(sq) {
	if (sq.check) return css(colors.red);
	if (sq.selected) return css(colors.yellow);
	if (sq.target || sq.capture) return css(colors.green);
	return null;
}

// A lathe: spin the silhouette, emit a quad per (profile segment × radial
// segment), and shade each one off its own normal. The normal is exact rather
// than faked — for a surface of revolution it falls straight out of the profile
// slope, which is what keeps the highlight running cleanly up the body instead
// of banding.
function pieceFaces(pc, face, boardFace) {
	const prof = PROFILES[pc.type];
	const cx = pc.x + 0.5, cy = pc.y + 0.5;
	const base = pc.lifted ? 0.28 : 0;     // a picked-up piece actually lifts
	const tint = pc.white ? colors.white : colors.black;
	const rgb = toRgb(tint);
	// The seam heights, where the machined body gives way to a lit core. Reading
	// them off the profile rather than hardcoding a number per piece means the
	// band lands on the waist of whatever shape the profile describes.
	const coreLo = CORE_BAND[pc.type][0], coreHi = CORE_BAND[pc.type][1];

	for (let i = 0; i < prof.length - 1; i++) {
		const [r0, h0] = prof[i], [r1, h1] = prof[i + 1];
		const dr = r1 - r0, dh = h1 - h0;
		for (let j = 0; j < RADIAL; j++) {
			const t0 = (j / RADIAL) * Math.PI * 2, t1 = ((j + 1) / RADIAL) * Math.PI * 2;
			const tm = (t0 + t1) / 2;
			const n = norm([Math.cos(tm) * dh, Math.sin(tm) * dh, -dr]);
			face([
				[cx + Math.cos(t0) * r0, cy + Math.sin(t0) * r0, base + h0],
				[cx + Math.cos(t1) * r0, cy + Math.sin(t1) * r0, base + h0],
				[cx + Math.cos(t1) * r1, cy + Math.sin(t1) * r1, base + h1],
				[cx + Math.cos(t0) * r1, cy + Math.sin(t0) * r1, base + h1],
			], shade(rgb, n));
		}
	}

	// Contour lines up the body — the tool marks of a lathe, and the single
	// biggest thing separating "turned wooden chess piece" from "machined out of
	// something that runs on power".
	//
	// One stroke per RING, not per quad. Stroking each quad drew the same lines
	// twelve times over and cost 3000 stroke calls a frame; a ring is one closed
	// path of twelve points and looks identical. That's ~250 strokes for the
	// whole set.
	for (let i = 1; i < prof.length - 1; i++) {
		const [r, hh] = prof[i];
		if (r < 0.02) continue;
		const ring = [];
		for (let j = 0; j < RADIAL; j++) {
			const t = (j / RADIAL) * Math.PI * 2;
			ring.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r, base + hh]);
		}
		face(ring, null, { stroke: seamInk(rgb), strokeAlpha: 0.55 });
	}

	// The lit core: a band of emissive material let into the waist, drawn as its
	// own short lathe standing slightly proud of the body so it reads as inlay
	// rather than as paint. This is the piece's own light source — everything
	// else on it is lit from outside.
	coreBand(face, rgb, cx, cy, base, prof, coreLo, coreHi);

	const top = prof[prof.length - 1];
	if (top[0] > 0.01) {
		// Cap the open top of anything that doesn't taper to a point.
		face(discPts(cx, cy, top[0], base + top[1]).map(p => p),
			shade(rgb, [0, 0, 1]));
	}

	if (pc.type === 'r') merlons(pc, face, rgb, base);
	if (pc.type === 'q') coronet(pc, face, rgb, base);
	if (pc.type === 'k') cross3d(pc, face, rgb, base);
	if (pc.type === 'n') knightHead(pc, face, rgb, base);

	// The contact shadow and the emitter pad it stands on. Both lie flat on the
	// plane, so they're emitted into the BOARD list — a shadow that sorted with
	// its own piece would paint over the piece in front of it.
	boardFace(discPts(cx, cy, prof[0][0] * 1.45, 0.004), 'rgba(0,0,0,0.6)', { soft: true });
	// The pad: a hex plate, because a circle would read as a shadow and this is
	// meant to read as hardware the piece is docked into.
	boardFace(hexPts(cx, cy, prof[0][0] * 1.28, 0.006),
		`rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},0.16)`,
		{ stroke: `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},0.55)`, strokeAlpha: 1, glow: tint });
	if (pc.checked) {
		boardFace(discPts(cx, cy, prof[0][0] * 1.8, 0.008), rgba(colors.red, 0.32), { soft: true, glow: css(colors.red) });
	}
}

// The lit core band. Radii are read off the profile at the two seam heights, so
// the inlay hugs whatever the body is doing there instead of floating off it.
function coreBand(face, rgb, cx, cy, base, prof, h0, h1) {
	const r0 = radiusAt(prof, h0) + 0.012, r1 = radiusAt(prof, h1) + 0.012;
	const lit = `rgb(${Math.min(255, rgb[0] * 1.5 + 60) | 0},${Math.min(255, rgb[1] * 1.5 + 60) | 0},${Math.min(255, rgb[2] * 1.5 + 60) | 0})`;
	const glow = `rgb(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0})`;
	for (let j = 0; j < RADIAL; j++) {
		const t0 = (j / RADIAL) * Math.PI * 2, t1 = ((j + 1) / RADIAL) * Math.PI * 2;
		face([
			[cx + Math.cos(t0) * r0, cy + Math.sin(t0) * r0, base + h0],
			[cx + Math.cos(t1) * r0, cy + Math.sin(t1) * r0, base + h0],
			[cx + Math.cos(t1) * r1, cy + Math.sin(t1) * r1, base + h1],
			[cx + Math.cos(t0) * r1, cy + Math.sin(t0) * r1, base + h1],
		], lit, { glow });
	}
}

// Where the profile is at a given height — a walk, not a lookup, because the
// profiles are authored by shape and nothing guarantees a vertex at the seam.
function radiusAt(prof, h) {
	for (let i = 0; i < prof.length - 1; i++) {
		const [r0, h0] = prof[i], [r1, h1] = prof[i + 1];
		if (h >= h0 && h <= h1) {
			const t = h1 === h0 ? 0 : (h - h0) / (h1 - h0);
			return r0 + (r1 - r0) * t;
		}
	}
	return prof[prof.length - 1][0];
}

function hexPts(cx, cy, r, z) {
	const pts = [];
	for (let i = 0; i < 6; i++) {
		const t = (i / 6) * Math.PI * 2 + Math.PI / 6;
		pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r, z]);
	}
	return pts;
}

// The tool-line ink: the body colour taken well down, never black. A black seam
// on a dark piece just eats the silhouette.
function seamInk(rgb) {
	return `rgba(${(rgb[0] * 0.35) | 0},${(rgb[1] * 0.35) | 0},${(rgb[2] * 0.35) | 0},1)`;
}

// Rook battlements — six blocks around the rim.
function merlons(pc, face, rgb, base) {
	const cx = pc.x + 0.5, cy = pc.y + 0.5;
	const r = 0.31, h0 = 0.80, h1 = 0.96, w = 0.10;
	for (let i = 0; i < 6; i++) {
		const t = (i / 6) * Math.PI * 2;
		box(face, rgb, cx + Math.cos(t) * (r - w / 2), cy + Math.sin(t) * (r - w / 2), base + h0, base + h1, w, w, t);
	}
}

// Queen's coronet — eight points around a ring, plus the ball on top.
function coronet(pc, face, rgb, base) {
	const cx = pc.x + 0.5, cy = pc.y + 0.5;
	for (let i = 0; i < 8; i++) {
		const t = (i / 8) * Math.PI * 2;
		box(face, rgb, cx + Math.cos(t) * 0.27, cy + Math.sin(t) * 0.27, base + 0.98, base + 1.12, 0.08, 0.08, t);
	}
	for (const [r, h] of [[0.09, 1.00], [0.11, 1.06], [0.07, 1.12]]) {
		face(discPts(cx, cy, r, base + h), shade(rgb, [0, 0, 1]));
	}
}

// The king's cross. Two slabs, and the one detail that makes a king unmistakable
// from across the board at any angle.
function cross3d(pc, face, rgb, base) {
	const cx = pc.x + 0.5, cy = pc.y + 0.5;
	box(face, rgb, cx, cy, base + 1.00, base + 1.30, 0.09, 0.09, 0);
	box(face, rgb, cx, cy, base + 1.15, base + 1.23, 0.26, 0.09, 0);
}

// An axis-aligned block, yaw-rotated about its own centre.
function box(face, rgb, cx, cy, z0, z1, w, d, rot) {
	const c = Math.cos(rot), s = Math.sin(rot);
	const pt = (u, v, z) => [cx + u * c - v * s, cy + u * s + v * c, z];
	const hw = w / 2, hd = d / 2;
	const faces = [
		[[-hw, -hd, z1], [hw, -hd, z1], [hw, hd, z1], [-hw, hd, z1], [0, 0, 1]],
		[[-hw, -hd, z0], [hw, -hd, z0], [hw, -hd, z1], [-hw, -hd, z1], [0, -1, 0]],
		[[hw, -hd, z0], [hw, hd, z0], [hw, hd, z1], [hw, -hd, z1], [1, 0, 0]],
		[[hw, hd, z0], [-hw, hd, z0], [-hw, hd, z1], [hw, hd, z1], [0, 1, 0]],
		[[-hw, hd, z0], [-hw, -hd, z0], [-hw, -hd, z1], [-hw, hd, z1], [-1, 0, 0]],
	];
	for (const f of faces) {
		const n = f[4];
		const wn = norm([n[0] * c - n[1] * s, n[0] * s + n[1] * c, n[2]]);
		face(f.slice(0, 4).map(p => pt(p[0], p[1], p[2])), shade(rgb, wn));
	}
}

// The knight: an extruded silhouette, turned to look down the board at the other
// army. White faces away from the camera, Black faces toward it.
function knightHead(pc, face, rgb, base) {
	const cx = pc.x + 0.5, cy = pc.y + 0.5;
	const dir = pc.white ? 1 : -1;
	const th = 0.115;
	const pt = (u, z, v) => [cx + u * dir, cy + v, base + z];
	const P = KNIGHT_HEAD;
	// The two flat cheeks.
	for (const side of [th, -th]) {
		face(P.map(p => pt(p[0], p[1], side)), shade(rgb, [0, side > 0 ? 1 : -1, 0].map((n, i) => i === 1 ? n * dir : n)));
	}
	// The rim between them, one quad per silhouette edge.
	for (let i = 0; i < P.length; i++) {
		const a = P[i], b = P[(i + 1) % P.length];
		const e = [(b[0] - a[0]) * dir, 0, b[1] - a[1]];
		const n = norm(cross(e, [0, 1, 0]));
		face([pt(a[0], a[1], th), pt(b[0], b[1], th), pt(b[0], b[1], -th), pt(a[0], a[1], -th)], shade(rgb, n));
	}
}

// ── Shading ──────────────────────────────────────────────────────────────────

const rgba = (rgb, a) => `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${a})`;

// Resolving a colour costs a DOM round trip, and this is called per piece per
// frame — memoised, because there are exactly three colours in the scene and
// doing 36 layout-triggering appends per frame to re-learn them would be the
// single most expensive thing in the renderer.
const RGB_CACHE = new Map();
function toRgb(css) {
	let v = RGB_CACHE.get(css);
	if (v) return v;
	// The pane's colour vars may be hex or a colour function; let the browser
	// resolve whatever it is, once.
	const d = document.createElement('span');
	d.style.color = css;
	document.body.appendChild(d);
	const m = getComputedStyle(d).color.match(/[\d.]+/g);
	d.remove();
	v = m ? [+m[0], +m[1], +m[2]] : [80, 220, 210];
	RGB_CACHE.set(css, v);
	return v;
}

// Lit metal, not painted plastic. Three terms, and the balance between them is
// the whole look:
//   • a LOW ambient, so unlit faces fall away into the dark instead of sitting
//     at a flat pastel — the first version's 0.22 floor is what made the set
//     look like a toy,
//   • lambert for the body,
//   • a hard, narrow SPECULAR and a rim term, which are the two things that read
//     as "polished under a neon sign". The rim is deliberately cool-shifted
//     toward the team colour rather than white: an edge turning away from the
//     key light should catch the room, and the room here is a neon one.
function shade(rgb, n) {
	const d = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
	const rim = Math.pow(1 - Math.abs(n[2]), 3) * 0.55;
	const spec = Math.pow(Math.max(0, d), 14) * 220;
	const k = 0.10 + d * 0.62 + rim;
	const r = Math.min(255, rgb[0] * k + spec);
	const g = Math.min(255, rgb[1] * k + spec * 1.02);
	const b = Math.min(255, rgb[2] * k + spec * 1.05);
	return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// ── Draw ─────────────────────────────────────────────────────────────────────

function paintFace(poly) {
	const p = poly.proj;
	ctx.beginPath();
	ctx.moveTo(p[0][0], p[0][1]);
	for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
	ctx.closePath();
	if (poly.glow) {
		ctx.shadowColor = poly.glow;
		ctx.shadowBlur = poly.glowSize ?? 18;
	}
	if (poly.soft) ctx.filter = 'blur(3px)';
	// A null fill is a line-only face — a contour ring. It still sorts and
	// occludes like any other face; it just has nothing to fill.
	if (poly.fill) {
		ctx.fillStyle = poly.fill;
		ctx.fill();
	}
	ctx.filter = 'none';
	ctx.shadowBlur = 0;
	if (poly.stroke) {
		ctx.strokeStyle = poly.stroke;
		ctx.globalAlpha = poly.strokeAlpha ?? 1;
		ctx.lineWidth = 1;
		ctx.stroke();
		ctx.globalAlpha = 1;
	}
}

function draw() {
	frameQueued = false;
	if (!canvas || !scene) return;
	const w = canvas.clientWidth, h = canvas.clientHeight;
	if (!w || !h) return;
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
	}
	// Focal length follows the pane, so the board fills whatever it's given
	// instead of sitting in the middle of a wide pane at a fixed size.
	cam.f = Math.min(w * 1.15, h * 2.1);

	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, w, h);

	// Floor glow — the light the board is sitting in.
	const g = ctx.createRadialGradient(w / 2, h * 0.55, 0, w / 2, h * 0.55, Math.max(w, h) * 0.5);
	g.addColorStop(0, rgba(mixRgb(colors.cyan, colors.purple, 0.35), 0.14));
	g.addColorStop(1, 'rgba(0,0,0,0)');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, w, h);

	const { slab, board, pieces, ghost } = buildFaces();

	// Three passes, back to front, and every boundary between them is an ordering
	// FACT rather than a sort: the slab is under the squares, the squares are
	// under the pieces. Sorting across those boundaries is what produced both the
	// vanishing pieces and the vanishing checkerboard.
	slab.sort((a, b) => b.depth - a.depth);
	for (const poly of slab) paintFace(poly);

	board.sort((a, b) => b.depth - a.depth);
	for (const poly of board) paintFace(poly);

	// The mate wash: the board's own light going red under the pieces. Painted
	// as a SCREEN-SPACE quad over the finished board rather than emitted into the
	// board sink, because one quad spanning all 64 squares has an average depth
	// identical to the average of the squares — the exact coin-flip sort that
	// once made the slab paint over the whole checkerboard.
	if (fx?.kind === 'mate') {
		const a = Math.min(0.20, Math.max(0, fx.t - MATE_FALL_DELAY) * 0.30);
		if (a > 0.002) {
			const corners = [[0, 0, 0.02], [BOARD, 0, 0.02], [BOARD, BOARD, 0.02], [0, BOARD, 0.02]].map(project);
			ctx.save();
			ctx.fillStyle = rgba(mixRgb(colors.red, [0, 0, 0], 0.25), a.toFixed(3));
			ctx.beginPath();
			ctx.moveTo(corners[0][0], corners[0][1]);
			for (let i = 1; i < 4; i++) ctx.lineTo(corners[i][0], corners[i][1]);
			ctx.closePath();
			ctx.fill();
			ctx.restore();
		}
	}

	// The pieces, far to near BY PIECE — exact for objects standing on a plane —
	// then face by face inside each one.
	pieces.sort((a, b) => b.depth - a.depth);
	for (const pc of pieces) {
		pc.faces.sort((a, b) => b.depth - a.depth);
		for (const poly of pc.faces) paintFace(poly);
	}

	// The piece in hand goes on top of everything, unconditionally. It is between
	// the player and the board in the fiction and on the screen, and sorting it
	// against the set would put it behind a pawn it's being carried over.
	if (ghost) {
		drawTether(ghost.foot);
		ghost.faces.sort((a, b) => b.depth - a.depth);
		for (const poly of ghost.faces) paintFace(poly);
	}

	drawCoords();
}

// The line from the hand down to the plane. Without it a piece held over the
// far half of the board is ambiguous with a piece standing on the near half —
// there's no other depth cue for something that isn't touching anything.
function drawTether([wx, wy]) {
	const a = project([wx, wy, HOVER]);
	const b = project([wx, wy, 0.01]);
	ctx.save();
	ctx.setLineDash([4, 5]);
	ctx.strokeStyle = drag?.dropSq ? rgba(colors.green, 0.55) : rgba(colors.cyan, 0.28);
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(a[0], a[1]);
	ctx.lineTo(b[0], b[1]);
	ctx.stroke();
	ctx.restore();
}

// Rank and file letters, painted flat on the board's rim so they turn with it.
function drawCoords() {
	ctx.save();
	ctx.font = '11px var(--font-mono, monospace)';
	ctx.fillStyle = rgba(colors.cyan, 0.55);
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	for (const sq of scene.squares) {
		let label = null;
		if (sq.y === 0) label = sq.alg[0];
		else if (sq.x === 0) label = sq.alg[1];
		if (!label) continue;
		const off = sq.y === 0 ? [sq.x + 0.5, -0.28] : [-0.28, sq.y + 0.5];
		const q = project([off[0], off[1], 0]);
		ctx.fillText(label, q[0], q[1]);
	}
	ctx.restore();
}

function requestDraw() {
	if (frameQueued) return;
	frameQueued = true;
	requestAnimationFrame(draw);
}

// ── Picking ──────────────────────────────────────────────────────────────────

function pointInPoly(px, py, pts) {
	let inside = false;
	for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
		const [xi, yi] = pts[i], [xj, yj] = pts[j];
		if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

// Nearest square under the cursor. Squares are tested near-to-far so a click
// that lands on two of them (impossible on a flat plane, but the rim is not
// flat) resolves to the one in front.
function pickSquare(px, py) {
	let best = null, bestDepth = Infinity;
	for (const sq of scene.squares) {
		if (!sq.cmd) continue;
		const quad = [[sq.x, sq.y, 0], [sq.x + 1, sq.y, 0], [sq.x + 1, sq.y + 1, 0], [sq.x, sq.y + 1, 0]]
			.map(project);
		if (pointInPoly(px, py, quad)) {
			const d = quad.reduce((a, q) => a + q[2], 0) / 4;
			if (d < bestDepth) { bestDepth = d; best = sq; }
		}
	}
	return best;
}

function pieceAt(x, y) {
	return scene?.pieces.find(p => p.x === x && p.y === y) || null;
}

// ── Dragging ─────────────────────────────────────────────────────────────────

// The inverse of project(), for the one case that has a closed form: a point of
// KNOWN height. That's all a drag needs — the hand carries the piece on a fixed
// horizontal plane at HOVER, so the cursor ray meets it exactly once and the
// answer falls out of project()'s own algebra rather than out of a search.
function unproject(px, py, dz) {
	const u = px - canvas.clientWidth / 2;
	const v = (canvas.clientHeight / 2 + canvas.clientHeight * 0.06) - py;
	const ce = Math.cos(cam.pitch), se = Math.sin(cam.pitch);
	const den = v * ce - cam.f * se;
	// Degenerate only if the plane is edge-on to the camera, which the pitch
	// clamp forbids — but a divide that can produce Infinity is worth the guard.
	if (Math.abs(den) < 1e-6) return null;
	const y1 = (cam.f * dz * ce + v * dz * se - v * cam.dist) / den;
	const depth = y1 * ce - dz * se + cam.dist;
	if (depth < 0.3) return null;
	const x1 = (u * depth) / cam.f;
	const ca = Math.cos(cam.yaw), sa = Math.sin(cam.yaw);
	return [4 + x1 * ca - y1 * sa, 4 + x1 * sa + y1 * ca];
}

// Where a carried piece would land — read off the piece's own foot, which is a
// point on the BOARD PLANE and therefore the same point the cursor is over.
//
// The first pass carried the piece on a plane at HOVER height, and that is what
// made the drop feel broken anywhere but straight down. A cursor ray meets the
// hover plane and the board plane at two different places — several ranks apart
// at a low pitch — so the piece hung visibly over one square while the ring lit
// on another, and the middle of a tile, which is exactly where a player aims,
// could resolve to a square nowhere near the piece in their hand.
//
// The fix isn't a smarter pick, it's removing the second plane: the hand travels
// ON the board and the piece is drawn hanging ABOVE that point. Cursor, tether
// foot, ring and drop are then one square by construction, at every camera
// angle, with nothing to tune.
function dropTarget() {
	if (!drag || !scene) return null;
	const fx0 = Math.floor(drag.wx), fy0 = Math.floor(drag.wy);
	const sq = scene.squares.find(s => s.x === fx0 && s.y === fy0);
	return sq?.cmd?.startsWith('chessmove') ? sq : null;
}

// Picking a piece up. The SELECT still goes to the server immediately — this is
// the same `chesspick` a click sends, and the targets that come back are the
// only squares the drop is allowed to land on. The drag is presentation over
// the two-step the server already runs; the client still computes no legality.
function startDrag(sq, pc, px, py) {
	const at = unproject(px, py, 0) || [sq.x + 0.5, sq.y + 0.5];
	drag = {
		from: { x: sq.x, y: sq.y },
		type: pc.type, white: pc.white,
		wx: at[0], wy: at[1],
		tiltX: 0, tiltY: 0, velX: 0, velY: 0, handX: 0, handY: 0,
		dropSq: null, lastT: 0, fired: false,
	};
	// `chesspick none` means this piece is ALREADY the selected one — its targets
	// are on screen and firing it again would put it down before we'd moved.
	if (sq.cmd && sq.cmd !== 'chesspick none') fireCmd(sq.cmd, null);
	if (canvas) canvas.style.cursor = 'grabbing';
	requestDraw();
}

function moveDrag(px, py) {
	if (!drag) return;
	const at = unproject(px, py, 0);
	if (!at) return;
	const now = performance.now();
	const dt = drag.lastT ? Math.min(0.05, (now - drag.lastT) / 1000) : 0;
	if (dt > 0.001) {
		// Blended rather than raw: a mouse delivers movement in bursts, and the
		// pendulum driven off a raw per-event speed jitters instead of swinging.
		drag.handX = drag.handX * 0.45 + ((at[0] - drag.wx) / dt) * 0.55;
		drag.handY = drag.handY * 0.45 + ((at[1] - drag.wy) / dt) * 0.55;
	}
	drag.lastT = now;
	drag.wx = at[0]; drag.wy = at[1];
	drag.dropSq = dropTarget();
	startSway();
	requestDraw();
}

// The pendulum integrates on its own clock, because the swing has to keep moving
// (and settle) after the hand stops — the whole point of overshoot is that it
// outlives the input that caused it.
function startSway() {
	if (swayRaf || !drag) return;
	drag.lastT = drag.lastT || performance.now();
	swayRaf = requestAnimationFrame(sway);
}

function sway(t) {
	swayRaf = 0;
	if (!drag) return;
	const dt = Math.min(0.05, Math.max(0.001, (t - (drag.swayT || t)) / 1000));
	drag.swayT = t;
	// The hand's remembered speed bleeds off, so a hand that stops moving pulls
	// the target back to vertical and the spring carries the piece home.
	const bleed = Math.exp(-SWAY_VEL_DECAY * dt);
	drag.handX *= bleed; drag.handY *= bleed;
	const clamp = a => Math.max(-SWAY_MAX, Math.min(SWAY_MAX, a));
	// Signs: the piece hangs BELOW the hang point, so a positive tilt about Y
	// throws its foot in −x. Moving the hand toward +x should leave the foot
	// behind, which is what makes it trail rather than lead.
	const tgtY = clamp(drag.handX * SWAY_PER_SPEED);
	const tgtX = clamp(-drag.handY * SWAY_PER_SPEED);
	const step = (ang, vel, tgt) => {
		vel += (tgt - ang) * SWAY_STIFF * dt;
		vel *= Math.exp(-SWAY_DAMP * dt);
		return [ang + vel * dt, vel];
	};
	[drag.tiltX, drag.velX] = step(drag.tiltX, drag.velX, tgtX);
	[drag.tiltY, drag.velY] = step(drag.tiltY, drag.velY, tgtY);
	requestDraw();
	const moving = Math.abs(drag.tiltX) + Math.abs(drag.tiltY) > SWAY_REST
		|| Math.abs(drag.velX) + Math.abs(drag.velY) > SWAY_REST * 4;
	if (moving) swayRaf = requestAnimationFrame(sway);
}

function endDrag() {
	drag = null;
	if (swayRaf) cancelAnimationFrame(swayRaf);
	swayRaf = 0;
	if (canvas) canvas.style.cursor = 'grab';
	requestDraw();
}

// Letting go. Three outcomes, and the third is the interesting one.
function resolveDrop(px, py, ev) {
	const from = drag.from;
	// Did the board we're looking at come back from OUR pickup yet? A fast drag
	// beats the round trip, and dropping on a square the server hasn't marked
	// would silently cancel a move the player made correctly. So the drop waits
	// for the update instead (see mountChess3D).
	const settled = scene.squares.some(s => s.selected && s.x === from.x && s.y === from.y);
	// The square under the PIECE, never the one under the cursor — the release
	// has to honour the ring the player was looking at when they let go. See
	// dropTarget.
	const at = unproject(px, py, 0);
	if (at) { drag.wx = at[0]; drag.wy = at[1]; }
	const fx0 = Math.floor(drag.wx), fy0 = Math.floor(drag.wy);
	const sq = scene.squares.find(s => s.x === fx0 && s.y === fy0) || null;
	endDrag();
	if (!sq) { cancelPick(ev); return; }
	if (!settled) { pendingDrop = { x: sq.x, y: sq.y }; return; }
	if (sq.cmd?.startsWith('chessmove')) { fireCmd(sq.cmd, ev); return; }
	// Dropped back where it came from: that's a click, and a click leaves the
	// piece picked up with its targets showing.
	if (sq.x === from.x && sq.y === from.y) return;
	cancelPick(ev);
}

// Put it back down. The deselect verb is the SELECTED square's own command — the
// server writes `chesspick none` there — rather than a string this file invents.
function cancelPick(ev) {
	const sel = scene?.squares.find(s => s.selected && s.cmd);
	if (sel) fireCmd(sel.cmd, ev);
}

// ── Mount ────────────────────────────────────────────────────────────────────

// Called after every table_update. The pane is brand new markup each time, so
// this re-reads the board and re-attaches — but the CAMERA survives, which is
// the thing that would be maddening to lose on every move.
export function mountChess3D(paneRoot) {
	const pane = (paneRoot || document).querySelector('.chess-pane');
	const wrap = pane?.querySelector('.chess-stage-wrap');
	if (!pane || !wrap) { unmountChess3D(); return; }

	const parsed = parsePane(pane);
	if (!parsed) { unmountChess3D(); return; }
	scene = parsed;
	colors = readColors(pane);
	if (!cam) cam = loadCam();

	syncFx();

	// A drag survives the remount it caused — but only if the piece is still
	// there. If the server moved or refused it, the hand is empty.
	if (drag && !pieceAt(drag.from.x, drag.from.y)) endDrag();
	// A drop that beat the server's reply, now cashed against the board that
	// finally arrived.
	if (pendingDrop) {
		const sq = scene.squares.find(s => s.x === pendingDrop.x && s.y === pendingDrop.y);
		pendingDrop = null;
		if (sq?.cmd?.startsWith('chessmove')) fireCmd(sq.cmd, null);
		else cancelPick(null);
	}

	wrap.innerHTML = '';
	wrap.classList.add('chess-3d');
	canvas = document.createElement('canvas');
	canvas.className = 'chess-canvas';
	wrap.appendChild(canvas);
	ctx = canvas.getContext('2d');

	detachInput?.();
	attachInput(pane);
	resizeObs?.disconnect();
	resizeObs = new ResizeObserver(requestDraw);
	resizeObs.observe(wrap);
	requestDraw();
}

export function unmountChess3D() {
	if (drag) endDrag();
	pendingDrop = null;
	stopFx();
	// Deliberately NOT cleared: coming back to a board that is still in check
	// should say so again, because you weren't looking the first time.
	lastCheck = null;
	lastMate = false;
	detachInput?.();
	resizeObs?.disconnect();
	resizeObs = null;
	canvas = null;
	ctx = null;
	scene = null;
}

// How much travel stops counting as a tap. Generous, because a finger on glass
// always moves a few pixels and a thumb on a phone moves more than that.
const TAP_SLOP = 10;

// Playing and looking are SEPARATE GESTURES, and conflating them is why a
// left-drag used to eat the move you were trying to make: the same press both
// picked a piece up and swung the camera, so the tiny drift between pressing and
// releasing on a piece counted as an orbit and the move never fired.
//
// Mouse: left is the game, middle and right are the camera. Left-dragging over
// empty board still orbits — it's the discoverable gesture and costs nothing,
// because a press that starts on a playable square is claimed by the game before
// the camera ever sees it.
//
// Touch has no buttons to split on, so it splits on FINGER COUNT: one finger taps
// to play and drags to orbit, two fingers pinch to zoom and twist to orbit. A tap
// is judged by distance, not by which element it landed on — there is only one
// element, and it's a canvas.
function attachInput(pane) {
	// A drag in flight re-adopts the fresh listeners: every table_update rebuilds
	// this closure, and a mode that reset to null here would leave the piece
	// hanging with nothing listening for the release.
	let mode = drag ? 'drag' : null;   // 'orbit' | 'play' | 'drag' | null
	let moved = 0, lx = 0, ly = 0;
	let pinchDist = 0;

	const orbitTo = (x, y) => {
		cam.yaw += (x - lx) * 0.008;
		cam.pitch = Math.max(0.12, Math.min(1.45, cam.pitch + (y - ly) * 0.006));
		lx = x; ly = y;
		requestDraw();
	};
	const atCanvas = (x, y) => {
		const rect = canvas.getBoundingClientRect();
		return [x - rect.left, y - rect.top];
	};

	// ── Mouse ────────────────────────────────────────────────────────────────
	canvas.addEventListener('mousedown', e => {
		moved = 0; lx = e.clientX; ly = e.clientY;
		if (e.button === 0) {
			// Left on a playable square is a move, full stop — the camera doesn't
			// get a vote. Left anywhere else falls through to orbit.
			const at = atCanvas(e.clientX, e.clientY);
			const sq = pickSquare(...at);
			const pc = sq && pieceAt(sq.x, sq.y);
			// One of your own pieces comes off the board into your hand. A capture
			// square carries `chessmove` and stays an ordinary click.
			if (sq?.cmd?.startsWith('chesspick') && pc) {
				startDrag(sq, pc, ...at);
				mode = 'drag';
			} else mode = sq?.cmd ? 'play' : 'orbit';
		} else {
			mode = 'orbit';    // middle and right are always the camera
			e.preventDefault();
		}
	});
	// Right-drag is an orbit, so the context menu would fire on every release.
	canvas.addEventListener('contextmenu', e => e.preventDefault());

	// The drag listeners live on WINDOW so an orbit that runs off the edge of the
	// canvas keeps working. Every table_update remounts, so they're torn down
	// explicitly — hanging a fresh pair on window per move is how you end up with
	// forty stale closures by the endgame.
	const onWinMove = e => {
		if (!mode) return;
		moved += Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly);
		if (mode === 'orbit') orbitTo(e.clientX, e.clientY);
		else {
			lx = e.clientX; ly = e.clientY;
			if (mode === 'drag') moveDrag(...atCanvas(e.clientX, e.clientY));
		}
	};
	const onWinUp = e => {
		if (!mode) return;
		const wasPlay = mode === 'play';
		const wasDrag = mode === 'drag';
		mode = null;
		if (wasDrag) {
			if (drag) resolveDrop(...atCanvas(e.clientX, e.clientY), e);
			return;
		}
		if (!wasPlay) { saveCam(); return; }
		// A press that started on a piece stays a move even if the hand wandered:
		// the alternative is a player who "clicked" and nothing happened.
		if (moved > TAP_SLOP * 4) return;
		const sq = pickSquare(...atCanvas(e.clientX, e.clientY));
		if (sq?.cmd) fireCmd(sq.cmd, e);
	};
	window.addEventListener('mousemove', onWinMove);
	window.addEventListener('mouseup', onWinUp);
	detachInput = () => {
		window.removeEventListener('mousemove', onWinMove);
		window.removeEventListener('mouseup', onWinUp);
		detachInput = null;
	};

	// ── Touch ────────────────────────────────────────────────────────────────
	const spread = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

	canvas.addEventListener('touchstart', e => {
		if (e.touches.length >= 2) {
			mode = 'pinch';
			pinchDist = spread(e.touches);
			return;
		}
		const t = e.touches[0];
		mode = 'tap';                 // becomes 'orbit' the moment it travels
		moved = 0; lx = t.clientX; ly = t.clientY;
	}, { passive: true });

	canvas.addEventListener('touchmove', e => {
		if (mode === 'pinch' && e.touches.length >= 2) {
			const d = spread(e.touches);
			// Pinch OUT (fingers apart) should bring the board closer, so the sign
			// is inverted against distance.
			cam.dist = Math.max(7, Math.min(26, cam.dist - (d - pinchDist) * 0.04));
			pinchDist = d;
			requestDraw();
			e.preventDefault();
			return;
		}
		if (!mode || mode === 'pinch') return;
		const t = e.touches[0];
		moved += Math.abs(t.clientX - lx) + Math.abs(t.clientY - ly);
		if (moved > TAP_SLOP) mode = 'orbit';
		if (mode === 'orbit') orbitTo(t.clientX, t.clientY);
		else { lx = t.clientX; ly = t.clientY; }
		e.preventDefault();
	}, { passive: false });

	canvas.addEventListener('touchend', e => {
		const wasTap = mode === 'tap';
		// Don't clear the mode while a second finger is still down mid-pinch.
		if (e.touches.length === 0) mode = null;
		if (!wasTap) { saveCam(); return; }
		const t = e.changedTouches[0];
		const sq = pickSquare(...atCanvas(t.clientX, t.clientY));
		if (sq?.cmd) fireCmd(sq.cmd, e);
	}, { passive: true });

	canvas.addEventListener('wheel', e => {
		e.preventDefault();
		cam.dist = Math.max(7, Math.min(26, cam.dist + Math.sign(e.deltaY) * 0.8));
		requestDraw();
		saveCam();
	}, { passive: false });

	// The cursor is the only thing telling a mouse user which of the two gestures
	// they're about to get, so it has to be right on every pixel.
	canvas.addEventListener('mousemove', e => {
		if (mode) return;
		canvas.style.cursor = pickSquare(...atCanvas(e.clientX, e.clientY)) ? 'pointer' : 'grab';
	});

	// The view bar still works — it's the touch route to the same camera, and the
	// only way back to a sane angle after a wild orbit.
	pane.querySelectorAll('.chess-view').forEach(btn => {
		btn.addEventListener('click', () => nudgeCam(btn.dataset.view));
	});
}

function nudgeCam(which) {
	switch (which) {
		case 'left': cam.yaw -= Math.PI / 12; break;
		case 'right': cam.yaw += Math.PI / 12; break;
		case 'up': cam.pitch = Math.min(1.45, cam.pitch + 0.12); break;
		case 'down': cam.pitch = Math.max(0.12, cam.pitch - 0.12); break;
		default: cam.yaw = 0; cam.pitch = 0.92; cam.dist = 13.5;
	}
	requestDraw();
	saveCam();
}

// Squares carry the literal verb the server put there; firing it is the whole of
// the client's authority over the game.
function fireCmd(cmd, ev) {
	const el = document.createElement('button');
	el.className = 'poker-cmd';
	el.dataset.cmd = cmd;
	el.style.display = 'none';
	// Dispatch through the existing delegated .poker-cmd listener in main.js
	// rather than importing sendCmd — same path a flat-board click takes.
	const host = document.getElementById('area-content');
	if (!host) return;
	host.appendChild(el);
	el.click();
	el.remove();
	if (ev) ev.preventDefault?.();
}

// ── Smoke-test seams ─────────────────────────────────────────────────────────
// Used only by scripts/shapes/chess3d-smoke.mjs, which is the one thing that
// ever executes this geometry outside a browser. Exported rather than reached
// for through the DOM because a test driving the camera through a synthesised
// click event would be testing the event system, not the renderer.
export const __smokeView = (which) => nudgeCam(which);
export const __smokePick = (px, py) => pickSquare(px, py);
// The two-sink split is what stopped pieces vanishing under the far ranks, and
// nothing about a merged sink LOOKS wrong until you orbit — so the smoke asserts
// the split directly.
export const __smokeFaces = () => buildFaces();
// The drag, driven the way a hand drives it. Exported because the swing runs off
// a rAF clock and a pointer that isn't in the room — there is no way to reach it
// from the DOM, and an untested pendulum is a pendulum that divides by zero on
// the first frame.
export const __smokeDrag = {
	start: (fx, fy, px, py) => {
		const sq = scene.squares.find(s => s.x === fx && s.y === fy);
		const pc = pieceAt(fx, fy);
		if (sq && pc) startDrag(sq, pc, px, py);
		return !!drag;
	},
	move: (px, py) => { moveDrag(px, py); return drag ? [drag.wx, drag.wy] : null; },
	swing: t => { sway(t); return drag ? [drag.tiltX, drag.tiltY] : null; },
	end: () => endDrag(),
	unproject: (px, py, z) => unproject(px, py, z),
};
// Check and checkmate run on a clock nothing in a test can wait for, so the
// clock is the seam: force the effect and scrub it to an instant.
export const __smokeFx = (kind, x, y, t) => {
	startFx(kind, x, y);
	fx.t = t;
	return fx;
};
export const __smokeFxOff = () => stopFx();

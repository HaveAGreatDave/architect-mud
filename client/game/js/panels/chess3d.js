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
//   • a depth-sorted FACE SINK, because a 2D context has no z-buffer, so faces
//     are queued with their camera depth and painted back→front (windshield's
//     emitFace/flushFaces; here `face()` + the sort in draw()),
//   • per-face lighting from the face normal, not per-pixel.
// The one deliberate divergence: windshield queues CLOSURES because a building
// face can paint itself in a dozen different ways. Every face here is a filled
// polygon, so the sink holds plain geometry and skips the closure allocation —
// there are ~4000 of them per frame.
//
// Rendering is ON DEMAND, never a rAF loop: the scene is static between moves,
// so it redraws when the camera moves or the pane changes and otherwise costs
// nothing. That's what makes 4000 faces in a 2D context affordable.

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
	return { squares, pieces };
}

// Team colours come from the pane's own CSS variables, so the board still tracks
// the room palette rather than hardcoding two hexes here.
function readColors(pane) {
	const cs = getComputedStyle(pane);
	const pick = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
	return {
		white: pick('--chess-white', '#38e0d8'),
		black: pick('--chess-black', '#e2479f'),
		accent: pick('--cyan', '#38e0d8'),
	};
}

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
// One list, one sort, one pass — which is the whole reason a scene this size can
// be drawn with a 2D context and still look solid.
function buildFaces() {
	const sink = [];
	const face = (pts, fill, opts = {}) => {
		let d = 0;
		const proj = pts.map(p => { const q = project(p); d += q[2]; return q; });
		sink.push({ proj, fill, depth: d / pts.length, ...opts });
	};

	// The slab: top surface is drawn per-square below, so this is just the sides
	// and the underside rim that gives the board an edge when you orbit low.
	const z0 = -SLAB;
	const corners = [[0, 0], [BOARD, 0], [BOARD, BOARD], [0, BOARD]];
	for (let i = 0; i < 4; i++) {
		const a = corners[i], b = corners[(i + 1) % 4];
		face([[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], 0], [a[0], a[1], 0]],
			'#0a121a', { stroke: colors.accent, strokeAlpha: 0.5 });
	}
	face([[0, 0, z0], [BOARD, 0, z0], [BOARD, BOARD, z0], [0, BOARD, z0]], '#05080c');

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
			face(discPts(x + 0.5, y + 0.5, 0.16, 0.02), 'rgba(90,255,170,0.85)', { glow: '#5affaa' });
		}
	}

	for (const pc of scene.pieces) pieceFaces(pc, face);
	return sink;
}

function discPts(cx, cy, r, z) {
	const pts = [];
	for (let i = 0; i < 10; i++) {
		const t = (i / 10) * Math.PI * 2;
		pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r, z]);
	}
	return pts;
}

function squareFill(sq) {
	if (sq.check) return 'rgba(210,40,60,0.75)';
	if (sq.selected) return 'rgba(240,200,60,0.72)';
	if (sq.capture) return 'rgba(220,60,70,0.45)';
	if (sq.target) return 'rgba(60,220,150,0.28)';
	if (sq.lastTo) return 'rgba(150,90,240,0.34)';
	if (sq.lastFrom) return 'rgba(120,70,200,0.20)';
	return sq.light ? '#16242e' : '#070b10';
}
function squareStroke(sq) {
	if (sq.check) return '#ff4060';
	if (sq.selected) return '#ffd23c';
	if (sq.capture) return '#ff5a68';
	if (sq.target) return '#5affaa';
	return 'rgba(120,200,220,0.10)';
}
function squareGlow(sq) {
	if (sq.check) return '#ff4060';
	if (sq.selected) return '#ffd23c';
	if (sq.target || sq.capture) return '#5affaa';
	return null;
}

// A lathe: spin the silhouette, emit a quad per (profile segment × radial
// segment), and shade each one off its own normal. The normal is exact rather
// than faked — for a surface of revolution it falls straight out of the profile
// slope, which is what keeps the highlight running cleanly up the body instead
// of banding.
function pieceFaces(pc, face) {
	const prof = PROFILES[pc.type];
	const cx = pc.x + 0.5, cy = pc.y + 0.5;
	const base = pc.lifted ? 0.28 : 0;     // a picked-up piece actually lifts
	const tint = pc.white ? colors.white : colors.black;
	const rgb = toRgb(tint);

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

	// The contact shadow, on the board plane. A piece with no shadow floats no
	// matter how good its shading is.
	face(discPts(cx, cy, prof[0][0] * 1.35, 0.004), 'rgba(0,0,0,0.55)', { soft: true });
	if (pc.checked) {
		face(discPts(cx, cy, prof[0][0] * 1.7, 0.006), 'rgba(255,60,80,0.30)', { soft: true, glow: '#ff4060' });
	}
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

function toRgb(css) {
	// The pane's colour vars may be hex or a colour function; let the browser
	// resolve whatever it is exactly once, at parse time.
	const d = document.createElement('span');
	d.style.color = css;
	document.body.appendChild(d);
	const m = getComputedStyle(d).color.match(/[\d.]+/g);
	d.remove();
	return m ? [+m[0], +m[1], +m[2]] : [80, 220, 210];
}

// Lambert plus a fixed ambient floor and a rim term. The rim is what makes this
// read as neon-lit rather than as a plastic toy: edges turning away from the
// light still catch the team colour instead of going black.
function shade(rgb, n) {
	const d = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
	const rim = Math.pow(1 - Math.abs(n[2]), 2) * 0.35;
	const k = 0.22 + d * 0.85 + rim;
	const r = Math.min(255, rgb[0] * k + 255 * Math.max(0, d - 0.82) * 0.9);
	const g = Math.min(255, rgb[1] * k + 255 * Math.max(0, d - 0.82) * 0.9);
	const b = Math.min(255, rgb[2] * k + 255 * Math.max(0, d - 0.82) * 0.9);
	return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// ── Draw ─────────────────────────────────────────────────────────────────────

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
	g.addColorStop(0, 'rgba(60,190,220,0.13)');
	g.addColorStop(1, 'rgba(0,0,0,0)');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, w, h);

	const sink = buildFaces();
	sink.sort((a, b) => b.depth - a.depth);   // far to near, painter's order

	for (const poly of sink) {
		const p = poly.proj;
		ctx.beginPath();
		ctx.moveTo(p[0][0], p[0][1]);
		for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
		ctx.closePath();
		if (poly.glow) {
			ctx.shadowColor = poly.glow;
			ctx.shadowBlur = 18;
		}
		if (poly.soft) ctx.filter = 'blur(3px)';
		ctx.fillStyle = poly.fill;
		ctx.fill();
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

	drawCoords();
}

// Rank and file letters, painted flat on the board's rim so they turn with it.
function drawCoords() {
	ctx.save();
	ctx.font = '11px var(--font-mono, monospace)';
	ctx.fillStyle = 'rgba(140,220,235,0.55)';
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
	detachInput?.();
	resizeObs?.disconnect();
	resizeObs = null;
	canvas = null;
	ctx = null;
	scene = null;
}

function attachInput(pane) {
	let dragging = false, moved = 0, lx = 0, ly = 0;

	const down = (x, y) => { dragging = true; moved = 0; lx = x; ly = y; };
	const move = (x, y) => {
		if (!dragging) return;
		moved += Math.abs(x - lx) + Math.abs(y - ly);
		cam.yaw += (x - lx) * 0.008;
		cam.pitch = Math.max(0.12, Math.min(1.45, cam.pitch + (y - ly) * 0.006));
		lx = x; ly = y;
		requestDraw();
	};
	const up = (x, y, ev) => {
		if (!dragging) return;
		dragging = false;
		if (moved > 6) { saveCam(); return; }   // that was an orbit, not a click
		const rect = canvas.getBoundingClientRect();
		const sq = pickSquare(x - rect.left, y - rect.top);
		if (sq?.cmd) fireCmd(sq.cmd, ev);
	};

	canvas.addEventListener('mousedown', e => { e.preventDefault(); down(e.clientX, e.clientY); });
	// The drag listeners live on WINDOW so an orbit that runs off the edge of the
	// canvas keeps working. Every table_update remounts, so they're torn down
	// explicitly — hanging a fresh pair on window per move is how you end up with
	// forty stale closures by the endgame.
	const onWinMove = e => { if (dragging) move(e.clientX, e.clientY); };
	const onWinUp = e => { if (dragging) up(e.clientX, e.clientY, e); };
	window.addEventListener('mousemove', onWinMove);
	window.addEventListener('mouseup', onWinUp);
	detachInput = () => {
		window.removeEventListener('mousemove', onWinMove);
		window.removeEventListener('mouseup', onWinUp);
		detachInput = null;
	};

	canvas.addEventListener('touchstart', e => { const t = e.touches[0]; down(t.clientX, t.clientY); }, { passive: true });
	canvas.addEventListener('touchmove', e => { const t = e.touches[0]; move(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
	canvas.addEventListener('touchend', e => { const t = e.changedTouches[0]; up(t.clientX, t.clientY, e); }, { passive: true });

	canvas.addEventListener('wheel', e => {
		e.preventDefault();
		cam.dist = Math.max(7, Math.min(26, cam.dist + Math.sign(e.deltaY) * 0.8));
		requestDraw();
		saveCam();
	}, { passive: false });

	canvas.addEventListener('mousemove', e => {
		if (dragging) return;
		const rect = canvas.getBoundingClientRect();
		canvas.style.cursor = pickSquare(e.clientX - rect.left, e.clientY - rect.top) ? 'pointer' : 'grab';
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

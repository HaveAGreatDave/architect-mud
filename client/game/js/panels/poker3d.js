// Poker in 3D: a canvas renderer laid over the gametable felt pane, for a table whose config says view3d.
//
// It decides nothing. The server renders the pane as before and puts the table's state on the wrap as
// JSON (`data-p3d`, written by plugins/gametable/render-pane.js state3d); this draws that state as a
// scene: a racetrack table in walnut and baize, the chairs round it, whoever sits in them, their cards,
// their bets, the board and the pot. The command bar under the felt stays the only way to act.
//
// Drawn the way chess3d.js is, and for the same reasons: no WebGL, no library, a camera that projects
// world points, faces queued with their depth and painted back to front, lit per face from its normal.
// It redraws on demand (a drag, a resize, a new pane) and runs a frame loop only while a card is in the air.

const CAM_KEY = 'pokerCam3d.v2';
const TOP = 0.78;                 // the baize's height
const HW = 1.25, HD = 0.725;      // the table's half length and half depth
const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
// a four-colour deck, so a suit reads by its colour before its shape: hearts red, diamonds blue, clubs green, spades black
const INK = { s: '#15151a', h: '#c4162a', d: '#1d5fc4', c: '#17803c' };
const inkOf = (c) => INK[c?.suit] || '#15151a';
const rankOf = (c) => String(c?.rank || '?').toUpperCase().replace('T', '10');
const CHIP = ['#e9e4d8', '#b8262c', '#1d4a8a', '#1a1a1a', '#2e7a3a'];
const LIGHT = norm([0.35, 1, 0.55]);
const DEAL_MS = 380, STAGGER = 90;

let canvas = null, ctx = null, wrapEl = null, state = null, cam = null, resizeObs = null, detach = null;
let raf = 0, drawQueued = false;
// cards in the air: key → start time. A card the table didn't have last time flies in from the deck.
let seen = new Set(), flying = new Map();

// ── Maths ────────────────────────────────────────────────────────────────────
function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 1 - Math.pow(1 - t, 3);

function shade(hex, k) {
	const n = parseInt(hex.slice(1), 16);
	const c = (x) => Math.max(0, Math.min(255, Math.round(x * k)));
	return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

function loadCam() {
	try { const c = JSON.parse(localStorage.getItem(CAM_KEY)); if (c && Number.isFinite(c.yaw)) return c; } catch { /* no storage */ }
	return { yaw: 0, pitch: 0.82, dist: 5.4 };
}
function saveCam() { try { localStorage.setItem(CAM_KEY, JSON.stringify(cam)); } catch { /* no storage */ } }

// The camera orbits the middle of the table. Yaw 0 sits behind your own chair, looking across.
let V = null;
function setupView(w, h) {
	const tgt = [0, TOP - 0.05, 0];
	const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
	const eye = [tgt[0] + Math.sin(cam.yaw) * cp * cam.dist, tgt[1] + sp * cam.dist, tgt[2] + Math.cos(cam.yaw) * cp * cam.dist];
	const fwd = norm(sub(tgt, eye)), right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
	V = { eye, fwd, right, up, f: Math.min(w, h * 1.5) * 1.05, cx: w / 2, cy: h * 0.5 };
}
function project(p) {
	const d = sub(p, V.eye), z = dot(d, V.fwd);
	if (z < 0.05) return null;
	return [V.cx + dot(d, V.right) / z * V.f, V.cy - dot(d, V.up) / z * V.f, z];
}

// ── Faces ────────────────────────────────────────────────────────────────────
// A face is a polygon with a colour, lit from its normal; a group is several drawn in a fixed order at
// one depth (the stacked layers of the table top, a chair), so coplanar layers never fight.
let faces = [];
function face(pts, hex, { k = 1, out = null, flat = false, stroke = null } = {}) {
	const P = pts.map(project);
	if (P.some((q) => !q)) return null;
	let n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
	// back faces go, unless the face is flat paint lying on something
	const toEye = sub(V.eye, pts[0]);
	if (!flat && dot(n, toEye) < 0) return null;
	if (dot(n, toEye) < 0) n = n.map((x) => -x);
	const lit = flat ? 1 : 0.55 + 0.55 * Math.max(0, dot(n, LIGHT));
	const f = { P, fill: shade(hex, lit * k), stroke, depth: P.reduce((a, q) => a + q[2], 0) / P.length };
	(out || faces).push(f);
	return f;
}
function paint(f) {
	if (f.draw) { f.draw(); return; }
	ctx.beginPath();
	f.P.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
	ctx.closePath();
	ctx.fillStyle = f.fill; ctx.fill();
	if (f.stroke) { ctx.strokeStyle = f.stroke; ctx.lineWidth = 1; ctx.stroke(); } else { ctx.strokeStyle = f.fill; ctx.lineWidth = 0.6; ctx.stroke(); }
}
function group(depthAt, build) {
	const out = [];
	build(out);
	const q = project(depthAt);
	faces.push({ depth: q ? q[2] : 0, draw: () => out.forEach(paint) });
}

// a box from x0..x1, y0..y1, z0..z1, turned by `rot` about (ox, oz)
function box(x0, x1, y0, y1, z0, z1, hex, opts = {}) {
	const { rot = 0, ox = 0, oz = 0, out = null, k = 1 } = opts;
	const c = Math.cos(rot), s = Math.sin(rot);
	const T = (x, y, z) => [ox + x * c + z * s, y, oz - x * s + z * c];
	const v = [T(x0, y0, z0), T(x1, y0, z0), T(x1, y0, z1), T(x0, y0, z1), T(x0, y1, z0), T(x1, y1, z0), T(x1, y1, z1), T(x0, y1, z1)];
	const sides = [[4, 7, 6, 5], [0, 1, 2, 3], [3, 2, 6, 7], [1, 0, 4, 5], [2, 1, 5, 6], [0, 3, 7, 4]];
	const local = [];
	for (const q of sides) face(q.map((i) => v[i]), hex, { out: local, k });
	local.sort((a, b) => b.depth - a.depth);
	(out || faces).push(...local);
}

// the table's racetrack outline, inset by `i`, at height y
function track(i, y, seg = 14) {
	const r = HD - i, L = HW - HD, pts = [];
	for (let k = 0; k <= seg; k++) { const a = -Math.PI / 2 + k / seg * Math.PI; pts.push([L + Math.cos(a) * r, y, Math.sin(a) * r]); }
	for (let k = 0; k <= seg; k++) { const a = Math.PI / 2 + k / seg * Math.PI; pts.push([-L + Math.cos(a) * r, y, Math.sin(a) * r]); }
	return pts;
}
function flatPoly(pts, hex, out, k = 1) {
	const P = pts.map(project);
	if (P.some((q) => !q)) return;
	const n = [0, 1, 0], lit = 0.75 + 0.3 * Math.max(0, dot(n, LIGHT));
	out.push({ P, fill: shade(hex, lit * k), depth: 0 });
}
// a band round the table's edge, between two outlines
function skirt(i, y0, y1, hex, out, k = 1) {
	const a = track(i, y0), b = track(i, y1), loc = [];
	for (let j = 0; j < a.length; j++) {
		const n = (j + 1) % a.length;
		face([a[j], a[n], b[n], b[j]], hex, { out: loc, k });
	}
	loc.sort((p, q) => q.depth - p.depth);
	out.push(...loc);
}
function disc(x, y, z, r, hex, out, { h = 0.004, k = 1, seg = 14 } = {}) {
	const ring = (yy) => Array.from({ length: seg }, (_, i) => { const a = i / seg * Math.PI * 2; return [x + Math.cos(a) * r, yy, z + Math.sin(a) * r]; });
	const lo = ring(y), hi = ring(y + h), loc = [];
	for (let i = 0; i < seg; i++) { const n = (i + 1) % seg; face([lo[i], lo[n], hi[n], hi[i]], hex, { out: loc, k: k * 0.85 }); }
	loc.sort((p, q) => q.depth - p.depth);
	out.push(...loc);
	flatPoly(hi, hex, out, k);
}

// ── The scene ────────────────────────────────────────────────────────────────
// Seats go round an oval, yours at the front and the rest clockwise, the way the flat pane deals them.
function seatPos(k, n, r = 1) {
	const a = Math.PI / 2 - k * Math.PI * 2 / n;
	return [Math.cos(a) * (HW + 0.45) * r, Math.sin(a) * (HD + 0.5) * r, a];
}
const towardMiddle = (k, n, f) => { const [x, z] = seatPos(k, n); return [x * f, z * f]; };
const DECK = [0, -HD + 0.3];

function buildScene(now) {
	faces = [];
	const n = state.n || 6;
	// the floor's shadow under the table
	const sh = track(-0.15, 0.001, 10).map(project);
	if (sh.every(Boolean)) faces.push({ depth: 1e9, draw: () => { ctx.beginPath(); sh.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill(); } });
	// two pedestals, drawn under everything
	const under = [];
	for (const s of [-1, 1]) {
		box(-0.07, 0.07, 0.08, TOP - 0.15, -0.07, 0.07, '#4a2e1e', { ox: s * (HW - HD * 0.95), out: under });
		for (let i = 0; i < 4; i++) box(-0.3, 0.3, 0.02, 0.08, -0.035, 0.035, '#4a2e1e', { ox: s * (HW - HD * 0.95), rot: Math.PI / 4 + i * Math.PI / 2, out: under });
	}
	faces.push({ depth: 1e8, draw: () => under.forEach(paint) });

	// the chairs and who's in them
	for (let k = 0; k < n; k++) chair(k, n);
	// the table and everything lying on it, one group
	group([0, TOP, 0], (out) => {
		skirt(0.06, TOP - 0.15, TOP - 0.05, '#5a3a26', out);
		skirt(0.05, TOP - 0.165, TOP - 0.145, '#c9a24a', out, 1.1);
		skirt(0, TOP - 0.05, TOP + 0.03, '#5a1a1c', out);
		flatPoly(track(0, TOP + 0.03), '#6a2224', out);
		flatPoly(track(0.13, TOP + 0.031), '#6a4428', out, 1.05);
		flatPoly(track(0.2, TOP + 0.032), '#c9a24a', out, 1.1);
		flatPoly(track(0.215, TOP + 0.033), '#1f5a34', out, 0.95);
		flatPoly(track(0.42, TOP + 0.034), '#b8923e', out, 0.8);
		flatPoly(track(0.43, TOP + 0.035), '#1f5a34', out, 0.95);
		onTable(out, now, n);
	});
	faces.sort((a, b) => b.depth - a.depth);
}

function chair(k, n) {
	const [x, z, a] = seatPos(k, n, 1.05);
	const rot = Math.atan2(-x, -z) + Math.PI; // the back away from the table
	const seat = state.seats[k];
	group([x, 0.5, z], (out) => {
		const o = { rot, ox: x, oz: z, out };
		for (const [lx, lz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) box(lx - 0.03, lx + 0.03, 0, 0.42, lz - 0.03, lz + 0.03, '#4a2e1e', o);
		box(-0.36, 0.36, 0.42, 0.5, -0.36, 0.36, '#5a3a26', o);
		box(-0.32, 0.32, 0.5, 0.56, -0.32, 0.32, '#6a1e20', o);
		box(-0.36, 0.36, 0.42, 1.0, 0.3, 0.38, '#5a3a26', o);
		box(-0.3, 0.3, 0.56, 0.94, 0.27, 0.3, '#6a1e20', o);
		for (const s of [-1, 1]) box(s * 0.36 - 0.035, s * 0.36 + 0.035, 0.5, 0.7, -0.3, 0.34, '#5a3a26', o);
		// your own figure would stand between you and the table, so the camera sits in your place instead
		if (seat && !seat.me) person(seat, x, z, rot, out);
	});
}

// a seated figure: a torso, shoulders, a head and two forearms on the rail
function person(seat, x, z, rot, out) {
	const coat = seat.me ? '#2d4f7a' : seat.bot ? '#5a4a6a' : '#3c5a3c';
	const o = { rot, ox: x, oz: z, out, k: seat.folded ? 0.55 : 1 };
	box(-0.2, 0.2, 0.56, 1.05, -0.02, 0.2, coat, o);
	box(-0.26, 0.26, 0.98, 1.08, -0.02, 0.2, coat, o);
	for (const s of [-1, 1]) {
		box(s * 0.22 - 0.05, s * 0.22 + 0.05, 0.8, 1.02, -0.05, 0.12, coat, o);
		box(s * 0.16 - 0.045, s * 0.16 + 0.045, 0.78, 0.86, -0.45, -0.05, coat, o);
		box(s * 0.16 - 0.04, s * 0.16 + 0.04, 0.78, 0.84, -0.53, -0.45, '#c89a78', o);
	}
	box(-0.05, 0.05, 1.08, 1.13, 0.03, 0.13, '#c89a78', o);
	const c = Math.cos(rot), s = Math.sin(rot), hx = x + 0.08 * s, hz = z + 0.08 * c;
	const q = project([hx, 1.24, hz]);
	if (q) out.push({ draw: () => { const r = 0.12 / q[2] * V.f; ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, Math.PI * 2); ctx.fillStyle = seat.folded ? '#7d6050' : '#c89a78'; ctx.fill(); ctx.beginPath(); ctx.arc(q[0], q[1] - r * 0.25, r * 1.02, Math.PI * 1.05, Math.PI * 1.95); ctx.fillStyle = seat.bot ? '#2a2220' : '#3a2a1a'; ctx.fill(); } });
}

// the cards, the chips, the deck and the button
function onTable(out, now, n) {
	// the deck at the dealer's end
	for (let i = 0; i < 8; i++) cardFlat(out, DECK[0] - 0.06, TOP + 0.036 + i * 0.002, DECK[1], 0, null, false, 0.96);
	// a chip caddy beside it
	box(0.12, 0.42, TOP + 0.035, TOP + 0.08, DECK[1] - 0.06, DECK[1] + 0.06, '#3a2418', { out });
	const live = new Set();
	// each seat's hole cards, bet and button
	state.seats.forEach((s, k) => {
		if (!s) return;
		const [hx, hz] = towardMiddle(k, n, 0.5);
		const yaw = Math.atan2(hx, hz);
		(s.cards || []).forEach((c, i) => {
			const key = `h${k}.${i}`;
			live.add(key);
			const t = flight(key, now, i);
			const ox = (i - 0.5) * 0.11;
			const px = hx + Math.cos(yaw) * ox, pz = hz - Math.sin(yaw) * ox;
			cardFlat(out, lerp(DECK[0], px, t), TOP + 0.037 + i * 0.001 + Math.sin(t * Math.PI) * 0.12, lerp(DECK[1], pz, t), yaw, c, !!c);
		});
		if (s.bet > 0) {
			const [bx, bz] = towardMiddle(k, n, 0.42);
			chips(out, bx, bz, s.bet);
		}
		if (s.dealer) {
			const [dx, dz] = towardMiddle(k, n, 0.52);
			disc(dx + 0.12, TOP + 0.036, dz, 0.035, '#f4f1e4', out, { h: 0.01 });
			const q = project([dx + 0.12, TOP + 0.047, dz]);
			if (q) out.push({ draw: () => { ctx.fillStyle = '#111'; ctx.font = `bold ${Math.max(7, 0.05 / q[2] * V.f)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('D', q[0], q[1]); } });
		}
		if (s.acting) {
			const [ax, az] = towardMiddle(k, n, 0.62);
			const ring = Array.from({ length: 18 }, (_, i) => { const a = i / 18 * Math.PI * 2; return [ax + Math.cos(a) * 0.17, TOP + 0.036, az + Math.sin(a) * 0.13]; }).map(project);
			if (ring.every(Boolean)) out.push({ draw: () => { ctx.beginPath(); ring.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.strokeStyle = `rgba(255,214,90,${0.55 + 0.35 * Math.sin(now / 220)})`; ctx.lineWidth = 2.5; ctx.stroke(); } });
		}
	});
	// the board, left to right across the middle
	(state.board || []).forEach((c, i) => {
		const key = `b${i}`;
		live.add(key);
		const t = flight(key, now, i);
		const x = (i - 2) * 0.16;
		cardFlat(out, lerp(DECK[0], x, t), TOP + 0.037 + Math.sin(t * Math.PI) * 0.1, lerp(DECK[1], 0.02, t), 0, c, t > 0.6, 1.06);
	});
	if (state.pot > 0) chips(out, 0, -0.2, state.pot, 1.6);
	for (const key of [...flying.keys()]) if (!live.has(key)) flying.delete(key);
	seen = live;
}

// how far a card is into its flight from the deck, 0..1; a card that's been here since the last frame is 1
function flight(key, now, i) {
	if (!seen.has(key) && !flying.has(key)) flying.set(key, now + i * STAGGER);
	const t0 = flying.get(key);
	if (t0 == null) return 1;
	const t = Math.max(0, Math.min(1, (now - t0) / DEAL_MS));
	if (t >= 1) { flying.delete(key); return 1; }
	return ease(t);
}

// a card lying flat: `c` is {rank, suit} face up, or null face down
function cardFlat(out, x, y, z, yaw, c, faceUp, k = 1) {
	// cards are drawn half as big again as life, so a rank reads from across the table
	const w = 0.05, d = 0.072, cs = Math.cos(yaw), sn = Math.sin(yaw);
	const T = (a, b) => [x + a * cs + b * sn, y, z - a * sn + b * cs];
	const pts = [T(-w, -d), T(w, -d), T(w, d), T(-w, d)];
	const P = pts.map(project);
	if (P.some((q) => !q)) return;
	out.push({ draw: () => {
		ctx.beginPath(); P.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath();
		ctx.fillStyle = faceUp ? shade('#f6f2e8', k) : shade('#9a1c22', k); ctx.fill();
		ctx.strokeStyle = faceUp ? '#8a8478' : '#e8d3a0'; ctx.lineWidth = 0.8; ctx.stroke();
		if (!faceUp || !c) return;
		// an inner frame in the suit's ink, then the rank over a big pip, upright on screen whichever way the card lies
		const m = P.reduce((a, q) => [a[0] + q[0] / 4, a[1] + q[1] / 4], [0, 0]);
		const ink = inkOf(c);
		ctx.beginPath(); P.forEach((q, i) => { const x = m[0] + (q[0] - m[0]) * 0.84, y = m[1] + (q[1] - m[1]) * 0.86; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath();
		ctx.strokeStyle = ink; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
		const span = Math.min(Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]), Math.hypot(P[2][0] - P[1][0], P[2][1] - P[1][1]));
		const size = Math.max(7, span * 0.5);
		ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
		ctx.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
		ctx.fillText(rankOf(c), m[0], m[1] - size * 0.42);
		ctx.font = `${size * 1.15}px "Segoe UI Symbol", "DejaVu Sans", sans-serif`;
		ctx.fillText(SUIT[c.suit] || '', m[0], m[1] + size * 0.5);
	} });
}

// a stack or two of chips for an amount
function chips(out, x, z, amount, spread = 1) {
	const stacks = Math.min(4, 1 + Math.floor(Math.log10(Math.max(1, amount))));
	for (let s = 0; s < stacks; s++) {
		const sx = x + (s - (stacks - 1) / 2) * 0.05 * spread, h = Math.min(10, 2 + Math.round(amount / (40 * (s + 1))));
		for (let i = 0; i < h; i++) disc(sx, TOP + 0.036 + i * 0.007, z + (s % 2) * 0.02, 0.022, CHIP[(s + i) % CHIP.length], out, { h: 0.006, seg: 10 });
	}
}

// ── Labels and the HUD ───────────────────────────────────────────────────────
function labels(w, h) {
	const n = state.n || 6;
	ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
	state.seats.forEach((s, k) => {
		const [x, z] = seatPos(k, n, 1.05);
		const q = project([x, 1.55, z]);
		if (!q) return;
		// your own tag goes by your hand at the bottom, where it covers nothing
		if (s?.me) return;
		if (!s) {
			ctx.font = 'italic 11px sans-serif'; ctx.fillStyle = 'rgba(220,210,190,0.55)';
			ctx.fillText('open seat', q[0], q[1] + 20);
			return;
		}
		const line1 = s.name + (s.bot ? ' (AI)' : '');
		const line2 = s.folded ? 'FOLDED' : s.allIn ? 'ALL IN' : `₵ ${Number(s.chips || 0).toLocaleString()}`;
		ctx.font = 'bold 12px sans-serif';
		const bw = Math.max(ctx.measureText(line1).width, 60) + 16;
		ctx.fillStyle = s.acting ? 'rgba(80,60,10,0.88)' : s.won ? 'rgba(20,70,30,0.88)' : 'rgba(10,10,14,0.78)';
		roundRect(q[0] - bw / 2, q[1] - 16, bw, 32, 6); ctx.fill();
		if (s.acting || s.won) { ctx.strokeStyle = s.acting ? '#ffd65a' : '#7be38a'; ctx.lineWidth = 1.5; ctx.stroke(); }
		ctx.fillStyle = s.me ? '#9ad0ff' : '#f2ead8'; ctx.fillText(line1, q[0], q[1] - 6);
		ctx.font = '11px sans-serif'; ctx.fillStyle = s.folded ? '#a08a7a' : '#e8c86a'; ctx.fillText(line2, q[0], q[1] + 8);
		if (s.bet > 0) { ctx.fillStyle = '#f2ead8'; ctx.font = '10px sans-serif'; ctx.fillText(`bet ${s.bet}`, q[0], q[1] + 24); }
		if (s.said) {
			ctx.font = '11px sans-serif';
			const tw = ctx.measureText(s.said).width + 14;
			ctx.fillStyle = 'rgba(244,241,228,0.95)'; roundRect(q[0] - tw / 2, q[1] - 42, tw, 20, 9); ctx.fill();
			ctx.fillStyle = '#1a1a1a'; ctx.fillText(s.said, q[0], q[1] - 32);
		}
	});
	// the top line: what street it is, what's in the pot, or why nothing's happening
	const top = [state.phase, state.pot > 0 ? `POT ₵ ${state.pot.toLocaleString()}` : '', state.wait].filter(Boolean).join('   ·   ');
	if (top) {
		ctx.font = 'bold 13px sans-serif';
		const tw = ctx.measureText(top).width + 24;
		ctx.fillStyle = 'rgba(10,10,14,0.75)'; roundRect(10, 8, tw, 24, 12); ctx.fill();
		ctx.fillStyle = '#f2d98a'; ctx.fillText(top, 10 + tw / 2, 20);
	}
	// your own hand, big, at the bottom
	const me = state.seats.find((s) => s && s.me);
	if (me && me.cards?.length && me.cards.every(Boolean)) {
		const cw = 46, ch = 66, gap = 8, x0 = w - (cw * 2 + gap) - 14, y0 = h - ch - 12;
		ctx.textAlign = 'right'; ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#9ad0ff';
		ctx.fillText(me.name, x0 - 10, y0 + 22);
		ctx.font = '11px sans-serif'; ctx.fillStyle = '#e8c86a';
		ctx.fillText(`₵ ${Number(me.chips || 0).toLocaleString()}${me.bet ? `  ·  bet ${me.bet}` : ''}`, x0 - 10, y0 + 40);
		ctx.textAlign = 'center';
		me.cards.forEach((c, i) => {
			const x = x0 + i * (cw + gap);
			const ink = inkOf(c), r = rankOf(c), s = SUIT[c.suit] || '';
			ctx.fillStyle = '#f7f3e9'; roundRect(x, y0, cw, ch, 5); ctx.fill();
			ctx.strokeStyle = '#6e6858'; ctx.lineWidth = 1; ctx.stroke();
			// an inner frame in the suit's ink
			ctx.strokeStyle = ink; ctx.globalAlpha = 0.4; roundRect(x + 3, y0 + 3, cw - 6, ch - 6, 3); ctx.stroke(); ctx.globalAlpha = 1;
			ctx.fillStyle = ink;
			// the index, top left and (turned) bottom right, as a real deck has it
			const index = () => {
				ctx.textAlign = 'left';
				ctx.font = `900 ${r.length > 1 ? 12 : 14}px "Arial Black", Arial, sans-serif`; ctx.fillText(r, x + 5, y0 + 12);
				ctx.font = '11px "Segoe UI Symbol", "DejaVu Sans", sans-serif'; ctx.fillText(s, x + 6, y0 + 25);
			};
			index();
			ctx.save(); ctx.translate(x + cw / 2, y0 + ch / 2); ctx.rotate(Math.PI); ctx.translate(-(x + cw / 2), -(y0 + ch / 2)); index(); ctx.restore();
			// the big pip in the middle
			ctx.textAlign = 'center'; ctx.font = '30px "Segoe UI Symbol", "DejaVu Sans", sans-serif';
			ctx.fillText(s, x + cw / 2 + 3, y0 + ch / 2 + 2);
		});
	}
	ctx.font = '10px sans-serif'; ctx.fillStyle = 'rgba(230,220,200,0.45)'; ctx.textAlign = 'left';
	ctx.fillText('drag to look round · wheel to zoom', 10, h - 10);
}
function roundRect(x, y, w, h, r) {
	ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ── Drawing ──────────────────────────────────────────────────────────────────
function draw() {
	drawQueued = false;
	if (!canvas || !state) return;
	const dpr = Math.min(2, window.devicePixelRatio || 1);
	const w = canvas.clientWidth, h = canvas.clientHeight;
	if (!w || !h) return;
	if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	const g = ctx.createRadialGradient(w / 2, h * 0.55, 20, w / 2, h * 0.55, Math.max(w, h) * 0.75);
	g.addColorStop(0, '#2a2420'); g.addColorStop(1, '#0c0a09');
	ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
	setupView(w, h);
	const now = performance.now();
	buildScene(now);
	faces.forEach(paint);
	labels(w, h);
	const acting = state.seats.some((s) => s && s.acting);
	if (flying.size || acting) { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }
}
function requestDraw() {
	if (drawQueued) return;
	drawQueued = true;
	cancelAnimationFrame(raf);
	raf = requestAnimationFrame(draw);
}

// ── Input: drag to orbit, wheel or pinch to zoom ─────────────────────────────
function attachInput() {
	let lx = 0, ly = 0, down = false, pinch = 0;
	const orbit = (x, y) => {
		cam.yaw -= (x - lx) * 0.008;
		cam.pitch = Math.max(0.2, Math.min(1.4, cam.pitch + (y - ly) * 0.006));
		lx = x; ly = y; requestDraw();
	};
	const md = (e) => { down = true; lx = e.clientX; ly = e.clientY; canvas.style.cursor = 'grabbing'; };
	const mm = (e) => { if (down) orbit(e.clientX, e.clientY); };
	const mu = () => { if (!down) return; down = false; if (canvas) canvas.style.cursor = 'grab'; saveCam(); };
	const wh = (e) => { e.preventDefault(); cam.dist = Math.max(2.8, Math.min(8, cam.dist * (e.deltaY > 0 ? 1.08 : 0.92))); requestDraw(); saveCam(); };
	const ts = (e) => {
		if (e.touches.length === 1) { down = true; lx = e.touches[0].clientX; ly = e.touches[0].clientY; }
		if (e.touches.length === 2) { down = false; pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }
	};
	const tm = (e) => {
		if (e.touches.length === 1 && down) { e.preventDefault(); orbit(e.touches[0].clientX, e.touches[0].clientY); }
		if (e.touches.length === 2 && pinch) {
			e.preventDefault();
			const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
			cam.dist = Math.max(2.8, Math.min(8, cam.dist * pinch / d)); pinch = d; requestDraw();
		}
	};
	const te = () => { down = false; pinch = 0; saveCam(); };
	canvas.addEventListener('mousedown', md);
	window.addEventListener('mousemove', mm);
	window.addEventListener('mouseup', mu);
	canvas.addEventListener('wheel', wh, { passive: false });
	canvas.addEventListener('touchstart', ts, { passive: true });
	canvas.addEventListener('touchmove', tm, { passive: false });
	canvas.addEventListener('touchend', te);
	canvas.addEventListener('dblclick', () => { cam = { yaw: 0, pitch: 0.82, dist: 5.4 }; saveCam(); requestDraw(); });
	return () => {
		window.removeEventListener('mousemove', mm);
		window.removeEventListener('mouseup', mu);
	};
}

// ── Mount ────────────────────────────────────────────────────────────────────
// Called after every poker_update. The pane is new markup each time; the camera and the cards
// already dealt carry over, so nothing flies in twice.
export function mountPoker3D(paneRoot) {
	const wrap = (paneRoot || document).querySelector('.poker-table-wrap[data-p3d]');
	if (!wrap) { unmountPoker3D(); return; }
	let next;
	try { next = JSON.parse(wrap.dataset.p3d); } catch { unmountPoker3D(); return; }
	state = next;
	if (!cam) cam = loadCam();
	if (wrapEl !== wrap) {
		detach?.();
		resizeObs?.disconnect();
		wrapEl = wrap;
		wrap.classList.add('poker-3d');
		canvas = document.createElement('canvas');
		canvas.className = 'poker-canvas';
		canvas.style.cursor = 'grab';
		wrap.prepend(canvas);
		ctx = canvas.getContext('2d');
		detach = attachInput();
		resizeObs = new ResizeObserver(requestDraw);
		resizeObs.observe(wrap);
	}
	requestDraw();
}

export function unmountPoker3D() {
	detach?.(); detach = null;
	resizeObs?.disconnect(); resizeObs = null;
	cancelAnimationFrame(raf);
	canvas = null; ctx = null; wrapEl = null; state = null;
	seen = new Set(); flying.clear();
}

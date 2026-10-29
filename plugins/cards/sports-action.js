// ACTION SHOTS — the sports card's other photograph: the man full length, doing his job.
//
// The portrait (sports.js) is a man posing; an action shot is the picture the paper ran. Each is
// a figure posed by its JOINTS (head, shoulders, elbows, hands, hips, knees, feet) in the card's
// 100 x 120 frame, drawn as filled limbs in his club's kit, with what the role holds: a bat, a
// glove, a ball, a stick, a puck, a goalie's pads. The pose comes from his position:
//
//   Deadball   P pitch · C catch (behind the plate, in the gear) · infield: field a grounder ·
//              outfield: leap for one · DH and the bench man: swing
//   CPhL       forwards shoot · D throw a check · G drop into the butterfly
//
// A fielder or a defenseman is caught at the plate or shooting about half the time instead, off
// his name, so the same man is always caught the same way and a club's cards aren't all one pose.
import { escapeHtml as esc } from '../../server/engine/html.js';

function fnv(str) { let x = 0x811c9dc5 >>> 0; const s = String(str); for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619) >>> 0; return x >>> 0; }

// Joints: h head · ls/rs shoulders · le/re elbows · lh/rh hands · lp/rp hips · lk/rk knees ·
// lf/rf feet. `face` is the way he looks (+1 right, -1 left); `back` names the limbs drawn
// behind the body. Coordinates are the card frame's.
const POSES = {
  swing: { face: -1, back: ['r'], h: [52, 30], ls: [46, 40], rs: [58, 40], le: [38, 47], re: [50, 47], lh: [43, 37], rh: [45, 39],
    lp: [48, 66], rp: [56, 66], lk: [42, 84], rk: [60, 85], lf: [35, 104], rf: [67, 103] },
  pitch: { face: -1, back: ['r'], h: [45, 32], ls: [42, 42], rs: [54, 40], le: [34, 47], re: [62, 31], lh: [29, 53], rh: [67, 21],
    lp: [46, 66], rp: [55, 66], lk: [34, 82], rk: [62, 82], lf: [25, 104], rf: [71, 99] },
  catch: { face: -1, back: ['r'], h: [50, 52], ls: [44, 60], rs: [56, 60], le: [39, 70], re: [61, 72], lh: [36, 62], rh: [58, 80],
    lp: [46, 82], rp: [55, 82], lk: [35, 88], rk: [65, 88], lf: [38, 106], rf: [62, 106] },
  field: { face: -1, back: ['r'], h: [43, 48], ls: [42, 58], rs: [52, 56], le: [35, 72], re: [60, 66], lh: [30, 86], rh: [68, 72],
    lp: [54, 76], rp: [60, 74], lk: [42, 87], rk: [70, 88], lf: [31, 104], rf: [79, 104] },
  leap: { face: 1, back: ['r'], h: [52, 24], ls: [46, 34], rs: [58, 34], le: [43, 22], re: [64, 44], lh: [41, 12], rh: [68, 52],
    lp: [48, 60], rp: [56, 60], lk: [42, 75], rk: [62, 72], lf: [47, 90], rf: [73, 84], air: true },
  shot: { face: -1, back: ['r'], h: [46, 30], ls: [42, 40], rs: [54, 40], le: [37, 51], re: [57, 50], lh: [41, 59], rh: [49, 52],
    lp: [50, 66], rp: [58, 66], lk: [40, 84], rk: [66, 82], lf: [32, 102], rf: [76, 98] },
  check: { face: 1, back: ['l'], h: [63, 36], ls: [53, 44], rs: [64, 46], le: [61, 57], re: [73, 54], lh: [70, 63], rh: [65, 65],
    lp: [44, 66], rp: [52, 68], lk: [37, 84], rk: [60, 84], lf: [27, 102], rf: [67, 104] },
  save: { face: -1, back: [], h: [50, 46], ls: [42, 56], rs: [58, 56], le: [33, 62], re: [66, 66], lh: [25, 54], rh: [68, 77],
    lp: [44, 78], rp: [56, 78], lk: [35, 96], rk: [65, 96], lf: [17, 104], rf: [83, 104] },
};

export function poseOf(card) {
  const alt = fnv(`pose:${card.name}`) % 2 === 0;
  if (card.league === 'hockey') {
    if (card.pos === 'G') return 'save';
    if (card.pos === 'D') return alt ? 'check' : 'shot';
    return 'shot';
  }
  if (card.pos === 'P') return 'pitch';
  if (card.pos === 'C') return alt ? 'catch' : 'swing';
  if (['1B', '2B', '3B', 'SS'].includes(card.pos)) return alt ? 'field' : 'swing';
  if (['LF', 'CF', 'RF'].includes(card.pos)) return alt ? 'leap' : 'swing';
  return 'swing';
}

const SKIN = ['#f1d3bd', '#e4b998', '#d29f7c', '#b97f58', '#9a6443', '#7a4a2f', '#5c3824'];

function kit(sport, club) {
  const k = club?.kit?.home || {};
  const col = club?.colours || ['#555b66', '#22252b', '#e9e6df'];
  if (sport === 'hockey') {
    return { jersey: k.jersey || col[0], trim: k.trim || col[1], number: k.number || col[2] || '#fff',
      pants: k.pants || col[1], sock: k.sock || col[0], glove: k.glove || col[1], head: k.helmet || col[1] };
  }
  const n = Array.isArray(k.number) ? k.number : [k.number || col[1]];
  return { jersey: k.base || col[2] || '#eee', trim: k.trim || col[0], number: n[0] || col[1],
    pants: k.pants || k.base || '#eee', sock: k.stirrups || col[1], glove: '#8a5a2b', head: k.cap || col[1], bill: k.bill || k.cap || col[1] };
}

const seg = (a, b, w, c) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${esc(c)}" stroke-width="${w}" stroke-linecap="round"/>`;
const dot = (p, r, c, extra = '') => `<circle cx="${p[0]}" cy="${p[1]}" r="${r}" fill="${esc(c)}"${extra}/>`;
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function actionSvg(card, club) {
  const name = card.pose || poseOf(card);
  const P = POSES[name] || POSES.swing;
  const hockey = card.league === 'hockey';
  const K = kit(card.league, club);
  const skin = SKIN[fnv(`skin:${card.name}`) % SKIN.length];
  const goalie = name === 'save', catcher = name === 'catch';
  const legW = goalie ? 11 : 7, armW = 5.6;

  const bg = hockey
    ? `<rect width="100" height="120" fill="#6f7f8e"/><rect width="100" height="40" fill="#8d9cab"/>
       <g opacity=".35">${[8, 22, 36, 50, 64, 78, 92].map((x, i) => `<circle cx="${x}" cy="${18 + (i % 2) * 8}" r="5" fill="#2b3440"/>`).join('')}</g>
       <rect y="62" width="100" height="58" fill="#e4eef4"/><rect y="62" width="100" height="5" fill="${esc(K.trim)}"/>
       <path d="M-20 97 L120 91" stroke="#c4302b" stroke-width="1.2" opacity=".6"/>`
    : `<rect width="100" height="120" fill="#8fbde0"/><rect width="100" height="34" fill="#b4d3ea"/>
       <path d="M-20 59 L120 51 L120 72 L-20 72 Z" fill="#3e5a3a" opacity=".6"/><rect y="72" width="100" height="48" fill="#5a9a44"/>
       ${name === 'field' || name === 'swing' || name === 'catch' || name === 'pitch' ? '<ellipse cx="50" cy="106" rx="56" ry="13" fill="#b58a5a"/>' : ''}
       ${name === 'pitch' ? '<ellipse cx="50" cy="104" rx="26" ry="5" fill="#c29a68"/>' : ''}`;
  // The frame is wider than the figure's 100 so a whole body fits the photo window's shape;
  // the backdrop runs out to the frame's edges.
  const wide = (svg) => svg.replace(/<rect (y="[^"]*" )?width="100"/g, (m, y) => `<rect x="-20" ${y || ''}width="140"`);
  // motion: a few speed lines behind whatever's moving
  const speed = (from, dir) => [0, 1, 2].map(i => `<path d="M${from[0] - dir * (4 + i * 3)} ${from[1] - 4 + i * 4} l${-dir * (10 - i * 2)} 0" stroke="#fff" stroke-width="1" opacity=".55"/>`).join('');
  const shadow = `<ellipse cx="${(P.lf[0] + P.rf[0]) / 2}" cy="${P.air ? 110 : 106}" rx="${P.air ? 12 : 20}" ry="2.6" fill="#000" opacity=".25"/>`;

  // limbs: thigh in his pants, shin in his socks (a goalie's legs are his pads), boots on the end
  const leg = (s) => {
    const p = P[s + 'p'], k = P[s + 'k'], f = P[s + 'f'];
    return seg(p, k, legW, goalie ? '#f2f0ea' : K.pants) + seg(k, f, legW - 0.6, goalie ? '#f2f0ea' : K.sock)
      + (goalie ? seg(lerp(p, k, 0.5), lerp(k, f, 0.6), 1.2, K.trim) : '')
      + (hockey ? `${seg([f[0] - 4, f[1] + 1.6], [f[0] + 4, f[1] + 1.6], 1.4, '#cfd6dc')}${dot(f, 3, '#1a1a1a')}` : dot(f, 3.2, '#1a1a1a'));
  };
  const arm = (s) => {
    const sh = P[s + 's'], el = P[s + 'e'], ha = P[s + 'h'];
    return seg(sh, el, armW, K.jersey) + seg(el, ha, armW - 0.8, hockey ? K.jersey : skin)
      + (hockey ? dot(ha, 3.2, K.glove) : dot(ha, 2.3, skin));
  };
  const behind = (P.back || []).map(s => arm(s) + leg(s)).join('');
  const front = ['l', 'r'].filter(s => !(P.back || []).includes(s)).map(s => leg(s) + arm(s)).join('');

  const torso = `<path d="M${P.ls} L${P.rs} L${P.rp} L${P.lp} Z" fill="${esc(K.jersey)}" stroke="${esc(K.jersey)}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M${lerp(P.ls, P.lp, 0.92)} L${lerp(P.rs, P.rp, 0.92)}" stroke="${esc(K.trim)}" stroke-width="2"/>
    <text x="${(P.ls[0] + P.rs[0] + P.lp[0] + P.rp[0]) / 4}" y="${(P.ls[1] + P.rp[1]) / 2 + 3}" text-anchor="middle" font-family="Impact,'Arial Black',sans-serif" font-size="8" fill="${esc(K.number)}">${esc(String(card.num))}</text>`;
  const neck = seg(lerp(P.ls, P.rs, 0.5), P.h, 3.6, skin);

  // the head: cap, helmet, catcher's gear or goalie's mask, facing the way he looks
  const [hx, hy] = P.h, f = P.face;
  let head = dot(P.h, 6.2, skin) + `<circle cx="${hx + f * 2.6}" cy="${hy - 0.6}" r=".9" fill="#1a1412"/>`;
  if (goalie) {
    head = dot(P.h, 6.8, K.head) + `<path d="M${hx - 4} ${hy - 1} L${hx + 4} ${hy - 1} M${hx - 4} ${hy + 2} L${hx + 4} ${hy + 2} M${hx - 1.5} ${hy - 3} L${hx - 1.5} ${hy + 5} M${hx + 1.5} ${hy - 3} L${hx + 1.5} ${hy + 5}" stroke="#d6d9de" stroke-width=".8"/>`;
  } else if (hockey) {
    head += `<path d="M${hx - 6.6} ${hy + 0.5} Q${hx - 6.6} ${hy - 7.4} ${hx} ${hy - 7.4} Q${hx + 6.6} ${hy - 7.4} ${hx + 6.6} ${hy + 0.5} Z" fill="${esc(K.head)}"/>`;
  } else if (catcher) {
    head += `<path d="M${hx - 6.6} ${hy} Q${hx} ${hy - 9} ${hx + 6.6} ${hy} Z" fill="${esc(K.head)}"/>
      <path d="M${hx + f * 1} ${hy - 1} l${f * 5} 0 M${hx + f * 1} ${hy + 2} l${f * 5} 0 M${hx + f * 1} ${hy + 5} l${f * 4} -1" stroke="#222" stroke-width="1"/>`;
  } else {
    head += `<path d="M${hx - 6.4} ${hy - 1} Q${hx} ${hy - 9.6} ${hx + 6.4} ${hy - 1} Z" fill="${esc(K.head)}"/>
      <path d="M${hx + f * 3} ${hy - 1.6} q${f * 5} -0.4 ${f * 8} 1.6 q${-f * 4} 0.8 ${-f * 8} 0 Z" fill="${esc(K.bill)}"/>`;
  }

  // what he's holding
  let props = '';
  const mitt = (p, r = 4.4) => dot(p, r, K.glove) + `<path d="M${p[0] - r * 0.6} ${p[1]} q${r * 0.6} ${-r * 0.7} ${r * 1.2} 0" stroke="#000" stroke-opacity=".3" stroke-width=".7" fill="none"/>`;
  const ball = (p) => dot(p, 1.8, '#f7f3ea', ' stroke="#c43" stroke-width=".35"');
  if (name === 'swing') {
    props = seg([44, 38], [72, 20], 2.4, '#b88a52') + seg([62, 26], [72, 20], 3.4, '#b88a52') + ball([88, 34]) + speed([88, 34], -1);
  } else if (name === 'pitch') {
    props = mitt(P.lh) + ball([P.rh[0] + 1, P.rh[1] - 2]);
  } else if (name === 'catch') {
    props = mitt([P.lh[0] - 1, P.lh[1]], 6) + ball([P.lh[0] - 1, P.lh[1]]) + speed([P.lh[0] - 4, P.lh[1]], 1);
  } else if (name === 'field') {
    props = mitt(P.lh) + ball([P.lh[0] - 4, P.lh[1] + 6]) + speed([P.lh[0] - 4, P.lh[1] + 8], 1);
  } else if (name === 'leap') {
    props = mitt([P.lh[0], P.lh[1] - 1]) + ball([P.lh[0] + 1, P.lh[1] - 5]) + `<path d="M24 108 L76 108" stroke="#c9b48a" stroke-width="3"/>`;
  } else if (name === 'shot') {
    props = seg([53, 46], [22, 103], 2, '#d8c49a') + seg([22, 103], [12, 104], 2.6, '#1a1a1a') + `<ellipse cx="8" cy="104.6" rx="2.6" ry="1.1" fill="#111"/>`
      + `<path d="M16 100 q6 -6 12 -4" stroke="#fff" stroke-width=".8" fill="none" opacity=".7"/>`;
  } else if (name === 'check') {
    props = seg([68, 61], [88, 102], 2, '#d8c49a') + seg([88, 102], [96, 103], 2.6, '#1a1a1a') + speed([P.h[0] - 8, P.h[1] + 10], 1)
      + `<path d="M74 40 l6 -4 M76 46 l7 -1 M74 52 l6 2" stroke="#fff" stroke-width="1.2" opacity=".8"/>`;
  } else if (name === 'save') {
    props = dot(P.lh, 6, K.glove) + dot([P.lh[0], P.lh[1]], 2.4, '#111')
      + `<rect x="${P.rh[0] - 3}" y="${P.rh[1] - 5}" width="7" height="9" rx="1" fill="${esc(K.glove)}" stroke="#fff" stroke-width=".5"/>`
      + seg([P.rh[0], P.rh[1] + 3], [62, 106], 2.4, '#d8c49a') + seg([62, 106], [46, 106], 3.4, '#1a1a1a')
      + `<ellipse cx="${P.lh[0] + 9}" cy="${P.lh[1] - 4}" rx="2.6" ry="1.1" fill="#111" opacity=".5"/>`;
  }
  return `<svg class="spc-portrait spc-action" viewBox="-14 6 128 102" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${wide(bg)}${shadow}${behind}${torso}${neck}${front}${head}${props}</svg>`;
}

export const ACTION_LABEL = {
  swing: 'At the plate', pitch: 'On the mound', catch: 'Behind the plate', field: 'In the field', leap: 'At the wall',
  shot: 'Shooting', check: 'Finishing a check', save: 'In the butterfly',
};
export const _test = { POSES };

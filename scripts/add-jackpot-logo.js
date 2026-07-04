// One-shot script: seed the `jackpot_protocol_logo` media_graphics row referenced
// by `TITLE jackpot_protocol_logo` in data/scripts/jackpotprotocol.bsm. The title
// card is shown when KSAB's game show "Jackpot Protocol" airs. Idempotent — safe
// to re-run; the existing row is overwritten.
// Run once: node scripts/add-jackpot-logo.js
import { query } from '../server/models/db.js';

// 640×360 — the recommended broadcast title-card canvas. Rendered as live SVG in
// the TV panel (innerHTML injection; dev-authored, so safe). Neon game-show glam:
// gold starburst behind a beveled "JACKPOT" wordmark, a slot-reel 7·7·7, and the
// KSAB live tag underneath.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <defs>
    <radialGradient id="jp-bg" cx="50%" cy="42%" r="75%">
      <stop offset="0%" stop-color="#3a1450"/>
      <stop offset="55%" stop-color="#160a26"/>
      <stop offset="100%" stop-color="#070310"/>
    </radialGradient>
    <linearGradient id="jp-gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fff3b0"/>
      <stop offset="38%" stop-color="#ffd23f"/>
      <stop offset="62%" stop-color="#f7a80a"/>
      <stop offset="100%" stop-color="#b56a00"/>
    </linearGradient>
    <linearGradient id="jp-chip" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2b1740"/>
      <stop offset="100%" stop-color="#120a1e"/>
    </linearGradient>
    <filter id="jp-glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="640" height="360" fill="url(#jp-bg)"/>

  <!-- gold starburst rays behind the wordmark -->
  <g transform="translate(320 172)" opacity="0.5" filter="url(#jp-glow)">
    <g fill="#ffcf33">
      <polygon points="0,-190 26,0 -26,0"/>
      <polygon points="0,190 26,0 -26,0"/>
      <polygon points="-190,0 0,-26 0,26"/>
      <polygon points="190,0 0,-26 0,26"/>
    </g>
    <g fill="#f7a80a" transform="rotate(45)">
      <polygon points="0,-170 20,0 -20,0"/>
      <polygon points="0,170 20,0 -20,0"/>
      <polygon points="-170,0 0,-20 0,20"/>
      <polygon points="170,0 0,-20 0,20"/>
    </g>
    <g fill="#ffdf6b" transform="rotate(22.5)" opacity="0.7">
      <polygon points="0,-150 14,0 -14,0"/>
      <polygon points="0,150 14,0 -14,0"/>
      <polygon points="-150,0 0,-14 0,14"/>
      <polygon points="150,0 0,-14 0,14"/>
    </g>
  </g>

  <!-- slot-reel 7·7·7 -->
  <g transform="translate(320 74)" font-family="Impact, 'Arial Black', sans-serif" text-anchor="middle">
    <g transform="translate(-92 0)"><rect x="-26" y="-26" width="52" height="56" rx="8" fill="url(#jp-chip)" stroke="#ffd23f" stroke-width="2"/><text y="20" font-size="46" fill="url(#jp-gold)">7</text></g>
    <g transform="translate(0 0)"><rect x="-26" y="-26" width="52" height="56" rx="8" fill="url(#jp-chip)" stroke="#ffd23f" stroke-width="2"/><text y="20" font-size="46" fill="url(#jp-gold)">7</text></g>
    <g transform="translate(92 0)"><rect x="-26" y="-26" width="52" height="56" rx="8" fill="url(#jp-chip)" stroke="#ffd23f" stroke-width="2"/><text y="20" font-size="46" fill="url(#jp-gold)">7</text></g>
  </g>

  <!-- wordmark -->
  <g text-anchor="middle" font-family="Impact, 'Arial Black', sans-serif">
    <text x="320" y="216" font-size="88" letter-spacing="2" fill="url(#jp-gold)" stroke="#5a2b00" stroke-width="2" filter="url(#jp-glow)">JACKPOT</text>
    <text x="320" y="262" font-size="38" letter-spacing="18" fill="#37e6d0" stroke="#0a2b28" stroke-width="1">PROTOCOL</text>
  </g>

  <!-- KSAB live tag -->
  <g text-anchor="middle" font-family="'Courier New', monospace">
    <text x="320" y="300" font-size="15" letter-spacing="6" fill="#c9a6ff">K S A B &#183; THE CITY'S BIGGEST NIGHT</text>
    <circle cx="243" cy="326" r="5" fill="#ff3b47"/>
    <text x="320" y="331" font-size="14" letter-spacing="3" fill="#ff6470">LIVE</text>
  </g>

  <rect x="8" y="8" width="624" height="344" rx="14" fill="none" stroke="#ffd23f" stroke-width="2" opacity="0.55"/>
</svg>`;

await query(
  `INSERT INTO media_graphics (id, name, description, type, content, tags)
   VALUES ($1,$2,$3,'svg',$4,$5)
   ON CONFLICT (id) DO UPDATE SET name=$2, description=$3, type='svg', content=$4, tags=$5`,
  [
    'jackpot_protocol_logo',
    'Jackpot Protocol — Logo',
    "Title card for KSAB's game show 'Jackpot Protocol' (referenced by data/scripts/jackpotprotocol.bsm).",
    svg,
    JSON.stringify(['broadcast', 'title_card', 'ksab', 'logo']),
  ]
);
console.log('Graphic: jackpot_protocol_logo');
console.log('Done.');
process.exit(0);

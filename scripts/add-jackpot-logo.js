// One-shot script: seed the `jackpot_protocol_logo` media_graphics row referenced
// by `TITLE jackpot_protocol_logo` in data/scripts/jackpotprotocol.bsm. The title
// card is shown when KSAB's game show "Jackpot Protocol" airs. Idempotent — safe
// to re-run; the existing row is overwritten.
// Run once: node scripts/add-jackpot-logo.js
import { query } from '../server/models/db.js';

// 640×360 — the recommended broadcast title-card canvas. Rendered as live SVG in
// the TV panel (innerHTML injection; dev-authored, so safe). Deliberately kept
// bulletproof: NO SVG <filter> (feGaussianBlur filter-regions render blank/oversized
// when the card is scaled into the small panel — the earlier version's bug), a single
// gradient, unique `jpl-` id prefix to avoid collisions, solid fills everywhere else.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="jpl-gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff3b0"/>
      <stop offset="0.4" stop-color="#ffd23f"/>
      <stop offset="0.7" stop-color="#f7a80a"/>
      <stop offset="1" stop-color="#b56a00"/>
    </linearGradient>
  </defs>

  <rect width="640" height="360" fill="#160a26"/>
  <rect x="0" y="0" width="640" height="150" fill="#20103a"/>

  <!-- gold starburst rays behind the wordmark (solid fills, no filter) -->
  <g transform="translate(320 176)" opacity="0.26" fill="#ffcf33">
    <polygon points="0,-188 24,0 -24,0"/>
    <polygon points="0,188 24,0 -24,0"/>
    <polygon points="-188,0 0,-24 0,24"/>
    <polygon points="188,0 0,-24 0,24"/>
    <g transform="rotate(45)">
      <polygon points="0,-168 18,0 -18,0"/>
      <polygon points="0,168 18,0 -18,0"/>
      <polygon points="-168,0 0,-18 0,18"/>
      <polygon points="168,0 0,-18 0,18"/>
    </g>
  </g>

  <!-- slot-reel 7 - 7 - 7 -->
  <g transform="translate(320 74)" font-family="Impact, 'Arial Black', sans-serif" text-anchor="middle">
    <g transform="translate(-92 0)"><rect x="-26" y="-26" width="52" height="56" rx="8" fill="#241033" stroke="#ffd23f" stroke-width="2"/><text y="20" font-size="46" fill="url(#jpl-gold)">7</text></g>
    <g><rect x="-26" y="-26" width="52" height="56" rx="8" fill="#241033" stroke="#ffd23f" stroke-width="2"/><text y="20" font-size="46" fill="url(#jpl-gold)">7</text></g>
    <g transform="translate(92 0)"><rect x="-26" y="-26" width="52" height="56" rx="8" fill="#241033" stroke="#ffd23f" stroke-width="2"/><text y="20" font-size="46" fill="url(#jpl-gold)">7</text></g>
  </g>

  <!-- wordmark (dark stroke for pop instead of a glow filter) -->
  <g text-anchor="middle" font-family="Impact, 'Arial Black', sans-serif">
    <text x="320" y="218" font-size="90" letter-spacing="2" fill="url(#jpl-gold)" stroke="#4a2400" stroke-width="2.5">JACKPOT</text>
    <text x="320" y="264" font-size="38" letter-spacing="18" fill="#37e6d0" stroke="#0a2b28" stroke-width="1">PROTOCOL</text>
  </g>

  <!-- KSAB live tag -->
  <g text-anchor="middle" font-family="'Courier New', monospace">
    <text x="320" y="301" font-size="15" letter-spacing="5" fill="#c9a6ff">K S A B &#183; THE CITY'S BIGGEST NIGHT</text>
    <circle cx="250" cy="325" r="5" fill="#ff3b47"/>
    <text x="320" y="330" font-size="14" letter-spacing="3" fill="#ff6470">LIVE</text>
  </g>

  <rect x="8" y="8" width="624" height="344" rx="14" fill="none" stroke="#ffd23f" stroke-width="2" opacity="0.5"/>
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

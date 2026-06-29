// Custom BBCode-style markup parser for in-game chat.
// Always HTML-escapes input first, then applies tag substitutions — never trusts raw input.
//
// Usage:
//   expandTokens(raw)  — expand $variables against the sender's live state (call before sending)
//   parseMarkup(raw)   — expandTokens + BBCode → safe HTML (call at render time)

import { state } from './state.js';
import { getEquippedWeaponName } from './panels/equipment.js';

// ── Token map ──────────────────────────────────────────────────────────────────

const WETNESS_LABELS = [
  [0,  'bone dry'],
  [10, 'slightly damp'],
  [30, 'noticeably wet'],
  [50, 'soaked'],
  [70, 'drenched'],
  [85, 'absolutely sopping'],
];

const HORNY_LABELS = [
  [0,  'cool'],
  [15, 'a little frisky'],
  [30, 'noticeably horny'],
  [50, 'distressingly horny'],
  [70, 'desperately horny'],
  [85, 'absolutely feral'],
  [99, 'a walking biohazard'],
];

function _levelLabel(value, table) {
  let label = table[0][1];
  for (const [threshold, text] of table) {
    if (value >= threshold) label = text;
  }
  return label;
}

const TOKEN_MAP = {
  $name:    () => state.player?.handle,
  $hp:      () => state.player?.hp        != null ? Math.round(state.player.hp)        : null,
  $maxhp:   () => state.player?.hp_max    != null ? Math.round(state.player.hp_max)    : null,
  $san:     () => state.player?.sanity    != null ? Math.round(state.player.sanity)    : null,
  $rad:     () => state.player?.radiation != null ? Math.round(state.player.radiation) : null,
  $temp:    () => state.player?.body_temp_c != null ? state.player.body_temp_c.toFixed(1) + '°C' : null,
  $credits: () => state.player?.credits   != null ? state.player.credits   : null,
  $xp:      () => state.player?.xp        != null ? state.player.xp        : null,
  $ip:      () => state.player?.xp        != null ? state.player.xp        : null,
  $zone:    () => document.getElementById('zone-name-display')?.textContent?.trim() || null,
  $weapon:  () => getEquippedWeaponName() || 'bare hands',
  $wet:     () => state.player ? _levelLabel(state.player.wetness ?? 0, WETNESS_LABELS) : null,
  $horny:   () => {
    const p = state.player;
    if (!p || !p.mis_enabled) return '[MIS not active]';
    return _levelLabel(p.horniness ?? 0, HORNY_LABELS);
  },
  $home:    () => {
    const hz = state.player?.home_zone;
    return hz ? hz.replace(/^zone_/, '').replace(/_/g, ' ') : 'nowhere';
  },
  $kills:   () => state.player?.mob_kills   != null ? state.player.mob_kills   : null,
  $deaths:  () => state.player?.deaths      != null ? state.player.deaths      : null,
  $pkills:  () => state.player?.player_kills != null ? state.player.player_kills : null,
  $hunger:  () => state.player?.hunger      != null ? Math.round(state.player.hunger)  : null,
  $thirst:  () => state.player?.thirst      != null ? Math.round(state.player.thirst)  : null,
  $stamina: () => state.player?.stamina     != null ? Math.round(state.player.stamina) : null,
};

const TOKEN_PATTERN = /\$(?:name|maxhp|hp|san|rad|temp|credits|xp|ip|zone|weapon|wet|horny|home|kills|deaths|pkills|hunger|thirst|stamina)\b/gi;

// Expand $tokens against the current player state. Returns plain text (still needs HTML escaping).
// Call this at send time so the sender's values are embedded in the message.
export function expandTokens(raw) {
  return String(raw).replace(TOKEN_PATTERN, match => {
    const key = match.toLowerCase();
    const val = TOKEN_MAP[key]?.();
    return val != null ? String(val) : match;
  });
}

// ── BBCode ─────────────────────────────────────────────────────────────────────

const ALLOWED_COLORS = new Set([
  'red','green','blue','yellow','orange','purple','pink','cyan','white','gray','grey',
  'lime','teal','maroon','navy','olive','silver','aqua','fuchsia','black',
  'coral','crimson','gold','indigo','magenta','salmon','tan','violet',
]);

function _esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _safeColor(raw) {
  const c = raw.trim().toLowerCase();
  if (ALLOWED_COLORS.has(c)) return c;
  if (/^#[0-9a-f]{6}$/.test(c) || /^#[0-9a-f]{3}$/.test(c)) return c;
  return null;
}

// Rainbow: treat HTML entities as single units to avoid splitting &amp; etc.
function _rainbow(text) {
  const parts = [];
  text.replace(/&[a-z#][a-z0-9]*;|./gis, m => parts.push(m));
  return parts.map((ch, i) => {
    const hue = Math.round((i / Math.max(parts.length - 1, 1)) * 300);
    return `<span style="color:hsl(${hue},100%,65%)">${ch}</span>`;
  }).join('');
}

// Parse BBCode tags in an already-HTML-escaped string.
function _applyBBCode(s) {
  // Rainbow first — content must be plain escaped text before other tags transform it
  s = s.replace(/\[rainbow\]([\s\S]*?)\[\/rainbow\]/gi, (_, t) => _rainbow(t));

  s = s.replace(/\[b\]([\s\S]*?)\[\/b\]/gi,      '<strong>$1</strong>');
  s = s.replace(/\[i\]([\s\S]*?)\[\/i\]/gi,       '<em>$1</em>');
  s = s.replace(/\[u\]([\s\S]*?)\[\/u\]/gi,       '<span style="text-decoration:underline">$1</span>');
  s = s.replace(/\[s\]([\s\S]*?)\[\/s\]/gi,       '<span style="text-decoration:line-through">$1</span>');
  s = s.replace(/\[big\]([\s\S]*?)\[\/big\]/gi,   '<span style="font-size:1.4em">$1</span>');
  s = s.replace(/\[small\]([\s\S]*?)\[\/small\]/gi,'<span style="font-size:0.8em">$1</span>');
  s = s.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, '<code style="background:var(--bg3);padding:1px 4px;border-radius:2px;font-family:var(--font-mono)">$1</code>');
  s = s.replace(/\[center\]([\s\S]*?)\[\/center\]/gi, '<div style="text-align:center">$1</div>');
  s = s.replace(/\[blink\]([\s\S]*?)\[\/blink\]/gi,  '<span style="animation:blink 1s step-end infinite">$1</span>');
  s = s.replace(/\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi,
    '<span style="filter:blur(4px);cursor:pointer;user-select:none" title="Click to reveal" onclick="this.style.filter=\'\'">$1</span>');

  s = s.replace(/\[color=([^\]]{1,30})\]([\s\S]*?)\[\/color\]/gi, (_, colorRaw, text) => {
    const color = _safeColor(colorRaw);
    return color ? `<span style="color:${color}">${text}</span>` : text;
  });

  // Game-specific tags
  s = s.replace(/\[player\]([\s\S]*?)\[\/player\]/gi,  '<span style="color:var(--purple)">$1</span>');
  s = s.replace(/\[item\]([\s\S]*?)\[\/item\]/gi,      '<span style="color:var(--yellow)">$1</span>');
  s = s.replace(/\[system\]([\s\S]*?)\[\/system\]/gi,  '<span style="color:var(--text-dim)">$1</span>');
  s = s.replace(/\[danger\]([\s\S]*?)\[\/danger\]/gi,  '<span style="color:var(--red)">$1</span>');
  s = s.replace(/\[safe\]([\s\S]*?)\[\/safe\]/gi,      '<span style="color:var(--green)">$1</span>');

  return s;
}

// Full pipeline: expand tokens → HTML-escape → apply BBCode → safe HTML.
export function parseMarkup(raw) {
  return _applyBBCode(_esc(expandTokens(raw)));
}

// BBCode only — no token expansion. Safe for rendering received messages (broadcasts, signs, etc.)
export function renderMarkup(raw) {
  return _applyBBCode(_esc(String(raw ?? '')));
}

// ── Help text & status template ────────────────────────────────────────────────

export const STATUS_TEMPLATE = '[b][color=#00ffff][system]ARCHITECT LIVE STATS[/system][/color][/b]  |  [player]$name[/player]  |  [u]ZONE:$zone[/u]  |  HP:[color=red]$hp/$maxhp[/color]  |  SAN:[i]$san[/i]  |  RAD:[s]$rad[/s]  |  TEMP:[b]$temp[/b]  |  CREDITS:[color=#00ff99]$credits[/color]  |  XP:$xp  |  [item]$weapon[/item] ACTIVE';

export const MARKUP_HELP_HTML = `
<div style="font-family:var(--font-mono);font-size:12px;line-height:1.8;color:var(--text)">
  <div style="color:var(--accent);margin-bottom:4px">── Formatting ──────────────────────</div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">[b]text[/b]</span> <strong>bold</strong></div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">[i]text[/i]</span> <em>italic</em></div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">[u]text[/u]</span> <span style="text-decoration:underline">underline</span></div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">[s]text[/s]</span> <span style="text-decoration:line-through">strikethrough</span></div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">[big]text[/big]</span> <span style="font-size:1.3em">big text</span></div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">[small]text[/small]</span> <span style="font-size:0.8em">small text</span></div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">[code]text[/code]</span> <code style="background:var(--bg3);padding:1px 4px;border-radius:2px">monospace</code></div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">[center]text[/center]</span> centered text</div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">[blink]text[/blink]</span> blinking text</div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">[spoiler]text[/spoiler]</span> hidden until clicked</div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">[rainbow]text[/rainbow]</span> <span style="background:linear-gradient(90deg,hsl(0,100%,65%),hsl(60,100%,65%),hsl(120,100%,65%),hsl(180,100%,65%),hsl(240,100%,65%),hsl(300,100%,65%));-webkit-background-clip:text;-webkit-text-fill-color:transparent">rainbow</span></div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">[color=red]text[/color]</span> <span style="color:red">colored</span> (name or #rrggbb)</div>
  <div style="color:var(--accent);margin-top:6px;margin-bottom:2px">── Game tags ───────────────────────</div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">[player]Name[/player]</span> <span style="color:var(--purple)">player style</span></div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">[item]Sword[/item]</span> <span style="color:var(--yellow)">item style</span></div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">[system]text[/system]</span> <span style="color:var(--text-dim)">system style</span></div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">[danger]text[/danger]</span> <span style="color:var(--red)">danger style</span></div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">[safe]text[/safe]</span> <span style="color:var(--green)">safe style</span></div>
  <div style="color:var(--accent);margin-top:6px;margin-bottom:2px">── Variables (your stats at send time) ──</div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">$name</span> your handle</div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">$hp / $maxhp</span> current &amp; max health</div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">$san</span> sanity</div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">$rad</span> radiation level</div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">$temp</span> body temperature</div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">$credits</span> credits on hand</div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">$xp</span> spendable experience</div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">$zone</span> current location</div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">$weapon</span> equipped weapon</div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">$wet</span> wetness description</div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">$horny</span> horniness (MIS only)</div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">$home</span> home zone name</div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">$kills / $pkills / $deaths</span> combat stats</div>
  <div><span style="color:var(--yellow);min-width:230px;display:inline-block">$hunger / $thirst / $stamina</span> survival stats</div>
  <div style="color:var(--text-dim);margin-top:6px;font-size:11px">Type .status to broadcast your live stats. Markup applies in whisper &amp; channels only.</div>
</div>`.trim();

// Custom BBCode-style markup parser for in-game chat.
// Always HTML-escapes input first, then applies tag substitutions — never trusts raw input.

import { state } from './state.js';

// Variable tokens resolved against reader's client state at render time.
// All values are treated as plain text (no HTML injection possible).
const TOKEN_MAP = {
  $name:    () => state.player?.handle,
  $hp:      () => state.player?.hp      != null ? Math.round(state.player.hp)      : null,
  $maxhp:   () => state.player?.hp_max  != null ? Math.round(state.player.hp_max)  : null,
  $san:     () => state.player?.sanity  != null ? Math.round(state.player.sanity)  : null,
  $rad:     () => state.player?.radiation != null ? Math.round(state.player.radiation) : null,
  $temp:    () => state.player?.body_temp_c != null ? state.player.body_temp_c.toFixed(1) + '°C' : null,
  $credits: () => state.player?.credits != null ? state.player.credits : null,
  $ip:      () => state.player?.ip      != null ? state.player.ip      : null,
  $zone:    () => document.getElementById('zone-name-display')?.textContent?.trim() || null,
  $mk:      () => state.player?.mob_kills    != null ? state.player.mob_kills    : null,
  $pk:      () => state.player?.player_kills != null ? state.player.player_kills : null,
  $deaths:  () => state.player?.deaths       != null ? state.player.deaths       : null,
};

const TOKEN_PATTERN = /\$(?:name|maxhp|hp|san|rad|temp|credits|ip|zone|mk|pk|deaths)\b/gi;

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

// Supported tags:
//   [b]bold[/b]
//   [i]italic[/i]
//   [u]underline[/u]
//   [s]strikethrough[/s]
//   [color=red]...[/color]  (named colors or #rrggbb / #rgb)
//   [player]name[/player]   → purple (like player names in-game)
//   [item]name[/item]       → yellow (like item names)
//   [system]text[/system]   → dim gray
export function parseMarkup(raw) {
  // Step 1: expand $tokens before escaping so values are also escaped
  let s = String(raw).replace(TOKEN_PATTERN, match => {
    const key = match.toLowerCase();
    const val = TOKEN_MAP[key]?.();
    return val != null ? String(val) : match;
  });

  // Step 2: escape all HTML — nothing from user input can become a tag
  s = _esc(s);

  // Step 2: apply BBCode substitutions on the escaped string
  s = s.replace(/\[b\]([\s\S]*?)\[\/b\]/gi,  '<strong>$1</strong>');
  s = s.replace(/\[i\]([\s\S]*?)\[\/i\]/gi,  '<em>$1</em>');
  s = s.replace(/\[u\]([\s\S]*?)\[\/u\]/gi,  '<span style="text-decoration:underline">$1</span>');
  s = s.replace(/\[s\]([\s\S]*?)\[\/s\]/gi,  '<span style="text-decoration:line-through">$1</span>');

  s = s.replace(/\[color=([^\]]{1,30})\]([\s\S]*?)\[\/color\]/gi, (_, colorRaw, text) => {
    const color = _safeColor(colorRaw);
    return color ? `<span style="color:${color}">${text}</span>` : text;
  });

  // Game-specific tags
  s = s.replace(/\[player\]([\s\S]*?)\[\/player\]/gi, '<span style="color:var(--purple)">$1</span>');
  s = s.replace(/\[item\]([\s\S]*?)\[\/item\]/gi,     '<span style="color:var(--yellow)">$1</span>');
  s = s.replace(/\[system\]([\s\S]*?)\[\/system\]/gi, '<span style="color:var(--text-dim)">$1</span>');

  return s;
}

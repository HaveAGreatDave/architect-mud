// Custom BBCode-style markup parser for in-game chat.
// Always HTML-escapes input first, then applies tag substitutions — never trusts raw input.

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
  // Step 1: escape all HTML — nothing from user input can become a tag
  let s = _esc(raw);

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

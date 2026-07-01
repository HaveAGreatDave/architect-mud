// Dev-panel port of the client chat markup parser (client/game/js/markup.js).
// Plain classic script — exposes globals, no ES modules. Always HTML-escapes
// input first, then applies BBCode. Unlike the client, the dev panel has no live
// player state, so $token expansion only resolves $name (→ the admin handle);
// every other token passes through untouched.

const _MARKUP_TOKEN_PATTERN = /\$(?:name|maxhp|hp|san|rad|temp|credits|xp|ip|zone|weapon|wet|horny|home|kills|deaths|pkills|hunger|thirst|stamina)\b/gi;

function expandTokens(raw) {
  const handle = typeof devHandle !== 'undefined' ? devHandle : 'Admin';
  return String(raw).replace(_MARKUP_TOKEN_PATTERN, match =>
    match.toLowerCase() === '$name' ? handle : match,
  );
}

const _MARKUP_ALLOWED_COLORS = new Set([
  'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink', 'cyan', 'white', 'gray', 'grey',
  'lime', 'teal', 'maroon', 'navy', 'olive', 'silver', 'aqua', 'fuchsia', 'black',
  'coral', 'crimson', 'gold', 'indigo', 'magenta', 'salmon', 'tan', 'violet',
]);

function _markupEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _markupSafeColor(raw) {
  const c = raw.trim().toLowerCase();
  if (_MARKUP_ALLOWED_COLORS.has(c)) return c;
  if (/^#[0-9a-f]{6}$/.test(c) || /^#[0-9a-f]{3}$/.test(c)) return c;
  return null;
}

function _markupRainbow(text) {
  const parts = [];
  text.replace(/&[a-z#][a-z0-9]*;|./gis, m => parts.push(m));
  return parts.map((ch, i) => {
    const hue = Math.round((i / Math.max(parts.length - 1, 1)) * 300);
    return `<span style="color:hsl(${hue},100%,65%)">${ch}</span>`;
  }).join('');
}

function _applyBBCode(s) {
  s = s.replace(/\[rainbow\]([\s\S]*?)\[\/rainbow\]/gi, (_, t) => _markupRainbow(t));
  s = s.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>');
  s = s.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>');
  s = s.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<span style="text-decoration:underline">$1</span>');
  s = s.replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<span style="text-decoration:line-through">$1</span>');
  s = s.replace(/\[big\]([\s\S]*?)\[\/big\]/gi, '<span style="font-size:1.4em">$1</span>');
  s = s.replace(/\[small\]([\s\S]*?)\[\/small\]/gi, '<span style="font-size:0.8em">$1</span>');
  s = s.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, '<code style="background:var(--bg3);padding:1px 4px;border-radius:2px;font-family:var(--font-mono)">$1</code>');
  s = s.replace(/\[center\]([\s\S]*?)\[\/center\]/gi, '<div style="text-align:center">$1</div>');
  s = s.replace(/\[blink\]([\s\S]*?)\[\/blink\]/gi, '<span style="animation:blink 1s step-end infinite">$1</span>');
  s = s.replace(/\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi,
    '<span style="filter:blur(4px);cursor:pointer;user-select:none" title="Click to reveal" onclick="this.style.filter=\'\'">$1</span>');
  s = s.replace(/\[color=([^\]]{1,30})\]([\s\S]*?)\[\/color\]/gi, (_, colorRaw, text) => {
    const color = _markupSafeColor(colorRaw);
    return color ? `<span style="color:${color}">${text}</span>` : text;
  });
  s = s.replace(/\[player\]([\s\S]*?)\[\/player\]/gi, '<span style="color:var(--purple)">$1</span>');
  s = s.replace(/\[item\]([\s\S]*?)\[\/item\]/gi, '<span style="color:var(--yellow)">$1</span>');
  s = s.replace(/\[system\]([\s\S]*?)\[\/system\]/gi, '<span style="color:var(--text-dim)">$1</span>');
  s = s.replace(/\[danger\]([\s\S]*?)\[\/danger\]/gi, '<span style="color:var(--red)">$1</span>');
  s = s.replace(/\[safe\]([\s\S]*?)\[\/safe\]/gi, '<span style="color:var(--green)">$1</span>');
  return s;
}

// Full pipeline: expand tokens → HTML-escape → apply BBCode → safe HTML.
function parseMarkup(raw) {
  return _applyBBCode(_markupEsc(expandTokens(raw)));
}

// BBCode only — no token expansion. Safe for rendering messages received from players.
function renderMarkup(raw) {
  return _applyBBCode(_markupEsc(String(raw ?? '')));
}

const STATUS_TEMPLATE = '[b][color=#00ffff][system]ARCHITECT LIVE STATS[/system][/color][/b]  |  [player]$name[/player]  |  [u]ZONE:$zone[/u]  |  HP:[color=red]$hp/$maxhp[/color]  |  SAN:[i]$san[/i]  |  RAD:[s]$rad[/s]  |  TEMP:[b]$temp[/b]  |  CREDITS:[color=#00ff99]$credits[/color]  |  XP:$xp  |  [item]$weapon[/item] ACTIVE';

const MARKUP_HELP_HTML = `
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
  <div style="color:var(--text-dim);margin-top:6px;font-size:11px">Note: player-stat variables ($hp, $rad, …) don't resolve in the dev panel — only $name does. Markup applies in whisper &amp; channels only.</div>
</div>`.trim();

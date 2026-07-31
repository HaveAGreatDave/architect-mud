// The ARCHITECT splash for scripts/oneshots.bat — drawn here rather than with
// `echo` lines in the .bat itself.
//
// WHY: cmd.exe decodes a batch file using whatever codepage is active when it
// reads each line, so block glyphs embedded in the .bat get mangled BEFORE the
// script's own `chcp` can take effect — a chicken-and-egg you cannot win from
// inside the file. Node controls its own stdout encoding, so the glyphs survive
// regardless of where the console started, and the .bat stays pure ASCII.
//
//   node scripts/banner.mjs            full splash
//   node scripts/banner.mjs --plain    ASCII-only fallback
//
// If the shaded blocks ever render as garbage in your terminal, that is a font
// or codepage problem in the console, not here — run with --plain.

const FULL = '█', DARK = '▓', MED = '▒', LIGHT = '░';

// 5-row block font, '#' = filled cell. Only the letters ARCHITECT needs.
const FONT = {
  A: [' ## ', '#  #', '####', '#  #', '#  #'],
  R: ['### ', '#  #', '### ', '# # ', '#  #'],
  C: [' ###', '#   ', '#   ', '#   ', ' ###'],
  H: ['#  #', '#  #', '####', '#  #', '#  #'],
  I: ['###', ' # ', ' # ', ' # ', '###'],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  '],
  E: ['####', '#   ', '### ', '#   ', '####'],
};

const TEXT = [
  'O N E - S H O T   R U N N E R',
  '',
  'post-deploy data transformations the CODEX deploy',
  'cannot perform on its own. All idempotent, and CI',
  'never runs any of them.',
];

export function banner({ plain = false } = {}) {
  const fill = plain ? '#' : FULL;
  const rows = [0, 1, 2, 3, 4].map(r =>
    'ARCHITECT'.split('').map(ch => FONT[ch][r]).join(' ').replace(/#/g, fill));

  const artW = rows[0].length;
  const inner = Math.max(artW, ...TEXT.map(t => t.length + 2));
  // Box corners/edges, or their ASCII stand-ins.
  const [tl, tr, bl, br, h, v] = plain
    ? ['+', '+', '+', '+', '-', '|']
    : ['╔', '╗', '╚', '╝', '═', '║'];

  const out = ['', ...rows.map(r => '  ' + r)];
  // A three-step fade under the wordmark — the shading ramp is the whole point.
  for (const shade of plain ? ['=', '-', '.'] : [DARK, MED, LIGHT]) {
    out.push('  ' + shade.repeat(artW));
  }
  out.push('');
  out.push(' ' + tl + h.repeat(inner) + tr);
  for (const line of TEXT) out.push(' ' + v + ' ' + line.padEnd(inner - 2) + ' ' + v);
  out.push(' ' + bl + h.repeat(inner) + br);
  return out.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('banner.mjs')) {
  console.log(banner({ plain: process.argv.includes('--plain') }));
}

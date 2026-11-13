// Cosmetic-machine plugin regression suite — run by tests/regress.js (never
// loaded in production). `morphex` returns null when the current zone has no
// machine, or a panel when it does — both prove the verb is routed.
import { displayRung, setDisplayRung, DISPLAY_MODE_FLAG } from '../../server/engine/presentation.js';
import { setFlag } from '../../server/engine/flags.js';
import { on, off } from '../../server/engine/events.js';

export default async function regress({ run, check, getPlayer }) {
  // ── The catalog and the figure agree (client/shared/morphex-catalog.js, player-figure.js) ─────────
  // Every style the machine sells is a cut the sculpted figure can draw, and a look turns into the
  // figure's keys: a face part, the tattoo mask and its ink.
  {
    const { HAIR_STYLES, FACE, TATTOO_PLACES, TATTOO_ORDER, tattooCode } = await import('../../client/shared/morphex-catalog.js');
    const { playerFigure } = await import('../../client/shared/player-figure.js');
    const cuts = Object.values(HAIR_STYLES).map((h) => h.cut);
    check('every hair style is a figure cut, 0 to 20', cuts.every((c) => Number.isInteger(c) && c >= 0 && c <= 20), cuts.join(','));
    check('every new cut 6..20 is sold', [...Array(15)].every((_, i) => cuts.includes(i + 6)));
    check('every tattoo place has a slot in the mask', Object.keys(TATTOO_PLACES).every((p) => TATTOO_ORDER.includes(p)) && TATTOO_ORDER.length * 3 <= 31);
    check('a tattoo code packs three bits a place', tattooCode({ cheek: 'teardrop', chest: 'script' }) === (1 | (3 << 18)), String(tattooCode({ cheek: 'teardrop', chest: 'script' })));
    const fg = playerFigure({ hair_style: 'afro', hair_length: 'short', hair_color: 'black', face: { shape: 'lean', skin: 'tan', facial: 'goatee' }, tattoos: { neck: 'band' }, ink: 'red' });
    check('a look maps to the figure: cut, head, skin, facial', fg.hair_style === 10 && fg.head === 2 && Array.isArray(fg.skin) && fg.facial === 'goatee', JSON.stringify(fg));
    check('…and its tattoos and ink', fg.tat === 2 << 6 && fg.tat_ink?.length === 3, JSON.stringify(fg));
    check('every face option has values', Object.values(FACE).every((F) => F.values.length >= 3));
  }

  let r = await run('morphex');
  check('morphex verb routed', r === null || r?.type === 'morphex_panel', `type=${r?.type ?? 'null'}`);

  r = await run('use somejunkitem');
  check('use falls through machine intercept', r?.type === 'error' && !/Unknown command/.test(r.message || ''), r?.message);

  // Opening the panel is announced. The prologue's first door opens on it, so a
  // new player never has to change anything to leave The Inbetween.
  {
    const { _test } = await import('./index.js');
    let opened = null;
    const seen = ({ actor }) => { opened = actor; };
    on('cosmetic.opened', seen);
    try {
      _test.openPanel(getPlayer());
      check('opening the panel emits cosmetic.opened', opened?.id === getPlayer().id, `actor=${opened?.id}`);
    } finally {
      off('cosmetic.opened', seen);
    }
  }

  // ── The bottom rung gets a sheet, not a modal ──────────────────────────────
  // Chargen is BLOCKING: the prologue's first move gate wants `cosmetic.opened`
  // and this machine is the only thing that emits it. A player who cannot operate
  // a panel has to be able to read the same data and be told the commands.
  //
  // Set the rung through `setDisplayRung`, not by poking the latch — buildPanelData
  // reads `loggedPanelsSync`, which is hydrated from the flag.
  const player = getPlayer();
  const saved = await displayRung(player);
  try {
    await setDisplayRung(player, 'log');
    r = await run('morphex');
    // null when the harness's zone has no machine; that's the same short-circuit
    // the first case allows and says nothing about the rung.
    if (r !== null) {
      check('log rung gets the BioSculpt sheet in text', r?.type !== 'morphex_panel', `type=${r?.type}`);
    }
    // …and the renderer itself, directly, because the harness's zone holds no
    // machine and `morphex` short-circuits to null there — without this the one
    // surface a player who cannot operate the panel depends on is never run.
    const { _test } = await import('./index.js');
    const sheet = _test.renderMorphexText({ ...player, _morphexChargen: true }, 'Hair color → black.');
    check('the sheet reports what just changed', /Hair color → black/.test(sheet.message), sheet.message?.slice(0, 60));
    check('…the current appearance', /Hair:/.test(sheet.message) && /Eyes:/.test(sheet.message));
    check('…and every command that changes it', ['sex', 'hair color', 'hair length', 'hair style', 'eye color', 'height', 'weight']
      .every((c) => sheet.message.includes(`morphex ${c}`)), sheet.message?.slice(0, 120));
    check('…and chargen quotes no price', !/₵/.test(sheet.message), sheet.message?.slice(0, 120));
    check('…and the face, tattoo and ink commands', ['face shape', 'face facial', 'tattoo', 'ink'].every((c) => sheet.message.includes(`morphex ${c}`)), sheet.message?.slice(-200));
  } finally {
    // Restore NEVER-CHOSEN as never-chosen. `setDisplayRung(player, undefined)`
    // coerces to `visual`, which is a different state — it would leak an explicit
    // rung onto the shared harness player and quietly change what every later
    // suite's predicates answer.
    if (saved) await setDisplayRung(player, saved);
    else { await setFlag('player', DISPLAY_MODE_FLAG, '', player).catch(() => {}); player.displayRung = undefined; }
  }
}

// Cosmetic-machine plugin regression suite — run by tests/regress.js (never
// loaded in production). `morphex` returns null when the current zone has no
// machine, or a panel when it does — both prove the verb is routed.
import { displayRung, setDisplayRung, DISPLAY_MODE_FLAG } from '../../server/engine/presentation.js';
import { setFlag } from '../../server/engine/flags.js';

export default async function regress({ run, check, getPlayer }) {
  let r = await run('morphex');
  check('morphex verb routed', r === null || r?.type === 'morphex_panel', `type=${r?.type ?? 'null'}`);

  r = await run('use somejunkitem');
  check('use falls through machine intercept', r?.type === 'error' && !/Unknown command/.test(r.message || ''), r?.message);

  // ── The bottom rung gets a sheet, not a modal ──────────────────────────────
  // Chargen is BLOCKING: the prologue's first move gate wants `appearance.changed`
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
  } finally {
    // Restore NEVER-CHOSEN as never-chosen. `setDisplayRung(player, undefined)`
    // coerces to `visual`, which is a different state — it would leak an explicit
    // rung onto the shared harness player and quietly change what every later
    // suite's predicates answer.
    if (saved) await setDisplayRung(player, saved);
    else { await setFlag('player', DISPLAY_MODE_FLAG, '', player).catch(() => {}); player.displayRung = undefined; }
  }
}

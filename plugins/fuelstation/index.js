/**
 * Fuel station — the forecourt's two pieces of furniture, and nothing else.
 *
 * ── THE RULE THIS PLUGIN EXISTS TO KEEP ─────────────────────────────────────
 *
 * A PRICE ON A SIGN IS NEVER A NUMBER THIS FILE KNOWS.
 *
 * Three separate systems already take money for fuel, each with its own idea of what a unit even
 * is: trucking sells a TANK FRACTION at `FUEL_FULL` a tank, the pump sells FLUID UNITS into a jerry
 * can at whatever the furniture's `fuel_source` says, and flight sells AIRCRAFT UNITS at a field.
 * The obvious build is a table here with three rows in it, and that table is wrong the first time
 * anybody retunes diesel — a sign that lies about the price is worse than no sign, because a player
 * reads it and then budgets a haul against it.
 *
 * So the board is a RENDERER over a gather hook. `fuel.prices` asks the room "what does anybody
 * here sell, and for how much", and whoever is charging answers with the number they will actually
 * charge. Nothing is authored twice, and a system that starts selling fuel tomorrow appears on
 * every board in the game by adding one hook.
 *
 * The pumps themselves need no code at all to work: `fuel_source` on a furniture row is already the
 * whole contract the fillable plugin's `fill` reads, and a `fuel_yard` tile is already the whole
 * contract trucking's `fuel` reads. This file only makes them SAY so when you look at them.
 *
 * ── ⚠ `fuel.prices` IS A SYNC HOOK. EVERY CONTRIBUTOR MUST STAY SYNCHRONOUS ─────────────────────
 *
 * There are two boards now, and the second one is on the other side of a hot path. `examine` gets
 * the framed one below, through the ordinary awaited `gatherHook`. The PYLON — the thing you read
 * from the road, out the truck's windscreen — is painted by the renderer from `brd` on the map
 * cell, and deriveSurfaceCell (plugins/flight/state.js) builds that with `gatherHookSync`, because
 * it runs for every cell of a ~73×73 window and cannot afford an await.
 *
 * So a contributor that becomes `async` does not break: it silently vanishes from the pylon while
 * every awaited caller keeps working, which is the worst shape a bug can have. The regress suite
 * asserts the hook answers without a promise, and both gathers agree row for row.
 */
import { gatherHook } from '../../server/engine/plugins.js';
import { getZoneFurniture, getZone } from '../../server/engine/world.js';

// The board's width, in characters. Everything is padded to it so the frame survives a
// proportional typeface in the log — the same rule the bounty poster follows, and for the same
// reason: this is a RECORD first and a graphic second.
const WIDTH = 34;
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
const padL = (s, n) => (' '.repeat(n) + s).slice(-n);

// The gasoline in the pumps, which is this plugin's own row because the pump furniture is the
// thing that charges for it. `fuel_source` carries ₵ per fluid unit; a bare `true` is a pump
// somebody stood up without pricing, and free fuel is a real answer, so it says so.
export function pumpPrice(f) {
  const v = f?.flags?.fuel_source;
  return typeof v === 'number' ? v : 0;
}

export const hooks = {
  // ── This plugin's own contribution to the board ──
  // One row per DISTINCT price on the forecourt, not one per pump — two islands charging the same
  // are one grade, which is what a sign says.
  'fuel.prices': (zone) => {
    const pumps = getZoneFurniture(zone?.id).filter(f => f.flags && 'fuel_source' in f.flags);
    if (!pumps.length) return null;
    const prices = [...new Set(pumps.map(pumpPrice))];
    return prices.map(p => ({
      grade: 'GASOLINE', unit: 'unit', price: p,
      note: p > 0 ? 'into a can' : 'free — nobody has repriced it',
    }));
  },

  'furniture.describe': async (f) => {
    if (f.flags && 'fuel_source' in f.flags) {
      const p = pumpPrice(f);
      // What a pump AFFORDS, in the words of the verbs that do it. The `fill` link is generic —
      // `fill` resolves the container out of your own inventory, so naming one here would be a
      // guess about what you are carrying.
      return `<span class="text-dim">Live, and metered${p > 0 ? ` at <b>${p}₵</b> a unit` : ''}.`
        + ` <span class="action-link" data-action="cmd" data-cmd="fill">fill a can</span>`
        + ` · <span class="action-link" data-action="cmd" data-cmd="fuel">fuel the rig</span></span>`;
    }
    if (!f.flags?.fuel_price_sign) return undefined;

    const zone = { id: f.zone_id };
    const rows = (await gatherHook('fuel.prices', zone)).filter(r => r && r.grade);
    if (!rows.length) return `<span class="text-dim">The board is dark. Nobody here is selling.</span>`;
    // Cheapest first — a price board is read for the number, and a driver scanning one from the
    // road is looking for the bottom of it.
    rows.sort((a, b) => a.price - b.price);

    const line = (l, r) => `│ ${pad(l, WIDTH - 4 - 9)}${padL(r, 9)} │`;
    const out = [
      '┌' + '─'.repeat(WIDTH - 2) + '┐',
      // The forecourt's own name, off the tile, never a string in this file: the plugin is THOMAS
      // and "Flash Point" is Architect. A second forecourt gets its own header for free.
      line(((getZone(f.zone_id)?.flags?.building_name) || 'FUEL').toUpperCase().slice(0, WIDTH - 4), ''),
      '├' + '─'.repeat(WIDTH - 2) + '┤',
      ...rows.map(r => line(r.grade, `${r.price}₵/${r.unit}`)),
      '└' + '─'.repeat(WIDTH - 2) + '┘',
    ];
    // The notes go UNDER the frame rather than inside it. A sign has room for a grade and a number
    // and that is all; the qualification is the small print on the pump, which is where a player
    // who wants it will look.
    const notes = rows.filter(r => r.note).map(r => `${r.grade.toLowerCase()}, ${r.note}`);
    return `<pre class="text-amber" style="margin:2px 0;font-size:11px;line-height:1.15">${out.join('\n')}</pre>`
      + (notes.length ? `<span class="text-dim">${notes.join(' · ')}</span>` : '');
  },
};

export const _test = { pumpPrice, WIDTH };

console.log('[fuelstation] Plugin loaded.');

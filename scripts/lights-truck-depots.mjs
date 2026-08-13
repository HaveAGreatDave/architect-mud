// One-shot: switch ON the lights in every truck depot bay.
//
// WHY THIS IS A ONE-SHOT AND NOT A CONTENT EDIT. `light_on` / `light_on_intended` are RUNTIME
// columns and are excluded from the content export, so the CODEX import lands every new fixture at
// the DB default — which is 0, off. Every depot has a power_zones row and a junction-box generator,
// so the bay is genuinely POWERED; it just has nothing lit in it. `getZoneVisibility` sums lumens
// only over fixtures with light_on = 1, gets zero, and falls through to the "powered but no lights
// on" floor of 0.3 — the `gloomy` band. Indoors there is no ambient contribution to rescue it.
//
// The visible symptom is not a dark room, which is why this went unnoticed: entering a depot
// auto-opens the depot panel, that panel mounts INSIDE #area-pane, and the client's visibility
// brightness filter is applied to the whole pane. So what a player sees is the depot UI itself
// dimming as they walk in.
//
// KEYED OFF THE FLAG, NOT A LIST. Every depot bay is a zone carrying flags.truck_depot (read by
// depotAt in plugins/trucking/index.js), so this converges: run it after a deploy that adds a
// sixteenth depot and the sixteenth depot gets lit too, with no edit here.
//
// Local:  node scripts/lights-truck-depots.mjs
// Prod:   node --env-file=.env.prod scripts/lights-truck-depots.mjs
import { query } from '../server/models/db.js';

const r = await query(
  `UPDATE furniture f SET light_on = 1, light_on_intended = 1
     FROM zones z
    WHERE f.zone_id = z.id
      AND f.object_type = 'light'
      AND z.flags ? 'truck_depot'
      AND f.light_on = 0`,
);
console.log(`Lit ${r.rowCount} depot fixture(s).`);
process.exit(0);

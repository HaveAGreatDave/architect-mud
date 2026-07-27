// Cooking interactions — `flip` and `stir`. One function, two verbs: both
// record a handling act against the running session, and the profile decides
// whether that helped. There is no hidden sequence to learn; a steak isn't
// "flip exactly once at 50%", it's "food that likes being turned about halfway".
//
// The tool is a CARRY GATE, not a bonus — same shape as the fishing rod and the
// mining tool. You can't turn a steak without something to turn it with.
import { query } from '../../server/models/db.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { sessionProfile } from './cook.js';
import { HANDLING_VERB } from './profiles.js';
import { timeline } from './quality.js';
import { emit } from '../../server/engine/events.js';

// Semantic only — interact.js has no idea what any of this sounds like.
const SFX_MATERIAL = { dense_meat:'wet_meat', starchy_vegetable:'hard_food', soft_vegetable:'soft_food',
  fruit:'soft_food', egg:'soft_food', preserved:'hard_food', liquid:'liquid', fat_or_oil:'fat',
  aromatic:'soft_food', batter:'dough', bread:'bread', dairy:'dairy' };

const KINDS = {
  flip: { tag: 'can_turn', tool: 'something to turn it with', verb: 'flip', past: 'turn' },
  stir: { tag: 'can_stir', tool: 'something to stir it with', verb: 'stir', past: 'stir' },
};

// What the act reads as, based on where in the cook it landed. Flavour only —
// the scoring lives in quality.js and never leaks a number to the player.
function flavour(session, profile, now) {
  const tl = timeline(session, profile);
  if (now < tl.startedAt + tl.thawMs) return `It's still half-frozen — barely worth the effort.`;
  if (now < tl.doneAt) {
    // Against the cook that was ASKED for, not the plain 1.0 one: a cut being
    // taken rare is only ever 75% of the way through by this measure, so on the
    // raw cookMs it could never read as a late turn however late it was.
    const through = (now - (tl.startedAt + tl.thawMs)) / (tl.cookMs * tl.mult);
    if (through < 0.25) return `Too early — it hasn't taken any colour yet.`;
    if (through > 0.85) return `The underside is already dark. That was late.`;
    return `The underside comes away clean, evenly browned.`;
  }
  if (now < tl.peakEnd) return `It's already there. Leave it alone and get it off the heat.`;
  return `Whatever you do now, it's past saving.`;
}

export async function handle(kind, args, player) {
  const spec = KINDS[kind];
  const nameStr = args.join(' ').trim();
  if (!nameStr) return { type: 'error', message: `${spec.verb[0].toUpperCase()}${spec.verb.slice(1)} what?` };

  // The food is inside the vessel, so this deliberately does NOT filter to
  // top-level rows the way `heat` does.
  const food = await resolveInventoryItem(player, { name: nameStr, topLevel: false });
  if (!food) return { type: 'error', message: `You don't have "${nameStr}".` };

  const session = food.custom_data?.cooking;
  if (!session) return { type: 'error', message: `${food.name} isn't cooking.` };
  const profile = sessionProfile(session);
  if (!profile) return { type: 'error', message: `There's nothing to be done with ${food.name} but wait.` };

  // A soup wants stirring, a steak wants turning — using the wrong one on the
  // wrong food is a nudge back to the right verb, not a silent no-op.
  const wanted = HANDLING_VERB[session.profile] || 'flip';
  if (wanted !== kind) return { type: 'error', message: `You don't ${spec.verb} ${food.name} — you ${wanted} it.` };

  // A microwave has no handling at all — the door is shut and the plate is
  // turning. This is one of the things that makes it a different appliance
  // rather than a fast hob: you commit at the start and find out at the end.
  if (session.microwave) {
    return { type: 'error', message: `It's shut, and it's going round. You'd have to stop it.` };
  }

  const tool = await resolveInventoryItem(player, { tag: spec.tag, topLevel: true });
  if (!tool) return { type: 'error', message: `You need ${spec.tool} — and a free hand to hold it.` };

  const now = Date.now();
  const acts = [...(session.acts || []), { at: now, kind }];
  await query(
    `UPDATE player_inventory
        SET custom_data = jsonb_set(custom_data, '{cooking,acts}', $2::jsonb)
      WHERE id=$1 AND jsonb_exists(custom_data,'cooking')`,
    [food.inv_id, JSON.stringify(acts)]
  );

  // A stir moves the medium; a flip is a utensil striking the pan.
  emit('cooking.sfx', kind === 'stir'
    ? { zoneId: player.current_zone, playerId: player.id, action: 'stir',
        material: SFX_MATERIAL[session.profile] || 'liquid', vessel: 'metal', intensity: 0.5 }
    : { zoneId: player.current_zone, playerId: player.id, action: 'impact',
        surface: 'metal', intensity: 0.45 });

  return { type: 'output', message: `You ${spec.past} ${food.name} with the ${tool.name}. ${flavour(session, profile, now)}` };
}

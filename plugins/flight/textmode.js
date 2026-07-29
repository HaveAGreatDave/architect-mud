// Text-only passenger travel — the accessibility seam that lets a rider cross the
// map without the client ever mounting the graphical cabin-window HUD.
//
// The Leviathan already had a graphics-free ride (a walkable cabin of real rooms);
// every OTHER aircraft shoved a canvas panel at its passengers with no way to
// decline. This is that way: one persisted player flag, read ONCE at board time and
// latched onto the live player as `player.textTravel`, so `pushHud` — which is sync
// and runs every 3s tick — can skip a text-only rider without an await.
//
// Deliberately PASSENGERS ONLY. Piloting stays sim-only: the continuous model is a
// client-side physics sim reconciled by the server, so there is no server-side
// flight to narrate for a pilot. A text-mode pilot is a separate system, not a flag.
//
// The rider keeps `window` — opting into the view for one leg sets cabinWindowOpen,
// which outranks this everywhere, so text mode is a default, not a lockout.
import { getFlag } from '../../server/engine/flags.js';
import { liveAircraft, getLivePlayer, sendToPlayer, isContinuous, BAND_LABEL, degToCardinal } from './state.js';

export const TEXT_TRAVEL_FLAG = 'flight_text_only';

export async function prefersTextTravel(player) {
  return String(await getFlag('player', TEXT_TRAVEL_FLAG, player).catch(() => undefined)) === 'true';
}

// Flavor by flight phase. Kept as plain arrays in the shape a zone authors
// `ambient_events` — a line is atmosphere, not a readout, so none of these carry
// numbers the player would have to trust.
const LINES = {
  ground: [
    'The airframe rocks over a seam in the tarmac and settles again.',
    'Something metal ticks as it warms, somewhere behind the bulkhead.',
    'The engine note climbs, holds, and drops back to a patient idle.',
  ],
  climb: [
    'The floor tilts back and stays there; your bag slides against your heel.',
    'Pressure packs your ears and the ground noise falls away all at once.',
    'The engines lean into a long, loaded roar and the seat presses your spine.',
  ],
  cruise: [
    'The engines settle into a drone you stop hearing after a while.',
    'Cold bleeds through the hull skin where your shoulder rests against it.',
    'Somewhere forward, a switch is thrown and thrown back.',
    'The airframe shivers once through a patch of rough air, then smooths out.',
  ],
  descent: [
    'Your stomach floats a moment as the nose drops.',
    'The engines come back to almost nothing, and the wind gets loud instead.',
    'The whole airframe shudders as something big and mechanical extends below you.',
  ],
};

function phaseOf(live) {
  if (!live.row.airborne || live.cont?.onGround) return 'ground';
  const vs = live.cont?.vs || 0;
  if (vs > 300) return 'climb';
  if (vs < -300) return 'descent';
  return 'cruise';
}

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// The one line a rider gets on the way in, so text mode never looks like a failure
// to load something. Also tells them the door back to the view is still there.
export function boardingLine(live) {
  return `<span class="text-dim">You take a seat in the ${live.type.name}'s cabin and let the window stay a window. `
    + '(<span class="action-link" data-action="cmd" data-cmd="window">window</span> to look out; Vehicles → Cabin View to change this for good.)</span>';
}

// A quiet, low-frequency readout so a text-only rider can still answer "where am I,
// how high, which way" without a gauge. Cheap: everything is already in live.row.
function statusLine(live) {
  const band = BAND_LABEL[live.row.altitude_band] || 'GND';
  const hdg = degToCardinal(live.row.heading || 0).toUpperCase();
  return `<span class="text-dim">[${band} · heading ${hdg}]</span>`;
}

// ── Narration tick ────────────────────────────────────────────────────────────
// Its own slow schedule (see index.js), NOT the 3s flight tick: a text line every
// three seconds is a wall of scroll, not atmosphere. Fires for a minority of riders
// each pass, the same way the engine's zone ambience abstains most of the time.
export function textTravelTick() {
  for (const live of liveAircraft.values()) {
    if (!isContinuous(live) || !live.occupants?.size) continue;
    const phase = phaseOf(live);
    for (const pid of live.occupants) {
      const p = getLivePlayer(pid);
      if (!p || !p.textTravel || p.seat === 'pilot' || p.cabinWindowOpen) continue;
      // Parked with the engines off is not a flight — say nothing at all.
      if (phase === 'ground' && !live.row.engine_on) continue;
      if (Math.random() > 0.35) continue;
      const line = pick(LINES[phase]);
      const status = phase !== 'ground' && Math.random() < 0.3 ? ` ${statusLine(live)}` : '';
      sendToPlayer(pid, { type: 'output', message: `<span class="text-dim">${line}</span>${status}` });
    }
  }
}

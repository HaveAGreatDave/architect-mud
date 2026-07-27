/**
 * Studio audience door — the ticket gate on a live taping.
 *
 * A channel with a `studio_zone_id` is a real room players can walk into. When
 * something is being ACTED in there (talkshow / gameshow / morning show — the
 * live-assembled modes with cast on the floor), that room is a set with an
 * audience in it, and the house is ticketed.
 *
 * THE GATE IS A PERSON, NOT A LAW. It only bites while a doorman NPC
 * (`flags.audience_door`) is standing on the outside tile, alive, and on shift.
 * Kill him, wait him out, or catch him off shift and the door is just a door —
 * which is the intended out, not a hole.
 *
 * A pass is a DATED DOCUMENT. The broadcast schedule has no day-of-week, so the
 * date lives on the ticket instead: the box office stamps the row's
 * custom_data.show_pass with the exact absolute airtime slot it sold you
 * (`slot` = in-game day × blocks-per-day + block, so it is self-dating), and the
 * doorman compares that against the slot the world is in right now. Yesterday's
 * pass is a souvenir. It is NOT consumed on entry — step out for a smoke and the
 * same pass walks you back in, until the showing ends.
 *
 * Off air there is no taping, so there is no house: the doorman turns everyone
 * away and the box office sells for the NEXT taping instead of the current one.
 */

// Live-ACTED playback modes: cast physically on the studio floor, so a live
// audience makes sense. Weather forecasts are acted but they're a two-minute
// hit, not a show you queue for.
const AUDIENCE_MODES = new Set(['talkshow', 'gameshow', 'morning']);

// The doorman works every hour except the dead small hours — the studio is
// never truly shut, but nobody tapes at four in the morning and nobody guards it.
const DOOR_OPEN_HOUR = 8;    // on shift from 08:00 …
const DOOR_CLOSE_HOUR = 2;   // … through to 02:00

export function doormanOnShift(hour) {
  return hour >= DOOR_OPEN_HOUR || hour < DOOR_CLOSE_HOUR;
}

// An acted item's @airtime blocks. No airSlots at all ⇒ continuous (airs every
// block), same convention as sports/talkshow elsewhere in this plugin.
function itemAirSlots(item, gamesPerDay) {
  const script = item.talkshowScript || item.gameshowScript || null;
  const slots = script?.airSlots;
  if (!Array.isArray(slots) || !slots.length) return null;
  return [...new Set(slots.map(n => ((n % gamesPerDay) + gamesPerDay) % gamesPerDay))].sort((a, b) => a - b);
}

// Turn an absolute slot index back into the in-game calendar date it falls on —
// the inverse of sportsInGameMinutes()' day arithmetic, so it lines up with the
// date the environment reports.
function dateForSlot(absSlot, gamesPerDay) {
  const day = Math.floor(absSlot / gamesPerDay);
  return new Date(day * 86400000).toISOString().slice(0, 10);
}

const _hhmm = (absSlot, gamesPerDay) => {
  const block = ((absSlot % gamesPerDay) + gamesPerDay) % gamesPerDay;
  return `${String(Math.floor(block * (24 / gamesPerDay))).padStart(2, '0')}:00`;
};

// The taping happening in `absSlot`, or null. Continuous items count as always on.
function showingAt(state, absSlot, gpd) {
  const block = ((absSlot % gpd) + gpd) % gpd;
  for (const item of (state?.playlist || [])) {
    if (!AUDIENCE_MODES.has(item.playback_mode)) continue;
    const slots = itemAirSlots(item, gpd);
    if (!slots || slots.includes(block)) return item;
  }
  return null;
}

export const _audienceTest = { showingAt, itemAirSlots, dateForSlot, doormanOnShift, AUDIENCE_MODES };

export function installAudienceGate({
  channelRuntime, studioZoneIndex, sportsSlotIndex, gamesPerDay,
  registerMoveGate, registerPurchaseStamp, getEnvironmentState, getZoneNpcs, getZone, resolveInventoryItem,
  ticketItemId = 'item_holo_ticket',
}) {
  // What the box office is selling: the taping on right now, else the next one.
  // Scans forward a full day of blocks — a channel that tapes at all will hit.
  function currentOrNextShowing(state) {
    const gpd = gamesPerDay;
    const now = sportsSlotIndex();
    for (let i = 0; i <= gpd; i++) {
      const abs = now + i;
      const item = showingAt(state, abs, gpd);
      if (item) return { item, absSlot: abs, live: i === 0 };
    }
    return null;
  }

  function stateForStudio(zoneId) {
    const channelId = studioZoneIndex.get(zoneId);
    return channelId ? (channelRuntime.get(channelId) || null) : null;
  }

  // ── The box office ─────────────────────────────────────────────────────────
  // Stamps each pass with the exact showing it admits you to. Refuses outright
  // when the station has nothing acted on its books at all.
  registerPurchaseStamp(ticketItemId, async (player, npc) => {
    const zoneId = npc?.zone_id || npc?.home_zone;
    // The box office sits on the facade; the studio it fronts is the tile inside.
    const state = studioStateNear(zoneId);
    if (!state) return '"Not my window." She doesn\'t elaborate.';
    const next = currentOrNextShowing(state);
    if (!next) {
      return `"Nothing's taping. Nothing's scheduled to tape." The window slides shut. "Come back when the sign's lit."`;
    }
    const date = dateForSlot(next.absSlot, gamesPerDay);
    const time = _hhmm(next.absSlot, gamesPerDay);
    const name = next.item.broadcastName || next.item.broadcastId || 'the taping';
    return {
      show_pass: {
        channel: state.channelId,
        broadcast: next.item.broadcastId || null,
        name,
        slot: next.absSlot,
        date,
        time,
      },
      _line: next.live
        ? `The pass is stamped ${name.toUpperCase()} — HOUSE OPEN NOW. They're already rolling.`
        : `The pass is stamped ${name.toUpperCase()} — ${date} ${time}. Good for that showing and no other.`,
    };
  });

  // Find the studio a facade tile fronts: the box office stands outside, so walk
  // the tile's exits looking for the interior that a channel calls its studio.
  function studioStateNear(zoneId) {
    if (!zoneId) return null;
    const direct = stateForStudio(zoneId);
    if (direct) return direct;
    const exits = getZone(zoneId)?.exits || {};
    for (const dir of Object.keys(exits)) {
      const target = typeof exits[dir] === 'string' ? exits[dir] : exits[dir]?.target;
      const s = target && stateForStudio(target);
      if (s) return s;
    }
    return null;
  }

  // ── The door ───────────────────────────────────────────────────────────────
  registerMoveGate(async ({ player, from, to }) => {
    const state = to?.id ? stateForStudio(to.id) : null;
    if (!state) return;                                   // cheap: only a studio tile pays
    // Only the way IN from outside is a door. Moving between the studio's own
    // interior rooms (up to production, down to the power room and back) is free.
    if (!from || from.map_id === to.map_id) return;

    const doorman = (getZoneNpcs(from.id) || []).find(n => n.flags?.audience_door && !n._dead);
    if (!doorman) return;                                 // nobody working the rope
    const env = getEnvironmentState();
    if (!doormanOnShift(Number(env?.hour) || 0)) return;

    const now = sportsSlotIndex();
    const showing = showingAt(state, now, gamesPerDay);
    if (!showing) {
      return { block: true, message: `${doorman.name} doesn't move. "Nothing's taping. There's no house to be in." A thumb, jerked back over his shoulder at the dark stage door.` };
    }

    const rows = await resolveInventoryItem(player, { name: 'audience pass', topLevel: false, all: true }).catch(() => []);
    const valid = (rows || []).find(r => {
      const cd = typeof r.custom_data === 'string' ? (() => { try { return JSON.parse(r.custom_data); } catch { return {}; } })() : (r.custom_data || {});
      return cd.show_pass && Number(cd.show_pass.slot) === now;
    });
    if (valid) return;                                    // he tears nothing; the pass rides the whole showing

    // Held the wrong night's pass? He'll say so — it's the difference between
    // being turned away and being mocked.
    const stale = (rows || []).find(r => {
      const cd = typeof r.custom_data === 'string' ? (() => { try { return JSON.parse(r.custom_data); } catch { return {}; } })() : (r.custom_data || {});
      return cd.show_pass;
    });
    if (stale) {
      const cd = typeof stale.custom_data === 'string' ? JSON.parse(stale.custom_data) : stale.custom_data;
      const p = cd.show_pass;
      return { block: true, message: `${doorman.name} tilts your pass to the light and hands it straight back. "${p.date} ${p.time}. That show's been and gone." He does not sound sorry. "Box office is right there."` };
    }
    const name = showing.broadcastName || 'the taping';
    return { block: true, message: `${doorman.name} fills the doorway without appearing to move into it. "Pass." A beat. "${name}, house is open, and you haven't got one. Window's twenty-five and it's four steps that way."` };
  }, 'broadcast:audience-door');
}

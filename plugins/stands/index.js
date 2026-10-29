// plugins/stands/index.js
//
// STANDS — a seat at the game, in the park it's being played in.
//
// A room carrying `flags.stands` is a place you buy a seat: `{ sport, sections: [{ id, name,
// price, eye, note }] }`. `eye` is where the seat puts your head in the 3-D view's own frame
// (feet: the rink's sheet for hockey, the field's for baseball; see client/game/js/panels/
// stands.js), so the seat chart the client draws is laid out from the same numbers the camera
// stands on, and a section can't sit on the chart somewhere its view isn't.
//
// ⚠ A SEAT IS A RECEIVER. The game you watch from the stands is the broadcast's game, the one
// the sim has already decided, so a seat tunes the player to the channel carrying it through the
// same per-player path as the Tablet TV (`tablet_tv.watch`). Nothing here plays hockey. One
// consequence: a player with the Tablet TV open on another channel loses it while seated, since
// a player is one portable receiver. Leaving puts nothing back.
//
// ⚠ THE TICKET IS PAID ONCE PER SEAT. Taking a seat charges its price; moving to another
// section is a new ticket. Leaving the room leaves the seat.

import { getZone, getZoneFurniture } from '../../server/engine/world.js';
import { sendToPlayer, teachVerb } from '../../server/engine/messaging.js';
import { loggedPanelsSync } from '../../server/engine/presentation.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { emit, on } from '../../server/engine/events.js';
import { liveSportsChannel } from '../broadcast/index.js';

// playerId -> { zoneId, section, channelId }
const seated = new Map();

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The room's stands, when it has any worth sitting in.
export function standsOf(zone) {
  const s = zone?.flags?.stands;
  if (!s || (s.sport !== 'hockey' && s.sport !== 'baseball') || !Array.isArray(s.sections)) return null;
  const sections = s.sections.filter((c) => c && c.id && Array.isArray(c.eye) && c.eye.length === 3 && c.eye.every(Number.isFinite));
  return sections.length ? { sport: s.sport, sections } : null;
}

// A section by its id, or by the first word of its name a player is likely to type.
export function findSection(stands, word) {
  const w = String(word || '').toLowerCase().trim();
  if (!w) return null;
  return stands.sections.find((c) => c.id === w)
    || stands.sections.find((c) => String(c.name || '').toLowerCase() === w)
    || stands.sections.find((c) => String(c.name || '').toLowerCase().split(/\W+/).includes(w))
    || null;
}

function chartPayload(zone, stands, player) {
  return {
    type: 'stands_chart', sport: stands.sport, venue: zone.flags?.building_name || zone.name,
    live: !!liveSportsChannel(stands.sport), credits: player.credits | 0,
    seated: seated.get(player.id)?.section || null,
    sections: stands.sections.map(({ id, name, price, eye, note }) => ({ id, name: name || id, price: price | 0, eye, note: note || '' })),
  };
}

function chartText(zone, stands, player) {
  const rows = stands.sections.map((c) => `  <b>${esc(c.name || c.id)}</b> · ₵${c.price | 0}${c.note ? ` · ${esc(c.note)}` : ''}`);
  const live = liveSportsChannel(stands.sport);
  return `<span class="msg-system">${esc(zone.flags?.building_name || zone.name)}: the seats.<br>${rows.join('<br>')}<br>`
    + `${live ? `${teachVerb('stands')} &lt;section&gt; buys one.` : 'No game on right now.'} You have ₵${player.credits | 0}.</span>`;
}

function leave(player, quiet = false) {
  const s = seated.get(player.id);
  if (!s) return false;
  seated.delete(player.id);
  emit('tablet_tv.unwatch', { playerId: player.id });
  sendToPlayer(player.id, { type: 'stands_close' });
  if (!quiet) sendToPlayer(player.id, { type: 'output', message: '<span class="msg-system">You get up out of your seat.</span>' });
  return true;
}

async function cmdStands(args, raw, player) {
  const zone = getZone(player.current_zone), stands = standsOf(zone);
  const a0 = String(args[0] || '').toLowerCase();
  if (a0 === 'leave' || a0 === 'up' || a0 === 'off') {
    return leave(player) ? { type: 'noop' } : { type: 'error', message: "You aren't sitting anywhere." };
  }
  if (!stands) return { type: 'error', message: 'There are no seats to buy here.' };
  if (!a0) {
    // the log rung has no panels: the list in the log is the chart
    if (!loggedPanelsSync(player)) sendToPlayer(player.id, chartPayload(zone, stands, player));
    return { type: 'output', message: chartText(zone, stands, player) };
  }
  const section = findSection(stands, args.join(' '));
  if (!section) return { type: 'error', message: `There's no section called "${esc(args.join(' '))}". ${teachVerb('stands')} shows the chart.` };
  const channelId = liveSportsChannel(stands.sport);
  if (!channelId) return { type: 'error', message: 'No game on right now. The seats are empty.' };
  const was = seated.get(player.id);
  if (was && was.section === section.id && was.zoneId === zone.id) return { type: 'error', message: `You're already in ${esc(section.name)}.` };
  const price = section.price | 0;
  if (price > 0 && !(await adjustCredits(player, -price, undefined, 'stands'))) {
    return { type: 'error', message: `A seat in ${esc(section.name)} is ₵${price}. You have ₵${player.credits | 0}.` };
  }
  seated.set(player.id, { zoneId: zone.id, section: section.id, channelId });
  emit('tablet_tv.watch', { playerId: player.id, channelId });
  // the log rung gets the game as log lines through the same receiver, and no picture
  if (!loggedPanelsSync(player)) sendToPlayer(player.id, { type: 'stands_open', sport: stands.sport, channelId, venue: zone.flags?.building_name || zone.name,
    section: { id: section.id, name: section.name || section.id, eye: section.eye } });
  return { type: 'output', message: `<span class="msg-system">₵${price} for a seat in <b>${esc(section.name)}</b>. You find your row and sit down. ${teachVerb('stands leave')} gets you up.</span>` };
}

// Walking out of the room is getting up.
on('zone.entered', ({ actor, zone }) => {
  const s = actor && seated.get(actor.id);
  if (s && s.zoneId !== zone) leave(actor, true);
});
on('player.logout', ({ id }) => { if (id) seated.delete(id); });

export const commands = { stands: cmdStands };

// A ticket machine (`flags.ticket_machine` on furniture in a stands room) is the
// same chart behind a thing you can walk up to: `use ticket machine` is `stands`.
// Tag-gated so examining it advertises `use`; undefined falls through to the
// inventory `use` builtin when the target isn't a machine here.
export const specializedActions = [{
  verb: 'use',
  requiredTag: 'ticket_machine',
  handler: async (args, raw, player) => {
    const word = args.join(' ').toLowerCase().trim();
    if (!word) return undefined;
    const machine = getZoneFurniture(player.current_zone).find(f => f.flags?.ticket_machine
      && [f.name, ...(f.flags.aliases || [])].some(n => String(n).toLowerCase().includes(word)));
    if (!machine) return undefined;
    return cmdStands([], raw, player);
  },
}];

export const _test = { seated, leave, chartPayload };

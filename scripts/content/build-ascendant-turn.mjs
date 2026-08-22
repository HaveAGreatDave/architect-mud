/**
 * Phase 2 — The Turning: the Ascendant defection arc.
 *
 * WHAT THIS AUTHORS. The hook was already standing and wired to one exit. The
 * Long Watch send you west (quest_asc_1), Maresh recruits you at the plaza,
 * Vess walks you round the Spire, and The First Ascended tells you what Halcyon
 * really sells — and then his own closing line, already written, says "when
 * you're ready to stop merely dying, the clinic is downstairs, and your account
 * is already open." There was no account. This builds it.
 *
 * THE SPINE IS ECONOMY THAT ALREADY EXISTS. The Rite is not a cutscene: it is
 * `aug_cortical_backup` (rep_gate inner_circle, already authored) → `assurance`
 * → `backup` → dying on purpose at the Uplink. The augments plugin's
 * `player.respawnZone` hook turns that death into a CLAIMED one, which is the
 * only kind that skips chrome corruption, and which the new `restore` objective
 * type reads. Nothing here re-implements any of that.
 *
 * FAVOUR IS `player_ideology_rep`, which already has the rungs the arc needs:
 * Known 200 (the clinic opens — `MIN_INSTALL_TIER`), Trusted 500, Inner Circle
 * 900 (the summit chrome, and the Rite). Quests pay it through `rewards.rep`.
 * Post-tour a player sits at 380; the turn puts them at 630; one pass of the
 * favour work carries them past 900.
 *
 * Re-runnable: every write is a whole-file replace keyed on the entity id.
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const ROOT = path.resolve(process.cwd(), 'content');
const stamp = String(Math.floor(Date.now() / 1000));

const write = (dir, obj) => {
  const file = path.join(ROOT, dir, `${obj.id}.json`);
  const existed = fs.existsSync(file);
  fs.writeFileSync(file, canonicalJson(obj), 'utf8');
  console.log(`  ${existed ? 'updated' : 'created'} ${path.relative(process.cwd(), file)}`);
};

const quest = (o) => ({
  category: null, fail_on: [], meta: {}, penalties: {},
  quest_type: 'standard', repeatable: 0, updated_at: stamp, ...o,
});

const ASC = 'ideology_ascendants';
const LW = 'ideology_long_watch';

console.log('— Ascendant favour + rite quests —');

// ── The turn ────────────────────────────────────────────────────────────────
//
// The pledge is not a conversation, it is a FITTING. `chromed_ever` burns off
// every mutation on the first install and permanently closes the flesh path, so
// the moment of no return is one the engine already owns — this quest just
// walks you to it knowing what it costs. The clinic is reachable because the
// Spire tour already left you at 380 rep, over `MIN_INSTALL_TIER`.
write('quests', quest({
  id: 'quest_asc_turn',
  name: 'The Account',
  description: 'The First Ascended said your account was already open. It is. Dr Kesh is downstairs in the consult room and has been expecting you since the Threshold read you, which was some time ago. Nothing is signed. You simply go down, and you come back up as something with a warranty.',
  objectives: [
    {
      id: 'o_consult', type: 'talk', target: 'npc_asc_kesh', count: 1,
      desc: 'See Dr Kesh in the clinic consult room. The account is in your name already.',
    },
    {
      id: 'o_fitted', type: 'install', count: 1, requires: ['o_consult'],
      desc: 'Have your first piece fitted. Any piece — it is the fitting that matters, not the hardware.',
      emotes: ['{who} lies back under the light and lets somebody open them up on purpose.'],
    },
  ],
  rewards: {
    credits: 0, xp: 60,
    rep: [{ ideology: ASC, delta: 250 }, { ideology: LW, delta: -150 }],
    flags: [{ scope: 'player', flag: 'asc_pledged', value: 'done' }],
  },
}));

// ── Favour work ─────────────────────────────────────────────────────────────
//
// Six jobs, three repeatable, each reaching a different built system rather than
// walking you to a tile. THE REPEATABLES ARE NOT DECORATION: standing decays on
// a 30-day half-life by design, so an order with only one-off work has no
// mechanism by which a player stays in it.

// Deliberately banal. A corporation's day work IS banal, and the contrast with
// what the same company does upstairs is the whole joke.
write('quests', quest({
  id: 'quest_asc_fav_actuarial',
  name: 'Actuarial',
  repeatable: 1,
  description: 'Curator Vess hands you a slate and a route. Halcyon prices a district by walking it, because a satellite cannot smell a stairwell. Walk the line, stand where the slate tells you to stand, and bring back numbers nobody will ever read back to you.',
  objectives: [
    {
      id: 'o0', type: 'visit', zone: 'zone_district_894_907', taskSeconds: 8,
      desc: 'Take the first reading on Halcyon Boulevard.',
      emotes: ['{who} holds the slate up, turns slowly on the spot, and waits for it to stop thinking.'],
    },
    {
      id: 'o1', type: 'visit', zone: 'zone_district_907_911', taskSeconds: 8, requires: ['o0'],
      desc: 'Take the second reading on Meltwater Row.',
      emotes: ['{who} logs a number, and the slate declines to say whether it is a good one.'],
    },
  ],
  rewards: { credits: 55, xp: 12, rep: [{ ideology: ASC, delta: 40 }] },
}));

// The Ascendants do not kill you. They RECOVER THE ASSET. `subdue` is the whole
// characterisation — a body left breathing is a body that can resume payments —
// and the `assassinate` fail_on is what stops the player solving it the easy way.
write('quests', quest({
  id: 'quest_asc_fav_lapse',
  name: 'Lapsed',
  repeatable: 1,
  description: 'A client has stopped paying and is still wearing the collateral. Vess is at pains to point out that this is not a punishment: the account remains open, the hardware simply comes home until it is current. She is also at pains to point out that the client is not to be killed. Halcyon does not kill clients. Halcyon repossesses.',
  objectives: [
    {
      id: 'o_down', type: 'subdue', target: 'npc_lapsed_client', count: 1,
      desc: 'Put the lapsed client down — DOWN, not out. Halcyon does not kill clients.',
      emotes: ['{who} waits for the shoulders to drop, and takes them across the back of the head.'],
    },
    {
      id: 'o_asset', type: 'retrieve', item_id: 'item_aug_dermal_jack', zone: 'zone_district_913_908',
      count: 1, requires: ['o_down'],
      desc: 'Recover the collateral.',
    },
  ],
  fail_on: [
    { type: 'assassinate', target: 'npc_lapsed_client', desc: 'You killed a client. A dead client pays nothing, ever, and Halcyon is very clear about the difference.' },
  ],
  rewards: { credits: 140, xp: 22, rep: [{ ideology: ASC, delta: 60 }] },
}));

// The infiltration grammar, which did not exist until `spotted` and `witnessed`
// did. Both constraints on one job: unseen by the room AND unseen by the city.
write('quests', quest({
  id: 'quest_asc_fav_adjuster',
  name: 'Adjuster',
  description: 'There is a claim Halcyon would rather not contest in public, and a terminal on the Hall of Records approach holding the paperwork that would make contesting it necessary. Vess does not ask you to destroy anything. She asks you to go and look, and to be the sort of person nobody remembers looking.',
  objectives: [
    {
      id: 'o_in', type: 'visit', zone: 'zone_district_922_910', taskSeconds: 6,
      desc: 'Get onto the records approach and wait for the floor to go quiet.',
      emotes: ['{who} finds a doorway with a good angle on the corridor and becomes furniture.'],
    },
    {
      id: 'o_pull', type: 'hack', zone: 'zone_district_922_910', count: 1, requires: ['o_in'],
      desc: 'Pull the contested claim off the terminal.',
    },
  ],
  fail_on: [
    { type: 'spotted', desc: 'Somebody looked straight at you. An adjuster who is remembered is not an adjuster.' },
    { type: 'witnessed', desc: 'It reached a camera. Halcyon can settle a great many things, but not a recording.' },
  ],
  rewards: { credits: 220, xp: 34, rep: [{ ideology: ASC, delta: 90 }] },
}));

// Escort, with the constraint stated as a constraint. A prospect who dies on the
// way to the Gate is a prospect who was right about them.
write('quests', quest({
  id: 'quest_asc_fav_lead',
  name: 'A Warm Lead',
  description: 'Somebody in Coldwater has been asking the right questions in the wrong places, and Maresh would like them to arrive at the Gate alive, unhurried, and still curious. He mentions, lightly, that the walk out west is not a safe one, and that this is precisely why the offer lands when it does.',
  objectives: [
    {
      id: 'o_meet', type: 'talk', target: 'npc_asc_prospect', count: 1,
      desc: 'Find the prospect and introduce yourself.',
    },
    {
      id: 'o_walk', type: 'escort', target: 'npc_asc_prospect', zone: 'zone_district_893_906',
      count: 1, requires: ['o_meet'],
      desc: 'Walk them west to the plaza, at their pace.',
      emotes: ['{who} keeps to the inside of the road and keeps talking, which is most of the job.'],
    },
  ],
  fail_on: [
    { type: 'escort_lost', target: 'npc_asc_prospect', desc: 'You lost them on the road. Maresh will say nothing about it, at length.' },
  ],
  rewards: { credits: 190, xp: 30, rep: [{ ideology: ASC, delta: 80 }] },
}));

// Overclocking, stated as a warranty condition rather than a stat. `broke` is
// the whole quest: the hardware is the deliverable and you are the risk.
write('quests', quest({
  id: 'quest_asc_fav_tolerance',
  name: 'Within Tolerance',
  description: 'Foreman Duc wants a piece run in. Not tested — run in, out in the world, doing work, by somebody with a pulse and a poor sense of self-preservation. He is explicit that the piece comes back. He is noticeably less explicit about you.',
  objectives: [
    {
      id: 'o_fit', type: 'install', count: 1,
      desc: 'Have the trial piece fitted at the clinic.',
    },
    {
      id: 'o_run', type: 'visit', zone: 'zone_asc_weave_line', taskSeconds: 10, requires: ['o_fit'],
      desc: 'Bring it back to the line and let Duc read it off you.',
      emotes: ['{who} stands still while a man with chrome arms listens to something inside them.'],
    },
  ],
  fail_on: [
    { type: 'broke', desc: 'Something came apart on you out there. Duc wanted the numbers, and now he has different ones.' },
  ],
  rewards: { credits: 175, xp: 28, rep: [{ ideology: ASC, delta: 70 }] },
}));

write('quests', quest({
  id: 'quest_asc_fav_coldchain',
  name: 'Cold Chain',
  repeatable: 1,
  description: 'The Weave line makes it and the clinic fits it, and in between there is a walk across a campus that nobody senior has ever had to make. The tray is cold, it must stay cold, and Vess thanks you with the exact warmth she would give a working machine.',
  objectives: [
    {
      id: 'o_pick', type: 'visit', zone: 'zone_asc_weave_line', taskSeconds: 5,
      desc: 'Collect the tray from the fabrication line.',
      emotes: ['{who} takes the tray in both hands, the way they were shown, once.'],
    },
    {
      id: 'o_drop', type: 'visit', zone: 'zone_asc_clinic_theatre', taskSeconds: 5, requires: ['o_pick'],
      desc: 'Deliver it to the theatre.',
      emotes: ['{who} sets the tray down and somebody takes it without looking up.'],
    },
  ],
  rewards: { credits: 60, xp: 10, rep: [{ ideology: ASC, delta: 35 }] },
}));

// ── The loyalty mission ─────────────────────────────────────────────────────
//
// The exact inverse of quest_lw_2 and quest_lw_3. The Watch spend their lives
// closing the Architect's eyes; you go and open them again. Nobody dies, which
// is worse — the Watch simply become visible, permanently, and they will know
// precisely who did it.
write('quests', quest({
  id: 'quest_asc_loyalty',
  name: 'Restoring Service',
  description: 'The First does not want a body. Bodies are cheap and He has a building full of them. What He wants is the eastern approaches back in service — the cameras the Watch have spent years quietly blinding, working again by morning. You know where every one of them is. That is the point, and everybody in the room knows it.',
  objectives: [
    {
      id: 'o_p9', type: 'visit', zone: 'zone_district_922_911', taskSeconds: 12,
      desc: 'Restore the street camera on the Precinct 9 approach.',
      emotes: [
        '{who} seats a fresh core in a housing they emptied themselves, not so long ago.',
        '{who} waits for the amber light, and it comes back on.',
      ],
    },
    {
      id: 'o_records', type: 'hack', zone: 'zone_district_922_910', count: 1, requires: ['o_p9'],
      desc: "Push the Watch's blind-spot map back onto the civic net.",
    },
  ],
  fail_on: [
    { type: 'died', desc: 'You did not come back from the eastern approaches, and the Watch are not fools about who was out there.' },
  ],
  rewards: {
    credits: 500, xp: 90,
    rep: [{ ideology: ASC, delta: 200 }, { ideology: LW, delta: -400 }],
    flags: [
      { scope: 'player', flag: 'asc_loyal', value: 'done' },
      { scope: 'player', flag: 'lw_burned', value: 'done' },
    ],
  },
}));

// ── The Rite ────────────────────────────────────────────────────────────────
//
// Three beats and one of them is dying. `restore` fires only on a CLAIMED death
// — the kind somebody arranged for in advance — which means the whole existing
// Ascendant economy has to be standing behind you before the quest can finish at
// all: the summit chrome (inner_circle), a current policy, and a committed
// pattern. The ceremony is real because the paperwork is real.
write('quests', quest({
  id: 'quest_asc_rite',
  name: 'The Rite of Ascension',
  description: 'Celebrant Orrin will walk you to the Uplink himself, which he does not do often. There is a terminal set into the Curtain where hard light meets cold glass, and what happens at it is not a metaphor: your pattern is already held, your account is current, and the only thing still in the way is the body. Orrin says none of that. He says it will be over quickly and that you will not be alone, and both are true.',
  objectives: [
    {
      id: 'o_nave', type: 'visit', zone: 'zone_asc_shrine_nave', taskSeconds: 10,
      desc: 'Stand in the Nave with Orrin while the racks are made ready.',
      emotes: ['{who} stands among the humming racks and lets a gaunt, delighted man explain what is about to happen to them.'],
    },
    {
      id: 'o_uplink', type: 'visit', zone: 'zone_asc_shrine_uplink', taskSeconds: 25, requires: ['o_nave'],
      desc: 'Take your place at the Uplink, where the Curtain meets the glass.',
      emotes: [
        '{who} puts both hands flat on the terminal and the hum stops being a sound.',
        '{who} does not look away from the white fire, which is harder than it sounds.',
      ],
    },
    {
      id: 'o_ascend', type: 'restore', count: 1, requires: ['o_uplink'],
      desc: 'Ascend. (`ascend` at the Uplink terminal. It tells you what it costs before it does it.)',
    },
  ],
  rewards: {
    credits: 0, xp: 250,
    rep: [{ ideology: ASC, delta: 400 }],
    flags: [{ scope: 'player', flag: 'ascended', value: 'done' }],
  },
}));

console.log('done.');

/**
 * Long Watch structural fixes, 2026-08-25. Batch 1 of the faction review.
 *
 * Two changes, and one thing deliberately NOT changed.
 *
 * ── 1. Slot 2 stops being the second fetch in a row ──────────────────────────
 *
 * Slots 1, 2 and 5 were all "go to a marked place, pick up a thing, bring it
 * back", three times before the player had done anything else. The arc design
 * says 1-3 are benign because the order is measuring whether you turn up, but
 * benign is not the same as identical, and slot 5's unlocked case is a good idea
 * sitting behind two rehearsals of itself.
 *
 * So slot 2 inverts. The part is handed over at the bench rather than hunted,
 * and the journey is the DELIVERY: Rennie Vasch keeps the freight yard off
 * Kessler, and a dispatcher who is seen taking Watch parts stops being useful to
 * anybody. That introduces the thing slot 2 was the right place to introduce and
 * the old version never did — the Watch's favour economy. They are not buying
 * her. They are making sure the road has eyes on it that are not theirs.
 *
 * Halloran's "Three that I know of", and the names that never come, survive
 * intact; that beat was always the best thing in the quest.
 *
 * ── 2. Slot 9's loyalty test stops being a fail condition ────────────────────
 *
 * `quest_lw_loyalty` is the Watch's test of whether you will take the chrome,
 * and its objectives were three `visit`s: walk the Boulevard, stand in a clinic,
 * walk home. The entire test lived in `fail_on: install`. A test you pass by not
 * doing anything is a test the player can walk straight through without ever
 * noticing it happened, which wastes the best premise on the ladder.
 *
 * Kesh now has to make the offer to your face while you wait for the part. Same
 * fail condition, but declining is now an act rather than an absence. He is
 * written to be genuinely reasonable, per the standing rule that the rival case
 * is put well and never refuted -- he talks you DOWN in price, unprompted, which
 * is the most persuasive thing a salesman can do.
 *
 * ── NOT changed: slot 7 ──────────────────────────────────────────────────────
 *
 * An earlier pass of this review reported the Watch's crossover rung as missing.
 * That was wrong, and the error was in the audit rather than the content: the
 * tool filtered quests by a `quest_lw_` id prefix, and the Watch's crossover is
 * filed as `quest_asc_1` (Follow the Money) because Ives is the other half of
 * it. It awards `lw_arc = 7`, Cyrelle gates it on `lw_arc > 5`, and it does
 * exactly what slot 7 is for: she sends you into Halcyon, Ives has already been
 * told you are coming, greets you by name, and offers you a number that is not
 * insulting, which is worse. Both ladders are complete 1-10.
 *
 * Run: node scripts/content/lw-structural-fixes.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');

const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const write = (p, o) => {
  // canonicalJson, never a JSON.stringify key-array replacer: that form applies the
  // key list at EVERY depth and silently empties nested objects like flags/tags.
  if (WRITE) fs.writeFileSync(path.join(ROOT, p), canonicalJson(o), 'utf8');
};
const log = [];

// ---------------------------------------------------------------- slot 2 ----
{
  const p = 'quests/quest_lw_2.json';
  const q = read(p);

  q.description =
    'The Watch have a camera core put by. Rennie Vasch, who keeps the freight yard off Kessler, '
    + 'has a dead one on her gate and no way of getting a new part that does not go through a '
    + 'company that would want to know why she wanted it.\n\n'
    + 'Halloran wraps it in oilcloth and does not explain the arrangement.\n\n'
    + 'You ask who else makes them, since he has just finished saying the Watch does not.\n\n'
    + '"Three that I know of."\n\n'
    + 'You wait for the names. They do not come, and he goes back to the bench.\n\n'
    + '"She does not thank anybody and you are not to wait for it. Put it in her hand, not on the desk."';

  q.objectives = [
    {
      id: 'o_core',
      type: 'retrieve',
      item_id: 'item_lw_camcore',
      zone: 'zone_lw_bunk',
      desc: 'Take the wrapped core off Halloran\'s bench.',
      emotes: [
        '{who} takes the parcel without unwrapping it.',
        '{who} is not told what it cost or who it is for.',
      ],
    },
    {
      id: 'o_hand',
      type: 'talk',
      target: 'npc_kessler_dispatcher',
      requires: ['o_core'],
      count: 1,
      desc: 'Get it to Rennie Vasch at the Kessler yard, and put it in her hand.',
      emotes: [
        '{who} walks it up Kessler in daylight, because a parcel carried openly is a parcel nobody looks at.',
        '{who} waits while she finishes with a driver who is in no hurry either.',
        '{who} puts it in her hand rather than on the desk, and she notices which one it was.',
        '{who} is not thanked, and is watched all the way back to the gate.',
      ],
    },
  ];
  write(p, q);
  log.push('slot 2  Blind Spot -> a delivery to Rennie Vasch (retrieve at the bench, talk at the yard)');
}

// ---------------------------------------------------------------- slot 9 ----
{
  const p = 'quests/quest_lw_loyalty.json';
  const q = read(p);
  const wait = q.objectives.findIndex(o => o.id === 'o_wait');
  if (!q.objectives.some(o => o.id === 'o_offer')) {
    q.objectives.splice(wait + 1, 0, {
      id: 'o_offer',
      type: 'talk',
      target: 'npc_asc_kesh',
      requires: ['o_wait'],
      count: 1,
      desc: 'The surgeon has time while you wait, and would like to use it.',
      emotes: [
        '{who} is asked, pleasantly, what they do with their hands all day.',
        '{who} is talked out of the expensive one by the man who would have been paid for it.',
        '{who} is quoted a price, and then a smaller price, and is not pushed on either.',
        '{who} is told the offer stands, and that it is not the kind that expires.',
      ],
    });
    const back = q.objectives.find(o => o.id === 'o_back');
    if (back) back.requires = [...new Set([...(back.requires || []), 'o_offer'])];
    log.push('slot 9  Nothing Bought -> Kesh makes the offer to your face (new o_offer talk objective)');
  } else log.push('slot 9  already has o_offer, skipped');
  write(p, q);
}

// ------------------------------------------------------- Kesh says it out ----
{
  const p = 'npcs/npc_asc_kesh.json';
  const n = read(p);
  const t = n.dialogue_tree || (n.dialogue_tree = {});
  if (!t.lw_wait_offer) {
    t.lw_wait_offer = {
      _vine: { x: 1200, y: 1080 },
      actions: [],
      options: [
        { label: 'How much?', next: 'lw_wait_price', conditions: [], actions: [], enabled: true },
        { label: 'I am here for a part.', next: 'bye', conditions: [], actions: [], enabled: true },
      ],
      text:
        '"You are waiting on the counter, so you have twenty minutes and nothing to do in them." '
        + 'He does not get up.\n\n'
        + '"I am not going to ask who the parts are for. I would rather ask about your hands. '
        + 'You have been favouring the left one since you came through the door, and you did not '
        + 'notice me noticing, which means it has been long enough that you have stopped noticing '
        + 'it yourself."',
    };
    t.lw_wait_price = {
      _vine: { x: 1400, y: 1080 },
      actions: [],
      options: [
        { label: 'No.', next: 'bye', conditions: [], actions: [], enabled: true },
        { label: 'I will think about it.', next: 'bye', conditions: [], actions: [], enabled: true },
      ],
      text:
        '"Less than you are expecting, and I am going to talk you out of the expensive one, '
        + 'which I appreciate is an odd sales technique." He writes two numbers and turns the '
        + 'pad round.\n\n'
        + '"The top one is the unit the Boulevard would sell you. The bottom one is the unit '
        + 'you actually need, and I fit it in an afternoon, and you would have the use of that '
        + 'hand again by Thursday."\n\n'
        + 'He puts the pen down.\n\n'
        + '"The offer stands after today. It is not the kind that expires. People who make '
        + 'offers that expire are trying to stop you thinking."',
    };
    // Reachable only while the loyalty run is live, so it never intrudes on
    // anybody else's business with him.
    (t.root.options ||= []).unshift({
      label: '(he has clearly been waiting for a chance to say something)',
      next: 'lw_wait_offer',
      actions: [],
      enabled: true,
      conditions: [{ flag: 'quest_lw_loyalty', op: 'eq', scope: 'player', value: 'active' }],
    });
    log.push('Kesh    two new nodes + a root option gated on quest_lw_loyalty being active');
  } else log.push('Kesh    already has lw_wait_offer, skipped');
  write(p, n);
}

// ------------------------------------------------------------ Vasch line ----
{
  const p = 'npcs/npc_kessler_dispatcher.json';
  const n = read(p);
  const t = n.dialogue_tree;
  if (!t.lw_core) {
    t.lw_core = {
      _vine: { x: 1200, y: 900 },
      actions: [],
      options: [{ label: '(leave her to it)', next: 'bye', conditions: [], actions: [], enabled: true }],
      text:
        'She takes it out of your hand, unwraps one corner, and puts it in the coat rather than '
        + 'on the clipboard.\n\n'
        + '"Right." A driver is waiting and she lets him wait. "Tell him the gate\'ll be seeing '
        + 'again by Friday, and that I know what it cost him to have one spare."\n\n'
        + 'She looks at you the way she looks at a truck she has not weighed yet.\n\n'
        + '"You walked it up in daylight. Good. People who sneak get remembered."',
    };
    (t.root.options ||= []).unshift({
      label: '(hand over the wrapped core)',
      next: 'lw_core',
      actions: [],
      enabled: true,
      conditions: [{ flag: 'quest_lw_2', op: 'eq', scope: 'player', value: 'active' }],
    });
    log.push('Vasch   a receiving node + a root option gated on quest_lw_2 being active');
  } else log.push('Vasch   already has lw_core, skipped');
  write(p, n);
}

console.log(log.map(l => '  ' + l).join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run — nothing written'));

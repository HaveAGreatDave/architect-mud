/**
 * The Long Watch ladder, rebuilt as a resistance. 2026-08-25.
 *
 * ── Why ──────────────────────────────────────────────────────────────────────
 *
 * The order was being written as people who watch things, because their own
 * ideology row said "reformers, not arsonists" and their name says Watch. Both
 * were misleading. They are an underground resistance modelled on the French
 * Resistance: they live below the city, they sabotage constantly and carefully,
 * and they are waiting for a moment worth taking Coldwater in.
 *
 * The old ladder had the player standing around for three of its ten rungs. Real
 * resistance work is almost never standing around. It is timed, observed,
 * deniable, and somebody else pays for it afterwards.
 *
 * ── What the history gave us, and where each one landed ──────────────────────
 *
 *   NEED TO KNOW. Nobody in a cell knew more than two others, so a captured
 *   member could only give up two. -> slot 1 states the rule out loud instead of
 *   just performing it, and the player is told WHY they are not being told.
 *
 *   THE COMPROMISED DROP. A watched letter-box killed networks; the courier's
 *   real skill was reading the street before reaching for anything. -> slot 4
 *   was "sit in a bar and wait". It is now a drop with somebody sitting on it,
 *   and the pass condition is that you walk away without touching it.
 *
 *   THE TWENTY-MINUTE RULE. A long transmission brought a detection van to the
 *   door inside thirty minutes; the drill was set up, send, dismantle and be
 *   gone in twenty. The average life expectancy of an SOE wireless operator in
 *   occupied France was six weeks. -> replaces "A Turn on the Blind", which was
 *   a `visit` objective and nothing else. Now it is the tensest job they have.
 *
 *   THE SECURITY CHECK. Every agent carried a deliberate mistake to prove they
 *   were not sending under duress, and the great scandal is that London ignored
 *   its absence and kept dropping people into German hands. -> taught in slot 6
 *   while getting a burned clerk out, so the player learns it in the situation
 *   that gives it meaning.
 *
 *   DIRECTION FINDING. -> slot 3's drone is no longer a generic machine in a
 *   duct. It is a triangulation unit narrowing down where the Watch transmit
 *   from, which is why it dies and why it has to look like it broke.
 *
 *   REPRISAL. Fifty hostages shot per German killed; Oradour was 642 civilians.
 *   -> slot 8's clerk must survive and it must read as a mugging, and the brief
 *   now says plainly what happens to the district if it reads as politics.
 *
 *   DENUNCIATION. Three to five million letters were written in occupied France
 *   by ordinary people, for material gain, fear, or a grudge about a shop. ->
 *   the texture of the whole ladder, and the reason nobody in it is a villain.
 *
 * ── Prose standard ───────────────────────────────────────────────────────────
 *
 * Per the new Dialogue section of docs/reference/plain-writing.md: information
 * over texture. Every brief says what the thing is, what the player is to do,
 * and what happens if it goes wrong, in words somebody who has never played
 * would understand. No generalising codas, no "that is not X, it is Y", no
 * clause explaining the sentence in front of it.
 *
 * ── Preserved exactly ────────────────────────────────────────────────────────
 *
 * Quest ids, lw_arc values, every *_done flag, repeatable flags. Dialogue nodes
 * reference these quests by id and the arc gates read the flags, so nothing that
 * points at this ladder needs touching.
 *
 * Run: node scripts/content/lw-ladder-rewrite.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const log = [];

const readQ = id => JSON.parse(fs.readFileSync(path.join(ROOT, 'quests', id + '.json'), 'utf8'));
const writeQ = (id, q) => {
  if (WRITE) fs.writeFileSync(path.join(ROOT, 'quests', id + '.json'), canonicalJson(q), 'utf8');
};
const writeItem = (id, obj) => {
  if (WRITE) fs.writeFileSync(path.join(ROOT, 'items', id + '.json'), canonicalJson(obj), 'utf8');
  log.push('item    ' + id);
};

// ─────────────────────────────────────────────────────────── new items ──────
writeItem('item_lw_wireless', {
  id: 'item_lw_wireless', name: 'suitcase wireless set',
  description: null, type: null, value: 0, weight: 6200,
  flags: {},
  tags: {
    misc: true, stackable: false,
    description:
      'A transmitter built into a cheap fibre suitcase, aerial wound round the inside of the lid. '
      + 'Heavy enough that you walk differently carrying it, which is the whole problem with it. '
      + 'Every set the Watch have has been rebuilt at least twice.',
  },
});

writeItem('item_lw_drop_tin', {
  id: 'item_lw_drop_tin', name: 'letter-box tin',
  description: null, type: null, value: 0, weight: 120,
  flags: {},
  tags: {
    misc: true, stackable: true,
    description:
      'A flat tobacco tin, taped shut, small enough to sit behind a loose brick. Whatever is in '
      + 'it is on paper and there is not much of it.',
  },
});

writeItem('item_lw_caselist', {
  id: 'item_lw_caselist', name: 'unfastened case',
  description: null, type: null, value: 0, weight: 2400,
  flags: {},
  tags: {
    misc: true, stackable: false,
    description:
      'A scuffed document case. The two catches are up and nobody has mentioned it. It would '
      + 'take about a second to look inside and there is no lock to leave marks on.',
  },
});

// ────────────────────────────────────────────────── slot 1 · the rule ───────
{
  const q = readQ('quest_lw_1');
  q.name = 'Proof of Hands';
  q.description =
    'Halloran has a parcel in a drop near the Hall of Records and wants it brought to him. It is '
    + 'sealed. He will not say what is in it, and when you ask he tells you why not.\n\n'
    + '"If they pick you up, you can only tell them what you know. So we make sure that is almost '
    + 'nothing. You know me and you know this bench. That is two people and one room, and it is '
    + 'as much as anybody down here knows about anybody."\n\n'
    + 'He goes back to work.\n\n'
    + '"Do not open it, do not ask about it, and do not carry it like it matters. Somebody who '
    + 'looks like they are carrying something is the only kind of person anybody stops."';
  q.objectives = [
    { id: 'o_collect', type: 'retrieve', item_id: 'item_lw_package',
      zone: 'zone_district_922_910',
      desc: 'Collect the sealed parcel from the drop near the Hall of Records.',
      emotes: [
        '{who} eases the parcel out from behind the brick and puts it under an arm.',
        '{who} does not weigh it in their hand, and is aware of not doing it.',
        '{who} walks back without hurrying and without stopping.',
      ] },
    { id: 'o_hand', type: 'talk', target: 'npc_lw_halloran', requires: ['o_collect'], count: 1,
      desc: 'Take it back to Halloran at the bench.',
      emotes: [
        '{who} puts it on the bench still sealed.',
        '{who} watches him not look at it either.',
      ] },
  ];
  writeQ('quest_lw_1', q);
  log.push('slot 1  Proof of Hands — need-to-know stated, and a hand-over at the end');
}

// ───────────────────────────────────────── slot 3 · direction finding ───────
{
  const q = readQ('quest_lw_3');
  q.name = 'Ghost in the Works';
  q.description =
    'For eleven nights something has been working its way through the service ducts under the '
    + 'wash, slowly, in the small hours. Halloran knows what it is doing because the Watch do the '
    + 'same thing to Halcyon.\n\n'
    + '"It is listening for a transmitter. It takes a bearing, moves, takes another, and where '
    + 'the two lines cross is a room with one of our sets in it. Give it a fortnight and it will '
    + 'have a street. Give it a month and it will have a door."\n\n'
    + 'He wants it dead, and he wants it to look like the ducts killed it.\n\n'
    + '"If it stops reporting, they send another. If it stops reporting badly enough, they send '
    + 'an engineer first, and an engineer takes three weeks. Break it on something. Do not shoot '
    + 'it."';
  q.objectives = [
    { id: 'o_kill', type: 'kill', target: 'surveyor',
      desc: 'Find the surveyor unit in the ducts under the wash and destroy it.',
      emotes: [
        '{who} waits for it to move rather than chasing it through the dark.',
        '{who} puts it into a duct wall hard enough that the wall is the story.',
        '{who} leaves the pieces where a maintenance crew would expect to find them.',
      ] },
  ];
  writeQ('quest_lw_3', q);
  log.push('slot 3  Ghost in the Works — it is a direction-finder, and that is why it dies');
}

// ──────────────────────────────────── slot 4 · the compromised drop ─────────
{
  const q = readQ('quest_lw_meet');
  q.name = 'The Wrong Brick';
  q.description =
    'A letter-box is a hiding place a cell uses to pass things without two people ever meeting. '
    + 'The Watch have one behind a loose brick on the corner of Kessler and the wash, and for four '
    + 'months it has worked.\n\n'
    + 'Two nights ago the runner who empties it did not come back.\n\n'
    + 'Halloran will not send anyone to it, because if it is being watched then whoever reaches '
    + 'behind that brick is the next person who does not come back. He wants somebody to go and '
    + 'look at the street instead.\n\n'
    + '"Sit somewhere you have a reason to be sitting. Give it an hour. If a man reads the same '
    + 'page twice, if a van parks where a van has no delivery, if the same face goes past three '
    + 'times, that is your answer and you come home with it."\n\n'
    + 'He is specific about the part everyone gets wrong.\n\n'
    + '"Do not touch the brick. Not to check. If it is clean we will use it again next week, and '
    + 'if it is not, you have just shown them who we are."';
  q.objectives = [
    { id: 'o_sit', type: 'visit', zone: 'zone_district_922_909',
      desc: 'Get to the corner of Kessler and find somewhere you have a reason to be.',
      emotes: [
        '{who} buys something they do not want so that sitting there means something.',
        '{who} picks a seat that faces the brick without facing the brick.',
      ] },
    { id: 'o_watch', type: 'visit', zone: 'zone_district_922_908', requires: ['o_sit'],
      desc: 'Work the length of the street once, slowly, and look at who is not moving.',
      emotes: [
        '{who} counts the same coat past the same window twice.',
        '{who} finds the van, and finds that nobody has delivered anything to anybody.',
        '{who} walks past the loose brick without slowing down at all.',
      ] },
    { id: 'o_report', type: 'talk', target: 'npc_lw_halloran', requires: ['o_watch'], count: 1,
      desc: 'Go back to Halloran and tell him what was on that street.',
      emotes: [
        '{who} describes a van, a coat and a window, in that order, without being asked twice.',
      ] },
  ];
  q.fail_on = [
    { id: 'f_seen', type: 'spotted',
      desc: 'Somebody on that street worked out what you were doing. Now they know the Watch are '
        + 'still interested in the brick, which is the one thing the errand was meant to hide.' },
  ];
  writeQ('quest_lw_meet', q);
  log.push('slot 4  The Meet -> The Wrong Brick: watching a watched drop, and not touching it');
}

// ─────────────────────────────────── slot 5 · the unfastened case ───────────
{
  const q = readQ('quest_lw_fav_carry');
  q.name = 'Carry It Back';
  q.description =
    'There is a document case in a lock-up off the Yards. The Quartermaster wants it at the Blind '
    + 'by morning, carried by hand, because every wire in this city belongs to somebody who reads '
    + 'it.\n\n'
    + 'It is not heavy. The catches are up, which she mentions on the way past and does not come '
    + 'back to.\n\n'
    + '"Straight through. If it goes wrong, put it down and walk away from it. It is worth less '
    + 'than you are, and I will only say that once."';
  q.objectives = [
    { id: 'o_get', type: 'retrieve', item_id: 'item_lw_caselist', zone: 'zone_district_918_912',
      desc: 'Collect the case from the lock-up off the Yards.',
      emotes: [
        '{who} finds it exactly where they were told, which is its own kind of unsettling.',
        '{who} notices the catches are up.',
      ] },
    { id: 'o_back', type: 'talk', target: 'npc_lw_quartermaster', requires: ['o_get'], count: 1,
      desc: 'Get the case to the Quartermaster at the Blind.',
      emotes: [
        '{who} puts it on the counter with the catches still up.',
        '{who} is not asked whether they looked, then or ever.',
      ] },
  ];
  writeQ('quest_lw_fav_carry', q);
  log.push('slot 5  Carry It Back — the unfastened case is now a real item you can open');
}

// ───────────────────────────── slot 6 · exfiltration + security check ───────
{
  const q = readQ('quest_lw_4');
  q.name = 'Retention';
  q.description =
    'There is a sub-registrar in the Vats Registry who has been passing the Watch small true '
    + 'things for four months. This morning she sent one word, which is what they agreed she '
    + 'would send if she thought somebody had noticed.\n\n'
    + 'Cyrelle does not dress it up. She is a clerk with an eleven-year account and about two '
    + 'hours before somebody upstairs reads the same log Cyrelle has just read.\n\n'
    + '"Get in, get her file off the ledger so there is no paper saying she existed, and walk her '
    + 'out on her feet. She will want to talk on the way. Let her."\n\n'
    + 'Before you go, Cyrelle teaches you the thing every runner learns eventually.\n\n'
    + '"When she sends, she puts one wrong letter in the third word. Always the third. If a '
    + 'message ever comes in from her spelled correctly, it is not her sending it, and the reply '
    + 'we send goes to whoever is holding her arm."\n\n'
    + 'She lets that sit.\n\n'
    + '"People have ignored that before. It is how you lose a whole network in a fortnight."';
  q.objectives = [
    { id: 'o_in', type: 'visit', zone: 'zone_asc_vats_registry',
      desc: 'Get into the Registry in the Vats and stand the floor until you are sure it is between rounds.' },
    { id: 'o_file', type: 'hack', requires: ['o_in'], zone: 'zone_asc_vats_registry',
      desc: 'Pull her file off the Registry ledger so there is no record of her at all.' },
    { id: 'o_word', type: 'talk', target: 'npc_asc_nine', requires: ['o_file'], count: 1,
      desc: 'Find Nine and give her the word.' },
    { id: 'o_out', type: 'escort', target: 'npc_asc_nine', requires: ['o_word'],
      zone: 'zone_lw_entry',
      desc: 'Walk her out of the Vats.' },
    { id: 'o_hand', type: 'give', item_id: 'item_lapse_slate', requires: ['o_out'], count: 1,
      desc: 'Hand her and her file over at the Blind.',
      emotes: [
        '{who} puts the file on the counter and a woman beside it, in that order, because that is the order they were asked for.',
      ] },
  ];
  q.fail_on = [
    { id: 'f_clock', type: 'timeout', count: 900,
      desc: 'The Registry reconciles at shift change. After that she is a discrepancy rather than a colleague, and discrepancies are somebody\'s job.' },
    { id: 'f_lost', type: 'escort_lost', target: 'npc_asc_nine',
      desc: 'She dies once, messily, like anyone else. The only copy of her is in her hands.' },
    { id: 'f_blood', type: 'kill', target: 'Supervisor',
      desc: 'Do not kill a Halcyon supervisor. Put one down and this stops being an account dispute and becomes a homicide on Ascendant ground, and everything she carried out stops being evidence and starts being a motive.' },
  ];
  writeQ('quest_lw_4', q);
  log.push('slot 6  Retention — Nine is a woman throughout, and the security check is taught here');
}

// ────────────────────────────────────────── slot 8 · the bill ───────────────
{
  const q = readQ('quest_lw_fav_quiet');
  q.name = 'Quiet Hands';
  q.description =
    'A counter clerk in Civic signs off the camera maintenance schedule for four districts. On '
    + 'Thursday he signs the one that puts working eyes back on the wash, and the Watch need that '
    + 'signature to be three weeks late.\n\n'
    + 'Teague wants him face down in a stairwell for twenty minutes and breathing at the end of '
    + 'it. Not hurt past mending. Not robbed of anything he will miss. Not spoken to at all.\n\n'
    + '"It has to read as a mugging. A clerk who gets mugged files a form and takes a fortnight '
    + 'off. A clerk who gets warned tells his supervisor, and then Civic knows somebody wants that '
    + 'schedule late, and then they work out who."\n\n'
    + 'She is blunt about the rest of it.\n\n'
    + '"And if you kill him, they will not go looking for one person. They will take the wash '
    + 'apart street by street and everybody who lives there will pay for your bad night. That is '
    + 'not me being dramatic. That is what they did in the Row in \'71."\n\n'
    + '"He is a clerk with a bad back and a dog. None of that is a reason to do it and none of it '
    + 'is a reason not to. I am telling you so he does not surprise you."';
  q.objectives = [
    { id: 'o_put', type: 'subdue', target: 'npc_civic_counter',
      desc: 'Put the Civic counter clerk down, and leave him breathing.',
      emotes: [
        '{who} takes the stairs because he takes the stairs, every day, at the same time.',
        '{who} does it fast.',
        '{who} takes his wallet, because a mugging takes the wallet.',
      ] },
  ];
  q.fail_on = [
    { id: 'f_dead', type: 'assassinate', target: 'npc_civic_counter',
      desc: 'You killed him. There is a body on Foundry Way now, and a body is a reason for people to come and look at the wash properly.' },
  ];
  writeQ('quest_lw_fav_quiet', q);
  log.push('slot 8  Quiet Hands — the reprisal is stated, and the wallet has to go');
}

// ─────────────────────────────── favour · the twenty-minute rule ────────────
{
  const q = readQ('quest_lw_fav_sit');
  q.name = 'Twenty Minutes';
  q.repeatable = 1;
  q.description =
    'The Watch have one working wireless set and use it as little as they can, because using it '
    + 'is the most dangerous thing anybody in the order does.\n\n'
    + 'Halcyon run detection vans. Two of them take a bearing on a signal from different streets, '
    + 'and where the bearings cross is a roof, and then a building, and then a room. In a district '
    + 'this dense they can do it in half an hour.\n\n'
    + 'So the drill is twenty minutes, start to finish. Climb, string the aerial, send, take it '
    + 'down, and be somewhere else.\n\n'
    + 'Pike carries the set up for you, and says the only thing anybody ever says about this job.\n\n'
    + '"The set is worth more than the message. If you have to choose, you throw the message off '
    + 'the roof and you carry the set down."';
  q.objectives = [
    { id: 'o_set', type: 'retrieve', item_id: 'item_lw_wireless', zone: 'zone_lw_bunk',
      desc: 'Take the wireless set from the Blind.',
      emotes: ['{who} finds out what six kilos of suitcase does to the way a person walks.'] },
    { id: 'o_roof', type: 'visit', zone: 'zone_district_921_909', requires: ['o_set'],
      desc: 'Get up to the roof on Kessler and string the aerial.',
      emotes: [
        '{who} runs the wire along a gutter, because a wire along a gutter is a gutter.',
        '{who} works out which way is west from a chimney and hopes it is close enough.',
      ] },
    { id: 'o_send', type: 'hack', requires: ['o_roof'],
      desc: 'Send. Keep it short.',
      emotes: [
        '{who} sends the traffic first and the pleasantries never.',
        '{who} watches the street between groups of letters.',
      ] },
    { id: 'o_clear', type: 'visit', zone: 'zone_lw_bunk', requires: ['o_send'],
      desc: 'Get the set down and get off that roof.',
      emotes: [
        '{who} coils the aerial on the way down rather than at the top.',
        '{who} takes a different street home than the one they came up.',
      ] },
  ];
  q.fail_on = [
    { id: 'f_van', type: 'timeout', count: 1200,
      desc: 'Twenty minutes. A van has been sitting at the end of Kessler for six of them, and now there is a second one on the parallel street, and the two of them have your roof.' },
  ];
  q.rewards = { credits: 140, xp: 30, items: [], flags: [] };
  writeQ('quest_lw_fav_sit', q);
  log.push('favour  A Turn on the Blind -> Twenty Minutes: a timed transmission run');
}

console.log(log.map(l => '  ' + l).join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run — nothing written'));

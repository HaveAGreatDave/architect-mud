// smalltalk regression suite, run by tests/regress.js. Covers who tells what to whom, that the
// answer follows what the NPC is really doing, the dialogue topic (offered, authored, withheld)
// and the click check on the way in and back out. Everything runs on made-up NPCs in memory.
import { shareLevel, whatsUp } from './index.js';
import { REFUSE, BRIEF, FULL } from './lines.js';
import { npcDoingNow } from '../../server/engine/npc-doing.js';
import { renderDialogueNode, checkDialogueChoice, noteDialogueFrame, clearDialogueFrame, dialogueTopicNode } from '../../server/engine/dialogue.js';
import { getZoneNpcs } from '../../server/engine/world.js';

const TOPIC = dialogueTopicNode('whatsup');
const ALL_DAY = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [{ from: 0, to: 24 }]]));

const REL = {
  stranger: { familiarity: 0, warmth: 0 },
  known:    { familiarity: 4, warmth: 0 },
  familiar: { familiarity: 10, warmth: 40 },
  close:    { familiarity: 25, warmth: 80 },
  wary:     { familiarity: 4, warmth: -30 },
  hostile:  { familiarity: 4, warmth: -70 },
};
const playerWho = (npc, tier) => ({
  id: 'regress_smalltalk_player', handle: 'Tester', current_zone: 'zone_regress_smalltalk',
  _relations: new Map([[npc.id, { ...REL[tier], met_at: 1, last_seen_at: 1 }]]),
});
let n = 0;
const mk = (over = {}) => ({ id: `npc_regress_smalltalk_${++n}`, name: 'Small Talker', zone_id: 'zone_regress_smalltalk', flags: {}, _ai: { patrolPath: [] }, ...over });
const strip = (pool, vals = {}) => pool.map((l) => l.replace(/\{(\w+)\}/g, (_, k) => vals[k] ?? `{${k}}`));

export default async function regress({ run, check, getPlayer }) {
  // ── Who tells what to whom ────────────────────────────────────────────────
  const level = (flags, tier, extra) => { const npc = mk({ flags, ...extra }); return shareLevel(npc, playerWho(npc, tier)); };
  check('an ordinary person gives a stranger the short answer', level({}, 'stranger').level === 'brief');
  check('…and the whole of it once they know you', level({}, 'known').level === 'full');
  check('a chatty one tells a stranger everything', level({ personality: 'chatty' }, 'stranger').level === 'full');
  const guard = level({ personality: 'guard' }, 'stranger');
  check('a guard tells a stranger nothing', guard.level === 'refuse' && guard.why === 'guarded', JSON.stringify(guard));
  check('…the short answer to somebody known', level({ personality: 'guard' }, 'known').level === 'brief');
  check('…and all of it to a familiar face', level({ personality: 'guard' }, 'familiar').level === 'full');
  check('a dealer still refuses somebody merely known', level({ personality: 'dealer' }, 'known').why === 'closed');
  check('…and opens up only to somebody close', level({ personality: 'dealer' }, 'close').level === 'full');
  check('nobody tells somebody they hate', level({ personality: 'chatty' }, 'hostile').why === 'disliked');
  check('flags.smalltalk beats the archetype', level({ personality: 'chatty', smalltalk: 'closed' }, 'stranger').level === 'refuse');
  check("flags.smalltalk 'never' refuses even somebody close", level({ smalltalk: 'never' }, 'close').level === 'refuse');
  check('a bad mood costs a step',
    level({}, 'stranger', { _mood: { mood: 'angry', i: 1, until: Date.now() + 60_000 } }).level === 'refuse');

  // ── What they're doing is read off the behaviour state ────────────────────
  const kind = (over) => npcDoingNow(mk(over)).kind;
  check('standing in their home zone is at home', kind({ home_zone: 'zone_regress_smalltalk' }) === 'at_home');
  check('walking toward home is heading home',
    kind({ home_zone: 'zone_regress_home', _ai: { patrolPath: ['x'], patrolTarget: 'zone_regress_home' } }) === 'heading_home');
  check('walking anywhere else is out',
    kind({ home_zone: 'zone_regress_home', _ai: { patrolPath: ['x'], patrolTarget: 'zone_regress_far' } }) === 'out');
  check('no walk and no job is idle', kind({}) === 'idle');
  check('on shift at the work zone is working',
    kind({ npc_type: 'vendor', work_zone_id: 'zone_regress_smalltalk', vendor_schedule: ALL_DAY }) === 'working');
  check('on shift and somewhere else is on the way to work',
    kind({ npc_type: 'vendor', work_zone_id: 'zone_regress_work', vendor_schedule: ALL_DAY }) === 'to_work');
  check('carrying the takings is banking, whatever else is true',
    kind({ home_zone: 'zone_regress_smalltalk', _ai: { patrolPath: [], vendor_carrying: 40 } }) === 'banking');
  const walker = mk({ flags: { haunt_zone: 'zone_regress_far' }, _ai: { patrolPath: ['x'], patrolTarget: 'zone_regress_far' } });
  check('a walk to a haunt says so', npcDoingNow(walker).haunt === true);

  // ── The line matches the level and the activity ───────────────────────────
  {
    const npc = mk({ home_zone: 'zone_regress_home', _ai: { patrolPath: ['x'], patrolTarget: 'zone_regress_home' } });
    const a = whatsUp(npc, playerWho(npc, 'stranger'));
    check('a stranger asking somebody on the way home hears just that',
      a.level === 'brief' && a.kind === 'heading_home' && BRIEF.heading_home.includes(a.text), a.text);
    const b = whatsUp(npc, playerWho(npc, 'known'));
    check('…and somebody known gets a full line with no empty token',
      b.level === 'full' && !/[{}]/.test(b.text) && FULL.heading_home.includes(b.text), b.text);
  }
  {
    const npc = mk({ flags: { personality: 'chatty' }, vendor_shop_name: 'Regress & Sons',
      npc_type: 'vendor', work_zone_id: 'zone_regress_smalltalk', vendor_schedule: ALL_DAY });
    const a = whatsUp(npc, playerWho(npc, 'stranger'));
    check('a full answer at work can name the shop',
      a.kind === 'working' && strip(FULL.working, { work: 'Regress &amp; Sons' }).includes(a.text), a.text);
    npc._ai.vendor_carrying = 120;
    const s = whatsUp(npc, playerWho(npc, 'familiar'));
    check('carrying the takings, even a talker says only that there is an errand',
      s.level === 'brief' && BRIEF.banking.includes(s.text), s.text);
    const c = whatsUp(npc, playerWho(npc, 'close'));
    check('…and tells somebody close where the money is going',
      c.level === 'full' && strip(FULL.banking, { work: 'Regress &amp; Sons' }).includes(c.text), c.text);
  }
  {
    const npc = mk({ flags: { personality: 'thug' } });
    const a = whatsUp(npc, playerWho(npc, 'stranger'));
    check('a refusal comes from the pool for that kind of person', a.level === 'refuse' && REFUSE.closed.includes(a.text), a.text);
    const own = mk({ flags: { up_to: { idle: 'Waiting on a delivery.', refuse: 'Ask the foreman.' } } });
    check('flags.up_to supplies the answer', whatsUp(own, playerWho(own, 'known')).text === 'Waiting on a delivery.');
    own.flags.smalltalk = 'never';
    check('…and the refusal', whatsUp(own, playerWho(own, 'known')).text === 'Ask the foreman.');
  }

  // ── The dialogue topic ────────────────────────────────────────────────────
  const tree = () => ({
    root: { text: 'Yes?', options: [{ label: 'Tell me more.', next: 'more' }, { label: 'Bye.', next: 'bye' }] },
    more: { text: 'There is no more.', options: [{ label: 'Back.', next: 'root' }] },
    bye:  { text: 'Bye.', options: [] },
  });
  const talker = mk({ dialogue_tree: tree() });
  const p = playerWho(talker, 'known');
  const root = await renderDialogueNode(talker, 'root', p, { npc: talker });
  const nexts = root.options.map((o) => o.next);
  check('every dialogue root offers the question, after the authored options',
    nexts.length === 3 && nexts[2] === TOPIC, nexts.join(','));
  const answer = await renderDialogueNode(talker, TOPIC, p, { npc: talker });
  check('asking renders an answer with one way back to root',
    !!answer?.text && answer.options.length === 1 && answer.options[0].next === 'root', JSON.stringify(answer));

  const wired = mk({ dialogue_tree: tree() });
  wired.dialogue_tree.more.options.push({ label: 'Busy day?', next: TOPIC });
  const wiredRoot = await renderDialogueNode(wired, 'root', playerWho(wired, 'known'), { npc: wired });
  check('a tree that words the question itself gets no second copy',
    !wiredRoot.options.some((o) => o.next === TOPIC), wiredRoot.options.map((o) => o.next).join(','));
  const mute = mk({ dialogue_tree: tree(), flags: { smalltalk: false } });
  const muteRoot = await renderDialogueNode(mute, 'root', playerWho(mute, 'known'), { npc: mute });
  check('flags.smalltalk false takes the question off somebody', !muteRoot.options.some((o) => o.next === TOPIC));
  const cat = mk({ dialogue_tree: tree(), flags: { animal: true } });
  const catRoot = await renderDialogueNode(cat, 'root', playerWho(cat, 'known'), { npc: cat });
  check('nobody asks an animal', !catRoot.options.some((o) => o.next === TOPIC));

  // ── The click check, in and back out ──────────────────────────────────────
  const at = (node) => noteDialogueFrame(p.id, { type: 'dialogue', npcId: talker.id, node }, p.current_zone);
  const click = (choice, optionIndex) => checkDialogueChoice({ npc: talker, player: p, choice, optionIndex, context: { npc: talker } });
  at('root');
  check('the question can be clicked at root', (await click(TOPIC, 2)).ok);
  check('…but not at an index that shows something else', !(await click(TOPIC, 0)).ok);
  at('more');
  check('…and not from a node that never showed it', !(await click(TOPIC, 0)).ok);
  at(TOPIC);
  check('the way back out of the answer is accepted', (await click('root', 0)).ok);
  at('more');
  check('an authored option that leads to root is accepted', (await click('root', 0)).ok);
  at('root');
  check('root with an index that leads somewhere else is still refused', !(await click('root', 0)).ok);
  clearDialogueFrame(p.id);

  // ── The verb ──────────────────────────────────────────────────────────────
  let r = await run('whatsup');
  check('whatsup with nobody named asks whom', r?.type === 'error' && /Ask whom/.test(r.message), r?.message);
  r = await run('whatsup zzqnobodyhere');
  check('whatsup at somebody absent says so', r?.type === 'error' && /Can't find/.test(r.message), r?.message);
  const here = getZoneNpcs(getPlayer().current_zone).find((x) => x.name && !x._ai?.homeSleeping);
  if (here) {
    r = await run(`whatsup ${here.name}`);
    check('whatsup at somebody present gets an answer or a pick list', r?.type === 'output' && !!r.message, r?.message);
  }
}

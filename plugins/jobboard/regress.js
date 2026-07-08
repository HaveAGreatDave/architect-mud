// Job board plugin regression suite — run by tests/regress.js (never loaded in production).
// The fake player isn't guaranteed to stand in a job-board zone, so these assert the
// verbs/actions route and return the right shape; accept/turn-in is exercised by the
// quests plugin's own suite (jobboard just delegates to START_QUEST/TURN_IN).
import { query } from '../../server/models/db.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { getRegisteredMoveGates } from '../../server/engine/movement-gates.js';
import { turnInNpcForQuest } from './index.js';
import { findTurnInNpc } from '../quests/index.js';

export default async function regress({ run, check, getPlayer }) {
  const player = getPlayer();

  // Bare `gigs` now opens Tablet OS pre-navigated to Quests → Job Board (no
  // duplicate text UI) instead of rendering board text.
  let r = await run('gigs');
  check('gigs verb opens tablet at Job Board', r?.type === 'tablet_panel' && r?.appId === 'quests', JSON.stringify(r));

  r = await run('gigs take 1');
  check('gigs take routed', typeof (r?.message) === 'string', r?.message);

  r = await run('gigs claim 1');
  check('gigs claim routed', typeof (r?.message) === 'string', r?.message);

  // `gigs take <n>` actually has to reach takeJob() — args arrives as an array from
  // the dispatcher, and a prior String(args) bug joined it with commas ("take,1"),
  // so the sub-command never matched and this silently fell through to re-printing
  // the board. Prove the fix by standing at a real board and checking a
  // player_quests row actually gets created.
  const home = player.current_zone;
  player.current_zone = 'zone_city_west'; // Franchise Strip — board_franchise_strip
  r = await run('gigs take 1');
  const { rows: taken } = await query(
    "SELECT 1 FROM player_quests WHERE player_id=$1 AND status='active'", [player.id]
  );
  check('gigs take 1 actually starts a quest (args-array parsing)', taken.length > 0, r?.message);
  player.current_zone = home;

  r = await run('postings');
  check('postings alias opens tablet', r?.type === 'tablet_panel' && r?.appId === 'quests', JSON.stringify(r));

  // OPEN_JOBBOARD (Marta's dialogue) returns a dialogue_line — bare board when none here.
  r = await dispatchAction({ type: 'OPEN_JOBBOARD', actor: player, params: {} });
  check('OPEN_JOBBOARD returns a dialogue line', r?.type === 'dialogue_line' && typeof r.text === 'string', JSON.stringify(r));

  // The content-driven greeter move gate is wired.
  check('greeter move gate registered', getRegisteredMoveGates().includes('jobboard:greeter'), getRegisteredMoveGates().join(','));

  // Job-board postings turn in with their board's dispatcher NPC (Marta Kell at
  // the Franchise Strip) — discovered by scanning for the OPEN_JOBBOARD action on
  // an NPC standing in the board's zone, not a hand-authored per-quest link, so it
  // holds for any quest in the board's pool.
  const { rows: board } = await query('SELECT quest_pool FROM job_boards WHERE id=$1', ['board_franchise_strip']);
  const poolQuestId = board[0]?.quest_pool?.[0];
  if (poolQuestId) {
    const dispatcher = await turnInNpcForQuest(poolQuestId);
    check('turnInNpcForQuest resolves the Franchise Strip dispatcher', dispatcher?.npcId === 'npc_fs_dispatcher', JSON.stringify(dispatcher));

    // quests' findTurnInNpc falls back to jobboard's dispatcher lookup for
    // postings with no dialogue-authored TURN_IN of their own — this is what
    // drives both Tablet's route-to-Marta hand-off and the bottom-pane
    // "Bring it to <NPC>" completion line.
    const viaQuests = await findTurnInNpc(poolQuestId);
    check('quests findTurnInNpc falls back to the job board dispatcher', viaQuests?.npcId === 'npc_fs_dispatcher', JSON.stringify(viaQuests));
  }
}

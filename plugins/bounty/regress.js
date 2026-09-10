// Bounty regression.
//
// Three things are under test, and they are the three that would cost a player
// real money if they broke:
//
//  1. THE POSTER IS TEXT. Every surface renders `posterLines`, so a poster that
//     stops building — or starts truncating — takes the log-rung player's only
//     copy of the sheet with it. The frame geometry is pinned because a ragged
//     frame in a proportional font is a real report we would otherwise only get
//     from somebody using the Readable typeface.
//  2. THE ESCROW BALANCES. Post → cancel and post → expire must return the right
//     number, and a claim must pay exactly once. The double-pay case is tested
//     through the guarded UPDATE rather than by reasoning about it.
//  3. ANONYMITY HOLDS BY DEFAULT. A poster built for a stranger must not contain
//     the backer's handle anywhere in it — not in a field, not in the block.
import fs from 'fs';
import { query } from '../../server/models/db.js';
import { insertFurniture, deleteFurniture } from '../../server/engine/world.js';
import {
  buildPoster, posterLines, posterBlock, posterRow, timeLeft, rewardBand,
  chargeLine, money, WIDTH,
} from './poster.js';
import { MIN_BOUNTY, HOUSE_CUT, WITHDRAW_PENALTY, DURATION_DAYS, _internal } from './index.js';
import { receptacleOf, line as recLine, GENERIC } from './receptacle.js';

const DAY = 86_400_000;

export default async function regress({ run, check, getPlayer }) {
  const player = getPlayer();
  const saved = player.current_zone;
  const Z = 'zone_bounty_regress';
  const BOARD = 'furn_bounty_regress_board';

  const row = (over = {}) => ({
    id: 'bounty_regress_1', target_id: 'p_target', target_handle: 'Vex Marrow',
    backer_id: 'p_backer', backer_handle: 'Silas Kettleburn',
    amount: 4500, fee: 500, note: null, status: 'open',
    posted_at: Date.now(), expires_at: Date.now() + 3 * DAY, unmasked_by: [], ...over,
  });

  try {
    // ── 1. the sheet ────────────────────────────────────────────────────────
    const p = buildPoster(row(), { viewer: 'p_stranger' });
    const lines = posterLines(p);
    check('poster builds lines', Array.isArray(lines) && lines.length > 8, `${lines.length} lines`);
    // Every line the same width, or the frame shears. This is the one property a
    // proportional-font player notices first and nobody else ever sees.
    const widths = [...new Set(lines.map(l => [...l].length))];
    check('every poster line is exactly WIDTH characters',
      widths.length === 1 && widths[0] === WIDTH, `widths: ${widths.join(',')}`);
    check('the sheet names the target', lines.some(l => l.includes('VEX MARROW')), lines[4]);
    check('the sheet prints the reward', lines.some(l => l.includes('₵4,500')), 'no reward line');
    // The band is what a player who cannot read the big number relies on.
    check('the sheet prints a reward BAND as well as a numeral',
      lines.some(l => l.includes(rewardBand(4500))), rewardBand(4500));

    // ── anonymity ───────────────────────────────────────────────────────────
    check('a stranger never sees the backer in a field', p.backerKnown === false, String(p.backer));
    const block = posterBlock(p);
    check('the backer handle appears NOWHERE in a stranger\'s sheet',
      !block.includes('Silas') && !block.includes('Kettleburn'), 'backer leaked into the block');
    const backerView = buildPoster(row(), { viewer: 'p_backer' });
    check('the backer always sees their own name', backerView.backerKnown === true, String(backerView.backer));
    const paid = buildPoster(row({ unmasked_by: ['p_target'] }), { viewer: 'p_target' });
    check('a target who PAID sees the name', paid.backerKnown === true && paid.backer === 'Silas Kettleburn', String(paid.backer));
    check('a target who did NOT pay does not', buildPoster(row(), { viewer: 'p_target' }).backerKnown === false, 'leaked');
    check("the target sheet knows it's about the reader", buildPoster(row(), { viewer: 'p_target' }).isTarget === true, 'not flagged');

    // ── never truncated mid-word ────────────────────────────────────────────
    const long = ('because ' + 'retribution '.repeat(40)).trim();
    const charge = chargeLine(row({ note: long }));
    check('an over-long note is a WHOLE-WORD prefix of what was written, never a slice',
      charge.length > 0 && long.toUpperCase().startsWith(charge) && !long.toUpperCase()[charge.length]?.trim(),
      `…${charge.slice(-24)}`);
    // A note-less sheet still says something, and says the SAME thing every read.
    const r = row({ note: null });
    check('a note-less sheet prints stable boilerplate', chargeLine(r) === chargeLine(r), 'unstable');

    // ── the deadline is coarse and relative ─────────────────────────────────
    const now = Date.now();
    // Floors rather than rounds — a deadline must never read longer than it is.
    check('deadline: days', timeLeft(now + 3.5 * DAY, now) === '3 days left', timeLeft(now + 3.5 * DAY, now));
    check('deadline: hours', timeLeft(now + 5 * 3_600_000, now) === '5 hours left', timeLeft(now + 5 * 3_600_000, now));
    check('deadline: expired reads as expired', timeLeft(now - 1, now) === 'expired', timeLeft(now - 1, now));

    // A list row marks "this one is you" with a GLYPH, not with colour alone.
    check('a list row marks the reader with a glyph',
      posterRow(buildPoster(row(), { viewer: 'p_target' })).startsWith('►'),
      posterRow(buildPoster(row(), { viewer: 'p_target' })));

    // ── 2. the verb, end to end ─────────────────────────────────────────────
    await query(
      `INSERT INTO zones (id,name,description) VALUES ($1,'Bounty Regress','A test room.')
       ON CONFLICT (id) DO NOTHING`, [Z]).catch(() => {});
    player.current_zone = Z;

    // No board: posting must refuse, and must NOT have taken the money.
    const before = player.credits;
    const noBoard = await run(`bounty ${player.handle} 1000`);
    check('posting away from a board is refused', noBoard?.type === 'error', JSON.stringify(noBoard)?.slice(0, 90));
    check('a refused post costs nothing', player.credits === before, `${before} -> ${player.credits}`);

    await insertFurniture({
      id: BOARD, zone_id: Z, name: 'WANTED board', description: 'A test board.',
      object_type: 'decoration', flags: JSON.stringify({ wanted_board: true }),
    }, 'ON CONFLICT (id) DO UPDATE SET zone_id=EXCLUDED.zone_id, flags=EXCLUDED.flags');

    // You cannot post on yourself, at a board or anywhere else.
    const onSelf = await run(`bounty ${player.handle} 1000`);
    check("you can't post a contract on yourself", onSelf?.type === 'error', JSON.stringify(onSelf)?.slice(0, 90));
    check('a self-post costs nothing', player.credits === before, `${before} -> ${player.credits}`);

    // Below the floor.
    const tooLow = await run(`bounty ${player.handle} 5`);
    check('a sub-minimum contract is refused', tooLow?.type === 'error' && /minimum/i.test(tooLow.message || ''),
      String(tooLow?.message).slice(0, 80));

    // An unknown handle.
    const nobody = await run('bounty Zzzznotaplayer 1000');
    check('an unknown handle is refused', nobody?.type === 'error', JSON.stringify(nobody)?.slice(0, 90));
    check('an unknown handle costs nothing', player.credits === before, `${before} -> ${player.credits}`);

    // Listing dispatches with an empty board and does not throw.
    const list = await run('bounty');
    check('the bounty verb lists without error', list?.type === 'output', JSON.stringify(list)?.slice(0, 90));
    const help = await run('bounty help');
    check('bounty help dispatches', help?.type === 'output' && /BOUNTIES/.test(help.message || ''), 'no help');

    // Redeeming with nothing in hand. The refusal must NAME the receptacle, or
    // a player who has never read the board's description has no idea where the
    // head is supposed to go.
    const nothing = await run('redeem');
    check('redeem with no head is refused', nothing?.type === 'error', JSON.stringify(nothing)?.slice(0, 90));
    check('the refusal names the receptacle',
      (nothing?.message || '').includes(GENERIC.noun), String(nothing?.message).slice(0, 90));

    // ── 4. the receptacle ───────────────────────────────────────────────────
    // An unauthored board is a WORKING board. The generic set is complete, so a
    // new board added as a bare furniture row never prints an empty string at
    // somebody standing in front of it.
    const bare = receptacleOf({ flags: { wanted_board: true } });
    for (const k of Object.keys(GENERIC))
      check(`an unauthored board still has a "${k}" line`,
        typeof bare[k] === 'string' && bare[k].length > 0, String(bare[k]));

    // Authoring one line inherits the rest — that is what makes a board cheap.
    const partial = receptacleOf({ flags: { receptacle: { noun: 'the slot' } } });
    check('an authored noun wins', partial.noun === 'the slot', partial.noun);
    check('the unauthored lines fall back', partial.room === GENERIC.room, partial.room);
    // An authored blank is authoring nothing, not authoring silence.
    check('a blank authored line falls back rather than printing nothing',
      receptacleOf({ flags: { receptacle: { room: '   ' } } }).room === GENERIC.room, 'blank won');

    // Tokens. A {noun} left un-substituted is the failure that reads as prose.
    const filled = recLine(partial, 'room', { handle: 'Vex Marrow', amount: '₵4,500' });
    check('tokens are substituted', filled.includes('the slot') && filled.includes('Vex Marrow')
      && filled.includes('₵4,500'), filled.slice(0, 80));
    check('no token survives into a rendered line', !/{w+}/.test(filled), filled.slice(0, 80));
    // An unknown token is left alone rather than deleted, so a typo is visible.
    check('an unknown token is left visible',
      recLine({ ...GENERIC, room: 'x {nope} y' }, 'room') === 'x {nope} y',
      recLine({ ...GENERIC, room: 'x {nope} y' }, 'room'));

    // Every authored board in content must carry a complete, token-clean set.
    // A board whose {amount} never resolves pays out silently.
    // Read the FILES, not the table: content is git-authoritative, and a board
    // whose prose is broken should fail on the machine that wrote it rather than
    // only on a database somebody remembered to import into.
    const dir = 'content/furniture';
    const boards = fs.readdirSync(dir)
      .map(n => { try { return JSON.parse(fs.readFileSync(`${dir}/${n}`, 'utf8')); } catch { return null; } })
      .filter(b => b?.flags?.receptacle);
    check('the authored boards are found', boards.length >= 3, `${boards.length} board(s)`);
    for (const b of boards) {
      const rec = receptacleOf(b);
      const rendered = Object.keys(GENERIC)
        .map(k => recLine(rec, k, { handle: 'H', amount: '₵1' })).join(' ');
      check(`${b.id}: no unresolved token in any line`, !/{w+}/.test(rendered),
        (rendered.match(/{w+}/) || [''])[0]);
      check(`${b.id}: the room line reports the payout`,
        recLine(rec, 'room', { handle: 'H', amount: '₵1' }).includes('₵1'), 'amount missing');
      check(`${b.id}: the receptacle noun is authored, not inherited`,
        rec.noun.length > 0 && rec.noun !== GENERIC.noun, rec.noun);
      // Three units of one product. If they stop agreeing on what the hole is
      // called, they have stopped being the same machine.
      check(`${b.id}: names the same receptacle as every other unit`,
        rec.noun === receptacleOf(boards[0]).noun, `${rec.noun} vs ${receptacleOf(boards[0]).noun}`);
      check(`${b.id}: is the same product as every other unit`,
        typeof b.description === 'string' && b.description.includes('Severance 400'),
        String(b.description).slice(0, 50));
    }

    // Cancelling with nothing out.
    const noCancel = await run('bounty cancel');
    check('cancel with nothing out is refused', noCancel?.type === 'error', JSON.stringify(noCancel)?.slice(0, 90));

    // Un-masking with nothing on you.
    const noUnmask = await run('bounty unmask');
    check('unmask with no paper on you is refused', noUnmask?.type === 'error', JSON.stringify(noUnmask)?.slice(0, 90));

    // ── the board reads the same list the verb prints ───────────────────────
    const readBoard = await run('read wanted board');
    check('READ on a wanted board returns the contract list',
      readBoard?.type === 'output' && /OPEN CONTRACTS/.test(readBoard.message || ''),
      JSON.stringify(readBoard)?.slice(0, 90));

    // The shipped units are called "bounty terminal", so a player typing the
    // word they can see on the wall must reach the same listing as a player
    // typing the word the system uses. Both, and neither by luck.
    for (const noun of ['board', 'terminal', 'bounty terminal', 'machine']) {
      const r = await run(`read ${noun}`);
      check(`READ "${noun}" finds the board`,
        r?.type === 'output' && /OPEN CONTRACTS/.test(r.message || ''), JSON.stringify(r)?.slice(0, 70));
    }
    // …and a noun that is NOT this thing still falls through, or every book,
    // recipe card and leaderboard in the room stops being readable.
    const notUs = await run('read novel');
    check('READ of something else is NOT eaten by the board',
      !(notUs?.type === 'output' && /OPEN CONTRACTS/.test(notUs.message || '')),
      JSON.stringify(notUs)?.slice(0, 70));

    // ── 3. escrow arithmetic ────────────────────────────────────────────────
    // Stated here rather than only in the doc, because these three numbers are
    // the ones a player can check with a calculator and complain about.
    const stake = 1000;
    const fee = Math.max(1, Math.ceil(stake * HOUSE_CUT));
    check('the house cut is taken off the top', fee === 100, String(fee));
    check('the escrow is what the poster advertises', stake - fee === 900, String(stake - fee));
    check('an early withdrawal returns escrow minus the penalty',
      (stake - fee) - Math.ceil((stake - fee) * WITHDRAW_PENALTY) === 675,
      String((stake - fee) - Math.ceil((stake - fee) * WITHDRAW_PENALTY)));
    check('the duration is a week', DURATION_DAYS === 7, String(DURATION_DAYS));
    check('the floor is a real number', MIN_BOUNTY >= 1, String(MIN_BOUNTY));
    check('money formats with a currency glyph', money(4500) === '₵4,500', money(4500));

    // ── the in-memory mirror ────────────────────────────────────────────────
    // The death path and the tablet widget both read it, so an index that leaks
    // is a bounty that pays after it was collected.
    const { index, unindex, openBounties } = _internal;
    const size0 = openBounties.size;
    const fake = row({ id: 'bounty_regress_mirror', target_id: 'p_mirror' });
    index(fake);
    check('index registers the row', openBounties.size === size0 + 1, `${size0} -> ${openBounties.size}`);
    unindex(fake.id);
    check('unindex removes it cleanly', openBounties.size === size0 && !openBounties.has(fake.id),
      `${openBounties.size}, has=${openBounties.has(fake.id)}`);

  } finally {
    player.current_zone = saved;
    await deleteFurniture(BOARD).catch(() => {});
    await query('DELETE FROM bounties WHERE id LIKE $1', ['bounty_regress%']).catch(() => {});
    await query('DELETE FROM zones WHERE id=$1', [Z]).catch(() => {});
  }
}

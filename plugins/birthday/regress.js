// Birthday — the date is DERIVED from players.created_at, so the only way to test
// the day itself is to move the account's creation date onto today and back.
// The fake regress player has no players row, so a row is stood up and torn down.
import { query } from '../../server/models/db.js';
import { setFlags } from '../../server/engine/flags.js';

export default async function ({ run, check, getPlayer }) {
  const player = getPlayer();
  const PID = player.id;

  // Does this fake player have a real row? The harness's player id matches no
  // players row by design, so create one and remove it again.
  const pre = await query('SELECT id, created_at FROM players WHERE id=$1', [PID]);
  const hadRow = pre.rows.length > 0;
  const savedCreated = pre.rows[0]?.created_at ?? null;

  try {
    if (!hadRow) {
      let r = await run('birthday');
      check('no players row answers rather than printing 1970',
        r?.type === 'error', JSON.stringify(r)?.slice(0, 140));
      await query(
        `INSERT INTO players (id, username, handle, password_hash, created_at)
         VALUES ($1,$2,$3,'x',$4) ON CONFLICT (id) DO NOTHING`,
        [PID, `bd_regress_${process.pid}`, 'BirthdayRegress', Math.floor(Date.now() / 1000)],
      );
    }

    // ── NOT your birthday ────────────────────────────────────────────────────
    // Six months out, so the answer can never accidentally be "today" whatever
    // day this suite runs on.
    const now = new Date();
    const away = new Date(now.getFullYear() - 3, (now.getMonth() + 6) % 12, 14);
    await query('UPDATE players SET created_at=$1 WHERE id=$2', [Math.floor(away.getTime() / 1000), PID]);
    await setFlags(PID, { birthday_gift_year: '' });

    let r = await run('birthday');
    check('a non-birthday reports the date without granting anything',
      r?.type === 'output' && /days from now|tomorrow/.test(r.message || ''), JSON.stringify(r)?.slice(0, 160));
    let inv = await query('SELECT COALESCE(SUM(quantity),0)::int AS n FROM player_inventory WHERE player_id=$1 AND item_id=$2', [PID, 'item_soylent_manyhappy']);
    check('no pouch off the day', inv.rows[0]?.n === 0, JSON.stringify(inv.rows));

    // ── IS your birthday ─────────────────────────────────────────────────────
    const born = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
    await query('UPDATE players SET created_at=$1 WHERE id=$2', [Math.floor(born.getTime() / 1000), PID]);
    await query('DELETE FROM player_flags WHERE player_id=$1 AND key=$2', [PID, 'birthday_gift_year']).catch(() => {});

    r = await run('birthday');
    check('on the day it says so', r?.type === 'output' && /Today, in fact/.test(r.message || ''), JSON.stringify(r)?.slice(0, 200));
    inv = await query('SELECT COALESCE(SUM(quantity),0)::int AS n FROM player_inventory WHERE player_id=$1 AND item_id=$2', [PID, 'item_soylent_manyhappy']);
    check('the pouch is granted on the day', inv.rows[0]?.n === 1, JSON.stringify(inv.rows));

    // ── ONE per year ─────────────────────────────────────────────────────────
    // The whole point of storing the year rather than a boolean: the second ask
    // on the same day must not pay out again.
    r = await run('birthday');
    check('a second ask the same year is refused politely',
      r?.type === 'output' && /already had your pouch/.test(r.message || ''), JSON.stringify(r)?.slice(0, 200));
    inv = await query('SELECT COALESCE(SUM(quantity),0)::int AS n FROM player_inventory WHERE player_id=$1 AND item_id=$2', [PID, 'item_soylent_manyhappy']);
    check('and grants no second pouch', inv.rows[0]?.n === 1, JSON.stringify(inv.rows));

    // A claim stamped for LAST year must not block this year's.
    await setFlags(PID, { birthday_gift_year: String(now.getFullYear() - 1) });
    r = await run('birthday');
    inv = await query('SELECT COALESCE(SUM(quantity),0)::int AS n FROM player_inventory WHERE player_id=$1 AND item_id=$2', [PID, 'item_soylent_manyhappy']);
    check('last year\'s claim does not block this year', inv.rows[0]?.n === 2, JSON.stringify(inv.rows));
  } finally {
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [PID, 'item_soylent_manyhappy']).catch(() => {});
    await query('DELETE FROM player_flags WHERE player_id=$1 AND key=$2', [PID, 'birthday_gift_year']).catch(() => {});
    if (hadRow) await query('UPDATE players SET created_at=$1 WHERE id=$2', [savedCreated, PID]).catch(() => {});
    else await query('DELETE FROM players WHERE id=$1', [PID]).catch(() => {});
  }
}

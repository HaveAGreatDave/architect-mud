// Unrest — phase 1a: the ledger, and nothing a player can perceive.
//
// See docs/proposals/unrest.md. This step deliberately ships NO player-facing
// surface: no verbs, no hooks, no gossip, no incidents, no spawns. It is the state
// layer every later step reads, and the parts that are easy to get subtly wrong
// are all here — whether decay is monotone, whether the blob survives a restart,
// whether pressure actually makes the fast pair limit-cycle instead of converging.
// Those are invisible once incidents stage on top of them.
//
// ⚠ Rule 2, in code as well as at the client boundary: every scalar in this plugin
// is visible at /dev and none of it crosses into client/game. The moment there is
// a player-facing readout the sim becomes a dashboard to optimise and the flavour
// dies. The player's instrument, from 1b onward, is an NPC saying "don't go up
// past the water tonight".
import { schedule } from '../../server/engine/scheduler.js';
import { world } from '../../server/engine/world.js';
import * as ledger from './ledger.js';
import { reindex, allBlocks, blockOf } from './blocks.js';

// Roles are authored on orgs.flags.role and read here — never a switch statement.
// The four expansion orders (Prometheans, Synthesis, Pioneers, Lucid) carry
// flags.expansion and are preview-only, never winning the lean, so they take no
// role and the sim skips them.
function roles() {
  const out = [];
  for (const org of world.orgs.values()) {
    if (org?.flags?.expansion) continue;
    const role = org?.flags?.role;
    if (!role || !role.writes) continue;
    out.push({ id: org.id, writes: role.writes, reads: role.reads || null, drift: role.drift || null });
  }
  return out;
}

let ready = false;
async function ensureLoaded() {
  if (ready) return;
  ready = true;
  await ledger.load();
}

// Idle-gated by default (scheduler.js wraps on hasActivePlayers), which is what we
// want: an empty server should not be simulating a city nobody is standing in.
schedule('30m', async () => {
  await ensureLoaded();
  ledger.step(roles());
  await ledger.flush(true);
});

// Write-behind on its own slower cadence so a burst of bumps coalesces into one
// statement rather than one per change.
schedule('5m', async () => {
  if (!ready) return;
  await ledger.flush();
});

function devOk(auth) {
  return auth && ['dev', 'admin', 'builder', 'designer'].includes(auth.role);
}

export const routeHandler = async (path, method, body, auth) => {
  if (!path.startsWith('/unrest')) return null;
  if (!devOk(auth)) return { status: 403, body: { error: 'Dev access required' } };
  await ensureLoaded();

  if (path === '/unrest/state' && method === 'GET') {
    return { status: 200, body: { cells: ledger.snapshot(), roles: roles(), blocks: allBlocks().length } };
  }

  if (path === '/unrest/force' && method === 'POST') {
    const key = String(body?.key || '');
    if (!allBlocks().includes(key)) return { status: 404, body: { error: `no such cell: ${key}` } };
    const row = ledger.force(key, body || {});
    await ledger.flush();
    return { status: 200, body: { key, ...row, band: ledger.bandOf(key) } };
  }

  if (path === '/unrest/step' && method === 'POST') {
    ledger.step(roles());
    await ledger.flush(true);
    return { status: 200, body: { cells: ledger.snapshot() } };
  }

  if (path === '/unrest/reindex' && method === 'POST') {
    reindex();
    return { status: 200, body: { blocks: allBlocks().length } };
  }

  return null;
};

// Exported for the later phases, which read the band and never the numbers.
export const bandFor = (zoneId) => {
  const key = blockOf(zoneId);
  return key ? ledger.bandOf(key) : null;
};

export const _test = { roles, ledger, ensureLoaded };

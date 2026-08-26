// Unrest — the wiring. Every seam this plugin touches in the engine is in this
// file, and the work is in the four beside it: the cell (blocks.js), the scalars
// (ledger.js), what a player can perceive (signals.js + voice.js) and what they
// can walk into (incidents.js + stage.js).
//
// See docs/proposals/unrest.md and docs/systems-unrest.md. Phases 1a–1d are
// built: ledger, perceivability, incidents, danger. Phase 2 (favours) and phase 3
// (the Null and the Wildblood) are not.
//
// ⚠ Rule 2, in code as well as at the client boundary: every scalar in this plugin
// is visible at /dev and none of it crosses into client/game. The moment there is
// a player-facing readout the sim becomes a dashboard to optimise and the flavour
// dies. The player's instrument is an NPC saying "don't go up past the water
// tonight", a wall somebody has been at, and a street that has a checkpoint on it.
import { schedule } from '../../server/engine/scheduler.js';
import { on } from '../../server/engine/events.js';
import { world } from '../../server/engine/world.js';
import * as ledger from './ledger.js';
import * as signals from './signals.js';
import * as incidents from './incidents.js';
import './stage.js';   // registers the dangerous stage steps (1d)
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
  await incidents.loadCatalogue();
}

// Idle-gated by default (scheduler.js wraps on hasActivePlayers), which is what we
// want: an empty server should not be simulating a city nobody is standing in.
schedule('30m', async () => {
  await ensureLoaded();
  ledger.step(roles());
  // The sweep runs AFTER the step and outside any emit: the bus is synchronous
  // and swallows subscriber throws, so anything that stages work off a band
  // crossing has to be driven from here rather than from inside a handler.
  await signals.sweep();
  // Staging comes AFTER the sweep in the same pass, which is what makes rule 1
  // reachable on the first tick a cell goes loud: the signal lands, then the
  // selector asks whether one landed.
  await incidents.tick();
  await ledger.flush(true);
});

// Write-behind on its own slower cadence so a burst of bumps coalesces into one
// statement rather than one per change.
schedule('5m', async () => {
  if (!ready) return;
  // Teardown on the fast cadence, staging on the slow one. An incident's duration
  // is authored in minutes and a 30-minute reap would round every one of them up
  // to the next half hour.
  await incidents.reap();
  await ledger.flush();
});

// ⚠ HOT PATH. zone.entered fires on every move; the handler is synchronous and
// does two Map lookups. Registered here rather than in signals.js so every wire
// into the engine is visible in one file.
on('zone.entered', signals.onEntered);

// ⚠ fireHook keeps the LAST non-undefined result and load order is
// filesystem-alphabetical, so 'unrest' sorts after 'district-ambience' and wins
// any beat it answers. That is why describeAmbient abstains hard at baseline and
// why the manifest declares "after": ["district-ambience"] — the ordering is a
// decision, not an accident of the alphabet.
export const hooks = {
  'zone.describeAmbient': signals.describeAmbient,
};

function devOk(auth) {
  return auth && ['dev', 'admin', 'builder', 'designer'].includes(auth.role);
}

export const routeHandler = async (path, method, body, auth) => {
  if (!path.startsWith('/unrest')) return null;
  if (!devOk(auth)) return { status: 403, body: { error: 'Dev access required' } };
  await ensureLoaded();

  if (path === '/unrest/state' && method === 'GET') {
    // Rule 2's line is the CLIENT BOUNDARY, not the data: the operator gets the
    // complete numeric picture because somebody who cannot see the ledger cannot
    // tune it. None of this is reachable from client/game.
    const cells = ledger.snapshot().map(c => ({
      ...c,
      writes: signals.dominantWrites(c.key),
      signalHeat: signals.lastSignalAt(c.key, 'heat'),
      signalGrip: signals.lastSignalAt(c.key, 'grip'),
    }));
    return { status: 200, body: { cells, roles: roles(), blocks: allBlocks().length } };
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
    const crossings = await signals.sweep();
    await ledger.flush(true);
    return { status: 200, body: { cells: ledger.snapshot(), crossings } };
  }

  // Say a cell's two voices now, without waiting for it to cross a band. The
  // operator's equivalent of standing in the street on a bad night.
  if (path === '/unrest/speak' && method === 'POST') {
    const key = String(body?.key || '');
    if (!allBlocks().includes(key)) return { status: 404, body: { error: `no such cell: ${key}` } };
    const writes = body?.writes || signals.dominantWrites(key);
    await signals.speak(key, ledger.bandOf(key), writes);
    return { status: 200, body: { key, writes, band: ledger.bandOf(key) } };
  }

  // ── Incidents ──────────────────────────────────────────────────────────────
  // Live state, so all of this is directAPI. The incident DEFINITIONS are
  // authored content and go through the ordinary staged content API instead —
  // picking the wrong one either silently stages an operator action or bypasses
  // review on authored content.
  if (path === '/unrest/incidents' && method === 'GET') {
    return {
      status: 200,
      body: {
        live: incidents.liveIncidents().map(i => ({
          instanceId: i.instanceId, incident: i.defId, name: i.name, cell: i.key,
          zone: i.zone, writes: i.writes, band: i.band, startedAt: i.startedAt, endsAt: i.endsAt,
        })),
        cap: incidents.MAX_LIVE,
        steps: incidents.stepNames(),
        // Why nothing is staging, per definition per cell. An operator who cannot
        // see the refusal reason concludes the sim is broken.
        catalogue: incidents.getCatalogue().map(d => ({
          id: d.id, name: d.name, writes: d.writes, minBand: d.minBand, weight: d.weight,
          blocked: allBlocks().map(k => ({ cell: k, why: incidents.eligible(d, k) })),
        })),
      },
    };
  }

  if (path === '/unrest/incidents/stage' && method === 'POST') {
    const def = incidents.getCatalogue().find(d => d.id === body?.incident);
    if (!def) return { status: 404, body: { error: `no such incident: ${body?.incident}` } };
    const key = String(body?.key || '');
    if (!allBlocks().includes(key)) return { status: 404, body: { error: `no such cell: ${key}` } };
    // The operator may overrule rule 1 — that is what a staging button is for —
    // but never silently: the refusal reason comes back with the instance.
    const why = incidents.eligible(def, key);
    if (why && !body?.force) return { status: 409, body: { error: `not eligible: ${why}` } };
    const inc = await incidents.stage(def, key);
    return { status: 200, body: { instanceId: inc.instanceId, cell: key, forced: !!why } };
  }

  if (path === '/unrest/incidents/teardown' && method === 'POST') {
    const ok = await incidents.teardown(String(body?.instanceId || ''));
    return ok ? { status: 200, body: { ok: true } } : { status: 404, body: { error: 'no such live incident' } };
  }

  if (path === '/unrest/reload' && method === 'POST') {
    const n = await incidents.loadCatalogue();
    return { status: 200, body: { incidents: n } };
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

export const _test = { roles, ledger, signals, incidents, ensureLoaded };

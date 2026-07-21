// Tablet OS — Accolades app. A read-only window onto the same file the `file`
// command prints (plugins/accolades), rendered natively client-side.
//
// Two things here are deliberate and worth not "fixing":
//
//  1. NO DENOMINATOR ON THE ENTRY COUNT. The record is discovery-only: there is
//     no list of locked entries and no total, so a player can never see how many
//     they are missing. "11 of 40" would turn a set of jokes into a checklist and
//     spoil every unearned punchline by naming it.
//
//  2. THE CONTRIBUTION METER CANNOT FILL, AND THAT IS THE POINT. Each entry is
//     worth exactly 1 XP and a stat point costs 100, so the bar is scaled against
//     a single stat point. With a catalog in the low tens, perfect play reaches a
//     fraction of it, forever. It is an honest, precisely-drawn answer to "what is
//     1 XP worth" — and the driest joke in the feature.
import { registerTabletApp } from './registry.js';

// Cached module — the same instance the plugin loader already booted, so the
// tablet stays load-order-agnostic re: the record plugin (matches surveillance-app).
const rec = () => import('../accolades/index.js');

// XP cost of one stat point (server/engine/ip.js statCost → stat_cost_flat).
// Mirrored rather than imported because it is only ever a denominator for the
// gag; if the tunable moves, the joke survives being slightly off.
const XP_PER_STAT_POINT = 100;

async function buildScreen(player) {
  const r = await rec();
  const entries = await r.fileFor(player.id);
  r.noteOpened(player.id);   // opening your file is itself an observation

  const xp = entries.length; // flat 1 XP per entry, always

  return {
    view: 'accolades',
    breadcrumb: [],
    count: entries.length,
    xp,
    statPoints: (xp / XP_PER_STAT_POINT).toFixed(2),
    meterPct: Math.min(100, xp),           // 1 XP == 1% of a stat point
    entries: entries.map(e => ({
      key: e.key,
      title: e.title,
      line: e.line,
      at: e.at,
    })),
  };
}

registerTabletApp({
  id: 'accolades', name: 'Accolades', icon: '▓', category: 'Progression',
  buildScreen,
});

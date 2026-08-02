// The map, written out — and the one surface where the two text rungs need
// GENUINELY DIFFERENT THINGS rather than the same thing with a panel stripped.
//
// Every other system so far has had one written form that serves both rungs. The
// map does not, because:
//
//   A CHARACTER GRID IS STILL A VISUAL-SPATIAL ARTEFACT.
//
// Drawing the neighbourhood as a grid of glyphs is genuinely good for somebody who
// simply prefers text — they read the shape at a glance, exactly as they read the
// text cockpit's chart. Read the same grid ALOUD and it is close to useless: a
// screen reader spells out row after row of punctuation, and spatial relationships
// that are obvious to an eye have to be reconstructed in the listener's head from
// a stream of characters. It is the worst of both — long AND uninformative.
//
// So:
//
//   textgames → a chart. Nine-by-nine glyph grid, you-are-here marked.
//   log       → a BRIEFING. Where you are, what each exit leads to BY NAME, and
//               what's nearby with a bearing and a distance.
//
// The briefing is not a lesser map; for someone navigating by ear it is a better
// one. "Bodega Vu, two north-east" is directly actionable. A grid is not, however
// carefully it's drawn.
//
// Both are built from `getMinimapData`, the same local-area gather the graphical
// minimap uses, so none of the three can disagree about what is out there.
import { getMinimapData, getZone } from './world.js';
import { escAttr } from './text.js';

// ── Bearings ─────────────────────────────────────────────────────────────────
// grid_y increases SOUTHWARD (see docs/reference/land-taxonomy.md), so north is
// −dy. The minor axis is dropped when it is much smaller than the major, so a
// thing nearly due north reads "north" rather than "north-east" — a bearing that
// over-specifies is worse than one that rounds honestly.
export function bearing(dx, dy) {
  if (!dx && !dy) return 'here';
  const ns = dy < 0 ? 'north' : dy > 0 ? 'south' : '';
  const ew = dx > 0 ? 'east' : dx < 0 ? 'west' : '';
  if (!ns) return ew;
  if (!ew) return ns;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax > ay * 2.5) return ew;
  if (ay > ax * 2.5) return ns;
  return `${ns}-${ew}`;
}

const steps = (dx, dy) => Math.max(Math.abs(dx), Math.abs(dy));

// ── The briefing (log rung) ──────────────────────────────────────────────────
export function renderMapBriefing(player) {
  // Defensive: a map render must never be able to take the process down. It is
  // called from a command handler where a player always exists, but it is also the
  // sort of pure helper that gets called from a test or a tool with less around it.
  const here = player?.current_zone ? getZone(player.current_zone) : null;
  if (!here) return 'You are nowhere the map knows about.';

  const nodes = getMinimapData(player.current_zone, 4, player) || [];
  const me = nodes.find(n => n.id === player.current_zone);
  const out = [];

  const district = me?.district?.name || here.flags?.district || null;
  out.push(`<span class="text-cyan">${escAttr(here.name || 'Unknown')}</span>`
    + (district ? ` <span class="text-dim">· ${escAttr(district)}</span>` : ''));

  // EXITS BY NAME. This is the thing `look` cannot give you: it lists directions,
  // not where they go. Knowing "north is Ironside Street" is most of what a map is
  // for when you are navigating by ear.
  if (me && Number.isFinite(me.grid_x)) {
    const adjacent = nodes
      .filter(n => n.id !== me.id && Number.isFinite(n.grid_x) && steps(n.grid_x - me.grid_x, n.grid_y - me.grid_y) === 1)
      .map(n => ({ dir: bearing(n.grid_x - me.grid_x, n.grid_y - me.grid_y), n }))
      .sort((a, b) => a.dir.localeCompare(b.dir));
    if (adjacent.length) {
      out.push('<span class="furniture-label">Adjoining:</span>');
      for (const { dir, n } of adjacent) {
        const label = n.building_name || n.name;
        out.push(`  <span class="text-dim">${escAttr(dir).padEnd(11)}</span> ${escAttr(label || '')}`);
      }
    }
  }

  // LANDMARKS. Anything with a building on it, bearing + distance, nearest first.
  // Capped, because a briefing that lists forty tiles is a grid again in prose.
  if (me && Number.isFinite(me.grid_x)) {
    const raw = nodes
      .filter(n => n.id !== me.id && Number.isFinite(n.grid_x))
      .map(n => {
        const dx = n.grid_x - me.grid_x, dy = n.grid_y - me.grid_y;
        const name = n.building_name || (n.buildings && n.buildings[0]) || null;
        return name ? { name, dir: bearing(dx, dy), d: steps(dx, dy) } : null;
      })
      // Drop anything at distance 0 — a facade tile sharing your coordinates is
      // the building you are standing in, and it is already the header. "Grind
      // House — here, 0 steps" is noise dressed as navigation.
      .filter(m => m && m.d > 0)
      .sort((a, b) => a.d - b.d);

    // ONE ENTRY PER BUILDING, nearest face only. A building spans several facade
    // tiles, so without this the Solenne Residences is listed once for every tile
    // it touches — "east, 2 steps" and "north-east, 2 steps" and so on, which
    // reads as several different buildings and pushes the real ones off the list.
    // Sorted by distance first, so the survivor is the nearest way in.
    const seen = new Set();
    const marks = [];
    for (const m of raw) {
      if (seen.has(m.name)) continue;
      seen.add(m.name);
      marks.push(m);
      if (marks.length >= 8) break;
    }
    if (marks.length) {
      out.push('<span class="furniture-label">Nearby:</span>');
      for (const m of marks) {
        out.push(`  ${escAttr(m.name)} <span class="text-dim">— ${escAttr(m.dir)}, ${m.d} ${m.d === 1 ? 'step' : 'steps'}</span>`);
      }
    }
  }

  if (out.length === 1) out.push('<span class="text-dim">Nothing charted around you.</span>');
  out.push('<span class="text-dim">gps &lt;place&gt; to plot a route there.</span>');
  return out.join('\n');
}

// ── The chart (textgames rung) ───────────────────────────────────────────────
// A glyph per tile over a fixed window. Deliberately small: a chart you have to
// scroll is not read at a glance, and reading at a glance is the entire reason
// this rung gets a grid instead of the briefing above.
const R = 4;

export function renderMapChart(player) {
  if (!player?.current_zone) return renderMapBriefing(player);
  const here = getZone(player.current_zone);
  const nodes = getMinimapData(player.current_zone, R + 1, player) || [];
  const me = nodes.find(n => n.id === player.current_zone);
  if (!me || !Number.isFinite(me.grid_x)) {
    // No grid placement (an interior, a void crossing) — the briefing is the only
    // honest answer, and is better than an empty box.
    return renderMapBriefing(player);
  }

  const at = new Map();
  for (const n of nodes) if (Number.isFinite(n.grid_x) && n.grid_z === me.grid_z) at.set(`${n.grid_x},${n.grid_y}`, n);

  // A CHART HAS TO EARN ITS PLACE. An interior inherits its facade's coordinates,
  // so it passes the "has grid position" test and then draws a nine-by-nine box
  // containing nothing but `@` — which tells the player strictly less than the
  // briefing does, in more space. If there is no neighbourhood to draw, say the
  // thing instead of drawing the absence of it.
  if (at.size < 2) return renderMapBriefing(player);

  const glyph = (n) => {
    if (!n) return { ch: ' ', cls: 'text-dim' };
    if (n.id === me.id) return { ch: '@', cls: 'text-amber' };
    if (n.building_name || n.building_type) return { ch: '▣', cls: 'text-cyan' };
    if (n.terrain === 'water') return { ch: '≈', cls: 'text-blue' };
    if (n.terrain === 'road') return { ch: '·', cls: 'text-dim' };
    return { ch: '░', cls: 'text-dim' };
  };

  const rows = [];
  for (let y = me.grid_y - R; y <= me.grid_y + R; y++) {
    let line = '';
    for (let x = me.grid_x - R; x <= me.grid_x + R; x++) {
      const g = glyph(at.get(`${x},${y}`));
      line += `<span class="${g.cls}">${g.ch}</span> `;
    }
    rows.push(`  ${line}`);
  }

  const district = me.district?.name || null;
  return [
    `<span class="text-cyan">${escAttr(here?.name || 'Here')}</span>`
      + (district ? ` <span class="text-dim">· ${escAttr(district)}</span>` : ''),
    ...rows,
    `<span class="text-dim">@ you · ▣ building · ≈ water · · road · ░ open</span>`,
    `<span class="text-dim">map again to refresh · gps &lt;place&gt; to plot a route</span>`,
  ].join('\n');
}

export const _test = { bearing, steps };

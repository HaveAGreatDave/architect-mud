// THE DELAYED PENALTY AND THE CALLS' GRAPHICS (sim v9), end to end with no browser: a v9 game is
// simulated and narrated as the broadcast does it, then played through the rink view under the DOM
// stub (rink-dom-stub.mjs). Checks:
//   · the sim: every delayed call is settled by a whistle or a goal before the next draw, nothing
//     else stops play while the arm is up, and a goal on the call wipes out a minor
//   · the booth: each new beat has a line, and the payloads carry the penalty's own facts
//   · the view: the arm's chip, the goalie off for the extra man and back at the whistle, the
//     power play and the shorthanded side both named, the penalty box with a time on it, and the
//     penalty and injury lower thirds
// No GL, no database, no files written.
import fs from 'fs';
import { __install } from './rink-dom-stub.mjs';

const stub = __install();
const { createRinkView } = await import('../../client/game/js/panels/gameday-rink.js');
const { DT } = await import('../../client/game/js/panels/rink/rig.js');
const { sportsRng, sportsHash, sportsPick, sportsFill } = await import('../../plugins/broadcast/rng.js');
const HOCKEY = (await import('../../plugins/broadcast/sports/hockey.js')).default;
const { paceCalls } = await import('../../plugins/broadcast/sports/hockey-pacing.js');

let fails = 0;
const check = (ok, what, detail = '') => { if (!ok) { fails++; console.error('✗ ' + what + (detail ? ` (${detail})` : '')); } };
const verbose = process.argv.includes('--verbose');

const src = fs.readFileSync(new URL('../../data/scripts/hockey.bsm', import.meta.url), 'utf8');
const block = (k) => (src.split(`::${k}`)[1]?.split(`::end${k}`)[0] || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')).map((s) => s.replace(/"/g, ''));
const pools = {};
{ let key = null; for (const raw of src.split(/\r?\n/)) { const l = raw.trim(); if (l.startsWith('::lines ')) { key = l.slice(8).trim(); pools[key] = []; continue; } if (l.startsWith('::')) { key = null; continue; } if (key && l && !l.startsWith('#')) pools[key].push(l); } }
const teams = block('teams'), players = block('players');
const clubs = JSON.parse(fs.readFileSync(new URL('../../content/media_broadcasts/bc_cluster_puck.json', import.meta.url), 'utf8')).sports_pools?.clubs || null;
const matchupOf = (slot) => ({ away: teams[slot % teams.length], home: teams[(slot * 7 + 5) % teams.length], teams, clubs });

// ── the sim, over many games ──────────────────────────────────────────────────────────────────
{
  const tally = { delayed: 0, called: 0, waived: 0, major: 0, stopped: 0, open: 0, by: {} };
  for (let slot = 0; slot < 120; slot++) {
    const m = matchupOf(slot);
    if (m.away === m.home) continue;
    const g = HOCKEY.simGame(m, players, sportsRng(sportsHash(slot, 9)), { version: 9 });
    let up = 0;
    for (const b of g.beats) {
      if (b.type === 'delayed') { tally.delayed++; up++; continue; }
      if (up && ['fight', 'scrum', 'boards', 'brawl', 'death', 'injury'].includes(b.type)) { tally.stopped++; tally.by[b.type] = (tally.by[b.type] || 0) + 1; }
      if (up && b.type === 'faceoff') tally.open++;
      if (b.type === 'penalty' && b.delayed) {
        up--;
        if (b.waived) { tally.waived++; if (b.penaltyMin >= 5) tally.major++; } else tally.called++;
      }
    }
  }
  check(tally.delayed > 100, 'v9 calls delayed penalties', JSON.stringify(tally));
  check(tally.called + tally.waived >= tally.delayed - 5, 'every delayed call is whistled or wiped out', JSON.stringify(tally));
  check(tally.open === 0, 'no draw while a delayed call is still up', JSON.stringify(tally));
  check(tally.stopped === 0, 'nothing else stops play while the arm is up', JSON.stringify(tally));
  check(tally.waived > 0 && tally.major === 0, 'a goal on the call wipes out a minor, never a major', JSON.stringify(tally));
  if (verbose) console.log('sim', JSON.stringify(tally));
}

// ── one game narrated and played through the rink ────────────────────────────────────────────────
// (a slot with a delayed call, a waived one if there is one, and an injury)
function gameLines(slot) {
  const matchup = matchupOf(slot);
  const seed = sportsHash(slot, 0);
  const game = HOCKEY.simGame(matchup, players, sportsRng(seed), { version: 9 });
  const nrng = sportsRng(seed ^ 0x9e3779b9);
  const lines = [];
  HOCKEY.narrate({
    script: {}, game, gs: { seed, game }, slot, ws: false, announcer: 'Tug Brennan', pools, nrng, sport: HOCKEY, add: () => {},
    say: (line, tok, sb, fx, gd, meta) => { if (line) lines.push({ text: sportsFill(line, tok).trim(), sb, graphic: fx || null, gameday: gd || null, _cue: meta && meta.cue, _opt: (meta && meta.opt) || false }); },
    pick: (...keys) => sportsPick(pools, nrng, ...keys),
    abbr: (n) => String(n).slice(0, 3).toUpperCase(), recordOf: () => '8-4-1', lastId: () => null,
  });
  const { holds, gaps, dropped } = paceCalls(lines, 3600 * 1000 * 0.85, 1000, { spareMs: 480000 });
  return { game, lines: lines.filter((l) => !dropped.has(l)).map((l) => ({ text: l.text, sb: l.sb, fx: l.graphic, gd: l.gameday, hold: holds.get(l) + (gaps.get(l) || 0) })) };
}
let pick = null;
for (let slot = 0; slot < 200 && !pick; slot++) {
  const m = matchupOf(slot);
  if (m.away === m.home) continue;
  const g = gameLines(slot);
  const types = new Set(g.lines.map((l) => l.gd && (l.gd.waived ? 'waived' : l.gd.type)).filter(Boolean));
  if (types.has('delayed') && types.has('penalty') && types.has('injury')) pick = { slot, ...g };
}
check(!!pick, 'a v9 game with a delayed call, a penalty and an injury');
if (pick) {
  const { lines } = pick;
  const dl = lines.filter((l) => l.gd?.type === 'delayed');
  check(dl.every((l) => /arm|delayed/i.test(l.text) && !/\{/.test(l.text)), 'the delayed call has its own line, filled', dl.map((l) => l.text).slice(0, 2).join(' | '));
  check(dl.every((l) => l.gd.player && l.gd.infraction && l.gd.penaltyTeam && l.gd.delayed), 'the delayed payload names the man, the call and his club', JSON.stringify(dl[0]?.gd && { p: dl[0].gd.player, i: dl[0].gd.infraction, t: dl[0].gd.penaltyTeam }));
  check(dl.every((l) => l.sb?.delayed), 'the bug says the arm is up', JSON.stringify(dl[0]?.sb));
  check(dl.every((l) => l.fx?.kind === 'hockeypenalty' && l.fx.phase === 'delayed'), 'the TV gets the delayed card');
  const pen = lines.filter((l) => l.gd?.type === 'penalty' && !l.gd.waived);
  check(pen.every((l) => l.gd.penaltyMin >= 2 && l.fx?.kind === 'hockeypenalty' && l.fx.phase === 'called'), 'a penalty carries its minutes and the TV card');
  const inj = lines.filter((l) => l.gd?.type === 'injury');
  check(inj.every((l) => l.fx?.kind === 'hockeyinjury' && Number.isFinite(l.gd.remaining)), 'an injury carries the skaters left and the TV card');
  const withBox = lines.filter((l) => l.sb?.pp?.box && (l.sb.pp.box.away.length || l.sb.pp.box.home.length));
  check(withBox.length > 0, 'the bug carries who is in the box');
  check(lines.every((l) => !/\{[a-zA-Z]+\}/.test(l.text)), 'no line airs a bare token', lines.find((l) => /\{[a-zA-Z]+\}/.test(l.text))?.text || '');

  const host = stub.makeHost(), view = createRinkView(host);
  await view.ready();
  view.showIdle();
  const W = view.world;
  const seen = { chip: 0, sh: 0, pp: 0, box: 0, boxTime: 0, l3pen: 0, l3hurt: 0, l3delayed: 0, pulled: 0, back: 0, outOnTime: 0, stuck: 0 };
  let threw = null, armedSide = null;
  const look = () => {
    const html = (host.querySelector?.('.gdr-head')?.innerHTML || '') + (host.querySelector?.('.gdr-boxp')?.innerHTML ? 'gdr-boxp' + host.querySelector('.gdr-boxp').innerHTML : '');
    if (html.includes('gdr-delayed')) seen.chip++;
    if (html.includes('gdr-sh')) seen.sh++;
    if (/class="gdr-pp"/.test(html)) seen.pp++;
    if (html.includes('gdr-boxp')) { seen.box++; if (/class="t">\d+:\d\d</.test(html)) seen.boxTime++; }
    const l3 = host.querySelector?.('.gdr-l3')?.innerHTML || '';
    if (/lbl pen">(Major penalty|Penalty)</.test(l3)) seen.l3pen++;
    if (/lbl pen">Delayed penalty</.test(l3)) seen.l3delayed++;
    if (/lbl hurt">Injury</.test(l3)) seen.l3hurt++;
    if (armedSide && W.pulled[armedSide]) seen.pulled++;
  };
  const run = (secs) => { const t0 = W.t; while (W.t - t0 < secs) { W.step(DT); stub.runTimers(DT * 1000); if (Math.round(W.t / DT) % 15 === 0) look(); } stub.runTimers(0); };
  let n = 0, boxWas = null;
  for (const l of lines) {
    view.setCaption(l.text, { held: !!l.gd });
    if (!l.gd) { run(Math.min(4, (l.hold || 400) / 1000)); continue; }
    if (l.gd.type === 'delayed') armedSide = l.gd.penaltySide === 'home' ? 'a' : 'h';
    try { view.apply(l.gd); } catch (e) { threw ??= e.stack.split('\n').slice(0, 3).join(' '); continue; }
    run(Math.max(2, Math.min(10, (l.hold || 0) / 1000)));
    if (l.gd.type === 'penalty' && armedSide) { run(1); if (!W.pulled[armedSide]) seen.back++; armedSide = null; }
    // a man whose minutes are up leaves the box mid-period (not at the period's end), and is off at his bench
    const D = view.director?.state, inBox = D?.box?.length || 0;
    if (l.gd.type !== 'intermission' && l.gd.type !== 'penalty' && inBox < (boxWas ?? 0)) seen.outOnTime++;
    boxWas = inBox;
    for (const b of [...W.team.a, ...W.team.h]) if (b.active && b.boxed && b.hold && !D?.box?.some((e) => e.body === b) && b._outAt == null) b._outAt = W.t;
    for (const b of [...W.team.a, ...W.team.h]) if (b._outAt != null && W.t - b._outAt > 10) { if (b.active && b.boxed) seen.stuck++; b._outAt = null; }
    if (++n > 160) break;
  }
  check(!threw, 'the v9 game plays through the rink', threw || '');
  check(seen.chip > 0, 'the header says DELAYED PENALTY while the arm is up', JSON.stringify(seen));
  check(seen.pulled > 0, 'the goalie goes off for the extra man on a delayed call', JSON.stringify(seen));
  check(seen.back > 0, 'and comes back at the whistle', JSON.stringify(seen));
  check(seen.pp > 0 && seen.sh > 0, 'the power play and the shorthanded side are both named', JSON.stringify(seen));
  check(seen.box > 0 && seen.boxTime > 0, 'the penalty box is on the picture with a time', JSON.stringify(seen));
  check(seen.l3pen > 0, 'a penalty gets its lower third', JSON.stringify(seen));
  check(seen.l3delayed > 0, 'a delayed call gets its lower third', JSON.stringify(seen));
  check(seen.l3hurt > 0, 'an injury gets its lower third', JSON.stringify(seen));
  check(seen.outOnTime > 0, "a man leaves the box when his minutes are up, not at the period's end", JSON.stringify(seen));
  check(seen.stuck === 0, 'and walks off to his bench rather than staying held behind the boards', JSON.stringify(seen));
  if (verbose) console.log(`slot ${pick.slot}`, JSON.stringify(seen));
  view.dispose?.();
}

if (fails) { console.error(`rink-delayed: ${fails} failed`); process.exit(1); }

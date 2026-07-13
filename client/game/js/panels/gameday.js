// Gameday — the animated MLB-Gameday-style sub-screen for the DEADBALL broadcast.
//
// Placement-agnostic on purpose: it renders a per-at-bat `gameday` overlay payload
// (see plugins/broadcast/index.js `beatGameday`) into whatever host element it's
// given, holding no assumptions about the DOM around it. tv.js mounts one over the
// TV window today; a future tablet app can mount the same view unchanged.
//
// The payload is the same structured data Chip Vega is narrating — batter/pitcher,
// play kind, bases before→after, score — plus a synthesized pitch sequence. This
// module just animates it: the diamond with runner advancement, a pitch plot in the
// strike zone, the matchup + play card, and a running play-by-play feed.

function _esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Colour class per synthesized pitch result — drives the plot dot + the sequence list.
const PITCH_RESULT_CLASS = {
  ball: 'ball', called: 'called', swinging: 'swinging', foul: 'foul', inplay: 'inplay',
};
const PITCH_RESULT_LABEL = {
  ball: 'Ball', called: 'Called Strike', swinging: 'Swinging Strike', foul: 'Foul', inplay: 'In Play',
};

// ── Sound effects ──────────────────────────────────────────────────────────────
// Procedural one-shots (no assets) fired through the shared AudioEngine on the 'tv'
// bus, so they sit under the TV volume and go silent when the engine isn't loaded
// (e.g. the static preview harness). Each at-bat plays a smack per pitch synced to
// the dot-drop animation (--gd-delay = (n-1)·0.13s), the terminal pitch swapped for
// a bat-crack / whiff, then an outcome sting timed to land as the last pitch settles.
const SFX = {
  // Ball into the catcher's mitt — soft thud, one per non-contact pitch.
  mitt: { category: 'tv', priority: 2, config: { duration: 0.09, layers: [
    { waveform: 'noise', noiseMix: 1, duration: 0.07, gain: 0.13, filter: { type: 'lowpass', freq: 1100, q: 0.9 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 } },
    { waveform: 'sine', freq: 170, duration: 0.07, gain: 0.08, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 } },
  ] } },
  // Bat on ball — sharp transient + a woody knock. The in-play terminal pitch.
  crack: { category: 'tv', priority: 4, config: { duration: 0.13, layers: [
    { waveform: 'noise', noiseMix: 1, duration: 0.045, gain: 0.34, filter: { type: 'highpass', freq: 2000, q: 0.7 }, adsr: { a: 0.0005, d: 0.04, s: 0, r: 0.02 } },
    { waveform: 'triangle', freq: 440, pitchBend: { to: 190, time: 0.05 }, duration: 0.1, gain: 0.24, filter: { type: 'bandpass', freq: 900, q: 1.1 }, adsr: { a: 0.001, d: 0.07, s: 0, r: 0.05 } },
  ] } },
  // Swing and miss — airy swish, the swinging-strike terminal pitch.
  whiff: { category: 'tv', priority: 3, config: { waveform: 'noise', noiseMix: 1, duration: 0.16, gain: 0.14, filter: { type: 'bandpass', freq: 1500, q: 0.5 }, adsr: { a: 0.03, d: 0.11, s: 0, r: 0.05 } } },
  // Reached base (hit/walk, no run) — a soft two-note rise.
  base: { category: 'tv', priority: 4, config: { duration: 0.2, layers: [
    { waveform: 'sine', freq: 620, duration: 0.09, gain: 0.16, adsr: { a: 0.005, d: 0.08, s: 0, r: 0.05 } },
    { waveform: 'sine', freq: 830, delay: 0.085, duration: 0.12, gain: 0.16, adsr: { a: 0.005, d: 0.09, s: 0, r: 0.06 } },
  ] } },
  // Run(s) score — brighter three-note ding.
  run: { category: 'tv', priority: 5, config: { duration: 0.34, layers: [
    { waveform: 'triangle', freq: 523, duration: 0.1, gain: 0.16, adsr: { a: 0.005, d: 0.09, s: 0, r: 0.06 } },
    { waveform: 'triangle', freq: 659, delay: 0.09, duration: 0.1, gain: 0.16, adsr: { a: 0.005, d: 0.09, s: 0, r: 0.06 } },
    { waveform: 'triangle', freq: 784, delay: 0.18, duration: 0.16, gain: 0.18, adsr: { a: 0.005, d: 0.12, s: 0, r: 0.08 } },
  ] } },
  // Home run — a rising four-note fanfare with a shimmer on the top note.
  homer: { category: 'tv', priority: 6, config: { duration: 0.6, layers: [
    { waveform: 'sawtooth', freq: 392, duration: 0.12, gain: 0.12, filter: { type: 'lowpass', freq: 2600, q: 0.8 }, adsr: { a: 0.005, d: 0.1, s: 0.2, r: 0.1 } },
    { waveform: 'triangle', freq: 523, delay: 0.1, duration: 0.14, gain: 0.16, adsr: { a: 0.005, d: 0.11, s: 0.1, r: 0.08 } },
    { waveform: 'triangle', freq: 659, delay: 0.22, duration: 0.16, gain: 0.16, adsr: { a: 0.005, d: 0.12, s: 0.1, r: 0.09 } },
    { waveform: 'triangle', freq: 880, delay: 0.34, duration: 0.26, gain: 0.2, vibrato: { rate: 6, depth: 8 }, adsr: { a: 0.005, d: 0.14, s: 0.3, r: 0.14 } },
  ] } },
  // Strikeout — a descending "sit down" buzz.
  strikeout: { category: 'tv', priority: 4, config: { duration: 0.3, layers: [
    { waveform: 'sawtooth', freq: 392, pitchBend: { to: 196, time: 0.18 }, duration: 0.24, gain: 0.12, filter: { type: 'lowpass', freq: 1400, q: 1.4 }, adsr: { a: 0.005, d: 0.2, s: 0.1, r: 0.08 } },
  ] } },
  // Fielded out — a low woodblock thud (fired twice for a double play).
  out: { category: 'tv', priority: 3, config: { duration: 0.14, layers: [
    { waveform: 'sine', freq: 210, duration: 0.1, gain: 0.14, adsr: { a: 0.002, d: 0.09, s: 0, r: 0.05 } },
    { waveform: 'noise', noiseMix: 1, duration: 0.04, gain: 0.06, filter: { type: 'lowpass', freq: 600, q: 0.8 }, adsr: { a: 0.001, d: 0.03, s: 0, r: 0.02 } },
  ] } },
};
// Pitch-by-pitch playback pacing. The overlay carries a whole at-bat; the client
// plays it back one pitch at a time — deliberately slow, so the count builds — then
// holds the outcome. No spoken line is needed per pitch; this is the visual/audio
// beat. REVEAL_STEP_MS is the gap between pitches (capped so a long at-bat still
// finishes within REVEAL_MAX_MS, comfortably inside a line's on-air hold).
const REVEAL_STEP_MS = 850;
const REVEAL_MAX_MS = 5200;
const OUTCOME_GAP_MS = 340;   // beat between the final pitch landing and the result

// The diamond (shared shape with the score-bug, drawn larger here). `on` = occupied
// after the play; `fresh` = newly reached this at-bat, so it pulses.
function _diamond(after, before) {
  const b = after || [false, false, false];
  const pre = before || [false, false, false];
  const cls = (i) => `gd-base${b[i] ? ' on' : ''}${(b[i] && !pre[i]) ? ' fresh' : ''}`;
  return (
    `<svg class="gd-diamond" viewBox="0 0 120 120" aria-hidden="true">` +
      // base paths (faint) then the three bases as rotated squares
      `<path class="gd-basepath" d="M60 108 L18 60 L60 12 L102 60 Z" fill="none"/>` +
      `<rect class="${cls(0)}" x="86" y="46" width="28" height="28" transform="rotate(45 100 60)"/>` +   // 1st (right)
      `<rect class="${cls(1)}" x="46" y="6"  width="28" height="28" transform="rotate(45 60 20)"/>` +     // 2nd (top)
      `<rect class="${cls(2)}" x="6"  y="46" width="28" height="28" transform="rotate(45 20 60)"/>` +     // 3rd (left)
      `<rect class="gd-plate" x="49" y="97" width="22" height="22" transform="rotate(45 60 108)"/>` +     // home
    `</svg>`
  );
}

// The pitch plot: a strike-zone box with the synthesized pitches dropped in as
// numbered dots, staggered so they land in sequence. x/y are normalized [0,1] over
// the whole plot; the strike zone is the inner box (~0.25–0.75).
function _pitchPlot(pitches, newestN) {
  const ps = Array.isArray(pitches) ? pitches : [];
  const dots = ps.map((p) => {
    const cx = Math.max(0, Math.min(1, p.x)) * 100;
    const cy = Math.max(0, Math.min(1, p.y)) * 100;
    const c = PITCH_RESULT_CLASS[p.result] || 'ball';
    // Only the just-revealed pitch animates in; earlier ones are already settled
    // (the plot is re-rendered each reveal step, so static dots must stay visible).
    const fresh = (p.n === newestN) ? ' new' : '';
    return (
      `<g class="gd-pitch ${c}${fresh}">` +
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="7"/>` +
        `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" dy="3.2">${p.n}</text>` +
      `</g>`
    );
  }).join('');
  return (
    `<svg class="gd-zone" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">` +
      `<rect class="gd-zone-box" x="25" y="22" width="50" height="56"/>` +
      `<line class="gd-zone-grid" x1="41.7" y1="22" x2="41.7" y2="78"/>` +
      `<line class="gd-zone-grid" x1="58.3" y1="22" x2="58.3" y2="78"/>` +
      `<line class="gd-zone-grid" x1="25" y1="40.7" x2="75" y2="40.7"/>` +
      `<line class="gd-zone-grid" x1="25" y1="59.3" x2="75" y2="59.3"/>` +
      dots +
    `</svg>`
  );
}

function _pitchList(pitches) {
  const ps = Array.isArray(pitches) ? pitches : [];
  // Newest pitch first, capped so the column never overflows the small screen.
  return ps.slice().reverse().slice(0, 7).map((p) => {
    const c = PITCH_RESULT_CLASS[p.result] || 'ball';
    return (
      `<div class="gd-plrow">` +
        `<span class="gd-pldot ${c}">${p.n}</span>` +
        `<span class="gd-plres">${_esc(PITCH_RESULT_LABEL[p.result] || '')}</span>` +
        `<span class="gd-plpitch">${p.velo} mph ${_esc(p.type)}</span>` +
        `<span class="gd-plcount">${p.balls}-${p.strikes}</span>` +
      `</div>`
    );
  }).join('');
}

export function createGamedayView(host) {
  let feed = [];       // recent plays, newest first: { key, half, inning, batter, desc, rbi }
  let timers = [];     // pending reveal/audio timers for the at-bat currently playing back

  function _stop() { timers.forEach(clearTimeout); timers = []; }
  function _t(ms, fn) { timers.push(setTimeout(fn, Math.max(0, ms))); }
  function _sfx(def) { window.AudioEngine?.playSfx(def); }
  const _pitchSfx = (pt, terminal) => pt.result === 'swinging' ? SFX.whiff
    : (terminal && pt.result === 'inplay' ? SFX.crack : SFX.mitt);

  // Paint one frame of the at-bat. `reveal` = how many pitches are shown; `outcome`
  // flips the frame to the resolved play (result card, runners advanced, outs/score
  // updated). Re-rendered on each reveal step — cheap, and CSS animations only fire
  // on the newly-added dot / the outcome elements.
  function _paint(ctx, reveal, outcome) {
    const { p, isTop, away, home, aScore, hScore, cp, N, outsBefore, outsAfter, feedRows } = ctx;
    const outs = outcome ? outsAfter : outsBefore;
    // Count shown: live after each pitch, but the terminal pitch and the outcome both
    // read the count the deciding pitch was thrown on (a "1-3" is never a real count).
    let count = '0-0';
    if (outcome || reveal >= N) count = cp ? `${cp.balls}-${cp.strikes}` : '0-0';
    else if (reveal > 0) { const pt = p.pitches[reveal - 1]; count = `${pt.balls}-${pt.strikes}`; }
    const shown = p.pitches.slice(0, reveal);
    const newestN = outcome ? -1 : reveal;            // no re-animate once resolved
    // Pre-outcome: show the pre-play bases with no pulse (ref === shown). At outcome:
    // show the advanced bases, ref = pre-play, so only newly-reached bases pulse.
    const basesShown = outcome ? p.basesAfter : p.basesBefore;
    const basesRef = p.basesBefore;
    const runFlash = (outcome && p.rbi > 0) ? ' scored' : '';
    const statusArrow = isTop ? '▲' : '▼';

    const playCard = outcome
      ? `<div class="gd-play${runFlash}"><div class="gd-play-desc">${_esc(p.desc || '')}</div>` +
          `<div class="gd-play-bat">${_esc(p.batter || '')}</div></div>`
      : `<div class="gd-play pending"><div class="gd-play-desc">AT BAT</div>` +
          `<div class="gd-play-bat">${_esc(p.batter || '')}</div></div>`;

    host.innerHTML =
      `<div class="gd-top">` +
        `<div class="gd-team away${aScore > hScore ? ' lead' : ''}"><span class="gd-abbr">${_esc(away.abbr || 'AWY')}</span><span class="gd-score">${aScore}</span></div>` +
        `<div class="gd-mid"><span class="gd-inn">${statusArrow} ${_esc(p.inningOrd || '')}</span>` +
          `<span class="gd-outs">${[0, 1, 2].map(i => `<span class="gd-out${i < outs ? ' on' : ''}"></span>`).join('')}<em>${outs} OUT</em></span>` +
          `<span class="gd-count">${count}</span></div>` +
        `<div class="gd-team home${hScore > aScore ? ' lead' : ''}"><span class="gd-score">${hScore}</span><span class="gd-abbr">${_esc(home.abbr || 'HOM')}</span></div>` +
      `</div>` +
      `<div class="gd-body">` +
        `<div class="gd-col gd-diamond-col${runFlash}">${_diamond(basesShown, basesRef)}` +
          `<div class="gd-matchup">` +
            `<div class="gd-mrow"><span class="gd-mlabel">P</span><span class="gd-mname">${_esc(p.pitcher || '—')}</span></div>` +
            `<div class="gd-mrow"><span class="gd-mlabel bat">AB</span><span class="gd-mname">${_esc(p.batter || '—')}</span></div>` +
          `</div>` +
        `</div>` +
        `<div class="gd-col gd-plot-col">${_pitchPlot(shown, newestN)}` +
          `<div class="gd-plot-legend"><span class="gd-pldot ball">B</span><span class="gd-pldot called">K</span><span class="gd-pldot inplay">•</span></div>` +
        `</div>` +
        `<div class="gd-col gd-info-col">${playCard}` +
          `<div class="gd-pitchlist">${_pitchList(shown)}</div>` +
        `</div>` +
      `</div>` +
      `<div class="gd-feed">${feedRows(outcome)}</div>`;
  }

  function apply(p) {
    if (!host || !p) return;
    _stop();
    const isTop = p.half === 'top';
    const away = isTop ? { abbr: p.battingAbbr } : { abbr: p.fieldingAbbr };
    const home = isTop ? { abbr: p.fieldingAbbr } : { abbr: p.battingAbbr };
    const aScore = Number.isFinite(p.awayScore) ? p.awayScore : 0;
    const hScore = Number.isFinite(p.homeScore) ? p.homeScore : 0;
    const pitches = Array.isArray(p.pitches) ? p.pitches : [];
    const N = pitches.length;
    const cp = N > 1 ? pitches[N - 2] : null;   // count the deciding pitch was thrown on
    const outsAfter = Math.max(0, Math.min(3, p.outs | 0));
    const outsDelta = p.out ? (p.kind === 'doubleplay' ? 2 : 1) : 0;
    const outsBefore = Math.max(0, outsAfter - outsDelta);

    // The feed only gains this play once it resolves; dedupe on a stable key so a
    // re-sent overlay for the same beat doesn't double up.
    const key = `${p.inning}:${p.half}:${p.batter}:${p.desc}:${aScore}-${hScore}`;
    const feedRows = (outcome) => {
      let rows = feed;
      if (outcome) {
        if (!feed.length || feed[0].key !== key) {
          feed = [{ key, half: p.half, inning: p.inning, batter: p.batter, desc: p.desc, rbi: p.rbi }, ...feed].slice(0, 5);
        }
        rows = feed;
      }
      return rows.map((f, i) => (
        `<div class="gd-feed-row${i === 0 && outcome ? ' latest' : ''}">` +
          `<span class="gd-feed-inn">${f.half === 'top' ? 'T' : 'B'}${f.inning}</span>` +
          `<span class="gd-feed-bat">${_esc(f.batter || '—')}</span>` +
          `<span class="gd-feed-desc">${_esc(f.desc || '')}</span>` +
        `</div>`
      )).join('');
    };

    const ctx = { p: { ...p, pitches }, isTop, away, home, aScore, hScore, cp, N, outsBefore, outsAfter, feedRows };

    // Frame 0: the situation, before the first pitch (diamond in its pre-play state).
    _paint(ctx, 0, false);

    // Pace the pitches so a long at-bat still finishes within REVEAL_MAX_MS.
    const step = N > 1 ? Math.min(REVEAL_STEP_MS, REVEAL_MAX_MS / (N - 1)) : REVEAL_STEP_MS;
    for (let k = 1; k <= N; k++) {
      const terminal = k === N;
      const pt = pitches[k - 1];
      _t((k - 1) * step, () => { _paint(ctx, k, false); _sfx(_pitchSfx(pt, terminal)); });
    }

    // Outcome: a beat after the final pitch lands — result card, runners home, sting.
    const outMs = Math.max(0, N - 1) * step + OUTCOME_GAP_MS;
    _t(outMs, () => {
      _paint(ctx, N, true);
      if (p.kind === 'homerun') _sfx(SFX.homer);
      else if (p.rbi > 0) _sfx(SFX.run);
      else if (p.kind === 'strikeout') _sfx(SFX.strikeout);
      else if (p.out) { _sfx(SFX.out); if (p.kind === 'doubleplay') _t(150, () => _sfx(SFX.out)); }
      else _sfx(SFX.base);
    });
  }

  function clear() {
    _stop();
    if (host) host.innerHTML = '';
    feed = [];
  }

  return { apply, clear };
}

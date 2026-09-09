// Instrument plugin regression — drives the real `play` verb and the real note
// path against a throwaway piano, with no socket and no client.
//
// What this is actually guarding:
//  - the note path never leaves the room it started in (leaving ends it)
//  - the rate limit exists and lets a chord through (a limiter that thins a
//    chord to one note is worse than no limiter)
//  - a malformed note never reaches anybody's speakers
//  - the client's voice table and the server's validation list agree, which is
//    the same shared-vocabulary check the flatus styles get: the two files never
//    import each other, so nothing but a test can catch a drift
import { insertFurniture, deleteFurniture, world } from '../../server/engine/world.js';
import { query } from '../../server/models/db.js';
import { commands, _internals } from './index.js';
import '../../client/shared/procedural-sfx.js';

export default async function regress({ check }) {
  const Z = 'zone_instrument_regress';
  const EMPTY = 'zone_instrument_regress_empty';
  const FURN = 'furn_instrument_regress';
  const PID = `instrument_regress_${process.pid}`;
  const noop = () => {};
  const play = (input, p) => commands.play(input.split(/\s+/).filter(Boolean).slice(1), input, p, noop);
  const { seated, strike, lift, normaliseNote, takeToken, BURST } = _internals;

  const player = { id: PID, handle: 'Pianist', current_zone: EMPTY, posture: 'standing' };
  world.players.set(PID, player);

  try {
    await insertFurniture({
      id: FURN, name: 'test upright', description: 'a test piano', object_type: 'furniture',
      zone_id: Z, flags: JSON.stringify({ instrument: 'piano', interactions: ['examine', 'play'] }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id');

    // Nothing to play in an empty room.
    let r = await play('play', player);
    check('play with no instrument errors cleanly', r?.type === 'error', JSON.stringify(r));
    check('...and seats nobody', !seated.has(PID));

    // Sit down.
    player.current_zone = Z;
    r = await play('play', player);
    check('play seats the player', r?.type === 'output' && seated.has(PID), JSON.stringify(r));
    check('...sitting on the instrument', player.posture === 'sitting' && player.sittingOn === FURN,
      `${player.posture}/${player.sittingOn}`);

    // The examine Actions link and the mobile smart bar both send the verb with
    // the object name attached — `play black upright piano`. That is the route a
    // player is most likely to arrive by, and refusing it means the affordance
    // the game just advertised doesn't work.
    await play('play stop', player);
    r = await play('play test upright', player);
    check('play with the object name attached still seats', r?.type === 'output' && seated.has(PID), JSON.stringify(r));
    r = await play('play the piano', player);
    check('...and so do stray English words', r?.type !== 'error', JSON.stringify(r));

    // A note goes out.
    check('a valid note strikes', strike(player, 'C4', 0.8) === true);

    // Malformed notes are rejected before they reach a speaker, and the octave
    // is clamped rather than refused (the panel's transpose can walk off a real
    // keyboard, and bouncing it silently beats an error nobody asked for).
    check('note grammar rejects junk', normaliseNote('H9') === null && normaliseNote('') === null);
    check('note grammar normalises case', normaliseNote('c#4') === 'C#4');
    check('note grammar clamps the octave', normaliseNote('C9') === 'C8');
    // Flats are accepted and respelled as sharps — one spelling on the wire, or
    // a Db sounds correctly and lights no key on anybody's panel.
    check('note grammar respells flats as sharps', normaliseNote('db4') === 'C#4' && normaliseNote('Bb2') === 'A#2',
      `${normaliseNote('db4')}/${normaliseNote('Bb2')}`);

    // The limiter must pass a chord. This is the reason it's a bucket and not an
    // interval — four notes in the same millisecond is one hand, not a flood.
    const s = seated.get(PID);
    s.tokens = BURST; s.last = Date.now();
    let passed = 0;
    for (let i = 0; i < 4; i++) if (takeToken(s)) passed++;
    check('the rate limit passes a four-note chord', passed === 4, `passed ${passed}`);
    // ...and does eventually say no.
    s.tokens = 0; s.last = Date.now();
    check('the rate limit does bite', takeToken(s) === false);

    // A NOTE-OFF MUST OUTRANK THE LIMITER. The bucket is empty right now, which
    // is exactly the moment this matters: the message being dropped would be the
    // one that ENDS a sound, so a rate-limited release leaves every other ear in
    // the room holding the note until its own 30s cap expires. There is no flood
    // risk to trade against — you cannot lift a key you did not press.
    // Re-emptied immediately before the calls: the bucket refills against the
    // wall clock, and 71ms between the two lines would hand back a token and
    // turn this into a test that passes for the wrong reason on a slow machine.
    s.tokens = 0; s.last = Date.now();
    check('a note strike is refused with an empty bucket', strike(player, 'C4', 0.8) === false);
    check('...but the note-off still goes out', lift(player, 'C4') === true);

    // Walking out ends the performance — the note path must not survive the room.
    player.current_zone = EMPTY;
    check('a note from another room is refused', strike(player, 'C4', 0.8) === false);
    check('...and the seat is released', !seated.has(PID));

    // Shared vocabulary: every voice the server will accept must be a voice the
    // client can actually build, or the room hears a piano where a rhodes was.
    const table = globalThis.ProceduralSFX?.INSTRUMENTS || {};
    const missing = _internals.VOICES.filter(v => !table[v]);
    check('every declared voice exists in the shared table', missing.length === 0, missing.join(','));

    // ── and the world actually holds one of each ──────────────────────────────
    // Both directions, because both have been wrong.
    //
    // Outward: `voiceOf()` falls back to piano for anything it doesn't know, so a
    // misspelled `flags.instrument` is not an error — it is a harpsichord that
    // sounds like an upright, in one room, for as long as nobody stands in it.
    //
    // Inward: rhodes, musicbox, pluck and organ were authored, tuned, tested and
    // placed NOWHERE for months. A voice with no furniture is a voice no player
    // can reach, and nothing failed, because unreachable is not an exception. If
    // you add a voice, place it in the same commit.
    const { rows: placed } = await query(
      "SELECT id, name, flags->>'instrument' AS voice FROM furniture WHERE flags->>'instrument' IS NOT NULL");
    // A voice is valid if it is one of the five in code OR an authored synth row
    // in audio_instruments — that second route is the whole point of the
    // unification, so a check that only knew about the first would reject exactly
    // the instruments somebody built in the dev panel.
    const { getInstrumentDef } = await import('../audio/index.js');
    const validVoice = (v) => _internals.VOICES.includes(v) || !!(getInstrumentDef(v) && !getInstrumentDef(v).sample_id);
    const bogus = placed.filter(r => !validVoice(r.voice));
    check('every placed instrument names a real voice', bogus.length === 0,
      bogus.map(r => `${r.name}=${r.voice}`).join(', '));
    // Sample-backed rows are refused rather than approximated: the panel has no
    // pitch-shifting path, so one would silently play as a piano.
    const sampled = placed.filter(r => getInstrumentDef(r.voice)?.sample_id);
    check('no instrument is wired to a sample-backed row', sampled.length === 0,
      sampled.map(r => r.name).join(', '));
    const unplaced = _internals.VOICES.filter(v => !placed.some(r => r.voice === v));
    check('every voice exists somewhere a player can reach', unplaced.length === 0,
      `${unplaced.join(', ')} — authored but in no room`);

    // And the voices build a real cue rather than nothing.
    const cue = globalThis.ProceduralSFX?.buildNoteCue({ instrument: 'piano', note: 'C4', velocity: 0.8 });
    check('a note builds a playable cue', !!cue?.config?.layers?.length, JSON.stringify(cue?.config?.duration));
    // Low notes must ring longer than high ones, or the stretch curve is inverted
    // and the whole instrument sounds like a toy.
    const low = globalThis.ProceduralSFX.buildNoteCue({ note: 'C2' }).config.duration;
    const high = globalThis.ProceduralSFX.buildNoteCue({ note: 'C6' }).config.duration;
    check('low notes ring longer than high ones', low > high * 2, `${low} vs ${high}`);

    // Struck vs blown. The panel decides whether to keep a release handle off
    // `cue.sustained` alone, so a voice that lost the mark would go back to
    // decaying under the player's hands with nothing to say it had.
    const organ = globalThis.ProceduralSFX.buildNoteCue({ instrument: 'organ', note: 'C4' });
    check('the organ is a held voice', organ.sustained === true && organ.config.layers[0].adsr.s > 0,
      `${organ.sustained}/${organ.config.layers[0].adsr.s}`);
    check('a struck voice is not', !cue.sustained && cue.config.layers[0].adsr.s === 0);
    // Only lift() is exempt from the bucket. If lift ever grew a takeToken call
    // the check above would still pass on a full bucket, so the exemption is
    // asserted where it is load-bearing rather than where it is convenient.
    check('lift refuses a player who is not seated', lift({ id: 'nobody_here' }, 'C4') === false);
  } finally {
    seated.delete(PID);
    world.players.delete(PID);
    await deleteFurniture(FURN).catch(() => {});
  }
}

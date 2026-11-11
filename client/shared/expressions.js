// An NPC's mood, and what it does to a face (docs/systems-expressions.md).
//
// A mood is one of a fixed list; the server resolves which one somebody is in (server/engine/npc-mood.js)
// and sends it with them as { m, i }, a name and an intensity 0..1. The face reads it here as seven
// channels, FACS-style, which every face that can move takes what it can draw of:
//
//   browIn  the inner brows knit down          anger, effort
//   browUp  the inner brows lift               sadness, fear, surprise
//   lid     the upper lid: -1 narrowed, 0 as it is, +1 wide
//   smile   the mouth's corners up, the grin figure-hd already paints (uSmile)
//   frown   the mouth's corners down
//   jaw     the jaw dropped, under whatever speech is doing
//   sneer   the upper lip lifted and the nose wrinkled
//
// `blink` scales how often they blink. The text says the same mood with `MOOD_TELL` (the look line), so
// the picture and the prose come off one value.

export const EXPRESSION_CHANNELS = ['browIn', 'browUp', 'lid', 'smile', 'frown', 'jaw', 'sneer'];

export const EXPRESSIONS = {
  neutral:   { blink: 1 },
  happy:     { smile: 0.75, lid: -0.15, browUp: 0.1 },
  amused:    { smile: 0.45, lid: -0.25, browIn: 0.1 },
  sad:       { browUp: 0.85, lid: -0.35, frown: 0.6, blink: 0.8 },
  angry:     { browIn: 1, lid: -0.45, frown: 0.45, sneer: 0.2, blink: 0.6 },
  afraid:    { browUp: 1, browIn: 0.45, lid: 0.9, jaw: 0.18, frown: 0.25, blink: 1.8 },
  disgusted: { sneer: 0.9, browIn: 0.5, lid: -0.3, frown: 0.3 },
  surprised: { browUp: 1, lid: 1, jaw: 0.35, blink: 0.4 },
  tired:     { lid: -0.6, browUp: 0.2, frown: 0.15, blink: 0.55 },
  drunk:     { lid: -0.5, smile: 0.3, browUp: 0.25, jaw: 0.06, blink: 0.7 },
  confused:  { browIn: 0.55, browUp: 0.45, lid: 0.15, frown: 0.2 },
  annoyed:   { browIn: 0.6, lid: -0.25, frown: 0.35 },
};

export const MOODS = Object.keys(EXPRESSIONS);
export const isMood = (m) => Object.prototype.hasOwnProperty.call(EXPRESSIONS, m);

// The channels of mood `m` at intensity `i`, as a plain object with every channel present.
export function expressionOf(m, i = 1) {
  const e = EXPRESSIONS[m] || EXPRESSIONS.neutral, k = Math.max(0, Math.min(1, +i || 0)), out = { blink: 1 + ((e.blink ?? 1) - 1) * k };
  for (const c of EXPRESSION_CHANNELS) out[c] = (e[c] || 0) * k;
  return out;
}

// Eases a face toward its mood: `cur` is the face's own state (kept per person by the caller), `to` an
// expressionOf result, `dt` seconds. About 200 ms to settle, so a mood comes on rather than snaps.
export function easeExpression(cur, to, dt, rate = 12) {
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  for (const c of EXPRESSION_CHANNELS) cur[c] = (cur[c] || 0) + (to[c] - (cur[c] || 0)) * k;
  cur.blink = (cur.blink ?? 1) + ((to.blink ?? 1) - (cur.blink ?? 1)) * k;
  return cur;
}

// What `look` says about somebody in this mood, by strength: [mild, strong]. Neutral says nothing.
// They read after the name, so each starts with a verb in the third person.
export const MOOD_TELL = {
  happy:     ['looks pleased about something.', 'is grinning.'],
  amused:    ['looks faintly amused.', 'is trying not to laugh.'],
  sad:       ['looks down.', 'looks like they have been crying.'],
  angry:     ['looks irritated.', 'is furious, and not hiding it.'],
  afraid:    ['looks nervous.', 'is badly frightened.'],
  disgusted: ['wrinkles their nose.', 'looks like they might be sick.'],
  surprised: ['looks a little startled.', 'is staring, mouth open.'],
  tired:     ['looks tired.', 'can barely keep their eyes open.'],
  drunk:     ['has had a few.', 'is very drunk.'],
  confused:  ['looks puzzled.', 'has no idea what is going on.'],
  annoyed:   ['looks put out.', 'is plainly annoyed.'],
};
export const moodTell = (m, i = 1) => { const t = MOOD_TELL[m]; return t ? t[i >= 0.6 ? 1 : 0] : ''; };

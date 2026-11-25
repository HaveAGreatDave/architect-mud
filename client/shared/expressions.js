// An NPC's mood, and what it does to a face (docs/systems-expressions.md).
//
// A mood is one of a fixed list; the server resolves which one somebody is in (server/engine/npc-mood.js)
// and sends it with them as { m, i }, a name and an intensity 0..1. The face reads it here as thirteen
// channels, FACS-style, which every face that can move takes what it can draw of:
//
//   browIn  the inner brows knit down          anger, effort
//   browUp  the inner brows lift               sadness, fear, surprise
//   lid     the upper lid: -1 narrowed, 0 as it is, +1 wide
//   smile   the mouth's corners up, the grin figure-hd already paints (uSmile)
//   frown   the mouth's corners down
//   jaw     the jaw dropped, under whatever speech is doing
//   sneer   the upper lip lifted and the nose wrinkled
//   browL   the whole of their left brow raised (below 0, lowered); browR their right
//   squint  the cheeks raised: the lower lids come up under the eyes
//   smirk   one corner of the mouth up: above 0 their left, below 0 their right
//   winkL   their left eye shut on its own; winkR their right
//
// "Their left" is the figure's own left, which is on the viewer's right when they face you.
//
// `blink` scales how often they blink. The text says the same mood with `MOOD_TELL` (the look line), so
// the picture and the prose come off one value.

// (The second row moves the face's own surface, not only its paint, gl/figure-hd.js faceRig: the cheeks raised or
// puffed, the lips pushed out, the nostrils flared, the jaw slid to one side or pushed forward. The third row are
// mouth shapes a mood can hold when nobody is talking: bared teeth, pressed lips, a pucker, a stretch.)
export const EXPRESSION_CHANNELS = ['browIn', 'browUp', 'lid', 'smile', 'frown', 'jaw', 'sneer', 'browL', 'browR', 'squint', 'smirk', 'winkL', 'winkR',
  'cheek', 'puff', 'pout', 'flare', 'jawSide', 'jawOut',
  'teeth', 'press', 'round', 'wide',
  // how the head is carried and where the eyes go: chin down (below 0, up), turned to their left, tipped to their
  // left shoulder; the eyes to their left, and up. 1 is about 17 degrees of head, and most of the way across the eye.
  'headP', 'headY', 'headR', 'gazeX', 'gazeY'];

export const EXPRESSIONS = {
  neutral:   { blink: 1 },
  happy:     { smile: 0.75, lid: -0.15, browUp: 0.1, squint: 0.5, cheek: 0.5, headP: -0.1 },
  amused:    { smile: 0.3, smirk: 0.55, lid: -0.2, squint: 0.35, browL: 0.25, headR: 0.2, headP: -0.05 },
  sad:       { browUp: 0.85, lid: -0.35, frown: 0.6, blink: 0.8, headP: 0.5, gazeY: -0.6 },
  angry:     { browIn: 1, lid: -0.45, frown: 0.45, sneer: 0.2, blink: 0.6, flare: 0.7, jawOut: 0.5, press: 0.4, headP: 0.25, gazeY: 0.25 },
  afraid:    { browUp: 1, browIn: 0.45, lid: 0.9, jaw: 0.18, frown: 0.25, blink: 1.8, flare: 0.5, wide: 0.4, headP: -0.15, headY: 0.12 },
  disgusted: { sneer: 0.9, browIn: 0.5, lid: -0.3, frown: 0.3, squint: 0.4, flare: 0.6, cheek: 0.3, headP: -0.15, headY: 0.3, gazeX: -0.3 },
  surprised: { browUp: 1, lid: 1, jaw: 0.35, blink: 0.4, headP: -0.25 },
  tired:     { lid: -0.6, browUp: 0.2, frown: 0.15, blink: 0.55, headP: 0.45, headR: 0.25, gazeY: -0.4 },
  drunk:     { lid: -0.5, smile: 0.3, browUp: 0.25, jaw: 0.06, blink: 0.7, smirk: -0.3, headR: 0.4, headP: 0.2 },
  confused:  { browIn: 0.45, browUp: 0.3, browL: 0.8, browR: -0.3, lid: 0.15, frown: 0.2, headR: 0.5, headP: 0.05 },
  annoyed:   { browIn: 0.6, lid: -0.25, frown: 0.35, press: 0.5, jawSide: 0.3, headR: -0.2, headY: 0.2, gazeX: -0.6 },
  // (the moods a show asks for by name: nothing in the world resolves to these yet)
  skeptical: { browL: 1, browR: -0.45, browIn: 0.25, lid: -0.25, squint: 0.3, smirk: -0.25, headR: 0.35, headP: -0.15, headY: -0.2, gazeX: 0.4 },
  smug:      { smirk: 0.9, lid: -0.4, browL: 0.35, squint: 0.3, headP: -0.35, headR: 0.15 },
  flirty:    { winkL: 1, smirk: 0.7, smile: 0.25, browR: 0.5, headR: 0.4, headP: 0.2, gazeX: 0.3, gazeY: 0.2 },
  stern:     { browIn: 0.75, browL: -0.3, browR: -0.3, lid: -0.3, frown: 0.2, squint: 0.2, blink: 0.6, press: 0.6, jawOut: 0.3, headP: 0.2 },
  laughing:  { smile: 1, jaw: 0.45, squint: 0.9, cheek: 1, teeth: 0.8, browUp: 0.25, blink: 1.4, headP: -0.5 },
  crying:    { browUp: 1, browIn: 0.5, frown: 0.9, squint: 0.7, cheek: 0.4, jaw: 0.1, flare: 0.4, lid: -0.3, blink: 2.2, headP: 0.6, gazeY: -0.7 },
  shocked:   { browUp: 1, lid: 1, jaw: 0.6, round: 0.5, flare: 0.3, blink: 0.2, headP: -0.2 },
  thinking:  { browL: 0.55, browIn: 0.3, lid: -0.2, pout: 0.5, jawSide: 0.6, press: 0.3, blink: 0.7, headR: 0.35, headP: -0.15, gazeX: -0.8, gazeY: 0.7 },
  determined: { browIn: 0.7, lid: -0.3, jawOut: 0.8, press: 0.6, flare: 0.5, frown: 0.15, blink: 0.5, headP: 0.25, gazeY: 0.2 },
  bored:     { lid: -0.55, browUp: 0.15, puff: 0.5, frown: 0.15, jawSide: -0.2, blink: 0.6, headR: 0.45, headP: 0.15, gazeX: 0.7, gazeY: -0.2 },
  pouting:   { pout: 1, browIn: 0.35, browUp: 0.4, frown: 0.4, lid: -0.15, headP: 0.35, gazeY: 0.4 },
  grimacing: { teeth: 1, wide: 0.6, jaw: 0.14, browIn: 0.7, squint: 0.7, cheek: 0.6, sneer: 0.3, lid: -0.2, headP: 0.1, headR: 0.15 },
  kissing:   { round: 1, pout: 0.8, lid: -0.5, browUp: 0.2, headP: -0.1, headR: 0.2 },
  smirking:  { smirk: 1, squint: 0.25, browR: 0.4, lid: -0.2, cheek: 0.2, headR: -0.25, headP: -0.1 },
  sarcastic: { smirk: 0.6, browL: 0.55, browR: -0.15, lid: -0.3, squint: 0.2, headR: 0.25, headP: -0.1, gazeX: 0.25, gazeY: 0.15 },
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
  skeptical: ['raises an eyebrow.', 'plainly does not believe a word of it.'],
  smug:      ['looks pleased with themselves.', 'is unbearably smug.'],
  flirty:    ['is smiling at you.', 'winks.'],
  stern:     ['looks stern.', 'is not in the mood for any of it.'],
  laughing:  ['is laughing.', 'is helpless with laughter.'],
  crying:    ['is close to tears.', 'is crying.'],
  shocked:   ['looks shocked.', 'is open-mouthed with shock.'],
  thinking:  ['is thinking it over.', 'is deep in thought.'],
  determined: ['looks set on it.', 'has their jaw set.'],
  bored:     ['looks bored.', 'is bored stiff.'],
  pouting:   ['is pouting a little.', 'is sulking.'],
  grimacing: ['winces.', 'grimaces, teeth bared.'],
  kissing:   ['purses their lips.', 'blows a kiss.'],
  smirking:  ['is smirking.', 'is smirking openly.'],
  sarcastic: ['has a dry look about them.', 'wears an openly sarcastic smirk.'],
};
export const moodTell = (m, i = 1) => { const t = MOOD_TELL[m]; return t ? t[i >= 0.6 ? 1 : 0] : ''; };

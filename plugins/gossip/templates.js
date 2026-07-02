// plugins/gossip/templates.js
//
// category → line templates. render(vars) returns a chitchat string; per the
// formatChitchat contract a line that is a single quoted span becomes a say
// bubble, an unquoted line becomes an emote. Each template also declares the
// item's default `reach` (hop radius, or 'global') and base `heat`.
//
// Tone: brutal, dry, street-level — matches the NPC banter library.

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const TEMPLATES = {
  kill_player: {
    category: 'violence', reach: 'global', heat: 0.95,
    render: (v) => pick([
      `"Heard ${v.killer} put ${v.victim} down over in ${v.zone}. Messy."`,
      `"Word is ${v.victim} ain't getting back up. ${v.killer} saw to that."`,
      `"They're still hosing ${v.victim} off the pavement in ${v.zone}. Ask ${v.killer}."`,
    ]),
  },
  kill_enemy: {
    category: 'violence', reach: 2, heat: 0.5,
    render: (v) => pick([
      `"${v.killer} gutted a ${v.victim} out in ${v.zone}. One less problem."`,
      `"Saw ${v.killer} drop a ${v.victim}. Didn't even blink."`,
    ]),
  },
  kill_npc: {
    category: 'violence', reach: 'global', heat: 0.85,
    render: (v) => pick([
      `"${v.killer} killed ${v.victim}. In cold blood, they say."`,
      `"${v.victim}'s dead. ${v.killer} did it. People are talking."`,
    ]),
  },
  crime: {
    category: 'crime', reach: 3, heat: 0.8,
    render: (v) => pick([
      `"${v.suspect}'s wanted now — ${v.label}. Cameras caught the whole thing."`,
      `"Don't stand near ${v.suspect}. Heat's looking for them over ${v.label}."`,
    ]),
  },
  poker_win: {
    category: 'wealth', reach: 3, heat: 0.7,
    render: (v) => pick([
      `"${v.subject} walked off the table ${v.amount} credits heavier. Lucky, or a cheat."`,
      `"${v.subject} cleaned out the poker table. Somebody's buying tonight."`,
    ]),
  },
  big_buy: {
    category: 'wealth', reach: 2, heat: 0.55,
    render: (v) => pick([
      `"${v.subject} just dropped ${v.amount} on a ${v.item}. Money to burn, that one."`,
      `"Saw ${v.subject} splash out on a ${v.item}. Where's a nobody get that kind of scratch?"`,
    ]),
  },
  housing: {
    category: 'wealth', reach: 2, heat: 0.5,
    render: (v) => pick([
      `"${v.subject} signed for a place over in ${v.zone}. Coming up in the world."`,
      `"${v.subject}'s got their own roof now. ${v.zone}. Must be nice."`,
    ]),
  },
  blackout: {
    category: 'world', reach: 'global', heat: 0.8,
    render: (v) => pick([
      `"Power's out in ${v.zone}. Whole block gone dark."`,
      `"${v.zone}'s blacked out. Stay sharp — nothing good happens in the dark."`,
    ]),
  },
  power_back: {
    category: 'world', reach: 'global', heat: 0.5,
    render: (v) => pick([
      `"Lights are back on in ${v.zone}. About time."`,
      `"${v.zone}'s got power again. Grid's holding, for now."`,
    ]),
  },
  storm: {
    category: 'world', reach: 3, heat: 0.45,
    render: (v) => pick([
      `"Storm's rolling in over ${v.zone}. Gonna be a wet one."`,
      `"Sky's turning black over ${v.zone}. Get under cover."`,
    ]),
  },
  rumor: {
    category: 'rumor', reach: 2, heat: 0.75,
    render: (v) => `"${v.text}"`,
  },
  // The shadow dealer's passphrase — a secret worth whispering. Ask-only (never
  // ambient), seeded rarely, so an NPC only lets it slip when a player pushes.
  dealer_phrase: {
    category: 'secret', reach: 'global', heat: 0.4,
    render: (v) => pick([
      `leans in, barely audible. "You want the figure in the dark? Get near him after nightfall and say '${v.phrase}'. You didn't hear it from me."`,
      `glances around, then murmurs. "There's a way to the good stuff. Find the dealer at night, tell him '${v.phrase}'. That's all I'm saying."`,
      `"Word is the shadow dealer opens up if you know the words — '${v.phrase}'. Only after dark, though. Keep it quiet."`,
    ]),
  },
};

export function renderItem(item) {
  const t = TEMPLATES[item.templateKey];
  return t ? t.render(item.vars || {}) : null;
}

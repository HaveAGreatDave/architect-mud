// plugins/gossip/templates.js
//
// category → line templates. render(vars) returns a chitchat string; per the
// formatChitchat contract a line that is a single quoted span becomes a say
// bubble, an unquoted line becomes an emote. Each template also declares the
// item's default `reach` (hop radius, or 'global') and base `heat`.
//
// A template about a specific player may also define renderYou(vars): when the
// listener IS the rumour's subject, the NPC turns it on them to their face —
// second person, and a little amused about it. renderItem() picks this variant.
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
    renderYou: (v) => pick([
      `"Hey — aren't you the one ${v.killer} put down in ${v.zone}? You look better than the story."`,
      `"They're still mopping you off the pavement in ${v.zone}, far as anyone heard. Spooky, you standing here."`,
      `"Word is you didn't get back up. And yet." <span class="text-dim">They look you over, unconvinced.</span>`,
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
    renderYou: (v) => pick([
      `"You're the one they want, aren't you — ${v.label}. Cameras got your good side and all." <span class="text-dim">They edge back a step.</span>`,
      `"I'd not stand so close to me if I were you. Heat's out for you over ${v.label}."`,
      `"Big fan of your work. ${v.label}, right out in the open. Bold." <span class="text-dim">They do not mean it kindly.</span>`,
    ]),
  },
  poker_win: {
    category: 'wealth', reach: 3, heat: 0.7,
    render: (v) => pick([
      `"${v.subject} walked off the table ${v.amount} credits heavier. Lucky, or a cheat."`,
      `"${v.subject} cleaned out the poker table. Somebody's buying tonight."`,
    ]),
    renderYou: (v) => pick([
      `"You're the one who walked off the table ${v.amount} up. Lucky, or a cheat — I haven't decided which."`,
      `"Heard you cleaned out the poker table. So you're buying tonight, then." <span class="text-dim">Not a question.</span>`,
    ]),
  },
  big_buy: {
    category: 'wealth', reach: 2, heat: 0.55,
    render: (v) => pick([
      `"${v.subject} just dropped ${v.amount} on a ${v.item}. Money to burn, that one."`,
      `"Saw ${v.subject} splash out on a ${v.item}. Where's a nobody get that kind of scratch?"`,
    ]),
    renderYou: (v) => pick([
      `"You're the one who dropped ${v.amount} on a ${v.item}. Money to burn, apparently. Some of us are jealous."`,
      `"Word's out you splashed on a ${v.item}. Where's a nobody like you get that kind of scratch?" <span class="text-dim">They grin.</span>`,
    ]),
  },
  housing: {
    category: 'wealth', reach: 2, heat: 0.5,
    render: (v) => pick([
      `"${v.subject} signed for a place over in ${v.zone}. Coming up in the world."`,
      `"${v.subject}'s got their own roof now. ${v.zone}. Must be nice."`,
    ]),
    renderYou: (v) => pick([
      `"Heard you signed for a place in ${v.zone}. Look at you, landed gentry."`,
      `"You've got your own roof now, ${v.zone} way. Must be nice. Don't forget the little people."`,
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
  // First-time-in-the-world rumours — a newbie's first kill / first win / first
  // spend rings louder and more personal than the everyday version, so the world
  // starts saying their name within minutes. Fires once each (gated on a player
  // flag in index.js), then normal service resumes.
  first_blood: {
    category: 'violence', reach: 'global', heat: 0.9,
    render: (v) => pick([
      `"New face in ${v.zone} — and already got blood on 'em. ${v.subject}. Remember the name."`,
      `"Somebody nobody's heard of just dropped their first kill over in ${v.zone}. ${v.subject}. They fight back, that one."`,
    ]),
    renderYou: (v) => pick([
      `"You're the new one. First blood already, ${v.zone} way. People remember a name that fights back."`,
      `"Word's out about you — new face, first kill in ${v.zone}. You're on the board now, like it or not."`,
    ]),
  },
  first_score: {
    category: 'wealth', reach: 'global', heat: 0.8,
    render: (v) => pick([
      `"New face cleaned up at the table — ${v.subject}, ${v.amount} credits their first sit-down. Beginner's luck, or something worse."`,
      `"${v.subject} walked in a nobody and walked out ${v.amount} up. First hand anyone's seen 'em play, too."`,
    ]),
    renderYou: (v) => pick([
      `"You're the new one who walked off ${v.amount} up your first time at the table. Luck like that gets noticed. And remembered."`,
      `"Heard you cleaned out the table your first sit-down, new blood. Someone's always watching who wins."`,
    ]),
  },
  first_deal: {
    category: 'wealth', reach: 2, heat: 0.4,
    render: (v) => pick([
      `"New face spending already — ${v.subject} did their first bit of business in ${v.zone}. Money moves, people notice."`,
      `"Saw the new one, ${v.subject}, put money down in ${v.zone}. Word gets around fast here."`,
    ]),
    renderYou: (v) => pick([
      `"Saw you spending, new one — first business in ${v.zone}. Word travels quick round here. You'll learn."`,
      `"You're the new face throwing credits around in ${v.zone}. Somebody always clocks the newcomer with money."`,
    ]),
  },
  // The turf war made audible — a corner changing hands ripples outward as street talk.
  turf: {
    category: 'crime', reach: 3, heat: 0.55,
    render: (v) => pick([
      `"Corners are moving. ${v.from} lost ${v.zone} to ${v.to}, just like that."`,
      `"Word is ${v.to} runs ${v.zone} now. ${v.from} won't wear that quiet."`,
    ]),
  },
  dealer_missing: {
    category: 'crime', reach: 3, heat: 0.5,
    render: (v) => pick([
      `"Nobody's seen ${v.dealer} since ${v.zone} changed hands. Gone to ground, they reckon."`,
      `"${v.dealer}'s corner got taken. Wouldn't go looking for 'em for a while, if I were you."`,
    ]),
  },
  // A DEADBALL box score, spoken by an NPC who has a team. ctx.fav is the
  // speaker's favourite team (a stable per-NPC allegiance): if they back the
  // winner they gloat, the loser they grumble, otherwise they report it flat and
  // name-drop their own club. That's "bring up the score" + "talk up their team"
  // in one line. vars: away/home/awayScore/homeScore/winner (full team names).
  sports_score: {
    category: 'sports', reach: 'global', heat: 0.5,
    render: (v, ctx = {}) => {
      const winScore  = v.winner === v.away ? v.awayScore : v.homeScore;
      const loseScore = v.winner === v.away ? v.homeScore : v.awayScore;
      const loser     = v.winner === v.away ? v.home : v.away;
      const fav = ctx.fav;
      if (fav && fav === v.winner) return pick([
        `"${v.winner} took ${loser} ${winScore}-${loseScore}. That's MY team — told you they'd bury 'em."`,
        `grins. "You catch the DEADBALL game? ${v.winner} put ${loseScore} runs on ${loser} and rolled, ${winScore}-${loseScore}. About time."`,
        `"${winScore}-${loseScore}, ${v.winner} over ${loser}. I've bled for that club all season and it finally paid off."`,
      ]);
      if (fav && fav === loser) return pick([
        `spits. "${loser} blew it again — ${loseScore}-${winScore} to ${v.winner}. Every damn year with my team."`,
        `"Don't talk to me about the DEADBALL score. ${v.winner} beat my ${loser} ${winScore}-${loseScore}. I need a drink."`,
        `"${loser} choked, ${loseScore}-${winScore}. I keep backing 'em and they keep breaking my heart."`,
      ]);
      return pick([
        `"${v.winner} beat ${loser} ${winScore}-${loseScore} in the DEADBALL. Neither's my club, mind — I'm ${fav ? fav : 'still deciding who to hate'}."`,
        `"Box score's in: ${v.winner} ${winScore}, ${loser} ${loseScore}."${fav ? ` "Wake me when ${fav} play."` : ''}`,
        `"Heard ${v.winner} handled ${loser}, ${winScore}-${loseScore}. Good for them.${fav ? ` My ${fav} are the ones I'm watching.` : ''}"`,
      ]);
    },
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

// aboutYou: the listener is this rumour's subject, so use the second-person
// variant if the template has one (falls back to third person otherwise).
// ctx carries speaker-dependent flavour (e.g. { fav } — the voicing NPC's
// favourite sports team); templates that don't care simply ignore it.
export function renderItem(item, aboutYou = false, ctx = {}) {
  const t = TEMPLATES[item.templateKey];
  if (!t) return null;
  if (aboutYou && t.renderYou) return t.renderYou(item.vars || {}, ctx);
  return t.render(item.vars || {}, ctx);
}

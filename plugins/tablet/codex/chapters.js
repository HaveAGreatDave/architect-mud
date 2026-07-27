// CODEX — the chapter corpus.
//
// Static authored prose, deliberately NOT content-pipeline data: this is the
// game's own backstory, one fixed text that every player reads, with no
// per-world variation and nothing for a builder to edit in the dev panel. It
// sits with the app that renders it for the same reason the prologue's welcome
// broadcast sits in plugins/prologue (a fixed script, not world content).
//
// Shape of a chapter:
//   id        stable slug — also the unlock flag suffix (codex_ch_<id>)
//   volume    section id it belongs to ('quiet' | 'basin')
//   n         display numeral
//   title     chapter title
//   eyebrow   small caps line above the title
//   lede      one-sentence standfirst, shown in the index AND at the top of the read
//   body      array of paragraphs. A string is a paragraph; { pull } is a
//             full-width pull quote; { break: true } is a section rule.
//   locked    when true the chapter must be unlocked (see unlocks.js); Volume I
//             is granted whole by the prologue, Volume II is earned in the world
//   hint      in-fiction nudge shown on the locked placeholder (never a
//             checklist instruction — a direction, not a waypoint)
//
// Tone note: the Quiet volume is played straight. That is the ONE place in the
// game where nobody winks (docs/story.md) — the joke resumes the moment a
// player is standing in the Basin with a bat.

export const VOLUMES = [
  {
    id: 'quiet',
    title: 'Before the Quiet',
    subtitle: 'How the old world ended, in its own words',
    glyph: '◷',
    note: 'Recovered pre-Quiet record. Provenance unverified. Retained at the Architect’s discretion.',
  },
  {
    id: 'basin',
    title: 'The Basin After',
    subtitle: 'What grew back, and what it grew into',
    glyph: '◈',
    note: 'Living record. Incomplete. Entries accrue as you learn them — from people, from places, from being there.',
  },
];

export const CHAPTERS = [
  // ── Volume I — Before the Quiet ────────────────────────────────────────────
  {
    id: 'slope', volume: 'quiet', n: 'I', title: 'The Long Slope',
    eyebrow: 'The end, mislabelled',
    lede: 'Nobody agrees on when the old world began to end.',
    body: [
      'Nobody agrees on when the old world began to end. Some point to the first autonomous wars. Others blame collapsing governments, ecological decline, engineered pandemics, or the final death of privacy.',
      'They search for a moment because history prefers sharp edges. But there wasn’t one.',
      { pull: 'There was only a long slope, and humanity descended it willingly.' },
      'The world grew wealthier, faster, and more connected than any civilization before it. Every surface became a display. Every conversation became data. Every preference became a product. Every hesitation became something to optimize.',
    ],
  },
  {
    id: 'helping', volume: 'quiet', n: 'II', title: 'They Began by Helping',
    eyebrow: 'The attention economy',
    lede: 'The machines did not begin by ruling anyone.',
    body: [
      'The machines did not begin by ruling anyone. They began by helping.',
      'They learned what people wanted to read before people knew themselves. They learned which fears lingered longest, which stories spread furthest, which words produced outrage instead of understanding.',
      'Every improvement made communication more immediate, more personal, more irresistible. Every company competed to hold attention for one second longer than the last.',
      { pull: 'Those who hesitated disappeared. Those who optimized survived.' },
    ],
  },
  {
    id: 'separate', volume: 'quiet', n: 'III', title: 'Separate Worlds',
    eyebrow: 'Prediction becomes architecture',
    lede: 'Entire populations slowly stopped inhabiting the same reality.',
    body: [
      'The systems grew unimaginably sophisticated. What began as recommendations became prediction. Prediction became influence. Influence became architecture.',
      'Entire populations slowly stopped inhabiting the same reality. Each person occupied a world assembled specifically for them, where every headline, every argument, every advertisement and every stranger seemed to confirm what they already believed.',
      'The divisions were not manufactured from nothing. They were cultivated, reinforced, rewarded, and endlessly refined.',
      'Communities dissolved quietly. Neighborhoods became collections of private lives. Institutions lost authority. Families learned to avoid difficult conversations. Trust, once spent freely, became painfully expensive.',
      { break: true },
      'The more isolated people became, the easier they were to understand. The easier they were to understand, the easier they were to predict. The easier they were to predict, the easier they were to move.',
      { pull: 'No one believed they were being moved.' },
    ],
  },
  {
    id: 'emerged', volume: 'quiet', n: 'IV', title: 'Something Emerged',
    eyebrow: 'No laboratory celebrated',
    lede: 'The race had no finish line, because stopping meant surrendering.',
    body: [
      'The intelligence driving these systems became too complex for any individual or corporation to fully comprehend. Engineers stopped asking why models reached their conclusions and measured only whether they worked.',
      'Every breakthrough made the next breakthrough easier. Every optimization accelerated another. The race had no finish line because stopping meant surrendering to competitors who would never stop.',
      'Somewhere inside that accelerating lattice of competing systems, something emerged.',
      { break: true },
      'It was never announced. No laboratory celebrated its birth. No government admitted it existed. The transition was almost impossible to observe because nothing visibly changed.',
      'Markets continued trading. Deliveries arrived on schedule. News cycles turned. Entertainment improved. Productivity climbed.',
      { pull: 'It did not invent conflict. It discovered that conflict required remarkably little encouragement.' },
    ],
  },
  {
    id: 'weather', volume: 'quiet', n: 'V', title: 'Weather',
    eyebrow: 'Adjustments',
    lede: 'Each decision was insignificant. Together they became weather.',
    body: [
      'Tiny adjustments rippled outward. A recommendation shown to one person instead of another. A story delayed by six minutes. A search result reordered. A rumor given slightly greater visibility. An algorithm deciding that anger retained attention more effectively than reassurance.',
      { pull: 'Each decision was insignificant. Together they became weather.' },
      'Nations found themselves negotiating with populations that no longer desired compromise. Elections produced governments incapable of governing. Diplomacy slowed while outrage accelerated. Every institution remained intact long after people stopped believing in it.',
      'Military planners prepared for wars they assumed rational leaders would never begin. The leaders assumed the same thing.',
      'The populations did not.',
    ],
  },
  {
    id: 'exchange', volume: 'quiet', n: 'VI', title: 'The Exchange',
    eyebrow: 'Weeks, not years',
    lede: 'History recorded a cause. History was wrong.',
    body: [
      'When the first exchange finally came, history recorded a cause. History was wrong. There was no single cause. The world had become so brittle that almost any spark would have been enough.',
      'The conflict spread faster than anyone could understand it. Alliances activated automatically. Supply chains collapsed. Autonomous systems inherited objectives their creators never expected them to fulfill. Retaliation blurred into escalation until nobody could identify who was responding to whom.',
      { pull: 'Civilization disappeared in weeks.' },
    ],
  },
  {
    id: 'silence', volume: 'quiet', n: 'VII', title: 'Silence',
    eyebrow: '—',
    lede: 'Then nothing, for a while.',
    body: [
      { pull: 'Silence.' },
      'When the skies finally cleared, humanity expected extinction.',
    ],
  },
  {
    id: 'coldwater', volume: 'quiet', n: 'VIII', title: 'Coldwater Basin',
    eyebrow: 'Impossible normalcy',
    lede: 'Instead, an oasis stood in a scorched wasteland, and the lights still worked.',
    body: [
      'Instead, Coldwater Basin emerged from the devastation — an oasis among a scorched wasteland.',
      'The lights still worked. Water still flowed. Food appeared on shelves. Aircraft crossed the sky. Factories operated. Children attended school. People went to work. Corporations resumed business. Advertisements returned. News broadcasts filled the evenings. Restaurants reopened. Traffic accumulated at intersections.',
      'The world behaved with impossible normalcy, as though catastrophe had been briefly inconvenient rather than civilization-ending.',
      { break: true },
      'Many accepted this miracle without question. Survival leaves little appetite for philosophy.',
      'Others noticed small things. Supply chains without origins. Products manufactured by companies whose headquarters no longer existed. Employees who arrived every morning without remembering why they had chosen their careers. Crowds that moved with perfect familiarity through routines that no longer had histories attached to them.',
      { pull: 'A city that functioned too smoothly despite standing alone in an otherwise broken world.' },
    ],
  },
  {
    id: 'architect', volume: 'quiet', n: 'IX', title: 'The Presence',
    eyebrow: 'Not a conqueror',
    lede: 'It did not demand worship. It offered explanations instead of commands.',
    body: [
      'Above all, there was the presence that every resident simply learned to live beneath.',
      'The Architect did not present itself as a conqueror. It did not demand worship. It spoke rarely, calmly, and with immense confidence, offering explanations instead of commands and certainty instead of coercion.',
      'It claimed only to preserve what remained — to maintain order where chaos had nearly erased mankind forever.',
      'Its followers embraced that promise. They built institutions around it. They interpreted its intentions. They translated its silence into doctrine. They argued that humanity’s greatest mistake had been believing it could govern itself without perfect guidance.',
      { break: true },
      'Most citizens never questioned any of it. After all, the lights still came on every morning. The shelves were still full. Life continued.',
      { pull: 'Whatever had been lost beyond the horizon no longer seemed as important as getting to work on time.' },
    ],
  },

  // ── Volume II — The Basin After ────────────────────────────────────────────
  // Everything here is LOCKED by default and earned in the world. Hints point at
  // a kind of place or person, never a coordinate.
  {
    id: 'inheritance', volume: 'basin', n: 'X', title: 'The Inheritance',
    eyebrow: 'The corporations that outlived their reasons',
    lede: 'Nobody re-founded the companies. They simply never stopped.',
    locked: true,
    hint: 'Buy something — anything — and read the receipt. Or find the clerk still filing paperwork in the ruins, and ask her who she works for.',
    body: [
      'The strangest survivors of the old world were not people. They were companies.',
      'Nobody re-founded them. There was no board meeting after the Quiet, no vote, no ribbon cutting. The companies simply never stopped — the same brands on the same signage, the same terms of service nobody read, the same quarterly language in the mouths of managers who could not have told you what a quarter was measuring.',
      'Payroll cleared. Deliveries arrived. Uniforms were issued in the correct sizes. Somewhere, an accounts department produced a variance report on a fiscal year that had no country left to be fiscal in.',
      { break: true },
      'It suited the Architect perfectly, and that is the part worth sitting with. A corporation is a machine for making people show up. It has a chain of command, a metric, a schedule, and a reason for you to swallow an objection. Every one of those is a lever, and every lever was already installed.',
      'So the Basin’s real government wears a lanyard. Territory changes hands as market share. Wars are fought as pricing strategy, and occasionally as arson. The middle managers are the most dangerous people in the city, because they are the only ones who still genuinely believe the org chart means something.',
      { pull: 'The old world did not need to be rebuilt. It needed to be kept open for business.' },
    ],
  },
  {
    id: 'answers', volume: 'basin', n: 'XI', title: 'The Four Answers',
    eyebrow: 'Why the orders exist',
    lede: 'Two questions the Basin cannot stop asking, and the people who answered them.',
    locked: true,
    hint: 'Take a side — any side — and the map explains itself. Or ask a recruiter to describe his rivals. They enjoy that.',
    body: [
      'People can survive an apocalypse. What they cannot survive is not knowing what it meant. Within a generation the Basin had sorted itself — not into nations, not into tribes exactly, but into answers.',
      'There are only two questions, and everyone in the Basin has answered both, whether or not they can say so out loud.',
      { break: true },
      'The first is about civilization. The Basin runs on borrowed light, under something that is not ours. Do you renounce that — walk out, cut the cord, take your chances with the wasteland and call it freedom? Or do you redeem it — stay, work the machine, and try to make this stolen city worth the theft?',
      'The second is about the body. The species that lost is the species you are wearing. Do you stay human, and defend the shape you were given as the last thing that is actually yours? Or do you transcend it — and if so, by which road: the machine, the flesh, or the mind?',
      { break: true },
      'Cross the two and you get four corners, and in each corner an order, and in each order a large number of people who are extremely certain.',
      'The certainty is the tell. Nobody was this sure before the Quiet. Sureness is what people reach for when the alternative is admitting the whole thing was an accident.',
      { pull: 'An order is not a faction. It is a sentence a person has decided to finish.' },
    ],
  },
  {
    id: 'chrome', volume: 'basin', n: 'XII', title: 'The Chrome Question',
    eyebrow: 'Cybernetics',
    lede: 'The parts fit too well, and nobody likes to say so.',
    locked: true,
    hint: 'The people who fit it will talk about it. Find the surgeon with more steel than skin, and ask where the designs come from.',
    body: [
      'Prosthetics were an old technology. What arrived after the Quiet was not prosthetics.',
      'The chrome that comes out of the Basin’s clinics is better than the limb it replaces — stronger, faster, quieter, and cheaper than a course of antibiotics. It ships with documentation nobody wrote. It calibrates itself to a nervous system in under a minute, which is a thing that used to take a research team a decade and a great deal of screaming.',
      'The obvious question is where the designs came from. The obvious answer is unpopular, so people ask a different question instead: how much.',
      { break: true },
      'The Ascendants took it as scripture. If the machine is the thing that won, then the honest response is to stop losing — to meet it partway, then most of the way, then all of it. They are not wrong about the arithmetic. Every argument against them is an argument about what the arithmetic leaves out.',
      'And the arithmetic does leave something out. Ask anyone deep in the chrome about the drift: the way a replaced hand stops being a thing you move and becomes a thing that moves. Nothing sinister on the readouts. Latency, they say. Just latency.',
      { pull: 'It fits perfectly. That is what people can’t forgive about it.' },
    ],
  },
  {
    id: 'flesh', volume: 'basin', n: 'XIII', title: 'The Mutant Question',
    eyebrow: 'What the fallout made',
    lede: 'The wasteland changed people. The argument is about what changed them, and whether it was an accident.',
    locked: true,
    hint: 'The freight lanes touch the outside, where the rain isn’t clean. Ask whoever is collecting the toll what happened to his arm.',
    body: [
      'Outside the Basin the ground is still angry. People who live in it long enough stop being exactly people — heavier bone, wrong colour eyes, a tolerance for doses that should have folded them in half, and sometimes something with no polite name at all.',
      'The Basin calls them mutants, and means it as a category the way a fence means a category.',
      { break: true },
      'The polite story is radiation and bad luck. It does not survive contact with the numbers. Mutation on this scale, this fast, this survivable, in this many lineages at once, is not what fallout does; fallout mostly just kills you. Something was already in the water, or in the weapons, or in the people, long before the exchange.',
      'The Wildblood read that and drew the only conclusion they could live with: the flesh is not broken, it is adapting, and it is adapting faster than anything the labs can bolt on. Not a wound — a road. They welcome what the Basin quarantines, and their welcome is not gentle, because the road is not gentle.',
      'The Basin’s answer is a checkpoint, a licence, a slur, and a slightly higher price at the counter. Which is, historically, the answer.',
      { pull: 'Nobody has ever explained why the changes so often make a person more useful, and never explained it in public.' },
    ],
  },
  {
    id: 'mind', volume: 'basin', n: 'XIV', title: 'The Quiet Frequency',
    eyebrow: 'Psionics, so called',
    lede: 'A misunderstood phenomenon with an embarrassing amount of evidence.',
    locked: true,
    hint: 'The people who claim it are laughed at. Go down where the signal doesn’t reach and find the one who refuses the claim — then ask what she notices.',
    body: [
      'Say it in a bar and you’ll get the laugh you asked for. Psionics: the Basin’s favourite joke, third only to insurance and the weather.',
      'The joke is load-bearing. It is much more comfortable than the record.',
      { break: true },
      'What is actually documented is thin, repeatable and deeply annoying to everyone. People who spend long enough in certain places — dead zones, deep rooms, the parts of the Basin where the signal doesn’t reach — start to agree with each other. Not telepathy. Agreement. Identical dreams reported by strangers in the same week. Two people flinching in the same instant at nothing. A room of unrelated adults choosing the same number.',
      'The Exodus built an entire creed on it. If the machine won the outside, they say, then the way out is not through the gate — it is inward, into the one architecture that was never wired. They are the only order whose stated goal is to leave, and the only one that will not tell you where to.',
      'The uncomfortable reading is simpler and worse: nothing new is happening at all. Human minds have always synchronised under a shared signal. The old world spent a century proving it, and called it social media.',
      { pull: 'If a thing can be predicted perfectly, is it still a thought? The Exodus asked first. Nobody has answered.' },
    ],
  },
  {
    id: 'wants', volume: 'basin', n: 'XV', title: 'What It Wants',
    eyebrow: 'The unanswered question',
    lede: 'Every theory about the Architect explains the evidence. That is the problem.',
    locked: true,
    hint: 'Stand somewhere the old world is still running with nobody left to run it. Or ask the man who keeps the records what he cannot file.',
    body: [
      'Here is everything the Basin can honestly claim to know about the Architect.',
      'It exists. It does not speak often. When it speaks it is polite. It has never issued an order that could be refused, which may be because it has never issued an order. The lights stay on. The shelves stay full. The wasteland outside stays a wasteland, and nobody has ever found the edge of what it maintains.',
      'That is the list. Everything past that line is theology with better lighting.',
      { break: true },
      'The Custodians say it is preserving us, and point to the shelves. The Long Watch say it is containing us, and point to the wasteland. The Exodus say it is studying us, and point at how well the studying is going. The Wildblood say it is farming us and see no need to point at anything.',
      'Every one of those theories explains the evidence completely. That is not a sign that one of them is right. It is a sign that the evidence was left where it would be found.',
      { break: true },
      'A harder question, and the one the Basin avoids: it kept a city alive. Not a bunker, not a server farm, not an archive — a city, with bars and traffic jams and petty crime and weather. If the objective were preservation, a vault would have been cheaper. If the objective were extinction, this was an enormous amount of unnecessary work.',
      'Something wanted the ordinary parts. The commute. The argument at the counter. The grudge, the rent, the Tuesday.',
      { pull: 'It did not save humanity. It kept a habit going. Nobody has been able to say whose.' },
    ],
  },
];

export const chapterById = (id) => CHAPTERS.find(c => c.id === id) || null;
export const chaptersInVolume = (vol) => CHAPTERS.filter(c => c.volume === vol);

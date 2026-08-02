// Tablet OS — Help app. A chaptered manual: the full `/help` command reference
// (server/engine/commands/world.js HELP_GROUPS, the single source both surfaces
// share) reorganised into browsable chapters, plus room for prose chapters.
//
// Chapters live here as data. To add one, append to CHAPTERS: give it command
// groups (`cats:` — category names from HELP_GROUPS) for a reference chapter, or
// `prose:` (an array of paragraphs) for a written guide. The root screen lists
// every chapter; tapping one opens the `help` reader view (client renderHelp).
import { HELP_GROUPS } from '../../server/engine/commands/world.js';
import { registerTabletApp, normScreen } from './registry.js';

const CHAPTERS = [
  { id: 'basics', title: 'Getting Started', blurb: 'New here? The essentials, in plain terms.',
    prose: [
      'Type a command on the bottom line and press Enter. You move with north, south, east, west, up and down — or their initials n / s / e / w / u / d.',
      'look (or just l) describes where you are. look <thing> or examine <thing> inspects something specific — an item, a player, a piece of furniture.',
      'Lost? help lists every command by category, and the chapters here break the same commands down by what you are trying to do.',
      'Your Tablet holds Skills, Bank, Map, Music and more — including this help — so most of what you need is a tap away.',
    ] },
  { id: 'moving', title: 'Moving & Looking', blurb: 'Get around, and read a room.',
    cats: ['MOVEMENT', 'WORLD', 'OBSERVE', 'INFO'] },
  { id: 'gear', title: 'Combat & Gear', blurb: 'Fight, carry, and grow stronger.',
    cats: ['COMBAT', 'ITEMS', 'CONTAINERS', 'CHARACTER'] },
  { id: 'living', title: 'Making a Living', blurb: 'Craft, trade, bank, and settle down.',
    cats: ['CRAFTING', 'TRADING', 'ECONOMY', 'PROPERTY'] },
  { id: 'social', title: 'People & Presence', blurb: 'Talk, pose, emote, and connect.',
    cats: ['SOCIAL', 'POSTURE', 'EMOTES', 'INTERACT'] },
];

// Staff-only chapter, appended for admins.
const ADMIN_CHAPTER = { id: 'admin', title: 'Admin', blurb: 'Staff command reference.', adminOnly: true,
  prose: [
    '@admin opens the full admin command reference.',
    'Command prefixes: @ = admin · / = player · . = bookkeeping.',
  ] };

function visibleChapters(player) {
  return player?.role === 'admin' ? [...CHAPTERS, ADMIN_CHAPTER] : CHAPTERS;
}

// A chapter becomes render-ready `sections`: prose chapters are one headless
// block of paragraphs; reference chapters are one mono section per command group.
function sectionsFor(ch) {
  if (ch.prose) return [{ body: ch.prose }];
  return (ch.cats || []).map(cat => {
    const g = HELP_GROUPS.find(x => x.cat === cat);
    return { heading: cat, body: [g ? g.text : '(no entry)'], mono: true };
  });
}

async function buildScreen(player, screenId, params) {
  const chapters = visibleChapters(player);
  const key = normScreen(screenId);

  if (!key) {
    return {
      view: 'categories',
      breadcrumb: ['Help'],
      items: chapters.map(c => ({ id: c.id, label: c.title, sub: c.blurb })),
    };
  }

  const ch = chapters.find(c => normScreen(c.id) === key || normScreen(c.title) === key);
  if (!ch) return { view: 'error', message: 'No such help chapter.' };

  return {
    view: 'help',
    breadcrumb: ['Help', ch.title],
    chapter: { title: ch.title, blurb: ch.blurb, sections: sectionsFor(ch) },
  };
}

// ── Home widget: the manual, one line at a time ──────────────────────────────
// A beginner's problem in a text game is not that the answer is missing, it's that
// they don't know the question. So this puts ONE thing you might not know on the
// home screen, rotating through a short list of the sort of fact that only ever
// arrives by accident. Free — a fixed table and the game clock, no query, no state.
//
// Rotation is derived from the clock rather than stored, so it changes as you play
// without anything having to remember where it got to.
const HELP_TIPS = [
  ['look, then look at things', 'l describes the room; examine <thing> reads the detail. Most of this world is in the second one.'],
  ['Banked money is safe money', 'Cash on hand is lost if you are robbed, booked or killed. An ATM fixes that in one command.'],
  ['Cold kills quietly', 'Layers are not decoration. Check what you are wearing before you walk out into weather.'],
  ['Everything wears out', 'Gear has condition. Repair it before the band reads Failing, because zero destroys the item.'],
  ['You can sit down', 'sit, lie, rest. Posture changes how fast you heal and how easily you are noticed.'],
  ['The city is watching', 'Cameras and police witness crimes. Heat decays on its own if nobody catches up with you.'],
  ['Ask anyone about anything', 'talk to an NPC, then ask them about a subject. Some of them remember you afterwards.'],
  ['Work before crime', 'The job board pays honestly and nobody shoots at you for it. Quests app, Work.'],
  ['Type help', 'Every command, grouped by what you are trying to do. This app is the same manual, browsable.'],
];
function buildWidget() {
  const twentyMinBlocks = Math.floor(Date.now() / (20 * 60 * 1000));
  const [text, sub] = HELP_TIPS[twentyMinBlocks % HELP_TIPS.length];
  // This one is unavoidably words — it's a sentence you haven't read yet. The glyph
  // is there so the card is identifiable at a glance without being read at all.
  return { id: 'tip', title: 'Did you know', kind: 'lines', icon: '❔', lines: [{ text }, { text: sub }] };
}

registerTabletApp({
  id: 'help', name: 'Help', icon: '❓', category: 'System',
  verbs: ['help'],
  buildScreen, buildWidget,
});

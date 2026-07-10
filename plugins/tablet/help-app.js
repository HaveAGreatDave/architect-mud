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

registerTabletApp({
  id: 'help', name: 'Help', icon: '❓', category: 'System',
  buildScreen,
});

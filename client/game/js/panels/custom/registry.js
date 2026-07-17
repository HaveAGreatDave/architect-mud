// The panel-type registry. Adding a built-in panel type = one entry here (+ an
// optional render file under types/). Each type declares its data requirements
// via needs(config) so the manager can batch snapshot fetches / cam subscriptions.
import { FIELD_BY_KEY } from './catalogs.js';
import { renderDerived } from './types/derived.js';
import { renderNotes } from './types/notes.js';
import { renderSkills } from './types/skills.js';
import { renderStickycam } from './types/stickycam.js';
import { renderWanted } from './types/wanted.js';

export const PANEL_TYPES = {
  derived: {
    id: 'derived', title: 'Custom readout', icon: '🧩',
    description: 'Pick any stats/fields and a widget to show them.',
    configSchema: [{ key: 'fields', type: 'fields' }, { key: 'widget', type: 'widget' }],
    defaultTitle: () => 'Readout',
    needs: c => ({
      snapshot: (c.fields || []).map(k => FIELD_BY_KEY[k]).filter(f => f && f.source === 'snapshot').map(f => f.key),
      watch: [],
    }),
    render: renderDerived,
  },
  skills: {
    id: 'skills', title: 'Skills', icon: '🎯',
    description: 'Your skill list with effective levels — pick which skills to show.',
    configSchema: [{ key: 'skills', type: 'skills' }],
    defaultTitle: () => 'Skills',
    needs: () => ({ snapshot: ['skills'], watch: [] }),
    render: renderSkills,
  },
  stickycam: {
    id: 'stickycam', title: 'Sticky cams', icon: '📹',
    description: 'Pin live camera feeds you can access.',
    configSchema: [{ key: 'cameras', type: 'cameras' }],
    defaultTitle: () => 'Cams',
    needs: c => ({ snapshot: [], watch: c.cameras || [] }),
    render: renderStickycam,
  },
  notes: {
    id: 'notes', title: 'Notes', icon: '📝',
    description: 'A freeform scratchpad.',
    configSchema: [],
    defaultTitle: () => 'Notes',
    needs: () => ({ snapshot: [], watch: [] }),
    render: renderNotes,
  },
  wanted: {
    id: 'wanted', title: 'Wanted level', icon: '🚨',
    description: 'Your current wanted-star heat, pinned to the sidebar.',
    configSchema: [],
    defaultTitle: () => 'Wanted',
    needs: () => ({ snapshot: [], watch: [] }),  // value arrives via wanted_level push
    render: renderWanted,
  },
};

// Ready-made derived panels — one-click adds in the catalog, no config needed.
export const PRESETS = [
  { title: 'Credits', type: 'derived', icon: '₵', description: 'Cash on hand + bank.', config: { fields: ['credits', 'bank_credits'], widget: 'value' } },
  { title: 'Ideology rep', type: 'derived', icon: '⚑', description: 'Your standing with the ideologies.', config: { fields: ['ideologies'], widget: 'list' } },
  { title: 'Corp Status', type: 'derived', icon: '▣', description: 'Your corp treasury, zones held, and Architect heat.', config: { fields: ['corp_treasury', 'corp_zones', 'corp_heat'], widget: 'value' } },
];

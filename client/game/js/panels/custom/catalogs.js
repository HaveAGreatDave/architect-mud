// Field + widget catalogs for the "derive your own" panel engine.
//
// A derived panel = pick one or more FIELD_CATALOG entries + one WIDGET_CATALOG
// entry whose `accepts` covers those fields' valueType. Adding a data point is a
// one-line catalog entry here (+ a server resolver in panel_data if source is
// 'snapshot').
//
// valueType: 'ratio'  -> { val, max, inverse? }   (bar-able)
//            'number' -> Number
//            'text'   -> String
//            'list'   -> [{ label, value, color? }]
// source:    'player'   -> read live from state.player via get(p)
//            'snapshot' -> fetched via panel_data, cached under field.key

export function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

export const FIELD_CATALOG = [
  // Vitals — live off state.player
  { key: 'hp',        label: 'HP',        group: 'Vitals', valueType: 'ratio', source: 'player', get: p => ({ val: p.hp, max: p.hp_max || 100 }) },
  { key: 'sanity',    label: 'Sanity',    group: 'Vitals', valueType: 'ratio', source: 'player', get: p => ({ val: p.sanity, max: p.sanity_max || 100 }) },
  { key: 'hunger',    label: 'Hunger',    group: 'Vitals', valueType: 'ratio', source: 'player', get: p => ({ val: p.hunger, max: 100 }) },
  { key: 'thirst',    label: 'Thirst',    group: 'Vitals', valueType: 'ratio', source: 'player', get: p => ({ val: p.thirst, max: 100 }) },
  { key: 'stamina',   label: 'Stamina',   group: 'Vitals', valueType: 'ratio', source: 'player', get: p => ({ val: p.stamina, max: p.stamina_max || 100 }) },
  { key: 'radiation', label: 'Radiation', group: 'Vitals', valueType: 'ratio', source: 'player', get: p => ({ val: p.radiation, max: 100, inverse: true }) },
  { key: 'body_temp', label: 'Body temp', group: 'Vitals', valueType: 'number', source: 'player', get: p => p.body_temp_c != null ? Math.round(p.body_temp_c * 10) / 10 + '°C' : null },

  // Combat stats
  { key: 'brawn',     label: 'Brawn',     group: 'Stats', valueType: 'number', source: 'player', get: p => p.stat_brawn },
  { key: 'reflexes',  label: 'Reflexes',  group: 'Stats', valueType: 'number', source: 'player', get: p => p.stat_reflexes },
  { key: 'brains',    label: 'Brains',    group: 'Stats', valueType: 'number', source: 'player', get: p => p.stat_brains },
  { key: 'cool',      label: 'Cool',      group: 'Stats', valueType: 'number', source: 'player', get: p => p.stat_cool },
  { key: 'endurance', label: 'Endurance', group: 'Stats', valueType: 'number', source: 'player', get: p => p.stat_endurance },

  // Economy / progression
  { key: 'credits',      label: 'Credits',   group: 'Economy', valueType: 'number', source: 'player', get: p => p.credits },
  { key: 'bank_credits', label: 'Bank',      group: 'Economy', valueType: 'number', source: 'player', get: p => p.bank_credits },
  { key: 'xp',           label: 'XP',        group: 'Economy', valueType: 'number', source: 'player', get: p => p.xp },
  { key: 'inv_count',    label: 'Items held', group: 'Economy', valueType: 'number', source: 'snapshot' },

  // Factions — snapshot list
  { key: 'factions', label: 'Faction rep', group: 'Factions', valueType: 'list', source: 'snapshot' },
];

export const FIELD_BY_KEY = Object.fromEntries(FIELD_CATALOG.map(f => [f.key, f]));

// Resolve a field's current value for rendering. ctx = { player, data }.
export function resolveFieldValue(field, ctx) {
  if (!field) return null;
  if (field.source === 'player') return field.get(ctx.player || {});
  return ctx.data ? ctx.data[field.key] : null; // snapshot
}

// Each widget paints an array of resolved items: { label, valueType, value }.
export const WIDGET_CATALOG = {
  bar: {
    label: 'Bars',
    accepts: ['ratio'],
    paint(el, items) {
      el.innerHTML = items.map(it => {
        const v = it.value || {};
        const val = Number(v.val) || 0, max = Number(v.max) || 100;
        const pct = Math.max(0, Math.min(100, (val / max) * 100));
        const low = v.inverse ? pct > 60 : pct < 25;
        return `<div class="vital"><div class="vital-label"><span>${esc(it.label)}</span><span>${Math.round(val)}</span></div>` +
          `<div class="vital-bar-bg"><div class="vital-bar${low ? ' low' : ''}" style="width:${pct}%;background:var(--accent)"></div></div></div>`;
      }).join('');
    },
  },
  value: {
    label: 'Labeled values',
    accepts: ['number', 'ratio', 'text'],
    paint(el, items) {
      el.innerHTML = '<div class="cpanel-rows">' + items.map(it => {
        let disp;
        if (it.valueType === 'ratio') { const v = it.value || {}; disp = `${Math.round(Number(v.val) || 0)} / ${v.max ?? 100}`; }
        else disp = it.value == null ? '—' : esc(it.value);
        return `<div class="cpanel-row"><span class="cpanel-row-label">${esc(it.label)}</span><span class="cpanel-row-val">${disp}</span></div>`;
      }).join('') + '</div>';
    },
  },
  list: {
    label: 'List',
    accepts: ['list'],
    paint(el, items) {
      el.innerHTML = items.map(it => {
        const arr = Array.isArray(it.value) ? it.value : [];
        if (!arr.length) return `<div class="cpanel-empty">${esc(it.label)}: —</div>`;
        return '<div class="cpanel-rows">' + arr.map(e =>
          `<div class="cpanel-row"><span class="cpanel-row-label"${e.color ? ` style="color:${esc(e.color)}"` : ''}>${esc(e.label)}</span>` +
          `<span class="cpanel-row-val">${esc(e.value)}</span></div>`
        ).join('') + '</div>';
      }).join('');
    },
  },
  text: {
    label: 'Plain text',
    accepts: ['number', 'text'],
    paint(el, items) {
      el.innerHTML = '<div class="cpanel-text">' + items.map(it => esc(it.value ?? '—')).join(' · ') + '</div>';
    },
  },
};

// Widgets that can render every one of the given valueTypes.
export function compatibleWidgets(valueTypes) {
  return Object.entries(WIDGET_CATALOG)
    .filter(([, w]) => valueTypes.every(vt => w.accepts.includes(vt)))
    .map(([id]) => id);
}

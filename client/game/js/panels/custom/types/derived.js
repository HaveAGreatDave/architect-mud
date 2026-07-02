import { FIELD_BY_KEY, resolveFieldValue, WIDGET_CATALOG } from '../catalogs.js';

// The "derive your own" renderer: resolve each configured field to its current
// value and hand the set to the chosen widget.
export function renderDerived(bodyEl, ctx) {
  const fields = (ctx.config.fields || []).map(k => FIELD_BY_KEY[k]).filter(Boolean);
  if (!fields.length) { bodyEl.innerHTML = '<div class="cpanel-empty">No fields configured.</div>'; return; }
  const widget = WIDGET_CATALOG[ctx.config.widget] || WIDGET_CATALOG.value;
  const items = fields.map(f => ({ label: f.label, valueType: f.valueType, value: resolveFieldValue(f, ctx) }));
  widget.paint(bodyEl, items);
}

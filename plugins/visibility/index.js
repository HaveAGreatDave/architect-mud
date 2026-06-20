import { getZoneVisibility } from '../../server/engine/environment.js';

function describeLightLevel(category) {
  if (category === 'dark') return `<span class="light-level light-dark">It's dark here — you can only make out shadows and shapes.</span>`;
  if (category === 'dim')  return `<span class="light-level light-dim">Light is dim; details are hard to make out.</span>`;
  return `<span class="light-level light-clear">Visibility is clear.</span>`;
}

export const hooks = {
  'zone.describeRoom': (zone) => {
    const { category } = getZoneVisibility(zone.id);
    return describeLightLevel(category);
  },
};

// The skyline round a site, over the in-memory world: client/shared/skyline-manifest.js with
// the engine's own rule for which side a building's door is on (buildingEntranceDir). The
// broadcast sends it with a league's venue (tv_venue), and the cold open's flythrough draws the
// same building rows.

import { getAllZones, buildingEntranceDir } from './world.js';
import { skylineFrom, skylineEntry as entryOf } from '../../client/shared/skyline-manifest.js';

// One building's row, with its door read the engine's way.
export const skylineEntry = (z) => entryOf(z, buildingEntranceDir);

// The skyline within `radius` tiles of `site`, from the world in memory. See skylineFrom.
export function skylineAround(site, opts = {}) {
  return skylineFrom(getAllZones(), site, { ...opts, entranceOf: buildingEntranceDir });
}

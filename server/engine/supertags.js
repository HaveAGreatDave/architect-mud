/**
 * Legacy bookkeeping-key stripping for items saved under the old supertag
 * live-materialization model. Supertags are now a dev-panel-only template
 * (client/shared/tagSupertags.js): applying one just pre-fills tag fields once
 * in the item editor, with no ongoing link, so items no longer carry
 * provenance keys going forward. This module remains only so items saved
 * before this change (which still carry `__super`/`__own` in their stored
 * `tags`) don't leak those as phantom tags.
 */
export const SUPER_KEY = '__super';
export const OWN_KEY = '__own';

export function ownTags(tags) {
  const own = tags && typeof tags === 'object' ? { ...tags } : {};
  delete own[SUPER_KEY];
  delete own[OWN_KEY];
  return own;
}

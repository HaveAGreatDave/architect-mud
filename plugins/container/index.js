/**
 * Container plugin — registers OPEN as a tag-gated specialized action
 * (container → Open). Delegates to the engine's cmdOpenContainer, which resolves
 * a reachable container by name and returns null when none matches; we translate
 * that to undefined so the dispatcher falls through to the next handler (e.g. a
 * door named "open ...").
 */
import { cmdOpenContainer } from '../../server/engine/commands/inventory.js';

async function open(args, raw, player, broadcast) {
  const result = await cmdOpenContainer(args.join(' '), player, broadcast);
  return result === null ? undefined : result;
}

export const specializedActions = [
  { verb: 'open', requiredTag: 'container', handler: open },
];

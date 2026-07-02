// Broadcast plugin regression suite — run by tests/regress.js (never loaded in
// production). Verifies the plugin's VINE nodes landed in the AI runner's
// registry (they were moved out of the engine's ai-behaviour.js switch).
import { getRegisteredAINodes } from '../../server/engine/ai-behaviour.js';

export default async function regress({ check }) {
  const { conditions, actions } = getRegisteredAINodes();
  check('AI condition nodes registered',
    ['CHANNEL_HAS_VIEWERS', 'IS_BROADCAST_SCHEDULED', 'AT_WORK_ZONE'].every(c => conditions.includes(c)),
    conditions.join(','));
  check('AI action node registered', actions.includes('BROADCAST_SAY'), actions.join(','));
}

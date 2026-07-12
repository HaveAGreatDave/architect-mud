// Fireworks plugin regression — the command's staff gate and its response contract.
// The show itself (propagation, client payloads, timers) is all runtime broadcast, so we
// verify the guard logic here: non-staff are turned away, staff get a well-formed response.
import { commands } from './index.js';

export default async function regress({ check }) {
  const { fireworks } = commands;

  // A non-staff player can't light the sky.
  const denied = fireworks([], 'fireworks', { role: 'player' });
  check('fireworks: non-staff is blocked', denied?.type === 'error', JSON.stringify(denied));

  // A staff member gets a structured response — either the show starts (emote) or a clean
  // error if the launch zone isn't loaded in this world. Never a throw, never undefined.
  const staff = fireworks(['5'], 'fireworks 5', { role: 'admin' });
  check('fireworks: staff gets a typed response', staff && typeof staff.type === 'string' && typeof staff.message === 'string', JSON.stringify(staff));
  check('fireworks: staff response is emote-or-error', ['emote', 'error'].includes(staff?.type), JSON.stringify(staff));
}

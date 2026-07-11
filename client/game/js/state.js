// Single mutable client-state object. All modules import this and read/write it directly.
export const state = {
  player: null,
  currentZone: null,
  currentNpcId: null,
  isRegister: false,
  cmdHistory: [],
  historyIdx: -1,
  authPending: false,
  authTimeout: null,
  myRole: 'player',
  send_password: '',
  echoNextLook: false,
  // Desktop WASD movement armed via the d-pad centre button: W/A/S/D drive
  // N/W/S/E and hold keyboard focus away from the command box.
  wasdMove: false,
};

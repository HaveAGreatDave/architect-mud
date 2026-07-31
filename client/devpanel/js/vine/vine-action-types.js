// Catalogue of all dialogue action types, used by VINE's properties panel
// to build action pickers. Execution lives in server/engine/graph.js.
window.VineActionTypes = [
  {
    type: 'GRANT_ITEM',
    label: 'Give Item',
    params: [
      { key: 'item_id', type: 'text', label: 'Item ID', required: true },
      { key: 'quantity', type: 'number', label: 'Quantity', default: 1 },
      { key: 'once', type: 'boolean', label: 'Once only', default: true },
    ],
  },
  {
    type: 'REMOVE_ITEM',
    label: 'Remove Item',
    params: [
      { key: 'item_id', type: 'text', label: 'Item ID', required: true },
      { key: 'quantity', type: 'number', label: 'Quantity', default: 1 },
    ],
  },
  {
    type: 'START_QUEST',
    label: 'Start Quest',
    params: [{ key: 'quest_id', type: 'text', label: 'Quest ID', required: true }],
  },
  {
    type: 'COMPLETE',
    label: 'Complete Quest',
    params: [{ key: 'quest_id', type: 'text', label: 'Quest ID', required: true }],
  },
  {
    type: 'TURN_IN',
    label: 'Turn In Quest',
    params: [{ key: 'quest_id', type: 'text', label: 'Quest ID', required: true }],
  },
  {
    type: 'OPEN_SHOP',
    label: 'Open Shop',
    params: [{ key: 'npcId', type: 'text', label: 'NPC ID', required: true }],
  },
  {
    type: 'OPEN_BANK',
    label: 'Open Bank',
    params: [],
  },
  {
    type: 'OPEN_STORAGE',
    label: 'Open Storage',
    params: [{ key: 'storageId', type: 'text', label: 'Storage ID' }],
  },
  {
    type: 'OPEN_CRAFTING',
    label: 'Open Crafting',
    params: [{ key: 'stationId', type: 'text', label: 'Station ID' }],
  },
  {
    type: 'TELEPORT',
    label: 'Teleport',
    params: [{ key: 'zone_id', type: 'text', label: 'Zone ID', required: true }],
  },
  {
    type: 'EXECUTE_SCRIPT',
    label: 'Execute Script',
    // No `arguments` param: runGraph has no arg-passing mechanism, so an authored
    // Arguments blob was silently dropped. Add it back only alongside real wiring.
    params: [
      { key: 'scriptId', type: 'text', label: 'Script ID', required: true },
    ],
  },
  {
    type: 'TRIGGER_EVENT',
    label: 'Trigger Event',
    params: [
      { key: 'event', type: 'text', label: 'Event Name', required: true },
      { key: 'payload', type: 'json', label: 'Payload', default: '{}' },
    ],
  },
  {
    // Moves how THIS speaker feels about the player (server/engine/relations.js).
    // Deliberately shows the player no number — they find out from how the NPC
    // talks to them next time. Leave NPC blank to mean "whoever is speaking".
    type: 'RELATION_ADJUST',
    label: 'Adjust Relationship',
    params: [
      { key: 'warmth', type: 'number', label: 'Warmth ±', default: 0 },
      { key: 'familiarity', type: 'number', label: 'Familiarity ±', default: 0 },
      { key: 'npc_id', type: 'text', label: 'NPC (blank = speaker)' },
      { key: 'reason', type: 'text', label: 'Reason (log label)' },
    ],
  },
  {
    type: 'SET_FLAG',
    label: 'Set Flag',
    params: [
      { key: 'scope', type: 'select', label: 'Scope', options: ['player', 'world'], default: 'player' },
      { key: 'flag', type: 'text', label: 'Flag Key', required: true },
      { key: 'value', type: 'text', label: 'Value', default: 'true' },
    ],
  },
  {
    type: 'CLEAR_FLAG',
    label: 'Clear Flag',
    params: [
      { key: 'scope', type: 'select', label: 'Scope', options: ['player', 'world'], default: 'player' },
      { key: 'flag', type: 'text', label: 'Flag Key', required: true },
    ],
  },
  {
    type: 'ADJUST_REPUTATION',
    label: 'Adjust Ideology Rep',
    params: [
      { key: 'ideology_id', type: 'select', label: 'Ideology',
        options: ['ideology_ascendants', 'ideology_long_watch', 'ideology_wildblood', 'ideology_exodus'],
        required: true },
      { key: 'delta', type: 'number', label: 'Change (±)', default: 10 },
      { key: 'reason', type: 'text', label: 'Reason (optional)' },
    ],
  },
  {
    type: 'ADJUST_STANCE',
    label: 'Adjust Ideology Stance',
    // Moves the player's stance on the world (flag stance_axis, -100..100).
    // Negative = renounce it (leave & begin); positive = redeem it (stay & resolve).
    // Surfaced only through the player's ideology lean, never as a raw number.
    params: [{ key: 'delta', type: 'number', label: 'Change (±)', default: 10 }],
  },
  {
    type: 'ADJUST_PATH',
    label: 'Adjust Ideology Path',
    // Nudges affinity toward one path for humanity's future (flags path_machine /
    // path_flesh / path_mind / path_human, 0..100). The paths aren't opposed —
    // machine/flesh/mind are three ways to ascend; human is to stay as we are.
    params: [
      { key: 'path', type: 'select', label: 'Path',
        options: ['machine', 'flesh', 'mind', 'human'], required: true },
      { key: 'delta', type: 'number', label: 'Change (±)', default: 10 },
    ],
  },
  {
    type: 'END_CONVERSATION',
    label: 'End Conversation',
    params: [{ key: 'message', type: 'text', label: 'Goodbye message (optional)' }],
  },
  {
    type: 'GOTO_NODE',
    label: 'Go To Node',
    params: [{ key: 'node', type: 'text', label: 'Node ID', required: true }],
  },
];

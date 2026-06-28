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
    params: [
      { key: 'scriptId', type: 'text', label: 'Script ID', required: true },
      { key: 'arguments', type: 'json', label: 'Arguments', default: '{}' },
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

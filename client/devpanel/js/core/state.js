let token = null;
let currentPanel = 'dashboard';
let _panelClockInterval = null;
let _panelClockTimeout  = null;
let currentRecord = null;
let allRecords = [];
let devRole = null;
let devHandle = null;
let devPlayerId = null;
let stagingEnabled = true;

// Entity paths eligible for staging — maps path prefix to entity type label.

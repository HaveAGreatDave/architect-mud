(function (global) {
  const TAG_CATALOG = {
    // --- Core / identity ---
    description: { label: 'Description', shape: 'text', scope: 'class', group: 'Core',
      help: 'Free text shown on examine / look <item>.' },
    volume: { label: 'Volume', shape: 'int', scope: 'class', group: 'Core',
      help: 'Space occupied in cubic centimeters (cc).' },
    weight: { label: 'Weight', shape: 'int', scope: 'class', group: 'Core',
      help: 'Weight in grams.' },

    // --- Container ---
    container: { label: 'Container Capacity', shape: 'int', scope: 'class', group: 'Container',
      help: 'Marks this item as a container. Value is the max total weight it can hold. Contents count at 75% of their weight while carried.' },

    // --- Locks ---
    "lock:hololock": { label: 'Holographic Lock', shape: 'statmap', scope: 'class', group: 'Hardware', help: 'Electronic holographic authorization matrix.', install_lock: 'installHoloLock', uninstall_lock: 'uninstallHoloLock' },
    "lock:keycardlock": { label: 'Magnetic Keycard Reader', shape: 'statmap', scope: 'class', group: 'Hardware', help: 'Magnetic reader checking passcode clearance profiles.', install_lock: 'installKeycardLock', uninstall_lock: 'uninstallKeycardLock' },

    // --- Installation Kits ---
    "lockkit:hololock": { label: 'Hololock Installation Kit', shape: 'flag', scope: 'class', group: 'Tools', help: 'Consumable installation kit used to deploy a holographic lock setup onto a door or frame.' },
    "lockkit:keycardlock": { label: 'Keycard Lock Installation Kit', shape: 'flag', scope: 'class', group: 'Tools', help: 'Consumable installation kit used to deploy a magnetic keycard reader onto a door or frame.' },

    // --- Instance flags (presence-only, on a carried item) ---
    broken: { label: 'Broken', shape: 'flag', scope: 'instance', group: 'Instance',
      help: 'Per-item state flag set on a carried instance.' },
    cursed: { label: 'Cursed', shape: 'flag', scope: 'instance', group: 'Instance',
      help: 'Per-item state flag set on a carried instance.' }
  };

  global.TAG_CATALOG = TAG_CATALOG;
})(typeof window !== 'undefined' ? window : globalThis);

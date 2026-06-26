/**
 * Automation Script: Modular Lock and Kit tagCatalog synchronizer.
 * Version: 2.0.0 (Total Structural Rebuild)
 * Run via: node scripts/sync-tag-catalog.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATALOG_PATH = path.resolve(__dirname, '../client/shared/tagCatalog.js');

// New dynamic module entries
const MODULES = [
  {
    lockId: "lock:hololock",
    lockData: { label: "Holographic Lock", shape: "statmap", scope: "class", group: "Hardware", help: "Electronic holographic authorization matrix.", install_lock: "installHoloLock", uninstall_lock: "uninstallHoloLock" },
    kitId: "lockkit:hololock",
    kitData: { label: "Hololock Installation Kit", shape: "flag", scope: "class", group: "Tools", help: "Consumable installation kit used to deploy a holographic lock setup onto a door or frame." }
  },
  {
    lockId: "lock:keycardlock",
    lockData: { label: "Magnetic Keycard Reader", shape: "statmap", scope: "class", group: "Hardware", help: "Magnetic reader checking passcode clearance profiles.", install_lock: "installKeycardLock", uninstall_lock: "uninstallKeycardLock" },
    kitId: "lockkit:keycardlock",
    kitData: { label: "Keycard Lock Installation Kit", shape: "flag", scope: "class", group: "Tools", help: "Consumable installation kit used to deploy a magnetic keycard reader onto a door or frame." }
  }
];

async function syncCatalog() {
  console.log("🛠️ Rebuilding tagCatalog.js with clean structural integrity...");

  if (!fs.existsSync(CATALOG_PATH)) {
    console.error(`❌ Error: Could not find tagCatalog.js at ${CATALOG_PATH}`);
    process.exit(1);
  }

  // --- STEP 1: DEFINE GROUND-TRUTH BASE ENTRIES ---
  // We explicitly output the known core tags to bypass historical syntax corruption entirely.
  let rebuiltFile = `(function (global) {
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
`;

  // --- STEP 2: INJECT GENERATED LOCK BLOCKS ---
  rebuiltFile += `\n    // --- Locks ---\n`;
  MODULES.forEach(mod => {
    rebuiltFile += `    "${mod.lockId}": { label: '${mod.lockData.label}', shape: '${mod.lockData.shape}', scope: '${mod.lockData.scope}', group: '${mod.lockData.group}', help: '${mod.lockData.help}', install_lock: '${mod.lockData.install_lock}', uninstall_lock: '${mod.lockData.uninstall_lock}' },\n`;
  });

  rebuiltFile += `\n    // --- Installation Kits ---\n`;
  MODULES.forEach(mod => {
    rebuiltFile += `    "${mod.kitId}": { label: '${mod.kitData.label}', shape: '${mod.kitData.shape}', scope: '${mod.kitData.scope}', group: '${mod.kitData.group}', help: '${mod.kitData.help}' },\n`;
  });

  // --- STEP 3: APPEND INSTANCE FLAGS AND CLOSURE SAFETY FOOTER ---
  rebuiltFile += `
    // --- Instance flags (presence-only, on a carried item) ---
    broken: { label: 'Broken', shape: 'flag', scope: 'instance', group: 'Instance',
      help: 'Per-item state flag set on a carried instance.' },
    cursed: { label: 'Cursed', shape: 'flag', scope: 'instance', group: 'Instance',
      help: 'Per-item state flag set on a carried instance.' }
  };

  global.TAG_CATALOG = TAG_CATALOG;
})(typeof window !== 'undefined' ? window : globalThis);
`;

  // --- STEP 4: WRITE OUT FRESH FILE ---
  fs.writeFileSync(CATALOG_PATH, rebuiltFile, 'utf8');
  console.log("✅ tagCatalog.js has been completely purged and safely regenerated!");
}

syncCatalog().catch(console.error);
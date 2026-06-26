/**
 * Automation Script: Atomic Splicing Catalog Synchronizer
 * Version: 7.0.0 (Zero-Parse Pure String Splicer)
 * Run via: node scripts/sync-tag-catalog.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATALOG_PATH = path.resolve(__dirname, '../client/shared/tagCatalog.js');

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
  console.log("🧬 Running zero-parse atomic splice sync...");

  if (!fs.existsSync(CATALOG_PATH)) {
    console.error(`❌ Error: Could not find target file at ${CATALOG_PATH}`);
    process.exit(1);
  }

  const rawContent = fs.readFileSync(CATALOG_PATH, 'utf8');
  const lines = rawContent.split(/\r?\n/);

  // --- STEP 1: CLEAN OUT ANY EXISTING ENGINES ROWS TO PREVENT DUPLICATION ---
  const cleanBaseLines = [];
  let skipMode = false;

  for (let line of lines) {
    const trimmed = line.trim();

    // If we hit our previous insertion point, toggle skip mode active
    if (trimmed.includes('// --- Locks ---') || trimmed.includes('// --- Installation Kits ---')) {
      skipMode = true;
      continue;
    }

    // Turn off skip mode only when we hit the next untouched baseline group footer
    if (trimmed.includes('// --- Instance flags')) {
      skipMode = false;
    }

    if (skipMode) continue;

    // Filter out historical dynamic lock entries if any remnants are floating around loose
    if (trimmed.startsWith('"lock:') || trimmed.startsWith('"lockkit:')) {
      continue;
    }

    cleanBaseLines.push(line);
  }

  // --- STEP 2: BUILD INJECTION DATA BLOCKS ---
  const insertionLines = [
    "",
    "    // --- Locks ---",
  ];

  MODULES.forEach(mod => {
    insertionLines.push(`    "${mod.lockId}": { label: '${mod.lockData.label}', shape: '${mod.lockData.shape}', scope: '${mod.lockData.scope}', group: '${mod.lockData.group}', help: '${mod.lockData.help}', install_lock: '${mod.lockData.install_lock}', uninstall_lock: '${mod.lockData.uninstall_lock}' },`);
  });

  insertionLines.push("");
  insertionLines.push("    // --- Installation Kits ---");

  MODULES.forEach(mod => {
    insertionLines.push(`    "${mod.kitId}": { label: '${mod.kitData.label}', shape: '${mod.kitData.shape}', scope: '${mod.kitData.scope}', group: '${mod.kitData.group}', help: '${mod.kitData.help}' },`);
  });

  // --- STEP 3: FIND SAFE LANDING ANCHOR LINE IN CLEAN SOURCE ---
  // We locate the container block line because it sits right above our desired insertion window
  const targetAnchor = "// --- Container ---";
  const anchorIndex = cleanBaseLines.findIndex(l => l.trim().includes(targetAnchor));

  if (anchorIndex === -1) {
    console.error("❌ Error: Target file anchor layout missing. Could not locate '// --- Container ---'. Reset your tagCatalog.js first.");
    process.exit(1);
  }

  // Find the exact line index where the container property entry closes down (the trailing line comma)
  let insertIndex = anchorIndex + 1;
  while (insertIndex < cleanBaseLines.length) {
    if (cleanBaseLines[insertIndex].trim().endsWith('},')) {
      insertIndex += 1; // Slide right past the closing brace comma line
      break;
    }
    insertIndex++;
  }

  // --- STEP 4: ATOMIC ARRAY SPLICE ---
  // Drops the generated arrays directly into position without looking at or touching any adjacent data rows
  cleanBaseLines.splice(insertIndex, 0, ...insertionLines);

  // Reassemble the complete file structure
  fs.writeFileSync(CATALOG_PATH, cleanBaseLines.join('\n'), 'utf8');
  console.log("✅ Sync successful! New locks appended without altering any multi-line attributes.");
}

syncCatalog().catch(console.error);
// Emergency Security Protocol — client-side state management.
// Toggling body.esp-active drives all CSS pulse animations.
// The siren audio is handled separately via audio_ambience / audio_stop messages.

import { loadSettings } from '../../shared/settings.js';
import { appendHtml, appendMsg } from './render.js';

function _soundDisabled() {
  const s = loadSettings();
  return !s?.audio?.enabled;
}

// Shown when the player has sound off — they'd otherwise hear nothing.
// Rotates randomly so the same line doesn't repeat back-to-back.
const SIREN_LINES = [
  'Somewhere outside, an emergency siren begins its slow, mournful climb.',
  'A distant wail rises and falls across the city — low, sweeping, like something alive.',
  'The air outside carries a sound you feel more than hear: the Emergency Security Protocol siren, cycling.',
  "Beyond the walls, the siren moans in a long descending arc. Then rises again. It doesn't stop.",
  'Something in the distance howls — not an animal. The tone is mechanical, patient, inevitable.',
  'The emergency siren drifts through the streets outside, its pitch swelling and dropping in a slow, relentless sweep.',
  'Far off, the ESP siren rotates through its cycle. Low to high. High to low. Over and over.',
  "The characteristic wail of an emergency siren bleeds through every crack and vent. It doesn't hurry.",
  'Outside, the siren continues — a long, rising moan that peaks, holds, then sinks back into the low register.',
  "The emergency broadcast tone seeps through the building. It has the patience of something that knows you can't leave.",
];

let _lastSirenLine = -1;

function _pickSirenLine() {
  let idx;
  do { idx = Math.floor(Math.random() * SIREN_LINES.length); } while (idx === _lastSirenLine && SIREN_LINES.length > 1);
  _lastSirenLine = idx;
  return SIREN_LINES[idx];
}

// Siren descriptions on esp_warning are shown every N warnings, not every one —
// the ticker fires every 10 s and we don't want to flood the log.
let _warningCount = 0;
const SIREN_DESC_EVERY = 3; // show a description roughly every 30 seconds

export function applyEspState({ active, message }) {
  document.body.classList.toggle('esp-active', !!active);
  const banner = document.getElementById('esp-banner');
  if (!banner) return;
  if (active) {
    banner.textContent = message || 'EMERGENCY SECURITY PROTOCOL ACTIVE';
    banner.classList.remove('esp-hidden');
    _warningCount = 0;
    if (_soundDisabled()) {
      appendMsg(_pickSirenLine(), 'ambient');
    }
  } else {
    banner.classList.add('esp-hidden');
    _warningCount = 0;
  }
}

export function handleEspWarning(msg) {
  appendHtml(`<div class="esp-warning">${msg.message}</div>`, 'esp-warning');
  if (_soundDisabled()) {
    _warningCount++;
    if (_warningCount % SIREN_DESC_EVERY === 0) {
      appendMsg(_pickSirenLine(), 'ambient');
    }
  }
}

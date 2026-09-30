// The per-quest action log the tablet's Quests app shows. The server pushes
// structured `quest_log` events (plugins/quests/index.js questLogLine) and they
// land here whether or not the tablet is open, so this lives apart from
// tablet-os.js: recording a line must not download the whole tablet. See
// lazy-views.js.
//
// Store shape: { [quest_id]: { name, done, entries: [{ kind, text, t }] } }
//   kind: 'start' | 'arrive' | 'emote' | 'objective' | 'complete'
// A quest flips `done` on its 'complete' beat; its bucket is purged the next time
// the tablet closes (purgeCompletedQuestLogs in tablet-os.js).

const QLOG_KEY = 'architect_quest_log_v2';
const QLOG_ENTRY_CAP = 60; // per-quest, oldest trimmed

export function loadQLog() {
  try { const o = JSON.parse(localStorage.getItem(QLOG_KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; }
  catch { return {}; }
}
export function saveQLog(o) { try { localStorage.setItem(QLOG_KEY, JSON.stringify(o)); } catch {} }

// Feed a structured server quest_log event into its quest's bucket. Returns
// true when it recorded something.
export function recordQuestLog(msg) {
  if (!msg || !msg.quest_id || !msg.kind || !msg.text) return false;
  const log = loadQLog();
  const q = log[msg.quest_id] || (log[msg.quest_id] = { name: '', done: false, entries: [] });
  if (msg.kind === 'start') q.name = msg.text;
  if (msg.kind === 'complete') q.done = true;
  const entries = q.entries;
  // Collapse an exact immediate repeat (e.g. a double-fired line).
  const last = entries[entries.length - 1];
  if (!(last && last.kind === msg.kind && last.text === msg.text)) {
    entries.push({ kind: msg.kind, text: msg.text, t: Date.now() });
    if (entries.length > QLOG_ENTRY_CAP) entries.splice(0, entries.length - QLOG_ENTRY_CAP);
  }
  saveQLog(log);
  return true;
}

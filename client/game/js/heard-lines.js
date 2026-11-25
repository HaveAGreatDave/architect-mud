// THE LINES LATELY HEARD: every server message's text (dispatch.js handleServerMsg), kept a few seconds with when it
// came, so a view can act out a line it recognises (freelook-view.js: a close-up figure's flags.figure.cues). Nothing
// here decides anything; it only remembers what was shown.
const KEEP_MS = 8000, lines = [];
export function noteLine(text, now = performance.now()) {
  if (typeof text !== 'string' || !text) return;
  lines.push({ text: text.replace(/<[^>]*>/g, '').toLowerCase(), t: now });
  while (lines.length && (now - lines[0].t > KEEP_MS || lines.length > 40)) lines.shift();
}
// the newest line containing `needle` (lower case) heard since `since`, or null
export function lineHeard(needle, since = 0) {
  for (let i = lines.length - 1; i >= 0 && lines[i].t >= since; i--) if (lines[i].text.includes(needle)) return lines[i];
  return null;
}

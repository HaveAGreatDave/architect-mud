// Escaping for text that goes into a message the client renders as HTML.
//
// Most server messages are HTML (type 'output', 'examine', 'system' and the
// rest are put into innerHTML by the client), so any text a player typed has to
// pass through here before it's interpolated into one. Engine strings and
// authored content don't need it; player text always does.
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

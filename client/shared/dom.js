// Escapes text for both places it lands in markup: between tags and inside a
// quoted attribute. Both quote marks are escaped, so a value is safe in
// value="..." and in value='...'. Null and undefined give ''; anything else is
// stringified, so a numeric id survives.
export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

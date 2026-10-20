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

// A panel's stylesheet as text, for a module to `await` at load and inject as a
// <style> when it opens. A <link> would apply a frame late and let the first open
// lay out unstyled. Resolves '' when the fetch fails (a Node gate has no file
// fetch), so a missing sheet leaves the panel unstyled instead of unloadable.
export async function loadCss(url) {
  try {
    const r = await fetch(url);
    return r.ok ? await r.text() : '';
  } catch {
    return '';
  }
}

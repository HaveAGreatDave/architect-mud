// Zone-protection substrate (Phase 3, docs/proposals/engine-plugin-boundary.md).
//
// Systems that shield a zone register a provider; laws that gate hostile
// interactions (attack, loot, steal, shove) ask getZoneProtection and never
// know the source. Housing forcefields are the first provider; corp territory,
// wards, or safe zones reuse the same seam later — the laws don't change.
//
// provider(zoneId) → { reason: 'forcefield' | … } | null/undefined
// Synchronous by contract: providers read caches, never the DB — the checks
// sit on hot paths (every swing of an offline-sleep attack).

const providers = [];

export function registerProtectionProvider(provider, owner = 'plugin') {
  if (typeof provider !== 'function') throw new Error('registerProtectionProvider: function required');
  providers.push({ provider, owner });
}

// First provider to claim the zone wins. A provider that throws is skipped
// (logged) — an erroring provider must not strip a zone's protection silently
// in one call and grant it the next.
export function getZoneProtection(zoneId) {
  for (const { provider, owner } of providers) {
    try {
      const p = provider(zoneId);
      if (p) return p;
    } catch (e) {
      console.error(`[protection:${owner}] provider error: ${e.message}`);
    }
  }
  return null;
}

export function getRegisteredProtectionProviders() { return providers.map(p => p.owner); }

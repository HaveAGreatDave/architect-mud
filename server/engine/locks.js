import { query } from '../models/db.js';

// Auth registry: lock tag type → async (lockTag, door, player) => bool
const authRegistry = new Map();

export function registerLockAuth(type, fn) {
  authRegistry.set(type, fn);
}

export async function resolveLockAuth(lockTag, door, player) {
  const fn = authRegistry.get(lockTag.type);
  return fn ? fn(lockTag, door, player) : false;
}

// Lock type registry: shortName ('hololock') → { tagType, kitTag, defaults }
const lockTypeRegistry = new Map();

// tagType → whether an authorised actor may walk THROUGH the door while it's
// still locked. True for credentialled locks (the door recognises you and opens
// itself); false for manual bolts like a privacy latch, which must be physically
// undone before the door will open.
const passWhileLockedRegistry = new Map();

export function registerLockType(shortName, { tagType, kitTag, defaults, authFn, passWhileLocked = true }) {
  lockTypeRegistry.set(shortName, { tagType, kitTag, defaults });
  registerLockAuth(tagType, authFn);
  passWhileLockedRegistry.set(tagType, passWhileLocked);
}

export function lockTypePassesWhileLocked(tagType) {
  return passWhileLockedRegistry.get(tagType) !== false;
}

export function getLockType(shortName) {
  return lockTypeRegistry.get(shortName) ?? null;
}

export function getAllLockTypes() {
  return [...lockTypeRegistry.entries()].map(([name, cfg]) => ({ name, ...cfg }));
}

/**
 * The read window — the reaction beat, and the one piece of mastery the player
 * actually plays rather than triggers.
 *
 * THE TIMING PROBLEM, and the answer.
 *
 * A swing resolves SYNCHRONOUSLY inside `enemyAttackPlayer`. There is no point
 * in that function where the engine can stop and wait for a keypress, and adding
 * one would put a promise across the combat tick.
 *
 * So the window is ARMED BY SWING N AND CONSUMED BY SWING N+1. That is not a
 * compromise dressed as fiction — it IS the fiction: you read the tell on the
 * exchange you just survived, and act on the next one.
 *
 * THE DEADLINE COMES FROM THE ENGINE'S OWN SCHEDULE, never a wall clock:
 * `enemy.lastAttack + enemy_attack_interval_ms`. A fixed `Date.now() + 2500`
 * drifts against that interval, and in a room with two enemies it would promise
 * a window the next claw closes early.
 *
 * NO ANSWER IN TIME COSTS NOTHING. The Composure was already spent to arm it. A
 * penalty would make the minigame mandatory, and would punish the `log` rung for
 * being the `log` rung — both of which docs/systems-display-mode.md forbids.
 *
 * CORRECTNESS IS DECIDED SERVER-SIDE. The client's bit is only trusted at the
 * bottom rung, where the server itself produced it.
 */
import { textRender } from '../../server/engine/minigame.js';
import { effectiveSkill } from '../../server/engine/skills.js';
import { getTunable } from '../../server/engine/tunables.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getComposure, spendComposure } from './composure.js';
import { effectiveRank } from './purity.js';
import { tierOn, tierAtLeast } from './reads.js';

// The four answers. Fixed order — the client renders them positionally.
export const OPTIONS = Object.freeze(['SIDESTEP', 'BLOCK', 'COUNTER', 'RETREAT']);

// The tells, keyed by the correct answer. The tell IS the puzzle: a player who
// learns to read these is genuinely better at the game, which is the stated goal
// of building a reaction beat rather than a passive.
const TELLS = {
  SIDESTEP: ['WEIGHT SHIFTS FORWARD', 'SHOULDER DROPS', 'IT COMMITS'],
  BLOCK:    ['ELBOW TUCKS IN', 'SHORT BACKSWING', 'IT STAYS CLOSE'],
  COUNTER:  ['IT OVERREACHES', 'GUARD OPENS', 'THE ARM EXTENDS'],
  RETREAT:  ['WEIGHT GOES BACK', 'IT GATHERS', 'SOMETHING BIG IS COMING'],
};

// Below this the interval is too short to be a fair reaction test, and we refuse
// to arm rather than shipping an unwinnable one. `enemy_attack_interval_ms` is a
// tunable, so this is a real possibility and not a hypothetical.
const MIN_WINDOW_MS = 1200;
// Taken off the deadline to absorb the 1s gameLoop's jitter.
const JITTER_MS = 400;
const ARM_COST = 1;

let tokenSeq = 0;

/** Can a window be armed at all right now? Sync, cheap, called from the seam. */
export function canArm(player, enemy, now = Date.now()) {
  if (!player || !enemy || enemy.hp <= 0) return false;
  if (player._readWindow) return false;                       // one at a time
  if (effectiveRank(player, 'combat') < 25) return false;
  if (!tierAtLeast(tierOn(player, enemy), 'pattern')) return false;
  if (getComposure(player) < ARM_COST) return false;
  // A live dodge already IS the reaction slot. Two of them in the same beat
  // would be two answers to one swing.
  if (player._dodgeUntil && now < player._dodgeUntil) return false;
  return true;
}

/**
 * Arm the window. Called from the swing seam's 'post' — which is sync, so this
 * deliberately does NOT await: it kicks the payload off and returns.
 */
export function armWindow(player, enemy, now = Date.now()) {
  const interval = getTunable('enemy_attack_interval_ms', 4000);
  const deadline = (enemy.lastAttack || now) + interval - JITTER_MS;
  const ttl = deadline - now;
  if (ttl < MIN_WINDOW_MS) return null;      // unwinnable — refuse rather than ship it
  if (!spendComposure(player, ARM_COST)) return null;

  const correct = OPTIONS[Math.floor(Math.random() * OPTIONS.length)];
  const token = `rw_${++tokenSeq}_${Math.floor(now % 100000)}`;
  player._readWindow = {
    token, enemyId: enemy.instanceId || enemy.id, correct,
    armedAt: now, expiresAt: deadline,
  };

  // The payload is async (textRender consults the rung), and the seam is sync.
  // Fire and forget: the window already exists on the player, so a slow send
  // cannot desync the authoritative half.
  sendPayload(player, enemy, ttl).catch(() => {});
  return player._readWindow;
}

async function sendPayload(player, enemy, ttlMs) {
  const win = player._readWindow;
  if (!win) return;
  const payload = await textRender(player, {
    type: 'read_window',
    deviceName: enemy.name,
    skill: await effectiveSkill(player, 'dodge'),
    difficulty: Math.max(1, (enemy.hit ?? 1) + (enemy.dodge ?? 1)),
    resolveCmd: 'readresolve',
    token: win.token,
    tells: TELLS[win.correct] || [],
    options: [...OPTIONS],
    ttlMs,
  // NOT the default `hacking`. A board about watching somebody move is graded on
  // dodge, or the bottom rung silently tests a different competence than the
  // other two — minigame.js says so explicitly.
  }, { skill: 'dodge' });
  sendToPlayer(player.id, payload);
}

/**
 * The player answered. Returns the outcome, or null for a stale/forged token.
 *
 * `clientWon` is ONLY trusted at the log rung, where the server produced it —
 * everywhere else correctness is `choice === win.correct`, decided here.
 */
export function resolveWindow(player, token, choice, { trustClient = false, clientWon = false } = {}) {
  const win = player?._readWindow;
  if (!win || win.token !== token) return null;
  player._readWindow = null;
  if (Date.now() > win.expiresAt) return { lapsed: true };

  const correct = trustClient ? !!clientWon : (String(choice || '').toUpperCase() === win.correct);
  player._readAnswer = correct ? { enemyId: win.enemyId, at: Date.now() } : null;
  return { correct, expected: win.correct };
}

/** Clear a window whose fight has gone — a stale token must never resolve against a corpse. */
export function clearWindow(player) {
  if (!player) return;
  player._readWindow = null;
  player._readAnswer = null;
}

/**
 * Consumed by the next incoming swing from that same instance. Sync, called from
 * the seam's 'pre'.
 */
export function takeAnswer(player, enemy) {
  const ans = player?._readAnswer;
  if (!ans) return false;
  if (ans.enemyId !== (enemy.instanceId || enemy.id)) return false;   // another enemy's swing
  player._readAnswer = null;
  return true;
}

export const _test = { TELLS, MIN_WINDOW_MS, JITTER_MS, ARM_COST, canArm };

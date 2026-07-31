/**
 * Plugin system — hook-based, file-drop extensibility.
 * Drop a folder in /plugins/ with plugin.json + index.js to add mechanics.
 *
 * Extension points available to plugins:
 *   hooks         — fireHook(name, ...args): last non-undefined return wins
 *   commands      — registerCommand(name, handler): player-typed commands
 *   routes        — registerRoutes(prefix, handler): REST route handlers
 *   inputMatchers — registerInputMatcher(pattern, handler): multi-word/raw-input verbs
 *
 * Manifest fields beyond name/version/hooks/commands/routePrefix:
 *   after    — ["pluginName", …]: load after these plugins (explicit ordering;
 *              without it, order is filesystem-alphabetical)
 *   critical — true: a load failure aborts boot instead of logging and skipping
 */
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { existsSync } from 'fs';
import { registerSpecializedAction } from './specializedActions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = join(__dirname, '../../plugins');

// Registry: hookName -> [{ pluginName, handler }]
const hooks = new Map();
const loadedPlugins = [];

// Command registry: commandName -> handler(args, raw, player, broadcast)
// Checked by commands.js before the built-in switch statement.
const commands = new Map();
// commandName -> owning plugin name (for collision warnings at load)
const commandOwners = new Map();

// Route registry: [{ prefix, handler(path, method, body, auth) }]
// Checked by routes.js before built-in routes. Handler returns {status, body}
// or null to fall through.
const routeHandlers = [];

// Input-matcher registry: [{ pattern, handler, owner }]. Matchers run against
// the raw input line before single-word command routing — the extension point
// for multi-word verbs ("jerk off on", "eat out") that a commandName can't
// express. First matching pattern wins.
const inputMatchers = [];

export async function loadPlugins() {
  if (!existsSync(PLUGINS_DIR)) {
    console.log('  No /plugins/ directory found, skipping');
    return;
  }

  const entries = await readdir(PLUGINS_DIR, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory());

  // Read every manifest up front so `after` can order loads explicitly.
  // Base order stays filesystem-alphabetical; a stable DFS floats declared
  // dependencies ahead of their dependents. Cycles warn and fall back.
  const candidates = [];
  for (const dir of dirs) {
    const pluginPath = join(PLUGINS_DIR, dir.name);
    const manifestPath = join(pluginPath, 'plugin.json');
    const indexPath = join(pluginPath, 'index.js');
    if (!existsSync(manifestPath) || !existsSync(indexPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch (e) {
      console.error(`  ✗ Plugin ${dir.name}: unreadable plugin.json: ${e.message}`);
      continue;
    }
    candidates.push({ dirName: dir.name, name: manifest.name || dir.name, indexPath, manifest });
  }

  const byName = new Map(candidates.map(c => [c.name, c]));
  const ordered = [];
  const visited = new Set();
  const visiting = new Set();
  function visit(c) {
    if (visited.has(c.name)) return;
    if (visiting.has(c.name)) {
      console.warn(`  ⚠ Plugin load-order cycle involving "${c.name}" — falling back to alphabetical`);
      return;
    }
    visiting.add(c.name);
    for (const dep of (c.manifest.after || [])) {
      const depC = byName.get(dep);
      if (depC) visit(depC);
      else console.warn(`  ⚠ Plugin ${c.name}: after:["${dep}"] names an unknown plugin`);
    }
    visiting.delete(c.name);
    visited.add(c.name);
    ordered.push(c);
  }
  for (const c of candidates) visit(c);

  for (const { dirName, name, indexPath, manifest } of ordered) {
    try {
      const mod = await import(pathToFileURL(indexPath).href);

      const hasHooks = mod.hooks && typeof mod.hooks === 'object';
      const hasCommands = mod.commands && typeof mod.commands === 'object';
      const hasRoute = manifest.routePrefix && typeof mod.routeHandler === 'function';
      const hasSpecialized = Array.isArray(mod.specializedActions) && mod.specializedActions.length > 0;
      if (!hasHooks && !hasCommands && !hasRoute && !hasSpecialized) {
        console.warn(`  Plugin ${name}: no hooks, commands, routeHandler, or specializedActions export, skipping`);
        continue;
      }

      for (const hookName of (manifest.hooks || [])) {
        if (typeof mod.hooks[hookName] === 'function') {
          if (!hooks.has(hookName)) hooks.set(hookName, []);
          hooks.get(hookName).push({ pluginName: name, handler: mod.hooks[hookName] });
        }
      }

      // Wire up commands declared in plugin.json's "commands" array.
      // Plugin exports { commands: { 'commandName': handler } }
      if (mod.commands && typeof mod.commands === 'object') {
        for (const cmdName of (manifest.commands || [])) {
          if (typeof mod.commands[cmdName] === 'function') {
            const prevOwner = commandOwners.get(cmdName);
            if (prevOwner) {
              console.warn(`  ⚠ Verb collision: "${cmdName}" (${name}) overrides plugin ${prevOwner}${(manifest.after || []).includes(prevOwner) ? '' : ' — declare after:["' + prevOwner + '"] to make the order explicit'}`);
            }
            commands.set(cmdName, mod.commands[cmdName]);
            commandOwners.set(cmdName, name);
          }
        }
      }

      // Wire up a route handler if the plugin exports one.
      // Plugin exports { routePrefix: '/myroute', routeHandler: fn }
      if (manifest.routePrefix && typeof mod.routeHandler === 'function') {
        routeHandlers.push({ prefix: manifest.routePrefix, handler: mod.routeHandler });
      }

      // Wire up tag-gated specialized actions.
      // Plugin exports { specializedActions: [{ verb, requiredTag?, handler }] }
      if (hasSpecialized) {
        for (const sa of mod.specializedActions) {
          registerSpecializedAction({ ...sa, pluginName: name });
        }
      }

      loadedPlugins.push({ name, version: manifest.version || '?', hooks: manifest.hooks || [], commands: manifest.commands || [], specializedActions: hasSpecialized ? mod.specializedActions.map(s => s.verb) : [] });
      console.log(`  ✓ Plugin: ${name} v${manifest.version}`);
    } catch (e) {
      if (manifest.critical) {
        throw new Error(`Critical plugin "${name}" failed to load: ${e.message}`);
      }
      console.error(`  ✗ Plugin ${dirName} failed to load: ${e.message}`);
    }
  }

  if (loadedPlugins.length) {
    console.log(`✓ Loaded ${loadedPlugins.length} plugin(s)`);
  }

  // Report plugin verbs that shadow engine builtins — the shadowed builtin is
  // dead code by dispatch order, which should be a visible fact, not a
  // surprise. Dynamic import: commands/index.js imports this module.
  try {
    const { builtinCommandNames } = await import('./commands/index.js');
    const shadowed = [...commands.keys()].filter(c => builtinCommandNames().includes(c));
    if (shadowed.length) {
      console.log(`  ℹ Plugin verbs shadowing engine builtins (builtin is dead code): ${shadowed.join(', ')}`);
    }
  } catch { /* commands module unavailable in isolated tests — skip the report */ }
}

/**
 * Fire a hook. Calls all registered handlers in order.
 * Handlers can return a value; last non-undefined return wins.
 */
export async function fireHook(hookName, ...args) {
  const handlers = hooks.get(hookName);
  if (!handlers?.length) return undefined;

  let result;
  for (const { pluginName, handler } of handlers) {
    try {
      const r = await handler(...args);
      if (r !== undefined) result = r;
    } catch (e) {
      console.error(`Plugin hook error [${pluginName}:${hookName}]: ${e.message}`);
    }
  }
  return result;
}

// Every non-undefined result, not just the last one.
//
// `fireHook` answers "what is this value" and the last plugin to have an opinion
// wins. Some hooks are the other shape entirely: "what does everyone have to
// contribute". A SENSE is the clearest case — the kitchen smells of burnt fat
// AND the floor smells of piss AND the street smells of the Slaglands, and
// there is no sense in which one of those overwrites the others.
//
// Results are flattened one level so a contributor can return either a single
// entry or a list of them without the caller caring which.
export async function gatherHook(hookName, ...args) {
  const handlers = hooks.get(hookName);
  if (!handlers?.length) return [];

  const out = [];
  for (const { pluginName, handler } of handlers) {
    try {
      const r = await handler(...args);
      if (r === undefined || r === null) continue;
      Array.isArray(r) ? out.push(...r.filter(x => x != null)) : out.push(r);
    } catch (e) {
      console.error(`Plugin hook error [${pluginName}:${hookName}]: ${e.message}`);
    }
  }
  return out;
}

// --- Command registration ---

export function registerCommand(name, handler) {
  commands.set(name, handler);
}

// Called from commands.js before the built-in switch. Returns the handler's
// result, or undefined if no plugin owns this command.
export async function fireCommand(cmd, args, raw, player, broadcast) {
  const handler = commands.get(cmd);
  if (!handler) return undefined;
  return handler(args, raw, player, broadcast);
}

// --- Input-matcher registration ---

// pattern: RegExp tested against the raw input line. handler has the same
// signature as a command handler: (args, raw, player, broadcast).
export function registerInputMatcher(pattern, handler, owner = 'engine') {
  if (!(pattern instanceof RegExp) || typeof handler !== 'function') {
    throw new Error('registerInputMatcher: RegExp pattern and handler required');
  }
  inputMatchers.push({ pattern, handler, owner });
}

// Called from the command dispatcher before single-word routing. Returns the
// handler's result, or undefined if no matcher claims the input.
export async function fireInputMatchers(args, raw, player, broadcast) {
  for (const { pattern, handler } of inputMatchers) {
    if (pattern.test(raw)) return handler(args, raw, player, broadcast);
  }
  return undefined;
}

// --- Route registration ---

export function registerRoutes(prefix, handler) {
  routeHandlers.push({ prefix, handler });
}

// Called from routes.js before built-in route matching. Returns {status, body,
// headers?} if a plugin handled the request, or null to fall through. `reqHeaders`
// is the raw request header map (lower-cased keys) — handlers use it for e.g.
// conditional GETs (If-None-Match).
export async function fireRoutes(path, method, body, auth, reqHeaders) {
  for (const { prefix, handler } of routeHandlers) {
    if (path.startsWith(prefix)) {
      const result = await handler(path, method, body, auth, reqHeaders);
      if (result) return result;
    }
  }
  return null;
}

// --- Introspection ---

export function getLoadedPlugins() { return [...loadedPlugins]; }
export function getRegisteredHooks() {
  const result = {};
  for (const [name, handlers] of hooks) {
    result[name] = handlers.map(h => h.pluginName);
  }
  return result;
}
export function getRegisteredCommands() { return [...commands.keys()]; }
export function getRegisteredRoutes() { return routeHandlers.map(r => r.prefix); }

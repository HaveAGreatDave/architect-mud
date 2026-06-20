/**
 * Plugin system — hook-based, file-drop extensibility.
 * Drop a folder in /plugins/ with plugin.json + index.js to add mechanics.
 *
 * Extension points available to plugins:
 *   hooks         — fireHook(name, ...args): last non-undefined return wins
 *   commands      — registerCommand(name, handler): player-typed commands
 *   routes        — registerRoutes(prefix, handler): REST route handlers
 */
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = join(__dirname, '../../plugins');

// Registry: hookName -> [{ pluginName, handler }]
const hooks = new Map();
const loadedPlugins = [];

// Command registry: commandName -> handler(args, raw, player, broadcast)
// Checked by commands.js before the built-in switch statement.
const commands = new Map();

// Route registry: [{ prefix, handler(path, method, body, auth) }]
// Checked by routes.js before built-in routes. Handler returns {status, body}
// or null to fall through.
const routeHandlers = [];

export async function loadPlugins() {
  if (!existsSync(PLUGINS_DIR)) {
    console.log('  No /plugins/ directory found, skipping');
    return;
  }

  const entries = await readdir(PLUGINS_DIR, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory());

  for (const dir of dirs) {
    const pluginPath = join(PLUGINS_DIR, dir.name);
    const manifestPath = join(pluginPath, 'plugin.json');
    const indexPath = join(pluginPath, 'index.js');

    if (!existsSync(manifestPath) || !existsSync(indexPath)) continue;

    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      const mod = await import(pathToFileURL(indexPath).href);

      const hasHooks = mod.hooks && typeof mod.hooks === 'object';
      const hasCommands = mod.commands && typeof mod.commands === 'object';
      const hasRoute = manifest.routePrefix && typeof mod.routeHandler === 'function';
      if (!hasHooks && !hasCommands && !hasRoute) {
        console.warn(`  Plugin ${dir.name}: no hooks, commands, or routeHandler export, skipping`);
        continue;
      }

      for (const hookName of (manifest.hooks || [])) {
        if (typeof mod.hooks[hookName] === 'function') {
          if (!hooks.has(hookName)) hooks.set(hookName, []);
          hooks.get(hookName).push({ pluginName: manifest.name || dir.name, handler: mod.hooks[hookName] });
        }
      }

      // Wire up commands declared in plugin.json's "commands" array.
      // Plugin exports { commands: { 'commandName': handler } }
      if (mod.commands && typeof mod.commands === 'object') {
        for (const cmdName of (manifest.commands || [])) {
          if (typeof mod.commands[cmdName] === 'function') {
            commands.set(cmdName, mod.commands[cmdName]);
          }
        }
      }

      // Wire up a route handler if the plugin exports one.
      // Plugin exports { routePrefix: '/myroute', routeHandler: fn }
      if (manifest.routePrefix && typeof mod.routeHandler === 'function') {
        routeHandlers.push({ prefix: manifest.routePrefix, handler: mod.routeHandler });
      }

      loadedPlugins.push({ name: manifest.name || dir.name, version: manifest.version || '?', hooks: manifest.hooks || [], commands: manifest.commands || [] });
      console.log(`  ✓ Plugin: ${manifest.name} v${manifest.version}`);
    } catch (e) {
      console.error(`  ✗ Plugin ${dir.name} failed to load: ${e.message}`);
    }
  }

  if (loadedPlugins.length) {
    console.log(`✓ Loaded ${loadedPlugins.length} plugin(s)`);
  }
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

// --- Route registration ---

export function registerRoutes(prefix, handler) {
  routeHandlers.push({ prefix, handler });
}

// Called from routes.js before built-in route matching. Returns {status, body}
// if a plugin handled the request, or null to fall through.
export async function fireRoutes(path, method, body, auth) {
  for (const { prefix, handler } of routeHandlers) {
    if (path.startsWith(prefix)) {
      const result = await handler(path, method, body, auth);
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

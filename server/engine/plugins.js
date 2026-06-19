/**
 * Plugin system — hook-based, file-drop extensibility.
 * Drop a folder in /plugins/ with plugin.json + index.js to add mechanics.
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

      if (!mod.hooks || typeof mod.hooks !== 'object') {
        console.warn(`  Plugin ${dir.name}: no hooks export, skipping`);
        continue;
      }

      for (const hookName of (manifest.hooks || [])) {
        if (typeof mod.hooks[hookName] === 'function') {
          if (!hooks.has(hookName)) hooks.set(hookName, []);
          hooks.get(hookName).push({ pluginName: manifest.name || dir.name, handler: mod.hooks[hookName] });
        }
      }

      loadedPlugins.push({ name: manifest.name || dir.name, version: manifest.version || '?', hooks: manifest.hooks || [] });
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

export function getLoadedPlugins() { return [...loadedPlugins]; }
export function getRegisteredHooks() {
  const result = {};
  for (const [name, handlers] of hooks) {
    result[name] = handlers.map(h => h.pluginName);
  }
  return result;
}

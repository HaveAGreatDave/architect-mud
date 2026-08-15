// The `vars` verb — read, set and clear the user variables a macro script writes.
//
// Its own file rather than living in variables.js because that module is imported
// by the macro runner on a hot-ish path and must not drag in the log; and its own
// file rather than living in automation.js because variables are not automation —
// a macro run by hand uses them just as much as a trigger does.
import { appendMsg } from './render.js';
import { allVars, setVar, unsetVar, clearVars } from './variables.js';
import { evalValue } from './expr.js';

export function runVarsCommand(rest) {
  const arg = String(rest || '').trim();

  if (!arg) {
    const all = allVars();
    const names = Object.keys(all).sort();
    if (!names.length) {
      appendMsg('No variables set. A macro sets them with "set <name> <value>", '
        + 'and reads them back as $<name>. Try:  vars count 0', 'system');
      return;
    }
    appendMsg(`${names.length} variable(s):\n`
      + names.map(n => `  $${n} = ${all[n]}`).join('\n'), 'system');
    return;
  }

  if (/^clear$/i.test(arg)) { clearVars(); appendMsg('All variables cleared.', 'system'); return; }

  const m = arg.match(/^([a-z_][a-z0-9_]*)(?:\s+(.*))?$/i);
  if (!m) {
    appendMsg('Usage: vars   ·   vars <name> <value>   ·   vars <name>   ·   vars clear', 'system');
    return;
  }
  const name = m[1].toLowerCase();
  // A bare name READS. Naming a variable and being shown nothing back would be a
  // strange thing for a listing command to do, and "unset it" already has a word.
  if (m[2] === undefined) {
    const all = allVars();
    if (!(name in all)) { appendMsg(`$${name} is not set.`, 'system'); return; }
    appendMsg(`$${name} = ${all[name]}`, 'system');
    return;
  }
  const value = m[2].trim();
  if (!value) {
    appendMsg(unsetVar(name) ? `$${name} unset.` : `$${name} was not set.`, 'system');
    return;
  }
  // The same expression evaluator a macro's `set` uses, so typing it by hand and
  // scripting it cannot come to mean different things. Only user variables are
  // resolvable here — the live player values belong to a running macro, and a
  // variable frozen from one at the command box would be a stale number wearing a
  // live name.
  setVar(name, evalValue(value, { lookup: (n) => allVars()[n] ?? null }));
  appendMsg(`$${name} = ${allVars()[name]}`, 'system');
}

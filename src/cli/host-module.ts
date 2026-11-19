/**
 * `ista run --host <module>` (§17.3): a JavaScript module standing in for a real host. Its default
 * export implements the program's externs by key, against JSON (runtime/boundary/host-natives.ts):
 * each function takes the extern's arguments, in order, as JSON values, and gives its result. One
 * for an extern returning a future, which is live (proposal 8, Rule 9), may give a promise, which
 * resolves the future as it settles; one that rejects panics the run waiting on it.
 */

import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { HostExterns } from '../runtime/boundary/host-natives.ts';

/** A host module loaded, its externs, or why it can't implement them: the user's to fix. */
type LoadedHostModule =
  | { readonly kind: 'loaded'; readonly externs: HostExterns }
  | { readonly kind: 'unfit'; readonly problem: string };

/**
 * Loads the host module at `path`, whose default export must be an object of functions. Whatever
 * its import throws is the module's own failing (a syntax error, a throw at its top level, an
 * import of its own that is missing), so it is reported as unfit, never as a toolchain bug.
 */
export async function loadHostModule(path: string): Promise<LoadedHostModule> {
  if (!existsSync(path)) {
    return { kind: 'unfit', problem: `no such file: ${path}` };
  }
  let loaded: unknown;
  try {
    loaded = await import(pathToFileURL(path).href);
  } catch (error) {
    return { kind: 'unfit', problem: `${path} failed to load: ${String(error)}` };
  }
  const given = (loaded as { readonly default?: unknown }).default;
  if (given === null || typeof given !== 'object') {
    return { kind: 'unfit', problem: `${path} has no default export of extern implementations.` };
  }
  const entries = Object.entries(given);
  const notFunction = entries.find(([, each]) => typeof each !== 'function');
  if (notFunction !== undefined) {
    return {
      kind: 'unfit',
      problem: `${path} exports '${notFunction[0]}', which isn't a function.`,
    };
  }
  return { kind: 'loaded', externs: spreading(entries as [string, ModuleExtern][]) };
}

/** A function of a host module: the extern's arguments in, its result out. */
type ModuleExtern = (...arguments_: readonly unknown[]) => unknown;

/** `entries` as a host's externs, each taking its arguments spread. */
function spreading(entries: readonly [string, ModuleExtern][]): HostExterns {
  return Object.fromEntries(
    entries.map(([key, extern]) => [
      key,
      (arguments_: readonly unknown[]) => extern(...arguments_),
    ]),
  );
}

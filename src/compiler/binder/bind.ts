/**
 * The binder's entry: the names of a whole program, bound (§3.4, §3.11, §3.13).
 *
 * Binding runs in two steps with different lifetimes:
 * - Each module is bound on its own and memoized on its tree (bind-module.ts), so an edit rebinds
 *   only the module it touched.
 * - Linking resolves what crosses modules: imports, the prelude, variants named by expected type,
 *   qualified names. It is cheap next to binding a module, so it is redone for each Program and
 *   memoized on it.
 *
 * The result's vocabulary is entities.ts. Name lookups that need types (members, methods,
 * argument-dependent lookup, choosing among variant candidates) are the checker's.
 */

import type { Program } from '../program/program.ts';
import type { Bindings } from './entities.ts';
import { link } from './link.ts';

const linked = new WeakMap<Program, Bindings>();

export function bindProgram(program: Program): Bindings {
  let bindings = linked.get(program);
  if (bindings === undefined) {
    bindings = link(program);
    linked.set(program, bindings);
  }
  return bindings;
}

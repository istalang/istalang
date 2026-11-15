/**
 * Every std module's natives in one table: what an app hands the runtime for the std modules
 * (runtime/natives.ts). It derives from the list of std modules (std-modules.ts); each key names
 * its module, so two modules' tables never share a key.
 */

import type { Natives } from '../runtime/natives.ts';
import { stdModules } from './std-modules.ts';

export const stdNatives: Natives = Object.fromEntries(
  stdModules.flatMap((module) => Object.entries(module.natives)),
);

/** The keys of the std natives that reach instances, contexts, slots or tests: the interpreter's alone. */
export const interpreterNativeKeys: ReadonlySet<string> = new Set(
  stdModules.flatMap((module) => module.interpreterKeys),
);

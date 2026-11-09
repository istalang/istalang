/**
 * The kind lowering gives the entries it writes (docs/arch/definition.md, "Frames"). Proposal 8's
 * kinds don't reach the checker yet, so every function whose body may wait is `ista`, every wait
 * committing, as every `await` always has.
 */

import type { CodeMode } from '../../../definition/tables/functions.ts';

/** The kind of an entry, whose body may wait when `isAsync`. */
export function codeModeOf(isAsync: boolean): CodeMode {
  return isAsync ? 'ista' : 'plain';
}

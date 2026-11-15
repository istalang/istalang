/**
 * The function table of a loaded Definition: every entry bound to what runs when it is called.
 *
 * A code entry runs its instructions; an extern entry runs the native its key names, bound once
 * at load, so a Definition whose natives are missing is refused, naming them, before anything
 * runs. The table never changes: a mock (§10) is an object of the instance holding it, which the
 * scheduler consults before the table (scheduler/testing/mocks.ts).
 */

import type { Definition } from '../../definition/definition.ts';
import type { FunctionId } from '../../definition/operands.ts';
import type { CodeFunction } from '../../definition/tables/functions.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import { type Native, type Natives, requireNatives } from '../natives.ts';

/** What a call runs: a code entry, or a native. */
type Callable =
  | { readonly kind: 'code'; readonly function: FunctionId; readonly code: CodeFunction }
  | { readonly kind: 'native'; readonly native: Native };

export class FunctionTable {
  readonly #entries: readonly Callable[];

  constructor(definition: Definition, natives: Natives) {
    requireNatives(definition.functions, natives);
    this.#entries = definition.functions.map(
      (entry, index): Callable =>
        entry.kind === 'code'
          ? { kind: 'code', function: index, code: entry }
          : {
              kind: 'native',
              native: natives[entry.key] ?? unreachable(`No native ${entry.key}.`),
            },
    );
  }

  /** What a call to entry `index` runs now. */
  callee(index: FunctionId): Callable {
    const callable = this.#entries[index];
    if (callable === undefined) {
      unreachable(`No function ${index}; loading checks every index.`);
    }
    return callable;
  }
}

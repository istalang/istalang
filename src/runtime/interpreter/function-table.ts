/**
 * The function table of a loaded Definition: every entry bound to what runs when it is called.
 *
 * A code entry runs its instructions; an extern entry runs the native its key names, bound once
 * at load, so a Definition whose natives are missing is refused, naming them, before anything
 * runs. Every call goes through `callee`, so replacing an entry changes what every call to it
 * runs: the one place `mock` replaces a function (§10).
 */

import type { Definition } from '../../definition/definition.ts';
import type { CodeFunction } from '../../definition/functions.ts';
import type { FunctionId } from '../../definition/operands.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { Native, Natives } from '../natives.ts';
import { Refusal } from '../refusal.ts';

/** What a call runs: a code entry, or a native. */
export type Callable =
  | { readonly kind: 'code'; readonly function: FunctionId; readonly code: CodeFunction }
  | { readonly kind: 'native'; readonly native: Native };

export class FunctionTable {
  readonly #entries: Callable[];

  constructor(definition: Definition, natives: Natives) {
    const missing: string[] = [];
    this.#entries = definition.functions.map((entry, index): Callable => {
      if (entry.kind === 'code') {
        return { kind: 'code', function: index, code: entry };
      }
      const native = natives[entry.key];
      if (native === undefined) {
        missing.push(entry.key);
        return { kind: 'native', native: () => null };
      }
      return { kind: 'native', native };
    });
    if (missing.length > 0) {
      throw new Refusal('missingNatives', `No native implements ${missing.join(', ')}.`);
    }
  }

  /** What a call to entry `index` runs now. */
  callee(index: FunctionId): Callable {
    const callable = this.#entries[index];
    if (callable === undefined) {
      unreachable(`No function ${index}; loading checks every index.`);
    }
    return callable;
  }

  /** Makes every later call to entry `index` run `replacement` instead. */
  replace(index: FunctionId, replacement: Callable): void {
    this.callee(index);
    this.#entries[index] = replacement;
  }
}

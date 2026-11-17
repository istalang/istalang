/**
 * The calls compiled code makes through a function value of a few arguments, most of a program's
 * closure calls (codegen/calling-convention.ts `directCallArities`): the value's entry runs at once
 * where it is a plain function (`runsOnFrames`) taking exactly that many, with no array of
 * arguments, else as `Run.callValue` calls it (an async entry's start, an extern, defaults left
 * out). One helper per count, as each spares the array only by taking its arguments as its own.
 */

import { directCallArities, runsOnFrames } from '../../codegen/calling-convention.ts';
import type { Definition } from '../../definition/tables/index.ts';
import type { Value } from '../../definition/values/values.ts';
import { memo } from '../../foundation/structures/memo.ts';
import type { Run } from './run.ts';

type Plain = (...given: unknown[]) => unknown;

const directArities = new WeakMap<Definition, Int16Array>();

/**
 * For each entry of `definition`, the number of parameters it takes where it is a plain function,
 * which a call passing exactly that many runs at once; else -1.
 */
export function directAritiesOf(definition: Definition): Int16Array {
  return memo(directArities, definition, () =>
    Int16Array.from(definition.functions, (entry) =>
      entry.kind === 'code' && !runsOnFrames(entry) ? entry.parameters.length : -1,
    ),
  );
}

export class ClosureCalls {
  readonly #run: Pick<Run, 'entries' | 'callValue'>;
  readonly #arities: Int16Array;

  /** Over `run`'s entries of `definition`, which it reads as it calls, once the run has them. */
  constructor(run: Pick<Run, 'entries' | 'callValue'>, definition: Definition) {
    this.#run = run;
    this.#arities = directAritiesOf(definition);
  }

  readonly callValue0 = (callee: Value): unknown => {
    const direct = this.#directOf(callee, 0);
    return direct === undefined ? this.#run.callValue(callee, []) : direct(callee);
  };

  readonly callValue1 = (callee: Value, a: Value): unknown => {
    const direct = this.#directOf(callee, 1);
    return direct === undefined ? this.#run.callValue(callee, [a]) : direct(a, callee);
  };

  readonly callValue2 = (callee: Value, a: Value, b: Value): unknown => {
    const direct = this.#directOf(callee, 2);
    return direct === undefined ? this.#run.callValue(callee, [a, b]) : direct(a, b, callee);
  };

  // The last helper takes the most: `directCallArities`.
  readonly callValue3 = (callee: Value, a: Value, b: Value, c: Value): unknown => {
    const direct = this.#directOf(callee, directCallArities);
    return direct === undefined ? this.#run.callValue(callee, [a, b, c]) : direct(a, b, c, callee);
  };

  /** The entry of `callee`, a function value, where it is a plain function taking `count`. */
  #directOf(callee: Value, count: number): Plain | undefined {
    const index = (callee as { readonly function: number }).function;
    return this.#arities[index] === count ? (this.#run.entries[index] as Plain) : undefined;
  }
}

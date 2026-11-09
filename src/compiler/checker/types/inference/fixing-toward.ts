/**
 * Fixing what postponed placeholders wait on when none of them knows yet what is expected of it
 * (i2-scope.md §3), as Kotlin's inference fixes a variable a postponed argument is stuck on: what
 * settles a stuck variable is its bounds free of the placeholders, read through the system's
 * reading (system-reading.ts), so fixing proposes and the system fixes (infer.ts `fixToward`).
 */

import type { Substitution } from '../parts/substitution.ts';
import { parametersIn } from '../parts/type-parts.ts';
import type { ParameterKey, Type } from '../type/index.ts';
import { hasBounds, type Settling, type SettlingView, settleOne } from './settle.ts';
import { type SystemReading, tentativeSubstitution } from './system-reading.ts';
import { type Bound, mentionedBy } from './variable-bounds.ts';

/**
 * What to fix the variables placeholders `waiting` wait on to, when none of them knows yet what is
 * expected of it (i2-scope.md §3), as Kotlin's inference fixes a variable a postponed argument is
 * stuck on: each one not fixed yet whose bounds mention a variable a placeholder is related to,
 * or that such a variable's bounds mention, settled by its other bounds, what the variables they
 * mention tell so far in their place, so a sibling of a type of its own tells the placeholders
 * theirs: `[Ok(1)]` beside an `Array<Result<Int, String>>` for one `T`, and `[]` beside `[1]` and
 * `[2, 3]` their `Array<Int>`.
 */
export function fixingToward(
  waiting: readonly ParameterKey[],
  reading: SystemReading,
  view: SettlingView,
  settlingOf: (variable: ParameterKey) => Settling,
): ReadonlyMap<ParameterKey, Type> {
  const near = new Set(waiting);
  for (const placeholder of waiting) {
    const { below, above } = reading.relatedOf(placeholder);
    for (const related of [...below, ...above]) {
      near.add(related);
    }
  }
  const mentionedNear = new Set([...near].flatMap((each) => mentionedBy(reading.boundsOf(each))));
  // What every variable tells so far is read only once one turns out stuck, as few do.
  let told: Substitution | undefined;
  const toldSoFar = (): Substitution => {
    told ??= tentativeSubstitution(reading, reading.variables());
    return told;
  };
  const isStuck = (variable: ParameterKey) =>
    !near.has(variable) &&
    (mentionedNear.has(variable) ||
      mentionedBy(reading.boundsOf(variable)).some((key) => near.has(key))) &&
    reading.fixedOf(variable) === undefined;
  const fixing = new Map<ParameterKey, Type>();
  for (const variable of reading.variables()) {
    const type = isStuck(variable)
      ? settledByFree(variable, settlingOf(variable), { near, view, told: toldSoFar })
      : undefined;
    if (type !== undefined && !parametersIn(type).some(reading.isVariable)) {
      fixing.set(variable, type);
    }
  }
  return fixing;
}

/**
 * What `variable` settles to by its bounds that mention nothing `near`, what the variables they
 * mention tell so far in their place; undefined where none is free.
 */
function settledByFree(
  variable: ParameterKey,
  settling: Settling,
  { near, view, told }: Fixing,
): Type | undefined {
  const isFree = ({ type }: Bound) => !parametersIn(type).some((key) => near.has(key));
  const { equal, lower, upper } = view.boundsOf(variable);
  const free = {
    equal: equal !== undefined && isFree(equal) ? equal : undefined,
    lower: lower.filter(isFree),
    upper: upper.filter(isFree),
  };
  if (!hasBounds(free)) {
    return undefined;
  }
  const freeView = {
    ...view,
    boundsOf: (each: ParameterKey) => (each === variable ? free : view.boundsOf(each)),
  };
  return settleOne(variable, told(), freeView, settling);
}

/** What fixing a stuck variable reads (`fixingToward`). */
interface Fixing {
  /** The placeholders waiting, and the variables they are related to. */
  readonly near: ReadonlySet<ParameterKey>;
  readonly view: SettlingView;
  /** What every variable tells so far. */
  readonly told: () => Substitution;
}

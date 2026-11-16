/**
 * The functions the language's constructs call by name, with no call written in the source (§2,
 * §3.8–§3.12, §4, §7): indexing and iteration, conversions, templates, a range's inclusive end,
 * array patterns, panics and disposal.
 */

/** The functions collections go through (§3.9, §3.10): `x[k]`, `x[k] = v`, `for` and spreads. */
export const collectionFunctions = {
  index: 'index',
  setIndex: 'setIndex',
  iterate: 'iterate',
} as const;

/**
 * The functions an untagged template calls (§2): each value's `toString`, as a method, and the
 * prelude's `join` of its texts and values.
 */
export const templateFunctions = {
  toString: 'toString',
  join: 'join',
} as const;

/** The range `..=` builds, its end one past the written end in the step's direction (§3.8). */
export const inclusiveRangeFunction = '_inclusiveRange';

/**
 * What an array pattern calls in the prelude once its length test passed (§3.11): its length, an
 * item counted from the start or, when negative, from the end, and the items between.
 */
export const arrayPatternFunctions = {
  length: 'length',
  item: '_patternItem',
  rest: '_patternRest',
} as const;

/**
 * What a collection converted part by part calls in the prelude (§3.5): an array's `map` of its
 * items, and a map's `_mapValues`, its keys kept.
 */
export const partConversionFunctions = { items: 'map', values: '_mapValues' } as const;

/** The static function a conversion `T(x)` calls (§3.10). */
export const conversionFunction = 'from';

/** What `x!` calls on none (§4), and what a program calls to panic (§3.12). */
export const panicFunction = 'panic';

/** What `await` and each `select` case call on what they wait on (proposal 8, Rule 5). */
export const awaitFunction = 'onAwait';

/**
 * What lowering calls around a wait (proposal 8, Rule 5): the prelude's new wait of the running
 * call; the resolver of one of its cases, which puts the value it is resolved with into the case's
 * shared value and decides the wait for the case's position; and, for a `select` with an `else`,
 * the position a wait was decided for at once, or -1, the wait then given up.
 */
/**
 * What a host extern's wrapper calls for a future its host fills (§9): a pending future of the
 * prelude's, and the callback resolving it, which the host's native is given.
 */
export const hostFutureFunction = '_filled';

export const waitFunctions = {
  wait: '_wait',
  caseResolver: '_caseResolver',
  decided: '_decided',
} as const;

/** The function `Disposable` requires (§3.10, §7). */
export const disposeFunction = 'dispose';

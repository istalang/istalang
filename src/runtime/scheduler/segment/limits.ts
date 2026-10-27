/**
 * The engine's limits as panics (§3.12): a string, an array or an integer larger than JavaScript can
 * hold is a limit the program ran into, not a bug, so whatever native or instruction builds one
 * panics. The engine says so only with a RangeError and its message, so the messages are matched
 * here, the one place that reads them; any other RangeError is a bug and propagates.
 */

import { Panic } from '../../natives.ts';

/** What each limit's RangeError says, as V8 words it, and what the panic says instead. */
const limits = new Map([
  ['Invalid string length', 'The string would be longer than the runtime can hold.'],
  ['Invalid array length', 'The array would be longer than the runtime can hold.'],
  ['Maximum BigInt size exceeded', 'The integer would be larger than the runtime can hold.'],
]);

/** The panic `error` stands for: a Panic itself, or one for a limit the program ran into. */
export function panicOf(error: unknown): Panic | undefined {
  if (error instanceof Panic) {
    return error;
  }
  const limit = error instanceof RangeError ? limits.get(error.message) : undefined;
  return limit === undefined ? undefined : new Panic(limit, { cause: error });
}

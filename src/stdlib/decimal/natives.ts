/**
 * The `decimal` module's natives (decimal.ista): a Decimal's one form, which its module's code
 * computes and the runtime only keeps. The payload is that form, its units and scale, so `==` and
 * a snapshot compare and keep exactly it; a snapshot round trip may give a safe int back as a
 * number, which reads as the same int.
 */

import type { Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { NativeContext, Natives } from '../../runtime/natives.ts';
import type { NativeKeys } from '../std-module.ts';
import { externPayloadOf, int } from '../values/arguments.ts';
import { resultExtern } from '../values/results.ts';

export const decimalNatives = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('_decimal', 'Int', 'Int')]: ([units, scale], context) =>
    resultExtern(context, [int(units), int(scale)]),
  [keys.of('_parts', keys.type('Decimal'))]: ([value]) => ({
    kind: 'tuple',
    elements: partsOf(value),
  }),
});

/** The units and the scale a Decimal's payload holds. */
function partsOf(value: Value | undefined): bigint[] {
  const payload = externPayloadOf(value);
  if (!Array.isArray(payload)) {
    unreachable('A Decimal holds its units and scale.');
  }
  return payload.map((part: unknown) =>
    typeof part === 'bigint' || typeof part === 'number'
      ? BigInt(part)
      : unreachable('A Decimal holds ints.'),
  );
}

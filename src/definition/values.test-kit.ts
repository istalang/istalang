/**
 * Random persisted values, for round-trip properties over Definitions and snapshots.
 *
 * The generators reach the cases the codec must survive: integers far outside the double range,
 * every float JSON can't write (NaN, ±Infinity, -0, large whole numbers), lone surrogates in
 * strings, and deep nesting. `typed` adds kinds that name types and functions, which only
 * shape-level tests can use, since their ids point nowhere. `handles` lists the object ids a
 * value may hold.
 */

import fc from 'fast-check';
import { exactJson } from './codec.test-kit.ts';
import type { Value } from './values.ts';

export interface ValueOptions {
  readonly typed?: boolean;
  readonly handles?: readonly number[];
}

const scalar: fc.Arbitrary<Value> = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.string({ unit: 'binary' }),
  fc.bigInt({ min: -(2n ** 200n), max: 2n ** 200n }),
  fc.bigInt({ min: -10n, max: 10n }),
  fc.double(),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, 2 ** 60),
);

/** Values of every kind allowed by `options`. */
export function valueArbitrary(options: ValueOptions = {}): fc.Arbitrary<Value> {
  const { typed = false, handles = [] } = options;
  const id = fc.nat({ max: 50 });
  const { value } = fc.letrec<{ value: Value }>((tie) => {
    const values = fc.array(tie('value'), { maxLength: 4 });
    const composites: fc.Arbitrary<Value>[] = [
      values.map((elements) => ({ kind: 'tuple', elements })),
      values.map((elements) => ({ kind: 'array', elements })),
      fc
        .array(fc.tuple(tie('value'), tie('value')), { maxLength: 3 })
        .map((entries) => ({ kind: 'map', entries })),
    ];
    const typedKinds: fc.Arbitrary<Value>[] = [
      fc.record({ type: id, fields: values }).map((parts) => ({ kind: 'struct', ...parts })),
      fc
        .record({ type: id, variant: fc.nat({ max: 5 }), fields: values })
        .map((parts) => ({ kind: 'variant', ...parts })),
      fc.record({ function: id, captures: values }).map((parts) => ({ kind: 'closure', ...parts })),
      fc.record({ type: id, payload: exactJson }).map((parts) => ({ kind: 'extern', ...parts })),
    ];
    const handleKinds: fc.Arbitrary<Value>[] =
      handles.length === 0
        ? []
        : [fc.constantFrom(...handles).map((object) => ({ kind: 'handle', object }))];
    return {
      value: fc.oneof(
        { depthSize: 'small', maxDepth: 4 },
        scalar,
        ...composites,
        ...(typed ? typedKinds : []),
        ...handleKinds,
      ),
    };
  });
  return value;
}

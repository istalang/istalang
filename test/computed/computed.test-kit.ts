/**
 * Helpers of the computed-type tests alone (docs/proposals/4-computed-types.md), beside the
 * written-type probes they share with the union tests (../written-types.test-kit.ts): the
 * observation of two identical types, where a name resolves, a format round trip, and random struct
 * shapes for property tests.
 */

import fc from 'fast-check';
import { dump } from '../../src/compiler/syntax/tree/tree.test-kit.ts';
import { programAt } from '../../src/editor/language-service/language-service.test-kit.ts';
import { nameAt } from '../../src/editor/language-service/navigation/declarations.ts';
import { placeOf } from '../../src/editor/language-service/navigation/navigation.test-kit.ts';
import { parseText } from '../../src/formatter/format.test-kit.ts';
import { formatText } from '../../src/formatter/format.ts';
import type { TypeComparison } from '../written-types.test-kit.ts';

/** Expected observation when two written types are identical and mutually assignable. */
export const sameComputedType: TypeComparison = {
  syntaxErrors: [],
  same: true,
  sameKey: true,
  assignCodes: [],
};

/** Declaration places (`module:line:col:text`) that the identifier at `‸` resolves to. */
export function declaredPlacesAt(...lines: readonly string[]): readonly string[] {
  const { program, module, offset } = programAt(...lines);
  const found = nameAt(program, module, offset);
  return (found?.declarations ?? []).map(({ at }) => placeOf(program, at));
}

/** Formatting `source` twice, and the syntax tree's dump before and after. */
export interface FormattedRoundTrip {
  readonly formatted: string | undefined;
  readonly twice: string | undefined;
  readonly dumpBefore: string;
  readonly dumpAfter: string | undefined;
}

/** Formats `source` twice and dumps its syntax tree before and after. */
export function formatRoundTrip(source: string): FormattedRoundTrip {
  const treeBefore = parseText(source);
  const formatted = formatText(source);
  const twice = formatted === undefined ? undefined : formatText(formatted);
  const treeAfter = formatted === undefined ? undefined : parseText(formatted);
  return {
    formatted,
    twice,
    dumpBefore: dump(treeBefore, treeBefore.root),
    dumpAfter: treeAfter === undefined ? undefined : dump(treeAfter, treeAfter.root),
  };
}

/** A generated struct field with a name, type, initial literal, and alternate literal. */
export interface GeneratedField {
  readonly name: string;
  readonly type: 'Int' | 'String' | 'Bool';
  readonly value: string;
  readonly nextValue: string;
}

const fieldPool: GeneratedField[] = [
  { name: 'zeta', type: 'Int', value: '10', nextValue: '11' },
  { name: 'alpha', type: 'String', value: '"a"', nextValue: '"b"' },
  { name: 'mu', type: 'Bool', value: 'true', nextValue: 'false' },
  { name: 'beta', type: 'Int', value: '20', nextValue: '21' },
  { name: 'omega', type: 'String', value: '"z"', nextValue: '"y"' },
];

/**
 * Arbitrary non-empty subset of fields in arbitrary declaration order (to test name-order rules).
 */
export const generatedFieldsArbitrary: fc.Arbitrary<readonly GeneratedField[]> = fc
  .shuffledSubarray(fieldPool, { minLength: 1, maxLength: 5 })
  .map((items) => [...items]);

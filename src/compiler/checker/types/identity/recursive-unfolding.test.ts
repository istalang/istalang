/**
 * The commutation law of a recursive alias use and what it unfolds to (§3.17, proposal 5 note 11),
 * over every kind a body can be (a tuple, a function, a nominal type, a shape, a union): the two
 * are one type by key, and a literal of generated nesting built against the alias runs to the value
 * the same literal built against the body written out gives, passed where the alias is expected.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mainGives } from '../../../../stdlib/prelude/prelude.test-kit.ts';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { lines } from '../../../parser/parse.test-kit.ts';
import { idOf } from '../../../program/program.test-kit.ts';
import { programModule } from '../../../program/program.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations.ts';
import { checkProgram } from '../../check.ts';
import { unfoldRecursive } from '../computed-types.ts';
import { sameType } from './identity.ts';
import { typeKeys } from './type-keys.ts';

/** A recursive alias `R` of one body kind: its body, a literal of `depth` levels, and its measure. */
interface BodyKind {
  readonly name: string;
  readonly body: string;
  readonly literal: (depth: number) => string;
  /** A function `measure(r: R) -> Int` counting the levels a value of `R` has. */
  readonly measure: string;
}

/** `depth` levels of `wrap`, around `innermost`. */
function nested(depth: number, innermost: string, wrap: (inner: string) => string): string {
  return depth === 0 ? innermost : wrap(nested(depth - 1, innermost, wrap));
}

const kinds: readonly BodyKind[] = [
  {
    name: 'tuple',
    body: '(Int, R?)',
    literal: (depth) => nested(depth, '(1, none)', (inner) => `(1, ${inner})`),
    measure: lines(
      'fn measure(r: R) -> Int:',
      '  match r.1:',
      '    case None: return 1',
      '    case R as next: return 1 + measure(next)',
    ),
  },
  {
    name: 'nominal',
    body: 'Array<R>',
    literal: (depth) => nested(depth, '[]', (inner) => `[${inner}]`),
    measure: lines(
      'fn measure(r: R) -> Int:',
      '  for item in r:',
      '    return 1 + measure(item)',
      '  return 1',
    ),
  },
  {
    name: 'shape',
    body: '{ head: Int, tail: R? }',
    literal: (depth) =>
      nested(depth, 'struct{head: 1, tail: none}', (inner) => `struct{head: 1, tail: ${inner}}`),
    measure: lines(
      'fn measure(r: R) -> Int:',
      '  match r.tail:',
      '    case None: return 1',
      '    case R as next: return 1 + measure(next)',
    ),
  },
  {
    name: 'union',
    body: 'Int | Array<R>',
    literal: (depth) => nested(depth, '1', (inner) => `[${inner}]`),
    measure: lines(
      'fn measure(r: R) -> Int:',
      '  match r:',
      '    case Int: return 1',
      '    case Array<R> as items:',
      '      for item in items:',
      '        return 1 + measure(item)',
      '      return 1',
    ),
  },
];

describe('a recursive use and what it unfolds to', () => {
  it('are one type by key, whatever the body kind, alone and inside a container', () => {
    const bodies = [...kinds.map((kind) => kind.body), 'fn(Int) -> R'];
    for (const body of bodies) {
      const program = stdProgramOf({
        'main.ista': `type R = ${body}\nfn check(r: R, rs: Array<R>): ()`,
      });
      const checker = checkProgram(program);
      const check = programModule(program, idOf('main.ista')).tree.root.items.find(
        (item): item is FunctionDeclaration => item.kind === 'FunctionDeclaration',
      );
      const [use, array] =
        check === undefined ? [] : checker.parametersOf(check).map((p) => p.type);
      if (use?.kind !== 'recursive' || array?.kind !== 'nominal') {
        throw new Error(`Expected a recursive use and an array of it for ${body}`);
      }
      const unfolding = unfoldRecursive(use);
      expect(sameType(unfolding, use)).toBe(true);
      expect(typeKeys.typeKey(unfolding)).toBe(typeKeys.typeKey(use));
      const ofUnfolding = { ...array, arguments: [unfolding] };
      expect(typeKeys.typeKey(ofUnfolding)).toBe(typeKeys.typeKey(array));
    }
  });

  it('build a literal of any nesting to one value, against the alias or its body written out', () => {
    fc.assert(
      fc.property(fc.constantFrom(...kinds), fc.nat({ max: 3 }), (kind, depth) => {
        const literal = kind.literal(depth);
        const declarations = lines(
          `type R = ${kind.body}`,
          kind.measure,
          `fn asAlias() -> R: ${literal}`,
          `fn asBody() -> ${kind.body}: ${literal}`,
        );
        const alias = mainGives('Int', 'return measure(asAlias())', declarations);
        const body = mainGives('Int', 'return measure(asBody())', declarations);
        expect(alias).toBe(depth + 1);
        expect(body).toBe(alias);
      }),
      { numRuns: 24 },
    );
  });

  it('build a literal mixing items only checking types with items of other types, wherever it goes', () => {
    fc.assert(
      fc.property(mixedItems, (literal) => {
        const declarations = lines(
          'type R = Int | String | Array<R>',
          'fn one() -> Int: 1',
          'fn ints() -> Array<Int>: [1, 2]',
          'fn weight(r: R) -> Int:',
          '  match r:',
          '    case Int as n: return n',
          '    case String: return 1',
          '    case Array<R> as items:',
          '      let total = 0',
          '      for item in items:',
          '        total += weight(item)',
          '      return total',
          `fn asAlias() -> R: ${literal.text}`,
          `fn asBody() -> Int | String | Array<R>: ${literal.text}`,
          'fn passed(r: R) -> R: r',
          `fn asArgument() -> R: passed(${literal.text})`,
          'fn asConstant() -> R:',
          `  const r: R = ${literal.text}`,
          '  return r',
        );
        for (const built of ['asAlias()', 'asBody()', 'asArgument()', 'asConstant()']) {
          expect(mainGives('Int', `return weight(${built})`, declarations)).toBe(literal.weight);
        }
      }),
      { numRuns: 24 },
    );
  });
});

/** A literal of `R = Int | String | Array<R>` as written, and what `weight` counts of its value. */
interface Mixed {
  readonly text: string;
  readonly weight: number;
}

/**
 * Arrays nesting items of every kind: a literal Int or String, which have types of their own, and
 * arithmetic, a call or a spread of a call's array, whose types only checking tells, side by side
 * at any depth.
 */
const mixedItems: fc.Arbitrary<Mixed> = fc.letrec<{ item: Mixed; array: Mixed }>((tie) => ({
  item: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.constant({ text: '2', weight: 2 }),
    fc.constant({ text: '"s"', weight: 1 }),
    fc.constant({ text: '1 + 1', weight: 2 }),
    fc.constant({ text: 'one()', weight: 1 }),
    fc.constant({ text: '...ints()', weight: 3 }),
    tie('array'),
  ),
  array: fc.array(tie('item'), { minLength: 1, maxLength: 3 }).map((items) => ({
    text: `[${items.map((item) => item.text).join(', ')}]`,
    weight: items.reduce((total, item) => total + item.weight, 0),
  })),
})).array;

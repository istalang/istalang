/**
 * A program the checker accepts lowers (§3.1, §3.17): with no error reported, no type it uses is
 * the error type or a type `match` use left unreduced, whatever its aliases forward to, recurse
 * through or reduce to, so lowering never meets a type a diagnostic should have explained.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { compileProgram, diagnose } from '../../compile.ts';
import { idOf } from '../../program/program.test-kit.ts';
import { programModule } from '../../program/program.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import { checkProgram } from '../check.ts';
import { computedTypesIn, errorIn } from '../types/parts/type-parts.ts';
import type { Type } from '../types/type.ts';

/** Aliases to build `A`, `B` and `S.Data` from: transparent, forwarding, union-making and matching. */
const helpers = [
  'type Id<T> = T',
  'type OrInt<T> = T | Int',
  'type IdMatch<T> = match T:',
  '  case _: T',
  'type Wrap<T> = match T:',
  '  case _: Int | Array<T>',
  'struct Box<T> { value: T }',
];

/** A type built from `X`, guarded or not, through each kind of alias and type. */
const shapes = [
  'X',
  'Id<X>',
  'OrInt<X>',
  'IdMatch<X>',
  'Wrap<X>',
  'Int | Array<X>',
  'Array<X>',
  'Box<X>',
  'X?',
  '{ v: X }',
];

const typeBuilt = fc
  .tuple(fc.constantFrom(...shapes), fc.constantFrom('A', 'B', 'Int'))
  .map(([shape, inner]) => shape.replace('X', inner));

const dataBuilt = fc
  .tuple(fc.constantFrom(...shapes), fc.constantFrom('S.Data', 'Int'))
  .map(([shape, inner]) => shape.replace('X', inner));

/** A program of the helpers, `A`, `B` and a struct whose `Data` is a type `match`, all used. */
function programText(a: string, b: string, data: string): string {
  return [
    ...helpers,
    'struct S:',
    '  x: Int',
    '  type Data = match Int:',
    `    case Int: ${data}`,
    `type A = ${a}`,
    `type B = ${b}`,
    'fn f(a: A, b: B, d: S.Data) -> Int: 0',
    'async fn main() -> Future<Int>:',
    '  0',
  ].join('\n');
}

/** Why a type lowering would meet is none: the error type, or a type `match` use not reduced. */
function unexplained(type: Type): string | undefined {
  if (errorIn(type) !== undefined) {
    return 'the error type';
  }
  return computedTypesIn(type).some((computed) => computed.kind === 'match')
    ? 'an unreduced type match'
    : undefined;
}

describe('a program the checker accepts', () => {
  it('uses no type a diagnostic should have explained, and lowers', () => {
    fc.assert(
      fc.property(typeBuilt, typeBuilt, dataBuilt, (a, b, data) => {
        const program = stdProgramOf({ main: programText(a, b, data) });
        const errors = [...diagnose(program).values()]
          .flatMap(({ diagnostics }) => diagnostics)
          .filter((diagnostic) => diagnostic.severity === 'error');
        if (errors.length > 0) {
          return;
        }
        const f = programModule(program, idOf('main')).tree.root.items.find(
          (item): item is FunctionDeclaration =>
            item.kind === 'FunctionDeclaration' && item.name.text === 'f',
        );
        const types = f === undefined ? [] : checkProgram(program).parametersOf(f);
        expect(types.map((parameter) => unexplained(parameter.type))).toEqual(
          types.map(() => undefined),
        );
        expect(compileProgram(program, idOf('main')).kind).toBe('compiled');
      }),
      { numRuns: 300 },
    );
  });
});

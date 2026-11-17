/**
 * A Definition never shows the order lowering reached its entries in (docs/arch/definition.md,
 * "Names"): a program lowered with its pending entries taken in any order gives the bytes it gives
 * lowered first asked first. The program reaches what an order could show: an `any` type's variants
 * met in an order apart from their keys' and named by code before every one is met, closures of
 * one source function's instances, conversions of parts and functions made async met from several
 * sites, and the job server a `delegate` reaches.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { encodeDefinition } from '../../definition/definition.ts';
import { isError } from '../../foundation/diagnostics/diagnostic.ts';
import { stdProgramOf } from '../binder/bind.test-kit.ts';
import { checkedAfterStd, wholeProgramTimeout } from '../compile.test-kit.ts';
import { diagnose, mainOf } from '../compile.ts';
import { idOf } from '../program/program.test-kit.ts';
import { lower } from './lower.ts';
import { StdLowering } from './tables/std-lowering.ts';

const main = [
  "import * as runtime from 'runtime'",
  'trait Named:',
  '  fn name(self: Self) -> String',
  'struct Email { to: String }',
  'struct Sms { number: String }',
  'struct Post { street: String }',
  'fn name(self: Email) -> String: self.to',
  'fn name(self: Sms) -> String: self.number',
  'fn name(self: Post) -> String: self.street',
  'fn made<T>(x: T) -> fn() -> Int: fn() -> Int: 1',
  'fn one() -> Int: 1',
  'fn bySms() -> any Named: Sms{number: "1"}',
  'fn byPost() -> any Named: Post{street: "s"}',
  'fn isEmail(named: any Named) -> Bool:',
  '  if named is Email as email: return email.to == "a"',
  '  false',
  'fn widened(values: Array<Int>) -> Array<Int?>: values',
  'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
  'ista async fn _main() -> Int:',
  '  const later: ista async fn() -> Int = one',
  '  const named: Array<any Named> = [bySms(), Email{to: "a"}, byPost()]',
  '  const maybes: Array<Int?> = widened([1, 2])',
  '  const delegated = await runtime.delegate(fn() -> Int: 4)',
  '  if isEmail(named[1]) and made(1) == made([1]) and maybes.length() == 2:',
  '    return delegated + (await later())',
  '  0',
].join('\n');

/** The program's checker, made once; throws where the program has an error. */
function checkedProgram() {
  const program = stdProgramOf({ main });
  const checker = checkedAfterStd(program);
  const errors = [...diagnose(program).values()].flatMap(({ diagnostics }) =>
    diagnostics.filter(isError).map(({ message }) => message),
  );
  const entry = mainOf(program, idOf('main'));
  if (errors.length > 0 || entry === undefined) {
    throw new Error(`The program doesn't compile: ${errors.join('; ')}`);
  }
  return { checker, entry };
}

describe('a program lowered', () => {
  it(
    'gives one Definition whichever pending entry lowering takes next',
    () => {
      const { checker, entry } = checkedProgram();
      const hashOf = (order?: (count: number) => number) =>
        encodeDefinition(
          lower(checker, entry, {
            std: new StdLowering(),
            ...(order === undefined ? {} : { order }),
          }),
        ).hash;
      const asked = hashOf();
      fc.assert(
        fc.property(fc.array(fc.nat(), { minLength: 1, maxLength: 64 }), (picks) => {
          let next = 0;
          const order = (count: number) => {
            next += 1;
            return (picks[next % picks.length] ?? 0) % count;
          };
          expect(hashOf(order)).toBe(asked);
        }),
        { numRuns: 8 },
      );
    },
    wholeProgramTimeout,
  );
});

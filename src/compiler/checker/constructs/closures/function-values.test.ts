/**
 * Functions named as values with type arguments written after the name (§3.5, §3.14): every way
 * of naming a function takes them, and the value is the function they instantiate, whatever types
 * they are. What each refusal reports is a corpus program
 * (`test/corpus/generics/invalid-applied-function-values.ista`), which states its positions.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reportedNothing } from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { lines } from '../../../parser/parse.test-kit.ts';
import type { TypeApplication } from '../../../syntax/expressions/index.ts';
import { reported } from '../../check.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { checkedMain } from '../../lookup/lookup.test-kit.ts';
import { typeText } from '../../types/type/type-text.ts';

const declarations = [
  'struct Box<T> { item: T }',
  'fn Box.of<T>(item: T) -> Box<T>: Box{item}',
  'fn listed<T>(value: T) -> Array<T>: [value]',
].join('\n');

const lib = 'fn listed<T>(value: T) -> Array<T>: [value]\n';

/** Types to write as type arguments, each as it is written and as messages print it. */
const writtenTypes = fc.constantFrom('Int', 'String', 'Array<Bool>', '(Int, String)', 'Float?');

/** Each way of naming a function given `type`, with the function type it is the value of. */
const namings = (type: string): readonly (readonly [string, string])[] => [
  [`listed<${type}>`, `sendable fn(${type}) -> Array<${type}>`],
  [`lib.listed<${type}>`, `sendable fn(${type}) -> Array<${type}>`],
  [`Box.of<${type}>`, `sendable fn(${type}) -> Box<${type}>`],
  [`Result.Ok<${type}, String>`, `sendable fn(${type}) -> Result<${type}, String>`],
];

/** The type checking `main` gave the value `naming` makes, alone in its body. */
function valueTypeOf(naming: string): string | undefined {
  const text = `import * as lib from 'lib'\n${declarations}\nfn main():\n  const value = ${naming}\n  drop value\n`;
  const { checker, module, first } = checkedMain(text, { lib });
  const node = first('TypeApplication') as TypeApplication;
  const type = checker.lookup.bodyHolding(module, node)?.typeOf(node);
  return type && typeText(type);
}

describe('a function named as a value with type arguments', () => {
  it('is the function they instantiate, named plainly, through a namespace, a type or an enum', () => {
    fc.assert(
      fc.property(writtenTypes, (type) => {
        for (const [naming, expected] of namings(type)) {
          expect(valueTypeOf(naming)).toBe(expected);
        }
      }),
      { numRuns: 10 },
    );
  });

  it('is a bare variant where the expected function type gives its enum', () => {
    const text =
      'fn main():\n  const ok: fn(Int) -> Result<Int, String> = Ok<Int, String>\n  drop ok\n';
    expect(reported(text)).toEqual(reportedNothing);
  });

  it('leaves a defaulted type parameter to the expected type, then to its default', () => {
    const inferred = 'const f: fn(Int) -> Result<Int, String> = Result.Ok<Int>';
    const defaulted = 'const g: fn(Int) -> Result<Int, Error> = Result.Ok<Int>';
    expect(reported(`fn main():\n  ${inferred}\n  ${defaulted}\n  drop f\n  drop g\n`)).toEqual(
      reportedNothing,
    );
  });

  it("gives a generic call the type its parameter can't infer from the bare function", () => {
    const text =
      'fn d(vs: Array<Int>) -> Array<Result<Int, String>>: vs.map(Result.Ok<Int, String>)';
    expect(reported(text)).toEqual(reportedNothing);
  });

  it('leaves a defaulted type parameter to the call it is passed to', () => {
    const text = lines(
      'fn takeOk(f: fn(Int) -> Result<Int, String>) -> Int: { drop f; 0 }',
      'fn takeErr(f: fn(String) -> Result<Int, String>) -> Int: { drop f; 0 }',
      'fn main() -> Int:',
      '  const errors: Array<Result<Int, String>> = ["x"].map(Result.Err<Int>)',
      '  drop errors',
      '  takeOk(Result.Ok<Int>) + takeErr(Result.Err<Int>)',
    );
    expect(reported(text)).toEqual(reportedNothing);
  });

  it('has the one type its written type arguments fix, which chooses among overloads', () => {
    const text = lines(
      'struct Box<T> { item: T }',
      'fn listed<T>(x: T) -> Array<T>: [x]',
      'fn take<T>(f: fn(T) -> Array<T>) -> Int: { drop f; 1 }',
      'fn take<T>(f: fn(T) -> Box<T>) -> Int: { drop f; 2 }',
      'fn main() -> Int: take(listed<Int>)',
    );
    expect(reported(text)).toEqual(reportedNothing);
  });

  it('asks for a type parameter its written type arguments leave open with no default', () => {
    const text = lines(
      'fn f<A = Int, B>(b: B) -> B: b',
      'fn main():',
      '  const g = f<Int>',
      '  drop g',
    );
    expect(reported(text).codes).toEqual([checkerDiagnostics.cannotInfer.code]);
  });

  it("is the function member of an expected union, as the function's bare name is", () => {
    const text = lines(
      'fn pick<T>(x: T) -> T: x',
      'fn pick<T>(x: T, y: T) -> T: y',
      'fn main():',
      '  const a: (fn(Int) -> Result<Int, String>) | Int = Ok<Int, String>',
      '  const b: (fn(Int) -> Result<Int, String>) | Int = Result.Ok<Int>',
      '  const c: (fn(Int) -> Int) | Int = pick<Int>',
      '  drop a',
      '  drop b',
      '  drop c',
    );
    expect(reported(text)).toEqual(reportedNothing);
  });

  it('instantiates a pack written as a tuple type', () => {
    const text = lines(
      'fn id<...A>(...args: A) -> A: args',
      'fn main() -> (Int, String):',
      '  const f: fn(Int, String) -> (Int, String) = id<(Int, String)>',
      '  const g = id<(Int, String)>',
      '  drop g',
      '  f(1, "a")',
    );
    expect(reported(text)).toEqual(reportedNothing);
  });

  it('is the value an optional call calls, its type arguments the value’s, not the call’s', () => {
    const declared =
      'fn listed<T>(value: T) -> Array<T>: [value]\nfn plain(value: Int) -> Int: value';
    const applied = reported(`${declared}\nfn main():\n  drop listed<Int>?.(1)\n`).codes;
    const bare = reported(`${declared}\nfn main():\n  drop plain?.(1)\n`).codes;
    expect(applied).toEqual(bare);
    expect(applied).toHaveLength(1);
  });

  it('is shown on hover as the function it instantiates', () => {
    const text = `${declarations}\nfn main():\n  const value = listed<Int>\n  drop value\n`;
    const { checker, module, named } = checkedMain(text);
    const [denotation] = checker.lookup.denotationsOf(module, named('listed', 1));
    expect(denotation?.declared.kind).toBe('function');
    expect(denotation?.type && typeText(denotation.type)).toBe('sendable fn(Int) -> Array<Int>');
  });
});

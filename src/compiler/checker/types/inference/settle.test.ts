/**
 * Settling a call's type arguments (§3.5) by one policy, the expected type advising: inside the
 * result it chooses, at the top the call's value converts, and a written union is taken where no
 * lower bound joins. A call that checks without an expected type checks to the same instantiation
 * with its own result expected.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mainGives } from '../../../../stdlib/prelude/prelude.test-kit.ts';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { diagnosedAt } from '../../../compile.test-kit.ts';
import type { Call } from '../../../syntax/expressions/index.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { checkedMain } from '../../lookup/lookup.test-kit.ts';
import { typeText } from '../type/type-text.ts';

/** The codes of the errors `main` reports. */
function reportedErrors(main: string): readonly number[] {
  const { diagnostics } = diagnosedAt(stdProgramOf({ main }), 'main');
  return diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.code);
}

const declarations = [
  "import Json from 'json'",
  'type Status = "draft" | "sent" | "failed"',
  'fn pick<T>(a: T, b: T) -> T: a',
  'fn biggest<T is Comparable>(a: T, b: T) -> T: if a > b: a else: b',
  'fn sorted<T is Comparable>(xs: Array<T>) -> Array<T>: xs',
  'fn pair<T>(a: T, b: T) -> Array<T>: [a, b]',
  'struct Box<T> { value: T }',
  'fn single<T>(value: T) -> Box<T>: Box{value}',
  'fn holdsItem<T>(self: Array<T>, item: T) -> Bool: false',
];

const parameters =
  'fn main(vs: Array<Int>, a: Int, b: Int, xs: Array<Int>, fields: Map<String, Json>)';

function errorsOf(...statements: readonly string[]): readonly number[] {
  return reportedErrors(
    [...declarations, `${parameters}:`, ...statements.map((statement) => `  ${statement}`)].join(
      '\n',
    ),
  );
}

describe('the expected type, inside the result', () => {
  it.each([
    ['a variant named as a value', 'vs.map(Result.Ok)'],
    ['a lambda calling a qualified variant', 'vs.map(fn x: Result.Ok(x))'],
    ['a lambda calling a bare variant', 'vs.map(fn x: Ok(x))'],
  ])('gives %s its type arguments', (_case, call) => {
    expect(errorsOf(`const rs: Array<Result<Int, String>> = ${call}`)).toEqual([]);
  });

  it.each([
    ['an array', 'const ys: Array<Int?> = pair(1, 2)'],
    ['a struct', 'const box: Box<Int?> = single(5)'],
  ])('builds %s at the type it goes to', (_case, statement) => {
    expect(errorsOf(statement)).toEqual([]);
  });

  it('gives way where the parameter refuses it', () => {
    expect(errorsOf('const ys: Array<Int?> = sorted(xs)')).toEqual([]);
  });

  it('compiles and runs settled calls end to end', () => {
    const body = [
      'const vs = [10, 20]',
      'const r1: Array<Result<Int, String>> = vs.map(Result.Ok)',
      'const r2: Array<Result<Int, String>> = vs.map(fn x: Result.Ok(x + 1))',
      'const r3: Array<Result<Int, String>> = vs.map(fn x: Ok(x + 2))',
      'const ys: Array<Int?> = pair(1, 2)',
      'const box: Box<Int?> = single(5)',
      'const zs: Array<Int?> = sorted(vs)',
      'const top: Int? = biggest(3, 9)',
      'const status: Status = pick("draft", "sent")',
      'const fields: Map<String, Json> = ["k": 42]',
      'const j: Json = fields.get("k")',
      'const jNum = match j:',
      '  case Int as n: n',
      '  case _: 0',
      '`${r1.length()}:${r2.length()}:${r3.length()}:${ys[0] ?? 0}:${box.value ?? 0}:${zs[1] ?? 0}:${top ?? 0}:${status}:${jNum}`',
    ].join('\n');
    expect(mainGives('String', body, declarations.join('\n'))).toBe('2:2:2:1:5:20:9:draft:42');
  });

  it('decomposes a head against a union only when exactly one member matches', () => {
    expect(errorsOf('const x: Box<Int?> | String = single(5)')).toEqual([]);
    expect(errorsOf('const x: Box<Int> | String = single("bad")')).toEqual([
      checkerDiagnostics.typeMismatch.code,
    ]);
    expect(
      reportedErrors(
        [
          ...declarations,
          'fn emptyBox<T>() -> Box<T>: panic("empty")',
          'fn main():',
          '  const x: Box<Int> | Box<String> = emptyBox()',
        ].join('\n'),
      ),
    ).toEqual([checkerDiagnostics.cannotInfer.code]);
    expect(
      reportedErrors(
        [
          ...declarations,
          'fn main():',
          '  const x: Box<Int | String> | Box<Int?> = single(5)',
        ].join('\n'),
      ),
    ).toEqual([checkerDiagnostics.severalConversions.code]);
  });
});

describe('the expected type, at the top of the result', () => {
  it('lets the value convert rather than choosing', () => {
    expect(errorsOf('const top: Int? = biggest(a, b)')).toEqual([]);
  });

  it('is taken as a written union no lower bound joins to', () => {
    expect(errorsOf('const status: Status = pick("draft", "sent")')).toEqual([]);
  });

  it('reads a map value at its own type', () => {
    expect(errorsOf('const json: Json = fields.get("k")')).toEqual([]);
  });

  it('never makes a call take what its arguments refuse', () => {
    expect(errorsOf('const status: Status = pick(1, 2)')).toEqual([
      checkerDiagnostics.typeMismatch.code,
    ]);
  });
});

describe("a method's receiver", () => {
  it('gives its type arguments as they are, never widened by another argument', () => {
    expect(errorsOf('drop xs.holdsItem(none)')).toEqual([checkerDiagnostics.typeMismatch.code]);
  });

  it('refuses a wider argument among overloads alike', () => {
    expect(errorsOf('drop xs.includes(none)')).toEqual([
      checkerDiagnostics.noMatchingOverload.code,
    ]);
  });
});

describe('postponed arguments and bounds propagation', () => {
  it('joins a postponed lambda or function value result with other arguments lower bounds', () => {
    const helpers = [
      'fn inc(x: Int) -> Int: x + 1',
      'fn inc(x: String) -> String: x',
      'fn getOr<T, U>(x: T, f: fn(T) -> U, fallback: U) -> U: f(x)',
      'fn pairMap<T, U>(xs: Array<T>, f: fn(T) -> U, g: fn(T) -> U) -> Array<U>: [f(xs[0]), g(xs[0])]',
      'fn pipeFirst<A, B, C>(g: fn(B) -> C, fs: Array<fn(A) -> B>, x: A) -> C: g(fs[0](x))',
    ].join('\n');
    const body = [
      'const a = getOr(1, fn x: x + 1, none) ?? 0',
      'const b = getOr(1, inc, none) ?? 0',
      'const c = pairMap([3], fn x: x + 1, fn _: none)[0] ?? 0',
      'const d = pairMap([3], fn _: none, fn x: x + 1)[1] ?? 0',
      'const e = pipeFirst(fn n: n * 2, [fn x: x + 1], 4)',
      'a + b + c + d + e',
    ].join('\n');
    expect(mainGives('Int', body, helpers)).toBe(22);
  });

  it('guides a postponed lambda body without forcing a rejected or constrained expected type', () => {
    const helpers = [
      'fn applyTo<T, U is Comparable>(x: T, f: fn(T) -> U) -> U: f(x)',
      'fn mapSorted<T, U is Comparable>(xs: Array<T>, f: fn(T) -> U) -> Array<U>: [f(xs[0])]',
    ].join('\n');
    expect(
      mainGives(
        'Int',
        'const y: Int? = applyTo(1, fn x: x + 1)\nconst ys: Array<Int?> = mapSorted([2], fn x: x + 3)\n(y ?? 0) + (ys[0] ?? 0)',
        helpers,
      ),
    ).toBe(7);

    const mismatch = [
      'fn mapOne<T, U>(x: T, f: fn(T) -> U) -> U: f(x)',
      'fn main():',
      '  const s: String = mapOne(1, fn x: x + 1)',
    ].join('\n');
    const { source, diagnostics } = diagnosedAt(stdProgramOf({ main: mismatch }), 'main');
    expect(
      diagnostics.map((d) => ({
        code: d.code,
        spanText: source.text.slice(d.span.start, d.span.end),
      })),
    ).toEqual([{ code: checkerDiagnostics.typeMismatch.code, spanText: 'mapOne(1, fn x: x + 1)' }]);
  });
});

describe('a call checking without an expected type', () => {
  const extraDeclarations = [
    ...declarations,
    'fn wrap<T>(x: T) -> Array<T?>: [x]',
    'fn wrapContra<T>(x: T) -> (T?, fn(Array<T>) -> Int): (x, fn(xs: Array<T>): 0)',
  ];

  const calls = [
    'pick(1, 2)',
    'pick("a", "b")',
    'pick(a, none)',
    'pair(1, a)',
    'single("x")',
    'single(none)',
    'biggest(a, b)',
    'sorted(xs)',
    'vs.map(fn x: x + 1)',
    'vs.map(fn x: [x])',
    'fields.get("k")',
    'wrap(1)',
    'wrapContra(1)',
  ];

  /** The call type and instantiated type arguments of `call`, declared as `declared` if given. */
  function callFactsOf(
    call: string,
    declared?: string,
  ): { readonly callType: string | undefined; readonly typeArgs: readonly string[] | undefined } {
    const annotation = declared === undefined ? '' : `: ${declared}`;
    const text = [...extraDeclarations, `${parameters}:`, `  const it${annotation} = ${call}`].join(
      '\n',
    );
    const { checker, module, first } = checkedMain(text);
    const node = first('Call') as Call;
    const body = checker.lookup.bodyHolding(module, node);
    const type = body?.typeOf(node);
    const resolved = body?.madeCalls().find((made) => made.site === node)?.call;
    return {
      callType: type && typeText(type),
      typeArgs: resolved?.kind === 'function' ? resolved.typeArguments.map(typeText) : undefined,
    };
  }

  it('checks to the same instantiation with its own result expected', () => {
    fc.assert(
      fc.property(fc.constantFrom(...calls), (call) => {
        const inferred = callFactsOf(call);
        expect(inferred.callType).toBeDefined();
        expect(callFactsOf(call, inferred.callType)).toEqual(inferred);
      }),
      { numRuns: calls.length * 2 },
    );
  });
});

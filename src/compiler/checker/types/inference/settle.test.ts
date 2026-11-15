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
import { compiledDefinition, diagnosedAt } from '../../../compile.test-kit.ts';
import type { Call } from '../../../syntax/expressions/calls.ts';
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

  it('compiles and runs settled calls end to end', async () => {
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
    expect(await mainGives('String', body, declarations.join('\n'))).toBe(
      '2:2:2:1:5:20:9:draft:42',
    );
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

  it('refuses a wider argument, its overloads those taking the receiver', () => {
    expect(errorsOf('drop xs.includes(none)')).toEqual([checkerDiagnostics.typeMismatch.code]);
  });
});

describe('postponed arguments and bounds propagation', () => {
  it('joins a postponed lambda or function value result with other arguments lower bounds', async () => {
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
    expect(await mainGives('Int', body, helpers)).toBe(22);
  });

  it('guides a postponed lambda body without forcing a rejected or constrained expected type', async () => {
    const helpers = [
      'fn applyTo<T, U is Comparable>(x: T, f: fn(T) -> U) -> U: f(x)',
      'fn mapSorted<T, U is Comparable>(xs: Array<T>, f: fn(T) -> U) -> Array<U>: [f(xs[0])]',
    ].join('\n');
    expect(
      await mainGives(
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

describe("a postponed lambda's inputs", () => {
  it('are fixed after what their bounds mention, as settling them all would', () => {
    const main = [
      'struct Box<T> { value: T }',
      'fn makeBox<T>(x: T) -> Box<T>: Box{value: x}',
      'fn pair<W>(a: W, b: W) -> Array<W>: [a, b]',
      'fn withVal<U>(x: U, f: fn(U) -> Int) -> Int: f(x)',
      'fn g() -> Int: withVal(makeBox(1), fn b: b.value)',
      'fn h() -> Int: withVal(Box{value: 1}, fn b: b.value)',
      'fn i() -> Int: withVal([1, 2], fn xs: xs.length())',
      'fn j() -> Int: withVal(pair(1, 2), fn xs: xs[0] + 1)',
    ].join('\n');
    expect(reportedErrors(main)).toEqual([]);
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

/** The instantiations `main`'s program makes of `name`, one of its functions, as they are named. */
function instantiationsOf(name: string, main: string): readonly string[] {
  const { functions } = compiledDefinition(stdProgramOf({ main }), 'main');
  return functions.map((entry) => entry.name).filter((each) => each.startsWith(`main.${name}<`));
}

describe('what takes a call’s value, choosing inside its result', () => {
  const consumers = [
    'fn id<T>(x: T) -> T: x',
    'fn pair<T>(a: T, b: T) -> Array<T>: [a, b]',
    'fn takeArr(xs: Array<Int?>) -> Int: 0',
    'struct Box<T> { value: T }',
    'trait Nullable:\n  fn isNone(self: Self) -> Bool',
    'fn isNone(self: Int?) -> Bool: self == none',
    'fn makeBox<T is Nullable>(x: T) -> Box<T>: Box{value: x}',
    'fn takeBox(b: Box<Int?>) -> Int: 0',
  ].join('\n');
  const mainOf = (...lines: readonly string[]) =>
    [
      consumers,
      'fn uses(c: Bool) -> Int:',
      ...lines.map((line) => `  ${line}`),
      "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): uses(true)",
    ].join('\n');

  it('is the parameter of a call it is passed to, as much as an expected type', () => {
    const main = mainOf('takeArr(pair(1, 2))');
    const { functions } = compiledDefinition(stdProgramOf({ main }), 'main');
    expect(instantiationsOf('pair', main)).toEqual(['main.pair<|<Int,None>>']);
    expect(functions.some((entry) => entry.name.includes(' as '))).toBe(false);
    expect(reportedErrors(mainOf('takeBox(makeBox(1))'))).toEqual([]);
  });

  it('leaves a call to convert at the top of its own result, wherever it stands', () => {
    const main = mainOf(
      'const b: Int? = if c: id(1) else: id(2)',
      'const t: (Int?, Int?) = (id(3), id(4))',
      'drop (b, t)',
      '0',
    );
    expect(instantiationsOf('id', main)).toEqual(['main.id<Int>']);
  });

  it('reaches what a postponed argument gives where the call gives it at its top', () => {
    const main = [
      consumers,
      'fn apply<A, B>(x: A, f: fn(A) -> B) -> B: f(x)',
      'fn t1() -> Result<Int, String>: apply(1, Result.Ok)',
      'fn t2() -> Array<Result<Int, String>>: apply(1, fn x: [Result.Ok(x)])',
      'fn t3() -> (Result<Int, String>, Int): apply(1, fn x: (Result.Ok(x), x))',
      'fn t4() -> Array<Box<Int?>>: apply(1, fn x: [makeBox(x)])',
    ].join('\n');
    expect(reportedErrors(main)).toEqual([]);
  });

  it('reaches a call through what an enclosing call is given, never making that its consumer', () => {
    const main = [
      consumers,
      'fn collect<T>(seed: T, accept: fn(T) -> Unit) -> Array<T>: [seed]',
      'fn needInts(xs: Array<Int>): ()',
      'fn withConsumer<U>(b: Box<U>, f: fn(U) -> Unit) -> Int: 0',
      'fn withConsumer3<U>(b: Box<U>, f: fn(U) -> Unit, g: fn(U) -> Unit) -> Int: 0',
      'ista fn withSlot<U>(b: Box<U>, s: Slot<U>) -> Int: 0',
      'ista fn withSlotReversed<U>(s: Slot<U>, b: Box<U>) -> Int: 0',
      'ista fn uses(acceptOpt: fn(Int?) -> Unit, s: Slot<Int?>):',
      '  needInts(collect(1, id(acceptOpt)))',
      '  needInts(collect(1, fn(x: Int?): ()))',
      '  drop withConsumer(makeBox(1), acceptOpt)',
      '  drop withConsumer(makeBox(1), fn(x: Int?): ())',
      '  drop withConsumer(makeBox(none), fn(x: Int?): ())',
      '  drop withConsumer3(makeBox(1), fn x: (), acceptOpt)',
      '  drop withSlot(makeBox(1), s)',
      '  drop withSlotReversed(s, makeBox(1))',
    ].join('\n');
    expect(reportedErrors(main)).toEqual([]);
  });

  it('sets aside an equality the expected type gives that the constraints refuse', () => {
    const main = [
      'trait Tag:\n  fn tag(self: Self) -> Int',
      'struct Inv<T>:\n  value: T\n  set: fn(T) -> Unit',
      'fn tag(self: Inv<Int>) -> Int: self.value',
      'fn makeInv<T is Comparable>(x: T) -> Inv<T>: Inv{value: x, set: fn(_: T): ()}',
      'shared struct Cell<T> { value: T }',
      'fn makeCell<T is Comparable>(x: T) -> Cell<T>: new Cell{value: x}',
      'fn ok() -> Inv<Int?> | any Tag: makeInv(1)',
      'fn f() -> Cell<Int?>: makeCell(1)',
    ].join('\n');
    expect(reportedErrors(main)).toEqual([checkerDiagnostics.typeMismatch.code]);
  });

  it('gives a call passed to a parameter the instantiation that parameter expected gives it', () => {
    const typed = [
      ['Int', '1', '2'],
      ['String', '"a"', '"b"'],
      ['Bool', 'true', 'false'],
    ] as const;
    fc.assert(
      fc.property(fc.constantFrom(...typed), ([type, a, b]) => {
        const main = [
          'fn pair<T>(a: T, b: T) -> Array<T>: [a, b]',
          `fn take(xs: Array<${type}?>) -> Int: 0`,
          `fn passed() -> Int: take(pair(${a}, ${b}))`,
          `fn expected() -> Array<${type}?>: pair(${a}, ${b})`,
          "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): drop (passed(), expected())",
        ].join('\n');
        expect(instantiationsOf('pair', main)).toHaveLength(1);
      }),
      { numRuns: 6 },
    );
  });
});

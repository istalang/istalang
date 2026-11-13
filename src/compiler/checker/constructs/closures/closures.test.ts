/**
 * Lambdas, local functions and function values (§3.14) through the checker. What each nested
 * function captures is a property over nesting: a variable is captured by exactly the functions
 * between its declaration and its use. Errors are corpus programs (`test/corpus/closures/`),
 * which state their positions.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reportedNothing } from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { idOf } from '../../../program/program.test-kit.ts';
import { type Program, programModule } from '../../../program/program.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import type { Lambda } from '../../../syntax/expressions/index.ts';
import { nodesUnder } from '../../../syntax/tree/index.ts';
import { reported } from '../../check.test-kit.ts';
import { checkProgram } from '../../check.ts';

const helpers = [
  'fn apply<T, U>(value: T, f: fn(T) -> U) -> U: f(value)',
  'fn twice(f: fn(Int) -> Int, x: Int) -> Int: f(f(x))',
  'fn inc(n: Int) -> Int: n + 1',
  'fn pick(n: Int) -> Int: n',
  'fn pick(s: String) -> String: s',
  'struct Op { run: fn(Int) -> Int }',
].join('\n');

/**
 * A function `f` whose body nests `depth` lambdas, each returning the next; `x` is declared as a
 * changing `let` at level `declared` (0 being `f`'s own body) and read by the innermost one.
 */
function nested(depth: number, declared: number): string {
  const levelBody = (level: number): string => {
    const inner = level === depth ? 'x' : `fn(): ${levelBody(level + 1)}`;
    return level === declared ? `{ let x = 0; x = 1; ${inner} }` : inner;
  };
  const own = declared === 0 ? '  let x = 0\n  x = 1\n' : '';
  return `fn f():\n${own}  const g = fn(): ${levelBody(1)}`;
}

/** Every lambda in the function `f` of `program`'s main module, outermost first. */
function lambdasIn(program: Program, f: FunctionDeclaration): readonly Lambda[] {
  const { tree } = programModule(program, idOf('main.ista'));
  return nodesUnder(tree, f).filter((node): node is Lambda => node.kind === 'Lambda');
}

describe('captures', () => {
  it('are exactly the functions between a declaration and its use, the variable in a cell', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 1, max: 5 })
          .chain((depth) => fc.tuple(fc.constant(depth), fc.integer({ min: 0, max: depth - 1 }))),
        ([depth, declared]) => {
          const program = stdProgramOf({ 'main.ista': nested(depth, declared) });
          const checker = checkProgram(program);
          const module = program.modules.get(idOf('main.ista'));
          const f = module?.tree.root.items[0] as FunctionDeclaration;
          const body = checker.bodyOf(f);
          const lambdas = lambdasIn(program, f);
          const captured = lambdas.map((lambda) =>
            (body?.functionOf(lambda)?.captures ?? []).find(
              (capture) => capture.kind === 'variable' && capture.entity.name.text === 'x',
            ),
          );
          expect(checker.diagnosticsOf(idOf('main.ista'))).toEqual([]);
          expect(captured.map((each) => each !== undefined)).toEqual(
            lambdas.map((_, index) => index + 1 > declared),
          );
          const innermost = captured.at(-1);
          expect(innermost?.kind === 'variable' && body?.inCell(innermost.entity.name)).toBe(true);
        },
      ),
    );
  });
});

describe('captures across modules', () => {
  it('never take a top-level name, though another module declares it where the body stands', () => {
    const padding = `# ${'x'.repeat(100)}`;
    const other = `${padding}\nconst limit = 10`;
    const main = `import limit from 'other.ista'\nfn f() -> Int:\n  const read = fn(): limit\n  const pad = "${'x'.repeat(other.length)}"\n  read()`;
    const program = stdProgramOf({ 'main.ista': main, 'other.ista': other });
    const checker = checkProgram(program);
    const f = program.modules.get(idOf('main.ista'))?.tree.root.items[1] as FunctionDeclaration;
    const [read] = lambdasIn(program, f);
    expect(checker.diagnosticsOf(idOf('main.ista'))).toEqual([]);
    expect(read !== undefined && checker.bodyOf(f)?.functionOf(read)?.captures).toEqual([]);
  });
});

describe('closures accept', () => {
  it.each([
    ['a typed lambda', 'fn f() -> Int:\n  const g = fn(x: Int): x * 2\n  g(3)'],
    ['a one-parameter lambda without parentheses', 'fn f() -> Int: twice(fn x: x + 1, 1)'],
    ['a lambda typed by a generic call', 'fn f() -> String: apply(2, fn n: String(n))'],
    [
      'a block lambda',
      'fn f() -> Int:\n  const g = fn(n: Int): { const m = n * 2; m + 1 }\n  g(1)',
    ],
    [
      'a named lambda calling itself, typed by its expected type',
      'fn f() -> Int:\n  const fact: fn(Int) -> Int = fn me(n): if n < 2: 1 else: n * me(n - 1)\n  fact(5)',
    ],
    [
      'a local function with a declared result calling itself',
      'fn f() -> Int:\n  fn down(n: Int) -> Int: if n == 0: 0 else: down(n - 1)\n  down(3)',
    ],
    ['a top-level function as a value', 'fn f() -> Int: twice(inc, 1)'],
    ['an overload chosen by the expected type', 'fn f() -> Int: twice(pick, 1)'],
    [
      'a function-typed field, called directly and through parentheses',
      'fn f(op: Op) -> Int: op.run(1) + (op.run)(2)',
    ],
    [
      "a value's arguments typed by its parameters, through a variable, a field, parentheses and '?.'",
      'struct Tag<T> { n: Int }\nstruct HoldTag { run: fn(Tag<Int>) -> Int }\nfn f(h: HoldTag, tagged: fn(Tag<Int>) -> Int, opt: (fn(Tag<Int>) -> Int)?) -> Int: tagged(Tag{n: 1}) + (tagged)(Tag{n: 2}) + h.run(Tag{n: 3}) + (h.run)(Tag{n: 4}) + (opt?.(Tag{n: 5}) ?? 0)',
    ],
    [
      'an async lambda awaited through its value',
      'ista async fn f() -> Int:\n  const later = async fn(n: Int): n + 1\n  await later(1)',
    ],
    [
      'a lambda parameter taking a reference from its expected type, changed through it',
      'fn bump(f: fn(&Int) -> Int) -> Int:\n  let n = 1\n  f(&n)\n  n\nfn f() -> Int: bump(fn(x): { x += 1; x })',
    ],
    [
      'a lambda typed by the optional function type it is wrapped into',
      'fn f() -> Int:\n  const g: (fn(Int) -> Int)?? = fn(n): n * 2\n  (g ?? fn(n): n)(1)',
    ],
    [
      'a lambda passed for an optional function parameter',
      'fn maybe(g: (fn(Int) -> Int)?, x: Int) -> Int: (g ?? fn(n): n)(x)\nfn f() -> Int: maybe(fn(n): n + 1, 1)',
    ],
    [
      'a let shared with a closure and changed on both sides',
      'fn f() -> Int:\n  let count = 0\n  const bump = fn(): { count += 1; count }\n  count += 10\n  bump()',
    ],
  ])('%s', (_case, body) => {
    expect(reported(`${helpers}\n${body}`)).toEqual(reportedNothing);
  });
});

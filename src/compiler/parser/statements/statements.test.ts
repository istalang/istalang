/**
 * Statement grammar (§3.4, §3.15, §4, §7, §9): every statement form, how `fn` and `async` at the
 * start of a statement are told apart, assignment targets, and one diagnostic per malformed
 * statement.
 */

import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../diagnostics/diagnostic.test-kit.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import {
  bodyOf,
  dumpClean,
  expressionStatement,
  ifThen,
  int,
  lines,
  reported,
} from '../parse.test-kit.ts';

const { expected, invalidAssignmentTarget, compoundDestructuring, declarationInBlock } =
  parserDiagnostics;

describe('variables', () => {
  it.each([
    ['let count = 0', '(VariableDeclaration isMutable [count] _ 0)'],
    ['const limit: int = 50_000', `(VariableDeclaration [limit] ${int} 50000)`],
    ['let a, b = (1, "x")', '(VariableDeclaration isMutable [a b] _ (Tuple [1 "x"]))'],
    ['fn let pending = 0', '(VariableDeclaration heldByFunction isMutable [pending] _ 0)'],
    ['fn const x = 1', '(VariableDeclaration heldByFunction [x] _ 1)'],
    ['fn _ = startJob()', '(VariableDeclaration heldByFunction [_] _ (Call startJob [] []))'],
    [
      'let xs: Array<int>= []',
      `(VariableDeclaration isMutable [xs] (NamedType [Array] [${int}]) (ArrayLiteral []))`,
    ],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('statement', text)).toBe(tree);
  });

  it('reports a missing initializer once', () => {
    expect(reported('statement', 'let x')).toEqual(reportedOnce(expected.code, ''));
  });
});

describe('assignments', () => {
  it.each([
    ['_ = startSomething()', '(Assignment [_] = (Call startSomething [] []))'],
    ['count += 1', '(Assignment [count] += 1)'],
    ['x[k] //= 2', '(Assignment [(Index x k)] //= 2)'],
    ['u$.name = "x"', '(Assignment [(MemberAccess (Unwrap u) name)] = "x")'],
    ['a, b = (b, a)', '(Assignment [a b] = (Tuple [b a]))'],
    ['type = 5', '(Assignment [type] = 5)'],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('statement', text)).toBe(tree);
  });

  it.each([
    ['f() = 2', invalidAssignmentTarget, 'f()'],
    ['a?.b = 1', invalidAssignmentTarget, 'a?.b'],
    ['a, b += 1', compoundDestructuring, '+='],
  ])('reports %s once', (text, diagnostic, spanText) => {
    expect(reported('statement', text)).toEqual(reportedOnce(diagnostic.code, spanText));
  });

  it('leaves a comma to an enclosing call when no assignment follows', () => {
    expect(dumpClean('statement', 'f(if a: x, y)')).toBe(
      expressionStatement(`(Call f [] [${ifThen('a', bodyOf('x'))} y])`),
    );
  });
});

describe('keyword statements', () => {
  it.each([
    ['return', '(Return _)'],
    ['return x + 1', '(Return (Binary x + 1))'],
    ['break', '(Break)'],
    ['continue', '(Continue)'],
    ['defer fn(): log("exited")', '(Defer (Lambda _ [] _ (Call log [] ["exited"])))'],
    ['drop audit.record(event)', '(Drop (Call (MemberAccess audit record) [] [event]))'],
    ['spawn purchase(req)', '(Spawn (Call purchase [] [req]))'],
    ['for key, value in m: use(key)', `(For [key value] m ${bodyOf('(Call use [] [key])')})`],
    ['while pending: wait()', `(While pending ${bodyOf('(Call wait [] [])')})`],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('statement', text)).toBe(tree);
  });
});

describe('fn and async at the start of a statement', () => {
  it.each([
    [
      'fn add(a: int, b = 1): a + b',
      `(FunctionDeclaration _ add [] [(Parameter a ${int} _) (Parameter b _ 1)] _ ${bodyOf('(Binary a + b)')})`,
    ],
    [
      'async fn f() -> Future<int>: await g()',
      `(FunctionDeclaration isAsync _ f [] [] (NamedType [Future] [${int}]) ${bodyOf('(Await (Call g [] []))')})`,
    ],
    ['fn(x): x * 2', '(ExpressionStatement (Lambda _ [(Parameter x _ _)] _ (Binary x * 2)))'],
    [
      'async fn(msg): await handle(msg)',
      '(ExpressionStatement (Lambda isAsync _ [(Parameter msg _ _)] _ (Await (Call handle [] [msg]))))',
    ],
    ['fn x: x > 0', '(ExpressionStatement (Lambda _ [(Parameter x _ _)] _ (Binary x > 0)))'],
    ['struct{value: 1}', '(ExpressionStatement (StructLiteral _ [(FieldInitializer value 1)]))'],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('statement', text)).toBe(tree);
  });
});

describe('declarations only the top level allows', () => {
  it.each([
    ['import a from "m"'],
    ['struct S { a: int }'],
    ['enum E { A; B }'],
    ['trait T { value: int }'],
    ['extern x: int'],
    ['type Id = string'],
    ['fn Duration.zero(): 1'],
    ['extern fn f()'],
  ])('are reported once inside a block: %s', (text) => {
    const source = lines('fn f():', `    ${text}`);
    expect(reported('module', source)).toEqual(reportedOnce(declarationInBlock.code, text));
  });
});

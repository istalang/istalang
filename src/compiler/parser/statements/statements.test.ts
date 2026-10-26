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
    ['let count = 0', '(VariableDeclaration isMutable [(NamePattern [count])] _ 0)'],
    ['const limit: int = 50_000', `(VariableDeclaration [(NamePattern [limit])] ${int} 50000)`],
    [
      'let a, b = (1, "x")',
      '(VariableDeclaration isMutable [(NamePattern [a]) (NamePattern [b])] _ (Tuple [1 "x"]))',
    ],
    [
      'fn let pending = 0',
      '(VariableDeclaration heldByFunction isMutable [(NamePattern [pending])] _ 0)',
    ],
    ['fn const x = 1', '(VariableDeclaration heldByFunction [(NamePattern [x])] _ 1)'],
    [
      'fn _ = startJob()',
      '(VariableDeclaration heldByFunction [(WildcardPattern)] _ (Call startJob [] []))',
    ],
    [
      'let xs: Array<int>= []',
      `(VariableDeclaration isMutable [(NamePattern [xs])] (NamedType [Array] [${int}]) (ArrayLiteral []))`,
    ],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('statement', text)).toBe(tree);
  });

  it('reports a missing initializer once', () => {
    expect(reported('statement', 'let x')).toEqual(reportedOnce(expected.code, ''));
  });
});

describe('destructuring declarations (§3.15)', () => {
  it.each([
    [
      'let (a, b), c = t',
      '(VariableDeclaration isMutable [(TuplePattern [(NamePattern [a]) (NamePattern [b])]) (NamePattern [c])] _ t)',
    ],
    [
      'const Pair{first, second as s} = p',
      '(VariableDeclaration [(StructPattern (NamedType [Pair] []) [(BindFieldPattern first _) (BindFieldPattern second s)])] _ p)',
    ],
    [
      'const struct{first is (x, _)} = p',
      '(VariableDeclaration [(StructPattern _ [(NestedFieldPattern first (TuplePattern [(NamePattern [x]) (WildcardPattern)]))])] _ p)',
    ],
    ['const _, max = pair', '(VariableDeclaration [(WildcardPattern) (NamePattern [max])] _ pair)'],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('statement', text)).toBe(tree);
  });
});

describe('assignments', () => {
  it.each([
    ['_ = startSomething()', '(Assignment [_] = (Call startSomething [] []))'],
    ['count += 1', '(Assignment [count] += 1)'],
    ['x[k] //= 2', '(Assignment [(Index x k)] //= 2)'],
    ['u->name = "x"', '(Assignment [(MemberAccess (Dereference u) name)] = "x")'],
    ['*u = v', '(Assignment [(Dereference u)] = v)'],
    ['a, b = (b, a)', '(Assignment [a b] = (Tuple [b a]))'],
    ['type = 5', '(Assignment [type] = 5)'],
    ['t.0 = 1', '(Assignment [(TupleElement t 0)] = 1)'],
    ['(a, b), c = t', '(Assignment [(Tuple [a b]) c] = t)'],
    [
      'Pair{first: p.x, second} = q',
      '(Assignment [(StructLiteral (NamedType [Pair] []) [(FieldInitializer first (MemberAccess p x)) (FieldInitializer second _)])] = q)',
    ],
    [
      'struct{first: (a, b)} = q',
      '(Assignment [(StructLiteral _ [(FieldInitializer first (Tuple [a b]))])] = q)',
    ],
    [
      'Id{(v)} = id',
      '(Assignment [(StructLiteral (NamedType [Id] []) [(PositionalInitializer (Parenthesized v))])] = id)',
    ],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('statement', text)).toBe(tree);
  });

  it.each([
    ['f() = 2', invalidAssignmentTarget, 'f()'],
    ['a?.b = 1', invalidAssignmentTarget, 'a?.b'],
    ['f().x = 1', invalidAssignmentTarget, 'f().x'],
    ['a?.b[0] = 1', invalidAssignmentTarget, 'a?.b[0]'],
    ['a, b += 1', compoundDestructuring, '+='],
    ['(a, b) += t', compoundDestructuring, '+='],
    ['((a, b)) += t', compoundDestructuring, '+='],
    ['Pair{first} -= q', compoundDestructuring, '-='],
    ['Pair{...p} = q', invalidAssignmentTarget, 'Pair{...p}'],
    ['(a, f()) = t', invalidAssignmentTarget, '(a, f())'],
    ['Pair{first: 1} = q', invalidAssignmentTarget, 'Pair{first: 1}'],
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
    [
      'for key, value in m: use(key)',
      `(For [(NamePattern [key]) (NamePattern [value])] m ${bodyOf('(Call use [] [key])')})`,
    ],
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

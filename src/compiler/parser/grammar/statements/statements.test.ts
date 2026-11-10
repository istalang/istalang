/**
 * Statement grammar (§3.4, §3.15, §4, §7, §9): every statement form, how `fn` and `async` at the
 * start of a statement are told apart, assignment targets, and one diagnostic per malformed
 * statement.
 */

import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { parserDiagnostics } from '../../diagnostics.ts';
import {
  bodyOf,
  dumpClean,
  dumpOf,
  expressionStatement,
  ifThen,
  int,
  lines,
  parseAs,
  reported,
} from '../../parse.test-kit.ts';

const { expected, invalidAssignmentTarget, compoundDestructuring, declarationInBlock } =
  parserDiagnostics;

describe('variables', () => {
  it.each([
    ['let count = 0', '(VariableDeclaration _ isMutable [(NamePattern [count] [])] _ 0)'],
    [
      'const limit: Int = 50_000',
      `(VariableDeclaration _ [(NamePattern [limit] [])] ${int} 50000)`,
    ],
    [
      'let a, b = (1, "x")',
      '(VariableDeclaration _ isMutable [(NamePattern [a] []) (NamePattern [b] [])] _ (Tuple [1 "x"]))',
    ],
    [
      'let xs: Array<Int>= []',
      `(VariableDeclaration _ isMutable [(NamePattern [xs] [])] (NamedType [Array] [${int}]) (ArrayLiteral []))`,
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
      '(VariableDeclaration _ isMutable [(TuplePattern [(NamePattern [a] []) (NamePattern [b] [])]) (NamePattern [c] [])] _ t)',
    ],
    [
      'const Pair{first, second as s} = p',
      '(VariableDeclaration _ [(StructPattern (NamedType [Pair] []) [(BindFieldPattern first _) (BindFieldPattern second s)] _)] _ p)',
    ],
    [
      'const struct{first is (x, _)} = p',
      '(VariableDeclaration _ [(StructPattern _ [(NestedFieldPattern first (TuplePattern [(NamePattern [x] []) (WildcardPattern)]))] _)] _ p)',
    ],
    [
      'const _, max = pair',
      '(VariableDeclaration _ [(WildcardPattern) (NamePattern [max] [])] _ pair)',
    ],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('statement', text)).toBe(tree);
  });
});

describe('assignments', () => {
  it.each([
    ['_ = startSomething()', '(Assignment [_] = (Call startSomething []))'],
    ['count += 1', '(Assignment [count] += 1)'],
    ['x[k] //= 2', '(Assignment [(Index x k)] //= 2)'],
    ['u->name = "x"', '(Assignment [(MemberAccess (Dereference -> u) name)] = "x")'],
    ['*u = v', '(Assignment [(Dereference * u)] = v)'],
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
    ['a?->b = 1', invalidAssignmentTarget, 'a?->b'],
    ['xs?.[0] = 1', invalidAssignmentTarget, 'xs?.[0]'],
    ['xs?.[0] += 1', invalidAssignmentTarget, 'xs?.[0]'],
    ['a?.b->c = 1', invalidAssignmentTarget, 'a?.b->c'],
    ['a, b += 1', compoundDestructuring, '+='],
    ['(a, b) += t', compoundDestructuring, '+='],
    ['((a, b)) += t', compoundDestructuring, '+='],
    ['Pair{first} -= q', compoundDestructuring, '-='],
    ['Pair{...p} = q', invalidAssignmentTarget, 'Pair{...p}'],
    ['(a, f()) = t', invalidAssignmentTarget, '(a, f())'],
    ['Pair{first: 1} = q', invalidAssignmentTarget, 'Pair{first: 1}'],
    ['new Pair{first, second} = q', invalidAssignmentTarget, 'new Pair{first, second}'],
    ['(new Pair{first}, b) = q', invalidAssignmentTarget, '(new Pair{first}, b)'],
  ])('reports %s once', (text, diagnostic, spanText) => {
    expect(reported('statement', text)).toEqual(reportedOnce(diagnostic.code, spanText));
  });

  it('leaves a comma to an enclosing call when no assignment follows', () => {
    expect(dumpClean('statement', 'f(if a: x, y)')).toBe(
      expressionStatement(`(Call f [${ifThen('a', bodyOf('x'))} y])`),
    );
  });
});

describe('keyword statements', () => {
  it.each([
    ['return', '(Return _)'],
    ['return x + 1', '(Return (Binary x + 1))'],
    ['break', '(Break _)'],
    ['continue', '(Continue _)'],
    ['drop audit.record(event)', '(Drop (Call (MemberAccess audit record) [event]))'],
    [
      'for key, value in m: use(key)',
      `(For _ [(NamePattern [key] []) (NamePattern [value] [])] m ${bodyOf('(Call use [key])')})`,
    ],
    ['while pending: wait()', `(While _ pending ${bodyOf('(Call wait [])')})`],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('statement', text)).toBe(tree);
  });
});

describe('fn and async at the start of a statement', () => {
  it.each([
    [
      'fn add(a: Int, b = 1): a + b',
      `(FunctionDeclaration _ add [] [(Parameter a _ ${int} _) (Parameter b _ _ 1)] _ ${bodyOf('(Binary a + b)')})`,
    ],
    [
      'async fn f() -> Future<Int>: await g()',
      `(FunctionDeclaration async _ f [] [] (NamedType [Future] [${int}]) ${bodyOf('(Await (Call g []))')})`,
    ],
    ['fn(x): x * 2', '(ExpressionStatement (Lambda _ [(Parameter x _ _ _)] _ (Binary x * 2)))'],
    [
      'async fn(msg): await handle(msg)',
      '(ExpressionStatement (Lambda async _ [(Parameter msg _ _ _)] _ (Await (Call handle [msg]))))',
    ],
    ['fn x: x > 0', '(ExpressionStatement (Lambda _ [(Parameter x _ _ _)] _ (Binary x > 0)))'],
    ['struct{value: 1}', '(ExpressionStatement (StructLiteral _ [(FieldInitializer value 1)]))'],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('statement', text)).toBe(tree);
  });
});

describe('declarations only the top level allows', () => {
  it.each([
    ['import a from "m"'],
    ['struct S { a: Int }'],
    ['enum E { A, B }'],
    ['trait T { value: Int }'],
    ['extern x: Int'],
    ['type Id = String'],
    ['fn Duration.zero(): 1'],
    ['extern fn f()'],
    ['trait T:\n        fn m()'],
  ])('are reported once inside a block: %s', (text) => {
    const source = lines('fn f():', `    ${text}`);
    expect(reported('module', source)).toEqual(reportedOnce(declarationInBlock.code, text));
  });
});

describe('labels, `hold` and compound assignments', () => {
  it.each([
    [
      'outer: for x in xs: break outer',
      '(For outer [(NamePattern [x] [])] xs (Block [(Break outer)]))',
    ],
    ['outer: while c: continue outer', '(While outer c (Block [(Continue outer)]))'],
    ['hold let x = 1', '(VariableDeclaration (Hold _) isMutable [(NamePattern [x] [])] _ 1)'],
    ['hold _ = x', '(VariableDeclaration (Hold _) [(WildcardPattern)] _ x)'],
    ['hold(outer) const y = 2', '(VariableDeclaration (Hold outer) [(NamePattern [y] [])] _ 2)'],
    [
      'batch:\n  hold(batch) _ = x',
      '(LabelledBlock batch (Block [(VariableDeclaration (Hold batch) [(WildcardPattern)] _ x)]))',
    ],
    ['hold(x)', '(ExpressionStatement (Call hold [x]))'],
    ['x **= 2', '(Assignment [x] **= 2)'],
    ['x >>= 1', '(Assignment [x] >>= 1)'],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('statement', text)).toBe(tree);
  });

  it.each([
    ['outer: if c: f()', 'outer:'],
    ['outer: x = 1', 'outer:'],
  ])('reports a label before anything but a loop or block once: %s', (text, spanText) => {
    expect(reported('statement', text)).toEqual(
      reportedOnce(parserDiagnostics.misplacedLabel.code, spanText),
    );
  });

  it('parses what follows a misplaced label as the statement', () => {
    expect(dumpOf(parseAs('statement', 'outer: x = 1'))).toBe('(Assignment [x] = 1)');
  });

  it('no longer reads `fn let`, the older spelling of `hold let`', () => {
    expect(reported('statement', 'fn let x = 1').codes).not.toEqual([]);
  });
});

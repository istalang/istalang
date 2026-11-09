/**
 * The constraint scope (docs/work/variance-inference/i2-scope.md): whatever path a call or literal
 * takes, every member of its scope settles, so a call that can't be made reports its arguments as
 * they settled and leaves their own checks in place, and no record keeps a variable.
 */

import { describe, expect, it } from 'vitest';
import { invalidPrograms, runPrograms } from '../../../../../test/corpus/programs.ts';
import {
  reportedNothing,
  reportedOnce,
} from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { mainGives } from '../../../../stdlib/prelude/prelude.test-kit.ts';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { diagnosedAt } from '../../../compile.test-kit.ts';
import { idOf } from '../../../program/program.test-kit.ts';
import { programModule } from '../../../program/program.ts';
import { functionsOf } from '../../../syntax/declarations/field-defaults.ts';
import type { Expression } from '../../../syntax/expressions/index.ts';
import { nodesUnder, type SyntaxNode } from '../../../syntax/tree/index.ts';
import { reported } from '../../check.test-kit.ts';
import { checkProgram } from '../../check.ts';
import { expressionHandlers } from '../../constructs/expressions/expressions.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { mentionsAnyVariable } from '../../types/inference/variables.ts';

const declarations = [
  'fn id<T>(x: T) -> T: x',
  'fn empty<U>() -> Array<U>: []',
  'struct Box<X> { value: X }',
  'struct Holder<T> { box: Box<T>, other: T }',
  'struct Pair<T> { a: T, b: T }',
  'struct Two<T, U> { a: T, b: U }',
  'struct Plain { a: Int }',
  'struct EmptyStruct {}',
  'fn foo(s: String) -> Int: 0',
];

/** The messages checking `body`, a function's, after the declarations above reports. */
function messagesOf(body: string): readonly string[] {
  const text = [...declarations, `fn f() -> Int: ${body}`].join('\n');
  return diagnosedAt(stdProgramOf({ 'main.ista': text }), 'main.ista').diagnostics.map(
    ({ message }) => message,
  );
}

/** What checking `functions` after the declarations above reports. */
function reportedAfter(...functions: readonly string[]) {
  return reported([...declarations, ...functions].join('\n'));
}

describe('a call that can’t be made', () => {
  it('reports its arguments as their scope settled them', () => {
    expect(messagesOf('foo(id(1))')).toEqual(['Expected String, found Int.']);
    expect(messagesOf('foo([1])')).toEqual(['Expected String, found Array<Int>.']);
    expect(messagesOf('foo(Pair{a: 1, b: 2})')).toEqual(['Expected String, found Pair<Int>.']);
  });

  it('still makes the checks of what it was given', () => {
    const messages = messagesOf('foo(Pair{a: 1})');
    expect(messages).toContain("Pair<Int> needs a value for 'b'.");
    expect(messages).toContain('Expected String, found Pair<Int>.');
  });

  it('settles what only it would have bounded to the error type, reporting nothing more', () => {
    expect(messagesOf('foo(empty())')).toEqual(['Expected String, found Array<?>.']);
    expect(messagesOf('foo(id(empty()))')).toEqual(['Expected String, found Array<?>.']);
  });

  it('still reports a joined argument whose own bounds disagree', () => {
    expect(
      reportedAfter(
        'fn takeInts(xs: Array<Int>) -> Int: 0',
        'fn f() -> Int: takeInts([1, "wrong"])',
      ).codes.length,
    ).toBeGreaterThan(0);
    expect(
      reportedAfter(
        'fn takePair(p: Pair<Int>) -> Int: 0',
        'fn f() -> Int: takePair(Pair{a: 1, b: "wrong"})',
      ).codes.length,
    ).toBeGreaterThan(0);
    expect(
      reportedAfter(
        'fn pair<T>(a: T, b: T) -> Array<T>: [a, b]',
        'fn takeInts(xs: Array<Int>) -> Int: 0',
        'fn f() -> Int: takeInts(pair(1, "wrong"))',
      ).codes.length,
    ).toBeGreaterThan(0);
  });

  it('chooses by what only a default decides of what it is given, as that settles', () => {
    const overloads = [
      'fn defaultEmpty<T = Int>() -> Array<T>: []',
      'fn pickArr(xs: Array<Int>) -> Int: 1',
      'fn pickArr(xs: Array<String>) -> Int: 2',
    ];
    for (const argument of ['defaultEmpty()', 'id(defaultEmpty())']) {
      expect(reportedAfter(...overloads, `fn f() -> Int: pickArr(${argument})`)).toEqual(
        reportedNothing,
      );
    }
    expect(reportedAfter(...overloads, 'fn g() -> Int: pickArr(empty())')).toEqual(
      reportedOnce(checkerDiagnostics.ambiguousCall.code, 'pickArr(empty())'),
    );
  });
});

describe('a function value called with arguments still open', () => {
  it('bounds them by its parameters, a pack spread beside them', () => {
    expect(
      reportedAfter(
        'fn invokeOne<...A, R>(f: fn(Int, ...A) -> R, ...rest: A) -> R: f(id(1), ...rest)',
        'fn invokeMany<...A, R>(f: fn(Array<Int>, ...A) -> R, ...rest: A) -> R: f([1], ...rest)',
        'fn fill(f: fn(Array<Int>) -> Int) -> Int: f(empty())',
      ),
    ).toEqual(reportedNothing);
  });
});

describe('a literal naming its type, where no scope is open', () => {
  it('opens one, so its fields infer together', () => {
    expect(
      reportedAfter(
        'struct Item<T> { value: T }',
        'struct Mix<T> { item: Item<T>, other: T }',
        'enum Size { Small, Large }',
        'fn f() -> Int:\n  _ = Mix{item: Item{value: Small}, other: Size.Large}\n  0',
      ),
    ).toEqual(reportedNothing);
  });

  it('suspends the scope across struct comprehension passes', () => {
    expect(
      reportedAfter('fn f(p: Pair<Int>) -> Pair<Int>: Pair{for k, v in ...p: [k]: id(v)}'),
    ).toEqual(reportedNothing);
  });

  it('abandons refused or mismatched items and records solved field and spread types on failure', () => {
    expect(messagesOf('{ _ = Plain{...empty()}; 0 }')).toEqual(['Expected Plain, found Array<?>.']);
    expect(messagesOf('{ _ = Plain{a: empty()}; 0 }')).toEqual(['Expected Int, found Array<?>.']);
    expect(messagesOf('{ _ = Holder{box: empty(), other: 1}; 0 }')).toEqual([
      'Expected Box<Int>, found Array<?>.',
    ]);
    expect(messagesOf('{ _ = Pair{a: 1, b: 2, bad: empty()}; 0 }')).toEqual([
      "Pair has no field 'bad'.",
    ]);
    expect(messagesOf('{ _ = Pair{a: 1, b: 2, ...empty()}; 0 }')).toEqual([
      'A spread comes first, and only once.',
    ]);
    expect(messagesOf('{ _ = Ok{value: empty()}; 0 }')).toEqual([
      "A variant is built by calling it, as in 'Ok(…)', not by naming its fields in braces or a block (§3.11).",
    ]);
    expect(messagesOf('{ _ = EmptyStruct{a: empty()}; 0 }')).toEqual([
      'EmptyStruct has no fields, so it is written bare: EmptyStruct.',
    ]);
    expect(
      messagesOf('{ const u: Two<Int, Int> | Two<String, String> = Two{a: Box{value: 1}}; 0 }'),
    ).toEqual(['Expected Two<Int, Int> | Two<String, String>, found Two<Box<Int>, ?>.']);

    const program = stdProgramOf({
      'main.ista': [
        ...declarations,
        'fn f():',
        '  const u: Two<Int, Int> | Two<String, String> = Two{a: Box{value: 1}}',
        '  _ = id(Two{a: Box{value: 1}, bad: 1})',
      ].join('\n'),
    });
    const checker = checkProgram(program);
    const { tree } = programModule(program, idOf('main.ista'));
    for (const declaration of functionsOf(tree.root)) {
      const body = checker.bodyOf(declaration);
      const leaked = nodesUnder(tree, declaration)
        .filter((node) => node.kind === 'StructLiteral')
        .flatMap((node) => body?.literalFieldsOf(node) ?? [])
        .filter((field) => mentionsAnyVariable(field.type));
      expect(leaked).toEqual([]);
    }
  });
});

describe('a lambda judged in a scope', () => {
  it('records its function as the scope settled it, wherever it stands in an argument', () => {
    expect(
      reportedAfter(
        'enum Outcome<T, E> { Good(value: T), Bad(error: E) }',
        'fn goodPair<U>(p: (Int, fn(Int) -> Outcome<U, String>)) -> Outcome<U, String>: (p.1)(p.0)',
        'fn applyFirst<U>(fs: Array<fn(Int) -> U>) -> U: fs[0](1)',
        'fn f() -> Int:\n  _ = goodPair((1, fn x: Good(x + 1)))\n  applyFirst([fn x: id(x + 1)])',
      ),
    ).toEqual(reportedNothing);
  });
});

describe('a placeholder', () => {
  it('is judged once no other one still gives its inputs, each in turn', () => {
    expect(
      reportedAfter(
        'fn chain<A, B, C>(f: fn(A) -> B, g: fn(B) -> C, x: A) -> C: g(f(x))',
        'fn f() -> Int: chain(fn x: x + 1, fn y: y * 2, 3)',
        'fn g() -> Int: chain(fn x: x + 1, id(fn y: y * 2), 3)',
      ),
    ).toEqual(reportedNothing);
  });

  it('waits on a held-back struct literal whose fields reach its inputs', () => {
    expect(
      reportedAfter(
        'struct Case<Sc> { body: fn(Sc) -> Int }',
        'shared struct Cell<C> { c: C }',
        'struct Pick<Sc, C is struct {}> { sel: Cell<C>, cases: { [K in keyof C]: Case<Sc> } }',
        'type S = { a: Int }',
        'fn f(c: Cell<{ x: Int }>) -> Pick<S, { x: Int }>:',
        '  Pick{sel: c, cases: struct{x: Case{body: fn(sc): sc.a}}}',
      ),
    ).toEqual(reportedNothing);
  });

  it('waits on what decides the form of a computed type expected of it', () => {
    expect(
      reportedAfter(
        'struct Case<Sc> { body: fn(Sc) -> Int }',
        'struct Lam<Sc, C is struct {}> { sel: C, cases: { [K in keyof C]: fn(Sc) -> Int } }',
        'struct Pick<Sc, C is struct {}> { sel: C, cases: { [K in keyof C]: Case<Sc> } }',
        'type S = { a: Int }',
        'fn f() -> Lam<S, { x: Int }>: Lam{sel: struct{x: 1}, cases: struct{x: fn(sc): sc.a}}',
        'fn g() -> Pick<S, { x: Int }>:',
        '  Pick{sel: struct{x: 1}, cases: struct{x: Case{body: fn(sc): sc.a}}}',
      ),
    ).toEqual(reportedNothing);
  });

  it('waits on what another gives through a bound on what it takes', () => {
    expect(
      reportedAfter(
        'fn apply<T, R>(f: fn(T) -> R, x: T) -> R: f(x)',
        'fn mapBox<A, U>(b: Box<A>, f: fn(A) -> U) -> Box<U>: Box{value: f(b.value)}',
        'fn g() -> Int: apply(fn(b): b.value, mapBox(Box{value: 1}, fn(a): a))',
        'trait View<Sc>:',
        '  fn show(self: Self, sc: Sc) -> Int',
        'struct Leaf<Sc> { f: fn(Sc) -> Int }',
        'fn show<Sc>(self: Leaf<Sc>, sc: Sc) -> Int: self.f(sc)',
        'struct Scoped<Sc, Sc2> { scope: fn(Sc) -> Sc2, view: any View<{ inner: Sc2 }> }',
        'fn run<Sc2>(v: Scoped<{ a: Int }, Sc2>) -> Int: 0',
        'fn h() -> Int: run(Scoped{view: Leaf{f: fn(x): x.inner.b}, scope: fn(sc): struct{a: sc.a, b: 1}})',
      ),
    ).toEqual(reportedNothing);
  });

  it('judges first, where none is ready, one waiting on no other', () => {
    const pick = 'Pick{cases: struct{x: Case{body: fn(sc): sc.a}}, sel: struct{x: fn(n: Int): n}}';
    expect(
      reportedAfter(
        'struct Case<Sc> { body: fn(Sc) -> Int }',
        'struct Pick<Sc, C is struct {}> { sel: C, cases: { [K in keyof C]: Case<Sc> } }',
        'type S = { a: Int }',
        'fn runPick<C is struct {}>(p: Pick<S, C>) -> Int: 0',
        `fn f() -> Pick<S, { x: fn(Int) -> Int }>: ${pick}`,
        `fn g() -> Int: runPick(${pick})`,
      ),
    ).toEqual(reportedNothing);
  });

  it('compiles and runs a scoped view inside a mapped case with no type arguments written', () => {
    const decls = [
      'trait View<Sc> { fn run(self: Self, sc: Sc) -> Int }',
      'struct Leaf<Sc> { body: fn(Sc) -> Int }',
      'fn run<Sc>(self: Leaf<Sc>, sc: Sc) -> Int: (self.body)(sc)',
      'struct Scoped<Sc, Sc2> { scope: fn(Sc) -> Sc2, view: any View<Sc2> }',
      'fn run<Sc, Sc2>(self: Scoped<Sc, Sc2>, sc: Sc) -> Int: self.view.run((self.scope)(sc))',
      'struct CaseView<Sc> { label: fn(Sc) -> Int, body: any View<Sc> }',
      'struct VariantView<Sc, C is struct {}> { sel: C, cases: { [K in keyof C]: CaseView<Sc> } }',
      'fn run<Sc, C is struct {}>(self: VariantView<Sc, C>, sc: Sc) -> Int: 0',
      'fn pickX<Sc>(v: VariantView<Sc, { x: Int }>, sc: Sc) -> Int:',
      '  v.cases.x.label(sc) + v.cases.x.body.run(sc)',
      'fn makeView() -> VariantView<{ a: Int }, { x: Int }>:',
      '  VariantView{',
      '    sel: struct{x: 1}',
      '    cases: struct{',
      '      x: CaseView{',
      '        label: fn({a}): a * 10',
      '        body: Scoped{',
      '          scope: fn(sc): struct{a: sc.a, bonus: sc.a + 5}',
      '          view: Leaf{body: fn({a, bonus}): a + bonus}',
      '        }',
      '      }',
      '    }',
      '  }',
    ].join('\n');
    expect(mainGives('Int', 'pickX(makeView(), struct{a: 3})', decls)).toBe(41);
  });

  it('refuses a candidate it can be no value of, so overloads choose by it', () => {
    expect(
      reportedAfter(
        'fn pick(f: fn(Int) -> Int) -> Int: f(1)',
        'fn pick(f: fn(Int, Int) -> Int) -> Int: f(1, 2)',
        'fn f() -> Int: pick(fn x: x) + pick(fn(x, y): x + y)',
      ),
    ).toEqual(reportedNothing);
  });

  it('is told its type by siblings whose own items are still open', () => {
    expect(
      reportedAfter(
        'fn f() -> Int:',
        '  const xs = [[1], [], [2, 3]]',
        '  xs.flat().length() + [[1], [], [2, 3]].flat().length()',
      ),
    ).toEqual(reportedNothing);
  });

  it('of a call that can\u2019t be made is checked against what it didn\u2019t take, once', () => {
    expect(messagesOf('foo(fn x: x)')).toEqual([
      'Expected String, found sendable fn(?) -> ?.',
      "The type of 'x' can't be inferred: write it, or pass the lambda where a function type is expected.",
    ]);
  });
});

describe('settling', () => {
  it('leaves no variable in what another settles to when it can\u2019t be inferred', () => {
    expect(messagesOf('id(empty())[0]')).toEqual([
      "Can't infer 'U' for 'empty'; give the type arguments explicitly.",
    ]);
  });

  it('settles a variable bounded only through another after that one', () => {
    expect(
      reportedAfter(
        'fn outer<T>(xs: Array<T>, x: T) -> T: x',
        'fn takeResults<T, E>(a: Result<T, E>, b: Result<T, E>) -> Int: 0',
        'fn f() -> Int: outer(empty(), 1)',
        'fn g() -> Int: takeResults(Result.Ok(1), Result.Err("no"))',
      ),
    ).toEqual(reportedNothing);
  });
});

describe('records', () => {
  /** Whether `node` is an expression, whose type a body records. */
  const isExpression = (node: SyntaxNode): node is Expression =>
    Object.hasOwn(expressionHandlers, node.kind);

  it('never keep a variable, over the corpus', () => {
    for (const { text } of [...runPrograms, ...invalidPrograms]) {
      const program = stdProgramOf({ 'main.ista': text });
      const checker = checkProgram(program);
      const { tree } = programModule(program, idOf('main.ista'));
      for (const declaration of functionsOf(tree.root)) {
        const body = checker.bodyOf(declaration);
        const open = nodesUnder(tree, declaration)
          .filter(isExpression)
          .filter((node) =>
            [body?.typeOf(node), body?.expectedOf(node)].some(
              (type) => type !== undefined && mentionsAnyVariable(type),
            ),
          );
        expect(open.map((node) => node.kind)).toEqual([]);
      }
    }
  });
});

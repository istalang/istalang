/**
 * Types as messages spell them (§2): each reads back as the type it names, so a function type
 * keeps the parentheses a `?` after it needs, and drops those its result doesn't.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { diagnosedAt } from '../../compile.test-kit.ts';
import { idOf, programOf } from '../../program/program.test-kit.ts';
import { programModule } from '../../program/program.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { VariableDeclaration } from '../../syntax/statements.ts';
import { bodyOf } from '../../syntax/tree.ts';
import { checkProgram } from '../check.ts';
import { typeText } from './type-text.ts';

/** The text of the type `written` resolves to, as a parameter's, after `declarations`. */
function spelled(written: string, declarations: readonly string[] = []): string | undefined {
  const program = stdProgramOf({
    'main.ista': [...declarations, `fn f(x: ${written}):`, '  ()'].join('\n'),
  });
  const checker = checkProgram(program);
  const items = program.modules.get(idOf('main.ista'))?.tree.root.items ?? [];
  const [x] = checker.parametersOf(items.at(-1) as FunctionDeclaration);
  return x === undefined ? undefined : typeText(x.type);
}

/** The messages reported for `lines` as module `main.ista`. */
function messagesOf(lines: readonly string[]): readonly string[] {
  const { diagnostics } = diagnosedAt(stdProgramOf({ 'main.ista': lines.join('\n') }), 'main.ista');
  return diagnostics.map((diagnostic) => diagnostic.message);
}

describe('typeText', () => {
  it.each([
    'Int?',
    'Array<Int?>',
    'fn(Int) -> Int?',
    '(fn(Int) -> Int)?',
    '(fn() -> Int)??',
    'Array<(sendable fn() -> Int)?>',
    'fn() -> (fn() -> Int)?',
  ])('spells %s as written', (written) => {
    expect(spelled(written)).toBe(written);
  });

  it('spells the value behind a shared struct as the shape of its fields (§3.18)', () => {
    const program = stdProgramOf({
      'main.ista': [
        'shared struct Counter { count: Int }',
        'shared struct Box<K, V> { key: K }',
        'fn f(c: Counter, b: Box<Int, String>):',
        '  const a = *c',
        '  const d = *b',
      ].join('\n'),
    });
    const checker = checkProgram(program);
    const { tree } = programModule(program, idOf('main.ista'));
    const f = tree.root.items[2] as FunctionDeclaration;
    const written = bodyOf(tree, f);
    const body = written === undefined ? undefined : checker.bodyOf(f);
    const [a, d] = (written?.statements ?? []) as VariableDeclaration[];
    const typeAt = (declaration: VariableDeclaration | undefined) => {
      const type = declaration && body?.typeOf(declaration.initializer);
      return type && typeText(type);
    };
    expect(typeAt(a)).toBe('struct { count: Int }');
    expect(typeAt(d)).toBe('struct { key: Int }');
  });

  describe('a type written through an alias (§3.17)', () => {
    const aliases = [
      'struct Pair<A, B> { first: A; second: B }',
      'type Cents = Int',
      'type Labeled<T> = Pair<String, T>',
      'type Job = sendable fn() -> Int',
      'fn label<T>(value: T) -> Labeled<T>:',
      '  Pair{first: "x", second: value}',
    ];

    it.each(['Cents', 'Labeled<Int>', 'Labeled<Cents>?', 'Array<Labeled<Cents>>', 'Job', 'Job?'])(
      'spells %s as written',
      (written) => {
        expect(spelled(written, aliases)).toBe(written);
      },
    );

    it('spells an instance of a generic signature by the alias, its arguments substituted', () => {
      expect(messagesOf([...aliases, 'fn g():', '  const n: Int = label(3)'])).toEqual([
        'Expected Int, found Labeled<Int>.',
      ]);
    });

    it('keeps the alias through widening that drops nothing', () => {
      const body = [
        'fn g():',
        '  let tagged = label(3)',
        '  tagged = label(4)',
        '  const n: Int = tagged',
      ];
      expect(messagesOf([...aliases, ...body])).toEqual(['Expected Int, found Labeled<Int>.']);
    });

    it('spells an alias named as a value by its name, with no arguments', () => {
      const body = ['fn g():', '  Cents.missing()', '  Labeled.missing()'];
      expect(messagesOf([...aliases, ...body])).toEqual([
        "Cents has no static function 'missing'.",
        "Labeled has no static function 'missing'.",
      ]);
    });

    it('drops the alias where widening changes the type it wrote', () => {
      const body = [
        'fn g(job: Job):',
        '  let plain = job',
        '  plain = job',
        '  const n: Int = plain',
      ];
      expect(messagesOf([...aliases, ...body])).toEqual(['Expected Int, found fn() -> Int.']);
    });
  });

  it('spells a non-prelude Optional declaration as Optional<T>, not T?', () => {
    const program = programOf({
      'main.ista': 'struct Optional<T> { value: T }\nfn f(x: Optional<Int>):\n  ()\n',
    });
    const checker = checkProgram(program);
    const f = program.modules.get(idOf('main.ista'))?.tree.root.items[1] as FunctionDeclaration;
    const [x] = checker.parametersOf(f);
    expect(x && typeText(x.type)).toBe('Optional<Int>');
  });
});

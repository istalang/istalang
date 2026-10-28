/**
 * Types as messages spell them (§2): each reads back as the type it names, so a function type
 * keeps the parentheses a `?` after it needs, and drops those its result doesn't.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { idOf, programOf } from '../../program/program.test-kit.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { VariableDeclaration } from '../../syntax/statements.ts';
import { checkProgram } from '../check.ts';
import { typeText } from './type-text.ts';

/** The text of the type `written` resolves to, as a parameter's. */
function spelled(written: string): string | undefined {
  const program = stdProgramOf({ 'main.ista': `fn f(x: ${written}):\n  ()\n` });
  const checker = checkProgram(program);
  const f = program.modules.get(idOf('main.ista'))?.tree.root.items[0] as FunctionDeclaration;
  const [x] = checker.parametersOf(f);
  return x === undefined ? undefined : typeText(x.type);
}

describe('typeText', () => {
  it.each([
    'int?',
    'Array<int?>',
    'fn(int) -> int?',
    '(fn(int) -> int)?',
    '(fn() -> int)??',
    'Array<(sendable fn() -> int)?>',
    'fn() -> (fn() -> int)?',
  ])('spells %s as written', (written) => {
    expect(spelled(written)).toBe(written);
  });

  it('spells the value behind a shared struct as *Name with its type arguments', () => {
    const program = stdProgramOf({
      'main.ista': [
        'shared struct Counter { count: int }',
        'fn f(c: Counter, s: Shared<int>):',
        '  const a = *c',
        '  const b = *s',
      ].join('\n'),
    });
    const checker = checkProgram(program);
    const items = program.modules.get(idOf('main.ista'))?.tree.root.items ?? [];
    const f = items[1] as FunctionDeclaration;
    const body = f.body === undefined ? undefined : checker.bodyOf(f);
    const [a, b] = (f.body?.statements ?? []) as VariableDeclaration[];
    expect(a && body && typeText(body.typeOf(a.initializer))).toBe('*Counter');
    expect(b && body && typeText(body.typeOf(b.initializer))).toBe('*Shared<int>');
  });

  it('spells a non-prelude Optional declaration as Optional<T>, not T?', () => {
    const program = programOf({
      'main.ista': 'struct Optional<T> { value: T }\nfn f(x: Optional<int>):\n  ()\n',
    });
    const checker = checkProgram(program);
    const f = program.modules.get(idOf('main.ista'))?.tree.root.items[1] as FunctionDeclaration;
    const [x] = checker.parametersOf(f);
    expect(x && typeText(x.type)).toBe('Optional<int>');
  });
});

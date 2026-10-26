/**
 * Types as messages spell them (§2): each reads back as the type it names, so a function type
 * keeps the parentheses a `?` after it needs, and drops those its result doesn't.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { idOf } from '../../program/program.test-kit.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
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
});

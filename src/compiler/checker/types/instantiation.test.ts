/**
 * A generic body read for one instantiation records no type of its own type parameters: every
 * type it records is substituted.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { idOf } from '../../program/program.test-kit.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { For } from '../../syntax/statements.ts';
import { checkProgram } from '../check.ts';
import { instantiatedBody } from './instantiation.ts';
import { intType, substitutionFor } from './type.ts';
import { typeText } from './type-text.ts';

describe('an instantiated body', () => {
  it("gives a loop's cursor the item type of its instantiation", () => {
    const text =
      'fn count<T>(xs: Array<T>) -> int:\n  let n = 0\n  for x in xs:\n    n += 1\n  n\n';
    const program = stdProgramOf({ 'main.ista': text });
    const checker = checkProgram(program);
    const count = program.modules.get(idOf('main.ista'))?.tree.root.items[0] as FunctionDeclaration;
    const loop = count.body?.statements[1] as For;
    const body = checker.bodyOf(count);
    const form =
      body &&
      instantiatedBody(body, substitutionFor(count.typeParameters, [intType])).iterationOf(loop);
    expect(form?.kind === 'cursor' && typeText(form.item)).toBe('int');
  });
});

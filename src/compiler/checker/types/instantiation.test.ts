/**
 * A generic body read for one instantiation records no type of its own type parameters: every
 * type it records is substituted.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { idOf } from '../../program/program.test-kit.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import { casesOf, type Match, type MemberAccess } from '../../syntax/expressions/index.ts';
import { type For, tailExpressionOf } from '../../syntax/statements.ts';
import { checkProgram } from '../check.ts';
import { namesBound } from '../checked-pattern.ts';
import { instantiatedBody } from './instantiation.ts';
import { substitutionFor } from './substitution.ts';
import { intType } from './type.ts';
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
      instantiatedBody(body, substitutionFor(count.typeParameters, [intType]), checker).iterationOf(
        loop,
      );
    expect(form?.kind === 'cursor' && typeText(form.item)).toBe('int');
  });

  it("gives the names an or-pattern's alternatives bind the types of its instantiation", () => {
    const text = [
      'fn first<T>(xs: Array<T>) -> T?:',
      '  match xs:',
      '    case [x] | [x, _]: x',
      '    case _: none',
      '',
    ].join('\n');
    const program = stdProgramOf({ 'main.ista': text });
    const checker = checkProgram(program);
    const first = program.modules.get(idOf('main.ista'))?.tree.root.items[0] as FunctionDeclaration;
    const statement = first.body?.statements[0];
    const match = (
      statement?.kind === 'ExpressionStatement' ? statement.expression : statement
    ) as Match;
    const [alternatives] = casesOf(match);
    const body = checker.bodyOf(first);
    const checked =
      alternatives &&
      body &&
      instantiatedBody(body, substitutionFor(first.typeParameters, [intType]), checker).patternOf(
        alternatives.pattern,
      );
    expect(checked && namesBound(checked).map(({ type }) => typeText(type))).toEqual(['int']);
  });

  it('resolves a field read through a type parameter for the type standing for it', () => {
    const text = [
      'trait Sized:',
      '  size: int',
      'struct Box { label: string; size: int }',
      'fn sizeOf<T is Sized>(value: T) -> int:',
      '  value.size',
      'fn kinds(box: Box, sized: any Sized):',
      '  ()',
      '',
    ].join('\n');
    const program = stdProgramOf({ 'main.ista': text });
    const checker = checkProgram(program);
    const items = program.modules.get(idOf('main.ista'))?.tree.root.items ?? [];
    const [sizeOf, kinds] = items.slice(2) as FunctionDeclaration[];
    const access = sizeOf?.body && (tailExpressionOf(sizeOf.body) as MemberAccess);
    const body = sizeOf && checker.bodyOf(sizeOf);
    const readFor = (index: number) => {
      const type = kinds && checker.parametersOf(kinds)[index]?.type;
      const substitution = sizeOf && type && substitutionFor(sizeOf.typeParameters, [type]);
      return access && body && substitution
        ? instantiatedBody(body, substitution, checker).fieldReadOf(access)
        : undefined;
    };
    expect(access && body?.fieldReadOf(access).kind).toBe('required');
    expect(readFor(0)).toEqual({ kind: 'position', index: 1 });
    expect(readFor(1)?.kind).toBe('dispatch');
  });
});

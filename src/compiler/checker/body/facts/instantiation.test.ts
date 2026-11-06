/**
 * A generic body read for one instantiation records no type of its own type parameters: every
 * type it records is substituted.
 */

import { describe, expect, it } from 'vitest';
import { runPrograms } from '../../../../../test/corpus/programs.ts';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { idOf } from '../../../program/program.test-kit.ts';
import { programModule } from '../../../program/program.ts';
import {
  type FunctionDeclaration,
  type TypeParameter,
  typeParametersOf,
} from '../../../syntax/declarations.ts';
import type { Expression, Match, MemberAccess } from '../../../syntax/expressions/index.ts';
import { casesOf } from '../../../syntax/expressions/readings.ts';
import type { Pattern } from '../../../syntax/patterns.ts';
import { type For, tailExpressionOf } from '../../../syntax/statements.ts';
import { bodyOf, nodesUnder, type SyntaxNode } from '../../../syntax/tree.ts';
import { checkProgram } from '../../check.ts';
import type { CheckedBody } from '../../surface/checked-body.ts';
import { namesBound, type PartStep } from '../../surface/checked-pattern.ts';
import { parametersIn } from '../../types/parts/type-parts.ts';
import { substitutionFor } from '../../types/substitution.ts';
import { intType, stringType } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type-text.ts';

describe('an instantiated body', () => {
  it("gives a loop's cursor the item type of its instantiation", () => {
    const text =
      'fn count<T>(xs: Array<T>) -> Int:\n  let n = 0\n  for x in xs:\n    n += 1\n  n\n';
    const program = stdProgramOf({ 'main.ista': text });
    const checker = checkProgram(program);
    const { tree } = programModule(program, idOf('main.ista'));
    const count = tree.root.items[0] as FunctionDeclaration;
    const loop = bodyOf(tree, count)?.statements[1] as For;
    const body = checker.bodyOf(count);
    const form = body
      ?.instantiated(substitutionFor(count.typeParameters, [intType]), checker)
      .iterationOf(loop);
    expect(form?.kind === 'cursor' && typeText(form.item)).toBe('Int');
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
    const { tree } = programModule(program, idOf('main.ista'));
    const first = tree.root.items[0] as FunctionDeclaration;
    const statement = bodyOf(tree, first)?.statements[0];
    const match = (
      statement?.kind === 'ExpressionStatement' ? statement.expression : statement
    ) as Match;
    const [alternatives] = casesOf(match);
    const body = checker.bodyOf(first);
    const checked =
      alternatives &&
      body
        ?.instantiated(substitutionFor(first.typeParameters, [intType]), checker)
        .patternOf(alternatives.pattern);
    expect(checked && namesBound(checked).map(({ type }) => typeText(type))).toEqual(['Int']);
  });

  it("reads a member's value as the part itself where its union collapses", () => {
    const stepRead = (step: PartStep) => {
      if (typeof step === 'number') {
        return step;
      }
      if (step.kind === 'field') {
        return `.${step.name}`;
      }
      if (step.kind !== 'member') {
        return step;
      }
      return step.union.kind === 'union' ? 'into its member' : 'the part itself';
    };
    const text = [
      'struct Box<V> { value: V }',
      'fn boxed<T>(x: Box<T> | Box<Int>) -> Int:',
      '  match x:',
      '    case Box<Int>{value} as b: value',
      '    case _: 0',
      '',
    ].join('\n');
    const program = stdProgramOf({ 'main.ista': text });
    const checker = checkProgram(program);
    const { tree } = programModule(program, idOf('main.ista'));
    const boxed = tree.root.items[1] as FunctionDeclaration;
    const statement = bodyOf(tree, boxed)?.statements[0];
    const match = (
      statement?.kind === 'ExpressionStatement' ? statement.expression : statement
    ) as Match;
    const [taken] = casesOf(match);
    const body = checker.bodyOf(boxed);
    const read = (typeArgument: typeof intType) =>
      taken &&
      body
        ?.instantiated(substitutionFor(boxed.typeParameters, [typeArgument]), checker)
        .patternOf(taken.pattern)
        ?.bindings.map(({ path, narrowedFrom }) => ({
          path: path.map(stepRead),
          narrowed: narrowedFrom !== undefined,
        }));
    expect(read(stringType)).toEqual([
      { path: ['into its member', '.value'], narrowed: false },
      { path: ['into its member'], narrowed: false },
    ]);
    expect(read(intType)).toEqual([
      { path: ['the part itself', '.value'], narrowed: false },
      { path: ['the part itself'], narrowed: false },
    ]);
  });

  it('resolves a field read through a type parameter for the type standing for it', () => {
    const text = [
      'trait Sized:',
      '  size: Int',
      'struct Box { label: String, size: Int }',
      'fn sizeOf<T is Sized>(value: T) -> Int:',
      '  value.size',
      'fn kinds(box: Box, sized: any Sized):',
      '  ()',
      '',
    ].join('\n');
    const program = stdProgramOf({ 'main.ista': text });
    const checker = checkProgram(program);
    const { tree } = programModule(program, idOf('main.ista'));
    const [sizeOf, kinds] = tree.root.items.slice(2) as FunctionDeclaration[];
    const written = sizeOf && bodyOf(tree, sizeOf);
    const access = written && (tailExpressionOf(written) as MemberAccess);
    const body = sizeOf && checker.bodyOf(sizeOf);
    const readFor = (index: number) => {
      const type = kinds && checker.parametersOf(kinds)[index]?.type;
      const substitution = sizeOf && type && substitutionFor(sizeOf.typeParameters, [type]);
      return access && body && substitution
        ? body.instantiated(substitution, checker).fieldReadOf(access)
        : undefined;
    };
    expect(access && body?.fieldReadOf(access)?.kind).toBe('required');
    expect(readFor(0)).toEqual({ kind: 'position', index: 1 });
    expect(readFor(1)?.kind).toBe('dispatch');
  });
});

/**
 * Every value `value` holds, outside syntax: a node keeps no type of its instance. Nor does where a
 * field is declared, which keeps its type there, before any substitution (types/type/index.ts
 * `FieldMember`), as a shape written in the generic function's own signature does.
 */
function valuesIn(value: unknown, seen = new Set<unknown>()): readonly unknown[] {
  if (typeof value !== 'object' || value === null || seen.has(value) || 'span' in value) {
    return [];
  }
  seen.add(value);
  const held = Object.entries(value).flatMap(([key, each]) =>
    key === 'declared' ? [] : valuesIn(each, seen),
  );
  return [value, ...held];
}

/** What each typed table of `body` records at `node`. */
function typedTablesAt(body: CheckedBody, node: SyntaxNode): readonly unknown[] {
  const expression = node as Expression;
  return [
    body.typeOf(expression),
    body.fitAt(expression),
    body.chainOf(expression),
    body.patternOf(node as Pattern),
    node.kind === 'MemberAccess' ? body.fieldReadOf(node) : undefined,
    node.kind === 'Identifier' ? [body.declaredTypeOf(node), body.namedFieldOf(node)] : undefined,
    node.kind === 'Lambda' || node.kind === 'FunctionDeclaration'
      ? body.functionOf(node)
      : undefined,
    node.kind === 'VariableDeclaration' || node.kind === 'For' || node.kind === 'SelectCase'
      ? body.targetsOf(node)
      : undefined,
    node.kind === 'For' || node.kind === 'Comprehension' ? body.iterationOf(node) : undefined,
    node.kind === 'Assignment' ? body.assignedOf(node) : undefined,
  ];
}

describe('a generic function instantiated as lowering reads it', () => {
  it.each(runPrograms)('names none of its type parameters in $name', ({ text }) => {
    const program = stdProgramOf({ 'main.ista': text });
    const checker = checkProgram(program);
    const items = program.modules.get(idOf('main.ista'))?.tree.root.items ?? [];
    const functions = items.filter((item) => item.kind === 'FunctionDeclaration');
    const calls = functions.flatMap((each) => checker.bodyOf(each)?.madeCalls() ?? []);
    const leaking = calls.flatMap(({ call }) => {
      const generic = call.function;
      const body = checker.bodyOf(generic);
      const parameters = typeParametersOf(generic.typeParameters);
      if (
        call.kind !== 'function' ||
        body === undefined ||
        parameters.length === 0 ||
        call.typeArguments.some((type) => parametersIn(type).length > 0)
      ) {
        return [];
      }
      const instance = body.instantiated(
        substitutionFor(generic.typeParameters, call.typeArguments),
        checker,
      );
      const { tree } = programModule(program, checker.moduleOf(generic));
      const written = bodyOf(tree, generic);
      const nodes = written === undefined ? [] : nodesUnder(tree, written);
      return [instance.result, ...nodes.flatMap((node) => typedTablesAt(instance, node))]
        .flatMap((each) => valuesIn(each))
        .filter(
          (each) =>
            (each as { kind?: unknown }).kind === 'parameter' &&
            parameters.includes((each as { declaration: TypeParameter }).declaration),
        )
        .map(() => generic.name.text);
    });
    expect(leaking).toEqual([]);
  });
});

/**
 * The lookup queries over every corpus program, valid and invalid: no query throws at any node,
 * every name binding or checking resolved in a body is answered with the declaration they chose,
 * a called variant's name, or one named as a function value, with the variant, of each type its
 * call or its value made and only those, and every name of a variant with its enum's type.
 * Checking a program twice is the costly part, so one pass per program asks all of it.
 */

import { describe, expect, it } from 'vitest';
import { invalidPrograms, runPrograms } from '../../../../test/corpus/programs.ts';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import type { Entity, VariantEntity } from '../../binder/entities.ts';
import { idOf } from '../../program/program.test-kit.ts';
import type { ModuleId } from '../../program/program.ts';
import { constructedVariant } from '../../syntax/declarations/field-defaults.ts';
import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import { callOfCallee } from '../../syntax/expressions/readings.ts';
import {
  ancestorsOf,
  nodesUnder,
  parentOf,
  type SyntaxNode,
  type SyntaxTree,
} from '../../syntax/tree/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import { type Checker, checkProgram } from '../check.ts';
import type { Denotation, JoinedBody } from '../surface/denotation.ts';
import { sameType } from '../types/identity/identity.ts';
import type { Type } from '../types/type/index.ts';
import { membersOf } from '../types/type/index.ts';
import { answersAt } from './lookup.test-kit.ts';

const corpus = [...runPrograms, ...invalidPrograms].map(({ name, text }) => ({ name, text }));

/** The corpus program's module, checked. */
interface CheckedModule {
  readonly checker: Checker;
  readonly module: ModuleId;
  readonly tree: SyntaxTree;
}

/** Where `node`, asked every query, is not answered as binding and checking chose. */
function disagreementsAt(checked: CheckedModule, node: SyntaxNode): readonly string[] {
  const { checker, module } = checked;
  const body = checker.lookup.bodyHolding(module, node);
  answersAt(checker, module, node, body);
  if (node.kind !== 'Identifier') {
    return [];
  }
  const denotations = checker.lookup.denotationsOf(module, node);
  const outsideItsEnum = denotations
    .filter(({ declared, type }) => declared.kind === 'variant' && !isEnumOf(declared.entity, type))
    .map(() => `${node.text} at ${node.span.from} outside its enum`);
  if (body === undefined) {
    return outsideItsEnum;
  }
  const made = madeBy(checked, node, body);
  const variants = denotations.filter(({ declared }) => declared.kind === 'variant');
  const notAsMade = variants
    .filter(({ type }) => !isMade(made, type))
    .map(() => `${node.text} at ${node.span.from} not of the type its call made`);
  const unnamed = (variants.length === 0 ? [] : (made ?? []))
    .filter(
      (type) => type.kind === 'nominal' && !variants.some((each) => sameTypes(each.type, type)),
    )
    .map(() => `${node.text} at ${node.span.from} missing a type its call made`);
  return [
    ...outsideItsEnum,
    ...notAsMade,
    ...unnamed,
    ...chosenFor(checked, node, body)
      .filter((chosen) => !denotations.some(chosen))
      .map(() => `${node.text} at ${node.span.from}`),
  ];
}

/** Whether `type` is the enum declaring `variant`, with whatever type arguments. */
function isEnumOf(variant: VariantEntity, type: Type | undefined): boolean {
  return type?.kind === 'nominal' && type.entity.declaration === variant.enum;
}

/**
 * What `name` made, one type per pass of the field loops around it: a call of it, bare or
 * qualified, the value it gives, and a function value it names, the value its calls give;
 * undefined for neither.
 */
function madeBy(
  { tree }: CheckedModule,
  name: Identifier,
  body: JoinedBody,
): readonly Type[] | undefined {
  const { value, call } = namingAt(tree, name);
  if (call !== undefined) {
    const made = body.typeOf(call);
    return made === undefined ? undefined : membersOf(made);
  }
  const valued = body.functionValuesAt(value).length > 0 ? body.typeOf(value) : undefined;
  return valued === undefined
    ? undefined
    : membersOf(valued).flatMap((each) => (each.kind === 'function' ? [each.result] : []));
}

/**
 * Where `name` names what it names: the name or the member access it ends (`named`); the `value`
 * it is, with any type arguments written after it, where a function value is resolved; and the
 * `call` of it, if any.
 */
function namingAt(tree: SyntaxTree, name: Identifier) {
  const parent = parentOf(tree, name);
  const named = parent?.kind === 'MemberAccess' && parent.member === name ? parent : name;
  const holders = ancestorsOf(tree, named).slice(1);
  const [holder] = holders;
  const value = holder?.kind === 'TypeApplication' && holder.target === named ? holder : named;
  return { named, value, call: callOfCallee(named, holders) };
}

/**
 * Whether `type` is a type `made`, one per pass of a field loop, as a variant called or named as a
 * function value names it; any, where nothing was made or what was is unknown.
 */
function isMade(made: readonly Type[] | undefined, type: Type | undefined): boolean {
  return (
    made === undefined ||
    made.some((each) => each.kind === 'error') ||
    made.some((each) => sameTypes(type, each))
  );
}

function sameTypes(first: Type | undefined, second: Type): boolean {
  return first !== undefined && sameType(first, second);
}

/** The declarations binding and checking chose for `name`, as checks on what a denotation names. */
function chosenFor(
  { checker, module, tree }: CheckedModule,
  name: Identifier,
  body: JoinedBody,
): readonly ((denotation: Denotation) => boolean)[] {
  const naming = namingAt(tree, name);
  const member = naming.named.kind === 'MemberAccess' ? naming.named : undefined;
  // A member access names a function as a value, or reads a getter, the call made at it.
  const { value } = naming;
  const called =
    naming.call === undefined
      ? [
          ...body.functionValuesAt(value),
          ...(value.kind === 'MemberAccess' ? body.callsAt(value) : []),
        ]
      : body.callsAt(naming.call);
  const field = body.fieldGivenBy(name);
  const read = member === undefined ? undefined : body.fieldReadOf(member);
  const entity = checker.bindings.entityOf(module, name);
  const isOverloadChosen = entity?.kind === 'functions' && called.length > 0;
  return [
    ...called.map((call) => denotes((declared) => namesCalled(declared, call.function))),
    ...(field === undefined && read === undefined
      ? []
      : [denotes((declared) => declared.kind === 'field' && declared.field.name === name.text)]),
    ...(entity === undefined || isOverloadChosen ? [] : boundAs(body, name, entity)),
  ];
}

/**
 * Whether `declared` is what a call of `called` names: the function, or for a variant's
 * constructor, the variant it builds (§5.3).
 */
function namesCalled(declared: Denotation['declared'], called: FunctionDeclaration): boolean {
  if (declared.kind === 'variant') {
    return constructedVariant(called)?.variant === declared.entity.variant;
  }
  return 'declaration' in declared && declared.declaration === called;
}

/** A check that some denotation declares what `declares` accepts. */
function denotes(
  declares: (declared: Denotation['declared']) => boolean,
): (denotation: Denotation) => boolean {
  return ({ declared }) => declares(declared);
}

function boundAs(
  body: JoinedBody,
  name: Identifier,
  entity: Entity,
): readonly ((denotation: Denotation) => boolean)[] {
  switch (entity.kind) {
    case 'functions': {
      const { overloads } = entity;
      return overloads.length === 0
        ? []
        : [
            ({ declared }) =>
              declared.kind === 'function' && overloads.includes(declared.declaration),
          ];
    }
    case 'variants': {
      const chosen = body.chosenVariantOf(name);
      return chosen === undefined
        ? []
        : [({ declared }) => declared.kind === 'variant' && declared.entity === chosen];
    }
    default:
      return [({ declared }) => 'entity' in declared && declared.entity === entity];
  }
}

describe('lookup over the corpus', () => {
  it.each(corpus)('answers every node of $name as binding and checking chose', ({ text }) => {
    const program = stdProgramOf({ 'main.ista': text });
    const checker = checkProgram(program);
    const module = idOf('main.ista');
    const tree = program.modules.get(module)?.tree;
    expect(tree).toBeDefined();
    if (tree === undefined) {
      return;
    }
    const checked = { checker, module, tree };
    const reported = [...checker.diagnosticsOf(module)];
    const disagreeing = nodesUnder(tree, tree.root).flatMap((node) =>
      disagreementsAt(checked, node),
    );
    expect(checker.diagnosticsOf(module)).toEqual(reported);
    expect(disagreeing).toEqual([]);
  });
});

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
import type { Call } from '../../syntax/expressions/index.ts';
import { nodesUnder, parentOf, type SyntaxNode, type SyntaxTree } from '../../syntax/tree/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import { type Checker, checkProgram } from '../check.ts';
import type { Denotation, JoinedBody } from '../surface/denotation.ts';
import type { ResolvedSite } from '../surface/resolved-call.ts';
import { sameType } from '../types/identity/identity.ts';
import type { Type } from '../types/type/index.ts';
import { membersOf } from '../types/unions/unions.ts';
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
  answersAt(checker, module, node);
  const body = checker.lookup.bodyHolding(module, node);
  if (node.kind !== 'Identifier') {
    return [];
  }
  const outsideItsEnum = checker.lookup
    .denotationsOf(module, node)
    .filter(({ declared, type }) => declared.kind === 'variant' && !isEnumOf(declared.entity, type))
    .map(() => `${node.text} at ${node.span.from} outside its enum`);
  if (body === undefined) {
    return outsideItsEnum;
  }
  const denotations = checker.lookup.denotationsOf(module, node);
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
  const parent = parentOf(tree, name);
  const member = parent?.kind === 'MemberAccess' && parent.member === name ? parent : undefined;
  const call =
    callWith(name, parent) ??
    callWith(member, member === undefined ? undefined : parentOf(tree, member));
  if (call !== undefined) {
    const made = body.typeOf(call);
    return made === undefined ? undefined : membersOf(made);
  }
  const site = member ?? name;
  const value = body.callsAt(site).length > 0 ? body.typeOf(site) : undefined;
  return value === undefined
    ? undefined
    : membersOf(value).flatMap((each) => (each.kind === 'function' ? [each.result] : []));
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

/** `call` when it is a call of `callee`. */
function callWith(callee: SyntaxNode | undefined, call: SyntaxNode | undefined): Call | undefined {
  return call?.kind === 'Call' && callee !== undefined && call.callee === callee ? call : undefined;
}

/** The declarations binding and checking chose for `name`, as checks on what a denotation names. */
function chosenFor(
  { checker, module, tree }: CheckedModule,
  name: Identifier,
  body: JoinedBody,
): readonly ((denotation: Denotation) => boolean)[] {
  const parent = parentOf(tree, name);
  const grandparent = parent === undefined ? undefined : parentOf(tree, parent);
  const member = parent?.kind === 'MemberAccess' && parent.member === name ? parent : undefined;
  const site: ResolvedSite =
    callWith(name, parent) ?? callWith(member, grandparent) ?? member ?? name;
  const called = body.callsAt(site);
  const field = body.namedFieldOf(name);
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
 * constructor, the variant it builds (§3.11).
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

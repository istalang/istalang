/**
 * The lookup queries over every corpus program, valid and invalid: no query throws at any node,
 * and every name binding or checking resolved in a body is answered with the declaration they
 * chose. Checking a program twice is the costly part, so one pass per program asks both.
 */

import { describe, expect, it } from 'vitest';
import { invalidPrograms, runPrograms } from '../../../../test/corpus/programs.ts';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import type { Entity } from '../../binder/entities.ts';
import { idOf } from '../../program/program.test-kit.ts';
import type { ModuleId } from '../../program/program.ts';
import type { Declaration } from '../../syntax/declarations.ts';
import type { Call, Expression } from '../../syntax/expressions/index.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { Pattern } from '../../syntax/patterns.ts';
import type { VariableDeclaration } from '../../syntax/statements.ts';
import { nodesUnder, parentOf, type SyntaxNode, type SyntaxTree } from '../../syntax/tree.ts';
import type { TypeNode } from '../../syntax/types.ts';
import { type CheckedBody, type Checker, checkProgram } from '../check.ts';
import type { Denotation } from '../denotation.ts';
import type { ResolvedSite } from '../resolved-call.ts';

const corpus = [...runPrograms, ...invalidPrograms].map(({ name, text }) => ({ name, text }));

const typeKinds = new Set([
  'NamedType',
  'OptionalType',
  'TupleType',
  'ParenthesizedType',
  'FunctionType',
  'StructType',
  'ReferenceType',
  'AnyType',
]);

const declarationKinds = new Set([
  'NamedImport',
  'NamespaceImport',
  'StructDeclaration',
  'SharedStructDeclaration',
  'ExternStructDeclaration',
  'ExternConstantDeclaration',
  'EnumDeclaration',
  'TraitDeclaration',
  'TypeAliasDeclaration',
  'FunctionDeclaration',
  'VariableDeclaration',
]);

/** Asks every query that may be asked of `node`; each answer is thrown away. */
function askEverything(checker: Checker, module: ModuleId, node: SyntaxNode): void {
  const { lookup } = checker;
  const body = lookup.bodyHolding(module, node);
  body?.typeOf(node as Expression);
  body?.patternOf(node as Pattern);
  body?.candidatesAt(node as ResolvedSite);
  if (node.kind === 'Identifier') {
    lookup.denotationsOf(module, node);
    body?.declaredTypeOf(node);
    body?.namedFieldOf(node);
    body?.chosenVariantOf(node);
  }
  if (node.kind === 'MemberAccess') {
    body?.fieldReadOf(node);
    body?.chainOf(node);
    const target = body?.typeOf(node.target);
    if (target !== undefined) {
      lookup.membersOf(module, target);
    }
  }
  if (typeKinds.has(node.kind)) {
    lookup.typeOfNode(module, node as TypeNode);
  }
  if (declarationKinds.has(node.kind)) {
    checker.moduleOf(node as Declaration | VariableDeclaration);
  }
}

/** The corpus program's module, checked. */
interface CheckedModule {
  readonly checker: Checker;
  readonly module: ModuleId;
  readonly tree: SyntaxTree;
}

/** Where `node`, asked every query, is not answered as binding and checking chose. */
function disagreementsAt(checked: CheckedModule, node: SyntaxNode): readonly string[] {
  const { checker, module } = checked;
  askEverything(checker, module, node);
  const body = checker.lookup.bodyHolding(module, node);
  if (node.kind !== 'Identifier' || body === undefined) {
    return [];
  }
  const denotations = checker.lookup.denotationsOf(module, node);
  return chosenFor(checked, node, body)
    .filter((chosen) => !denotations.some(chosen))
    .map(() => `${node.text} at ${node.span.start}`);
}

/** `call` when it is a call of `callee`. */
function callWith(callee: SyntaxNode | undefined, call: SyntaxNode | undefined): Call | undefined {
  return call?.kind === 'Call' && callee !== undefined && call.callee === callee ? call : undefined;
}

/** The declarations binding and checking chose for `name`, as checks on what a denotation names. */
function chosenFor(
  { checker, module, tree }: CheckedModule,
  name: Identifier,
  body: CheckedBody,
): readonly ((denotation: Denotation) => boolean)[] {
  const parent = parentOf(tree, name);
  const grandparent = parent === undefined ? undefined : parentOf(tree, parent);
  const member = parent?.kind === 'MemberAccess' && parent.member === name ? parent : undefined;
  const site: ResolvedSite =
    callWith(name, parent) ?? callWith(member, grandparent) ?? member ?? name;
  const called = body.resolved.get(site);
  const field = body.namedFieldOf(name);
  const read = member === undefined ? undefined : body.fieldReadOf(member);
  const entity = checker.bindings.entityOf(module, name);
  const isOverloadChosen = entity?.kind === 'functions' && called !== undefined;
  return [
    ...(called === undefined
      ? []
      : [
          denotes(
            (declared) => 'declaration' in declared && declared.declaration === called.function,
          ),
        ]),
    ...(field === undefined && read === undefined
      ? []
      : [denotes((declared) => declared.kind === 'field' && declared.field.name === name.text)]),
    ...(entity === undefined || isOverloadChosen ? [] : boundAs(checker, body, name, entity)),
  ];
}

/** A check that some denotation declares what `declares` accepts. */
function denotes(
  declares: (declared: Denotation['declared']) => boolean,
): (denotation: Denotation) => boolean {
  return ({ declared }) => declares(declared);
}

function boundAs(
  checker: Checker,
  body: CheckedBody,
  name: Identifier,
  entity: Entity,
): readonly ((denotation: Denotation) => boolean)[] {
  switch (entity.kind) {
    case 'functions': {
      const overloads = checker.bindings.overloadsOf(entity);
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
    const disagreeing = nodesUnder(tree.root).flatMap((node) => disagreementsAt(checked, node));
    expect(checker.diagnosticsOf(module)).toEqual(reported);
    expect(disagreeing).toEqual([]);
  });
});

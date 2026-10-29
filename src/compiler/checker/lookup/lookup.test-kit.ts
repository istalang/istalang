/**
 * A program of one module, `main.ista`, and the modules it imports by key, beside the std modules,
 * checked, with its nodes found by kind and text, so a lookup test names what it asks about as
 * written; and every query a tool may ask of a node, answered, for sweeps over every node.
 */

import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { idOf } from '../../program/program.test-kit.ts';
import type { ModuleId } from '../../program/program.ts';
import type { Declaration } from '../../syntax/declarations.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { Pattern } from '../../syntax/patterns.ts';
import type { VariableDeclaration } from '../../syntax/statements.ts';
import { nodesUnder, type SyntaxNode } from '../../syntax/tree.ts';
import type { TypeNode } from '../../syntax/types.ts';
import { type Checker, checkProgram } from '../check.ts';
import type { ResolvedSite } from '../resolved-call.ts';

export function checkedMain(text: string, imported: Readonly<Record<string, string>> = {}) {
  const program = stdProgramOf({ 'main.ista': text, ...imported });
  const module = idOf('main.ista');
  const tree = program.modules.get(module)?.tree;
  if (tree === undefined) {
    throw new Error('main.ista was not loaded.');
  }
  const nodes = nodesUnder(tree, tree.root);
  /** The `nth` identifier written as `text`, counting from 0 in source order. */
  const named = (written: string, nth = 0): Identifier => {
    const found = nodes.filter(
      (node): node is Identifier => node.kind === 'Identifier' && node.text === written,
    )[nth];
    if (found === undefined) {
      throw new Error(`No identifier '${written}' number ${nth} in main.ista.`);
    }
    return found;
  };
  /** The first node of `kind`. */
  const first = <Kind extends SyntaxNode['kind']>(kind: Kind) =>
    nodes.find((node): node is Extract<SyntaxNode, { kind: Kind }> => node.kind === kind);
  return { checker: checkProgram(program), module, named, first };
}

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

/** The answer of every query that may be asked of `node` of `module`, in a fixed order. */
export function answersAt(
  checker: Checker,
  module: ModuleId,
  node: SyntaxNode,
): readonly unknown[] {
  const { lookup } = checker;
  const body = lookup.bodyHolding(module, node);
  const answers: unknown[] = [
    body === undefined,
    body?.typeOf(node as Expression),
    body?.patternOf(node as Pattern),
    body?.candidatesAt(node as ResolvedSite),
    body?.resolved.get(node as ResolvedSite),
  ];
  if (node.kind === 'Identifier') {
    answers.push(
      lookup.denotationsOf(module, node),
      body?.declaredTypeOf(node),
      body?.namedFieldOf(node),
      body?.chosenVariantOf(node),
    );
  }
  if (node.kind === 'MemberAccess') {
    const target = body?.typeOf(node.target);
    answers.push(
      body?.fieldReadOf(node),
      body?.chainOf(node),
      target === undefined ? undefined : lookup.membersOf(module, target),
    );
  }
  if (typeKinds.has(node.kind)) {
    answers.push(lookup.typeOfNode(module, node as TypeNode));
  }
  if (declarationKinds.has(node.kind)) {
    answers.push(checker.moduleOf(node as Declaration | VariableDeclaration));
  }
  return answers;
}

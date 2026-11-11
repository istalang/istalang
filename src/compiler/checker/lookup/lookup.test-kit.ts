/**
 * A program of one module, `main.ista`, and the modules it imports by key, beside the std modules,
 * checked, with its nodes found by kind and text, so a lookup test names what it asks about as
 * written; and every query a tool may ask of a node, answered, for sweeps over every node.
 *
 * Answers are spelled whole to compare two checkers of one program, each node by its module and its
 * place in that module's tree. A tree is numbered once, not once per program: every program a test
 * file builds shares the std modules' trees, and they hold most of a program's nodes.
 */

import { memo } from '../../../foundation/structures/memo.ts';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { idOf } from '../../program/program.test-kit.ts';
import type { ModuleId, Program } from '../../program/program.ts';
import type { Declaration } from '../../syntax/declarations/index.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import type { Pattern } from '../../syntax/patterns.ts';
import type { VariableDeclaration } from '../../syntax/statements/index.ts';
import { nodesUnder, type SyntaxNode, type SyntaxTree } from '../../syntax/tree/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import type { TypeNode } from '../../syntax/types/index.ts';
import { type Checker, checkProgram } from '../check.ts';
import type { ResolvedSite } from '../surface/resolved-call.ts';

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
  'ContextConstantDeclaration',
  'EnumDeclaration',
  'TraitDeclaration',
  'TypeAliasDeclaration',
  'FunctionDeclaration',
  'VariableDeclaration',
]);

/**
 * The answer of every query that may be asked of `node` of `module`, in a fixed order; `body` is
 * the body holding it, for a caller that has asked already.
 */
export function answersAt(
  checker: Checker,
  module: ModuleId,
  node: SyntaxNode,
  body = checker.lookup.bodyHolding(module, node),
): readonly unknown[] {
  const { lookup } = checker;
  const answers: unknown[] = [
    body === undefined,
    body?.typeOf(node as Expression),
    body?.patternOf(node as Pattern),
    body?.candidatesAt(node as ResolvedSite),
    body?.callsAt(node as ResolvedSite),
  ];
  if (node.kind === 'Identifier') {
    answers.push(
      lookup.denotationsOf(module, node),
      body?.declaredTypeOf(node),
      body?.fieldGivenBy(node),
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

/** Each tree's nodes, numbered in source order. */
const treeNumbers = new WeakMap<SyntaxTree, ReadonlyMap<SyntaxNode, number>>();

/** The numbered trees each node stands in: a tree parsed after an edit keeps nodes of the last. */
const treesOfNode = new WeakMap<object, readonly SyntaxTree[]>();

/** `tree`'s nodes, numbered in source order. */
function numberedNodes(tree: SyntaxTree): ReadonlyMap<SyntaxNode, number> {
  return memo(treeNumbers, tree, () => {
    const numbers = new Map<SyntaxNode, number>();
    for (const node of nodesUnder(tree, tree.root)) {
      numbers.set(node, numbers.size);
      treesOfNode.set(node, [...(treesOfNode.get(node) ?? []), tree]);
    }
    return numbers;
  });
}

/**
 * How `program` names a node of its own: by its module's place and its place in that module's
 * tree; undefined for anything else, such as a node only an earlier snapshot holds.
 */
function nodeNames(program: Program): (value: object) => string | undefined {
  const modules = new Map([...program.modules.values()].map(({ tree }, index) => [tree, index]));
  for (const tree of modules.keys()) {
    numberedNodes(tree);
  }
  return (value) => {
    const tree = treesOfNode.get(value)?.find((each) => modules.has(each));
    return tree && `#${modules.get(tree)}.${numberedNodes(tree).get(value as SyntaxNode)}`;
  };
}

/**
 * `value` spelled whole, a node of the program by its name and anything else part by part, so two
 * answers spell alike only when they are alike and name the same nodes: a node an earlier snapshot
 * made, such as a dead alias's declaration, spells as its parts, not as a name.
 */
function spelled(
  value: unknown,
  nodeName: (value: object) => string | undefined,
  open = new Set<object>(),
): string {
  if (typeof value === 'function') {
    return 'fn';
  }
  if (value === null || typeof value !== 'object') {
    return String(value);
  }
  const name = nodeName(value);
  if (name !== undefined) {
    return name;
  }
  if (open.has(value)) {
    return 'cycle';
  }
  open.add(value);
  const entries =
    value instanceof Map || value instanceof Set || Array.isArray(value)
      ? [...(value as Iterable<unknown>)].map((each, index) => [String(index), each])
      : Object.entries(value).toSorted(([one], [other]) => (one < other ? -1 : 1));
  const parts = entries.map(([key, each]) => `${key}:${spelled(each, nodeName, open)}`);
  open.delete(value);
  return `{${parts.join(',')}}`;
}

/**
 * Every answer a tool may ask about `module`'s nodes (`answersAt`), spelled, so two checkers of one
 * program answer alike exactly where their spellings are equal.
 */
export function spelledAnswers(checker: Checker, module: ModuleId): readonly string[] {
  const tree = checker.program.modules.get(module)?.tree;
  const nodeName = nodeNames(checker.program);
  return (tree === undefined ? [] : [...numberedNodes(tree).keys()]).map((node) =>
    spelled(answersAt(checker, module, node), nodeName),
  );
}

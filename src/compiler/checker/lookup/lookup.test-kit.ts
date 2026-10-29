/**
 * A program of one module, `main.ista`, beside the std modules, checked, with its nodes found by
 * kind and text, so a lookup test names what it asks about as written.
 */

import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { idOf } from '../../program/program.test-kit.ts';
import type { Identifier } from '../../syntax/node.ts';
import { childrenOf, type SyntaxNode } from '../../syntax/tree.ts';
import { checkProgram } from '../check.ts';

function nodesOf(node: SyntaxNode): readonly SyntaxNode[] {
  return [node, ...childrenOf(node).flatMap(nodesOf)];
}

export function checkedMain(text: string) {
  const program = stdProgramOf({ 'main.ista': text });
  const module = idOf('main.ista');
  const tree = program.modules.get(module)?.tree;
  if (tree === undefined) {
    throw new Error('main.ista was not loaded.');
  }
  const nodes = nodesOf(tree.root);
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

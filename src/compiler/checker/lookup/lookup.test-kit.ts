/**
 * A program of one module, `main.ista`, and the modules it imports by key, beside the std modules,
 * checked, with its nodes found by kind and text, so a lookup test names what it asks about as
 * written.
 */

import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { idOf } from '../../program/program.test-kit.ts';
import type { Identifier } from '../../syntax/node.ts';
import { nodesUnder, type SyntaxNode } from '../../syntax/tree.ts';
import { checkProgram } from '../check.ts';

export function checkedMain(text: string, imported: Readonly<Record<string, string>> = {}) {
  const program = stdProgramOf({ 'main.ista': text, ...imported });
  const module = idOf('main.ista');
  const tree = program.modules.get(module)?.tree;
  if (tree === undefined) {
    throw new Error('main.ista was not loaded.');
  }
  const nodes = nodesUnder(tree.root);
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

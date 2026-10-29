/**
 * The parser's entry: a scanned source file to its syntax tree.
 *
 * Parsing is total. Whatever the input, it returns a complete tree, with Missing and Invalid nodes
 * where the source is wrong and a diagnostic explaining each (syntax/node.ts). The tree carries the
 * scanner's diagnostics before its own, so a later phase reads one list per file.
 */

import type { SourceText } from '../../text/source-text.ts';
import type { FunctionDeclaration, Module } from '../syntax/declarations.ts';
import type { Block } from '../syntax/statements.ts';
import type { ScanResult } from '../syntax/tokens.ts';
import { nodesUnder, type SyntaxTree } from '../syntax/tree.ts';
import { parseModule } from './declarations/declaration.ts';
import { createParser } from './grammar.ts';

export function parse(source: SourceText, scanned: ScanResult): SyntaxTree {
  const parser = createParser(source, scanned);
  const root = parseModule(parser);
  const diagnostics = [...scanned.diagnostics, ...parser.diagnostics];
  const bodies = bodiesHeldBy(root, parser.recordedBodies);
  return { source, root, bodies, comments: scanned.comments, diagnostics };
}

/**
 * The bodies of the functions `root` holds, of all those `recorded`. Recovery lets go of nodes in
 * many places, undoing a parse or making a node Invalid; keeping only what the tree reaches leaves
 * none of them to remember a body.
 */
function bodiesHeldBy(
  root: Module,
  recorded: ReadonlyMap<FunctionDeclaration, Block>,
): ReadonlyMap<FunctionDeclaration, Block> {
  const held = new Set(nodesUnder({ bodies: recorded }, root));
  return new Map([...recorded].filter(([declaration]) => held.has(declaration)));
}

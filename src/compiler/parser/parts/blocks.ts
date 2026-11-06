/**
 * Statement blocks, shared by every category with a body: the Block node each body becomes
 * (syntax/statements.ts), whether it was written indented, on the same line, or in braces. Layout
 * itself is in layout/; this only says that a block's items are statements (parts/items.ts),
 * which may carry annotations.
 */

import type { Block, Statement } from '../../syntax/statements.ts';
import { attachAnnotations } from '../annotations.ts';
import type { WithDocstring } from '../docstrings.ts';
import { type BodyEntry, parseBody, parseDocumentedBody } from '../layout/bodies.ts';
import type { ItemRules } from '../layout/index.ts';
import type { Parser } from '../parser.ts';
import { parseBlockItem } from './items.ts';

export const statementRules: ItemRules<Statement> = {
  parseItem: parseBlockItem,
  separator: ';',
  annotate: attachAnnotations,
};

/** `: body`, the body of a construct starting at `headerStart`. */
export function parseHeaderBody(parser: Parser, headerStart: number): Block {
  parser.expect(':');
  return parseStatementBody(parser, headerStart);
}

/** The body after a construct's `:`, starting at `headerStart`, as a Block. */
function parseStatementBody(parser: Parser, headerStart: number): Block {
  const { items, span } = parseBody(parser, statementRules, headerStart);
  return { kind: 'Block', span, statements: items };
}

/**
 * A function's body after its `:`, as a Block, entered through `enter`; the docstring first in it,
 * if any, and where the function's header ends.
 */
export function parseDocumentedStatementBody(
  parser: Parser,
  headerStart: number,
  enter: BodyEntry,
): WithDocstring<Block> & { readonly headerEnd: number } {
  const { value, doc } = parseDocumentedBody(parser, statementRules, headerStart, enter);
  const { items, span, headerEnd } = value;
  return { value: { kind: 'Block', span, statements: items }, doc, headerEnd };
}

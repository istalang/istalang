/**
 * Items and the blocks of statements that hold them.
 *
 * An item of a module or of a block is parsed whole wherever it stands, then kept only where it
 * may stand (syntax/items.ts), so a misplaced one costs one diagnostic and the code after it
 * still parses.
 *
 * A block is the Block node each body becomes (syntax/statements/index.ts), shared by every
 * category with a body, whether it was written indented, on the same line, or in braces. Layout
 * itself is in layout/; this only says that a block's items are statements, which may carry
 * annotations.
 */

import type { Diagnostic } from '../../../../foundation/diagnostics/diagnostic.ts';
import type { Span } from '../../../../foundation/text/span.ts';
import type { Declaration } from '../../../syntax/declarations/index.ts';
import { allowedInBlock, allowedInModule, type Item } from '../../../syntax/items.ts';
import type { Block, Statement } from '../../../syntax/statements/index.ts';
import type { Invalid } from '../../../syntax/tree/node.ts';
import { parserDiagnostics } from '../../diagnostics.ts';
import { attachAnnotations } from '../../layout/annotations.ts';
import { type BodyEntry, parseBody, parseDocumentedBody } from '../../layout/bodies.ts';
import type { WithDocstring } from '../../layout/docstrings.ts';
import type { ItemRules } from '../../layout/index.ts';
import type { Parser } from '../../parser.ts';

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

export function parseModuleItem(parser: Parser): Declaration | Invalid {
  const item = parseAnyItem(parser);
  return item.kind === 'Invalid' || allowedInModule(item)
    ? item
    : misplaced(parser, item, parserDiagnostics.topLevelStatement);
}

function parseBlockItem(parser: Parser): Statement | Invalid {
  const item = parseAnyItem(parser);
  return item.kind === 'Invalid' || allowedInBlock(item)
    ? item
    : misplaced(parser, item, parserDiagnostics.declarationInBlock);
}

function parseAnyItem(parser: Parser): Item | Invalid {
  return parser.topLevelDeclaration() ?? parser.statement();
}

/**
 * Reported, unless it is empty: a Missing expression, which its own diagnostic explains. The
 * Invalid node left covers all the item was read from, a function's body included.
 */
function misplaced(parser: Parser, item: Item, diagnostic: (span: Span) => Diagnostic): Invalid {
  const span = parser.spanFrom(parser.startOf(item));
  if (span.from < span.to) {
    parser.report(diagnostic(parser.textSpanOf(span)));
  }
  return { kind: 'Invalid', span };
}

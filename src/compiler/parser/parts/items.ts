/**
 * Items of a module and of a block. Either kind is parsed whole wherever it stands, then kept
 * only where it may stand (syntax/placement.ts), so a misplaced one costs one diagnostic and the
 * code after it still parses.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import type { Span } from '../../../text/span.ts';
import type { Declaration } from '../../syntax/declarations/index.ts';
import type { Invalid } from '../../syntax/node.ts';
import { allowedInBlock, allowedInModule, type Item } from '../../syntax/placement.ts';
import type { Statement } from '../../syntax/statements.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import type { Parser } from '../parser.ts';

export function parseModuleItem(parser: Parser): Declaration | Invalid {
  const item = parseAnyItem(parser);
  return item.kind === 'Invalid' || allowedInModule(item)
    ? item
    : misplaced(parser, item, parserDiagnostics.topLevelStatement);
}

export function parseBlockItem(parser: Parser): Statement | Invalid {
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

/**
 * Grammars whose operators bind at a few fixed levels, patterns' and types', parse through one
 * loop: a primary, then each operator after it whose level binds at least as tightly as the level
 * being parsed, up to a line break separating two items of a list (layout/item-breaks.ts). An
 * operator parses what follows it one level tighter, or loops at its own level, as `A | B | C`
 * makes one node of every alternative. Expressions, whose levels are the operator table's
 * (syntax/expressions/operators.ts), have a Pratt engine of their own.
 */

import type { CursorKind } from '../../cursor/index.ts';
import { breakSeparatesItems } from '../../layout/item-breaks.ts';
import type { Parser } from '../../parser.ts';

/** How a node is extended by an operator after it, at the operator's level. */
export interface LeveledParselet<Level, Node> {
  readonly level: Level;
  readonly parse: (parser: Parser, left: Node) => Node;
}

/**
 * The parser of a grammar whose operators bind at `levels`, loosest first: a node whose operators
 * all bind at least as tightly as `minLevel`.
 */
export function leveledGrammar<Level, Node>(
  levels: readonly Level[],
  primary: (parser: Parser) => Node,
  operators: Partial<Record<CursorKind, LeveledParselet<Level, Node>>>,
): (parser: Parser, minLevel: Level) => Node {
  return (parser, minLevel) => {
    const operatorNext = () =>
      breakSeparatesItems(parser) ? undefined : operators[parser.cursor.kind];
    let node = primary(parser);
    for (
      let operator = operatorNext();
      operator !== undefined && levels.indexOf(operator.level) >= levels.indexOf(minLevel);
      operator = operatorNext()
    ) {
      node = operator.parse(parser, node);
    }
    return node;
  };
}

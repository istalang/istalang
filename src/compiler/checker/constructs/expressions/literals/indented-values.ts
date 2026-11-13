/**
 * Indented values (§2): a block is checked as the brace or bracket literal its entries say it
 * builds (syntax/expressions/literals/indented-values.ts), typed as that literal is, so every rule
 * of literals keeps its one home (structs/structs.ts, collections/collections.ts).
 *
 * - Entries the literal can't hold were reported by the parser; their values are checked alone, so
 *   tools still read them.
 *
 * The literal checked is recorded with the body (`builtLiteralOf`), for lowering and tools.
 */

import type { IndentedEntry, IndentedValue } from '../../../../syntax/expressions/index.ts';
import {
  entriesLeftOut,
  literalOf,
} from '../../../../syntax/expressions/literals/indented-values.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import type { Type } from '../../../types/type/index.ts';

export function checkIndentedValue(
  context: BodyContext,
  node: IndentedValue,
  expected: Type | undefined,
): Type {
  checkValuesAlone(context, entriesLeftOut(node));
  const literal = literalOf(node);
  context.recordBuilt(node, literal);
  return context.expression(literal, expected);
}

/** Checks every value `entries` hold, which their value's literal leaves out. */
function checkValuesAlone(context: BodyContext, entries: readonly IndentedEntry[]): void {
  for (const entry of entries) {
    switch (entry.kind) {
      case 'FieldInitializer':
        context.expression(entry.value ?? entry.name);
        break;
      case 'QuotedEntry':
        context.expression(entry.value);
        break;
      case 'Spread':
        context.expression(entry.expression);
        break;
      case 'IndentedItem':
        context.expression(entry.value.kind === 'Spread' ? entry.value.expression : entry.value);
        break;
      default:
        break;
    }
  }
}

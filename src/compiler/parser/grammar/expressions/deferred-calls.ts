/**
 * The deferred call, `g f(args)` (§3.14): a name on the line of an operand shaped as a taker, a
 * path of names or a call of one (`retry(times: 5) fetchUser(id)`), starts the call the taker is
 * given. The shape alone decides, so parsing never depends on what a name means; whether the taker
 * takes a call, and whether what follows is one, is the checker's to say.
 *
 * - The call parses at prefix `await`'s level, so its postfix chain is the call's
 *   (`retry load(id).process()` defers `.process()`), and a deferred call within it nests from the
 *   right (`a b c(x)` is `a (b c(x))`); `await retry f(x)` and `-a b(c)` take the deferred call
 *   whole, and an annotation's value, read at the postfix level, never starts one.
 * - Only on the taker's line, wherever line breaks are read past (layout/item-breaks.ts
 *   `onOperandLine`), so a list's item on the next line stays an item of its own.
 * - A word a construct reads after an operand (a range's `by`) stays that construct's.
 */

import type { Expression } from '../../../syntax/expressions/index.ts';
import { operatorLevels } from '../../../syntax/expressions/operators.ts';
import { isTakerShaped } from '../../../syntax/expressions/readings.ts';
import { clauseWordsAfterOperand } from '../../../syntax/tokens/grammar-words.ts';
import { onOperandLine } from '../../layout/item-breaks.ts';
import type { Parser } from '../../parser.ts';
import type { InfixParselet } from './parselet.ts';

export const deferredCallParselet: InfixParselet = {
  level: operatorLevels.deferredCall,
  onOperandLine: true,
  parse(parser, taker) {
    if (!startsDeferredCall(parser, taker)) {
      return;
    }
    const call = parser.expression(operatorLevels.deferredCall);
    return { kind: 'DeferredCall', span: parser.spanFrom(parser.startOf(taker)), taker, call };
  },
};

/** Whether the name the cursor stands at starts the call `taker` is given. */
function startsDeferredCall(parser: Parser, taker: Expression): boolean {
  return (
    isTakerShaped(taker) &&
    onOperandLine(parser, 'identifier') &&
    !clauseWordsAfterOperand.some((word) => parser.atWord(word))
  );
}

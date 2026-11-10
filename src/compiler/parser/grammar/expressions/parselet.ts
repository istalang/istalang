/**
 * The two shapes of Pratt parselet. The tables that hold them are in expression.ts.
 *
 * A prefix parselet starts an expression at its first token. It receives the level of the operand
 * being parsed, so a loosely binding prefix operator (`not`, `..`) can report where it needs
 * parentheses. An infix parselet continues an expression past its left operand. It may decline a
 * left operand by returning undefined without consuming anything: `{` starts a struct literal only
 * after a name (§2).
 */

import type { Expression } from '../../../syntax/expressions/index.ts';
import type { PrecedenceLevel } from '../../../syntax/expressions/operators.ts';
import type { Parser } from '../../parser.ts';

export type PrefixParselet = (parser: Parser, minLevel: PrecedenceLevel) => Expression;

export interface InfixParselet {
  readonly level: PrecedenceLevel;
  readonly parse: (parser: Parser, left: Expression) => Expression | undefined;
  /**
   * Whether it applies only on the line its left operand ends on, though its level isn't postfix:
   * a deferred call's call (§3.14). A postfix one applies only there inside a list.
   */
  readonly onOperandLine?: true;
}

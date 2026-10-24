/**
 * What a body produces (§2, §4): its tail's value, or the value of a `return`.
 *
 * - With a declared result, the tail and every `return` must fit it.
 * - Without one, the body produces the type its tail and its `return`s agree on, as every set of
 *   producers of one value does (rules/agreement.ts); `never` (a `return`, `break` or `continue`)
 *   agrees with anything.
 */

import type { Span } from '../../../text/span.ts';
import type { Expression } from '../../syntax/expressions.ts';
import { type Block, tailNodeOf } from '../../syntax/statements.ts';
import type { BodyContext } from '../context.ts';
import { agreedType, type Produced } from '../rules/agreement.ts';
import { type Type, unitType } from '../types/type.ts';

/** The result of one body: declared, or gathered from its `return`s as they are checked. */
export class ReturnScope {
  readonly declared: Type | undefined;
  readonly #returned: Produced[] = [];

  constructor(declared: Type | undefined) {
    this.declared = declared;
  }

  /** Checks a `return` and what it returns, if anything, at `span`. */
  check(context: BodyContext, value: Expression | undefined, span: Span): void {
    const expected = this.declared;
    if (value === undefined) {
      if (expected !== undefined) {
        context.fit(unitType, expected, span);
      }
      this.#returned.push({ type: unitType, span });
      return;
    }
    const type =
      expected === undefined ? context.expression(value) : context.expect(value, expected);
    this.#returned.push({ type, span: value.span });
  }

  /** What `body` produces, given its tail's type, once every `return` in it has been checked. */
  result(context: BodyContext, body: Block, tail: Type): Type {
    const at = tailNodeOf(body).span;
    if (this.declared !== undefined) {
      context.fit(tail, this.declared, at);
      return this.declared;
    }
    const { decided, disagreeing } = agreedType([...this.#returned, { type: tail, span: at }]);
    if (decided === undefined) {
      return tail;
    }
    for (const { type, span } of disagreeing) {
      context.fit(type, decided, span);
    }
    return decided;
  }
}

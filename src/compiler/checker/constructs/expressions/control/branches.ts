/**
 * The branches of a branching expression (§10.1): `if`, `match` and, with its slice, `select`. Every
 * branch must have the same type, and that is the expression's type; a branch that leaves
 * (`return`, `break`, `continue`, `panic`) has type `Never`, which fits any.
 *
 * The branches agree on a type as every producer of one value does (agreement.ts): the expected
 * type decides when there is one, else the first branch with a value. Without an expected type,
 * that first branch's type is what later branches are expected to have. Branches are added one at
 * a time, so a construct checks what comes before each body (a condition, a pattern) in source
 * order.
 * Passed to a call that decides their type (§8.1), they take what their tails agree on.
 */

import type { Expression } from '../../../../syntax/expressions/index.ts';
import type { Block } from '../../../../syntax/statements/index.ts';
import type { AnchoredSpan } from '../../../../syntax/tree/positions.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import {
  blockTail,
  decidedSoFar,
  type Produced,
  settleAgreement,
} from '../../../rules/agreement.ts';
import { openAgreement } from '../../../rules/open-agreement.ts';
import type { Type } from '../../../types/type/index.ts';
import { neverType } from '../../../types/type/primitives.ts';
import { typeText } from '../../../types/type/type-text.ts';

export class Branches {
  readonly #context: BodyContext;
  readonly #node: Expression;
  readonly #expected: Type | undefined;
  readonly #produced: Produced[] = [];

  /** The branches of `node`, expected to have `expected`. */
  constructor(context: BodyContext, node: Expression, expected: Type | undefined) {
    this.#context = context;
    this.#node = node;
    this.#expected = expected;
  }

  /** What each branch so far produced, reported at its tail. */
  get produced(): readonly Produced[] {
    return this.#produced;
  }

  /**
   * Checks a branch's body, expecting what the branches so far agree on, outside a constraint
   * scope, which settles what they agree on (../../../rules/open-agreement.ts).
   */
  add(body: Block): void {
    const context = this.#context;
    const expected =
      this.#expected ?? (context.scopes.isOpen ? undefined : decidedSoFar(context, this.#produced));
    this.#produced.push(blockTail(body, context.block(body, expected)));
  }

  /**
   * The type every branch agrees on, after reporting the branches that don't fit it; where one is
   * open in the constraint scope, what they agree on once it settles
   * (../../../rules/open-agreement.ts).
   */
  agreedType(): Type {
    const mismatch = (span: AnchoredSpan, agreed: Type, found: Type) =>
      checkerDiagnostics.branchTypes(span, typeText(agreed), typeText(found));
    const context = this.#context;
    return (
      openAgreement(context, {
        node: this.#node,
        produced: this.#produced,
        expected: this.#expected,
        mismatch,
      }) ??
      settleAgreement(context, this.#produced, this.#expected, mismatch) ??
      neverType
    );
  }
}

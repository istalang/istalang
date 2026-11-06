/**
 * The branches of a branching expression (§4): `if`, `match` and, with its slice, `select`. Every
 * branch must have the same type, and that is the expression's type; a branch that leaves
 * (`return`, `break`, `continue`, `panic`) has type `Never`, which fits any.
 *
 * The branches agree on a type as every producer of one value does (agreement.ts): the expected
 * type decides when there is one, else the first branch with a value. Without an expected type,
 * that first branch's type is what later branches are expected to have. Branches are added one at
 * a time, so a construct checks what comes before each body (a condition, a pattern) in source
 * order.
 * Passed to a call that decides their type (§3.5), they take what their tails agree on.
 */

import { type Block, tailExpressionOf, tailNodeOf } from '../../../syntax/statements.ts';
import type { AcceptedPart, Accepts, BodyContext } from '../../body-context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import {
  agreedAccepts,
  decidedSoFar,
  type Produced,
  producedBy,
  settleAgreement,
} from '../../rules/agreement.ts';
import { neverType } from '../../types/primitives.ts';
import type { Type } from '../../types/type.ts';
import { typeText } from '../../types/type-text.ts';

export class Branches {
  readonly #context: BodyContext;
  readonly #expected: Type | undefined;
  readonly #produced: Produced[] = [];

  constructor(context: BodyContext, expected: Type | undefined) {
    this.#context = context;
    this.#expected = expected;
  }

  /** What each branch so far produced, reported at its tail. */
  get produced(): readonly Produced[] {
    return this.#produced;
  }

  /** Checks a branch's body, expecting what the branches so far agree on. */
  add(body: Block): void {
    const context = this.#context;
    const expected = this.#expected ?? decidedSoFar(context, this.#produced);
    const type = context.block(body, expected);
    const tail = tailExpressionOf(body);
    this.#produced.push(
      tail === undefined
        ? { type, span: tailNodeOf(body).span, site: body }
        : { ...producedBy(context, tail, type), span: tailNodeOf(body).span },
    );
  }

  /** The type every branch agrees on, after reporting the branches that don't fit it. */
  agreedType(): Type {
    const decided = settleAgreement(
      this.#context,
      this.#produced,
      this.#expected,
      (span, agreed, found) =>
        checkerDiagnostics.branchTypes(span, typeText(agreed), typeText(found)),
    );
    return decided ?? neverType;
  }
}

/** Which types branches with `bodies` can take when the call they are passed to decides it. */
export function branchesAccepts(
  context: BodyContext,
  bodies: readonly Block[],
): Accepts | undefined {
  return agreedAccepts(
    context,
    bodies.map((body) => blockPart(context, body)),
  );
}

/** Which types `block` can take when the call it is passed to decides it: its tail's (§4). */
export function blockAccepts(context: BodyContext, block: Block): Accepts | undefined {
  const tail = tailExpressionOf(block);
  return tail === undefined ? undefined : context.accepts(tail);
}

/** How `block` takes part in a branching expression's `Accepts` check. */
function blockPart(context: BodyContext, block: Block): AcceptedPart {
  const tail = tailExpressionOf(block);
  if (tail === undefined) {
    return { kind: 'typed', type: undefined };
  }
  const accepts = context.accepts(tail);
  if (accepts !== undefined) {
    return { kind: 'decided', accepts };
  }
  return block.statements.length === 1
    ? context.acceptedPart(tail)
    : { kind: 'typed', type: undefined };
}

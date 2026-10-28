/**
 * The branches of a branching expression (§4): `if`, `match` and, with its slice, `select`. Every
 * branch must have the same type, and that is the expression's type; a branch that leaves
 * (`return`, `break`, `continue`, `panic`) has type `never`, which fits any.
 *
 * The branches agree on a type as every producer of one value does (agreement.ts): the expected
 * type decides when there is one, else the first branch with a value. Without an expected type,
 * that first branch's type is what later branches are expected to have, so `if c: struct{a: 1}
 * else: struct{a: 2}` builds one anonymous type, not two (§3.1). Branches are added one at a time,
 * so a construct checks what comes before each body (a condition, a pattern) in source order.
 * Passed to a call that decides their type (§3.5), they take what their tails agree on.
 */

import { type Block, tailExpressionOf, tailNodeOf } from '../../syntax/statements.ts';
import { mentionsUnbound, takePrechecked } from '../calls/lambda-arguments.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { Accepts } from '../resolution/choice.ts';
import { neverType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import {
  type AcceptedPart,
  agreedAccepts,
  decidedSoFar,
  type Produced,
  settleAgreement,
} from './agreement.ts';

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
    const tail = tailExpressionOf(body);
    const prechecked = tail === undefined ? undefined : takePrechecked(tail);
    this.#produced.push({
      type: prechecked ?? context.block(body, expected),
      span: tailNodeOf(body).span,
      site: tail ?? body,
    });
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
    return { kind: 'own' };
  }
  const accepts = context.accepts(tail);
  if (accepts !== undefined) {
    return { kind: 'decided', accepts };
  }
  const [only] = block.statements;
  const plainSingle =
    block.statements.length === 1 &&
    only?.kind === 'ExpressionStatement' &&
    only.annotations === undefined;
  return plainSingle && !mentionsUnbound(context, tail)
    ? { kind: 'own', node: tail }
    : { kind: 'own' };
}

/**
 * What a body produces (§2, §4): its tail's value, or the value of a `return`.
 *
 * - With a declared result, the tail and every `return` must fit it.
 * - Without one, the body produces the type its tail and its `return`s agree on, as every set of
 *   producers of one value does (rules/agreement.ts); `never` (a `return`, `break` or `continue`)
 *   agrees with anything.
 * - `e?` returns an `Err` early (§3.12), so the function must produce a `Result` whose error type
 *   is the same type as `e`'s. Its `Ok` type is the function's own business, so a `?` doesn't
 *   decide the result: it is checked against the declared result at once, or against the agreed
 *   one at the end. Only a function returns, so a `return` or a `?` in any other value, such as
 *   a default or a constant's, is refused.
 */

import { wellKnown } from '../../../language/well-known.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import { type Block, type Return, tailExpressionOf, tailNodeOf } from '../../syntax/statements.ts';
import type { BodyContext, Returns } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { agreedType, fitProduced, type Produced } from '../rules/agreement.ts';
import { sameType, type Type, unitType } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { wellKnownArguments } from '../types/well-known.ts';

/** A `?` in the body: the error type it would return, and where. */
interface Propagation {
  readonly error: Type;
  readonly span: AnchoredSpan;
}

/** The result of one body: declared, or gathered from its `return`s as they are checked. */
export class ReturnScope implements Returns {
  readonly declared: Type | undefined;
  readonly #isFunction: boolean;
  readonly #returned: Produced[] = [];
  readonly #propagated: Propagation[] = [];

  /** A function's body returns; a value of its own, such as a constant's, doesn't. */
  constructor(declared: Type | undefined, isFunction: boolean) {
    this.declared = declared;
    this.#isFunction = isFunction;
  }

  check(context: BodyContext, node: Return): void {
    const expected = this.declared;
    const { value } = node;
    if (!this.#isFunction) {
      context.report(checkerDiagnostics.returnOutsideFunction(node.span));
      if (value !== undefined) {
        context.expression(value);
      }
      return;
    }
    if (value === undefined) {
      if (expected !== undefined) {
        context.fit(unitType, expected, node);
      }
      this.#returned.push({ type: unitType, span: node.span, site: node });
      return;
    }
    const type = context.expect(value, expected);
    this.#returned.push({ type, span: value.span, site: value });
  }

  propagate(context: BodyContext, error: Type, span: AnchoredSpan): void {
    if (!this.#isFunction) {
      context.report(checkerDiagnostics.propagateOutsideFunction(span));
    } else if (this.declared === undefined) {
      this.#propagated.push({ error, span });
    } else {
      checkPropagation(context, this.declared, { error, span });
    }
  }

  /** What the body produces, given its `tail`, once every `return` in it has been checked. */
  result(context: BodyContext, tail: Produced): Type {
    if (this.declared !== undefined) {
      fitProduced(context, tail, this.declared);
      return this.declared;
    }
    const produced = [...this.#returned, tail];
    const { decided, disagreeing } = agreedType(produced, context.checker.fitOf);
    if (decided === undefined) {
      return tail.type;
    }
    for (const each of disagreeing) {
      fitProduced(context, each, decided);
    }
    for (const propagation of this.#propagated) {
      checkPropagation(context, decided, propagation);
    }
    return decided;
  }
}

/**
 * A block body's tail: its last expression's value, or the unit the block gives, reported at its
 * last statement.
 */
export function blockTail(body: Block, type: Type): Produced {
  return { type, span: tailNodeOf(body).span, site: tailExpressionOf(body) ?? body };
}

/** Reports a `?` whose `Err` doesn't fit a function producing `result`. */
function checkPropagation(context: BodyContext, result: Type, { error, span }: Propagation): void {
  if (result.kind === 'error') {
    return;
  }
  const [, returned] = wellKnownArguments(context.checker, wellKnown.result, result) ?? [];
  if (returned === undefined) {
    context.report(checkerDiagnostics.propagateOutsideResult(span, typeText(result)));
  } else if (!sameType(returned, error) && returned.kind !== 'error' && error.kind !== 'error') {
    context.report(
      checkerDiagnostics.propagateErrorType(span, typeText(returned), typeText(error)),
    );
  }
}

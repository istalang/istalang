/**
 * What a body produces (§2, §4): its tail's value, or the value of a `return`.
 *
 * - With a declared result, the tail and every `return` must fit it.
 * - Without one, the body produces the type its tail and its `return`s agree on, as every set of
 *   producers of one value does (rules/agreement.ts); `Never` (a `return`, `break` or `continue`)
 *   agrees with anything. A lambda whose result a call is still inferring has its body guided by
 *   what is known of it (`guide`), its `return`s too, each checked in the constraint scope the
 *   lambda stands in however deep in statements it sits, so what it gives joins the call's; while
 *   one is open there, they agree once the scope settles (../../rules/open-agreement.ts).
 * - `e?` returns an `Err` early (§3.12), so the function must produce a `Result` whose error type
 *   is the same type as `e`'s. Its `Ok` type is the function's own business, so a `?` doesn't
 *   decide the result: it is checked against the declared result at once, or against the agreed
 *   one at the end. Only a function returns, so a `return` or a `?` in any other value, such as
 *   a default or a constant's, is refused.
 */

import { wellKnown } from '../../../../foundation/language/well-known/index.ts';
import type { Expression } from '../../../syntax/expressions/index.ts';
import type { Return } from '../../../syntax/statements/index.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { BodyContext, Returns } from '../../contexts/body-context.ts';
import type { ConstraintScope } from '../../contexts/constraint-scope.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import {
  agreedType,
  fitProduced,
  type Produced,
  producedBy,
  settleProduced,
} from '../../rules/agreement.ts';
import { openAgreement } from '../../rules/open-agreement.ts';
import { misfitOf } from '../../types/fitting/fit/index.ts';
import type { Type } from '../../types/type/index.ts';
import { unitType } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type/type-text.ts';
import { wellKnownArguments } from '../../types/type/well-known.ts';

/** A `?` in the body: the error type it would return, and where. */
interface Propagation {
  readonly error: Type;
  readonly span: AnchoredSpan;
}

/**
 * Where a lambda's result stands when a call is still inferring it: the lambda, what is known of its
 * result so far, and the constraint scope it lives in.
 */
export interface GuidedResult {
  readonly node: Expression;
  readonly guide: Type;
  readonly scope: ConstraintScope | undefined;
}

/** The result of one body: declared, or gathered from its `return`s as they are checked. */
export class ReturnScope implements Returns {
  readonly declared: Type | undefined;
  readonly #isFunction: boolean;
  readonly #guided: GuidedResult | undefined;
  readonly #returned: Produced[] = [];
  readonly #propagated: Propagation[] = [];

  /** A function's body returns; a value of its own, such as a constant's, doesn't. */
  constructor(declared: Type | undefined, isFunction: boolean, guided?: GuidedResult) {
    this.declared = declared;
    this.#isFunction = isFunction;
    this.#guided = guided;
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
    const guided = this.#guided;
    const type =
      guided === undefined || expected !== undefined
        ? context.expect(value, expected)
        : context.scopes.within(guided.scope, () => context.expression(value, guided.guide));
    this.#returned.push(producedBy(value, type));
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
    const mismatch = (span: AnchoredSpan, agreed: Type, found: Type) =>
      misfitOf(context.checker.fitting, span, found, agreed);
    // A lambda guided while its result is open agrees where its call infers that result (§2).
    const isOpen =
      this.#guided !== undefined || produced.some(({ type }) => context.scopes.holds(type));
    if (isOpen) {
      const node = this.#guided?.node;
      const open =
        node === undefined || this.#returned.length === 0
          ? tail.type
          : (openAgreement(context, { node, produced, expected: undefined, mismatch }) ??
            tail.type);
      context.scopes.whenSolved((solved) => {
        for (const propagation of this.#propagated) {
          checkPropagation(context, solved(open), propagation);
        }
      });
      return open;
    }
    const { decided, disagreeing } = agreedType(produced, context.checker);
    if (decided === undefined) {
      return tail.type;
    }
    for (const each of disagreeing) {
      settleProduced(context, each, { decided, expected: undefined, mismatch });
    }
    for (const propagation of this.#propagated) {
      checkPropagation(context, decided, propagation);
    }
    return decided;
  }
}

/**
 * Reports a `?` whose `Err`'s error doesn't convert into the error of the `result` produced
 * (§3.12).
 */
function checkPropagation(context: BodyContext, result: Type, { error, span }: Propagation): void {
  if (result.kind === 'error') {
    return;
  }
  const [, returned] = wellKnownArguments(context.checker, wellKnown.result, result) ?? [];
  if (returned === undefined) {
    context.report(checkerDiagnostics.propagateOutsideResult(span, typeText(result)));
  } else if (context.checker.fitOf(error, returned) === undefined) {
    context.report(
      checkerDiagnostics.propagateErrorType(span, typeText(returned), typeText(error)),
    );
  }
}

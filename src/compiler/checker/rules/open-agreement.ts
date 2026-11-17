/**
 * Producers of one value that agree on its type (rules/agreement.ts) where they stand in a
 * constraint scope that still infers what they agree on (docs/work/done/variance-inference/i2-scope.md
 * §3): the branches of an `if` passed to a call not chosen yet, holding a call whose type arguments
 * the call it is passed to infers, or a lambda's tail and `return`s while its result is. Their type
 * is a result variable of the scope, each producer a lower bound of it and what is expected an
 * upper bound, so what they agree on is what the scope settles it to, as agreement decides where
 * settling's own rules can't (`agreedDefault`); once the scope is solved, they are fitted to it,
 * which reports what doesn't fit.
 */

import type { Diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { BodyContext } from '../contexts/body-context.ts';
import { type Substitution, substitute } from '../types/parts/substitution.ts';
import type { Type } from '../types/type/index.ts';
import type { Joining } from '../types/unions/common-type.ts';
import { agreedType, type Produced, settleAgreement } from './agreement.ts';
import { placeholderOf } from './placeholders.ts';

/** Producers agreeing on one value's type: whose value, what they are expected to be, and how
 * one that doesn't fit what the others agree on is reported. */
interface Producers {
  readonly node: Expression;
  readonly produced: readonly Produced[];
  readonly expected: Type | undefined;
  readonly mismatch: (span: AnchoredSpan, decided: Type, found: Type) => Diagnostic<AnchoredSpan>;
}

/** What producers agree on once what they mention is settled, if anything. */
export type Agreeing = (settled: Substitution) => Type | undefined;

/**
 * What producers agree on once what they mention is `settled`, as agreement decides it
 * (agreement.ts): a variable they bound settles so where settling's own rules can't decide, so a
 * scope settles it as the producers agree once it does (settle.ts rule 5), `[(k1, 1), (k2, 2)]`
 * on `(String, Int)`.
 */
export function agreedDefault(checker: Joining, produced: readonly Produced[]): Agreeing {
  return (settled) =>
    agreedType(
      produced.map((each) => ({
        ...each,
        type: substitute(each.type, settled, checker.typeRules),
      })),
      checker,
    ).decided;
}

/**
 * The type `produced` agree on in the current scope, unless what they are expected to be is known
 * whole: the result variable `node` stands for, a member of the scope settled as they agree, which
 * fits them to what it settled to once it is solved; undefined otherwise, for them to agree at
 * once on what is expected, each still open in the scope fitted to it once the scope settles.
 */
export function openAgreement(
  context: BodyContext,
  { node, produced, expected, mismatch }: Producers,
): Type | undefined {
  const { scopes } = context;
  const isKnown = expected !== undefined && !scopes.holds(expected);
  if (!scopes.isOpen || isKnown) {
    return undefined;
  }
  const { inference, type } = placeholderOf(context, node);
  for (const each of produced) {
    inference.match(type, each.type);
  }
  if (expected !== undefined) {
    inference.match(expected, type);
  }
  const agreeing = agreedDefault(context.checker, produced);
  // What they go into decides, as an expected type does, where it bounded them; else they agree on
  // their own, which reports a branch that disagrees as such.
  const complete = () => {
    const isTaken = inference.expectationOf(type) !== undefined;
    const settled = produced.map((each) => ({ ...each, type: inference.solved(each.type) }));
    const agreed = inference.solved(type);
    const decided = isTaken && agreed.kind !== 'error' ? agreed : undefined;
    return settleAgreement(context, settled, decided, mismatch) ?? agreed;
  };
  const settling = {
    admits: () => true,
    defaultOf: (_key: unknown, settled: Substitution) => agreeing(settled),
  };
  return scopes.join({ node: undefined, inference, type, settling, complete });
}

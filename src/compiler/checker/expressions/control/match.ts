/**
 * `match` and `is` (§3.11, §4).
 *
 * - A `match` is an expression: its cases' bodies agree on its type, as an `if`'s branches do
 *   (expressions/control/branches.ts). Each case's pattern is checked against the subject's type,
 *   then its guard, then its body, in source order.
 * - It must be exhaustive: the cases without a guard must cover every value of the subject's type
 *   (patterns/exhaustiveness/exhaustiveness.ts). A comparison other than `==` against a literal or
 *   variant acts as a guard there (§3.11). A case no value can reach, given the cases before it, is
 *   warned of.
 * - A case whose pattern its subject's type can't hold, as a field loop's value or key in another
 *   field's pass (§4), never matches (`cantMatch`, §3.11): it is warned of, and its guard and body
 *   are neither checked nor lowered.
 * - `x is Pattern` is a boolean; the binder decides where its bindings are visible, and the names
 *   are declared here with their parts' types.
 */

import { valueBranchesOf } from '../../../syntax/expressions/branches.ts';
import type { Is, Match } from '../../../syntax/expressions/index.ts';
import { casesOf } from '../../../syntax/expressions/readings.ts';
import type { AnchoredSpan } from '../../../syntax/positions.ts';
import { stoppedOperation } from '../../calls/stopped-operations.ts';
import type { Accepts, BodyContext } from '../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { analyze, anyShape, type CaseShape } from '../../patterns/exhaustiveness/exhaustiveness.ts';
import { remainingType } from '../../patterns/exhaustiveness/remaining.ts';
import { signatureOf, witnessText } from '../../patterns/exhaustiveness/shapes.ts';
import { checkPattern } from '../../patterns/matching.ts';
import { cantMatch } from '../../surface/checked-pattern.ts';
import { keyOwnerOfValue, recordPatternKeys } from '../../types/traits/struct-keys.ts';
import type { Type } from '../../types/type/index.ts';
import { boolType } from '../../types/type/primitives.ts';
import { decideComparison } from '../decided-conditions.ts';
import { Branches, branchesAccepts } from './branches.ts';

export function checkMatch(context: BodyContext, node: Match, expected: Type | undefined): Type {
  const subject = context.expression(node.subject);
  const branches = new Branches(context, expected);
  const cases: CoveringCase[] = [];
  for (const matchCase of casesOf(node)) {
    const remaining = remainingType(context.checker, subject, cases);
    const { shape, tests } = checkPattern(context, matchCase.pattern, subject, remaining);
    recordPatternKeys(context, matchCase.pattern, keyOwnerOfValue(context, node.subject));
    const ruledOut = cantMatch(tests);
    if (matchCase.guard !== undefined && !ruledOut) {
      context.expect(matchCase.guard, boolType);
    }
    if (ruledOut) {
      // A case its subject's type rules out matches no value, so it covers none.
      context.report(checkerDiagnostics.heldNoValue(matchCase.pattern.span));
      context.ruleOut(matchCase.body);
    } else {
      cases.push({
        shape: shape ?? anyShape,
        guarded: matchCase.guard !== undefined || shape === undefined,
        at: matchCase.pattern.span,
      });
      branches.add(matchCase.body);
    }
  }
  if (subject.kind === 'error') {
    return branches.agreedType();
  }
  const stopped = stoppedOperation(context, node, [{ node: node.subject, type: subject }]);
  if (stopped !== undefined) {
    return stopped;
  }
  reportCoverage(context, node, subject, cases);
  return branches.agreedType();
}

/** `x is P`: a pattern the subject's type rules out decides it false, warned of there (§4). */
export function checkIs(context: BodyContext, node: Is): Type {
  const subject = context.expression(node.subject);
  const { tests } = checkPattern(context, node.pattern, subject);
  recordPatternKeys(context, node.pattern, keyOwnerOfValue(context, node.subject));
  const stopped = stoppedOperation(context, node, [{ node: node.subject, type: subject }]);
  if (stopped !== undefined) {
    return stopped;
  }
  if (cantMatch(tests)) {
    decideComparison(context, node, false);
  }
  return boolType;
}

/** A case as exhaustiveness sees it, and where its pattern is written. */
interface CoveringCase extends CaseShape {
  readonly at: AnchoredSpan;
}

function reportCoverage(
  context: BodyContext,
  node: Match,
  subject: Type,
  cases: readonly CoveringCase[],
): void {
  const { checker } = context;
  const { missing, unreachable } = analyze(signatureOf(checker), subject, cases);
  if (missing.length > 0) {
    const text = missing.map((shape) => witnessText(checker, shape, subject)).join(', ');
    context.report(checkerDiagnostics.nonExhaustiveMatch(node.subject.span, text));
  }
  for (const index of unreachable) {
    const at = cases[index]?.at;
    if (at !== undefined) {
      context.report(checkerDiagnostics.unreachableCase(at));
    }
  }
}

/** A `match` takes what its cases agree on. */
export function matchAccepts(context: BodyContext, node: Match): Accepts | undefined {
  return branchesAccepts(context, valueBranchesOf(node));
}

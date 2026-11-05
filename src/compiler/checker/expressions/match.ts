/**
 * `match` and `is` (§3.11, §4).
 *
 * - A `match` is an expression: its cases' bodies agree on its type, as an `if`'s branches do
 *   (rules/branches.ts). Each case's pattern is checked against the subject's type, then its
 *   guard, then its body, in source order.
 * - It must be exhaustive: the cases without a guard must cover every value of the subject's type
 *   (patterns/exhaustiveness.ts). A comparison other than `==` against a literal or variant acts
 *   as a guard there (§3.11). A case no value can reach, given the cases before it, is warned of.
 * - `x is Pattern` is a boolean; the binder decides where its bindings are visible, and the names
 *   are declared here with their parts' types.
 */

import { valueBranchesOf } from '../../syntax/expressions/branches.ts';
import { casesOf, type Is, type Match } from '../../syntax/expressions/index.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { Accepts, BodyContext } from '../body-context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { analyze, anyShape, type CaseShape } from '../patterns/exhaustiveness.ts';
import { checkPattern } from '../patterns/matching.ts';
import { remainingType } from '../patterns/remaining.ts';
import { signatureOf, witnessText } from '../patterns/shapes.ts';
import { Branches, branchesAccepts } from '../rules/branches.ts';
import { boolType, type Type } from '../types/type.ts';

export function checkMatch(context: BodyContext, node: Match, expected: Type | undefined): Type {
  const subject = context.expression(node.subject);
  const branches = new Branches(context, expected);
  const cases: CoveringCase[] = [];
  for (const matchCase of casesOf(node)) {
    const remaining = remainingType(context.checker, subject, cases);
    const { shape } = checkPattern(context, matchCase.pattern, subject, remaining);
    if (matchCase.guard !== undefined) {
      context.expect(matchCase.guard, boolType);
    }
    cases.push({
      shape: shape ?? anyShape,
      guarded: matchCase.guard !== undefined || shape === undefined,
      at: matchCase.pattern.span,
    });
    branches.add(matchCase.body);
  }
  if (subject.kind !== 'error') {
    reportCoverage(context, node, subject, cases);
  }
  return branches.agreedType();
}

export function checkIs(context: BodyContext, node: Is): Type {
  checkPattern(context, node.pattern, context.expression(node.subject));
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

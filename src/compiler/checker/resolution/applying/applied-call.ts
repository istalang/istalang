/**
 * A call applied: chosen among its candidates, instantiated with its constraints met, and its
 * arguments fitted to what they fill (§3.5, §3.7). Written calls (resolution/calls/resolve.ts) and
 * the calls the language makes (implicit.ts) apply through here, each saying how a call nothing
 * takes is reported and recording what it made; so choosing, ranking the implicit conversions
 * (choosing/choice.ts) and fitting an argument, its conversion and wraps included
 * (argument-fit.ts), each happen in one place for every call.
 *
 * - An argument of the error type was reported already, so the call reports nothing more.
 * - A call through a union's trait is a candidate only where the union meets the trait (§6,
 *   conformance/trait-calls.ts); one that inferred the trait's arguments is judged once they are,
 *   and closed with them, or made through the function declared for the union whole instead.
 * - A call several candidates take alike is ambiguous, named as `name` says; several traits a
 *   union meets requiring the function called on it are reported as such.
 */

import type { Diagnostic } from '../../../../foundation/diagnostics/diagnostic.ts';
import type { Expression } from '../../../syntax/expressions/index.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { useSite } from '../../contexts/use-site.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { Settling } from '../../types/inference/settle.ts';
import { substitute } from '../../types/parts/substitution.ts';
import type { Type } from '../../types/type/index.ts';
import { typeText } from '../../types/type/type-text.ts';
import type { CallArgument, Inapplicability } from '../choosing/call-arguments.ts';
import type { Candidate } from '../choosing/candidates.ts';
import { type Application, choose } from '../choosing/choice.ts';
import { type Instantiation, instantiate, settlingAt } from '../conformance/conformance.ts';
import { closedThroughMembers, metThroughTraits } from '../conformance/trait-calls.ts';
import { membersRequirementOf, traitMetBy } from '../conformance/union-traits.ts';
import { argumentListText, filledTypes, fitArguments, recordArgumentKeys } from './argument-fit.ts';

/** A call to apply: where it stands, how reports name it, what it may call and is given. */
export interface CallApplication {
  readonly span: AnchoredSpan;
  /** The function's name, or the operator, as an ambiguity names the call. */
  readonly name: string;
  readonly candidates: readonly Candidate[];
  readonly arguments: readonly (CallArgument & { readonly node?: Expression | undefined })[];
  readonly typeArguments?: readonly Type[] | undefined;
  /** The type the call is to give, which advises its type arguments once it is chosen. */
  readonly expected?: Type | undefined;
  /** Reports why no candidate takes the arguments, given each one's reason. */
  readonly none: (reasons: readonly Inapplicability[]) => void;
  /**
   * Checks what the chosen function decides before it is instantiated, as lambdas' bodies, once
   * the expected type has given its bounds.
   */
  readonly chosen?: (application: Application, settling: Settling) => void;
}

/** A call made: what was chosen and instantiated, and what it gives. */
export interface AppliedCall {
  readonly application: Application;
  readonly instantiation: Instantiation;
  readonly result: Type;
}

/** Applies `request`; undefined after reporting why it can't be made. */
export function applyCall(context: BodyContext, request: CallApplication): AppliedCall | undefined {
  if (request.arguments.some(({ type }) => type?.kind === 'error')) {
    return undefined;
  }
  const { checker } = context;
  const candidates = metThroughTraits(checker, request.candidates);
  const choice = choose(checker, candidates, request.arguments, request.typeArguments);
  if (choice.kind === 'several') {
    context.report(ambiguity(checker, request, choice.tied));
    return undefined;
  }
  if (choice.kind === 'none') {
    request.none(choice.reasons);
    return undefined;
  }
  const { application } = choice;
  const site = useSite(checker, context.module, request.span);
  application.inference.expect(application.signature.result(), request.expected);
  request.chosen?.(application, settlingAt(site, application.signature));
  const instantiation = instantiate(site, application);
  if (instantiation === undefined) {
    return undefined;
  }
  const { candidate } = application;
  const inferred = candidate.requirement?.inferred;
  const closed =
    inferred === undefined
      ? { kind: 'members' as const, candidate, instantiation }
      : closedThroughMembers(site, candidate, inferred, instantiation);
  if (closed?.kind === 'declared') {
    return applyCall(context, { ...request, candidates: [{ declaration: closed.declaration }] });
  }
  if (closed === undefined) {
    return undefined;
  }
  const count = request.arguments.length;
  fitArguments(
    context,
    request.arguments,
    filledTypes(checker.typeRules, application, instantiation, count),
  );
  recordArgumentKeys(context, request.arguments, { application, instantiation });
  return {
    application: { ...application, candidate: closed.candidate },
    instantiation: closed.instantiation,
    result: substitute(
      application.signature.result(),
      instantiation.substitution,
      checker.typeRules,
    ),
  };
}

/** What a call several candidates take alike reports: several traits of a union, or ambiguity. */
function ambiguity(
  checker: CheckerContext,
  request: CallApplication,
  tied: readonly Application[],
): Diagnostic<AnchoredSpan> {
  const origins = tied.flatMap(({ candidate }) => membersRequirementOf(candidate) ?? []);
  const [first] = origins;
  if (first === undefined || origins.length < tied.length) {
    const list = argumentListText(request.arguments);
    return checkerDiagnostics.ambiguousCall(request.span, request.name, list);
  }
  const traits = origins.map(
    ({ through, on }) => traitMetBy(through, on, checker.typeRules).trait.name.text,
  );
  return checkerDiagnostics.severalTraits(request.span, request.name, typeText(first.on), traits);
}

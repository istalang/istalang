/**
 * A call applied: chosen among its candidates, instantiated with its constraints met, and its
 * arguments fitted to what they fill (§3.5, §3.7). Written calls
 * (resolution/calls/resolve/index.ts) and the calls the language makes (implicit.ts) apply through
 * here, each saying how a call nothing takes is reported and recording what it made; so choosing,
 * ranking the implicit conversions (choosing/choice.ts) and fitting an argument, its conversion and
 * wraps included (argument-fit.ts), each happen in one place for every call. Choosing
 * (`chooseCall`) and completing (`completeCall`) are apart, so a written call completes once the
 * constraint scope it stands in settles (wiring/body/constraint-scope.ts); a call the language
 * makes applies at once (`applyCall`).
 *
 * - An argument of the error type was reported already, so a call nothing chosen for reports
 *   nothing more, while one chosen all the same judges its other arguments.
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
import { bodySite } from '../../contexts/use-site.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { Inference } from '../../types/inference/infer.ts';
import { substitute } from '../../types/parts/substitution.ts';
import type { Type } from '../../types/type/index.ts';
import { typeText } from '../../types/type/type-text.ts';
import type { CallArgument, Inapplicability } from '../choosing/call-arguments.ts';
import type { Candidate } from '../choosing/candidates.ts';
import { type Application, choose } from '../choosing/choice.ts';
import { type Instantiation, instantiate } from '../conformance/conformance.ts';
import { closedThroughMembers, metThroughTraits } from '../conformance/trait-calls.ts';
import { membersRequirementOf, traitMetBy } from '../conformance/union-traits.ts';
import {
  argumentListText,
  filledTypes,
  fitArguments,
  recordArgumentKeys,
  withSolvedTypes,
} from './argument-fit.ts';

/** A call to apply: where it stands, how reports name it, what it may call and is given. */
export interface CallApplication {
  readonly span: AnchoredSpan;
  /** The call's node, which its variables stand at (types/inference/variables.ts), if written. */
  readonly site?: object | undefined;
  /** The function's name, or the operator, as an ambiguity names the call. */
  readonly name: string;
  readonly candidates: readonly Candidate[];
  readonly arguments: readonly (CallArgument & { readonly node?: Expression | undefined })[];
  readonly typeArguments?: readonly Type[] | undefined;
  /** The type the call is to give, which advises its type arguments once it is chosen. */
  readonly expected?: Type | undefined;
  /**
   * The inference of the constraint scope the call joins (wiring/body/constraint-scope.ts), which
   * each candidate's system starts as a copy of; none for a call settled on its own.
   */
  readonly scope?: Inference | undefined;
  /** Reports why no candidate takes the arguments, given each one's reason. */
  readonly none: (reasons: readonly Inapplicability[]) => void;
}

/** A call made: what was chosen and instantiated, and what it gives. */
export interface AppliedCall {
  readonly application: Application;
  readonly instantiation: Instantiation;
  readonly result: Type;
}

/** Applies `request` at once, as the outermost call; undefined after reporting why it can't be made. */
export function applyCall(context: BodyContext, request: CallApplication): AppliedCall | undefined {
  const application = chooseCall(context, request);
  if (application === undefined) {
    return undefined;
  }
  return completeCall(context, request, application);
}

/**
 * Chooses the function `request` calls, its arguments matched and then advised by the type it is
 * expected to give; undefined after reporting why none can be chosen, unless it `reports` nothing.
 */
export function chooseCall(
  context: BodyContext,
  request: CallApplication,
  { reports = true }: { readonly reports?: boolean } = {},
): Application | undefined {
  const { checker } = context;
  const candidates = metThroughTraits(checker, request.candidates);
  const choice = choose(checker, candidates, request.arguments, {
    written: request.typeArguments,
    site: request.site,
    scope: request.scope,
    decidedKind: context.codeKind,
  });
  // An argument of the error type was reported already; it fits anything, so a call it leaves no
  // single function for reports nothing more, and one it leaves one still judges the others.
  if (choice.kind !== 'chosen' && request.arguments.some(({ type }) => type?.kind === 'error')) {
    return undefined;
  }
  if (choice.kind === 'several') {
    if (reports) {
      context.report(ambiguity(checker, request, choice.tied));
    }
    return undefined;
  }
  if (choice.kind === 'none') {
    if (reports) {
      request.none(choice.reasons);
    }
    return undefined;
  }
  const { application } = choice;
  application.inference.expect(application.signature.result(), request.expected);
  return application;
}

/**
 * Completes the call `application` makes once its inference is settled: instantiated with its
 * constraints met, and its arguments fitted; undefined after reporting why it can't be made.
 */
export function completeCall(
  context: BodyContext,
  request: CallApplication,
  application: Application,
): AppliedCall | undefined {
  const { checker } = context;
  const site = bodySite(context, request.span);
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
  const settled = withSolvedTypes(request.arguments, (type) => application.inference.solved(type));
  fitArguments(
    context,
    settled,
    filledTypes(checker.typeRules, application, instantiation.substitution, settled.length),
  );
  recordArgumentKeys(context, settled, { application, instantiation });
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
